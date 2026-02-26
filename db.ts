import bcrypt from "bcryptjs";
import { Pool, type PoolClient } from "pg";

type QueryParam = string | number | boolean | null;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL. Set it to your Supabase Postgres connection string.");
}

const ssl = process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false };

const pool = new Pool({
  connectionString: databaseUrl,
  ssl,
});

export async function query<T = any>(text: string, params: QueryParam[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function queryOne<T = any>(
  text: string,
  params: QueryParam[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function execute(text: string, params: QueryParam[] = []): Promise<void> {
  await pool.query(text, params);
}

async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function ensureSchema() {
  await execute(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE,
      password TEXT,
      name TEXT,
      role TEXT DEFAULT 'student'
    );

    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT,
      parent_id INTEGER REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS courses (
      id SERIAL PRIMARY KEY,
      name TEXT,
      code TEXT,
      category_id INTEGER REFERENCES categories(id),
      instructor TEXT,
      created_by INTEGER REFERENCES users(id),
      credits INTEGER,
      description TEXT,
      image_url TEXT,
      start_date TIMESTAMPTZ,
      end_date TIMESTAMPTZ,
      visibility TEXT DEFAULT 'show'
    );

    CREATE TABLE IF NOT EXISTS sections (
      id SERIAL PRIMARY KEY,
      course_id INTEGER REFERENCES courses(id),
      title TEXT,
      "order" INTEGER
    );

    CREATE TABLE IF NOT EXISTS enrollments (
      user_id INTEGER REFERENCES users(id),
      course_id INTEGER REFERENCES courses(id),
      progress INTEGER DEFAULT 0,
      last_accessed TIMESTAMPTZ,
      PRIMARY KEY (user_id, course_id)
    );

    CREATE TABLE IF NOT EXISTS activities (
      id SERIAL PRIMARY KEY,
      section_id INTEGER REFERENCES sections(id),
      course_id INTEGER REFERENCES courses(id),
      title TEXT,
      type TEXT,
      due_date TIMESTAMPTZ,
      description TEXT,
      content TEXT
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id SERIAL PRIMARY KEY,
      activity_id INTEGER REFERENCES activities(id),
      user_id INTEGER REFERENCES users(id),
      status TEXT,
      submitted_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS course_details (
      course_id INTEGER PRIMARY KEY REFERENCES courses(id),
      faculty_info TEXT,
      teaching_assistant TEXT,
      credits INTEGER DEFAULT 2,
      learning_outcomes JSONB DEFAULT '[]'::jsonb,
      evaluation_components JSONB DEFAULT '[]'::jsonb
    );

    CREATE TABLE IF NOT EXISTS course_materials (
      id SERIAL PRIMARY KEY,
      course_id INTEGER REFERENCES courses(id),
      section_id INTEGER REFERENCES sections(id),
      title TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_url TEXT,
      source_file_name TEXT,
      source_file_base64 TEXT,
      content TEXT NOT NULL,
      summary TEXT,
      key_takeaways JSONB DEFAULT '[]'::jsonb,
      is_assigned BOOLEAN NOT NULL DEFAULT FALSE,
      assigned_at TIMESTAMPTZ,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS material_quiz_questions (
      id SERIAL PRIMARY KEY,
      material_id INTEGER REFERENCES course_materials(id),
      question_order INTEGER NOT NULL,
      question_text TEXT NOT NULL,
      options JSONB NOT NULL,
      correct_answer INTEGER NOT NULL,
      explanation TEXT
    );

    CREATE TABLE IF NOT EXISTS material_quiz_attempts (
      id SERIAL PRIMARY KEY,
      material_id INTEGER REFERENCES course_materials(id),
      user_id INTEGER REFERENCES users(id),
      answers JSONB NOT NULL,
      score INTEGER NOT NULL,
      total_questions INTEGER NOT NULL,
      submitted_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS course_sessions (
      id SERIAL PRIMARY KEY,
      course_id INTEGER REFERENCES courses(id),
      session_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      session_date DATE NOT NULL,
      start_time TEXT,
      end_time TEXT,
      mode TEXT DEFAULT 'classroom',
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS feedback_forms (
      id SERIAL PRIMARY KEY,
      course_id INTEGER REFERENCES courses(id),
      trigger_session_number INTEGER NOT NULL,
      open_at TIMESTAMPTZ NOT NULL,
      due_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (course_id, trigger_session_number)
    );

    CREATE TABLE IF NOT EXISTS feedback_questions (
      id SERIAL PRIMARY KEY,
      form_id INTEGER REFERENCES feedback_forms(id) ON DELETE CASCADE,
      question_order INTEGER NOT NULL,
      question_text TEXT NOT NULL,
      question_type TEXT NOT NULL,
      options JSONB DEFAULT '[]'::jsonb,
      required BOOLEAN DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS feedback_submissions (
      id SERIAL PRIMARY KEY,
      form_id INTEGER REFERENCES feedback_forms(id) ON DELETE CASCADE,
      course_id INTEGER REFERENCES courses(id),
      user_id INTEGER REFERENCES users(id),
      answers JSONB NOT NULL,
      submitted_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (form_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS material_learning_progress (
      material_id INTEGER REFERENCES course_materials(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      opened_at TIMESTAMPTZ,
      read_completed_at TIMESTAMPTZ,
      quiz_completed_at TIMESTAMPTZ,
      quiz_score INTEGER,
      quiz_total INTEGER,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (material_id, user_id)
    );
  `);

  await execute(`
    ALTER TABLE courses ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);
    ALTER TABLE course_materials ADD COLUMN IF NOT EXISTS source_file_name TEXT;
    ALTER TABLE course_materials ADD COLUMN IF NOT EXISTS source_file_base64 TEXT;
    ALTER TABLE course_materials ADD COLUMN IF NOT EXISTS is_assigned BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE course_materials ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
  `);
}

async function getOrCreateCategory(client: PoolClient, name: string, parentId: number | null) {
  const found = await client.query<{ id: number }>(
    "SELECT id FROM categories WHERE name = $1 AND parent_id IS NOT DISTINCT FROM $2 LIMIT 1",
    [name, parentId]
  );
  if (found.rows[0]) return found.rows[0].id;

  const created = await client.query<{ id: number }>(
    "INSERT INTO categories (name, parent_id) VALUES ($1, $2) RETURNING id",
    [name, parentId]
  );
  return created.rows[0].id;
}

async function ensureUsers(client: PoolClient) {
  const userCount = await client.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM users");
  if ((userCount.rows[0]?.count ?? 0) > 0) return;

  const hashedPassword = bcrypt.hashSync("password123", 10);
  const users = [
    { email: "pgp25.aayush@spjimr.org", name: "Aayush Thakur", role: "student" },
    { email: "faculty@spjimr.org", name: "Dr. Reed", role: "faculty" },
    { email: "student1@spjimr.org", name: "Sarah Miller", role: "student" },
    { email: "student2@spjimr.org", name: "John Doe", role: "student" },
    { email: "student3@spjimr.org", name: "Emily Chen", role: "student" },
    { email: "student4@spjimr.org", name: "Michael Brown", role: "student" },
    { email: "student5@spjimr.org", name: "Jessica Wilson", role: "student" },
  ];

  for (const user of users) {
    await client.query(
      "INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4)",
      [user.email, hashedPassword, user.name, user.role]
    );
  }
}

async function ensureDefaultCourseSetup(client: PoolClient) {
  const cat1Id = await getOrCreateCategory(client, "PGDM(BM)", null);
  const cat2Id = await getOrCreateCategory(client, "PGDM(BM) 2025-2027", cat1Id);
  const cat3Id = await getOrCreateCategory(client, "PGDM (BM) 2025-27 - Term II", cat2Id);
  const defaultFaculty = await client.query<{ id: number }>(
    "SELECT id FROM users WHERE role = 'faculty' ORDER BY id ASC LIMIT 1"
  );
  const defaultFacultyId = defaultFaculty.rows[0]?.id || null;

  if (defaultFacultyId) {
    await client.query(
      `
        UPDATE courses
        SET created_by = $1
        WHERE created_by IS NULL
      `,
      [defaultFacultyId]
    );
  }

  const existingCourse = await client.query<{ id: number }>(
    "SELECT id FROM courses WHERE code = 'DIG501' LIMIT 1"
  );

  let digCourseId = existingCourse.rows[0]?.id;
  if (!digCourseId) {
    const created = await client.query<{ id: number }>(
      `INSERT INTO courses (name, code, category_id, instructor, created_by, credits, description, start_date, end_date, visibility)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'show')
       RETURNING id`,
      [
        "Business in Digital Age",
        "DIG501",
        cat3Id,
        "Prof. Ashish Desai, Prof. Abhishek Jha, Prof. Dhruven Zalal",
        defaultFacultyId,
        2,
        "Core concepts, systems and frameworks for digital transformation in B2B and B2C contexts.",
        "2025-06-01T00:00:00Z",
        "2026-05-31T23:59:59Z",
      ]
    );
    digCourseId = created.rows[0].id;
  } else {
    await client.query(
      `UPDATE courses
       SET name = $1, category_id = $2, instructor = $3, credits = $4, visibility = 'show', created_by = COALESCE(created_by, $5)
       WHERE id = $6`,
      [
        "Business in Digital Age",
        cat3Id,
        "Prof. Ashish Desai, Prof. Abhishek Jha, Prof. Dhruven Zalal",
        2,
        defaultFacultyId,
        digCourseId,
      ]
    );
  }

  const sectionNames = [
    "Course Information",
    "Topic 1",
    "Topic 2",
    "Evaluations and Submissions",
  ];
  for (const [idx, sectionName] of sectionNames.entries()) {
    const section = await client.query<{ id: number }>(
      'SELECT id FROM sections WHERE course_id = $1 AND title = $2 LIMIT 1',
      [digCourseId, sectionName]
    );
    if (section.rows[0]) {
      await client.query(
        'UPDATE sections SET "order" = $1 WHERE id = $2',
        [idx, section.rows[0].id]
      );
    } else {
      await client.query(
        'INSERT INTO sections (course_id, title, "order") VALUES ($1, $2, $3)',
        [digCourseId, sectionName, idx]
      );
    }
  }

  const existingAnnouncement = await client.query(
    `SELECT id FROM activities
     WHERE course_id = $1 AND title = 'Announcements'
     LIMIT 1`,
    [digCourseId]
  );
  if (!existingAnnouncement.rows[0]) {
    const courseInfoSection = await client.query<{ id: number }>(
      'SELECT id FROM sections WHERE course_id = $1 AND title = $2 LIMIT 1',
      [digCourseId, "Course Information"]
    );
    await client.query(
      `INSERT INTO activities (section_id, course_id, title, type, due_date, description, content)
       VALUES ($1, $2, $3, $4, NULL, $5, $6)`,
      [
        courseInfoSection.rows[0].id,
        digCourseId,
        "Announcements",
        "forum",
        "Faculty announcements and session updates.",
        "Use this discussion to share class-level announcements.",
      ]
    );
  }

  const existingSessions = await client.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM course_sessions WHERE course_id = $1",
    [digCourseId]
  );
  if ((existingSessions.rows[0]?.count ?? 0) === 0) {
    await client.query(
      `
        INSERT INTO course_sessions
          (course_id, session_number, title, session_date, start_time, end_time, mode)
        VALUES
          ($1, 1, 'Session 1: Digital Strategy Foundations', CURRENT_DATE + INTERVAL '1 day', '09:00', '10:30', 'classroom'),
          ($1, 2, 'Session 2: Platforms and Ecosystems', CURRENT_DATE + INTERVAL '3 day', '09:00', '10:30', 'classroom'),
          ($1, 3, 'Session 3: Data and AI in Business', CURRENT_DATE + INTERVAL '5 day', '09:00', '10:30', 'classroom'),
          ($1, 4, 'Session 4: India Stack and DPI', CURRENT_DATE + INTERVAL '7 day', '09:00', '10:30', 'classroom'),
          ($1, 5, 'Session 5: Payments and Trust', CURRENT_DATE + INTERVAL '9 day', '09:00', '10:30', 'classroom'),
          ($1, 6, 'Session 6: Scalable Digital Operations', CURRENT_DATE + INTERVAL '11 day', '09:00', '10:30', 'classroom')
      `,
      [digCourseId]
    );
  }

  await client.query(
    `
      INSERT INTO course_details (course_id, faculty_info, teaching_assistant, credits, learning_outcomes, evaluation_components)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
      ON CONFLICT (course_id)
      DO UPDATE SET
        faculty_info = EXCLUDED.faculty_info,
        teaching_assistant = EXCLUDED.teaching_assistant,
        credits = EXCLUDED.credits,
        learning_outcomes = EXCLUDED.learning_outcomes,
        evaluation_components = EXCLUDED.evaluation_components
    `,
    [
      digCourseId,
      "Prof. Ashish Desai, Prof. Abhishek Jha, Prof. Dhruven Zalal",
      "Khushbu Gandhi",
      2,
      JSON.stringify([
        "Demonstrate a comprehensive understanding of key technology concepts, frameworks, and enterprise systems.",
        "Apply these concepts and systems to drive digital transformation initiatives across B2B and B2C contexts.",
        "Critically assess the implications of India Stack, digital public infrastructure, payment technologies, AI, and analytics for creating contemporary, innovative, and competitive business solutions.",
        "Integrate course learnings to address disruptive growth opportunities, ethical considerations, societal impacts, and sustainability challenges in technology-driven business environments.",
      ]),
      JSON.stringify([
        {
          sr_no: 1,
          component: "Class Participation (In class - Surprise Quizzes)",
          code: "INF501-PBM-04-I01",
          weightage_percent: 30,
          timeline: "All",
          scheduled_date: "",
          clos_mapped: "All",
        },
        {
          sr_no: 2,
          component: "Group Exam",
          code: "INF501-PBM-04-G01",
          weightage_percent: 40,
          timeline: "Session 1",
          scheduled_date: "Lecture 17-18",
          clos_mapped: "All",
        },
        {
          sr_no: 3,
          component: "End Term",
          code: "INF501-PBM-04-I02",
          weightage_percent: 30,
          timeline: "Post Session 18",
          scheduled_date: "Exam Week",
          clos_mapped: "All",
        },
      ]),
    ]
  );

}

let initialized = false;

export async function initDb() {
  if (initialized) return;
  await ensureSchema();
  await withTransaction(async (client) => {
    await ensureUsers(client);
    await ensureDefaultCourseSetup(client);
  });
  initialized = true;
}

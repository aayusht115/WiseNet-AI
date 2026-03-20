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
      credits INTEGER DEFAULT 1,
      description TEXT,
      image_url TEXT,
      start_date DATE,
      end_date DATE,
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
      credits INTEGER DEFAULT 1,
      feedback_trigger_session INTEGER DEFAULT 4,
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
      due_at TIMESTAMPTZ,
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
      session_status TEXT DEFAULT 'scheduled' CHECK (session_status IN ('scheduled','completed','cancelled','rescheduled')),
      original_date DATE,
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

    CREATE TABLE IF NOT EXISTS feedback_insights (
      id SERIAL PRIMARY KEY,
      form_id INTEGER UNIQUE REFERENCES feedback_forms(id) ON DELETE CASCADE,
      course_id INTEGER REFERENCES courses(id),
      submissions_count INTEGER NOT NULL DEFAULT 0,
      summary_text TEXT NOT NULL DEFAULT '',
      metrics_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      text_comments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      generated_at TIMESTAMPTZ DEFAULT NOW(),
      viewed_at TIMESTAMPTZ
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

    CREATE TABLE IF NOT EXISTS material_chat_messages (
      id SERIAL PRIMARY KEY,
      material_id INTEGER NOT NULL REFERENCES course_materials(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_material_chat_messages_lookup
      ON material_chat_messages (material_id, user_id, created_at);

    CREATE TABLE IF NOT EXISTS summaries (
      id SERIAL PRIMARY KEY,
      activity_id INTEGER NOT NULL,
      user_id INTEGER REFERENCES users(id),
      summary_json JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS session_attendance (
      id SERIAL PRIMARY KEY,
      session_id INTEGER REFERENCES course_sessions(id) ON DELETE CASCADE,
      student_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present','absent','late','excused')),
      note TEXT,
      marked_by INTEGER REFERENCES users(id),
      marked_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (session_id, student_id)
    );
  `);

  await execute(`
    ALTER TABLE courses ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);
    ALTER TABLE courses ADD COLUMN IF NOT EXISTS credits INTEGER DEFAULT 1;
    ALTER TABLE courses ALTER COLUMN credits SET DEFAULT 1;
    ALTER TABLE courses ALTER COLUMN start_date TYPE DATE USING start_date::date;
    ALTER TABLE courses ALTER COLUMN end_date TYPE DATE USING end_date::date;
    UPDATE courses SET credits = 1 WHERE credits IS NULL OR credits <= 0;
    ALTER TABLE course_details ADD COLUMN IF NOT EXISTS credits INTEGER DEFAULT 1;
    ALTER TABLE course_details ALTER COLUMN credits SET DEFAULT 1;
    UPDATE course_details SET credits = 1 WHERE credits IS NULL OR credits <= 0;
    ALTER TABLE course_details ADD COLUMN IF NOT EXISTS feedback_trigger_session INTEGER DEFAULT 4;
    ALTER TABLE course_details ALTER COLUMN feedback_trigger_session SET DEFAULT 4;
    UPDATE course_details
    SET feedback_trigger_session = 4
    WHERE feedback_trigger_session IS NULL OR feedback_trigger_session <= 0;
    ALTER TABLE course_materials ADD COLUMN IF NOT EXISTS source_file_name TEXT;
    ALTER TABLE course_materials ADD COLUMN IF NOT EXISTS source_file_base64 TEXT;
    ALTER TABLE course_materials ADD COLUMN IF NOT EXISTS is_assigned BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE course_materials ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
    ALTER TABLE course_materials ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;
    UPDATE course_materials
    SET due_at = COALESCE(assigned_at, NOW()) + INTERVAL '2 day'
    WHERE is_assigned = TRUE AND due_at IS NULL;
    ALTER TABLE feedback_insights ADD COLUMN IF NOT EXISTS submissions_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE feedback_insights ADD COLUMN IF NOT EXISTS summary_text TEXT NOT NULL DEFAULT '';
    ALTER TABLE feedback_insights ADD COLUMN IF NOT EXISTS metrics_json JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE feedback_insights ADD COLUMN IF NOT EXISTS text_comments_json JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE feedback_insights ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE feedback_insights ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_feedback_forms_due_at ON feedback_forms (due_at);
    CREATE INDEX IF NOT EXISTS idx_feedback_insights_course_viewed ON feedback_insights (course_id, viewed_at);
    CREATE INDEX IF NOT EXISTS idx_session_attendance_session ON session_attendance (session_id);
    ALTER TABLE course_sessions ADD COLUMN IF NOT EXISTS session_status TEXT DEFAULT 'scheduled' CHECK (session_status IN ('scheduled','completed','cancelled','rescheduled'));
    ALTER TABLE course_sessions ADD COLUMN IF NOT EXISTS original_date DATE;
    CREATE TABLE IF NOT EXISTS notifications (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type          TEXT NOT NULL,
      title         TEXT NOT NULL,
      body          TEXT NOT NULL DEFAULT '',
      course_id     INTEGER REFERENCES courses(id) ON DELETE SET NULL,
      material_id   INTEGER REFERENCES course_materials(id) ON DELETE SET NULL,
      is_read       BOOLEAN NOT NULL DEFAULT FALSE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id, is_read, created_at DESC);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
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
  await getOrCreateCategory(client, "PGDM (BM) 2025-27 - Term II", cat2Id);

  // Hide legacy seeded default course from faculty/student "My courses".
  await client.query(
    `
      UPDATE courses
      SET created_by = NULL,
          visibility = 'hide'
      WHERE code = 'DIG501'
        AND instructor = 'Prof. Ashish Desai, Prof. Abhishek Jha, Prof. Dhruven Zalal'
    `
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

import bcrypt from "bcryptjs";
import { Pool, type PoolClient } from "pg";

type QueryParam = string | number | boolean | null;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL. Set it to your Supabase Postgres connection string.");
}

const ssl =
  process.env.PGSSLMODE === "disable"
    ? false
    : { rejectUnauthorized: false };

const pool = new Pool({
  connectionString: databaseUrl,
  ssl,
});

export async function query<T = any>(
  text: string,
  params: QueryParam[] = []
): Promise<T[]> {
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

export async function execute(
  text: string,
  params: QueryParam[] = []
): Promise<void> {
  await pool.query(text, params);
}

async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
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
  `);
}

async function seed() {
  const userCount = await queryOne<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM users"
  );
  if ((userCount?.count ?? 0) > 0) return;

  const hashedPassword = bcrypt.hashSync("password123", 10);

  await withTransaction(async (client) => {
    await client.query(
      "INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4)",
      ["pgp25.aayush@spjimr.org", hashedPassword, "Aayush Thakur", "student"]
    );
    await client.query(
      "INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4)",
      ["faculty@spjimr.org", hashedPassword, "Dr. Reed", "faculty"]
    );

    const students = [
      { email: "student1@spjimr.org", name: "Sarah Miller" },
      { email: "student2@spjimr.org", name: "John Doe" },
      { email: "student3@spjimr.org", name: "Emily Chen" },
      { email: "student4@spjimr.org", name: "Michael Brown" },
      { email: "student5@spjimr.org", name: "Jessica Wilson" },
    ];

    for (const student of students) {
      await client.query(
        "INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4)",
        [student.email, hashedPassword, student.name, "student"]
      );
    }

    const cat1 = await client.query<{ id: number }>(
      "INSERT INTO categories (name) VALUES ($1) RETURNING id",
      ["PGDM(BM)"]
    );
    const cat2 = await client.query<{ id: number }>(
      "INSERT INTO categories (name, parent_id) VALUES ($1, $2) RETURNING id",
      ["PGDM(BM) 2025-2027", cat1.rows[0].id]
    );
    const cat3 = await client.query<{ id: number }>(
      "INSERT INTO categories (name, parent_id) VALUES ($1, $2) RETURNING id",
      ["PGDM (BM) 2025-27 - Term I", cat2.rows[0].id]
    );

    const courses = [
      {
        name: "Business Communication - I",
        code: "OLS513-PBM",
        instructor: "Dr. Reed",
        credits: 1,
      },
      {
        name: "Business Policy & Strategy - I",
        code: "STR501-PBM",
        instructor: "Dr. Reed",
        credits: 1,
      },
      {
        name: "Decision Analysis Simulation",
        code: "STR503-PBM",
        instructor: "Prof. Rajiv Agarwal",
        credits: 1,
      },
      {
        name: "Financial Accounting and Statement Analysis",
        code: "ACC505-PBM",
        instructor: "Prof. Y",
        credits: 1,
      },
      {
        name: "Managerial Economics - I",
        code: "ECO502-PBM",
        instructor: "Prof. Z",
        credits: 1,
      },
      {
        name: "Corporate Finance",
        code: "FIN501",
        instructor: "Dr. Reed",
        credits: 1,
      },
      {
        name: "Business in Digital Age",
        code: "DIG501",
        instructor: "Prof. Michael Chen",
        credits: 1,
      },
    ];

    const courseIds: number[] = [];
    for (const course of courses) {
      const row = await client.query<{ id: number }>(
        `INSERT INTO courses (name, code, category_id, instructor, credits, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          course.name,
          course.code,
          cat3.rows[0].id,
          course.instructor,
          course.credits,
          "2025-06-01T00:00:00Z",
          "2026-05-31T23:59:59Z",
        ]
      );
      courseIds.push(row.rows[0].id);
    }

    const s1 = await client.query<{ id: number }>(
      'INSERT INTO sections (course_id, title, "order") VALUES ($1, $2, $3) RETURNING id',
      [courseIds[0], "General", 0]
    );
    const s2 = await client.query<{ id: number }>(
      'INSERT INTO sections (course_id, title, "order") VALUES ($1, $2, $3) RETURNING id',
      [courseIds[0], "Topic 1: Introduction", 1]
    );
    const s3 = await client.query<{ id: number }>(
      'INSERT INTO sections (course_id, title, "order") VALUES ($1, $2, $3) RETURNING id',
      [courseIds[0], "Topic 2: Advanced Concepts", 2]
    );

    await client.query(
      `INSERT INTO activities (course_id, section_id, title, type, due_date, content)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [courseIds[0], s1.rows[0].id, "Announcements", "forum", null, "Course announcements"]
    );
    await client.query(
      `INSERT INTO activities (course_id, section_id, title, type, due_date, content)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [courseIds[0], s2.rows[0].id, "Introduction PDF", "resource", null, "Reading material"]
    );
    await client.query(
      `INSERT INTO activities (course_id, section_id, title, type, due_date, content)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [courseIds[0], s2.rows[0].id, "Week 1 Quiz", "quiz", "2026-02-26T23:59:00Z", "Test your knowledge"]
    );
    await client.query(
      `INSERT INTO activities (course_id, section_id, title, type, due_date, content)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [courseIds[0], s3.rows[0].id, "Final Assignment", "assignment", "2026-03-15T23:59:00Z", "Submit your project"]
    );

    const studentIds = await client.query<{ id: number }>(
      "SELECT id FROM users WHERE role = 'student'"
    );
    for (const [userIndex, user] of studentIds.rows.entries()) {
      for (const [courseIndex, courseId] of courseIds.entries()) {
        if (courseIndex < 2 || Math.random() > 0.5) {
          await client.query(
            `INSERT INTO enrollments (user_id, course_id, progress, last_accessed)
             VALUES ($1, $2, $3, $4)`,
            [
              user.id,
              courseId,
              Math.floor(Math.random() * 100),
              new Date(Date.now() - (courseIndex + userIndex) * 3600000).toISOString(),
            ]
          );
        }
      }
    }
  });
}

let initialized = false;

export async function initDb() {
  if (initialized) return;
  await ensureSchema();
  await seed();
  initialized = true;
}

import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const db = new Database('wisenet.db');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    name TEXT,
    role TEXT DEFAULT 'student'
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    parent_id INTEGER,
    FOREIGN KEY (parent_id) REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    code TEXT,
    category_id INTEGER,
    instructor TEXT,
    credits INTEGER,
    description TEXT,
    image_url TEXT,
    start_date DATETIME,
    end_date DATETIME,
    visibility TEXT DEFAULT 'show',
    FOREIGN KEY (category_id) REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER,
    title TEXT,
    "order" INTEGER,
    FOREIGN KEY (course_id) REFERENCES courses(id)
  );

  CREATE TABLE IF NOT EXISTS enrollments (
    user_id INTEGER,
    course_id INTEGER,
    progress INTEGER DEFAULT 0,
    last_accessed DATETIME,
    PRIMARY KEY (user_id, course_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (course_id) REFERENCES courses(id)
  );

  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER,
    course_id INTEGER,
    title TEXT,
    type TEXT, -- 'assignment', 'quiz', 'resource', 'forum'
    due_date DATETIME,
    description TEXT,
    content TEXT,
    FOREIGN KEY (section_id) REFERENCES sections(id),
    FOREIGN KEY (course_id) REFERENCES courses(id)
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id INTEGER,
    user_id INTEGER,
    status TEXT, -- 'submitted', 'pending'
    submitted_at DATETIME,
    FOREIGN KEY (activity_id) REFERENCES activities(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Seed data
const seed = () => {
  const userCount = db.prepare('SELECT count(*) as count FROM users').get() as { count: number };
  if (userCount.count === 0) {
    const hashedPassword = bcrypt.hashSync('password123', 10);
    db.prepare('INSERT INTO users (email, password, name, role) VALUES (?, ?, ?, ?)').run(
      'pgp25.aayush@spjimr.org',
      hashedPassword,
      'Aayush Thakur',
      'student'
    );
    db.prepare('INSERT INTO users (email, password, name, role) VALUES (?, ?, ?, ?)').run(
      'faculty@spjimr.org',
      hashedPassword,
      'Dr. Reed',
      'faculty'
    );

    // More students
    const students = [
      { email: 'student1@spjimr.org', name: 'Sarah Miller' },
      { email: 'student2@spjimr.org', name: 'John Doe' },
      { email: 'student3@spjimr.org', name: 'Emily Chen' },
      { email: 'student4@spjimr.org', name: 'Michael Brown' },
      { email: 'student5@spjimr.org', name: 'Jessica Wilson' },
    ];

    students.forEach(s => {
      db.prepare('INSERT INTO users (email, password, name, role) VALUES (?, ?, ?, ?)').run(
        s.email,
        hashedPassword,
        s.name,
        'student'
      );
    });

    // Categories
    const cat1 = db.prepare('INSERT INTO categories (name) VALUES (?)').run('PGDM(BM)').lastInsertRowid;
    const cat2 = db.prepare('INSERT INTO categories (name, parent_id) VALUES (?, ?)').run('PGDM(BM) 2025-2027', cat1).lastInsertRowid;
    const cat3 = db.prepare('INSERT INTO categories (name, parent_id) VALUES (?, ?)').run('PGDM (BM) 2025-27 - Term I', cat2).lastInsertRowid;

    // Courses
    const courses = [
      { name: 'Business Communication - I', code: 'OLS513-PBM', cat: cat3, instructor: 'Dr. Reed', credits: 1 },
      { name: 'Business Policy & Strategy - I', code: 'STR501-PBM', cat: cat3, instructor: 'Dr. Reed', credits: 1 },
      { name: 'Decision Analysis Simulation', code: 'STR503-PBM', cat: cat3, instructor: 'Prof. Rajiv Agarwal', credits: 1 },
      { name: 'Financial Accounting and Statement Analysis', code: 'ACC505-PBM', cat: cat3, instructor: 'Prof. Y', credits: 1 },
      { name: 'Managerial Economics - I', code: 'ECO502-PBM', cat: cat3, instructor: 'Prof. Z', credits: 1 },
      { name: 'Corporate Finance', code: 'FIN501', cat: cat3, instructor: 'Dr. Reed', credits: 1 },
      { name: 'Business in Digital Age', code: 'DIG501', cat: cat3, instructor: 'Prof. Michael Chen', credits: 1 },
    ];

    const insertCourse = db.prepare('INSERT INTO courses (name, code, category_id, instructor, credits, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const courseIds: number[] = [];
    courses.forEach(c => {
      const result = insertCourse.run(
        c.name, 
        c.code, 
        c.cat, 
        c.instructor, 
        c.credits,
        '2025-06-01T00:00:00Z',
        '2026-05-31T23:59:59Z'
      );
      courseIds.push(Number(result.lastInsertRowid));
    });

    // Sections and Activities for the first course
    const addSection = db.prepare('INSERT INTO sections (course_id, title, "order") VALUES (?, ?, ?)');
    const s1 = addSection.run(courseIds[0], 'General', 0).lastInsertRowid;
    const s2 = addSection.run(courseIds[0], 'Topic 1: Introduction', 1).lastInsertRowid;
    const s3 = addSection.run(courseIds[0], 'Topic 2: Advanced Concepts', 2).lastInsertRowid;

    const addActivity = db.prepare('INSERT INTO activities (course_id, section_id, title, type, due_date, content) VALUES (?, ?, ?, ?, ?, ?)');
    addActivity.run(courseIds[0], s1, 'Announcements', 'forum', null, 'Course announcements');
    addActivity.run(courseIds[0], s2, 'Introduction PDF', 'resource', null, 'Reading material');
    addActivity.run(courseIds[0], s2, 'Week 1 Quiz', 'quiz', '2026-02-26T23:59:00Z', 'Test your knowledge');
    addActivity.run(courseIds[0], s3, 'Final Assignment', 'assignment', '2026-03-15T23:59:00Z', 'Submit your project');

    // Enrollments
    const enroll = db.prepare('INSERT INTO enrollments (user_id, course_id, progress, last_accessed) VALUES (?, ?, ?, ?)');
    const allUserIds = db.prepare('SELECT id FROM users WHERE role = "student"').all() as { id: number }[];
    
    allUserIds.forEach((user, uIdx) => {
      courseIds.forEach((id, cIdx) => {
        // Enroll everyone in the first 2 courses, others randomly
        if (cIdx < 2 || Math.random() > 0.5) {
          enroll.run(user.id, id, Math.floor(Math.random() * 100), new Date(Date.now() - cIdx * 3600000).toISOString());
        }
      });
    });
  }
};

seed();

export default db;

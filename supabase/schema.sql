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

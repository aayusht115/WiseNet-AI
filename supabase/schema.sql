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
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  visibility TEXT DEFAULT 'show'
);

ALTER TABLE courses ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);

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

ALTER TABLE course_details ADD COLUMN IF NOT EXISTS feedback_trigger_session INTEGER DEFAULT 4;

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

ALTER TABLE course_materials ADD COLUMN IF NOT EXISTS source_file_name TEXT;
ALTER TABLE course_materials ADD COLUMN IF NOT EXISTS source_file_base64 TEXT;
ALTER TABLE course_materials ADD COLUMN IF NOT EXISTS is_assigned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE course_materials ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE course_materials ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;

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

ALTER TABLE course_sessions ADD COLUMN IF NOT EXISTS session_status TEXT DEFAULT 'scheduled' CHECK (session_status IN ('scheduled','completed','cancelled','rescheduled'));
ALTER TABLE course_sessions ADD COLUMN IF NOT EXISTS original_date DATE;

CREATE TABLE IF NOT EXISTS session_attendance (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES course_sessions(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('present','absent','late','excused')),
  note TEXT,
  marked_by INTEGER REFERENCES users(id),
  marked_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (session_id, student_id)
);

CREATE TABLE IF NOT EXISTS feedback_forms (
  id SERIAL PRIMARY KEY,
  course_id INTEGER REFERENCES courses(id),
  trigger_session_number INTEGER NOT NULL,
  form_type TEXT NOT NULL DEFAULT 'early_course',
  open_at TIMESTAMPTZ NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (course_id, trigger_session_number)
);

ALTER TABLE feedback_forms ADD COLUMN IF NOT EXISTS form_type TEXT NOT NULL DEFAULT 'early_course';

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

CREATE INDEX IF NOT EXISTS idx_feedback_forms_due_at ON feedback_forms (due_at);
CREATE INDEX IF NOT EXISTS idx_feedback_insights_course_viewed ON feedback_insights (course_id, viewed_at);

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

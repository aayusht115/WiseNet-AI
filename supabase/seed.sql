DO $$
DECLARE
  cat1_id INTEGER;
  cat2_id INTEGER;
  cat3_id INTEGER;
  course1_id INTEGER;
  section_general_id INTEGER;
  section_topic1_id INTEGER;
  section_topic2_id INTEGER;
  default_password TEXT := '$2b$10$8sDFfmQoREKdfwxpx3Hz6eE5xx5cXuGq854hg1jij6PLL7p9OKiwa';
BEGIN
  IF EXISTS (SELECT 1 FROM users LIMIT 1) THEN
    RETURN;
  END IF;

  INSERT INTO users (email, password, name, role) VALUES
    ('pgp25.aayush@spjimr.org', default_password, 'Aayush Thakur', 'student'),
    ('faculty@spjimr.org', default_password, 'Dr. Reed', 'faculty'),
    ('student1@spjimr.org', default_password, 'Sarah Miller', 'student'),
    ('student2@spjimr.org', default_password, 'John Doe', 'student'),
    ('student3@spjimr.org', default_password, 'Emily Chen', 'student'),
    ('student4@spjimr.org', default_password, 'Michael Brown', 'student'),
    ('student5@spjimr.org', default_password, 'Jessica Wilson', 'student');

  INSERT INTO categories (name) VALUES ('PGDM(BM)') RETURNING id INTO cat1_id;
  INSERT INTO categories (name, parent_id) VALUES ('PGDM(BM) 2025-2027', cat1_id) RETURNING id INTO cat2_id;
  INSERT INTO categories (name, parent_id) VALUES ('PGDM (BM) 2025-27 - Term I', cat2_id) RETURNING id INTO cat3_id;

  INSERT INTO courses (name, code, category_id, instructor, credits, start_date, end_date) VALUES
    ('Business Communication - I', 'OLS513-PBM', cat3_id, 'Dr. Reed', 1, '2025-06-01T00:00:00Z', '2026-05-31T23:59:59Z'),
    ('Business Policy & Strategy - I', 'STR501-PBM', cat3_id, 'Dr. Reed', 1, '2025-06-01T00:00:00Z', '2026-05-31T23:59:59Z'),
    ('Decision Analysis Simulation', 'STR503-PBM', cat3_id, 'Prof. Rajiv Agarwal', 1, '2025-06-01T00:00:00Z', '2026-05-31T23:59:59Z'),
    ('Financial Accounting and Statement Analysis', 'ACC505-PBM', cat3_id, 'Prof. Y', 1, '2025-06-01T00:00:00Z', '2026-05-31T23:59:59Z'),
    ('Managerial Economics - I', 'ECO502-PBM', cat3_id, 'Prof. Z', 1, '2025-06-01T00:00:00Z', '2026-05-31T23:59:59Z'),
    ('Corporate Finance', 'FIN501', cat3_id, 'Dr. Reed', 1, '2025-06-01T00:00:00Z', '2026-05-31T23:59:59Z'),
    ('Business in Digital Age', 'DIG501', cat3_id, 'Prof. Michael Chen', 1, '2025-06-01T00:00:00Z', '2026-05-31T23:59:59Z');

  SELECT id INTO course1_id FROM courses WHERE code = 'OLS513-PBM' LIMIT 1;

  INSERT INTO sections (course_id, title, "order") VALUES
    (course1_id, 'General', 0),
    (course1_id, 'Topic 1: Introduction', 1),
    (course1_id, 'Topic 2: Advanced Concepts', 2);

  SELECT id INTO section_general_id FROM sections WHERE course_id = course1_id AND title = 'General' LIMIT 1;
  SELECT id INTO section_topic1_id FROM sections WHERE course_id = course1_id AND title = 'Topic 1: Introduction' LIMIT 1;
  SELECT id INTO section_topic2_id FROM sections WHERE course_id = course1_id AND title = 'Topic 2: Advanced Concepts' LIMIT 1;

  INSERT INTO activities (course_id, section_id, title, type, due_date, content) VALUES
    (course1_id, section_general_id, 'Announcements', 'forum', NULL, 'Course announcements'),
    (course1_id, section_topic1_id, 'Introduction PDF', 'resource', NULL, 'Reading material'),
    (course1_id, section_topic1_id, 'Week 1 Quiz', 'quiz', '2026-02-26T23:59:00Z', 'Test your knowledge'),
    (course1_id, section_topic2_id, 'Final Assignment', 'assignment', '2026-03-15T23:59:00Z', 'Submit your project');

  INSERT INTO enrollments (user_id, course_id, progress, last_accessed)
  SELECT u.id, c.id, (random() * 100)::int, NOW() - ((c.id % 6) || ' hours')::interval
  FROM users u
  JOIN courses c ON c.code IN ('OLS513-PBM', 'STR501-PBM')
  WHERE u.role = 'student'
  ON CONFLICT DO NOTHING;

  INSERT INTO enrollments (user_id, course_id, progress, last_accessed)
  SELECT u.id, c.id, (random() * 100)::int, NOW() - ((c.id % 6) || ' hours')::interval
  FROM users u
  JOIN courses c ON c.code NOT IN ('OLS513-PBM', 'STR501-PBM')
  WHERE u.role = 'student' AND random() > 0.5
  ON CONFLICT DO NOTHING;
END $$;

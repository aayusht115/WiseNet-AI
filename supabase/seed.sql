DO $$
DECLARE
  cat1_id INTEGER;
  cat2_id INTEGER;
  cat3_id INTEGER;
  v_course_id INTEGER;
  section_info_id INTEGER;
  section_topic1_id INTEGER;
  section_topic2_id INTEGER;
  section_eval_id INTEGER;
  default_password TEXT := '$2b$10$8sDFfmQoREKdfwxpx3Hz6eE5xx5cXuGq854hg1jij6PLL7p9OKiwa';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users LIMIT 1) THEN
    INSERT INTO users (email, password, name, role) VALUES
      ('pgp25.aayush@spjimr.org', default_password, 'Aayush Thakur', 'student'),
      ('faculty@spjimr.org', default_password, 'Dr. Reed', 'faculty'),
      ('student1@spjimr.org', default_password, 'Sarah Miller', 'student'),
      ('student2@spjimr.org', default_password, 'John Doe', 'student'),
      ('student3@spjimr.org', default_password, 'Emily Chen', 'student');
  END IF;

  INSERT INTO categories (name) VALUES ('PGDM(BM)') RETURNING id INTO cat1_id;
  INSERT INTO categories (name, parent_id) VALUES ('PGDM(BM) 2025-2027', cat1_id) RETURNING id INTO cat2_id;
  INSERT INTO categories (name, parent_id) VALUES ('PGDM (BM) 2025-27 - Term II', cat2_id) RETURNING id INTO cat3_id;

  INSERT INTO courses (name, code, category_id, instructor, credits, description, start_date, end_date, visibility)
  VALUES (
    'Business in Digital Age',
    'DIG501',
    cat3_id,
    'Prof. Ashish Desai, Prof. Abhishek Jha, Prof. Dhruven Zalal',
    2,
    'Core concepts, systems and frameworks for digital transformation in B2B and B2C contexts.',
    '2025-06-01T00:00:00Z',
    '2026-05-31T23:59:59Z',
    'show'
  )
  RETURNING id INTO v_course_id;

  INSERT INTO sections (course_id, title, "order") VALUES
    (v_course_id, 'Course Information', 0),
    (v_course_id, 'Topic 1', 1),
    (v_course_id, 'Topic 2', 2),
    (v_course_id, 'Evaluations and Submissions', 3);

  SELECT id INTO section_info_id FROM sections WHERE course_id = v_course_id AND title = 'Course Information' LIMIT 1;
  SELECT id INTO section_topic1_id FROM sections WHERE course_id = v_course_id AND title = 'Topic 1' LIMIT 1;
  SELECT id INTO section_topic2_id FROM sections WHERE course_id = v_course_id AND title = 'Topic 2' LIMIT 1;
  SELECT id INTO section_eval_id FROM sections WHERE course_id = v_course_id AND title = 'Evaluations and Submissions' LIMIT 1;

  INSERT INTO activities (course_id, section_id, title, type, due_date, description, content) VALUES
    (v_course_id, section_info_id, 'Announcements', 'forum', NULL, 'Faculty announcements and session updates.', 'Use this discussion to share class-level announcements.');

  INSERT INTO course_sessions (course_id, session_number, title, session_date, start_time, end_time, mode) VALUES
    (v_course_id, 1, 'Session 1: Digital Strategy Foundations', CURRENT_DATE + INTERVAL '1 day', '09:00', '10:30', 'classroom'),
    (v_course_id, 2, 'Session 2: Platforms and Ecosystems', CURRENT_DATE + INTERVAL '3 day', '09:00', '10:30', 'classroom'),
    (v_course_id, 3, 'Session 3: Data and AI in Business', CURRENT_DATE + INTERVAL '5 day', '09:00', '10:30', 'classroom'),
    (v_course_id, 4, 'Session 4: India Stack and DPI', CURRENT_DATE + INTERVAL '7 day', '09:00', '10:30', 'classroom'),
    (v_course_id, 5, 'Session 5: Payments and Trust', CURRENT_DATE + INTERVAL '9 day', '09:00', '10:30', 'classroom'),
    (v_course_id, 6, 'Session 6: Scalable Digital Operations', CURRENT_DATE + INTERVAL '11 day', '09:00', '10:30', 'classroom');

  INSERT INTO course_details (course_id, faculty_info, teaching_assistant, credits, learning_outcomes, evaluation_components)
  VALUES (
    v_course_id,
    'Prof. Ashish Desai, Prof. Abhishek Jha, Prof. Dhruven Zalal',
    'Khushbu Gandhi',
    2,
    '[
      "Demonstrate a comprehensive understanding of key technology concepts, frameworks, and enterprise systems.",
      "Apply these concepts and systems to drive digital transformation initiatives across B2B and B2C contexts.",
      "Critically assess the implications of India Stack, digital public infrastructure, payment technologies, AI, and analytics for creating contemporary, innovative, and competitive business solutions.",
      "Integrate course learnings to address disruptive growth opportunities, ethical considerations, societal impacts, and sustainability challenges in technology-driven business environments."
    ]'::jsonb,
    '[
      {"sr_no":1,"component":"Class Participation (In class - Surprise Quizzes)","code":"INF501-PBM-04-I01","weightage_percent":30,"timeline":"All","scheduled_date":"","clos_mapped":"All"},
      {"sr_no":2,"component":"Group Exam","code":"INF501-PBM-04-G01","weightage_percent":40,"timeline":"Session 1","scheduled_date":"Lecture 17-18","clos_mapped":"All"},
      {"sr_no":3,"component":"End Term","code":"INF501-PBM-04-I02","weightage_percent":30,"timeline":"Post Session 18","scheduled_date":"Exam Week","clos_mapped":"All"}
    ]'::jsonb
  );

  INSERT INTO enrollments (user_id, course_id, progress, last_accessed)
  SELECT id, v_course_id, 0, NOW()
  FROM users
  WHERE role = 'student'
  ON CONFLICT DO NOTHING;
END $$;

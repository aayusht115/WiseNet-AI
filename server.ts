import "./env";
import express from "express";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { execute, initDb, query, queryOne } from "./db";

const isProduction = process.env.NODE_ENV === "production";
const JWT_SECRET = process.env.JWT_SECRET || "wisenet_secret_key";
const PORT = Number(process.env.PORT || 3000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type SummaryPayload = {
  title: string;
  summary: string;
  keyTakeaways: string[];
  furtherReading: string[];
};

type QuizQuestionPayload = {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
};

const STOPWORDS = new Set([
  "about",
  "above",
  "after",
  "again",
  "against",
  "because",
  "before",
  "between",
  "could",
  "doing",
  "during",
  "their",
  "there",
  "these",
  "those",
  "through",
  "under",
  "where",
  "which",
  "while",
  "would",
  "should",
  "using",
  "towards",
  "digital",
  "business",
]);

const DEFAULT_FEEDBACK_QUESTIONS = [
  {
    question_order: 1,
    question_text: "How clear was the session content?",
    question_type: "mcq",
    options: ["Very unclear", "Unclear", "Neutral", "Clear", "Very clear"],
  },
  {
    question_order: 2,
    question_text: "How relevant was this session to your learning goals?",
    question_type: "mcq",
    options: ["Not relevant", "Slightly relevant", "Moderately relevant", "Relevant", "Highly relevant"],
  },
  {
    question_order: 3,
    question_text: "How useful was the reading material and quiz?",
    question_type: "mcq",
    options: ["Not useful", "Slightly useful", "Moderately useful", "Useful", "Very useful"],
  },
  {
    question_order: 4,
    question_text: "How manageable was the workload pace so far?",
    question_type: "mcq",
    options: ["Too heavy", "Heavy", "Balanced", "Light", "Too light"],
  },
  {
    question_order: 5,
    question_text: "How confident are you in applying concepts from the first four sessions?",
    question_type: "mcq",
    options: ["Not confident", "Slightly confident", "Moderately confident", "Confident", "Very confident"],
  },
  {
    question_order: 6,
    question_text: "What is working well in this course so far?",
    question_type: "text",
    options: [],
  },
  {
    question_order: 7,
    question_text: "What should the faculty improve for upcoming sessions?",
    question_type: "text",
    options: [],
  },
];

function getCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: (isProduction ? "none" : "lax") as "none" | "lax",
  };
}

function safeJson(value: any, fallback: any) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeEvaluationComponents(value: any) {
  const rows = safeJson(value, []);
  if (!Array.isArray(rows)) return [];
  return rows.map((row: any, index: number) => {
    const rawWeight = row?.weightage_percent ?? row?.weightage ?? 0;
    const parsedWeight =
      typeof rawWeight === "number"
        ? rawWeight
        : Number(String(rawWeight).replace("%", "").trim()) || 0;
    return {
      sr_no: Number(row?.sr_no ?? index + 1),
      component: String(row?.component || ""),
      code: String(row?.code || ""),
      weightage_percent: parsedWeight,
      timeline: String(row?.timeline || ""),
      scheduled_date: String(row?.scheduled_date || ""),
      clos_mapped: String(row?.clos_mapped || ""),
    };
  });
}

function extractLikelyPdfText(sourceFileBase64: string) {
  try {
    const bytes = Buffer.from(sourceFileBase64, "base64");
    const binary = bytes.toString("latin1");
    const textChunks =
      binary
        .match(/\(([^)]{8,})\)/g)
        ?.map((chunk) =>
          chunk
            .slice(1, -1)
            .replace(/\\\)/g, ")")
            .replace(/\\\(/g, "(")
            .replace(/\\n/g, " ")
            .replace(/\\r/g, " ")
            .replace(/\\t/g, " ")
        )
        .filter((chunk) => /[A-Za-z]/.test(chunk)) || [];
    return textChunks.join(" ").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

function extractPdfTextWithPython(sourceFileBase64: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const pythonBin = process.env.PYTHON_BIN || "python3";
    const scriptPath = path.resolve(__dirname, "python", "pdf_text_extractor.py");
    const child = spawn(pythonBin, [scriptPath], {
      env: { ...process.env, PYTHONWARNINGS: process.env.PYTHONWARNINGS || "ignore" },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => reject(error));

    child.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(stderr.trim() || `PDF extractor exited with status ${code}`));
      }
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.error) return reject(new Error(parsed.error));
        resolve(String(parsed.text || ""));
      } catch {
        reject(new Error("Failed to parse PDF extractor output"));
      }
    });

    child.stdin.write(JSON.stringify({ fileBase64: sourceFileBase64 }));
    child.stdin.end();
  });
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function splitSentences(text: string) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40);
}

function extractKeywords(text: string) {
  const words = text.match(/[A-Za-z][A-Za-z'-]{4,}/g) || [];
  return [...new Set(words.map((w) => w.trim()))].filter(
    (w) => !STOPWORDS.has(w.toLowerCase())
  );
}

function buildFallbackSummaryPayload(title: string, content: string): SummaryPayload {
  const sentences = splitSentences(content).filter((s) => s.length > 20);
  const summary = sentences.slice(0, 3).join(" ").trim() || content.slice(0, 500).trim();
  const keyTakeaways = sentences.slice(0, 5);
  return {
    title,
    summary,
    keyTakeaways: keyTakeaways.length > 0 ? keyTakeaways : [summary || "No summary available."],
    furtherReading: [
      `Review class notes related to ${title}.`,
      `Read one case study connected to ${title}.`,
      `List 3 practical applications from this reading.`,
    ],
  };
}

function makeQuizFromContent(content: string): QuizQuestionPayload[] {
  const sourceText = content.replace(/\s+/g, " ").trim();
  const keywords = extractKeywords(sourceText).slice(0, 24);
  const themes = keywords.slice(0, 8);
  const conceptA = themes[0] || "the core framework";
  const conceptB = themes[1] || "context";
  const conceptC = themes[2] || "execution";
  const conceptD = themes[3] || "measurement";

  const conceptualQuestions: QuizQuestionPayload[] = [
    {
      question: `Which interpretation is most aligned with the reading's central idea around ${conceptA}?`,
      options: [
        `Use ${conceptA} to make structured decisions with trade-off awareness.`,
        `Treat ${conceptA} as a checklist without context.`,
        `Ignore ${conceptA} when choices become uncertain.`,
        `Use ${conceptA} only for post-mortem reporting.`,
      ],
      correctAnswer: 0,
      explanation: "The reading emphasizes applying core concepts in context-aware decision making.",
    },
    {
      question: `In a new business scenario, what is the best first step using ideas from the reading?`,
      options: [
        `Map the situation to ${conceptB} and identify relevant constraints before action.`,
        "Start implementation immediately and validate assumptions later.",
        "Pick the lowest-effort option without comparing alternatives.",
        "Copy the previous case solution unchanged.",
      ],
      correctAnswer: 0,
      explanation: "The reading prioritizes understanding context and constraints before execution.",
    },
    {
      question: `What risk is most likely if ${conceptC} is applied without stakeholder alignment?`,
      options: [
        "Good local optimization but weak end-to-end outcomes.",
        "Guaranteed faster adoption in every setting.",
        "Automatic reduction in long-term uncertainty.",
        "No meaningful impact on implementation quality.",
      ],
      correctAnswer: 0,
      explanation: "Without alignment, isolated improvements often fail at system level.",
    },
    {
      question: `Which metric strategy best reflects the reading's approach to ${conceptD}?`,
      options: [
        "Use a balanced set of outcome and process indicators.",
        "Track only a single lagging metric.",
        "Avoid metrics until after rollout.",
        "Use vanity metrics to improve perceived performance.",
      ],
      correctAnswer: 0,
      explanation: "The reading supports balanced measurement tied to outcomes and execution quality.",
    },
    {
      question: "Which action shows deep understanding rather than factual recall from the reading?",
      options: [
        "Adapting principles to a new case and justifying trade-offs.",
        "Repeating terminology without applying it.",
        "Memorizing numeric details from one example.",
        "Using one answer template for all case contexts.",
      ],
      correctAnswer: 0,
      explanation: "Concept mastery is demonstrated by transfer and justified adaptation.",
    },
  ];

  return conceptualQuestions;
}

function summarizeWithPegasus(title: string, content: string): Promise<SummaryPayload> {
  return new Promise((resolve, reject) => {
    const pythonBin = process.env.PYTHON_BIN || "python3";
    const scriptPath = path.resolve(__dirname, "python", "pegasus_summarizer.py");
    const child = spawn(pythonBin, [scriptPath], {
      env: { ...process.env, PYTHONWARNINGS: process.env.PYTHONWARNINGS || "ignore" },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => reject(error));

    child.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(stderr.trim() || `Pegasus process exited with status ${code}`));
      }
      try {
        const jsonStart = stdout.indexOf("{");
        const candidate = jsonStart >= 0 ? stdout.slice(jsonStart) : stdout;
        const parsed = JSON.parse(candidate);
        if (parsed.error) return reject(new Error(parsed.error));
        resolve(parsed as SummaryPayload);
      } catch {
        reject(new Error("Failed to parse Pegasus output"));
      }
    });

    child.stdin.write(JSON.stringify({ title, content }));
    child.stdin.end();
  });
}

async function canManageCourse(user: any, courseId: number) {
  if (user.role !== "faculty") return false;
  const owned = await queryOne(
    "SELECT 1 FROM courses WHERE id = $1 AND created_by = $2",
    [courseId, user.id]
  );
  return Boolean(owned);
}

async function canAccessCourse(user: any, courseId: number) {
  if (user.role === "faculty") return canManageCourse(user, courseId);
  const enrolled = await queryOne(
    "SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2",
    [user.id, courseId]
  );
  return Boolean(enrolled);
}

async function ensureCourseScaffold(courseId: number, facultyInfo: string | null = null) {
  const sectionNames = ["Course Information", "Topic 1", "Topic 2", "Evaluations and Submissions"];
  for (const [idx, sectionName] of sectionNames.entries()) {
    const section = await queryOne<{ id: number }>(
      'SELECT id FROM sections WHERE course_id = $1 AND title = $2 LIMIT 1',
      [courseId, sectionName]
    );
    if (section?.id) {
      await execute('UPDATE sections SET "order" = $1 WHERE id = $2', [idx, section.id]);
    } else {
      await execute('INSERT INTO sections (course_id, title, "order") VALUES ($1, $2, $3)', [
        courseId,
        sectionName,
        idx,
      ]);
    }
  }

  const courseInfoSection = await queryOne<{ id: number }>(
    'SELECT id FROM sections WHERE course_id = $1 AND title = $2 LIMIT 1',
    [courseId, "Course Information"]
  );
  if (courseInfoSection?.id) {
    const announcement = await queryOne<{ id: number }>(
      "SELECT id FROM activities WHERE course_id = $1 AND title = 'Announcements' LIMIT 1",
      [courseId]
    );
    if (!announcement) {
      await execute(
        `
          INSERT INTO activities (section_id, course_id, title, type, due_date, description, content)
          VALUES ($1, $2, $3, $4, NULL, $5, $6)
        `,
        [
          courseInfoSection.id,
          courseId,
          "Announcements",
          "forum",
          "Faculty announcements and session updates.",
          "Use this discussion to share class-level announcements.",
        ]
      );
    }
  }

  await execute(
    `
      INSERT INTO course_details (course_id, faculty_info, teaching_assistant, credits, learning_outcomes, evaluation_components)
      VALUES ($1, $2, NULL, 2, '[]'::jsonb, '[]'::jsonb)
      ON CONFLICT (course_id)
      DO NOTHING
    `,
    [courseId, facultyInfo]
  );
}

async function ensureFeedbackFormForCourse(courseId: number) {
  const fourthSession = await queryOne<any>(
    `
      SELECT session_number, session_date
      FROM course_sessions
      WHERE course_id = $1 AND session_number = 4
      LIMIT 1
    `,
    [courseId]
  );
  if (!fourthSession) return null;

  let form = await queryOne<any>(
    `
      SELECT id, course_id, trigger_session_number, open_at, due_at
      FROM feedback_forms
      WHERE course_id = $1 AND trigger_session_number = 4
      LIMIT 1
    `,
    [courseId]
  );

  if (!form) {
    form = await queryOne<any>(
      `
        INSERT INTO feedback_forms (course_id, trigger_session_number, open_at, due_at)
        VALUES ($1, 4, ($2::date)::timestamptz, (($2::date)::timestamptz + INTERVAL '2 day'))
        RETURNING id, course_id, trigger_session_number, open_at, due_at
      `,
      [courseId, fourthSession.session_date]
    );
  }

  const existingQuestions = await queryOne<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM feedback_questions WHERE form_id = $1",
    [form?.id || 0]
  );

  if ((existingQuestions?.count ?? 0) === 0 && form?.id) {
    for (const question of DEFAULT_FEEDBACK_QUESTIONS) {
      await execute(
        `
          INSERT INTO feedback_questions (form_id, question_order, question_text, question_type, options, required)
          VALUES ($1, $2, $3, $4, $5::jsonb, TRUE)
        `,
        [
          form.id,
          question.question_order,
          question.question_text,
          question.question_type,
          JSON.stringify(question.options || []),
        ]
      );
    }
  }

  return form;
}

async function startServer() {
  await initDb();
  const app = express();

  app.use(express.json({ limit: "25mb" }));
  app.use(cookieParser());

  const authenticate = (req: any, res: any, next: any) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch {
      res.status(401).json({ error: "Invalid token" });
    }
  };

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    const user = await queryOne<any>("SELECT * FROM users WHERE email = $1", [email]);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      JWT_SECRET,
      { expiresIn: "1d" }
    );
    res.cookie("token", token, getCookieOptions());
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie("token", getCookieOptions());
    res.json({ success: true });
  });

  app.get("/api/auth/me", (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      res.json(decoded);
    } catch {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  app.post("/api/ai/summarize", authenticate, async (req, res) => {
    try {
      const title = String(req.body?.title || "Untitled Reading");
      const content = String(req.body?.content || "");
      if (!content.trim()) return res.status(400).json({ error: "Content is required" });
      let result: SummaryPayload;
      try {
        result = await summarizeWithPegasus(title, content);
      } catch (error) {
        console.error("Pegasus summarize failed, using fallback summary", error);
        result = buildFallbackSummaryPayload(title, content);
      }
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to summarize content" });
    }
  });

  app.get("/api/dashboard/timeline", authenticate, async (req: any, res) => {
    const activities =
      req.user.role === "faculty"
        ? await query(
            `
              SELECT a.*, c.name as course_name, c.code as course_code
              FROM activities a
              JOIN courses c ON a.course_id = c.id
              ORDER BY a.due_date ASC NULLS LAST
            `
          )
        : await query(
            `
              SELECT a.*, c.name as course_name, c.code as course_code
              FROM activities a
              JOIN courses c ON a.course_id = c.id
              JOIN enrollments e ON c.id = e.course_id
              WHERE e.user_id = $1
              ORDER BY a.due_date ASC NULLS LAST
            `,
            [req.user.id]
          );
    res.json(activities);
  });

  app.get("/api/courses/overview", authenticate, async (req: any, res) => {
    const courses =
      req.user.role === "faculty"
        ? await query(
            `
              SELECT c.*, 0 as progress
              FROM courses c
              WHERE c.created_by = $1
              ORDER BY c.name ASC
            `,
            [req.user.id]
          )
        : await query(
            `
              SELECT c.*, e.progress
              FROM courses c
              JOIN enrollments e ON c.id = e.course_id
              WHERE e.user_id = $1
              ORDER BY c.name ASC
            `,
            [req.user.id]
          );
    res.json(courses);
  });

  app.get("/api/courses", authenticate, async (req: any, res) => {
    const courses =
      req.user.role === "faculty"
        ? await query("SELECT * FROM courses WHERE created_by = $1 ORDER BY name ASC", [req.user.id])
        : await query(
            `
              SELECT c.*
              FROM courses c
              JOIN enrollments e ON e.course_id = c.id
              WHERE e.user_id = $1
              ORDER BY c.name ASC
            `,
            [req.user.id]
          );
    res.json(courses);
  });

  app.get("/api/courses/catalog", authenticate, async (req: any, res) => {
    if (req.user.role !== "student") return res.status(403).json({ error: "Forbidden" });

    const courses = await query(
      `
        SELECT
          c.*,
          COALESCE(e.progress, 0) AS progress,
          CASE WHEN e.user_id IS NULL THEN FALSE ELSE TRUE END AS is_enrolled
        FROM courses c
        LEFT JOIN enrollments e
          ON e.course_id = c.id
         AND e.user_id = $1
        WHERE c.visibility = 'show'
        ORDER BY c.name ASC
      `,
      [req.user.id]
    );
    res.json(courses);
  });

  app.post("/api/courses/:id/enroll-self", authenticate, async (req: any, res) => {
    if (req.user.role !== "student") return res.status(403).json({ error: "Forbidden" });
    const courseId = Number(req.params.id);
    const course = await queryOne<{ id: number }>(
      "SELECT id FROM courses WHERE id = $1 AND visibility = 'show'",
      [courseId]
    );
    if (!course) return res.status(404).json({ error: "Course not found" });

    await execute(
      `
        INSERT INTO enrollments (user_id, course_id, progress, last_accessed)
        VALUES ($1, $2, 0, NOW())
        ON CONFLICT (user_id, course_id)
        DO NOTHING
      `,
      [req.user.id, courseId]
    );
    res.json({ success: true });
  });

  app.post("/api/courses", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    const { name, code, description, start_date, end_date, visibility, instructor } = req.body || {};
    if (!String(name || "").trim() || !String(code || "").trim()) {
      return res.status(400).json({ error: "name and code are required" });
    }

    const existingCode = await queryOne(
      "SELECT id FROM courses WHERE LOWER(code) = LOWER($1) AND created_by = $2 LIMIT 1",
      [String(code).trim(), req.user.id]
    );
    if (existingCode) {
      return res.status(400).json({ error: "You already have a course with this code" });
    }

    const created = await queryOne<{ id: number }>(
      `
        INSERT INTO courses
          (name, code, description, start_date, end_date, visibility, instructor, created_by, credits)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, 2)
        RETURNING id
      `,
      [
        String(name).trim(),
        String(code).trim(),
        description || null,
        start_date || null,
        end_date || null,
        visibility === "hide" ? "hide" : "show",
        String(instructor || req.user.name || "").trim() || "Faculty",
        req.user.id,
      ]
    );
    if (!created?.id) return res.status(500).json({ error: "Failed to create course" });

    await ensureCourseScaffold(created.id, String(instructor || req.user.name || "").trim() || null);
    res.status(201).json({ success: true, id: created.id });
  });

  app.get("/api/courses/:id", authenticate, async (req: any, res) => {
    const courseId = Number(req.params.id);
    if (!(await canAccessCourse(req.user, courseId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const course = await queryOne("SELECT * FROM courses WHERE id = $1", [courseId]);
    res.json(course);
  });

  app.put("/api/courses/:id", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    const courseId = Number(req.params.id);
    if (!(await canManageCourse(req.user, courseId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { name, code, description, start_date, end_date, visibility, instructor } = req.body;
    await execute(
      `
        UPDATE courses
        SET name = $1, code = $2, description = $3, start_date = $4, end_date = $5, visibility = $6, instructor = $7
        WHERE id = $8
      `,
      [name, code, description, start_date, end_date, visibility, instructor || null, courseId]
    );
    res.json({ success: true });
  });

  app.get("/api/courses/:id/sections", authenticate, async (req: any, res) => {
    const courseId = Number(req.params.id);
    if (!(await canAccessCourse(req.user, courseId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const sections = await query(
      'SELECT * FROM sections WHERE course_id = $1 ORDER BY "order" ASC',
      [courseId]
    );
    res.json(sections);
  });

  app.get("/api/courses/:id/sessions", authenticate, async (req: any, res) => {
    const courseId = Number(req.params.id);
    if (!(await canAccessCourse(req.user, courseId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const sessions = await query<any>(
      `
        SELECT id, course_id, session_number, title, session_date, start_time, end_time, mode
        FROM course_sessions
        WHERE course_id = $1
        ORDER BY session_number ASC, session_date ASC
      `,
      [courseId]
    );
    res.json(sessions);
  });

  app.post("/api/courses/:id/sessions", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    const courseId = Number(req.params.id);
    if (!(await canManageCourse(req.user, courseId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { title, session_date, start_time, end_time, mode } = req.body || {};
    if (!title || !session_date) {
      return res.status(400).json({ error: "title and session_date are required" });
    }
    const maxSession = await queryOne<{ max_no: number }>(
      "SELECT COALESCE(MAX(session_number), 0)::int AS max_no FROM course_sessions WHERE course_id = $1",
      [courseId]
    );
    const nextSession = (maxSession?.max_no ?? 0) + 1;

    await execute(
      `
        INSERT INTO course_sessions
          (course_id, session_number, title, session_date, start_time, end_time, mode, created_by)
        VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8)
      `,
      [
        courseId,
        nextSession,
        String(title),
        String(session_date),
        start_time ? String(start_time) : null,
        end_time ? String(end_time) : null,
        mode ? String(mode) : "classroom",
        req.user.id,
      ]
    );

    await ensureFeedbackFormForCourse(courseId);
    const sessions = await query<any>(
      `
        SELECT id, course_id, session_number, title, session_date, start_time, end_time, mode
        FROM course_sessions
        WHERE course_id = $1
        ORDER BY session_number ASC, session_date ASC
      `,
      [courseId]
    );
    res.json({ success: true, sessions });
  });

  app.get("/api/courses/:id/feedback/active", authenticate, async (req: any, res) => {
    if (req.user.role !== "student") return res.status(403).json({ error: "Forbidden" });
    const courseId = Number(req.params.id);
    if (!(await canAccessCourse(req.user, courseId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await ensureFeedbackFormForCourse(courseId);
    const form = await queryOne<any>(
      `
        SELECT id, due_at
        FROM feedback_forms
        WHERE course_id = $1
          AND NOW() >= open_at
          AND NOW() <= due_at
        ORDER BY due_at DESC
        LIMIT 1
      `,
      [courseId]
    );

    if (!form) return res.json(null);

    const submitted = await queryOne<any>(
      "SELECT 1 FROM feedback_submissions WHERE form_id = $1 AND user_id = $2",
      [form.id, req.user.id]
    );
    const questions = await query<any>(
      `
        SELECT id, question_order, question_text, question_type, options
        FROM feedback_questions
        WHERE form_id = $1
        ORDER BY question_order ASC
      `,
      [form.id]
    );

    res.json({
      form_id: form.id,
      due_at: form.due_at,
      already_submitted: Boolean(submitted),
      questions: questions.map((q) => ({
        id: q.id,
        question_order: q.question_order,
        question_text: q.question_text,
        question_type: q.question_type,
        options: safeJson(q.options, []),
      })),
    });
  });

  app.post("/api/courses/:id/feedback/submit", authenticate, async (req: any, res) => {
    if (req.user.role !== "student") return res.status(403).json({ error: "Forbidden" });
    const courseId = Number(req.params.id);
    if (!(await canAccessCourse(req.user, courseId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const formId = Number(req.body?.form_id);
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    if (!formId || answers.length === 0) {
      return res.status(400).json({ error: "form_id and answers are required" });
    }

    const form = await queryOne<any>(
      "SELECT id FROM feedback_forms WHERE id = $1 AND course_id = $2 AND NOW() >= open_at AND NOW() <= due_at",
      [formId, courseId]
    );
    if (!form) return res.status(400).json({ error: "Feedback form is not active" });

    try {
      await execute(
        `
          INSERT INTO feedback_submissions (form_id, course_id, user_id, answers)
          VALUES ($1, $2, $3, $4::jsonb)
        `,
        [formId, courseId, req.user.id, JSON.stringify(answers)]
      );
      res.json({ success: true });
    } catch {
      res.status(400).json({ error: "Feedback already submitted" });
    }
  });

  app.get("/api/courses/:id/feedback/analytics", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    const courseId = Number(req.params.id);
    if (!(await canManageCourse(req.user, courseId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    await ensureFeedbackFormForCourse(courseId);

    const forms = await query<any>(
      `
        SELECT id, trigger_session_number, open_at, due_at
        FROM feedback_forms
        WHERE course_id = $1
        ORDER BY trigger_session_number DESC
      `,
      [courseId]
    );
    if (forms.length === 0) return res.json({ forms: [] });

    const responseForms = [];
    for (const form of forms) {
      const questions = await query<any>(
        `
          SELECT id, question_order, question_text, question_type, options
          FROM feedback_questions
          WHERE form_id = $1
          ORDER BY question_order ASC
        `,
        [form.id]
      );
      const submissions = await query<any>(
        `
          SELECT answers
          FROM feedback_submissions
          WHERE form_id = $1
        `,
        [form.id]
      );

      const parsedAnswers = submissions.map((s) => safeJson(s.answers, []));
      const metrics = questions.map((q) => {
        if (q.question_type === "text") {
          const comments = parsedAnswers
            .flatMap((answerSet: any[]) =>
              answerSet.filter((a) => Number(a.question_id) === Number(q.id)).map((a) => String(a.answer_text || "").trim())
            )
            .filter(Boolean)
            .slice(0, 15);
          return {
            question_id: q.id,
            question_text: q.question_text,
            question_type: "text",
            comments,
          };
        }

        const choices = parsedAnswers
          .flatMap((answerSet: any[]) =>
            answerSet
              .filter((a) => Number(a.question_id) === Number(q.id))
              .map((a) => Number(a.choice_value))
              .filter((n) => Number.isFinite(n))
          );
        const average =
          choices.length > 0
            ? Number((choices.reduce((sum, value) => sum + value, 0) / choices.length).toFixed(2))
            : 0;
        return {
          question_id: q.id,
          question_text: q.question_text,
          question_type: "mcq",
          options: safeJson(q.options, []),
          average,
          responses: choices.length,
        };
      });

      responseForms.push({
        form_id: form.id,
        trigger_session_number: form.trigger_session_number,
        open_at: form.open_at,
        due_at: form.due_at,
        submissions: submissions.length,
        metrics,
      });
    }

    res.json({ forms: responseForms });
  });

  app.get("/api/course-details/:id", authenticate, async (req: any, res) => {
    const courseId = Number(req.params.id);
    if (!(await canAccessCourse(req.user, courseId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await ensureCourseScaffold(courseId);

    const course = await queryOne<any>(
      `
        SELECT c.*, COALESCE(e.progress, 0) AS progress
        FROM courses c
        LEFT JOIN enrollments e ON e.course_id = c.id AND e.user_id = $2
        WHERE c.id = $1
      `,
      [courseId, req.user.id]
    );
    const details = await queryOne<any>(
      "SELECT * FROM course_details WHERE course_id = $1",
      [courseId]
    );
    const sections = await query<any>(
      'SELECT * FROM sections WHERE course_id = $1 ORDER BY "order" ASC',
      [courseId]
    );
    const materials = await query<any>(
      `
        SELECT
          m.id,
          m.course_id,
          m.section_id,
          m.title,
          m.source_type,
          m.source_url,
          m.source_file_name,
          m.content,
          m.summary,
          m.key_takeaways,
          m.is_assigned,
          m.assigned_at,
          m.created_at,
          s.title AS section_title,
          (
            SELECT COUNT(*)
            FROM material_quiz_questions q
            WHERE q.material_id = m.id
          )::int AS quiz_count,
          la.score AS latest_score,
          la.total_questions AS latest_total
        FROM course_materials m
        JOIN sections s ON s.id = m.section_id
        LEFT JOIN LATERAL (
          SELECT score, total_questions
          FROM material_quiz_attempts a
          WHERE a.material_id = m.id AND a.user_id = $2
          ORDER BY a.submitted_at DESC
          LIMIT 1
        ) la ON true
        WHERE m.course_id = $1
          AND ($3::boolean OR m.is_assigned = TRUE)
        ORDER BY s."order" ASC, m.created_at ASC
      `,
      [courseId, req.user.id, req.user.role === "faculty"]
    );

    res.json({
      course,
      details: {
        ...details,
        learning_outcomes: safeJson(details?.learning_outcomes, []),
        evaluation_components: normalizeEvaluationComponents(details?.evaluation_components),
      },
      sections,
      materials: materials.map((m) => ({
        ...m,
        summary: req.user.role === "faculty" ? null : m.summary,
        key_takeaways: safeJson(m.key_takeaways, []),
      })),
    });
  });

  app.put("/api/course-details/:id", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    const courseId = Number(req.params.id);
    if (!(await canManageCourse(req.user, courseId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { faculty_info, teaching_assistant, credits, learning_outcomes, evaluation_components } =
      req.body || {};
    const normalizedEvaluation = normalizeEvaluationComponents(evaluation_components);

    await execute(
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
        courseId,
        faculty_info || null,
        teaching_assistant || null,
        Number(credits || 2),
        JSON.stringify(learning_outcomes || []),
        JSON.stringify(normalizedEvaluation),
      ]
    );
    res.json({ success: true });
  });

  app.get("/api/courses/:id/materials", authenticate, async (req: any, res) => {
    const courseId = Number(req.params.id);
    if (!(await canAccessCourse(req.user, courseId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const materials = await query<any>(
      `
        SELECT
          m.id,
          m.course_id,
          m.section_id,
          m.title,
          m.source_type,
          m.source_url,
          m.source_file_name,
          m.content,
          m.summary,
          m.key_takeaways,
          m.is_assigned,
          m.assigned_at,
          m.created_at,
          s.title AS section_title,
          (
            SELECT COUNT(*)
            FROM material_quiz_questions q
            WHERE q.material_id = m.id
          )::int AS quiz_count
        FROM course_materials m
        JOIN sections s ON s.id = m.section_id
        WHERE m.course_id = $1
          AND ($2::boolean OR m.is_assigned = TRUE)
        ORDER BY s."order" ASC, m.created_at ASC
      `,
      [courseId, req.user.role === "faculty"]
    );
    res.json(
      materials.map((m) => ({
        ...m,
        summary: req.user.role === "faculty" ? null : m.summary,
        key_takeaways: safeJson(m.key_takeaways, []),
      }))
    );
  });

  app.post("/api/courses/:id/materials", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });

    const courseId = Number(req.params.id);
    if (!(await canManageCourse(req.user, courseId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const {
      section_id,
      title,
      source_type,
      source_url,
      source_file_name,
      source_file_base64,
      content,
      is_assigned,
    } = req.body || {};
    if (!section_id || !title || !source_type) {
      return res.status(400).json({ error: "section_id, title and source_type are required" });
    }
    if (!["pdf", "link"].includes(source_type)) {
      return res.status(400).json({ error: "source_type must be pdf or link" });
    }
    if (source_type === "link" && !source_url) {
      return res.status(400).json({ error: "source_url is required for link source type" });
    }
    if (source_type === "pdf" && !source_file_base64 && !source_url) {
      return res.status(400).json({ error: "Upload a PDF file or provide a PDF URL" });
    }

    const section = await queryOne(
      "SELECT id FROM sections WHERE id = $1 AND course_id = $2",
      [Number(section_id), courseId]
    );
    if (!section) return res.status(400).json({ error: "Invalid section" });

    let materialContent = String(content || "").trim();
    if (!materialContent && source_type === "pdf" && source_file_base64) {
      try {
        materialContent = await extractPdfTextWithPython(String(source_file_base64));
      } catch (error) {
        console.error("Python PDF extraction failed, using fallback extractor", error);
        materialContent = extractLikelyPdfText(String(source_file_base64));
      }
    }
    if (!materialContent) {
      if (source_type === "link") {
        return res.status(400).json({
          error: "For web links, paste the article content so summary and quiz can be generated.",
        });
      }
      return res.status(400).json({
        error:
          "Could not read text from the PDF. Upload a text-based PDF or provide content text so summary/quiz can be generated.",
      });
    }

    let summary: SummaryPayload;
    try {
      summary = await summarizeWithPegasus(String(title), materialContent);
    } catch (error) {
      console.error("Pegasus summarize failed during material upload, using fallback summary", error);
      summary = buildFallbackSummaryPayload(String(title), materialContent);
    }
    const quizSource = `${summary.summary || ""}. ${(summary.keyTakeaways || []).join(". ")}`.trim();
    const quiz = makeQuizFromContent(quizSource || materialContent);
    const assigned = Boolean(is_assigned);

    const material = await queryOne<{ id: number }>(
      `
        INSERT INTO course_materials
          (
            course_id,
            section_id,
            title,
            source_type,
            source_url,
            source_file_name,
            source_file_base64,
            content,
            summary,
            key_takeaways,
            is_assigned,
            assigned_at,
            created_by
          )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, CASE WHEN $11 THEN NOW() ELSE NULL END, $12)
        RETURNING id
      `,
      [
        courseId,
        Number(section_id),
        String(title),
        String(source_type),
        source_url ? String(source_url) : null,
        source_file_name ? String(source_file_name) : null,
        source_file_base64 ? String(source_file_base64) : null,
        materialContent,
        summary.summary,
        JSON.stringify(summary.keyTakeaways || []),
        assigned,
        req.user.id,
      ]
    );

    for (const [idx, q] of quiz.entries()) {
      await execute(
        `
          INSERT INTO material_quiz_questions
            (material_id, question_order, question_text, options, correct_answer, explanation)
          VALUES ($1, $2, $3, $4::jsonb, $5, $6)
        `,
        [
          material?.id || 0,
          idx + 1,
          q.question,
          JSON.stringify(q.options),
          q.correctAnswer,
          q.explanation,
        ]
      );
    }

    res.json({ success: true, material_id: material?.id });
  });

  app.patch("/api/materials/:id/assign", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    const materialId = Number(req.params.id);
    const assigned = Boolean(req.body?.assigned);
    const material = await queryOne<any>("SELECT id, course_id FROM course_materials WHERE id = $1", [materialId]);
    if (!material) return res.status(404).json({ error: "Material not found" });
    if (!(await canManageCourse(req.user, Number(material.course_id)))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await execute(
      `
        UPDATE course_materials
        SET is_assigned = $1,
            assigned_at = CASE WHEN $1 THEN NOW() ELSE NULL END
        WHERE id = $2
      `,
      [assigned, materialId]
    );
    res.json({ success: true });
  });

  app.post("/api/materials/:id/quiz/regenerate", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    const materialId = Number(req.params.id);
    const material = await queryOne<any>(
      `
        SELECT id, title, content, summary, key_takeaways, course_id
        FROM course_materials
        WHERE id = $1
      `,
      [materialId]
    );
    if (!material) return res.status(404).json({ error: "Material not found" });
    if (!(await canManageCourse(req.user, Number(material.course_id)))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const quizSource = `${material.summary || ""}. ${(safeJson(material.key_takeaways, []) || []).join(". ")}`.trim();
    const quiz = makeQuizFromContent(quizSource || String(material.content || ""));

    await execute("DELETE FROM material_quiz_questions WHERE material_id = $1", [materialId]);
    for (const [idx, q] of quiz.entries()) {
      await execute(
        `
          INSERT INTO material_quiz_questions
            (material_id, question_order, question_text, options, correct_answer, explanation)
          VALUES ($1, $2, $3, $4::jsonb, $5, $6)
        `,
        [materialId, idx + 1, q.question, JSON.stringify(q.options), q.correctAnswer, q.explanation]
      );
    }

    res.json({ success: true, question_count: quiz.length });
  });

  app.delete("/api/materials/:id", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    const materialId = Number(req.params.id);
    const material = await queryOne<any>("SELECT id, course_id FROM course_materials WHERE id = $1", [materialId]);
    if (!material) return res.status(404).json({ error: "Material not found" });
    if (!(await canManageCourse(req.user, Number(material.course_id)))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await execute("DELETE FROM material_quiz_attempts WHERE material_id = $1", [materialId]);
    await execute("DELETE FROM material_quiz_questions WHERE material_id = $1", [materialId]);
    await execute("DELETE FROM course_materials WHERE id = $1", [materialId]);
    res.json({ success: true });
  });

  app.get("/api/materials/:id/file", authenticate, async (req: any, res) => {
    const materialId = Number(req.params.id);
    const material = await queryOne<any>(
      `
        SELECT id, course_id, source_type, source_file_name, source_file_base64, is_assigned
        FROM course_materials
        WHERE id = $1
      `,
      [materialId]
    );
    if (!material) return res.status(404).json({ error: "Material not found" });
    if (!(await canAccessCourse(req.user, Number(material.course_id)))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (req.user.role !== "faculty" && !material.is_assigned) {
      return res.status(403).json({ error: "Material not assigned yet" });
    }
    if (material.source_type !== "pdf" || !material.source_file_base64) {
      return res.status(404).json({ error: "PDF file not available for this material" });
    }

    res.json({
      file_name: material.source_file_name || `material-${materialId}.pdf`,
      file_base64: material.source_file_base64,
      mime_type: "application/pdf",
    });
  });

  app.get("/api/materials/:id/quiz", authenticate, async (req: any, res) => {
    const materialId = Number(req.params.id);
    const material = await queryOne<any>(
      "SELECT course_id, is_assigned FROM course_materials WHERE id = $1",
      [materialId]
    );
    if (!material) return res.status(404).json({ error: "Material not found" });
    if (!(await canAccessCourse(req.user, Number(material.course_id)))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (req.user.role !== "faculty" && !material.is_assigned) {
      return res.status(403).json({ error: "Material not assigned yet" });
    }

    const questions = await query<any>(
      `
        SELECT id, question_order, question_text, options
        FROM material_quiz_questions
        WHERE material_id = $1
        ORDER BY question_order ASC
      `,
      [materialId]
    );

    res.json(
      questions.map((q) => ({
        id: q.id,
        order: q.question_order,
        question: q.question_text,
        options: safeJson(q.options, []),
      }))
    );
  });

  app.post("/api/materials/:id/progress/open", authenticate, async (req: any, res) => {
    if (req.user.role !== "student") return res.status(403).json({ error: "Only students can update pre-read progress" });
    const materialId = Number(req.params.id);
    const material = await queryOne<any>(
      "SELECT course_id, is_assigned FROM course_materials WHERE id = $1",
      [materialId]
    );
    if (!material) return res.status(404).json({ error: "Material not found" });
    if (!(await canAccessCourse(req.user, Number(material.course_id)))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (!material.is_assigned) return res.status(403).json({ error: "Material not assigned yet" });

    await execute(
      `
        INSERT INTO material_learning_progress (material_id, user_id, opened_at, updated_at)
        VALUES ($1, $2, NOW(), NOW())
        ON CONFLICT (material_id, user_id)
        DO UPDATE SET
          opened_at = COALESCE(material_learning_progress.opened_at, NOW()),
          updated_at = NOW()
      `,
      [materialId, req.user.id]
    );

    res.json({ success: true });
  });

  app.post("/api/materials/:id/progress/read", authenticate, async (req: any, res) => {
    if (req.user.role !== "student") return res.status(403).json({ error: "Only students can update pre-read progress" });
    const materialId = Number(req.params.id);
    const material = await queryOne<any>(
      "SELECT course_id, is_assigned FROM course_materials WHERE id = $1",
      [materialId]
    );
    if (!material) return res.status(404).json({ error: "Material not found" });
    if (!(await canAccessCourse(req.user, Number(material.course_id)))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (!material.is_assigned) return res.status(403).json({ error: "Material not assigned yet" });

    await execute(
      `
        INSERT INTO material_learning_progress (material_id, user_id, opened_at, read_completed_at, updated_at)
        VALUES ($1, $2, NOW(), NOW(), NOW())
        ON CONFLICT (material_id, user_id)
        DO UPDATE SET
          opened_at = COALESCE(material_learning_progress.opened_at, NOW()),
          read_completed_at = COALESCE(material_learning_progress.read_completed_at, NOW()),
          updated_at = NOW()
      `,
      [materialId, req.user.id]
    );

    res.json({ success: true });
  });

  app.post("/api/materials/:id/quiz/submit", authenticate, async (req: any, res) => {
    if (req.user.role !== "student") return res.status(403).json({ error: "Only students can submit quiz attempts" });

    const materialId = Number(req.params.id);
    const material = await queryOne<any>(
      "SELECT course_id, is_assigned FROM course_materials WHERE id = $1",
      [materialId]
    );
    if (!material) return res.status(404).json({ error: "Material not found" });
    if (!(await canAccessCourse(req.user, Number(material.course_id)))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (!material.is_assigned) {
      return res.status(403).json({ error: "Material not assigned yet" });
    }

    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    const questions = await query<any>(
      `
        SELECT question_order, correct_answer
        FROM material_quiz_questions
        WHERE material_id = $1
        ORDER BY question_order ASC
      `,
      [materialId]
    );
    if (questions.length === 0) return res.status(400).json({ error: "No quiz exists for this material" });

    let score = 0;
    questions.forEach((q, idx) => {
      if (Number(answers[idx]) === Number(q.correct_answer)) score += 1;
    });

    await execute(
      `
        INSERT INTO material_quiz_attempts (material_id, user_id, answers, score, total_questions)
        VALUES ($1, $2, $3::jsonb, $4, $5)
      `,
      [materialId, req.user.id, JSON.stringify(answers), score, questions.length]
    );

    await execute(
      `
        INSERT INTO material_learning_progress
          (material_id, user_id, opened_at, read_completed_at, quiz_completed_at, quiz_score, quiz_total, updated_at)
        VALUES ($1, $2, NOW(), NOW(), NOW(), $3, $4, NOW())
        ON CONFLICT (material_id, user_id)
        DO UPDATE SET
          opened_at = COALESCE(material_learning_progress.opened_at, NOW()),
          read_completed_at = COALESCE(material_learning_progress.read_completed_at, NOW()),
          quiz_completed_at = NOW(),
          quiz_score = EXCLUDED.quiz_score,
          quiz_total = EXCLUDED.quiz_total,
          updated_at = NOW()
      `,
      [materialId, req.user.id, score, questions.length]
    );

    res.json({ score, total: questions.length });
  });

  app.get("/api/courses/:id/quiz-reports", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    const courseId = Number(req.params.id);
    if (!(await canManageCourse(req.user, courseId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const reports = await query<any>(
      `
        SELECT
          a.id,
          a.submitted_at,
          a.score,
          a.total_questions,
          u.name AS student_name,
          u.email AS student_email,
          m.title AS material_title,
          s.title AS section_title
        FROM material_quiz_attempts a
        JOIN users u ON u.id = a.user_id
        JOIN course_materials m ON m.id = a.material_id
        JOIN sections s ON s.id = m.section_id
        WHERE m.course_id = $1
        ORDER BY a.submitted_at DESC
      `,
      [courseId]
    );
    res.json(reports);
  });

  app.get("/api/courses/:id/quiz-analytics", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    const courseId = Number(req.params.id);
    if (!(await canManageCourse(req.user, courseId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const attempts = await query<any>(
      `
        SELECT
          a.score,
          a.total_questions,
          u.id AS student_id,
          u.name AS student_name,
          u.email AS student_email
        FROM material_quiz_attempts a
        JOIN users u ON u.id = a.user_id
        JOIN course_materials m ON m.id = a.material_id
        WHERE m.course_id = $1
      `,
      [courseId]
    );

    if (attempts.length === 0) {
      return res.json({
        attempts: 0,
        average_score: 0,
        highest_score: 0,
        highest_percentage: 0,
        top_performer: null,
      });
    }

    const percentages = attempts.map((a) =>
      a.total_questions > 0 ? (Number(a.score) / Number(a.total_questions)) * 100 : 0
    );
    const averageScore = Number(
      (
        attempts.reduce((sum, a) => sum + Number(a.score), 0) /
        attempts.length
      ).toFixed(2)
    );
    const highestPercentage = Math.max(...percentages);
    const highestAttemptIndex = percentages.findIndex((p) => p === highestPercentage);
    const highestAttempt = attempts[highestAttemptIndex];

    const studentAggregate = new Map<
      number,
      { name: string; email: string; avgPercent: number; count: number; totalPercent: number }
    >();
    attempts.forEach((a, idx) => {
      const percent = percentages[idx];
      const existing = studentAggregate.get(a.student_id) || {
        name: a.student_name,
        email: a.student_email,
        avgPercent: 0,
        count: 0,
        totalPercent: 0,
      };
      existing.count += 1;
      existing.totalPercent += percent;
      existing.avgPercent = Number((existing.totalPercent / existing.count).toFixed(2));
      studentAggregate.set(a.student_id, existing);
    });
    const topStudent = [...studentAggregate.entries()]
      .sort((a, b) => b[1].avgPercent - a[1].avgPercent)[0];

    res.json({
      attempts: attempts.length,
      average_score: averageScore,
      average_percentage: Number((percentages.reduce((s, p) => s + p, 0) / percentages.length).toFixed(2)),
      highest_score: Number(highestAttempt.score),
      highest_percentage: Number(highestPercentage.toFixed(2)),
      top_performer: topStudent
        ? {
            student_id: topStudent[0],
            name: topStudent[1].name,
            email: topStudent[1].email,
            average_percentage: topStudent[1].avgPercent,
          }
        : null,
    });
  });

  app.get("/api/courses/:id/pre-read-analytics", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    const courseId = Number(req.params.id);
    if (!(await canManageCourse(req.user, courseId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const studentRows = await query<any>(
      `
        SELECT
          u.id AS student_id,
          u.name AS student_name,
          u.email AS student_email,
          COUNT(DISTINCT m.id) FILTER (WHERE m.is_assigned = TRUE)::int AS assigned_readings,
          COUNT(DISTINCT p.material_id) FILTER (WHERE p.opened_at IS NOT NULL)::int AS opened_readings,
          COUNT(DISTINCT p.material_id) FILTER (WHERE p.read_completed_at IS NOT NULL)::int AS read_readings,
          COUNT(DISTINCT p.material_id) FILTER (WHERE p.quiz_completed_at IS NOT NULL)::int AS quiz_completed_readings,
          ROUND(AVG(CASE WHEN p.quiz_total > 0 THEN (p.quiz_score::numeric / p.quiz_total::numeric) * 100 END), 2) AS avg_quiz_percent
        FROM enrollments e
        JOIN users u ON u.id = e.user_id AND u.role = 'student'
        LEFT JOIN course_materials m ON m.course_id = e.course_id
        LEFT JOIN material_learning_progress p
          ON p.user_id = u.id
         AND p.material_id = m.id
        WHERE e.course_id = $1
        GROUP BY u.id, u.name, u.email
        ORDER BY u.name ASC
      `,
      [courseId]
    );

    const summary = {
      total_students: studentRows.length,
      opened_any: studentRows.filter((s) => Number(s.opened_readings) > 0).length,
      completed_any_quiz: studentRows.filter((s) => Number(s.quiz_completed_readings) > 0).length,
    };

    res.json({ summary, students: studentRows });
  });

  app.get("/api/courses/:id/participants", authenticate, async (req: any, res) => {
    const courseId = Number(req.params.id);
    if (!(await canAccessCourse(req.user, courseId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const participants = await query(
      `
        SELECT u.id, u.name, u.email, u.role, e.last_accessed, e.progress
        FROM users u
        JOIN enrollments e ON u.id = e.user_id
        WHERE e.course_id = $1
      `,
      [courseId]
    );
    res.json(participants);
  });

  app.get("/api/students", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    const students = await query("SELECT id, name, email FROM users WHERE role = 'student'");
    res.json(students);
  });

  app.post("/api/courses/:id/enrol", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    const courseId = Number(req.params.id);
    if (!(await canManageCourse(req.user, courseId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { user_id } = req.body;
    const student = await queryOne<{ id: number }>(
      "SELECT id FROM users WHERE id = $1 AND role = 'student' LIMIT 1",
      [Number(user_id)]
    );
    if (!student) return res.status(400).json({ error: "Invalid student selected" });
    try {
      await execute(
        `
          INSERT INTO enrollments (user_id, course_id, progress, last_accessed)
          VALUES ($1, $2, 0, NOW())
        `,
        [Number(user_id), courseId]
      );
      res.json({ success: true });
    } catch {
      res.status(400).json({ error: "User already enrolled or error occurred" });
    }
  });

  app.get("/api/courses/:id/activities", authenticate, async (req: any, res) => {
    const courseId = Number(req.params.id);
    if (!(await canAccessCourse(req.user, courseId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const activities = await query("SELECT * FROM activities WHERE course_id = $1", [courseId]);
    res.json(activities);
  });

  app.get("/api/booster/sessions", authenticate, async (req: any, res) => {
    const sessions = await query<any>(
      `
        SELECT
          m.id,
          m.title,
          m.content,
          m.source_type,
          m.created_at,
          c.name as course_name,
          c.code as course_code,
          p.opened_at,
          p.read_completed_at,
          p.quiz_completed_at,
          qa.submitted_at AS quiz_attempted_at
        FROM course_materials m
        JOIN courses c ON c.id = m.course_id
        JOIN enrollments e ON c.id = e.course_id
        LEFT JOIN material_learning_progress p
          ON p.material_id = m.id
         AND p.user_id = e.user_id
        LEFT JOIN LATERAL (
          SELECT submitted_at
          FROM material_quiz_attempts a
          WHERE a.material_id = m.id
            AND a.user_id = e.user_id
          ORDER BY submitted_at DESC
          LIMIT 1
        ) qa ON true
        WHERE e.user_id = $1
          AND m.is_assigned = TRUE
        ORDER BY m.created_at DESC
      `,
      [req.user.id]
    );

    const transformed = sessions.map((s: any) => ({
      id: s.id.toString(),
      title: s.title,
      date: s.created_at ? new Date(s.created_at).toLocaleDateString() : "No date",
      estimatedTime: "30 mins",
      progress: s.quiz_completed_at || s.quiz_attempted_at ? 100 : s.read_completed_at ? 70 : s.opened_at ? 30 : 0,
      status: s.quiz_completed_at || s.quiz_attempted_at ? "completed" : s.opened_at ? "in_progress" : "not_started",
      items: [
        {
          id: `item-${s.id}`,
          title: s.title,
          type: s.source_type === "link" ? "article" : "pdf",
          content: s.content || "",
        },
      ],
    }));

    res.json(transformed);
  });

  app.get("/api/analytics/risks", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    const risks = await query(
      `
        SELECT u.name, 'Low progress in ' || c.code as issue,
               CASE WHEN e.progress < 10 THEN 'critical' ELSE 'warning' END as status
        FROM users u
        JOIN enrollments e ON u.id = e.user_id
        JOIN courses c ON e.course_id = c.id
        WHERE u.role = 'student' AND e.progress < 30
        LIMIT 5
      `
    );
    res.json(risks);
  });

  if (!isProduction) {
    app.get("/api/dev/db-dump", async (_req, res) => {
      try {
        const tables = await query<{ table_name: string }>(
          `
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name
          `
        );

        const dump: Record<string, any> = {};
        for (const { table_name } of tables) {
          if (!/^[a-z_][a-z0-9_]*$/i.test(table_name)) continue;
          const columns = await query(
            `
              SELECT column_name, data_type, is_nullable, column_default
              FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = $1
              ORDER BY ordinal_position
            `,
            [table_name]
          );
          const data = await query(`SELECT * FROM "${table_name}" LIMIT 100`);
          dump[table_name] = { columns, data };
        }

        res.json(dump);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.use((req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Server failed to start", error);
  process.exit(1);
});

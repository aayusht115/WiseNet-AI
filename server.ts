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
    question_text: "How clear were the concepts covered in this course so far?",
    question_type: "mcq",
    options: ["Very unclear", "Unclear", "Somewhat clear", "Clear", "Very clear"],
  },
  {
    question_order: 2,
    question_text: "How useful were the assigned pre-reads and in-class discussions in building your understanding?",
    question_type: "mcq",
    options: ["Not useful", "Slightly useful", "Moderately useful", "Useful", "Very useful"],
  },
  {
    question_order: 3,
    question_text: "How confident are you in applying the core concepts to a real business problem?",
    question_type: "mcq",
    options: ["Not confident", "Slightly confident", "Somewhat confident", "Confident", "Very confident"],
  },
  {
    question_order: 4,
    question_text: "What is one specific thing faculty can improve in upcoming sessions?",
    question_type: "text",
    options: [],
  },
  {
    question_order: 5,
    question_text: "Any topic you struggled with? Briefly explain where you got stuck.",
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

function normalizeLearningOutcomes(value: any) {
  const rows = safeJson(value, []);
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => String(row ?? "").trim())
    .filter(Boolean);
}

function getEvaluationTotal(components: ReturnType<typeof normalizeEvaluationComponents>) {
  return components.reduce((sum, row) => sum + (Number(row.weightage_percent) || 0), 0);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeCourseCredits(value: any) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  if (parsed <= 1) return 1;
  if (parsed >= 3) return 3;
  return Math.round(parsed);
}

function sessionsRequiredForCredits(credits: number) {
  return normalizeCourseCredits(credits) * 9;
}

function normalizeFeedbackTriggerSession(value: any, maxSessions: number) {
  const fallback = Math.min(4, Math.max(1, maxSessions));
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  if (rounded < 1) return 1;
  if (rounded > maxSessions) return maxSessions;
  return rounded;
}

function normalizeDateOnly(value: any): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match?.[1]) return match[1];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function getNowOverride(req: any): string | null {
  const raw = String(req.headers?.["x-now-override"] || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function parseDateOnly(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function validateCourseWindow(startDate: string, endDate: string, credits: number): string | null {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end) {
    return "Course start date and end date are required.";
  }
  if (end.getTime() < start.getTime()) {
    return "Course end date must be on or after start date.";
  }

  const requiredSessions = sessionsRequiredForCredits(credits);
  const inclusiveDays = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
  if (inclusiveDays < requiredSessions) {
    return `For ${normalizeCourseCredits(credits)} credit(s), choose a date range with at least ${requiredSessions} days (inclusive) to schedule ${requiredSessions} sessions.`;
  }

  return null;
}

function buildSessionPlan(startDate: string, endDate: string, credits: number) {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end) return [];

  const sessionCount = sessionsRequiredForCredits(credits);
  const totalDays = Math.max(0, Math.floor((end.getTime() - start.getTime()) / DAY_MS));
  const offsets: number[] = [];

  for (let i = 0; i < sessionCount; i += 1) {
    if (sessionCount === 1) {
      offsets.push(0);
      continue;
    }
    const remaining = sessionCount - i - 1;
    const minOffset = i === 0 ? 0 : offsets[i - 1] + 1;
    const maxOffset = totalDays - remaining;
    const target = Math.round((i * totalDays) / (sessionCount - 1));
    offsets.push(Math.min(maxOffset, Math.max(minOffset, target)));
  }

  return offsets.map((offset, idx) => {
    const date = new Date(start.getTime() + offset * DAY_MS);
    return {
      session_number: idx + 1,
      title: `Session ${idx + 1}`,
      session_date: date.toISOString().slice(0, 10),
      start_time: "09:00",
      end_time: "10:30",
      mode: "classroom",
    };
  });
}

function normalizeSessionPayload(
  value: any,
  startDate: string,
  endDate: string,
  credits: number
): { sessions: ReturnType<typeof buildSessionPlan>; error: string | null } {
  const expectedSessions = sessionsRequiredForCredits(credits);
  const raw = safeJson(value, []);
  const rows = Array.isArray(raw) && raw.length > 0 ? raw : buildSessionPlan(startDate, endDate, credits);

  if (rows.length !== expectedSessions) {
    return {
      sessions: [],
      error: `This course requires exactly ${expectedSessions} sessions for ${normalizeCourseCredits(
        credits
      )} credit(s).`,
    };
  }

  const normalized = rows.map((row: any, idx: number) => {
    const normalizedDate = normalizeDateOnly(row?.session_date);
    return {
      session_number: Number(row?.session_number) || idx + 1,
      title: String(row?.title || `Session ${idx + 1}`).trim() || `Session ${idx + 1}`,
      session_date: normalizedDate || "",
      start_time: row?.start_time ? String(row.start_time) : "09:00",
      end_time: row?.end_time ? String(row.end_time) : "10:30",
      mode: row?.mode ? String(row.mode) : "classroom",
    };
  });

  if (normalized.some((row) => !row.session_date)) {
    return { sessions: [], error: "Each session must have a valid date." };
  }

  normalized.sort((a, b) => {
    if (a.session_date === b.session_date) return a.session_number - b.session_number;
    return a.session_date.localeCompare(b.session_date);
  });

  for (const row of normalized) {
    if (row.session_date < startDate || row.session_date > endDate) {
      return {
        sessions: [],
        error: "All session dates must be within course start and end dates.",
      };
    }
  }
  if (normalized[0]?.session_date !== startDate) {
    return {
      sessions: [],
      error: "First session date must match the course start date.",
    };
  }
  if (normalized[normalized.length - 1]?.session_date !== endDate) {
    return {
      sessions: [],
      error: "Last session date must match the course end date.",
    };
  }

  return {
    sessions: normalized.map((row, idx) => ({
      ...row,
      session_number: idx + 1,
    })),
    error: null,
  };
}

async function replaceCourseSessions(
  courseId: number,
  sessions: ReturnType<typeof buildSessionPlan>,
  userId: number
) {
  await execute("DELETE FROM course_sessions WHERE course_id = $1", [courseId]);
  for (const row of sessions) {
    await execute(
      `
        INSERT INTO course_sessions
          (course_id, session_number, title, session_date, start_time, end_time, mode, created_by)
        VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8)
      `,
      [
        courseId,
        row.session_number,
        row.title,
        row.session_date,
        row.start_time || null,
        row.end_time || null,
        row.mode || "classroom",
        userId,
      ]
    );
  }
}

async function ensureMinimumCourseSessions(
  courseId: number,
  credits: number,
  startDate: string,
  endDate: string,
  userId: number
) {
  const plan = buildSessionPlan(startDate, endDate, credits);
  if (plan.length === 0) return;

  const existing = await query<{ session_number: number }>(
    "SELECT session_number FROM course_sessions WHERE course_id = $1",
    [courseId]
  );
  const existingSet = new Set(existing.map((row) => Number(row.session_number)));

  for (const item of plan) {
    if (existingSet.has(item.session_number)) continue;
    await execute(
      `
        INSERT INTO course_sessions
          (course_id, session_number, title, session_date, start_time, end_time, mode, created_by)
        VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8)
      `,
      [
        courseId,
        item.session_number,
        item.title,
        item.session_date,
        item.start_time,
        item.end_time,
        item.mode,
        userId,
      ]
    );
  }
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

async function ensureCourseScaffold(
  courseId: number,
  facultyInfo: string | null = null,
  credits: number = 1
) {
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
      INSERT INTO course_details (
        course_id,
        faculty_info,
        teaching_assistant,
        credits,
        feedback_trigger_session,
        learning_outcomes,
        evaluation_components
      )
      VALUES ($1, $2, NULL, $3, 4, '[]'::jsonb, '[]'::jsonb)
      ON CONFLICT (course_id)
      DO NOTHING
    `,
    [courseId, facultyInfo, normalizeCourseCredits(credits)]
  );
}

async function ensureFeedbackFormForCourse(courseId: number) {
  const course = await queryOne<{ credits: number }>("SELECT credits FROM courses WHERE id = $1", [courseId]);
  const maxSessions = sessionsRequiredForCredits(Number(course?.credits || 1));
  const details = await queryOne<{ feedback_trigger_session: number }>(
    "SELECT feedback_trigger_session FROM course_details WHERE course_id = $1",
    [courseId]
  );
  const triggerSessionNumber = normalizeFeedbackTriggerSession(
    details?.feedback_trigger_session,
    maxSessions
  );

  const triggerSession = await queryOne<any>(
    `
      SELECT session_number, session_date
      FROM course_sessions
      WHERE course_id = $1 AND session_number = $2
      LIMIT 1
    `,
    [courseId, triggerSessionNumber]
  );
  if (!triggerSession) return null;

  let form = await queryOne<any>(
    `
      SELECT id, course_id, trigger_session_number, open_at, due_at
      FROM feedback_forms
      WHERE course_id = $1 AND trigger_session_number = $2
      LIMIT 1
    `,
    [courseId, triggerSessionNumber]
  );

  if (!form) {
    form = await queryOne<any>(
      `
        INSERT INTO feedback_forms (course_id, trigger_session_number, open_at, due_at)
        VALUES ($1, $2, ($3::date)::timestamptz, (($3::date)::timestamptz + INTERVAL '2 day'))
        RETURNING id, course_id, trigger_session_number, open_at, due_at
      `,
      [courseId, triggerSessionNumber, triggerSession.session_date]
    );
  } else {
    await execute(
      `
        UPDATE feedback_forms
        SET open_at = ($2::date)::timestamptz,
            due_at = (($2::date)::timestamptz + INTERVAL '2 day')
        WHERE id = $1
      `,
      [form.id, triggerSession.session_date]
    );
    form = await queryOne<any>(
      `
        SELECT id, course_id, trigger_session_number, open_at, due_at
        FROM feedback_forms
        WHERE id = $1
      `,
      [form.id]
    );
  }

  if (form?.id) {
    const submissions = await queryOne<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM feedback_submissions WHERE form_id = $1",
      [form.id]
    );
    const existingQuestions = await query<any>(
      `
        SELECT question_order, question_text, question_type, options
        FROM feedback_questions
        WHERE form_id = $1
        ORDER BY question_order ASC
      `,
      [form.id]
    );
    const hasExistingSubmissions = (submissions?.count ?? 0) > 0;
    const needsQuestionSync =
      existingQuestions.length !== DEFAULT_FEEDBACK_QUESTIONS.length ||
      existingQuestions.some((existing, idx) => {
        const target = DEFAULT_FEEDBACK_QUESTIONS[idx];
        if (!target) return true;
        if (Number(existing.question_order) !== Number(target.question_order)) return true;
        if (String(existing.question_text || "").trim() !== target.question_text) return true;
        if (String(existing.question_type || "").trim() !== target.question_type) return true;
        return JSON.stringify(safeJson(existing.options, [])) !== JSON.stringify(target.options || []);
      });

    if (!hasExistingSubmissions && needsQuestionSync) {
      await execute("DELETE FROM feedback_questions WHERE form_id = $1", [form.id]);
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
  }

  return form;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clipText(value: string, maxLength = 180) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function buildThemeKeywords(comments: string[], limit = 4) {
  const freq = new Map<string, number>();
  for (const comment of comments) {
    const tokens = comment
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
    for (const token of tokens) {
      freq.set(token, (freq.get(token) || 0) + 1);
    }
  }
  return [...freq.entries()]
    .sort((a, b) => {
      if (b[1] === a[1]) return a[0].localeCompare(b[0]);
      return b[1] - a[1];
    })
    .slice(0, limit)
    .map(([token]) => token);
}

function buildTextFeedbackSummary(
  submissionsCount: number,
  mcqMetrics: Array<{ question_text: string; average: number; responses: number }>,
  comments: string[]
) {
  if (submissionsCount <= 0) {
    return "No student feedback submissions were received for this cycle.";
  }

  const parts: string[] = [];
  parts.push(
    `Collected ${submissionsCount} anonymous feedback submission${
      submissionsCount === 1 ? "" : "s"
    }.`
  );

  const scored = mcqMetrics.filter((metric) => metric.responses > 0);
  if (scored.length > 0) {
    const sorted = [...scored].sort((a, b) => b.average - a.average);
    const strongest = sorted[0];
    const weakest = sorted[sorted.length - 1];
    parts.push(
      `Highest-rated area: "${strongest.question_text}" (${strongest.average.toFixed(2)}/5).`
    );
    if (weakest.question_text !== strongest.question_text) {
      parts.push(
        `Lowest-rated area: "${weakest.question_text}" (${weakest.average.toFixed(2)}/5).`
      );
    }
  }

  if (comments.length > 0) {
    const keywords = buildThemeKeywords(comments, 4);
    if (keywords.length > 0) {
      parts.push(`Common themes in comments: ${keywords.join(", ")}.`);
    }
    const sample = comments.slice(0, 2).map((comment) => `"${clipText(comment, 120)}"`).join(" ");
    if (sample) {
      parts.push(`Representative anonymous feedback: ${sample}`);
    }
  } else {
    parts.push("No written comments were submitted.");
  }

  return parts.join(" ");
}

async function ensureFeedbackInsightForForm(formId: number, nowOverride: string | null = null) {
  const form = await queryOne<{
    id: number;
    course_id: number;
    trigger_session_number: number;
    open_at: string;
    due_at: string;
  }>(
    `
      SELECT id, course_id, trigger_session_number, open_at, due_at
      FROM feedback_forms
      WHERE id = $1
      LIMIT 1
    `,
    [formId]
  );
  if (!form) return null;

  const now = new Date(nowOverride || new Date().toISOString());
  const dueAt = new Date(form.due_at);
  if (Number.isNaN(now.getTime()) || Number.isNaN(dueAt.getTime()) || now.getTime() < dueAt.getTime()) {
    return null;
  }

  const questions = await query<any>(
    `
      SELECT id, question_order, question_text, question_type, options
      FROM feedback_questions
      WHERE form_id = $1
      ORDER BY question_order ASC
    `,
    [form.id]
  );
  const submissions = await query<{ answers: any }>(
    `
      SELECT answers
      FROM feedback_submissions
      WHERE form_id = $1
      ORDER BY submitted_at ASC
    `,
    [form.id]
  );

  const piiRows = await query<{ name: string | null; email: string | null }>(
    `
      SELECT u.name, u.email
      FROM users u
      JOIN enrollments e ON e.user_id = u.id
      WHERE e.course_id = $1 AND u.role = 'student'
    `,
    [form.course_id]
  );
  const piiTokens = [
    ...new Set(
      piiRows
        .flatMap((row) => [row.name || "", row.email || ""])
        .flatMap((value) => String(value).split(/\s+/))
        .map((value) => value.trim())
        .filter((value) => value.length >= 3)
    ),
  ];

  const sanitizeComment = (value: string) => {
    let sanitized = value;
    for (const token of piiTokens) {
      const pattern = new RegExp(`\\b${escapeRegex(token)}\\b`, "gi");
      sanitized = sanitized.replace(pattern, "[redacted]");
    }
    return sanitized.replace(/\s+/g, " ").trim();
  };

  const parsedAnswerSets = submissions.map((submission) => safeJson(submission.answers, []));
  const metrics: any[] = [];
  const allTextComments: string[] = [];

  for (const question of questions) {
    if (String(question.question_type) === "mcq") {
      const options = safeJson(question.options, []);
      const choiceValues = parsedAnswerSets
        .flatMap((answers: any[]) =>
          answers
            .filter((answer) => Number(answer?.question_id) === Number(question.id))
            .map((answer) => Number(answer?.choice_value))
        )
        .filter((choice) => Number.isInteger(choice) && choice >= 1 && choice <= options.length);
      const average =
        choiceValues.length > 0
          ? Number((choiceValues.reduce((sum, choice) => sum + choice, 0) / choiceValues.length).toFixed(2))
          : 0;
      const distribution = options.map((option: string, index: number) => {
        const count = choiceValues.filter((choice) => choice === index + 1).length;
        const percentage =
          choiceValues.length > 0 ? Number(((count / choiceValues.length) * 100).toFixed(1)) : 0;
        return {
          option_index: index + 1,
          option_text: String(option),
          count,
          percentage,
        };
      });
      metrics.push({
        question_id: Number(question.id),
        question_order: Number(question.question_order),
        question_text: String(question.question_text || ""),
        question_type: "mcq",
        responses: choiceValues.length,
        average,
        distribution,
      });
      continue;
    }

    const comments = parsedAnswerSets
      .flatMap((answers: any[]) =>
        answers
          .filter((answer) => Number(answer?.question_id) === Number(question.id))
          .map((answer) => sanitizeComment(String(answer?.answer_text || "")))
      )
      .filter(Boolean);

    allTextComments.push(...comments);
    metrics.push({
      question_id: Number(question.id),
      question_order: Number(question.question_order),
      question_text: String(question.question_text || ""),
      question_type: "text",
      responses: comments.length,
      highlights: comments.slice(0, 8),
    });
  }

  const mcqMetrics = metrics
    .filter((metric) => metric.question_type === "mcq")
    .map((metric) => ({
      question_text: String(metric.question_text || ""),
      average: Number(metric.average || 0),
      responses: Number(metric.responses || 0),
    }));
  const summaryText = buildTextFeedbackSummary(submissions.length, mcqMetrics, allTextComments);

  await execute(
    `
      INSERT INTO feedback_insights (
        form_id,
        course_id,
        submissions_count,
        summary_text,
        metrics_json,
        text_comments_json,
        generated_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW())
      ON CONFLICT (form_id)
      DO UPDATE SET
        submissions_count = EXCLUDED.submissions_count,
        summary_text = EXCLUDED.summary_text,
        metrics_json = EXCLUDED.metrics_json,
        text_comments_json = EXCLUDED.text_comments_json,
        generated_at = NOW()
    `,
    [
      form.id,
      form.course_id,
      submissions.length,
      summaryText,
      JSON.stringify(metrics),
      JSON.stringify(allTextComments.slice(0, 20)),
    ]
  );

  return queryOne<any>(
    `
      SELECT *
      FROM feedback_insights
      WHERE form_id = $1
      LIMIT 1
    `,
    [form.id]
  );
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

  app.get("/api/dashboard/todos", authenticate, async (req: any, res) => {
    if (req.user.role !== "student") return res.json([]);
    const nowOverride = getNowOverride(req);

    const enrolledCourseRows = await query<{ course_id: number }>(
      "SELECT course_id FROM enrollments WHERE user_id = $1",
      [req.user.id]
    );
    for (const row of enrolledCourseRows) {
      const courseId = Number(row.course_id);
      if (courseId > 0) {
        await ensureFeedbackFormForCourse(courseId);
      }
    }

    const todos = await query<any>(
      `
        SELECT *
        FROM (
          SELECT
            'pre_read'::text AS task_type,
            m.id AS item_id,
            m.title AS item_title,
            c.id AS course_id,
            c.name AS course_name,
            c.code AS course_code,
            s.title AS section_title,
            COALESCE(m.due_at, m.assigned_at + INTERVAL '2 day', m.created_at + INTERVAL '2 day') AS due_at
          FROM course_materials m
          JOIN sections s ON s.id = m.section_id
          JOIN courses c ON c.id = m.course_id
          JOIN enrollments e ON e.course_id = c.id AND e.user_id = $1
          LEFT JOIN material_learning_progress p ON p.material_id = m.id AND p.user_id = $1
          WHERE m.is_assigned = TRUE
            AND COALESCE(p.quiz_completed_at, p.read_completed_at) IS NULL

          UNION ALL

          SELECT
            'feedback'::text AS task_type,
            f.id AS item_id,
            'Anonymous Mid-course Feedback'::text AS item_title,
            c.id AS course_id,
            c.name AS course_name,
            c.code AS course_code,
            'Feedback'::text AS section_title,
            f.due_at AS due_at
          FROM feedback_forms f
          JOIN courses c ON c.id = f.course_id
          JOIN enrollments e ON e.course_id = c.id AND e.user_id = $1
          LEFT JOIN feedback_submissions fs ON fs.form_id = f.id AND fs.user_id = $1
          WHERE fs.id IS NULL
            AND COALESCE($2::timestamptz, NOW()) >= f.open_at
            AND COALESCE($2::timestamptz, NOW()) <= f.due_at
        ) todo_rows
        ORDER BY due_at ASC, course_name ASC
      `,
      [req.user.id, nowOverride]
    );

    res.json(todos);
  });

  app.get("/api/courses/overview", authenticate, async (req: any, res) => {
    const courses =
      req.user.role === "faculty"
        ? await query(
            `
              SELECT
                c.*,
                0 as progress,
                COALESCE((
                  SELECT json_agg(sess ORDER BY sess.session_date ASC, sess.session_number ASC)
                  FROM (
                    SELECT id, course_id, session_number, title, session_date, start_time, end_time, mode
                    FROM course_sessions
                    WHERE course_id = c.id
                    ORDER BY session_date ASC, session_number ASC
                    LIMIT 9
                  ) sess
                ), '[]'::json) AS session_preview
              FROM courses c
              WHERE c.created_by = $1
              ORDER BY c.name ASC
            `,
            [req.user.id]
          )
        : await query(
            `
              SELECT
                c.*,
                e.progress,
                COALESCE((
                  SELECT json_agg(sess ORDER BY sess.session_date ASC, sess.session_number ASC)
                  FROM (
                    SELECT id, course_id, session_number, title, session_date, start_time, end_time, mode
                    FROM course_sessions
                    WHERE course_id = c.id
                    ORDER BY session_date ASC, session_number ASC
                    LIMIT 9
                  ) sess
                ), '[]'::json) AS session_preview
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
        ? await query(
            `
              SELECT
                c.*,
                COALESCE((
                  SELECT json_agg(sess ORDER BY sess.session_date ASC, sess.session_number ASC)
                  FROM (
                    SELECT id, course_id, session_number, title, session_date, start_time, end_time, mode
                    FROM course_sessions
                    WHERE course_id = c.id
                    ORDER BY session_date ASC, session_number ASC
                    LIMIT 9
                  ) sess
                ), '[]'::json) AS session_preview
              FROM courses c
              WHERE c.created_by = $1
              ORDER BY c.name ASC
            `,
            [req.user.id]
          )
        : await query(
            `
              SELECT
                c.*,
                COALESCE((
                  SELECT json_agg(sess ORDER BY sess.session_date ASC, sess.session_number ASC)
                  FROM (
                    SELECT id, course_id, session_number, title, session_date, start_time, end_time, mode
                    FROM course_sessions
                    WHERE course_id = c.id
                    ORDER BY session_date ASC, session_number ASC
                    LIMIT 9
                  ) sess
                ), '[]'::json) AS session_preview
              FROM courses c
              JOIN enrollments e ON e.course_id = c.id
              WHERE e.user_id = $1
              ORDER BY c.name ASC
            `,
            [req.user.id]
          );
    res.json(courses);
  });

  app.get("/api/courses/check-code", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    const rawCode = String(req.query?.code || "").trim();
    if (!rawCode) {
      return res.status(400).json({ error: "Course ID is required." });
    }

    const excludeCourseId = Number(req.query?.exclude_course_id || 0);
    const existing = await queryOne<{ id: number }>(
      excludeCourseId > 0
        ? "SELECT id FROM courses WHERE LOWER(code) = LOWER($1) AND created_by = $2 AND id <> $3 LIMIT 1"
        : "SELECT id FROM courses WHERE LOWER(code) = LOWER($1) AND created_by = $2 LIMIT 1",
      excludeCourseId > 0 ? [rawCode, req.user.id, excludeCourseId] : [rawCode, req.user.id]
    );

    if (existing) {
      return res.json({
        available: false,
        message: "Course ID is already in use. Please choose a different one.",
      });
    }
    return res.json({
      available: true,
      message: "Course ID is available.",
    });
  });

  app.get("/api/courses/catalog", authenticate, async (req: any, res) => {
    if (req.user.role !== "student") return res.status(403).json({ error: "Forbidden" });

    const courses = await query(
      `
        SELECT
          c.*,
          COALESCE(e.progress, 0) AS progress,
          CASE WHEN e.user_id IS NULL THEN FALSE ELSE TRUE END AS is_enrolled,
          COALESCE((
            SELECT json_agg(sess ORDER BY sess.session_date ASC, sess.session_number ASC)
            FROM (
              SELECT id, course_id, session_number, title, session_date, start_time, end_time, mode
              FROM course_sessions
              WHERE course_id = c.id
              ORDER BY session_date ASC, session_number ASC
              LIMIT 9
            ) sess
          ), '[]'::json) AS session_preview
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
    const {
      name,
      code,
      description,
      start_date,
      end_date,
      visibility,
      instructor,
      credits,
      image_url,
      faculty_info,
      teaching_assistant,
      learning_outcomes,
      evaluation_components,
      feedback_trigger_session,
      sessions,
      enrolled_student_ids,
    } = req.body || {};
    if (!String(name || "").trim() || !String(code || "").trim()) {
      return res.status(400).json({ error: "name and code are required" });
    }

    const normalizedCredits = normalizeCourseCredits(credits);
    const normalizedStart = normalizeDateOnly(start_date);
    const normalizedEnd = normalizeDateOnly(end_date);
    if (!normalizedStart || !normalizedEnd) {
      return res.status(400).json({ error: "start_date and end_date are required" });
    }
    const dateWindowError = validateCourseWindow(normalizedStart, normalizedEnd, normalizedCredits);
    if (dateWindowError) {
      return res.status(400).json({ error: dateWindowError });
    }
    const normalizedEvaluation = normalizeEvaluationComponents(evaluation_components);
    if (normalizedEvaluation.length > 0 && getEvaluationTotal(normalizedEvaluation) !== 100) {
      return res.status(400).json({ error: "Evaluation weightages must add up to 100%." });
    }
    const normalizedOutcomes = normalizeLearningOutcomes(learning_outcomes);
    const sessionPayload = normalizeSessionPayload(sessions, normalizedStart, normalizedEnd, normalizedCredits);
    if (sessionPayload.error) {
      return res.status(400).json({ error: sessionPayload.error });
    }
    const normalizedFeedbackTrigger = normalizeFeedbackTriggerSession(
      feedback_trigger_session,
      sessionsRequiredForCredits(normalizedCredits)
    );
    const normalizedStudentIds = Array.isArray(enrolled_student_ids)
      ? [...new Set(enrolled_student_ids.map((id: any) => Number(id)).filter((id: number) => id > 0))]
      : [];

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
          (name, code, description, image_url, start_date, end_date, visibility, instructor, created_by, credits)
        VALUES
          ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10)
        RETURNING id
      `,
      [
        String(name).trim(),
        String(code).trim(),
        description || null,
        image_url ? String(image_url) : null,
        normalizedStart,
        normalizedEnd,
        visibility === "hide" ? "hide" : "show",
        String(instructor || req.user.name || "").trim() || "Faculty",
        req.user.id,
        normalizedCredits,
      ]
    );
    if (!created?.id) return res.status(500).json({ error: "Failed to create course" });

    await ensureCourseScaffold(
      created.id,
      String(instructor || req.user.name || "").trim() || null,
      normalizedCredits
    );
    await execute(
      `
        INSERT INTO course_details (
          course_id,
          faculty_info,
          teaching_assistant,
          credits,
          feedback_trigger_session,
          learning_outcomes,
          evaluation_components
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
        ON CONFLICT (course_id)
        DO UPDATE SET
          faculty_info = EXCLUDED.faculty_info,
          teaching_assistant = EXCLUDED.teaching_assistant,
          credits = EXCLUDED.credits,
          feedback_trigger_session = EXCLUDED.feedback_trigger_session,
          learning_outcomes = EXCLUDED.learning_outcomes,
          evaluation_components = EXCLUDED.evaluation_components
      `,
      [
        created.id,
        faculty_info ? String(faculty_info) : String(instructor || req.user.name || "").trim() || null,
        teaching_assistant ? String(teaching_assistant) : null,
        normalizedCredits,
        normalizedFeedbackTrigger,
        JSON.stringify(normalizedOutcomes),
        JSON.stringify(normalizedEvaluation),
      ]
    );
    await replaceCourseSessions(created.id, sessionPayload.sessions, req.user.id);
    for (const studentId of normalizedStudentIds) {
      const validStudent = await queryOne<{ id: number }>(
        "SELECT id FROM users WHERE id = $1 AND role = 'student'",
        [studentId]
      );
      if (!validStudent) continue;
      await execute(
        `
          INSERT INTO enrollments (user_id, course_id, progress, last_accessed)
          VALUES ($1, $2, 0, NOW())
          ON CONFLICT (user_id, course_id)
          DO NOTHING
        `,
        [studentId, created.id]
      );
    }
    await ensureFeedbackFormForCourse(created.id);
    res.status(201).json({ success: true, id: created.id });
  });

  app.get("/api/courses/:id", authenticate, async (req: any, res) => {
    const courseId = Number(req.params.id);
    if (!(await canAccessCourse(req.user, courseId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const course = await queryOne(
      `
        SELECT
          id,
          name,
          code,
          category_id,
          instructor,
          created_by,
          credits,
          description,
          image_url,
          start_date::date AS start_date,
          end_date::date AS end_date,
          visibility
        FROM courses
        WHERE id = $1
      `,
      [courseId]
    );
    res.json(course);
  });

  app.put("/api/courses/:id", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    const courseId = Number(req.params.id);
    if (!(await canManageCourse(req.user, courseId))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const existingCourse = await queryOne<any>("SELECT * FROM courses WHERE id = $1", [courseId]);
    if (!existingCourse) return res.status(404).json({ error: "Course not found" });

    const {
      name,
      code,
      description,
      start_date,
      end_date,
      visibility,
      instructor,
      credits,
      image_url,
      faculty_info,
      teaching_assistant,
      learning_outcomes,
      evaluation_components,
      feedback_trigger_session,
      sessions,
      enrolled_student_ids,
    } = req.body || {};
    const nextName = String(name ?? existingCourse.name ?? "").trim();
    const nextCode = String(code ?? existingCourse.code ?? "").trim();
    if (!nextName || !nextCode) {
      return res.status(400).json({ error: "name and code are required" });
    }

    const normalizedCredits = normalizeCourseCredits(credits ?? existingCourse.credits);
    const normalizedStart = normalizeDateOnly(start_date ?? existingCourse.start_date);
    const normalizedEnd = normalizeDateOnly(end_date ?? existingCourse.end_date);
    if (!normalizedStart || !normalizedEnd) {
      return res.status(400).json({ error: "start_date and end_date are required" });
    }
    const dateWindowError = validateCourseWindow(normalizedStart, normalizedEnd, normalizedCredits);
    if (dateWindowError) {
      return res.status(400).json({ error: dateWindowError });
    }
    const existingDetails = await queryOne<any>("SELECT * FROM course_details WHERE course_id = $1", [courseId]);
    const normalizedEvaluation = normalizeEvaluationComponents(
      evaluation_components ?? existingDetails?.evaluation_components
    );
    if (normalizedEvaluation.length > 0 && getEvaluationTotal(normalizedEvaluation) !== 100) {
      return res.status(400).json({ error: "Evaluation weightages must add up to 100%." });
    }
    const normalizedOutcomes = normalizeLearningOutcomes(
      learning_outcomes ?? existingDetails?.learning_outcomes
    );
    const existingSessions = await query<any>(
      `
        SELECT session_number, title, session_date, start_time, end_time, mode
        FROM course_sessions
        WHERE course_id = $1
        ORDER BY session_date ASC, session_number ASC
      `,
      [courseId]
    );
    const sessionPayload = normalizeSessionPayload(
      sessions ?? existingSessions,
      normalizedStart,
      normalizedEnd,
      normalizedCredits
    );
    if (sessionPayload.error) {
      return res.status(400).json({ error: sessionPayload.error });
    }
    const normalizedFeedbackTrigger = normalizeFeedbackTriggerSession(
      feedback_trigger_session ?? existingDetails?.feedback_trigger_session,
      sessionsRequiredForCredits(normalizedCredits)
    );
    const normalizedStudentIds = Array.isArray(enrolled_student_ids)
      ? [...new Set(enrolled_student_ids.map((id: any) => Number(id)).filter((id: number) => id > 0))]
      : [];

    const existingCode = await queryOne<{ id: number }>(
      "SELECT id FROM courses WHERE LOWER(code) = LOWER($1) AND created_by = $2 AND id <> $3 LIMIT 1",
      [nextCode, req.user.id, courseId]
    );
    if (existingCode) {
      return res.status(400).json({ error: "You already have a course with this code" });
    }

    await execute(
      `
        UPDATE courses
        SET name = $1,
            code = $2,
            description = $3,
            image_url = $4,
            start_date = $5::date,
            end_date = $6::date,
            visibility = $7,
            instructor = $8,
            credits = $9
        WHERE id = $10
      `,
      [
        nextName,
        nextCode,
        description ?? existingCourse.description ?? null,
        image_url !== undefined ? (image_url ? String(image_url) : null) : existingCourse.image_url ?? null,
        normalizedStart,
        normalizedEnd,
        visibility === "hide" ? "hide" : "show",
        instructor ? String(instructor) : existingCourse.instructor || null,
        normalizedCredits,
        courseId,
      ]
    );
    await execute(
      `
        INSERT INTO course_details (
          course_id,
          faculty_info,
          teaching_assistant,
          credits,
          feedback_trigger_session,
          learning_outcomes,
          evaluation_components
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
        ON CONFLICT (course_id)
        DO UPDATE SET
          faculty_info = EXCLUDED.faculty_info,
          teaching_assistant = EXCLUDED.teaching_assistant,
          credits = EXCLUDED.credits,
          feedback_trigger_session = EXCLUDED.feedback_trigger_session,
          learning_outcomes = EXCLUDED.learning_outcomes,
          evaluation_components = EXCLUDED.evaluation_components
      `,
      [
        courseId,
        faculty_info !== undefined
          ? String(faculty_info || "").trim() || null
          : existingDetails?.faculty_info ?? null,
        teaching_assistant !== undefined
          ? String(teaching_assistant || "").trim() || null
          : existingDetails?.teaching_assistant ?? null,
        normalizedCredits,
        normalizedFeedbackTrigger,
        JSON.stringify(normalizedOutcomes),
        JSON.stringify(normalizedEvaluation),
      ]
    );
    await replaceCourseSessions(courseId, sessionPayload.sessions, req.user.id);
    for (const studentId of normalizedStudentIds) {
      const validStudent = await queryOne<{ id: number }>(
        "SELECT id FROM users WHERE id = $1 AND role = 'student'",
        [studentId]
      );
      if (!validStudent) continue;
      await execute(
        `
          INSERT INTO enrollments (user_id, course_id, progress, last_accessed)
          VALUES ($1, $2, 0, NOW())
          ON CONFLICT (user_id, course_id)
          DO NOTHING
        `,
        [studentId, courseId]
      );
    }
    await ensureFeedbackFormForCourse(courseId);
    res.json({ success: true });
  });

  app.delete("/api/courses/:id", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    const courseId = Number(req.params.id);
    if (!Number.isFinite(courseId) || courseId <= 0) {
      return res.status(400).json({ error: "Invalid course id" });
    }
    if (!(await canManageCourse(req.user, courseId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const existing = await queryOne<{ id: number }>("SELECT id FROM courses WHERE id = $1", [courseId]);
    if (!existing) return res.status(404).json({ error: "Course not found" });

    await execute(
      `
        DELETE FROM feedback_submissions
        WHERE course_id = $1
      `,
      [courseId]
    );
    await execute(
      `
        DELETE FROM feedback_forms
        WHERE course_id = $1
      `,
      [courseId]
    );
    await execute(
      `
        DELETE FROM material_learning_progress
        WHERE material_id IN (SELECT id FROM course_materials WHERE course_id = $1)
      `,
      [courseId]
    );
    await execute(
      `
        DELETE FROM material_quiz_attempts
        WHERE material_id IN (SELECT id FROM course_materials WHERE course_id = $1)
      `,
      [courseId]
    );
    await execute(
      `
        DELETE FROM material_quiz_questions
        WHERE material_id IN (SELECT id FROM course_materials WHERE course_id = $1)
      `,
      [courseId]
    );
    await execute("DELETE FROM course_materials WHERE course_id = $1", [courseId]);
    await execute(
      `
        DELETE FROM submissions
        WHERE activity_id IN (SELECT id FROM activities WHERE course_id = $1)
      `,
      [courseId]
    );
    await execute("DELETE FROM activities WHERE course_id = $1", [courseId]);
    await execute("DELETE FROM enrollments WHERE course_id = $1", [courseId]);
    await execute("DELETE FROM course_sessions WHERE course_id = $1", [courseId]);
    await execute("DELETE FROM course_details WHERE course_id = $1", [courseId]);
    await execute("DELETE FROM sections WHERE course_id = $1", [courseId]);
    await execute("DELETE FROM courses WHERE id = $1", [courseId]);

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
        ORDER BY session_date ASC, session_number ASC
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
    const normalizedSessionDate = normalizeDateOnly(session_date);
    if (!title || !normalizedSessionDate) {
      return res.status(400).json({ error: "title and session_date are required" });
    }

    const course = await queryOne<any>(
      "SELECT start_date, end_date, credits FROM courses WHERE id = $1",
      [courseId]
    );
    const courseStart = normalizeDateOnly(course?.start_date);
    const courseEnd = normalizeDateOnly(course?.end_date);
    if (!courseStart || !courseEnd) {
      return res.status(400).json({ error: "Course must have valid start and end dates." });
    }
    if (normalizedSessionDate < courseStart || normalizedSessionDate > courseEnd) {
      return res.status(400).json({ error: "Session date must be within course start/end dates." });
    }

    const expectedSessions = sessionsRequiredForCredits(Number(course?.credits || 1));
    const maxSession = await queryOne<{ max_no: number }>(
      "SELECT COALESCE(MAX(session_number), 0)::int AS max_no FROM course_sessions WHERE course_id = $1",
      [courseId]
    );
    const nextSession = (maxSession?.max_no ?? 0) + 1;
    if (nextSession > expectedSessions) {
      return res.status(400).json({
        error: `This course is configured for ${expectedSessions} sessions based on credits.`,
      });
    }

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
        normalizedSessionDate,
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
        ORDER BY session_date ASC, session_number ASC
      `,
      [courseId]
    );
    res.json({ success: true, sessions });
  });

  app.put("/api/courses/:id/sessions/:sessionId", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    const courseId = Number(req.params.id);
    const sessionId = Number(req.params.sessionId);
    if (!(await canManageCourse(req.user, courseId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const session = await queryOne<any>(
      `
        SELECT id, session_number, title, session_date, start_time, end_time, mode
        FROM course_sessions
        WHERE id = $1 AND course_id = $2
      `,
      [sessionId, courseId]
    );
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const nextTitle = String(req.body?.title ?? session.title ?? "").trim();
    const normalizedSessionDate = normalizeDateOnly(req.body?.session_date ?? session.session_date);
    const nextStartTime = req.body?.start_time ? String(req.body.start_time) : null;
    const nextEndTime = req.body?.end_time ? String(req.body.end_time) : null;
    const nextMode = req.body?.mode ? String(req.body.mode) : "classroom";

    if (!nextTitle || !normalizedSessionDate) {
      return res.status(400).json({ error: "title and session_date are required" });
    }

    const course = await queryOne<any>(
      "SELECT start_date, end_date, credits FROM courses WHERE id = $1",
      [courseId]
    );
    const courseStart = normalizeDateOnly(course?.start_date);
    const courseEnd = normalizeDateOnly(course?.end_date);
    if (!courseStart || !courseEnd) {
      return res.status(400).json({ error: "Course must have valid start and end dates." });
    }
    if (normalizedSessionDate < courseStart || normalizedSessionDate > courseEnd) {
      return res.status(400).json({ error: "Session date must be within course start/end dates." });
    }
    const expectedSessions = sessionsRequiredForCredits(Number(course?.credits || 1));
    if (Number(session.session_number) === 1 && normalizedSessionDate !== courseStart) {
      return res.status(400).json({ error: "Session S1 date must match the course start date." });
    }
    if (Number(session.session_number) === expectedSessions && normalizedSessionDate !== courseEnd) {
      return res.status(400).json({ error: "Last session date must match the course end date." });
    }

    await execute(
      `
        UPDATE course_sessions
        SET title = $1,
            session_date = $2::date,
            start_time = $3,
            end_time = $4,
            mode = $5
        WHERE id = $6
      `,
      [nextTitle, normalizedSessionDate, nextStartTime, nextEndTime, nextMode, sessionId]
    );
    await ensureFeedbackFormForCourse(courseId);
    res.json({ success: true });
  });

  app.get("/api/courses/:id/feedback/active", authenticate, async (req: any, res) => {
    if (req.user.role !== "student") return res.status(403).json({ error: "Forbidden" });
    const courseId = Number(req.params.id);
    if (!(await canAccessCourse(req.user, courseId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await ensureFeedbackFormForCourse(courseId);
    const nowOverride = getNowOverride(req);
    const form = await queryOne<any>(
      `
        SELECT id, due_at
        FROM feedback_forms
        WHERE course_id = $1
          AND COALESCE($2::timestamptz, NOW()) >= open_at
          AND COALESCE($2::timestamptz, NOW()) <= due_at
        ORDER BY due_at DESC
        LIMIT 1
      `,
      [courseId, nowOverride]
    );

    if (!form) return res.json(null);

    const submitted = await queryOne<any>(
      "SELECT 1 FROM feedback_submissions WHERE form_id = $1 AND user_id = $2",
      [form.id, req.user.id]
    );
    const questions = await query<any>(
      `
        SELECT id, question_order, question_text, question_type, options, required
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
        required: Boolean(q.required),
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

    const nowOverride = getNowOverride(req);
    const form = await queryOne<any>(
      `
        SELECT id
        FROM feedback_forms
        WHERE id = $1
          AND course_id = $2
          AND COALESCE($3::timestamptz, NOW()) >= open_at
          AND COALESCE($3::timestamptz, NOW()) <= due_at
      `,
      [formId, courseId, nowOverride]
    );
    if (!form) return res.status(400).json({ error: "Feedback form is not active" });

    const questions = await query<any>(
      `
        SELECT id, question_type, options, required
        FROM feedback_questions
        WHERE form_id = $1
        ORDER BY question_order ASC
      `,
      [formId]
    );
    if (questions.length === 0) {
      return res.status(400).json({ error: "Feedback form has no questions configured" });
    }

    const incomingByQuestion = new Map<number, any>();
    for (const rawAnswer of answers) {
      const questionId = Number(rawAnswer?.question_id);
      if (!questionId) continue;
      incomingByQuestion.set(questionId, rawAnswer);
    }

    const normalizedAnswers = [];
    for (const question of questions) {
      const answer = incomingByQuestion.get(Number(question.id));
      const isRequired = Boolean(question.required);
      const type = String(question.question_type || "");
      if (!answer) {
        if (isRequired) {
          return res.status(400).json({ error: "Please answer all required feedback questions." });
        }
        continue;
      }

      if (type === "mcq") {
        const options = safeJson(question.options, []);
        const choiceValue = Number(answer.choice_value);
        if (!Number.isInteger(choiceValue) || choiceValue < 1 || choiceValue > options.length) {
          return res.status(400).json({ error: "Invalid response for one or more MCQ questions." });
        }
        normalizedAnswers.push({
          question_id: Number(question.id),
          choice_value: choiceValue,
          answer_text: "",
        });
      } else {
        const answerText = String(answer.answer_text || "").trim();
        if (isRequired && !answerText) {
          return res.status(400).json({ error: "Please answer all required feedback questions." });
        }
        normalizedAnswers.push({
          question_id: Number(question.id),
          choice_value: null,
          answer_text: answerText,
        });
      }
    }

    try {
      await execute(
        `
          INSERT INTO feedback_submissions (form_id, course_id, user_id, answers)
          VALUES ($1, $2, $3, $4::jsonb)
        `,
        [formId, courseId, req.user.id, JSON.stringify(normalizedAnswers)]
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
    const nowOverride = getNowOverride(req);

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

    for (const form of forms) {
      await ensureFeedbackInsightForForm(Number(form.id), nowOverride);
    }

    const formIds = forms.map((form) => Number(form.id)).filter((id) => id > 0);
    let insightRows: any[] = [];
    if (formIds.length > 0) {
      const placeholders = formIds.map((_, idx) => `$${idx + 1}`).join(", ");
      insightRows = await query<any>(
        `
          SELECT form_id, summary_text
          FROM feedback_insights
          WHERE form_id IN (${placeholders})
        `,
        formIds
      );
    }
    const insightByFormId = new Map<number, string>();
    insightRows.forEach((row) => {
      insightByFormId.set(Number(row.form_id), String(row.summary_text || ""));
    });

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
        summary_text: insightByFormId.get(Number(form.id)) || "",
        metrics,
      });
    }

    res.json({ forms: responseForms });
  });

  app.get("/api/faculty/feedback-insights/pending", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    const nowOverride = getNowOverride(req);

    const dueForms = await query<{ id: number }>(
      `
        SELECT f.id
        FROM feedback_forms f
        JOIN courses c ON c.id = f.course_id
        WHERE c.created_by = $1
          AND COALESCE($2::timestamptz, NOW()) > f.due_at
      `,
      [req.user.id, nowOverride]
    );

    for (const form of dueForms) {
      await ensureFeedbackInsightForForm(Number(form.id), nowOverride);
    }

    const insights = await query<any>(
      `
        SELECT
          fi.id,
          fi.form_id,
          fi.course_id,
          fi.submissions_count,
          fi.summary_text,
          fi.metrics_json,
          fi.text_comments_json,
          fi.generated_at,
          f.trigger_session_number,
          f.open_at,
          f.due_at,
          c.name AS course_name,
          c.code AS course_code
        FROM feedback_insights fi
        JOIN feedback_forms f ON f.id = fi.form_id
        JOIN courses c ON c.id = fi.course_id
        WHERE c.created_by = $1
          AND fi.viewed_at IS NULL
          AND fi.submissions_count > 0
          AND COALESCE($2::timestamptz, NOW()) > f.due_at
        ORDER BY f.due_at DESC, fi.generated_at DESC
      `,
      [req.user.id, nowOverride]
    );

    res.json(
      insights.map((insight) => ({
        id: insight.id,
        form_id: insight.form_id,
        course_id: insight.course_id,
        course_name: insight.course_name,
        course_code: insight.course_code,
        trigger_session_number: insight.trigger_session_number,
        open_at: insight.open_at,
        due_at: insight.due_at,
        submissions_count: Number(insight.submissions_count || 0),
        summary_text: String(insight.summary_text || ""),
        metrics: safeJson(insight.metrics_json, []),
        text_comments: safeJson(insight.text_comments_json, []),
        generated_at: insight.generated_at,
      }))
    );
  });

  app.post("/api/faculty/feedback-insights/:id/viewed", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    const insightId = Number(req.params.id);
    if (!insightId) return res.status(400).json({ error: "Invalid insight id" });

    const insight = await queryOne<{ id: number }>(
      `
        SELECT fi.id
        FROM feedback_insights fi
        JOIN courses c ON c.id = fi.course_id
        WHERE fi.id = $1 AND c.created_by = $2
        LIMIT 1
      `,
      [insightId, req.user.id]
    );
    if (!insight) return res.status(404).json({ error: "Insight not found" });

    await execute("UPDATE feedback_insights SET viewed_at = NOW() WHERE id = $1", [insightId]);
    res.json({ success: true });
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
          m.due_at,
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
        feedback_trigger_session: normalizeFeedbackTriggerSession(
          details?.feedback_trigger_session,
          sessionsRequiredForCredits(Number(details?.credits || course?.credits || 1))
        ),
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
    const { faculty_info, teaching_assistant, credits, feedback_trigger_session, learning_outcomes, evaluation_components } =
      req.body || {};
    const existingDetails = await queryOne<any>("SELECT * FROM course_details WHERE course_id = $1", [courseId]);
    const normalizedEvaluation = normalizeEvaluationComponents(
      evaluation_components ?? existingDetails?.evaluation_components ?? []
    );
    if (normalizedEvaluation.length > 0 && getEvaluationTotal(normalizedEvaluation) !== 100) {
      return res.status(400).json({ error: "Evaluation weightages must add up to 100%." });
    }
    const normalizedCredits = normalizeCourseCredits(credits ?? existingDetails?.credits ?? 1);
    const normalizedFeedbackTrigger = normalizeFeedbackTriggerSession(
      feedback_trigger_session ?? existingDetails?.feedback_trigger_session,
      sessionsRequiredForCredits(normalizedCredits)
    );

    await execute(
      `
        INSERT INTO course_details (
          course_id,
          faculty_info,
          teaching_assistant,
          credits,
          feedback_trigger_session,
          learning_outcomes,
          evaluation_components
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
        ON CONFLICT (course_id)
        DO UPDATE SET
          faculty_info = EXCLUDED.faculty_info,
          teaching_assistant = EXCLUDED.teaching_assistant,
          credits = EXCLUDED.credits,
          feedback_trigger_session = EXCLUDED.feedback_trigger_session,
          learning_outcomes = EXCLUDED.learning_outcomes,
          evaluation_components = EXCLUDED.evaluation_components
      `,
      [
        courseId,
        faculty_info !== undefined
          ? String(faculty_info || "").trim() || null
          : existingDetails?.faculty_info ?? null,
        teaching_assistant !== undefined
          ? String(teaching_assistant || "").trim() || null
          : existingDetails?.teaching_assistant ?? null,
        normalizedCredits,
        normalizedFeedbackTrigger,
        JSON.stringify(
          normalizeLearningOutcomes(learning_outcomes ?? existingDetails?.learning_outcomes ?? [])
        ),
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
          m.due_at,
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
      due_at,
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
    const dueDateOnly = normalizeDateOnly(due_at);
    const dueAt = dueDateOnly ? `${dueDateOnly}T23:59:59Z` : null;

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
            due_at,
            created_by
          )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10::jsonb,
          $11,
          CASE WHEN $11 THEN NOW() ELSE NULL END,
          CASE WHEN $11 THEN COALESCE($12::timestamptz, NOW() + INTERVAL '2 day') ELSE NULL END,
          $13
        )
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
        dueAt,
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
    const dueDateOnly = normalizeDateOnly(req.body?.due_at);
    const dueAt = dueDateOnly ? `${dueDateOnly}T23:59:59Z` : null;
    const material = await queryOne<any>("SELECT id, course_id FROM course_materials WHERE id = $1", [materialId]);
    if (!material) return res.status(404).json({ error: "Material not found" });
    if (!(await canManageCourse(req.user, Number(material.course_id)))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await execute(
      `
        UPDATE course_materials
        SET is_assigned = $1,
            assigned_at = CASE WHEN $1 THEN NOW() ELSE NULL END,
            due_at = CASE WHEN $1 THEN COALESCE($2::timestamptz, due_at, NOW() + INTERVAL '2 day') ELSE NULL END
        WHERE id = $3
      `,
      [assigned, dueAt, materialId]
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

  app.post("/api/courses/:id/enrol-bulk", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    const courseId = Number(req.params.id);
    if (!(await canManageCourse(req.user, courseId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const userIds: number[] = Array.isArray(req.body?.user_ids)
      ? [...new Set<number>(req.body.user_ids.map((id: any) => Number(id)).filter((id: number) => id > 0))]
      : [];
    if (userIds.length === 0) {
      return res.status(400).json({ error: "Select at least one student." });
    }

    const validIds: number[] = [];
    for (const userId of userIds) {
      const student = await queryOne<{ id: number }>(
        "SELECT id FROM users WHERE role = 'student' AND id = $1 LIMIT 1",
        [userId]
      );
      if (student?.id) validIds.push(Number(student.id));
    }
    if (validIds.length === 0) {
      return res.status(400).json({ error: "No valid students selected." });
    }

    for (const studentId of validIds) {
      await execute(
        `
          INSERT INTO enrollments (user_id, course_id, progress, last_accessed)
          VALUES ($1, $2, 0, NOW())
          ON CONFLICT (user_id, course_id)
          DO NOTHING
        `,
        [studentId, courseId]
      );
    }

    res.json({ success: true, enrolled_count: validIds.length });
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

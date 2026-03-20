import "./env";
import express from "express";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
// @ts-ignore – import lib path directly to avoid pdf-parse's startup test-file load
import pdfParse from "pdf-parse/lib/pdf-parse.js";
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
const execFileAsync = promisify(execFile);

type SummaryPayload = {
  title: string;
  summary: string;
  keyTakeaways: string[];
  keyTakeawayLabels?: string[];
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
    question_text: "How confident are you in applying the core concepts to a real-world problem?",
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
    return stripUnsupportedTextChars(textChunks.join(" ").replace(/\s+/g, " ").trim());
  } catch {
    return "";
  }
}

function stripUnsupportedTextChars(value: any): string {
  return String(value ?? "")
    .replace(/\u0000/g, " ")
    .replace(/[\uD800-\uDFFF]/g, "");
}

function normalizePdfBase64Input(value: any): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const withoutPrefix = raw.replace(/^data:[^;]+;base64,/i, "");
  const compact = stripUnsupportedTextChars(withoutPrefix).replace(/\s+/g, "");
  if (!compact) return null;

  const isBase64 = /^[A-Za-z0-9+/=]+$/.test(compact);
  if (isBase64) return compact;

  // If malformed binary text arrives, re-encode it into clean base64.
  return Buffer.from(compact, "latin1").toString("base64");
}

function normalizeExtractedPdfText(value: any): string {
  return String(value ?? "")
    .replace(/\u0000/g, " ")
    .replace(/[^\x20-\x7E\n\r\t]/g, " ")
    .replace(/\\+/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isLikelyReadableExtractedText(value: string): boolean {
  const text = String(value || "").trim();
  if (text.length < 280) return false;
  if (/mozilla\/5\.0|skia\/pdf|%pdf|endstream|obj\s+\d+/i.test(text)) return false;

  const letters = (text.match(/[A-Za-z]/g) || []).length;
  const digits = (text.match(/[0-9]/g) || []).length;
  const weird = (text.match(/[^A-Za-z0-9\s.,;:!?'"()\-/%&]/g) || []).length;
  const repeatedRuns = (text.match(/(.)\1{6,}/g) || []).length;
  const words = text.split(/\s+/).filter(Boolean);
  const uniqueWords = new Set(words.map((word) => word.toLowerCase()));
  const uniqueRatio = words.length > 0 ? uniqueWords.size / words.length : 0;

  const total = Math.max(1, text.length);
  const letterRatio = letters / total;
  const digitRatio = digits / total;
  const weirdRatio = weird / total;

  if (letterRatio < 0.45) return false;
  if (digitRatio > 0.25) return false;
  if (weirdRatio > 0.02) return false;
  if (repeatedRuns > 2) return false;
  if (uniqueRatio < 0.18) return false;
  return true;
}

function countVisualReferences(text: string): number {
  return (String(text || "").match(/\b(exhibits?|figures?|tables?|charts?)\s+[a-z0-9-]+/gi) || []).length;
}

function extractVisualReferenceDigest(text: string, maxChars = 1800): string {
  const cleaned = normalizeExtractedPdfText(cleanOCRText(text));
  if (!cleaned) return "";

  const lines = cleaned
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const captions = Array.from(
    new Set(
      lines
        .filter((line) => /^(exhibit|figure|table|chart)\s+[a-z0-9-]+/i.test(line))
        .map((line) => clipText(line, 220))
    )
  ).slice(0, 18);

  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 50);

  const mentionParagraphs = Array.from(
    new Set(
      paragraphs.filter((paragraph) => /\b(exhibits?|figures?|tables?|charts?)\b/i.test(paragraph))
    )
  );

  const sections: string[] = [];
  if (captions.length > 0) {
    sections.push(`VISUAL REFERENCES:\n- ${captions.join("\n- ")}`);
  }

  if (mentionParagraphs.length > 0) {
    const snippets: string[] = [];
    let used = 0;
    for (const paragraph of mentionParagraphs) {
      const clipped = clipText(paragraph, 420);
      if (used + clipped.length > maxChars) break;
      snippets.push(clipped);
      used += clipped.length + 2;
      if (snippets.length >= 8) break;
    }
    if (snippets.length > 0) {
      sections.push(`WHAT THE TEXT SAYS ABOUT THE VISUALS:\n${snippets.join("\n\n")}`);
    }
  }

  return sections.join("\n\n").slice(0, maxChars).trim();
}

function mergePdfExtractions(primaryText: string, visionText: string): string {
  const primary = normalizeExtractedPdfText(primaryText);
  const vision = normalizeExtractedPdfText(visionText);
  if (!vision) return primary;
  if (!primary) return vision;

  const primaryReadable = isLikelyReadableExtractedText(primary);
  const visionDigest = extractVisualReferenceDigest(vision, 2400);
  if (primaryReadable) {
    if (!visionDigest) return primary;
    const primaryLower = primary.toLowerCase();
    const uniqueDigestLines = visionDigest
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 10 && !primaryLower.includes(line.toLowerCase()));
    if (uniqueDigestLines.length === 0) return primary;
    return `${primary}\n\nVISUAL OCR NOTES:\n${uniqueDigestLines.join("\n")}`.trim();
  }

  const combinedSections = [primary, vision];
  return combinedSections
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 120000)
    .trim();
}

async function extractPdfTextWithVisionOCR(sourceFileBase64: string, maxPages = 18): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wisenet-pdf-ocr-"));
  const pdfPath = path.join(tempDir, "source.pdf");
  const swiftScript = path.join(__dirname, "scripts", "pdf_ocr.swift");

  try {
    await fs.writeFile(pdfPath, Buffer.from(sourceFileBase64, "base64"));
    const moduleCachePath = path.join(tempDir, "module-cache");
    const { stdout } = await execFileAsync(
      "/usr/bin/swift",
      [swiftScript, pdfPath, String(maxPages)],
      {
        timeout: 120000,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          CLANG_MODULE_CACHE_PATH: moduleCachePath,
          SWIFT_MODULECACHE_PATH: moduleCachePath,
        },
      }
    );
    const payload = safeJson(stdout, {}) as {
      pages?: { pageNumber?: number; pdfText?: string; ocrText?: string }[];
    };
    const pageBlocks = Array.isArray(payload.pages) ? payload.pages : [];
    return pageBlocks
      .map((page) => {
        const pageNumber = Number(page?.pageNumber || 0);
        const pdfText = normalizeExtractedPdfText(page?.pdfText || "");
        const ocrText = normalizeExtractedPdfText(page?.ocrText || "");
        const parts = [pdfText];
        if (ocrText && !pdfText.toLowerCase().includes(ocrText.toLowerCase().slice(0, 80))) {
          parts.push(ocrText);
        }
        if (parts.filter(Boolean).length === 0) return "";
        return `Page ${pageNumber || "?"}\n${parts.filter(Boolean).join("\n\n")}`.trim();
      })
      .filter(Boolean)
      .join("\n\n");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function extractPdfTextWithPython(sourceFileBase64: string): Promise<string> {
  const buffer = Buffer.from(sourceFileBase64, "base64");
  const data = await pdfParse(buffer);
  const extractedText = String(data.text || "");
  const normalizedExtracted = normalizeExtractedPdfText(extractedText);
  // Only run Vision OCR if pdf-parse failed to extract readable text.
  // Referencing tables/figures in body text is not a reason to OCR an otherwise readable PDF.
  const shouldRunVisionOcr = !isLikelyReadableExtractedText(normalizedExtracted);

  if (!shouldRunVisionOcr) {
    return extractedText;
  }

  try {
    const visionText = await extractPdfTextWithVisionOCR(sourceFileBase64, 10);
    return mergePdfExtractions(extractedText, visionText);
  } catch (error) {
    console.warn("Vision OCR PDF extraction failed; using text extraction only.", error);
    return extractedText;
  }
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Clean common OCR/PDF-extraction artefacts before text is processed:
 *  - Page numbers bled into the start of a word  ("1Just" → "Just", "217 An" → "An")
 *  - Footnote superscripts stuck to a capital    ("text4 The next" → "text. The next")
 *  - Isolated single/double-letter tokens from bad hyphenation ("zzly afternoo" style)
 *  - Repeated underscores / dashes used as dividers
 */
function cleanOCRText(text: string): string {
  return text
    // page-number bleeding: digit(s) immediately followed by a capital letter at a word boundary
    .replace(/(?<!\w)\d{1,3}(?=[A-Z][a-z])/g, "")
    // footnote superscripts between a word and a space/capital
    .replace(/(?<=[a-z])\d{1,2}(?=\s+[A-Z])/g, ".")
    // lines that are mostly underscores or dashes (dividers / redactions)
    .replace(/^[_\-\s]{4,}$/gm, "")
    // collapse leftover double-spaces
    .replace(/ {2,}/g, " ")
    .trim();
}

function splitSentences(text: string) {
  return cleanOCRText(text)
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

function stripEndnotesSection(text: string): string {
  // Remove trailing endnotes / references section so it doesn't skew summarisation
  return text
    .replace(/\n?(end\s*notes?|references?|bibliography|footnotes?)\s*\n[\s\S]{0,6000}$/i, "")
    .replace(/(\s*\d{1,3}\s+(ibid\.?|supra|see\s+also)[^\n]{0,200}){3,}/gi, " ")
    .trim();
}

// Patterns that identify boilerplate / front-matter sentences in academic or institutional PDFs
const BOILERPLATE_PATTERNS: RegExp[] = [
  /\b(copyright|©|\(c\))\s*\d{4}/i,
  /all rights reserved/i,
  /professor\s+\w+\s+(and\s+)?(research\s+associate|senior\s+lecturer)/i,
  /prepared\s+(this|the)\s+(case|document|material)/i,
  /this (case|document|material|reading) (is not based|was (prepared|written|developed)|discusses|is intended)/i,
  /for the exclusive use of/i,
  /reproduction\s+(or|and)\s+(transmission)/i,
  /do not\s+copy\s+(or|and)\s+post/i,
  /course\s*pack/i,
  /solely\s+for\s+(use|educational|class)/i,
  /case\s+(development|clearance)\s+was\s+provided/i,
  /isb[n\d][\s\-\d]{6,}/i,
  /^\s*[a-z]?\d{1,2}[\-–]\d{3,6}[\-–\s]/i,   // academic ref numbers like 9-914-044
  /^\s*[A-Z]{1,3}[\-\/]\d{3,6}/,               // short ref codes e.g. DOC-123456
  /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}\.?$/i,
  /rev(ised|\.)\s+\w+\s+\d{4}/i,
  /this document is authorized/i,
  /discussed in this (case|document|reading) is fictitious/i,
  /confidential.*not for distribution/i,
  /for internal use only/i,
  /^[\d\s\.\-–]{1,20}$/,
];

function isBoilerplate(sentence: string): boolean {
  const trimmed = sentence.trim();
  if (trimmed.length < 15) return true;
  // Mostly non-alpha (e.g. "9-914-044  JUNE 17, 2014")
  const alphaRatio = (trimmed.match(/[a-zA-Z]/g) || []).length / trimmed.length;
  if (alphaRatio < 0.45 && trimmed.length < 100) return true;
  // Garbled OCR: high ratio of 1-2 char tokens (e.g. "3I e other zzly afternoo ntation")
  const words = trimmed.split(/\s+/);
  if (words.length >= 5) {
    const shortRatio = words.filter((w) => /^[a-zA-Z0-9]{1,2}$/.test(w)).length / words.length;
    if (shortRatio > 0.40) return true;
  }
  return BOILERPLATE_PATTERNS.some((p) => p.test(trimmed));
}

function jaccardSimilarity(a: string, b: string): number {
  const tokenize = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3));
  const setA = tokenize(a);
  const setB = tokenize(b);
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function buildTFIDFSummaryPayload(title: string, content: string, detailLevel: "Brief" | "Standard" | "Detailed" = "Standard"): SummaryPayload {
  // Strip endnotes before processing
  const cleanedContent = stripEndnotesSection(content);
  const sentences = splitSentences(cleanedContent).filter(
    (s) =>
      s.length > 40 &&
      !/^\s*\d+\s*(ibid|supra|http)/i.test(s) &&
      !isBoilerplate(s)
  );

  if (sentences.length === 0) {
    const fallback = cleanedContent.slice(0, 600).trim() || "No content to summarize.";
    return {
      title,
      summary: fallback,
      keyTakeaways: [fallback],
      furtherReading: [
        `Review foundational texts on ${title}.`,
        `Find a case study applying ${title} in practice.`,
        `Review recent research articles related to ${title}.`,
      ],
    };
  }

  // Tokenize each sentence
  const tokenize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(
      (w) => w.length >= 3 && !STOPWORDS.has(w)
    );

  const sentenceTokens = sentences.map(tokenize);
  const N = sentences.length;

  // Compute document frequency (how many sentences contain each term)
  const docFreq = new Map<string, number>();
  for (const tokens of sentenceTokens) {
    for (const t of new Set(tokens)) {
      docFreq.set(t, (docFreq.get(t) || 0) + 1);
    }
  }

  // Score each sentence using TF-IDF + position bonus
  const scores = sentences.map((_, i) => {
    const tokens = sentenceTokens[i];
    if (tokens.length === 0) return 0;

    const freq = new Map<string, number>();
    for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);

    let score = 0;
    for (const [term, count] of freq) {
      const tf = count / tokens.length;
      const idf = Math.log((N + 1) / ((docFreq.get(term) || 0) + 1));
      score += tf * idf;
    }
    score /= Math.sqrt(tokens.length);
    return score;
  });

  // Pick more sentences for a richer summary
  const ranked = scores
    .map((score, i) => ({ i, score }))
    .sort((a, b) => b.score - a.score);

  const summaryCount = Math.min(6, Math.max(3, Math.ceil(sentences.length * 0.08)));
  const summaryIndices = ranked.slice(0, summaryCount).map((x) => x.i).sort((a, b) => a - b);
  const summary = summaryIndices.map((i) => sentences[i]).join(" ");

  // Vary number of takeaways based on detail level
  const maxTakeaways = detailLevel === "Brief" ? 3 : detailLevel === "Detailed" ? 7 : 5;

  const usedSet = new Set(summaryIndices);
  const candidates = ranked.filter((x) => !usedSet.has(x.i));

  // Deduplicate: skip sentences shorter than 60 chars or too similar to already-selected ones
  const selectedTakeaways: string[] = [];
  for (const { i } of candidates) {
    if (selectedTakeaways.length >= maxTakeaways) break;
    const sentence = sentences[i];
    if (sentence.length < 60) continue;
    const tooSimilar = selectedTakeaways.some((prev) => jaccardSimilarity(prev, sentence) > 0.5);
    if (tooSimilar) continue;
    // Truncate at nearest sentence boundary if over 180 chars
    const truncated = sentence.length > 180 ? sentence.slice(0, 180).replace(/\s\S+$/, "") + "…" : sentence;
    selectedTakeaways.push(truncated);
  }
  let keyTakeaways = selectedTakeaways;

  if (keyTakeaways.length < 3) {
    for (const i of summaryIndices) {
      if (keyTakeaways.length >= 5) break;
      keyTakeaways.push(sentences[i]);
    }
  }

  // Generate further reading from top content keywords
  const topKeywords = [...docFreq.entries()]
    .filter(([term]) => !STOPWORDS.has(term) && term.length > 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([term]) => term);

  const kw0 = topKeywords[0] || title;
  const kw1 = topKeywords[1] || "these concepts";
  const kw2 = topKeywords[2] || "the key themes";
  const kw3 = topKeywords[3] || title;
  const kw4 = topKeywords[4] || "related literature";

  return {
    title,
    summary: summary || sentences[0] || cleanedContent.slice(0, 600),
    keyTakeaways: keyTakeaways.length > 0 ? keyTakeaways : [summary],
    furtherReading: [
      `Read a foundational text on "${kw0}" to build theoretical understanding.`,
      `Explore real-world applications of ${kw1} through examples or case studies.`,
      `Review academic literature connecting ${kw2} to current research.`,
      `Explore how ${kw3} connects to related fields and broader theoretical frameworks.`,
      `Search for recent journal articles discussing ${kw4} in similar industry contexts.`,
    ],
  };
}

// Keep old name as alias so existing call-sites don't break
const buildFallbackSummaryPayload = buildTFIDFSummaryPayload;

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
      question: `In a new practical scenario, what is the best first step using ideas from the reading?`,
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
        "Applying one fixed template without adapting to context.",
      ],
      correctAnswer: 0,
      explanation: "Concept mastery is demonstrated by transfer and justified adaptation.",
    },
  ];

  return conceptualQuestions;
}

/**
 * Shuffle the options of a quiz question, keeping correctAnswer pointing at the same option.
 */
function shuffleQuizOptions(q: QuizQuestionPayload): QuizQuestionPayload {
  const correctOption = q.options[q.correctAnswer];
  const shuffled = shuffle([...q.options]);
  return { ...q, options: shuffled, correctAnswer: shuffled.indexOf(correctOption) };
}

/**
 * Use Qwen to generate quiz questions from reading content.
 * Returns an array of QuizQuestionPayload (already shuffled) or throws on failure.
 */
async function generateQuizWithQwen(
  title: string,
  content: string,
  count: number
): Promise<QuizQuestionPayload[]> {
  const token = process.env.HF_TOKEN;
  if (!token) throw new Error("HF_TOKEN not configured");

  const model = process.env.HF_MODEL || "Qwen/Qwen2.5-7B-Instruct";
  const hfUrl = "https://router.huggingface.co/v1/chat/completions";
  const docContext = buildSummaryInputContext(cleanOCRText(content), 4000);

  const systemMsg = `You are a quiz writer creating multiple-choice questions for an academic reading titled "${title}".

READING MATERIAL:
"""
${docContext}
"""

Rules:
- Base every question STRICTLY on specific facts, names, numbers, or concepts from the reading.
- Do NOT use generic academic filler. Each question must be uniquely answerable from this specific text.
- correctAnswer is the 0-indexed position of the correct option (0, 1, 2, or 3).
- All 4 options must be plausible but only one correct.
- Questions must test understanding, not just recall.
- Return ONLY a valid JSON array — no markdown, no preamble.`;

  const userMsg = `Generate exactly ${count} multiple-choice questions that test conceptual understanding of the key ideas in this reading.

Return ONLY a JSON array of exactly ${count} objects:
{"question":"...","options":["A text","B text","C text","D text"],"correctAnswer":0,"explanation":"..."}`;

  const hfRes = await fetch(hfUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemMsg },
        { role: "user", content: userMsg },
      ],
      max_tokens: 1800,
      stream: false,
    }),
  });

  if (!hfRes.ok) {
    const e = await hfRes.text();
    throw new Error(`HF ${hfRes.status}: ${e.slice(0, 200)}`);
  }

  const data = await hfRes.json() as any;
  const raw: string = data?.choices?.[0]?.message?.content ?? "";
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("Model did not return a JSON array");

  const parsed = JSON.parse(match[0]) as any[];
  return parsed.slice(0, count).map((q: any, i: number) =>
    shuffleQuizOptions({
      question: String(q.question || `Question ${i + 1}`),
      options: Array.isArray(q.options) && q.options.length === 4
        ? q.options.map(String)
        : ["Option A", "Option B", "Option C", "Option D"],
      correctAnswer: typeof q.correctAnswer === "number" ? q.correctAnswer : 0,
      explanation: String(q.explanation || "See the reading material for details."),
    })
  );
}

/**
 * Strip obvious front-matter / boilerplate lines from the beginning of extracted PDF text
 * so the AI receives the substantive content first.
 */
function stripLeadingBoilerplate(text: string): string {
  // First clean OCR artefacts so boilerplate detection works on clean text
  const cleaned = cleanOCRText(text);
  const lines = cleaned.split(/\r?\n/);
  let start = 0;
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const line = lines[i].trim();
    if (line.length < 10 || isBoilerplate(line)) {
      start = i + 1;
    } else {
      break;
    }
  }
  const stripped = lines.slice(start).join("\n").trim();
  // If stripping removed too much, fall back to full cleaned text
  return stripped.length > 200 ? stripped : cleaned;
}

/**
 * Smart-sample a document so the summarisation model receives the most
 * informative portion within its token budget.
 * Priority: beginning (intro/abstract) >> end (conclusion) >> middle.
 */
function sampleForSummarization(text: string, maxChars = 3600): string {
  if (text.length <= maxChars) return text;
  const normalized = normalizeExtractedPdfText(text);
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 40);
  if (paragraphs.length <= 4) {
    const head = Math.floor(maxChars * 0.65);
    const tail = maxChars - head;
    return normalized.slice(0, head) + "\n\n[...]\n\n" + normalized.slice(-tail);
  }

  const introBudget = Math.floor(maxChars * 0.45);
  const visualBudget = Math.floor(maxChars * 0.2);
  const tailBudget = Math.floor(maxChars * 0.25);
  const bridgeBudget = Math.max(maxChars - introBudget - visualBudget - tailBudget, 0);

  const intro: string[] = [];
  let introSize = 0;
  for (const paragraph of paragraphs) {
    if (introSize + paragraph.length > introBudget) break;
    intro.push(paragraph);
    introSize += paragraph.length + 2;
  }

  const visualParagraphs = paragraphs.filter((paragraph) =>
    /\b(exhibits?|figures?|tables?|charts?)\b/i.test(paragraph)
  );
  const visuals: string[] = [];
  let visualSize = 0;
  for (const paragraph of visualParagraphs) {
    if (visualSize + paragraph.length > visualBudget) break;
    visuals.push(paragraph);
    visualSize += paragraph.length + 2;
    if (visuals.length >= 4) break;
  }

  const tail: string[] = [];
  let tailSize = 0;
  for (const paragraph of [...paragraphs].reverse()) {
    if (tailSize + paragraph.length > tailBudget) break;
    tail.unshift(paragraph);
    tailSize += paragraph.length + 2;
    if (tail.length >= 3) break;
  }

  const usedParagraphs = new Set([...intro, ...visuals, ...tail]);
  const bridge: string[] = [];
  let bridgeSize = 0;
  for (const paragraph of paragraphs) {
    if (usedParagraphs.has(paragraph)) continue;
    if (bridgeSize + paragraph.length > bridgeBudget) break;
    bridge.push(paragraph);
    bridgeSize += paragraph.length + 2;
    if (bridge.length >= 3) break;
  }

  return [...intro, ...visuals, ...bridge, ...tail]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, maxChars)
    .trim();
}

function buildSummaryInputContext(text: string, maxChars = 3600, focusPrompt = ""): string {
  const cleaned = stripLeadingBoilerplate(text);
  const targetedVisualContext = focusPrompt.trim()
    ? buildExhibitAwareContext(cleaned, focusPrompt, 2200)
    : "";
  const visualDigest = targetedVisualContext || extractVisualReferenceDigest(cleaned, 1800);
  const wantsVisuals = /\b(exhibits?|figures?|tables?|charts?|visuals?)\b/i.test(focusPrompt);
  const hasVisuals = countVisualReferences(cleaned) > 0 || Boolean(visualDigest);

  if (!hasVisuals) {
    return sampleForSummarization(cleaned, maxChars);
  }

  const visualBudget = wantsVisuals ? 1800 : 1200;
  const digest = extractVisualReferenceDigest(cleaned, visualBudget);
  if (!digest) {
    return sampleForSummarization(cleaned, maxChars);
  }

  const baseBudget = Math.max(maxChars - Math.min(digest.length + 120, Math.floor(maxChars * 0.35)), 1800);
  const mainSample = sampleForSummarization(cleaned, baseBudget);
  return `${mainSample}\n\nVISUAL APPENDIX:\n${digest}`.trim();
}

function buildExhibitAwareContext(text: string, userMessage: string, maxChars = 6500): string {
  if (!text.trim()) return "";
  if (!/\b(exhibits?|figures?|tables?|charts?)\b/i.test(userMessage)) return "";

  const paragraphs = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 30);

  const queryRefs = Array.from(
    userMessage.matchAll(/\b(exhibits?|figures?|tables?|charts?)\s*([a-z0-9-]+)/gi)
  ).map((match) => ({
    kind: match[1].replace(/s$/i, "").toLowerCase(),
    id: String(match[2] || "").trim().toLowerCase(),
  }));

  const genericVisualRef = /\b(exhibit|figure|table|chart)\s+[a-z0-9-]+\b/i;
  const queryRegexes = queryRefs.map(
    ({ kind, id }) => new RegExp(`\\b${kind}\\s*${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
  );

  const selected = new Set<number>();
  const snippets: string[] = [];
  const captions = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\s*(exhibit|figure|table|chart)\s+[a-z0-9-]+/i.test(line))
    .slice(0, 12);

  const pushParagraph = (index: number) => {
    if (index < 0 || index >= paragraphs.length || selected.has(index)) return;
    selected.add(index);
    snippets.push(paragraphs[index]);
  };

  paragraphs.forEach((paragraph, index) => {
    const isSpecificHit = queryRegexes.length > 0 && queryRegexes.some((regex) => regex.test(paragraph));
    const isGenericHit = queryRegexes.length === 0 && genericVisualRef.test(paragraph);
    if (!isSpecificHit && !isGenericHit) return;
    pushParagraph(index - 1);
    pushParagraph(index);
    pushParagraph(index + 1);
  });

  const body = snippets.join("\n\n").slice(0, maxChars).trim();
  const sections: string[] = [];
  if (captions.length > 0) {
    sections.push(`VISUAL REFERENCES FOUND IN THE FULL DOCUMENT:\n${captions.join("\n")}`);
  }
  if (body) {
    sections.push(`FULL-DOCUMENT EXCERPTS RELEVANT TO THE VISUAL QUESTION:\n"""\n${body}\n"""`);
  }
  return sections.join("\n\n").trim();
}

/**
 * Split a long text into chunks of at most `maxChars` characters,
 * always breaking at a sentence boundary to avoid mid-sentence cuts.
 */
function splitIntoChunks(text: string, maxChars = 3000): string[] {
  const sentences = splitSentences(text);
  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    if (current.length + s.length + 1 > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = s;
    } else {
      current = current ? current + " " + s : s;
    }
  }
  if (current.trim().length > 0) chunks.push(current.trim());
  return chunks.filter((c) => c.length >= 100);
}

/**
 * Call a Qwen (or other text-generation) model via the HuggingFace Inference API.
 * Wraps the content in an instruct-style prompt and returns the generated summary text.
 */
async function callQwenAPI(
  url: string,
  token: string,
  text: string,
  maxTokens: number
): Promise<string> {
  const prompt =
    `You are an expert academic summariser. Read the following reading material and write a clear, concise summary in 3-5 sentences covering the main ideas.\n\nReading material:\n${text}\n\nSummary:`;

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        max_new_tokens: maxTokens,
        do_sample: false,
        return_full_text: false,
      },
      options: { wait_for_model: true },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HuggingFace API error ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = (await res.json()) as any;
  const txt = Array.isArray(data) ? data[0]?.generated_text : data?.generated_text;
  if (!txt) throw new Error("No summary returned by Qwen model");
  return String(txt).trim();
}

/**
 * Fetches a URL and extracts readable plain text from the HTML.
 * Used to auto-populate article content for link-type materials.
 */
async function scrapeArticleText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; WiseNetBot/1.0; +https://wisenet.app)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok)
    throw new Error(
      `Could not fetch URL (HTTP ${res.status}). Make sure the link is publicly accessible.`
    );

  const html = await res.text();

  // Strip blocks that never contain article text
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, " ")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    // Block elements → newlines so paragraphs are preserved
    .replace(/<\/?(p|div|article|section|h[1-6]|li|br|tr|blockquote)[^>]*>/gi, "\n")
    // Strip all remaining HTML tags
    .replace(/<[^>]+>/g, " ")
    // Decode common HTML entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]{2,8};/gi, " ")
    // Normalise whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Cap at 60 000 chars to avoid overwhelming the context window
  text = text.slice(0, 60000);

  if (text.length < 200)
    throw new Error(
      "Could not extract readable text from this URL. The page may require JavaScript or block automated access. Try pasting the article text manually."
    );

  return text;
}

/**
 * Primary summariser — uses Qwen/Qwen2.5-7B-Instruct via the HuggingFace
 * Inference API (free tier, just needs a read token from huggingface.co).
 *
 * Set HUGGINGFACE_API_KEY in your .env file.
 * Optionally override the model with HF_MODEL.
 */
async function summarizeWithAI(
  title: string,
  content: string,
  detailLevel: "Brief" | "Standard" | "Detailed" = "Standard",
  focusPrompt: string = ""
): Promise<SummaryPayload> {
  const token = process.env.HF_TOKEN;
  if (!token) throw new Error("HF_TOKEN not configured");

  const model = process.env.HF_MODEL || "Qwen/Qwen2.5-7B-Instruct";
  const hfUrl = "https://router.huggingface.co/v1/chat/completions";
  const cleaned = stripLeadingBoilerplate(content);

  const sampleSize = detailLevel === "Brief" ? 2800 : detailLevel === "Detailed" ? 5000 : 3800;
  const inputText = buildSummaryInputContext(cleaned, sampleSize, focusPrompt);
  const maxTokens = detailLevel === "Brief" ? 500 : detailLevel === "Detailed" ? 1200 : 800;
  const numPoints = detailLevel === "Brief" ? 3 : detailLevel === "Detailed" ? 7 : 5;
  const focusNeedsSpecificVisual =
    focusPrompt.trim() && /\b(exhibits?|figures?|tables?|charts?)\s*[a-z0-9-]+/i.test(focusPrompt);

  const focusLine = focusPrompt.trim()
    ? `\nSPECIAL FOCUS: The user specifically wants to understand: "${focusPrompt}". Prioritise this in both the overview and the takeaways.${
        focusNeedsSpecificVisual
          ? " You must explain that specific exhibit/figure/table directly whenever the text references it."
          : ""
      }`
    : "";

  const systemMsg = `You are an expert academic summariser. Produce a clear, structured summary of the reading material.

RULES:
- Include SPECIFIC data: quote exact numbers, percentages, dates, names, and statistics from the text. Never use vague phrases like "various factors" or "significant impact" when specific data is available.
- Do NOT invent information not present in the text.
- If the reading references exhibits, figures, tables, or charts, explain what the text says they show instead of ignoring them.
- Write numbered list items consecutively WITHOUT blank lines between them.${focusLine}

FORMAT YOUR RESPONSE EXACTLY AS FOLLOWS (no extra text before or after):

OVERVIEW: [A flowing 2-4 sentence paragraph covering the main argument. Include specific data.]

TAKEAWAYS:
1. [Label]: [1-2 sentences with specific data from the text]
2. [Label]: [1-2 sentences with specific data from the text]
(continue for all ${numPoints} takeaways)`;

  const userMsg = `Summarise the reading titled "${title}":\n\n${inputText}`;

  const hfRes = await fetch(hfUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemMsg },
        { role: "user", content: userMsg },
      ],
      max_tokens: maxTokens,
      temperature: 0.2,
      top_p: 0.9,
      stream: false,
    }),
  });

  if (!hfRes.ok) {
    const e = await hfRes.text();
    throw new Error(`HF ${hfRes.status}: ${e.slice(0, 300)}`);
  }

  const data = await hfRes.json() as any;
  const raw: string = data?.choices?.[0]?.message?.content ?? "";

  // Parse OVERVIEW
  const overviewMatch = raw.match(/OVERVIEW:\s*([\s\S]+?)(?=\n\s*TAKEAWAYS:|\n\s*1\.|$)/i);
  const summaryText = overviewMatch ? overviewMatch[1].trim() : raw.slice(0, 400).trim();

  // Parse TAKEAWAYS — split on numbered lines like "1." "2." etc.
  const takeawaysBlock = raw.match(/TAKEAWAYS:\s*([\s\S]+)/i)?.[1] ?? "";
  const rawItems = takeawaysBlock.split(/\n(?=\d+\.)/).map((s) => s.trim()).filter(Boolean);
  let keyTakeaways = rawItems
    .map((item) => item.replace(/^\d+\.\s*/, "").trim())
    .filter((t) => t.length > 10)
    .slice(0, numPoints);

  // Extract label from "Label: body" format
  const keyTakeawayLabels = keyTakeaways.map((t, i) => {
    const colonIdx = t.indexOf(":");
    if (colonIdx > 0 && colonIdx < 60) return t.slice(0, colonIdx).replace(/\*\*/g, "").trim();
    return `Key Insight ${i + 1}`;
  });

  // Strip the "Label: " prefix from body so cards don't repeat it
  keyTakeaways = keyTakeaways.map((t) => {
    const colonIdx = t.indexOf(":");
    if (colonIdx > 0 && colonIdx < 60) return t.slice(colonIdx + 1).trim();
    return t;
  });

  // Fall back to TF-IDF if model returned no usable takeaways
  if (keyTakeaways.length < 2) {
    const tfidf = buildTFIDFSummaryPayload(title, cleaned, detailLevel);
    keyTakeaways = tfidf.keyTakeaways;
    keyTakeaways.forEach((_, i) => { keyTakeawayLabels[i] = `Key Insight ${i + 1}`; });
  }

  const tfidf = buildTFIDFSummaryPayload(title, cleaned, detailLevel);
  return {
    title,
    summary: summaryText,
    keyTakeaways,
    keyTakeawayLabels,
    furtherReading: tfidf.furtherReading.slice(0, detailLevel === "Detailed" ? 5 : 3),
  };
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

async function upsertFeedbackForm(courseId: number, sessionNumber: number, sessionDate: string, formType: 'early_course' | 'end_course') {
  let form = await queryOne<any>(
    `SELECT id FROM feedback_forms WHERE course_id = $1 AND trigger_session_number = $2`,
    [courseId, sessionNumber]
  );

  if (!form) {
    form = await queryOne<any>(
      `INSERT INTO feedback_forms (course_id, trigger_session_number, form_type, open_at, due_at)
       VALUES ($1, $2, $3, ($4::date)::timestamptz, (($4::date)::timestamptz + INTERVAL '2 day'))
       RETURNING id`,
      [courseId, sessionNumber, formType, sessionDate]
    );
  } else {
    await execute(
      `UPDATE feedback_forms SET form_type = $3, open_at = ($2::date)::timestamptz, due_at = (($2::date)::timestamptz + INTERVAL '2 day') WHERE id = $1`,
      [form.id, sessionDate, formType]
    );
  }

  if (form?.id) {
    const submissions = await queryOne<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM feedback_submissions WHERE form_id = $1",
      [form.id]
    );
    const existingQuestions = await query<any>(
      `SELECT question_order, question_text, question_type, options FROM feedback_questions WHERE form_id = $1 ORDER BY question_order ASC`,
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
          `INSERT INTO feedback_questions (form_id, question_order, question_text, question_type, options, required) VALUES ($1, $2, $3, $4, $5::jsonb, TRUE)`,
          [form.id, question.question_order, question.question_text, question.question_type, JSON.stringify(question.options || [])]
        );
      }
    }
  }

  return form;
}

async function ensureFeedbackFormForCourse(courseId: number) {
  const course = await queryOne<{ credits: number }>("SELECT credits FROM courses WHERE id = $1", [courseId]);
  const maxSessions = sessionsRequiredForCredits(Number(course?.credits || 1));
  const details = await queryOne<{ feedback_trigger_session: number }>(
    "SELECT feedback_trigger_session FROM course_details WHERE course_id = $1",
    [courseId]
  );
  const midTriggerNumber = normalizeFeedbackTriggerSession(details?.feedback_trigger_session, maxSessions);

  // Mid-course feedback — at the configured trigger session
  const midSession = await queryOne<any>(
    `SELECT session_number, session_date FROM course_sessions WHERE course_id = $1 AND session_number = $2 LIMIT 1`,
    [courseId, midTriggerNumber]
  );
  const midForm = midSession ? await upsertFeedbackForm(courseId, midTriggerNumber, midSession.session_date, 'early_course') : null;

  // End-course feedback — at the last session of the course
  const lastSession = await queryOne<any>(
    `SELECT session_number, session_date FROM course_sessions WHERE course_id = $1 ORDER BY session_number DESC LIMIT 1`,
    [courseId]
  );
  // Only create end-course form if last session is different from mid-course session
  const endForm = lastSession && lastSession.session_number !== midTriggerNumber
    ? await upsertFeedbackForm(courseId, lastSession.session_number, lastSession.session_date, 'end_course')
    : null;

  return { midForm, endForm };
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
  try {
    await initDb();
    // Runtime migrations for session tracking columns
    await execute(`ALTER TABLE course_sessions ADD COLUMN IF NOT EXISTS session_status TEXT DEFAULT 'scheduled' CHECK (session_status IN ('scheduled','completed','cancelled','rescheduled'))`).catch(() => {});
    await execute(`ALTER TABLE course_sessions ADD COLUMN IF NOT EXISTS original_date DATE`).catch(() => {});
    await execute(`
      CREATE TABLE IF NOT EXISTS session_attendance (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES course_sessions(id) ON DELETE CASCADE,
        student_id INTEGER REFERENCES users(id),
        status TEXT NOT NULL CHECK (status IN ('present','absent','late','excused')),
        note TEXT,
        marked_by INTEGER REFERENCES users(id),
        marked_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (session_id, student_id)
      )
    `).catch(() => {});
    await execute(`ALTER TABLE feedback_forms ADD COLUMN IF NOT EXISTS form_type TEXT NOT NULL DEFAULT 'early_course'`).catch(() => {});
    // Fix stale form_type values from before the early_course/end_course rename
    await execute(`UPDATE feedback_forms SET form_type = 'early_course' WHERE form_type NOT IN ('early_course', 'end_course')`).catch(() => {});
  } catch (dbError) {
    console.warn("⚠️  Database unavailable — server starting in degraded mode (DB features will return 503):", (dbError as Error).message);
  }
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
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role, avatar_url: user.avatar_url ?? null });
  });

  app.post("/api/auth/register", async (req, res) => {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !["student", "faculty"].includes(role)) {
      return res.status(400).json({ error: "Invalid registration data" });
    }
    const existing = await queryOne<any>("SELECT id FROM users WHERE email = $1", [email]);
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }
    const hashed = bcrypt.hashSync(password, 10);
    const newUser = await queryOne<any>(
      "INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role",
      [name, email, hashed, role]
    );
    const token = jwt.sign(
      { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role },
      JWT_SECRET,
      { expiresIn: "1d" }
    );
    res.cookie("token", token, getCookieOptions());
    res.json({ id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role, avatar_url: null });
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie("token", getCookieOptions());
    res.json({ success: true });
  });

  app.get("/api/auth/me", async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
      const decoded: any = jwt.verify(token, JWT_SECRET);
      const user = await queryOne<any>("SELECT id, email, name, role, avatar_url FROM users WHERE id = $1", [decoded.id]);
      if (!user) return res.status(401).json({ error: "User not found" });
      res.json({ id: user.id, email: user.email, name: user.name, role: user.role, avatar_url: user.avatar_url ?? null });
    } catch {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  app.post("/api/auth/avatar", authenticate, async (req: any, res) => {
    const { avatar_url } = req.body;
    if (!avatar_url || typeof avatar_url !== "string") {
      return res.status(400).json({ error: "avatar_url is required" });
    }
    // Limit to ~2MB base64 string
    if (avatar_url.length > 2_800_000) {
      return res.status(413).json({ error: "Image too large. Please use an image under 2MB." });
    }
    await execute("UPDATE users SET avatar_url = $1 WHERE id = $2", [avatar_url, req.user.id]);
    res.json({ success: true, avatar_url });
  });

  app.post("/api/ai/extract-pdf-text", authenticate, async (req: any, res: any) => {
    try {
      const base64 = String(req.body?.base64 || "");
      if (!base64) return res.status(400).json({ error: "base64 PDF data is required" });
      const text = await extractPdfTextWithPython(base64);
      res.json({ text });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to extract PDF text" });
    }
  });

  app.post("/api/ai/summarize", authenticate, async (req, res) => {
    try {
      const title = String(req.body?.title || "Untitled Reading");
      const content = String(req.body?.content || "");
      const rawLevel = String(req.body?.detailLevel || "Standard");
      const focusPrompt = String(req.body?.focusPrompt || "").trim();
      const detailLevel: "Brief" | "Standard" | "Detailed" = ["Brief", "Standard", "Detailed"].includes(rawLevel)
        ? (rawLevel as "Brief" | "Standard" | "Detailed")
        : "Standard";
      if (!content.trim()) return res.status(400).json({ error: "Content is required" });
      let result: SummaryPayload;
      try {
        result = await summarizeWithAI(title, content, detailLevel, focusPrompt);
      } catch (error) {
        console.error("AI summarize failed, falling back to TF-IDF", error);
        result = buildTFIDFSummaryPayload(title, content, detailLevel);
      }
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to summarize content" });
    }
  });

  app.post("/api/ai/reflect", authenticate, (req: any, res: any) => {
    const topic = String(req.body?.topic || "").trim();
    if (!topic) return res.status(400).json({ error: "Topic is required" });

    res.json([
      {
        category: "Critical Thinking",
        question: `What are the key assumptions behind "${topic}", and under what conditions might these assumptions break down?`,
      },
      {
        category: "Application",
        question: `How would you apply the core principles of "${topic}" to address a specific challenge in your professional context?`,
      },
      {
        category: "Synthesis",
        question: `How does "${topic}" connect to other frameworks or concepts you have encountered, and what new insights emerge from these connections?`,
      },
    ]);
  });

  app.post("/api/ai/study-plan", authenticate, (req: any, res: any) => {
    const course = String(req.body?.course || "").trim();
    const topicsRaw = String(req.body?.topics || "").trim();
    const duration = String(req.body?.duration || "1 week").trim();

    if (!course || !topicsRaw) {
      return res.status(400).json({ error: "Course and topics are required" });
    }

    const topics = topicsRaw
      .split(/[\n,;]|\d+[.)]\s+/)
      .map((t: string) => t.trim())
      .filter((t: string) => t.length > 2);

    const durationDays = duration.includes("3 days")
      ? 3
      : duration.includes("2 weeks")
      ? 14
      : duration.includes("month")
      ? 30
      : 7;

    const activityTemplates = [
      ["Read the assigned materials for {topic} carefully", "Take brief notes on key concepts", "Identify 3 main ideas"],
      ["Review your notes from the reading", "Work through practice examples for {topic}", "Summarize in your own words"],
      ["Discuss {topic} with peers or study group", "Apply to a real-world scenario", "Prepare 2–3 questions for class"],
      ["Complete assigned exercises on {topic}", "Review weaker areas from earlier sessions", "Synthesise connections to other topics"],
      ["Consolidate notes on {topic}", "Test yourself with a self-quiz", "Prepare for upcoming assessment"],
    ];

    const plan: { day: string; topic: string; activities: string[]; estimatedTime: string }[] = [];
    const daysPerTopic = Math.max(1, Math.floor(durationDays / Math.max(topics.length, 1)));
    let dayCount = 1;

    for (const topic of topics) {
      for (let d = 0; d < daysPerTopic && dayCount <= durationDays; d++, dayCount++) {
        const template = activityTemplates[d % activityTemplates.length];
        plan.push({
          day: `Day ${dayCount}`,
          topic,
          activities: template.map((a: string) => a.replace("{topic}", topic)),
          estimatedTime: d === 0 ? "90 mins" : d === 1 ? "60 mins" : "45 mins",
        });
      }
    }

    while (dayCount <= durationDays) {
      plan.push({
        day: `Day ${dayCount}`,
        topic: "Review & Consolidation",
        activities: [
          "Revisit challenging concepts from earlier in the plan",
          "Connect ideas across all topics covered",
          "Prepare summary notes for each topic",
          "Practice with past papers or case questions",
        ],
        estimatedTime: "60 mins",
      });
      dayCount++;
    }

    res.json(plan);
  });

  app.post("/api/ai/quiz", authenticate, (req: any, res: any) => {
    const content = String(req.body?.content || "").trim();
    if (!content) return res.status(400).json({ error: "Content is required" });

    const raw = makeQuizFromContent(content);
    const questions = raw.map((q, idx) => {
      const shuffled = shuffle([...q.options]);
      const correctAnswer = shuffled.indexOf(q.options[q.correctAnswer]);
      return {
        id: `q${idx + 1}`,
        question: q.question,
        options: shuffled,
        correctAnswer,
        explanation: q.explanation,
      };
    });

    res.json(questions);
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
            AND p.quiz_completed_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM material_quiz_attempts qa
              WHERE qa.material_id = m.id AND qa.user_id = $1
            )

          UNION ALL

          SELECT
            'feedback'::text AS task_type,
            f.id AS item_id,
            CASE WHEN f.form_type = 'end_course' THEN 'Anonymous End Course Feedback' ELSE 'Anonymous Early Course Feedback' END AS item_title,
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
        SELECT id, course_id, session_number, title,
               TO_CHAR(session_date, 'YYYY-MM-DD') AS session_date,
               start_time, end_time, mode, session_status
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
    // Return the earliest-due active form not yet submitted by this student
    const form = await queryOne<any>(
      `
        SELECT f.id, f.due_at, f.form_type
        FROM feedback_forms f
        WHERE f.course_id = $1
          AND COALESCE($2::timestamptz, NOW()) >= f.open_at
          AND COALESCE($2::timestamptz, NOW()) <= f.due_at
          AND NOT EXISTS (
            SELECT 1 FROM feedback_submissions fs WHERE fs.form_id = f.id AND fs.user_id = $3
          )
        ORDER BY f.due_at ASC
        LIMIT 1
      `,
      [courseId, nowOverride, req.user.id]
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
      form_type: form.form_type ?? 'early_course',
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
        SELECT id, form_type, trigger_session_number, open_at, due_at
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

      const formMcqMetrics = metrics
        .filter((metric) => metric.question_type === "mcq")
        .map((metric) => ({
          question_text: String(metric.question_text || ""),
          average: Number(metric.average || 0),
          responses: Number(metric.responses || 0),
        }));
      const formTextComments = metrics
        .filter((metric) => metric.question_type === "text")
        .flatMap((metric) => (Array.isArray(metric.comments) ? metric.comments : []))
        .map((comment) => String(comment || "").trim())
        .filter(Boolean);
      const fallbackSummaryText = buildTextFeedbackSummary(submissions.length, formMcqMetrics, formTextComments);

      responseForms.push({
        form_id: form.id,
        form_type: form.form_type || 'early_course',
        trigger_session_number: form.trigger_session_number,
        open_at: form.open_at,
        due_at: form.due_at,
        submissions: submissions.length,
        summary_text: insightByFormId.get(Number(form.id)) || fallbackSummaryText,
        metrics,
      });
    }

    const overallSubmissions = responseForms.reduce(
      (sum, form) => sum + (Number(form.submissions) || 0),
      0
    );
    const weightedMcqByQuestion = new Map<
      string,
      { question_text: string; total_score: number; responses: number }
    >();
    const overallTextComments: string[] = [];

    for (const form of responseForms) {
      for (const metric of form.metrics || []) {
        if (metric.question_type === "mcq") {
          const questionText = String(metric.question_text || "");
          const responses = Number(metric.responses || 0);
          const average = Number(metric.average || 0);
          const current = weightedMcqByQuestion.get(questionText) || {
            question_text: questionText,
            total_score: 0,
            responses: 0,
          };
          current.total_score += average * responses;
          current.responses += responses;
          weightedMcqByQuestion.set(questionText, current);
        } else {
          const comments = Array.isArray(metric.comments) ? metric.comments : [];
          comments.forEach((comment) => {
            const normalized = String(comment || "").trim();
            if (normalized) overallTextComments.push(normalized);
          });
        }
      }
    }

    const overallMcqMetrics = Array.from(weightedMcqByQuestion.values()).map((metric) => ({
      question_text: metric.question_text,
      average: metric.responses > 0 ? Number((metric.total_score / metric.responses).toFixed(2)) : 0,
      responses: metric.responses,
    }));
    const overallSummaryText = buildTextFeedbackSummary(
      overallSubmissions,
      overallMcqMetrics,
      overallTextComments
    );

    res.json({
      forms: responseForms,
      overall: {
        submissions: overallSubmissions,
        summary_text: overallSummaryText,
        mcq_metrics: overallMcqMetrics,
        comments_count: overallTextComments.length,
      },
    });
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

  // Faculty: fetch all text-type question responses for a course (for AI feedback summariser).
  app.get("/api/courses/:id/feedback/text-responses", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    const courseId = Number(req.params.id);
    if (!(await canManageCourse(req.user, courseId))) return res.status(403).json({ error: "Forbidden" });
    try {
      // Get all text questions for this course's feedback forms
      const questions = await query<any>(
        `SELECT fq.id, fq.question_order, fq.question_text, ff.form_type
         FROM feedback_questions fq
         JOIN feedback_forms ff ON ff.id = fq.form_id
         WHERE ff.course_id = $1 AND fq.question_type = 'text'
         ORDER BY ff.trigger_session_number, fq.question_order`,
        [courseId]
      );
      if (questions.length === 0) return res.json([]);

      // For each question collect anonymous responses (no student names)
      const result = [];
      for (const q of questions) {
        const rows = await query<any>(
          `SELECT a.elem->>'answer_text' AS answer_text
           FROM (
             SELECT jsonb_array_elements(fs.answers) AS elem
             FROM feedback_submissions fs
             JOIN feedback_questions fq2 ON fq2.id = $1
             WHERE fs.form_id = fq2.form_id
           ) a
           WHERE (a.elem->>'question_id')::int = $1
             AND a.elem->>'answer_text' IS NOT NULL
             AND trim(a.elem->>'answer_text') <> ''`,
          [q.id]
        );
        result.push({
          question_id: q.id,
          question_order: q.question_order,
          question_text: q.question_text,
          form_type: q.form_type ?? 'early_course',
          responses: rows.map((r: any) => ({
            answer_text: String(r.answer_text || "").trim(),
          })).filter((r: any) => r.answer_text),
        });
      }
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch text responses" });
    }
  });

  // AI: summarise a set of free-text feedback answers for one question.
  app.post("/api/ai/feedback-summary", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    try {
      const questionText = String(req.body?.questionText || "").trim();
      const answers: string[] = Array.isArray(req.body?.answers) ? req.body.answers.map(String) : [];
      if (!questionText || answers.length === 0) {
        return res.status(400).json({ error: "questionText and answers[] are required" });
      }

      const hfToken = process.env.HF_TOKEN;
      const model = process.env.HF_MODEL || "Qwen/Qwen2.5-7B-Instruct";
      const hfUrl = "https://router.huggingface.co/v1/chat/completions";

      const numberedAnswers = answers.map((a, i) => `${i + 1}. ${a}`).join("\n");
      const systemPrompt = `You are an academic feedback analyst helping a professor understand student feedback.
Analyse the student responses to the following question and produce:
1. A concise 3-4 sentence summary of the overall sentiment and key themes.
2. Up to 5 actionable key takeaways the professor can use to improve the course.

Respond ONLY with valid JSON in this exact format (no markdown, no preamble):
{"summary":"...","keyTakeaways":["...","..."]}`;

      const userMsg = `Question: ${questionText}\n\nStudent responses:\n${numberedAnswers}`;

      if (!hfToken) {
        return res.status(500).json({ error: "HF_TOKEN not configured" });
      }

      const hfRes = await fetch(hfUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${hfToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMsg },
          ],
          max_tokens: 600,
          temperature: 0.3,
        }),
      });

      if (!hfRes.ok) {
        const errText = await hfRes.text();
        throw new Error(`HuggingFace API error ${hfRes.status}: ${errText.slice(0, 300)}`);
      }

      const hfData = (await hfRes.json()) as any;
      const raw = String(hfData?.choices?.[0]?.message?.content || "").trim();

      // Parse JSON from model output (strip any markdown fences)
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Model did not return valid JSON");
      const parsed = JSON.parse(jsonMatch[0]);

      res.json({
        summary: String(parsed.summary || ""),
        keyTakeaways: Array.isArray(parsed.keyTakeaways) ? parsed.keyTakeaways.map(String).slice(0, 5) : [],
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to generate feedback summary" });
    }
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
    const normalizedPdfBase64 =
      source_type === "pdf" ? normalizePdfBase64Input(source_file_base64) : null;
    if (!section_id || !title || !source_type) {
      return res.status(400).json({ error: "section_id, title and source_type are required" });
    }
    if (!["pdf", "link"].includes(source_type)) {
      return res.status(400).json({ error: "source_type must be pdf or link" });
    }
    if (source_type === "link" && !source_url) {
      return res.status(400).json({ error: "source_url is required for link source type" });
    }
    if (source_type === "pdf" && !normalizedPdfBase64 && !source_url) {
      return res.status(400).json({ error: "Upload a PDF file or provide a PDF URL" });
    }
    // Enforce 15 MB limit on PDF uploads (base64 is ~4/3 of binary size)
    const PDF_MAX_BASE64_LEN = 15 * 1024 * 1024 * (4 / 3);
    if (normalizedPdfBase64 && normalizedPdfBase64.length > PDF_MAX_BASE64_LEN) {
      return res.status(413).json({ error: "PDF file too large. Maximum allowed size is 15 MB." });
    }

    const section = await queryOne(
      "SELECT id FROM sections WHERE id = $1 AND course_id = $2",
      [Number(section_id), courseId]
    );
    if (!section) return res.status(400).json({ error: "Invalid section" });

    const hasManualContent = Boolean(String(content || "").trim());
    let materialContent = String(content || "").trim();
    let extractedFromPdf = false;
    let trustedPypdfExtraction = false;
    if (!materialContent && source_type === "pdf" && normalizedPdfBase64) {
      extractedFromPdf = true;
      try {
        materialContent = await extractPdfTextWithPython(normalizedPdfBase64);
        trustedPypdfExtraction = materialContent.trim().length > 0;
      } catch (error) {
        console.error("Python PDF extraction failed, using fallback extractor", error);
        materialContent = extractLikelyPdfText(normalizedPdfBase64);
      }
    }
    materialContent = stripUnsupportedTextChars(materialContent).trim();
    if (extractedFromPdf && !hasManualContent) {
      materialContent = normalizeExtractedPdfText(materialContent);
      if (trustedPypdfExtraction) {
        // pypdf successfully extracted text — trust it, only reject if too short
        if (materialContent.length < 100) materialContent = "";
      } else {
        // fallback regex extractor — apply strict binary-content check
        if (!isLikelyReadableExtractedText(materialContent)) {
          materialContent = "";
        }
      }
    }
    // For link materials with no manually pasted content, auto-scrape the URL
    if (!materialContent && source_type === "link" && source_url) {
      try {
        materialContent = await scrapeArticleText(String(source_url));
        materialContent = stripUnsupportedTextChars(materialContent).trim();
      } catch (scrapeErr: any) {
        return res.status(400).json({
          error: scrapeErr.message || "Failed to fetch the article. Try pasting the text manually.",
        });
      }
    }

    if (!materialContent) {
      if (source_type === "link") {
        return res.status(400).json({
          error: "Could not extract text from this URL. Please paste the article content manually.",
        });
      }
      return res.status(400).json({
        error:
          "Could not extract readable text from this PDF. Upload a text-based PDF, or paste the reading text in the content box for summary and quiz generation.",
      });
    }

    let summary: SummaryPayload;
    try {
      summary = await summarizeWithAI(String(title), materialContent);
    } catch (error) {
      console.error("Gemini summarize failed during material upload, falling back to TF-IDF", error);
      summary = buildFallbackSummaryPayload(String(title), materialContent);
    }
    // Generate quiz with Qwen for specific, content-grounded questions; fall back to TF-IDF
    let quiz: QuizQuestionPayload[];
    try {
      quiz = await generateQuizWithQwen(String(title), materialContent, 5);
    } catch (qwenErr) {
      console.warn("Qwen quiz generation failed at upload, using TF-IDF fallback:", qwenErr);
      const quizSource = `${summary.summary || ""}. ${(summary.keyTakeaways || []).join(". ")}`.trim();
      quiz = makeQuizFromContent(quizSource || materialContent).map(shuffleQuizOptions);
    }
    const assigned = Boolean(is_assigned);
    const dueDateOnly = normalizeDateOnly(due_at);
    const dueAt = dueDateOnly ? `${dueDateOnly}T23:59:59Z` : null;
    const normalizedTitle = stripUnsupportedTextChars(String(title)).trim();
    const normalizedSummary = stripUnsupportedTextChars(summary.summary || "");
    const normalizedTakeaways = (summary.keyTakeaways || [])
      .map((item) => stripUnsupportedTextChars(item))
      .filter((item) => item.trim().length > 0);

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
        normalizedTitle,
        String(source_type),
        source_url ? stripUnsupportedTextChars(String(source_url)) : null,
        source_file_name ? stripUnsupportedTextChars(String(source_file_name)) : null,
        normalizedPdfBase64,
        materialContent,
        normalizedSummary,
        JSON.stringify(normalizedTakeaways),
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

  // ── Notification helper ────────────────────────────────────────────────
  async function createNotification(
    userId: number,
    type: string,
    title: string,
    body: string,
    courseId?: number | null,
    materialId?: number | null
  ) {
    await execute(
      `INSERT INTO notifications (user_id, type, title, body, course_id, material_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, type, title, body, courseId ?? null, materialId ?? null]
    );
  }

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

    // Fire notifications to all enrolled students when a pre-read is assigned
    if (assigned) {
      try {
        const matInfo = await queryOne<{ title: string; course_id: number }>(
          "SELECT title, course_id FROM course_materials WHERE id = $1",
          [materialId]
        );
        const courseInfo = await queryOne<{ name: string; code: string }>(
          "SELECT name, code FROM courses WHERE id = $1",
          [matInfo?.course_id]
        );
        const enrolledStudents = await query<{ user_id: number }>(
          "SELECT user_id FROM enrollments WHERE course_id = $1",
          [matInfo?.course_id]
        );
        for (const { user_id } of enrolledStudents) {
          await createNotification(
            user_id,
            "pre_read_assigned",
            `New pre-read: ${matInfo?.title}`,
            `A new pre-read has been assigned in ${courseInfo?.code} – ${courseInfo?.name}.`,
            matInfo?.course_id,
            materialId
          );
        }
      } catch (notifErr) {
        console.warn("Failed to create assignment notifications:", notifErr);
      }
    }

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

    let quiz: QuizQuestionPayload[];
    try {
      quiz = await generateQuizWithQwen(String(material.title), String(material.content || ""), 5);
    } catch (qwenErr) {
      console.warn("Qwen quiz regeneration failed, using TF-IDF fallback:", qwenErr);
      const quizSource = `${material.summary || ""}. ${(safeJson(material.key_takeaways, []) || []).join(". ")}`.trim();
      quiz = makeQuizFromContent(quizSource || String(material.content || "")).map(shuffleQuizOptions);
    }

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

    // For students: check if they've already submitted an attempt
    if (req.user.role === "student") {
      const existingAttempt = await queryOne<any>(
        `SELECT score, total_questions FROM material_quiz_attempts
         WHERE material_id = $1 AND user_id = $2
         ORDER BY submitted_at DESC LIMIT 1`,
        [materialId, req.user.id]
      );
      if (existingAttempt) {
        return res.json({
          completed: true,
          score: Number(existingAttempt.score),
          total: Number(existingAttempt.total_questions),
        });
      }
    }

    const questions = await query<any>(
      `
        SELECT id, question_order, question_text, options, correct_answer, explanation
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
        correctAnswer: Number(q.correct_answer),
        explanation: q.explanation || "",
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

    // Update overall course progress for this enrollment (% of assigned materials with quiz completed)
    await execute(
      `
        UPDATE enrollments e
        SET progress = (
          SELECT COALESCE(
            ROUND(
              100.0
              * COUNT(DISTINCT p.material_id)
              / NULLIF(COUNT(DISTINCT m.id), 0)
            ),
            0
          )
          FROM course_materials m
          LEFT JOIN material_learning_progress p
            ON p.material_id = m.id
           AND p.user_id = $2
           AND p.quiz_completed_at IS NOT NULL
          WHERE m.course_id = (SELECT course_id FROM course_materials WHERE id = $1)
            AND m.is_assigned = TRUE
        )
        WHERE e.user_id = $2
          AND e.course_id = (SELECT course_id FROM course_materials WHERE id = $1)
      `,
      [materialId, req.user.id]
    );

    // Notify the student of their quiz score
    try {
      const matTitle = await queryOne<{ title: string; course_id: number }>(
        "SELECT title, course_id FROM course_materials WHERE id = $1",
        [materialId]
      );
      if (matTitle) {
        await createNotification(
          req.user.id,
          "quiz_result",
          `Quiz result: ${matTitle.title}`,
          `You scored ${score}/${questions.length} on the quiz for "${matTitle.title}".`,
          matTitle.course_id,
          materialId
        );
      }
    } catch (notifErr) {
      console.warn("Failed to create quiz result notification:", notifErr);
    }

    res.json({ score, total: questions.length });
  });

  /**
   * GET /api/materials/:id/pdf-file
   * Returns the raw PDF binary so the browser can render it in an <iframe>.
   * Students must be enrolled; faculty must own the course.
   */
  app.get("/api/materials/:id/pdf-file", authenticate, async (req: any, res) => {
    const materialId = Number(req.params.id);
    const material = await queryOne<any>(
      "SELECT source_file_base64, source_type, course_id FROM course_materials WHERE id = $1",
      [materialId]
    );
    if (!material) return res.status(404).json({ error: "Not found" });
    if (material.source_type !== "pdf") return res.status(400).json({ error: "Not a PDF material" });

    if (req.user.role === "student") {
      const enrolled = await queryOne(
        "SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2",
        [req.user.id, material.course_id]
      );
      if (!enrolled) return res.status(403).json({ error: "Not enrolled" });
    } else {
      if (!(await canManageCourse(req.user, material.course_id))) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }

    if (!material.source_file_base64) return res.status(404).json({ error: "No PDF stored" });
    const pdfBuffer = Buffer.from(material.source_file_base64, "base64");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(pdfBuffer);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // MATERIAL CHAT  (student: chat with PDF  |  faculty: generate quiz via AI)
  // ─────────────────────────────────────────────────────────────────────────

  /** GET /api/materials/:id/chat/history — last 50 messages for this user */
  app.get("/api/materials/:id/chat/history", authenticate, async (req: any, res) => {
    const materialId = Number(req.params.id);
    const rows = await query<any>(
      `SELECT id, role, content, created_at
       FROM material_chat_messages
       WHERE material_id = $1 AND user_id = $2
       ORDER BY created_at ASC
       LIMIT 50`,
      [materialId, req.user.id]
    );
    res.json(rows);
  });

  /**
   * POST /api/materials/:id/chat
   * Body: { message: string }
   * Streams the assistant response via SSE using HF router OpenAI-compatible API.
   */
  app.post("/api/materials/:id/chat", authenticate, async (req: any, res) => {
    const materialId = Number(req.params.id);
    const userMessage = String(req.body?.message || "").trim();
    if (!userMessage) return res.status(400).json({ error: "message is required" });

    const material = await queryOne<any>(
      "SELECT content, title, course_id, source_type, source_file_base64 FROM course_materials WHERE id = $1",
      [materialId]
    );
    if (!material) return res.status(404).json({ error: "Material not found" });

    if (req.user.role === "student") {
      const enrolled = await queryOne(
        "SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2",
        [req.user.id, material.course_id]
      );
      if (!enrolled) return res.status(403).json({ error: "Not enrolled" });
    } else {
      if (!(await canManageCourse(req.user, material.course_id))) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }

    // Lazy Vision OCR: if the user asks about exhibits/figures/tables and the stored
    // content has no exhibit data yet, re-process the PDF with Vision OCR and cache
    // the enriched content so future questions also benefit from it.
    let workingContent = material.content || "";
    const asksAboutVisuals = /\b(exhibits?|figures?|tables?|charts?|figures?)\b/i.test(userMessage);
    const contentAlreadyEnriched = workingContent.includes("VISUAL OCR NOTES:");
    if (
      asksAboutVisuals &&
      !contentAlreadyEnriched &&
      countVisualReferences(workingContent) < 2 &&
      material.source_type === "pdf" &&
      material.source_file_base64
    ) {
      try {
        const visionText = await extractPdfTextWithVisionOCR(material.source_file_base64, 18);
        const merged = mergePdfExtractions(workingContent, visionText);
        if (merged.length > workingContent.length + 100) {
          await execute("UPDATE course_materials SET content = $1 WHERE id = $2", [merged, materialId]);
          workingContent = merged;
        }
      } catch {
        // fall through with existing content
      }
    }

    // Save user message
    await execute(
      "INSERT INTO material_chat_messages (material_id, user_id, role, content) VALUES ($1, $2, 'user', $3)",
      [materialId, req.user.id, userMessage]
    );

    // Load conversation history (excluding the message just inserted)
    const history = await query<any>(
      `SELECT role, content FROM material_chat_messages
       WHERE material_id = $1 AND user_id = $2
       ORDER BY created_at ASC LIMIT 20`,
      [materialId, req.user.id]
    );

    const cleanedMaterialContent = cleanOCRText(workingContent);
    const docContext = buildSummaryInputContext(cleanedMaterialContent, 5500, userMessage);
    const exhibitContext = buildExhibitAwareContext(cleanedMaterialContent, userMessage, 6500);

    const systemContent = `You are an expert academic tutor helping a student understand a reading material titled "${material.title}".

READING MATERIAL SAMPLE:
"""
${docContext}
"""

${exhibitContext ? `${exhibitContext}\n\n` : ""}INSTRUCTIONS — follow these exactly:
1. Answer ONLY using the reading material above. Never invent or assume information not present in the text.
2. Use SPECIFIC data — quote exact numbers, percentages, figures, names, dates, and statistics from the material whenever available.
3. NEVER use hedging language such as "likely", "probably", "might be", "it seems", or "possibly" — state what the text says directly.
4. EXHIBITS, TABLES, CHARTS, AND FIGURES — handle like this:
   a. Use the full-document exhibit excerpts above whenever they are present, then cross-check with the reading sample.
   b. Report EXACTLY what the surrounding text says about it — description, data values, axes, comparisons, footnotes.
   c. If the exhibit is discussed across multiple paragraphs, synthesise all relevant mentions.
   d. If the document mentions the exhibit only briefly (e.g. "see Exhibit 7"), state the context in which it is referenced and what the nearby text discusses.
   e. ONLY say the material doesn't cover it if the exhibit number/name does not appear ANYWHERE in the text.
5. Format every response with clear markdown:
   - **Bold** key terms and important figures
   - Numbered lists (1. 2. 3.) for steps, sequences, or ranked points — write them consecutively WITHOUT blank lines between items
   - Bullet points (- item) for unordered lists
   - A blank line between distinct sections
7. For summarise requests: give exactly 5 key numbered points, each 1-2 sentences, each starting with a bold term.
8. Be thorough but do not repeat the same point twice.
9. If the user asks about an exhibit and the text appears image-heavy or caption-only, explain all extractable textual references first instead of saying "no exhibits" prematurely.`;

    // Build OpenAI-format messages array
    const messages: { role: string; content: string }[] = [
      { role: "system", content: systemContent },
      // previous turns (exclude the last user message we just inserted — it's added below)
      ...history.slice(0, -1).map((m: any) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
      })),
      { role: "user", content: userMessage },
    ];

    const hfToken = process.env.HF_TOKEN;
    if (!hfToken) {
      const payload = buildTFIDFSummaryPayload(material.title, workingContent, "Standard");
      const reply = payload.summary || "AI is not configured on this server.";
      await execute(
        "INSERT INTO material_chat_messages (material_id, user_id, role, content) VALUES ($1, $2, 'assistant', $3)",
        [materialId, req.user.id, reply]
      );
      return res.json({ reply });
    }

    const model = process.env.HF_MODEL || "Qwen/Qwen2.5-7B-Instruct";
    const hfUrl = "https://router.huggingface.co/v1/chat/completions";

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    let fullReply = "";

    try {
      const hfRes = await fetch(hfUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${hfToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, max_tokens: 1200, temperature: 0.2, top_p: 0.9, stream: true }),
      });

      if (!hfRes.ok || !hfRes.body) {
        const errText = await hfRes.text();
        throw new Error(`HF error ${hfRes.status}: ${errText.slice(0, 300)}`);
      }

      const reader = hfRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (raw === "[DONE]") break;
          try {
            const parsed = JSON.parse(raw);
            // OpenAI-format: choices[0].delta.content
            const chunk: string = parsed?.choices?.[0]?.delta?.content ?? "";
            if (chunk) {
              fullReply += chunk;
              res.write(`data: ${JSON.stringify({ token: chunk })}\n\n`);
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err: any) {
      // Fallback: non-streaming call
      try {
        const fallRes = await fetch(hfUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${hfToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages, max_tokens: 1200, temperature: 0.2, top_p: 0.9, stream: false }),
        });
        const data = await fallRes.json() as any;
        fullReply = data?.choices?.[0]?.message?.content ?? "";
        if (fullReply) res.write(`data: ${JSON.stringify({ token: fullReply })}\n\n`);
      } catch {
        fullReply = "Sorry, the AI model is temporarily unavailable. Please try again in a moment.";
        res.write(`data: ${JSON.stringify({ token: fullReply })}\n\n`);
      }
    }

    const cleanReply = fullReply.trim();
    if (cleanReply) {
      await execute(
        "INSERT INTO material_chat_messages (material_id, user_id, role, content) VALUES ($1, $2, 'assistant', $3)",
        [materialId, req.user.id, cleanReply]
      );
    }

    res.write("data: [DONE]\n\n");
    res.end();
  });

  /**
   * POST /api/materials/:id/quiz/generate-ai  (faculty only)
   * Body: { prompt?: string, count?: number }
   * Asks Qwen to generate quiz questions and returns them as JSON for faculty review.
   * Does NOT save to DB — faculty must call PUT /api/materials/:id/quiz/questions to save.
   */
  app.post("/api/materials/:id/quiz/generate-ai", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    const materialId = Number(req.params.id);
    const material = await queryOne<any>(
      "SELECT content, title, course_id FROM course_materials WHERE id = $1",
      [materialId]
    );
    if (!material) return res.status(404).json({ error: "Material not found" });
    if (!(await canManageCourse(req.user, material.course_id))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const count = Math.min(Number(req.body?.count ?? 5), 10);
    const facultyInstruction = String(req.body?.prompt || "").trim() ||
      `Generate ${count} multiple choice questions that test conceptual understanding of the key ideas in this reading.`;

    const docContext = buildSummaryInputContext(cleanOCRText(material.content || ""), 4000);

    const hfToken = process.env.HF_TOKEN;
    if (!hfToken) return res.status(503).json({ error: "HF_TOKEN not configured" });

    const model = process.env.HF_MODEL || "Qwen/Qwen2.5-7B-Instruct";
    const hfUrl = "https://router.huggingface.co/v1/chat/completions";

    const systemMsg = `You are a quiz writer creating multiple-choice questions for an academic reading titled "${material.title}".

READING MATERIAL:
"""
${docContext}
"""

Rules:
- Base every question STRICTLY on the reading material.
- correctAnswer is the 0-indexed position of the correct option (0, 1, 2, or 3).
- All 4 options must be plausible.
- Questions must test conceptual understanding, not just recall.
- Return ONLY a valid JSON array — no markdown, no preamble.`;

    const userMsg = `${facultyInstruction}

Return ONLY a JSON array of exactly ${count} objects, each with this exact shape:
{"question":"...","options":["A","B","C","D"],"correctAnswer":0,"explanation":"..."}`;

    try {
      const hfRes = await fetch(hfUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${hfToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemMsg },
            { role: "user", content: userMsg },
          ],
          max_tokens: 1500,
          stream: false,
        }),
      });

      if (!hfRes.ok) {
        const e = await hfRes.text();
        throw new Error(`HF ${hfRes.status}: ${e.slice(0, 200)}`);
      }

      const data = await hfRes.json() as any;
      const raw: string = data?.choices?.[0]?.message?.content ?? "";

      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) throw new Error("Model did not return a JSON array");
      const questions = JSON.parse(match[0]) as any[];

      const normalised = questions.slice(0, count).map((q: any, i: number) => ({
        question: String(q.question || `Question ${i + 1}`),
        options: Array.isArray(q.options) && q.options.length === 4
          ? q.options.map(String)
          : ["Option A", "Option B", "Option C", "Option D"],
        correctAnswer: typeof q.correctAnswer === "number" ? q.correctAnswer : 0,
        explanation: String(q.explanation || "See the reading material for details."),
      }));

      res.json({ questions: normalised });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to generate quiz questions" });
    }
  });

  /**
   * PUT /api/materials/:id/quiz/questions  (faculty only)
   * Body: { questions: QuizQuestion[] }
   * Replaces all quiz questions for a material with the provided set.
   */
  app.put("/api/materials/:id/quiz/questions", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });
    const materialId = Number(req.params.id);
    const material = await queryOne<any>(
      "SELECT course_id FROM course_materials WHERE id = $1",
      [materialId]
    );
    if (!material) return res.status(404).json({ error: "Material not found" });
    if (!(await canManageCourse(req.user, material.course_id))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const questions: any[] = Array.isArray(req.body?.questions) ? req.body.questions : [];
    if (questions.length === 0) return res.status(400).json({ error: "No questions provided" });

    await execute("DELETE FROM material_quiz_questions WHERE material_id = $1", [materialId]);

    for (let i = 0; i < questions.length; i++) {
      const raw = questions[i];
      // Shuffle options so the correct answer isn't always option A
      const shuffled = shuffleQuizOptions({
        question: String(raw.question),
        options: Array.isArray(raw.options) ? raw.options.map(String) : ["A", "B", "C", "D"],
        correctAnswer: typeof raw.correctAnswer === "number" ? raw.correctAnswer : 0,
        explanation: String(raw.explanation || ""),
      });
      await execute(
        `INSERT INTO material_quiz_questions
           (material_id, question_order, question_text, options, correct_answer, explanation)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          materialId,
          i + 1,
          shuffled.question,
          JSON.stringify(shuffled.options),
          shuffled.correctAnswer,
          shuffled.explanation,
        ]
      );
    }

    res.json({ success: true, count: questions.length });
  });

  // ─────────────────────────────────────────────────────────────────────────

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
        question_struggles: [],
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

    // Per-question struggle analysis: which questions do students get wrong most often?
    const questionStruggles = await query<any>(
      `
        SELECT
          q.id AS question_id,
          q.question_order,
          q.question_text,
          m.title AS material_title,
          m.id AS material_id,
          COUNT(a.id) AS total_attempts,
          SUM(CASE
            WHEN jsonb_array_element_text(a.answers, q.question_order - 1)::int != q.correct_answer
            THEN 1 ELSE 0
          END) AS wrong_count
        FROM material_quiz_questions q
        JOIN course_materials m ON m.id = q.material_id
        JOIN material_quiz_attempts a ON a.material_id = q.material_id
        WHERE m.course_id = $1
        GROUP BY q.id, m.id
        HAVING COUNT(a.id) > 0
        ORDER BY wrong_count DESC, q.material_id, q.question_order
        LIMIT 10
      `,
      [courseId]
    );

    // Per-material breakdown
    const materialRows = await query<any>(
      `SELECT m.id AS material_id, m.title,
              COUNT(DISTINCT a.user_id) AS student_attempts,
              COALESCE(ROUND(AVG(
                CASE WHEN a.total_questions > 0 THEN a.score::float / a.total_questions * 100 ELSE NULL END
              )::numeric, 1), 0) AS avg_pct
       FROM course_materials m
       LEFT JOIN material_quiz_attempts a ON a.material_id = m.id
       WHERE m.course_id = $1
         AND EXISTS (SELECT 1 FROM material_quiz_questions q WHERE q.material_id = m.id)
       GROUP BY m.id
       ORDER BY m.id`,
      [courseId]
    );

    // Attach per-question struggles to each material
    const perMaterial = materialRows.map((mat: any) => {
      const qs = questionStruggles
        .filter((q: any) => Number(q.material_id) === Number(mat.material_id))
        .map((q: any) => ({
          question_id: q.question_id,
          question_order: Number(q.question_order),
          question_text: q.question_text,
          total_attempts: Number(q.total_attempts),
          wrong_count: Number(q.wrong_count),
          wrong_pct: q.total_attempts > 0 ? Math.round((Number(q.wrong_count) / Number(q.total_attempts)) * 100) : 0,
        }))
        .sort((a: any, b: any) => a.question_order - b.question_order);
      return {
        material_id: Number(mat.material_id),
        title: mat.title,
        student_attempts: Number(mat.student_attempts),
        avg_pct: Number(mat.avg_pct) || 0,
        questions: qs,
      };
    });

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
      question_struggles: questionStruggles.map((q) => ({
        question_id: q.question_id,
        question_order: Number(q.question_order),
        question_text: q.question_text,
        material_title: q.material_title,
        material_id: Number(q.material_id),
        total_attempts: Number(q.total_attempts),
        wrong_count: Number(q.wrong_count),
        wrong_pct: q.total_attempts > 0 ? Math.round((Number(q.wrong_count) / Number(q.total_attempts)) * 100) : 0,
      })),
      per_material: perMaterial,
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

  // Calendar: returns all course sessions for the current user (enrolled courses for students,
  // owned courses for faculty), grouped with course metadata for colour-coding.
  app.get("/api/calendar", authenticate, async (req: any, res) => {
    try {
      const user = req.user;
      let rows: any[];
      if (user.role === "faculty") {
        rows = await query<any>(
          `SELECT cs.id, cs.course_id, cs.session_number, cs.title AS session_title,
                  TO_CHAR(cs.session_date, 'YYYY-MM-DD') AS session_date,
                  cs.start_time, cs.end_time, cs.mode,
                  COALESCE(cs.session_status, 'scheduled') AS session_status,
                  TO_CHAR(cs.original_date, 'YYYY-MM-DD') AS original_date,
                  c.name AS course_name, c.code AS course_code,
                  u.name AS faculty_name,
                  TO_CHAR(c.start_date, 'YYYY-MM-DD') AS course_start_date,
                  TO_CHAR(c.end_date, 'YYYY-MM-DD') AS course_end_date
           FROM course_sessions cs
           JOIN courses c ON c.id = cs.course_id
           JOIN users u ON u.id = c.created_by
           WHERE c.created_by = $1
           ORDER BY cs.session_date, cs.start_time`,
          [user.id]
        );
      } else {
        const nowOverride = getNowOverride(req);
        const today = nowOverride ? nowOverride.slice(0, 10) : new Date().toISOString().slice(0, 10);
        rows = await query<any>(
          `SELECT cs.id, cs.course_id, cs.session_number, cs.title AS session_title,
                  TO_CHAR(cs.session_date, 'YYYY-MM-DD') AS session_date,
                  cs.start_time, cs.end_time, cs.mode,
                  COALESCE(cs.session_status, 'scheduled') AS session_status,
                  TO_CHAR(cs.original_date, 'YYYY-MM-DD') AS original_date,
                  c.name AS course_name, c.code AS course_code,
                  COALESCE(u.name, c.instructor, 'Faculty TBA') AS faculty_name,
                  CASE
                    WHEN sa.status IS NOT NULL THEN sa.status
                    WHEN cs.session_date < $2 THEN 'not_marked'
                    ELSE 'scheduled'
                  END AS attendance_status,
                  sa.note AS attendance_note,
                  sa.marked_at AS attendance_marked_at
           FROM course_sessions cs
           JOIN courses c ON c.id = cs.course_id
           LEFT JOIN users u ON u.id = c.created_by
           JOIN enrollments e ON e.course_id = c.id AND e.user_id = $1
           LEFT JOIN session_attendance sa ON sa.session_id = cs.id AND sa.student_id = $1
           ORDER BY cs.session_date, cs.start_time`,
          [user.id, today]
        );
      }
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch calendar" });
    }
  });

  // Faculty: update session status (completed / cancelled)
  app.patch("/api/sessions/:id/status", authenticate, async (req: any, res) => {
    try {
      const user = req.user;
      if (user.role !== "faculty") return res.status(403).json({ error: "Faculty only" });
      const sessionId = Number(req.params.id);
      const rawStatus = String(req.body?.status || "");
      const validStatuses = ["completed", "cancelled"];
      if (!validStatuses.includes(rawStatus)) return res.status(400).json({ error: "Invalid status. Must be 'completed' or 'cancelled'." });
      // Verify faculty owns the course
      const session = await queryOne<any>(
        `SELECT cs.id FROM course_sessions cs JOIN courses c ON c.id = cs.course_id WHERE cs.id = $1 AND c.created_by = $2`,
        [sessionId, user.id]
      );
      if (!session) return res.status(404).json({ error: "Session not found." });
      await execute(`UPDATE course_sessions SET session_status = $1 WHERE id = $2`, [rawStatus, sessionId]);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to update session status" });
    }
  });

  // Faculty: reschedule a session
  app.patch("/api/sessions/:id/reschedule", authenticate, async (req: any, res) => {
    try {
      const user = req.user;
      if (user.role !== "faculty") return res.status(403).json({ error: "Faculty only" });
      const sessionId = Number(req.params.id);
      const newDate = String(req.body?.session_date || "");
      const newStart = req.body?.start_time ? String(req.body.start_time) : null;
      const newEnd = req.body?.end_time ? String(req.body.end_time) : null;
      if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return res.status(400).json({ error: "Invalid date. Use YYYY-MM-DD." });
      // Verify faculty owns the course
      const existing = await queryOne<any>(
        `SELECT cs.id, cs.session_date FROM course_sessions cs JOIN courses c ON c.id = cs.course_id WHERE cs.id = $1 AND c.created_by = $2`,
        [sessionId, user.id]
      );
      if (!existing) return res.status(404).json({ error: "Session not found." });
      await execute(
        `UPDATE course_sessions SET session_date = $1, start_time = COALESCE($2, start_time), end_time = COALESCE($3, end_time), session_status = 'rescheduled', original_date = COALESCE(original_date, $4) WHERE id = $5`,
        [newDate, newStart, newEnd, existing.session_date, sessionId]
      );
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to reschedule session" });
    }
  });

  // Faculty: get past sessions still marked 'scheduled' (pending / missed)
  app.get("/api/calendar/pending", authenticate, async (req: any, res) => {
    try {
      const user = req.user;
      if (user.role !== "faculty") return res.status(403).json({ error: "Faculty only" });
      const nowOverride = getNowOverride(req);
      const today = nowOverride ? nowOverride.slice(0, 10) : new Date().toISOString().slice(0, 10);
      const rows = await query<any>(
        `SELECT cs.id, cs.session_number, cs.title AS session_title,
                TO_CHAR(cs.session_date, 'YYYY-MM-DD') AS session_date,
                c.name AS course_name, c.code AS course_code
         FROM course_sessions cs
         JOIN courses c ON c.id = cs.course_id
         WHERE c.created_by = $1
           AND cs.session_date < $2
           AND COALESCE(cs.session_status, 'scheduled') = 'scheduled'
         ORDER BY cs.session_date`,
        [user.id, today]
      );
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch pending sessions" });
    }
  });

  // ── Attendance routes ──────────────────────────────────────────────────

  // GET /api/sessions/:id/attendance  — faculty: list all enrolled students with status
  app.get("/api/sessions/:id/attendance", authenticate, async (req: any, res) => {
    try {
      const user = req.user;
      if (user.role !== "faculty") return res.status(403).json({ error: "Faculty only" });
      const sessionId = Number(req.params.id);
      // Verify faculty owns the session's course
      const session = await queryOne<any>(
        `SELECT cs.id, cs.course_id, c.name AS course_name, cs.title AS session_title,
                TO_CHAR(cs.session_date, 'YYYY-MM-DD') AS session_date
         FROM course_sessions cs JOIN courses c ON c.id = cs.course_id
         WHERE cs.id = $1 AND c.created_by = $2`,
        [sessionId, user.id]
      );
      if (!session) return res.status(404).json({ error: "Session not found." });

      // Get all enrolled students with attendance status for this session
      const rows = await query<any>(
        `SELECT u.id AS student_id, u.name, u.email,
                COALESCE(sa.status, 'present') AS status,
                sa.note,
                sa.marked_at
         FROM enrollments e
         JOIN users u ON u.id = e.user_id
         LEFT JOIN session_attendance sa ON sa.session_id = $1 AND sa.student_id = u.id
         WHERE e.course_id = $2
         ORDER BY u.name`,
        [sessionId, session.course_id]
      );
      res.json({ session, students: rows });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch attendance" });
    }
  });

  // POST /api/sessions/:id/attendance  — faculty: save bulk attendance
  // Body: { records: [{ student_id, status, note? }] }
  app.post("/api/sessions/:id/attendance", authenticate, async (req: any, res) => {
    try {
      const user = req.user;
      if (user.role !== "faculty") return res.status(403).json({ error: "Faculty only" });
      const sessionId = Number(req.params.id);
      const records: { student_id: number; status: string; note?: string }[] = req.body?.records || [];

      // Verify faculty owns the session
      const owns = await queryOne<any>(
        `SELECT cs.id FROM course_sessions cs JOIN courses c ON c.id = cs.course_id
         WHERE cs.id = $1 AND c.created_by = $2`,
        [sessionId, user.id]
      );
      if (!owns) return res.status(404).json({ error: "Session not found." });

      const validStatuses = ["present", "absent", "late", "excused"];
      for (const rec of records) {
        const status = validStatuses.includes(rec.status) ? rec.status : "present";
        await execute(
          `INSERT INTO session_attendance (session_id, student_id, status, note, marked_by, marked_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (session_id, student_id)
           DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note,
                         marked_by = EXCLUDED.marked_by, marked_at = NOW()`,
          [sessionId, rec.student_id, status, rec.note || null, user.id]
        );
      }
      res.json({ ok: true, count: records.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to save attendance" });
    }
  });

  // GET /api/courses/:id/attendance/summary — faculty: per-session attendance overview
  app.get("/api/courses/:id/attendance/summary", authenticate, async (req: any, res) => {
    try {
      const user = req.user;
      if (user.role !== "faculty") return res.status(403).json({ error: "Faculty only" });
      const courseId = Number(req.params.id);
      const ok = await canManageCourse(user, courseId);
      if (!ok) return res.status(403).json({ error: "Not your course." });

      const sessions = await query<any>(
        `SELECT cs.id AS session_id, cs.session_number, cs.title AS session_title,
                TO_CHAR(cs.session_date, 'YYYY-MM-DD') AS session_date, cs.session_status,
                COUNT(sa.id) AS marked_count,
                SUM(CASE WHEN sa.status = 'present' THEN 1 ELSE 0 END)::int AS present_count,
                SUM(CASE WHEN sa.status = 'absent'  THEN 1 ELSE 0 END)::int AS absent_count,
                SUM(CASE WHEN sa.status = 'late'    THEN 1 ELSE 0 END)::int AS late_count,
                SUM(CASE WHEN sa.status = 'excused' THEN 1 ELSE 0 END)::int AS excused_count
         FROM course_sessions cs
         LEFT JOIN session_attendance sa ON sa.session_id = cs.id
         WHERE cs.course_id = $1
         GROUP BY cs.id
         ORDER BY cs.session_date`,
        [courseId]
      );

      const totalEnrolled = await queryOne<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt FROM enrollments WHERE course_id = $1`, [courseId]
      );

      res.json({ sessions, total_enrolled: totalEnrolled?.cnt ?? 0 });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch attendance summary" });
    }
  });

  // GET /api/courses/:id/attendance/student  — student: own attendance record
  app.get("/api/courses/:id/attendance/student", authenticate, async (req: any, res) => {
    try {
      const user = req.user;
      const courseId = Number(req.params.id);
      const rows = await query<any>(
        `SELECT cs.session_number, cs.title AS session_title,
                TO_CHAR(cs.session_date, 'YYYY-MM-DD') AS session_date,
                COALESCE(sa.status, 'not_marked') AS status, sa.note
         FROM course_sessions cs
         LEFT JOIN session_attendance sa ON sa.session_id = cs.id AND sa.student_id = $1
         WHERE cs.course_id = $2
         ORDER BY cs.session_date`,
        [user.id, courseId]
      );
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch attendance" });
    }
  });

  // ── End Attendance routes ──────────────────────────────────────────────

  // ── Notifications endpoints ────────────────────────────────────────────

  // GET /api/notifications — returns recent notifications for the logged-in user
  app.get("/api/notifications", authenticate, async (req: any, res) => {
    const limit = Math.min(Number(req.query.limit || 30), 100);
    const rows = await query<any>(
      `SELECT id, type, title, body, course_id, material_id, is_read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [req.user.id, limit]
    );
    const unread_count = rows.filter((r: any) => !r.is_read).length;
    res.json({ notifications: rows, unread_count });
  });

  // POST /api/notifications/mark-read — mark one or all notifications as read
  app.post("/api/notifications/mark-read", authenticate, async (req: any, res) => {
    const { id } = req.body || {};
    if (id) {
      await execute(
        "UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2",
        [Number(id), req.user.id]
      );
    } else {
      // Mark all as read
      await execute(
        "UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE",
        [req.user.id]
      );
    }
    res.json({ success: true });
  });

  // ── End Notifications endpoints ────────────────────────────────────────

  app.get("/api/booster/sessions", authenticate, async (req: any, res) => {
    const sessions = await query<any>(
      `
        SELECT
          m.id,
          m.title,
          m.content,
          m.summary,
          m.key_takeaways,
          m.source_type,
          m.source_url,
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
      id: s.id.toString(),          // session.id == material ID string (used for quiz/progress routes)
      title: s.title,
      date: s.created_at ? new Date(s.created_at).toLocaleDateString() : "No date",
      estimatedTime: "30 mins",
      progress: s.quiz_completed_at || s.quiz_attempted_at ? 100 : s.read_completed_at ? 70 : s.opened_at ? 30 : 0,
      status: s.quiz_completed_at || s.quiz_attempted_at ? "completed" : s.opened_at ? "in_progress" : "not_started",
      items: [
        {
          id: s.id,                 // numeric material ID — used for /api/materials/:id/chat
          title: s.title,
          type: s.source_type === "link" ? "article" : "pdf",
          content: s.content || "",
          summary: s.summary || "",
          keyTakeaways: safeJson(s.key_takeaways, []),
          source_url: s.source_url || null,
        },
      ],
    }));

    res.json(transformed);
  });

  app.get("/api/student/learning-stats", authenticate, async (req: any, res) => {
    if (req.user.role !== "student") return res.status(403).json({ error: "Forbidden" });

    const quizRows = await query<any>(
      `
        SELECT
          c.name AS course_name,
          c.code AS course_code,
          ROUND(AVG(a.score::numeric / NULLIF(a.total_questions, 0) * 100)) AS my_score,
          ROUND(AVG(all_avg.avg_score)) AS class_avg
        FROM courses c
        JOIN enrollments e ON e.course_id = c.id AND e.user_id = $1
        LEFT JOIN course_materials m ON m.course_id = c.id
        LEFT JOIN material_quiz_attempts a ON a.material_id = m.id AND a.user_id = $1
        LEFT JOIN LATERAL (
          SELECT AVG(ia.score::numeric / NULLIF(ia.total_questions, 0) * 100) AS avg_score
          FROM material_quiz_attempts ia
          WHERE ia.material_id = m.id
        ) all_avg ON true
        GROUP BY c.id, c.name, c.code
        HAVING COUNT(a.id) > 0
        ORDER BY c.name
      `,
      [req.user.id]
    );

    const prereadRows = await query<any>(
      `
        SELECT
          COUNT(m.id) AS total,
          COUNT(p.read_completed_at) AS read_done,
          COUNT(p.quiz_completed_at) AS quiz_done
        FROM course_materials m
        JOIN courses c ON c.id = m.course_id
        JOIN enrollments e ON e.course_id = c.id AND e.user_id = $1
        LEFT JOIN material_learning_progress p ON p.material_id = m.id AND p.user_id = $1
        WHERE m.is_assigned = TRUE
      `,
      [req.user.id]
    );

    const pr = prereadRows[0] || { total: 0, read_done: 0, quiz_done: 0 };
    const total = Number(pr.total) || 0;
    const readDone = Number(pr.read_done) || 0;
    const quizDone = Number(pr.quiz_done) || 0;

    res.json({
      quiz_performance: quizRows.map((r: any) => ({
        subject: r.course_code || r.course_name,
        score: Math.round(Number(r.my_score) || 0),
        avg: Math.round(Number(r.class_avg) || 0),
      })),
      preread_stats: [
        { name: "Quiz Completed", value: quizDone },
        { name: "Read Only", value: Math.max(0, readDone - quizDone) },
        { name: "Not Started", value: Math.max(0, total - readDone) },
      ].filter((s) => s.value > 0),
      totals: { total, readDone, quizDone },
    });
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

  // --- Summaries (user-saved AI insights) ---
  app.get("/api/summaries", authenticate, async (req: any, res) => {
    const { activity_id } = req.query;
    const user_id = req.user.id;
    if (!activity_id) return res.status(400).json({ error: "activity_id required" });
    try {
      const row = await queryOne<{ summary_json: any }>(
        "SELECT summary_json FROM summaries WHERE activity_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1",
        [Number(activity_id), user_id]
      );
      res.json(row ? row.summary_json : null);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/summaries", authenticate, async (req: any, res) => {
    const { activity_id, summary } = req.body;
    const user_id = req.user.id;
    if (!activity_id || !summary) return res.status(400).json({ error: "activity_id and summary required" });
    try {
      await execute(
        "DELETE FROM summaries WHERE activity_id=$1 AND user_id=$2",
        [Number(activity_id), user_id]
      );
      const rows = await query<{ id: number }>(
        "INSERT INTO summaries (activity_id, user_id, summary_json) VALUES ($1, $2, $3) RETURNING id",
        [Number(activity_id), user_id, JSON.stringify(summary)]
      );
      res.json({ id: rows[0]?.id });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
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
});

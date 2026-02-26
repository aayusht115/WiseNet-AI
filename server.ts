import "./env";
import express from "express";
import path from "node:path";
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

function getCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: (isProduction ? "none" : "lax") as "none" | "lax",
  };
}

async function startServer() {
  await initDb();

  const app = express();

  app.use(express.json());
  app.use(cookieParser());

  const authenticate = (req: any, res: any, next: any) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
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

  app.get("/api/dashboard/timeline", authenticate, async (req: any, res) => {
    const activities =
      req.user.role === "faculty"
        ? await query(
            `
              SELECT a.*, c.name as course_name, c.code as course_code
              FROM activities a
              JOIN courses c ON a.course_id = c.id
              WHERE c.instructor = $1
              ORDER BY a.due_date ASC
            `,
            [req.user.name]
          )
        : await query(
            `
              SELECT a.*, c.name as course_name, c.code as course_code
              FROM activities a
              JOIN courses c ON a.course_id = c.id
              JOIN enrollments e ON c.id = e.course_id
              WHERE e.user_id = $1
              ORDER BY a.due_date ASC
            `,
            [req.user.id]
          );
    res.json(activities);
  });

  app.get("/api/courses/recent", authenticate, async (req: any, res) => {
    const courses =
      req.user.role === "faculty"
        ? await query(
            `
              SELECT c.*, 0 as progress, NOW() as last_accessed
              FROM courses c
              WHERE c.instructor = $1
              ORDER BY last_accessed DESC
              LIMIT 3
            `,
            [req.user.name]
          )
        : await query(
            `
              SELECT c.*, e.progress, e.last_accessed
              FROM courses c
              JOIN enrollments e ON c.id = e.course_id
              WHERE e.user_id = $1
              ORDER BY e.last_accessed DESC
              LIMIT 3
            `,
            [req.user.id]
          );
    res.json(courses);
  });

  app.get("/api/courses/overview", authenticate, async (req: any, res) => {
    const courses =
      req.user.role === "faculty"
        ? await query(
            `
              SELECT c.*, 0 as progress
              FROM courses c
              WHERE c.instructor = $1
            `,
            [req.user.name]
          )
        : await query(
            `
              SELECT c.*, e.progress
              FROM courses c
              JOIN enrollments e ON c.id = e.course_id
              WHERE e.user_id = $1
            `,
            [req.user.id]
          );
    res.json(courses);
  });

  app.get("/api/categories", authenticate, async (_req, res) => {
    const categories = await query("SELECT * FROM categories");
    res.json(categories);
  });

  app.get("/api/courses", authenticate, async (_req, res) => {
    const courses = await query("SELECT * FROM courses");
    res.json(courses);
  });

  app.post("/api/courses", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });

    const { name, code, description, start_date, end_date, visibility } = req.body;
    const created = await queryOne<{ id: number }>(
      `
        INSERT INTO courses (name, code, description, start_date, end_date, visibility, instructor)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `,
      [name, code, description, start_date, end_date, visibility, req.user.name]
    );

    res.json({ id: created?.id });
  });

  app.put("/api/courses/:id", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });

    const { name, code, description, start_date, end_date, visibility } = req.body;
    await execute(
      `
        UPDATE courses
        SET name = $1, code = $2, description = $3, start_date = $4, end_date = $5, visibility = $6
        WHERE id = $7
      `,
      [name, code, description, start_date, end_date, visibility, Number(req.params.id)]
    );

    res.json({ success: true });
  });

  app.get("/api/courses/:id/sections", authenticate, async (req, res) => {
    const sections = await query(
      'SELECT * FROM sections WHERE course_id = $1 ORDER BY "order" ASC',
      [Number(req.params.id)]
    );
    res.json(sections);
  });

  app.get("/api/courses/:id/participants", authenticate, async (req, res) => {
    const participants = await query(
      `
        SELECT u.id, u.name, u.email, u.role, e.last_accessed, e.progress
        FROM users u
        JOIN enrollments e ON u.id = e.user_id
        WHERE e.course_id = $1
      `,
      [Number(req.params.id)]
    );
    res.json(participants);
  });

  app.get("/api/courses/:id/activities", authenticate, async (req, res) => {
    const activities = await query("SELECT * FROM activities WHERE course_id = $1", [
      Number(req.params.id),
    ]);
    res.json(activities);
  });

  app.get("/api/courses/:id", authenticate, async (req, res) => {
    const course = await queryOne("SELECT * FROM courses WHERE id = $1", [Number(req.params.id)]);
    res.json(course);
  });

  app.get("/api/students", authenticate, async (_req, res) => {
    const students = await query("SELECT id, name, email FROM users WHERE role = 'student'");
    res.json(students);
  });

  app.post("/api/courses/:id/enrol", authenticate, async (req: any, res) => {
    if (req.user.role !== "faculty") return res.status(403).json({ error: "Forbidden" });

    const { user_id } = req.body;
    try {
      await execute(
        `
          INSERT INTO enrollments (user_id, course_id, progress, last_accessed)
          VALUES ($1, $2, 0, NOW())
        `,
        [Number(user_id), Number(req.params.id)]
      );
      res.json({ success: true });
    } catch {
      res.status(400).json({ error: "User already enrolled or error occurred" });
    }
  });

  app.get("/api/booster/sessions", authenticate, async (req: any, res) => {
    const sessions = await query<any>(
      `
        SELECT a.*, c.name as course_name, c.code as course_code
        FROM activities a
        JOIN courses c ON a.course_id = c.id
        JOIN enrollments e ON c.id = e.course_id
        WHERE e.user_id = $1 AND a.type IN ('resource', 'quiz')
        ORDER BY a.due_date ASC
      `,
      [req.user.id]
    );

    const transformed = sessions.map((s: any) => ({
      id: s.id.toString(),
      title: s.title,
      date: s.due_date ? new Date(s.due_date).toLocaleDateString() : "No date",
      estimatedTime: "30 mins",
      progress: Math.floor(Math.random() * 100),
      status: "not_started",
      items: [
        {
          id: `item-${s.id}`,
          title: s.title,
          type: s.type === "quiz" ? "article" : "pdf",
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

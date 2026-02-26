import express from "express";
import { createServer as createViteServer } from "vite";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import db from "./db";
import bcrypt from "bcryptjs";

const JWT_SECRET = "wisenet_secret_key";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cookieParser());

  // Auth Middleware
  const authenticate = (req: any, res: any, next: any) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      next();
    } catch (err) {
      res.status(401).json({ error: "Invalid token" });
    }
  };

  // Auth Routes
  app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: "1d" });
    res.cookie("token", token, { httpOnly: true, secure: true, sameSite: "none" });
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  });

  app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("token");
    res.json({ success: true });
  });

  app.get("/api/auth/me", (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      res.json(decoded);
    } catch (err) {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  // Data Routes
  app.get("/api/dashboard/timeline", authenticate, (req: any, res) => {
    let activities;
    if (req.user.role === 'faculty') {
      activities = db.prepare(`
        SELECT a.*, c.name as course_name, c.code as course_code 
        FROM activities a
        JOIN courses c ON a.course_id = c.id
        WHERE c.instructor = ?
        ORDER BY a.due_date ASC
      `).all(req.user.name);
    } else {
      activities = db.prepare(`
        SELECT a.*, c.name as course_name, c.code as course_code 
        FROM activities a
        JOIN courses c ON a.course_id = c.id
        JOIN enrollments e ON c.id = e.course_id
        WHERE e.user_id = ?
        ORDER BY a.due_date ASC
      `).all(req.user.id);
    }
    res.json(activities);
  });

  app.get("/api/courses/recent", authenticate, (req: any, res) => {
    let courses;
    if (req.user.role === 'faculty') {
      courses = db.prepare(`
        SELECT c.*, 0 as progress, datetime('now') as last_accessed
        FROM courses c
        WHERE c.instructor = ?
        ORDER BY last_accessed DESC
        LIMIT 3
      `).all(req.user.name);
    } else {
      courses = db.prepare(`
        SELECT c.*, e.progress, e.last_accessed
        FROM courses c
        JOIN enrollments e ON c.id = e.course_id
        WHERE e.user_id = ?
        ORDER BY e.last_accessed DESC
        LIMIT 3
      `).all(req.user.id);
    }
    res.json(courses);
  });

  app.get("/api/courses/overview", authenticate, (req: any, res) => {
    let courses;
    if (req.user.role === 'faculty') {
      courses = db.prepare(`
        SELECT c.*, 0 as progress
        FROM courses c
        WHERE c.instructor = ?
      `).all(req.user.name);
    } else {
      courses = db.prepare(`
        SELECT c.*, e.progress
        FROM courses c
        JOIN enrollments e ON c.id = e.course_id
        WHERE e.user_id = ?
      `).all(req.user.id);
    }
    res.json(courses);
  });

  app.get("/api/categories", authenticate, (req, res) => {
    const categories = db.prepare("SELECT * FROM categories").all();
    res.json(categories);
  });

  app.get("/api/courses", authenticate, (req, res) => {
    const courses = db.prepare("SELECT * FROM courses").all();
    res.json(courses);
  });

  app.post("/api/courses", authenticate, (req: any, res) => {
    if (req.user.role !== 'faculty') return res.status(403).json({ error: "Forbidden" });
    const { name, code, description, start_date, end_date, visibility } = req.body;
    const result = db.prepare(`
      INSERT INTO courses (name, code, description, start_date, end_date, visibility, instructor) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name, code, description, start_date, end_date, visibility, req.user.name);
    res.json({ id: result.lastInsertRowid });
  });

  app.put("/api/courses/:id", authenticate, (req: any, res) => {
    if (req.user.role !== 'faculty') return res.status(403).json({ error: "Forbidden" });
    const { name, code, description, start_date, end_date, visibility } = req.body;
    db.prepare(`
      UPDATE courses 
      SET name = ?, code = ?, description = ?, start_date = ?, end_date = ?, visibility = ?
      WHERE id = ?
    `).run(name, code, description, start_date, end_date, visibility, req.params.id);
    res.json({ success: true });
  });

  app.get("/api/courses/:id/sections", authenticate, (req, res) => {
    const sections = db.prepare("SELECT * FROM sections WHERE course_id = ? ORDER BY \"order\" ASC").all(req.params.id);
    res.json(sections);
  });

  app.get("/api/courses/:id/participants", authenticate, (req, res) => {
    const participants = db.prepare(`
      SELECT u.id, u.name, u.email, u.role, e.last_accessed, e.progress
      FROM users u
      JOIN enrollments e ON u.id = e.user_id
      WHERE e.course_id = ?
    `).all(req.params.id);
    res.json(participants);
  });

  app.get("/api/courses/:id/activities", authenticate, (req, res) => {
    const activities = db.prepare("SELECT * FROM activities WHERE course_id = ?").all(req.params.id);
    res.json(activities);
  });

  app.get("/api/courses/:id", authenticate, (req, res) => {
    const course = db.prepare("SELECT * FROM courses WHERE id = ?").get(req.params.id);
    res.json(course);
  });

  app.get("/api/students", authenticate, (req, res) => {
    const students = db.prepare("SELECT id, name, email FROM users WHERE role = 'student'").all();
    res.json(students);
  });

  app.post("/api/courses/:id/enrol", authenticate, (req: any, res) => {
    if (req.user.role !== 'faculty') return res.status(403).json({ error: "Forbidden" });
    const { user_id } = req.body;
    try {
      db.prepare("INSERT INTO enrollments (user_id, course_id, progress, last_accessed) VALUES (?, ?, 0, datetime('now'))").run(user_id, req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: "User already enrolled or error occurred" });
    }
  });

  app.get("/api/booster/sessions", authenticate, (req: any, res) => {
    // Fetch upcoming activities of type 'resource' or 'quiz'
    const sessions = db.prepare(`
      SELECT a.*, c.name as course_name, c.code as course_code
      FROM activities a
      JOIN courses c ON a.course_id = c.id
      JOIN enrollments e ON c.id = e.course_id
      WHERE e.user_id = ? AND a.type IN ('resource', 'quiz')
      ORDER BY a.due_date ASC
    `).all(req.user.id);
    
    // Transform to PreReadSession type
    const transformed = sessions.map((s: any) => ({
      id: s.id.toString(),
      title: s.title,
      date: s.due_date ? new Date(s.due_date).toLocaleDateString() : 'No date',
      estimatedTime: '30 mins',
      progress: Math.floor(Math.random() * 100), // Mock progress for now
      status: 'not_started',
      items: [
        { id: `item-${s.id}`, title: s.title, type: s.type === 'quiz' ? 'article' : 'pdf', content: s.content || '' }
      ]
    }));
    
    res.json(transformed);
  });

  app.get("/api/analytics/risks", authenticate, (req: any, res) => {
    if (req.user.role !== 'faculty') return res.status(403).json({ error: "Forbidden" });
    
    // Fetch students with low progress (less than 30%)
    const risks = db.prepare(`
      SELECT u.name, 'Low progress in ' || c.code as issue, 
             CASE WHEN e.progress < 10 THEN 'critical' ELSE 'warning' END as status
      FROM users u
      JOIN enrollments e ON u.id = e.user_id
      JOIN courses c ON e.course_id = c.id
      WHERE u.role = 'student' AND e.progress < 30
      LIMIT 5
    `).all();
    
    res.json(risks);
  });

  // Developer Helper: DB Dump (Only in Dev)
  if (process.env.NODE_ENV !== "production") {
    app.get("/api/dev/db-dump", (req, res) => {
      try {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as any[];
        const dump: any = {};
        
        tables.forEach(({ name }) => {
          dump[name] = {
            schema: db.prepare(`SELECT sql FROM sqlite_master WHERE name = ?`).get(name),
            data: db.prepare(`SELECT * FROM ${name} LIMIT 100`).all()
          };
        });
        
        res.json(dump);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });
  }

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

# WiseNet AI

Express + Vite app with a Supabase-hosted Postgres database.

## Prerequisites

- Node.js 20+
- A Supabase project

## 1. Install dependencies

```bash
npm install
```

## 2. Create environment file

```bash
cp .env.example .env.local
```

Set values in `.env.local`:

- `GEMINI_API_KEY`
- `DATABASE_URL` (Supabase Postgres connection string, pooler URL recommended)
- `JWT_SECRET`
- `PORT` (default `3000`)
- `PGSSLMODE` (`require` for Supabase)

## 3. Initialize Supabase DB

Run these SQL files in the Supabase SQL Editor in this order:

1. [`supabase/schema.sql`](./supabase/schema.sql)
2. [`supabase/seed.sql`](./supabase/seed.sql)

Note: the app also auto-initializes schema + seed on startup if tables are empty.

## 4. Run locally

```bash
npm run dev
```

Open `http://localhost:3000`.

Default seeded users:

- `pgp25.aayush@spjimr.org` / `password123` (student)
- `faculty@spjimr.org` / `password123` (faculty)

## Deploy

Use Render/Railway/Fly with this repo connected to GitHub.

- Build command: `npm run build`
- Start command: `npm run start`
- Add the same environment variables from `.env.local`.

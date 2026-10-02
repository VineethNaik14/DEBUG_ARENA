# DEBUG ARENA

> Find the Bug. Fix the Code. Beat the Clock.

A production-quality, full-stack debugging competition platform for college students. Built with React, TypeScript, Vite, Tailwind CSS, Monaco Editor, and Supabase.

## Features

- **Student Authentication** — Signup, login, password reset via Supabase Auth
- **Admin Authentication** — Separate admin login (no public signup)
- **Role-Based Access Control** — RLS-enforced at the database level (not just route guards)
- **Student Dashboard** — Stats, competition status, live countdown timer
- **Admin Dashboard** — Platform statistics, recent submissions, charts
- **Competition Management** — Admin can create, start, and end competitions
- **Server-Controlled Timer** — Competition timing enforced via Supabase timestamps
- **Problem Management** — Full CRUD for problems with difficulty, points, test cases
- **Monaco Code Editor** — Full debugging workspace with syntax highlighting
- **Code Submission** — Run against public tests, submit against hidden tests
- **Automatic Evaluation** — Edge Function evaluates code and scores submissions
- **Scoring** — Points awarded via SECURITY DEFINER function (no double-awarding)
- **Leaderboard** — Real-time rankings with tie-breaking
- **Submission History** — Students see their own; admins see all
- **Notifications** — Real-time notifications on solution acceptance
- **Analytics** — Submission activity, acceptance rates, language usage
- **Supabase Realtime** — Live competition status, leaderboard, and notification updates
- **Responsive Design** — Sidebar on desktop, collapsible on tablet, hamburger on mobile

## Tech Stack

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, React Router, Lucide React, Monaco Editor
- **Backend:** Supabase (PostgreSQL, Auth, RLS, Realtime, Edge Functions)
- **Code Evaluation:** Supabase Edge Function (Deno runtime)

## Prerequisites

- Node.js 18+
- A Supabase project (free tier works)

## Setup

### 1. Environment Variables

Copy `.env.example` to `.env` and fill in your Supabase credentials:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

These are already pre-populated in the Bolt environment. For your own Supabase project, find them in:
- Supabase Dashboard → Settings → API

### 2. Database Schema

Apply every migration in `supabase/migrations/` in order. With the CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

`20261001000000_canonical_schema_and_security.sql` is the migration that brings any
earlier/drifted state to the canonical schema (renames columns without losing data, merges
hidden tests into `problems.test_cases`, resets every RLS policy and function privilege).
It also works on a fresh database. After it runs, regenerate the types if you change the schema:

```bash
supabase gen types typescript --project-id <your-project-ref> > src/types/supabase.ts
```

### 3. Configure Supabase Auth

- **Email Confirmation:** OFF (default). Students can sign in immediately after signup.
- **Password Reset Redirect URL:** Set to `http://localhost:5173/reset-password` (or your production URL)
  - Go to: Supabase Dashboard → Authentication → URL Configuration
  - Set the "Site URL" and "Redirect URLs" to include your domain's `/reset-password` path

### 4. Create an Admin Account

There is NO public admin signup. To create an admin:

1. **Create a user in Supabase Auth:**
   - Go to: Supabase Dashboard → Authentication → Users → "Add user"
   - Enter the admin email and password
   - OR use the SQL Editor:
   ```sql
   -- This creates the auth user (run in Supabase SQL Editor)
   -- Note: The handle_new_user trigger will create a STUDENT profile automatically
   ```

2. **Promote the user to ADMIN:**
   ```sql
   -- In Supabase SQL Editor:
   UPDATE profiles
   SET role = 'ADMIN'
   WHERE email = 'admin@yourdomain.com';
   ```

3. The admin can now log in at `/admin/login`.

### 5. Run the Application

```bash
npm install
npm run dev
```

The app will be available at `http://localhost:5173`.

## How Code Execution Works

```
React  ──(user JWT)──▶  Edge Function evaluate-code  ──▶  Sandbox (Piston)   ← runs the student code
                              │  (service role)
                              └──▶  Postgres: reserve_submission → finalize_submission
```

Student code is **never** executed inside Supabase. The Edge Function sends it, one test case at a time,
to a Piston-compatible sandbox (`EXECUTION_SERVICE_URL`) which enforces the time and memory limits.

### Required: an execution service

The public `emkc.org` Piston API is no longer freely usable (restricted since Feb 2026). Self-host Piston:

```bash
git clone https://github.com/engineer-man/piston && cd piston
docker compose up -d api
# install runtimes (use the repo's CLI)
node cli/index.js ppman install python
node cli/index.js ppman install gcc
node cli/index.js ppman install java
```

Then set the function secrets and deploy:

```bash
supabase secrets set EXECUTION_SERVICE_URL=https://<your-piston-host>/api/v2/execute
# optional:
supabase secrets set EXECUTION_SERVICE_TOKEN=<value for the Authorization header>
supabase secrets set EXECUTION_MAX_RUN_TIMEOUT_MS=3000   # must not exceed Piston's PISTON_RUN_TIMEOUT
supabase functions deploy evaluate-code
```

Check it from **Admin → Settings → Code Execution Service → Check connection**.
Problem time limits above `EXECUTION_MAX_RUN_TIMEOUT_MS` are capped to it.

### Run vs Submit

* **Run** executes the code against the problem's *sample* test cases (`is_hidden: false`) and returns per-test
  results (stdout, stderr, status, time, memory when the sandbox reports it). Nothing is stored or scored.
* **Submit** (students only) – the server: authenticates the caller from the JWT → loads the problem →
  `reserve_submission()` (active user, competition LIVE and inside its window, attempt limit; records the attempt
  atomically) → runs **all** tests incl. hidden ones → `finalize_submission()` (stores the verdict, reads
  `problems.max_points` from the database, awards points once via `solved_problems`).
  The request body can only contain `problemId`, `code`, `language`; it can never carry a score, user id or points.
* If the sandbox is unavailable the attempt is released (`void_submission`) and the student gets a 503 – a service
  outage is never reported as a compile error and never costs an attempt.

Test the judging logic locally (no network, uses a fake Piston server):

```bash
npx tsx supabase/functions/evaluate-code/judge.test.ts
```

### Security model

* Students cannot read `problems` at all; they read the `student_problems` view, which exposes only sample test cases.
* `profiles`: students can update only `full_name` (column privilege). `is_active` is changed by admins through
  `admin_set_user_active()`. `role` can only be changed with SQL by a database owner.
* `submissions`, `solved_problems`: read-only for clients. Written only by the service-role functions above.
* All `SECURITY DEFINER` functions pin `search_path`, and `EXECUTE` is revoked from `PUBLIC`/`anon`/`authenticated`
  and granted explicitly (the scoring functions to `service_role` only).
* Competition rules (LIVE + window + attempts + active user) are enforced in Postgres, not in the UI.

## Database Schema

| Table / view | Purpose |
|--------------|---------|
| `profiles` | Users (students + admins), linked to `auth.users`; counters are maintained by the scoring functions |
| `problems` | Problems incl. `test_cases` (jsonb array of `{input, expected_output, is_hidden}`) – admin only |
| `student_problems` (view) | Student-safe projection of `problems` (no hidden tests) |
| `competitions` | Competition configuration and status (latest created = current) |
| `submissions` | Evaluated submissions (`passed_tests`, `total_tests`, `execution_time_ms`, `memory_used_mb`, `created_at`) |
| `solved_problems` | Exactly one row per `(user_id, problem_id)`; source of truth for the leaderboard |
| `notifications` | User notifications |

### Functions

| Function | Callable by | Purpose |
|----------|-------------|---------|
| `is_admin()`, `is_active_user()` | authenticated | Used by RLS |
| `get_leaderboard()`, `get_student_rank(uuid)` | authenticated | Rankings from `solved_problems` (ties share a rank; tie-break: earlier last solve) |
| `admin_set_user_active(uuid, bool)` | admins (checked inside) | Activate/deactivate a user |
| `admin_save_competition(...)`, `start_competition`, `end_competition` | admins (checked inside) | Create/edit/start/end competitions |
| `create_notification(...)` | admins (checked inside) | Notify a user |
| `student_id_available(text)` | anon, authenticated | Sign-up duplicate check |
| `reserve_submission`, `finalize_submission`, `void_submission` | **service_role only** | Submission lifecycle |

## Sample Problems

The platform comes with 5 pre-seeded debugging problems:

1. **Fix the Broken Loop** (Easy, 100 pts) — Off-by-one error in sum loop
2. **Broken Binary Search** (Medium, 200 pts) — Integer division bug
3. **Array Index Bug** (Easy, 100 pts) — Wrong loop bound
4. **Incorrect Sorting Logic** (Medium, 200 pts) — Wrong comparison operator
5. **Null Pointer Debugging** (Hard, 300 pts) — Missing null check

Each problem supports Python, C++, and Java with starter code, public test cases, and hidden test cases.

## Project Structure

```
src/
├── components/      # Reusable UI components
├── contexts/        # React contexts (AuthContext)
├── layouts/         # Layout wrappers (StudentLayout, AdminLayout)
├── lib/             # Supabase client
├── pages/           # Page components
│   ├── auth/        # Authentication pages
│   ├── student/     # Student pages
│   └── admin/       # Admin pages
├── types/           # TypeScript types
└── utils/           # Helper functions

supabase/
├── functions/       # Edge Functions
│   └── evaluate-code/
└── migrations/      # Database migrations
```

## Building for Production

```bash
npm run build
```

Output is in the `dist/` directory.

## License

This project is for educational purposes.

# WWE 2K26 Show Tracker

A Universe Mode companion app — track wrestlers, shows, championships,
matches, tag teams/trios/stables, and power rankings. Includes shared
Cloud Saves so a group of friends can all load the same Universe.

This is a static React app (built with Vite) that anyone can run for free
on Vercel or Netlify, with Supabase as the free backend for Cloud Saves.

---

## 1. Run it locally first (optional but recommended)

```bash
npm install
npm run dev
```

Open the URL it prints (usually `http://localhost:5173`). The app works
immediately for local use — Cloud Saves just won't work until you do
step 2.

---

## 2. Set up Cloud Saves (Supabase — free)

This lets multiple people share saves with each other (load/save by name,
optional password). Skip this if you only need a single-player tracker —
the **Download JSON / Load from File** buttons work without any setup.

1. Go to **[supabase.com](https://supabase.com)** → New Project (free tier is plenty).
2. Once it's created, open the **SQL Editor** and run this once:

   ```sql
   create table kv_store (
     key text primary key,
     value text not null,
     shared boolean not null default false,
     updated_at timestamptz not null default now()
   );
   alter table kv_store enable row level security;
   create policy "public read/write" on kv_store for all using (true) with check (true);
   ```

   This makes a simple key-value table that anyone with your app URL can
   read/write — fine for a small group of friends. (See "Locking it down"
   below if you want to restrict this later.)

3. In Supabase, go to **Project Settings → API**. Copy:
   - **Project URL**
   - **anon public** key

4. In this project, copy `.env.example` to `.env` and fill in those two values:

   ```bash
   cp .env.example .env
   ```

   ```
   VITE_SUPABASE_URL=https://xxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
   ```

5. Restart `npm run dev` if it was running. Cloud Saves should now work —
   the red warning banner at the top will disappear.

---

## 3. Deploy it so others can use it

### Option A — Vercel (recommended, easiest)

1. Push this folder to a GitHub repo (or use Vercel's CLI/drag-and-drop).
2. Go to **[vercel.com](https://vercel.com)** → New Project → import your repo.
3. Vercel auto-detects Vite — leave the default build settings.
4. Before deploying, add your environment variables:
   - **Settings → Environment Variables**
   - Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with the same
     values from your `.env` file.
5. Deploy. You'll get a URL like `wwe2k26-tracker.vercel.app` — send that
   to anyone you want to share it with.

### Option B — Netlify

1. Push to GitHub (or drag-and-drop the built `dist/` folder after running
   `npm run build`).
2. Go to **[netlify.com](https://netlify.com)** → Add new site → Import from Git.
3. Build command: `npm run build` — Publish directory: `dist`.
4. **Site settings → Environment variables** — add the same two
   `VITE_SUPABASE_*` keys.
5. Deploy. You'll get a URL like `wwe2k26-tracker.netlify.app`.

### Option C — Drag-and-drop (no GitHub needed)

```bash
npm install
npm run build
```

This creates a `dist/` folder. Both Vercel and Netlify let you drag that
folder directly onto their dashboard to deploy without any Git setup —
just make sure you've already created `.env` with your Supabase keys
**before** running `npm run build`, since Vite bakes those values into
the build at build time.

---

## How saves work once deployed

- **Cloud Saves** (the button in the header) — shared across everyone
  using your deployed URL. Anyone can save a Universe under a name (with
  an optional password to prevent others overwriting it), and anyone can
  browse and load any save.
- **Download JSON / Load from File** — a personal backup that stays on
  your own device, no internet needed.

---

## Locking down Cloud Saves later (optional)

The default SQL policy above allows anyone to read/write every row —
good enough for a small friend group. If this ever needs to be more
locked-down (e.g. public internet strangers), you'd add Supabase Auth
and scope the RLS policy to authenticated users. Not included here to
keep the setup simple, but Supabase's docs cover this well if you need
it later.

---

## Tech stack

- React 18 + Vite
- Supabase (Postgres-backed key/value store) for Cloud Saves
- No other backend, no server to maintain

# Vylan

Document-collection web app for small Canadian accounting & bookkeeping firms.

## Quick start

```bash
# 1. Install deps
npm install

# 2. Start local Supabase (requires Docker Desktop running)
npm run db:start
# Copy the printed anon key + service role key into .env.local

# 3. Apply migrations + seed
npm run db:reset

# 4. Configure env
cp .env.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY at minimum.

# 5. Run dev server
npm run dev
# → http://localhost:3000 (French) · http://localhost:3000/en (English)
```

Supabase Studio runs at <http://127.0.0.1:54323> after `npm run db:start`.

## Scripts

| Command                | What it does                              |
| ---------------------- | ----------------------------------------- |
| `npm run dev`          | Next.js dev server (Turbopack)            |
| `npm run build`        | Production build                          |
| `npm run lint`         | ESLint                                    |
| `npm run typecheck`    | `tsc --noEmit`                            |
| `npm test`             | Vitest (run once)                         |
| `npm run test:watch`   | Vitest (watch mode)                       |
| `npm run db:start`     | Boot local Supabase stack (Docker)        |
| `npm run db:reset`     | Re-apply all migrations + run `seed.sql`  |
| `npm run db:status`    | Print local Supabase service URLs         |

## Project layout

```
src/
  app/
    [locale]/      ← all user-facing pages, FR/EN
  i18n/            ← next-intl routing + request config
  lib/
    brand.ts       ← brand tokens (rename here, propagates everywhere)
    cn.ts          ← classnames helper (shadcn)
    env.ts         ← Zod-validated env access
    supabase/      ← server/browser/proxy clients
  proxy.ts         ← Next 16 proxy (next-intl locale routing)
messages/
  fr.json          ← default
  en.json
supabase/
  migrations/      ← numbered SQL
  seed.sql
  config.toml
```

## Demo account (after `db:reset`)

```
email:    demo@vylan.app
password: demo1234
firm:     Cabinet Tremblay & Associés
```

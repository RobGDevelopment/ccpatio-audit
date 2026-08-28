# CC Patio Audit

Monorepo for CC Patio sales-to-manufacturing integration.

| Path | Purpose |
|------|---------|
| **`src/`** | **Next.js PIM Dictionary** — deploy from repo root to Vercel |
| `scripts/` | DB migrations, seeders, Katana ingest |
| `topology/` | Integration topology scripts (separate app) |
| `docs/` | Data sheets, deploy prompts |

## Deploy the PIM Dictionary to Vercel

The Next.js app is at the **repo root** — no Root Directory override needed. See [DEPLOY.md](./DEPLOY.md) for env vars and migration steps.

Quick check: a successful Vercel build takes 1–3 minutes and deploys routes `/`, `/admin/dictionary`, `/admin/audit`.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in POSTGRES_URL, PIM_SESSION_SECRET, Supabase keys
npm run db:migrate
npm run dev
```

# CC Patio PIM Dictionary — Deploy Guide

## Vercel setup

1. Create a GitHub repo from `ccpatio-audit` and connect it in Vercel.
2. Set **Root Directory** to `middleware`.
3. Add environment variables (Production + Preview):

| Variable | Required | Notes |
|----------|----------|-------|
| `POSTGRES_URL` | Yes | Supabase pooler connection string |
| `PIM_SESSION_SECRET` | Yes | Random 32+ char secret for signed cookies |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Enables Realtime multi-user sync |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Realtime + browser client |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Image uploads (server only) |
| `NEXT_PUBLIC_APP_URL` | Yes | Your Vercel URL, e.g. `https://pim.ccpatio.com` |

Optional (integration phases):

- `KATANA_PERSONAL_ACCESS_TOKEN` / `KATANA_API_KEY`
- `DOWNSTREAM_MUTATIONS=false` (keep false until Katana sign-off)
- `ORDER_PIPELINE_MODE=log`

4. Deploy. First deploy will fail page loads until migrations run.

## Database migrations

From your machine (with production `POSTGRES_URL` in env):

```bash
cd middleware
npm run db:migrate
```

This applies through `0010_pim_operators_audit.sql` (operators + audit log + Realtime).

## Verify after deploy

1. Open `/` — landing page with @ccpatio.com registration.
2. Register with `you@ccpatio.com` — redirects to `/admin/dictionary`.
3. Edit a Finished Good field — check `/admin/audit` for your email.
4. Open two browsers — confirm **Realtime live** badge; edits appear on both.

## Team workflow

- **Landing:** `/` — intro + register (ccpatio.com emails only)
- **Dictionary:** `/admin/dictionary` — main spreadsheet
- **Audit log:** `/admin/audit` — who changed what
- Focus data entry on **Finished Good** tab first (72 incomplete FG in dashboard)

## Security notes

- `/admin/*` routes require a valid signed session cookie.
- Session lasts 30 days; sign out clears cookie.
- This is email-domain gating, not full SSO — add Vercel Deployment Protection for extra layer if needed.

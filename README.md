# EconoStock

EconoStock is a React + Vite dashboard for browsing our market workspace on the web.

## What this public repo contains

- web UI and layout
- Supabase client-side queries
- GitHub Pages deployment workflow
- shared schema migrations needed by the frontend

## What is intentionally not documented here

The screening engine, local SQLite handling, backfill jobs, service-role imports, and machine-specific sync commands are treated as private operations. Those workflows should live in a separate private repository or private local workspace.

## Main screens

- `홈`
- `스크리닝 종목`
- `투자자별 매매`
- `테마별 종목`

## Tech stack

- Vite
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Supabase

## Local development

```bash
npm install
npm run dev
```

## Required environment variables

Create a local `.env.local` file from `.env.example` and set:

```bash
VITE_SUPABASE_PROJECT_ID=your-project-id
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-anon-key
VITE_SUPABASE_URL=https://your-project-id.supabase.co
```

Only publishable browser keys belong in this repo. Service-role keys and local sync secrets should stay outside the public repository.

## Supabase setup

Apply the migrations in `supabase/migrations` before using the monitoring pages.

Commonly required migrations for a fresh project:

- `supabase/migrations/20260414071416_9e5e7c6a-6d87-46b9-945a-c5e6ab5c394f.sql`
- `supabase/migrations/20260617000200_add_naver_theme_tables.sql`
- `supabase/migrations/20260617000100_add_screening_monitor_tables.sql`
- `supabase/migrations/20260618000100_add_investor_flow_daily_tables.sql`
- `supabase/migrations/20260618000200_add_investor_flow_ranked_function.sql`
- `supabase/migrations/20260622000100_add_investor_flow_daily_counts_function.sql`

If you proxy KRX-style requests through Supabase Edge Functions, deploy only the frontend-facing functions that your public site actually needs.

## Build

```bash
npm run build
```

After build, the project also prepares GitHub Pages artifacts automatically:

- `dist/404.html`
- `dist/.nojekyll`

## GitHub Pages deployment

This project is configured for GitHub Pages with a GitHub Actions workflow:

- workflow file: `.github/workflows/deploy-pages.yml`
- deploy target: repository Pages
- default path style: `https://<username>.github.io/<repository>/`

Before enabling Pages, add these repository variables in GitHub:

- `VITE_SUPABASE_PROJECT_ID`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_URL`

Optional repository variable:

- `VITE_BASE_PATH`

Notes:

- If `VITE_BASE_PATH` is empty, the build automatically uses `/<repository>/` on GitHub Actions.
- If you later connect a custom domain, set `VITE_BASE_PATH` to `/`.
- In GitHub, open `Settings -> Pages` and set `Source` to `GitHub Actions`.

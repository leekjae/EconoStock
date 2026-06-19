# EconoStock Workspace

EconoStock is a React + Vite + Supabase workspace for monitoring KRX market data, investor flow, theme data, and our own screening results.

## Current app structure

- `/` : single-page dashboard with left navigation
- all major views are opened inside the main workspace layout
- GitHub Pages deployment is supported

The main workspace now focuses on:

- market overview
- investor flow monitoring
- screening result monitoring

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

## Data imports

### Investor flow from Screening SQLite

The current `투자자별 매매` screen is designed around the local Screening project's `investor_flow`
dataset, not the older KRX snapshot collector.

1. Apply `supabase/migrations/20260618000100_add_investor_flow_daily_tables.sql`
2. Apply `supabase/migrations/20260618000200_add_investor_flow_ranked_function.sql`
3. Set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`
4. Import the local SQLite data

```bash
npm run import:investor-flow -- --db D:/Codex/Screening/data/market_data.sqlite --limit-days 60 --dry-run
npm run import:investor-flow -- --db D:/Codex/Screening/data/market_data.sqlite --limit-days 60
```

If `D:/Codex/secrets/econostock-sync.env` exists, the importer will load it automatically.

For a full backfill:

```bash
npm run import:investor-flow -- --db D:/Codex/Screening/data/market_data.sqlite
```

### Investor snapshots

Legacy path for the older `investor_snapshots` / `investor-proxy` based screen:

```bash
npm run import:investor -- --file ./data/investor.csv --dry-run
npm run import:investor -- --file ./data/investor.csv
```

### Screening results

```bash
npm run import:screening -- --file ./data/screening.csv --dry-run
npm run import:screening -- --file ./data/screening.csv
npm run import:screening -- --file D:/Codex/Screening/output --dry-run
npm run import:screening -- --file D:/Codex/Screening/output
```

### Screening sync wrapper

Use this when the screening engine still runs manually, but you want the import step to happen only when
the output folder contains files newer than the last successful Supabase import.

```bash
npm run sync:screening -- --file D:/Codex/Screening/output --dry-run
npm run sync:screening -- --file D:/Codex/Screening/output
```

Optional arguments:

- `--env-file D:/Codex/secrets/econostock-sync.env`
- `--db D:/Codex/Screening/data/market_data.sqlite`
- `--force`
- `--skip-price-sync`

Behavior:

- checks `screening_sync_status.last_success_at`
- checks the modified time of CSV files in the output folder
- skips import when nothing new changed
- runs the normal `import:screening` command when a new or updated file is detected
- automatically runs `import-screening-price-sqlite.py` after screening sync
- when the screening files did not change, it still attempts an incremental price sync
- this lets the previous latest run fill automatically as soon as the next trading day's prices are available in `market_data.sqlite`

### One-click CMD runner

For the current local setup, you can run the prepared batch file:

```bat
sync-screening-to-web.bat
```

It uses these defaults:

- output folder: `D:\Codex\Screening\output`
- SQLite DB: `D:\Codex\Screening\data\market_data.sqlite`
- env file: `D:\Codex\secrets\econostock-sync.env`

You can also pass through wrapper flags:

```bat
sync-screening-to-web.bat --dry-run
sync-screening-to-web.bat --force
```

Supported screening import formats:

- normalized `screening.csv`
- one `daily_action_sheet_YYYY-MM-DD.csv`
- a directory that contains multiple `daily_action_sheet_*.csv` files

Required normalized screening CSV columns:

- `run_key`
- `as_of_date`
- `strategy_key`
- `stock_code`
- `stock_name`

Optional screening CSV columns:

- `run_label`
- `source`
- `status`
- `market`
- `rank_no`
- `score`
- `signal`
- `close_price`
- `change_rate`
- `volume`
- `reason_summary`
- `tags`
- `notes`

## Supabase migrations

Apply the migrations in `supabase/migrations` before using the monitoring pages.

Required migrations for a fresh project:

- `supabase/migrations/20260414071416_9e5e7c6a-6d87-46b9-945a-c5e6ab5c394f.sql`
- `supabase/migrations/20260617000200_add_naver_theme_tables.sql`
- `supabase/migrations/20260617000100_add_screening_monitor_tables.sql`
- `supabase/migrations/20260618000100_add_investor_flow_daily_tables.sql`
- `supabase/migrations/20260618000200_add_investor_flow_ranked_function.sql`

The KRX and investor screens also depend on these Edge Functions being deployed:

```text
supabase/functions/krx-proxy
supabase/functions/pykrx-proxy
```

`supabase/functions/investor-proxy` is only needed when you still operate the legacy
`investor_snapshots` screen.

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

# Investor Flow Import

## Goal

The current `investor flow` page uses the Screening project's local SQLite database:

- source DB: `D:\Codex\Screening\data\market_data.sqlite`
- source table: `investor_flow`
- enrichment tables: `ticker_universe`, `market_daily`

This path is designed for the data we already have:

- `individual_net`
- `foreign_net`
- `institution_net`

The page now shows:

- direct start/end trade-date selection
- cumulative and end-date net flow for individual / foreign / institution in one table
- sort-by investor filter: individual / foreign / institution
- market filter: ALL / KOSPI / KOSDAQ / KONEX

## Required migration

Apply these migrations in Supabase first:

```text
supabase/migrations/20260618000100_add_investor_flow_daily_tables.sql
supabase/migrations/20260618000200_add_investor_flow_ranked_function.sql
supabase/migrations/20260622000100_add_investor_flow_daily_counts_function.sql
```

## Required environment variables

```cmd
set SUPABASE_URL=https://your-project-id.supabase.co
set SUPABASE_SERVICE_KEY=your_service_role_key
```

If you already use the private env file below, the importer loads it automatically:

```text
D:\Codex\secrets\econostock-sync.env
```

You can also pass a custom file explicitly:

```cmd
npm run import:investor-flow -- --db D:\Codex\Screening\data\market_data.sqlite --env-file D:\Codex\secrets\econostock-sync.env --dry-run
```

## Recommended default sync

```cmd
npm run import:investor-flow -- --db D:\Codex\Screening\data\market_data.sqlite --dry-run
npm run import:investor-flow -- --db D:\Codex\Screening\data\market_data.sqlite
```

When no date filter is provided, the importer now compares local SQLite date counts against Supabase and uploads only missing or mismatched trade dates.

## Safe partial retry

If a previous upload failed partway through, rerun only the missing trading day or date range:

```cmd
npm run import:investor-flow -- --db D:\Codex\Screening\data\market_data.sqlite --start-date 20260619 --end-date 20260619
npm run import:investor-flow -- --db D:\Codex\Screening\data\market_data.sqlite --start-date 20260618 --end-date 20260619 --dry-run
```

## Optional latest-N test import

```cmd
npm run import:investor-flow -- --db D:\Codex\Screening\data\market_data.sqlite --limit-days 5 --dry-run
npm run import:investor-flow -- --db D:\Codex\Screening\data\market_data.sqlite --limit-days 5
```

## Full import

Full-history upload is still supported, but it now requires an explicit safety flag:

```cmd
npm run import:investor-flow -- --db D:\Codex\Screening\data\market_data.sqlite --allow-full-history
```

## Optional date range import

```cmd
npm run import:investor-flow -- --db D:\Codex\Screening\data\market_data.sqlite --start-date 20260101 --end-date 20260617
```

Accepted date formats:

- `YYYYMMDD`
- `YYYY-MM-DD`

## Imported table

Target table:

```text
public.investor_flow_daily
```

Imported columns:

- `trade_date`
- `stock_code`
- `stock_name`
- `market`
- `close_price`
- `individual_net`
- `foreign_net`
- `institution_net`
- `source`
- `collected_at`

## Sync status

The importer writes progress to:

```text
public.investor_sync_status
```

with:

```text
sync_key = investor_flow_sqlite_import
```

## Why this path

This is the most practical service path right now because:

1. the data already exists locally
2. it covers a long history
3. it is stable enough to power a useful investor dashboard today

Detailed investor categories such as pension / insurance / securities can be added later through the
legacy `investor_snapshots` collector if that collection path becomes reliable again.

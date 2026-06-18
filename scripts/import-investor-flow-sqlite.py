#!/usr/bin/env python
"""
Import investor_flow rows from the local Screening SQLite database into Supabase.

Example:
  python scripts/import-investor-flow-sqlite.py --db D:\\Codex\\Screening\\data\\market_data.sqlite --limit-days 60 --dry-run
  python scripts/import-investor-flow-sqlite.py --db D:\\Codex\\Screening\\data\\market_data.sqlite --limit-days 60
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Iterable

SYNC_KEY = "investor_flow_sqlite_import"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import investor_flow rows from Screening SQLite into Supabase")
    parser.add_argument("--db", required=True, help="Path to market_data.sqlite")
    parser.add_argument("--env-file", help="Optional env file that contains SUPABASE_URL and SUPABASE_SERVICE_KEY")
    parser.add_argument("--start-date", help="Optional start date (YYYYMMDD or YYYY-MM-DD)")
    parser.add_argument("--end-date", help="Optional end date (YYYYMMDD or YYYY-MM-DD)")
    parser.add_argument("--limit-days", type=int, help="Import only the latest N distinct trade dates after filters")
    parser.add_argument("--chunk-size", type=int, default=2000, help="Rows per Supabase upsert request")
    parser.add_argument("--dry-run", action="store_true", help="Inspect rows without uploading")
    return parser.parse_args()


def normalize_sqlite_date(raw: str | None) -> str | None:
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None
    if len(text) == 8 and text.isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:8]}"
    if len(text) == 10 and text[4] == "-" and text[7] == "-":
        return text
    raise ValueError(f"Unsupported date format: {raw}")


def compact_date(iso_date: str) -> str:
    return iso_date.replace("-", "")


def load_env_file(path: Path) -> None:
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def post_json(url: str, headers: dict[str, str], payload: list[dict] | dict) -> None:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        if response.status < 200 or response.status >= 300:
            body = response.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase POST failed ({response.status}): {body[:500]}")


def upsert_sync_status(
    supabase_url: str,
    service_key: str,
    *,
    last_attempt_at: str,
    last_success_at: str | None,
    last_error: str | None,
    row_count: int,
) -> None:
    headers = {
        "Content-Type": "application/json",
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    payload = [
        {
            "sync_key": SYNC_KEY,
            "last_attempt_at": last_attempt_at,
            "last_success_at": last_success_at,
            "last_error": last_error,
            "row_count": row_count,
        }
    ]
    post_json(f"{supabase_url}/rest/v1/investor_sync_status", headers, payload)


def fetch_trade_dates(
    conn: sqlite3.Connection,
    *,
    start_date: str | None,
    end_date: str | None,
    limit_days: int | None,
) -> list[str]:
    where = []
    params: list[str] = []
    if start_date:
        where.append("trade_date >= ?")
        params.append(start_date)
    if end_date:
        where.append("trade_date <= ?")
        params.append(end_date)

    sql = "SELECT DISTINCT trade_date FROM investor_flow"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY trade_date DESC"

    rows = [row[0] for row in conn.execute(sql, params).fetchall()]
    if limit_days:
        rows = rows[: max(1, limit_days)]
    return list(reversed(rows))


def count_rows(conn: sqlite3.Connection, start_date: str, end_date: str) -> int:
    sql = """
        SELECT COUNT(*)
        FROM investor_flow
        WHERE trade_date >= ? AND trade_date <= ?
    """
    return int(conn.execute(sql, (start_date, end_date)).fetchone()[0])


def iter_rows(
    conn: sqlite3.Connection,
    *,
    start_date: str,
    end_date: str,
    fetch_size: int,
) -> Iterable[list[sqlite3.Row]]:
    sql = """
        SELECT
          flow.trade_date,
          flow.ticker AS stock_code,
          COALESCE(univ.name, '') AS stock_name,
          COALESCE(univ.market, '') AS market,
          CAST(ROUND(COALESCE(md.close, 0)) AS INTEGER) AS close_price,
          CAST(ROUND(COALESCE(flow.individual_net, 0)) AS INTEGER) AS individual_net,
          CAST(ROUND(COALESCE(flow.foreign_net, 0)) AS INTEGER) AS foreign_net,
          CAST(ROUND(COALESCE(flow.institution_net, 0)) AS INTEGER) AS institution_net,
          COALESCE(flow.source, 'screening_sqlite') AS source
        FROM investor_flow AS flow
        LEFT JOIN ticker_universe AS univ
          ON univ.trade_date = flow.trade_date
         AND univ.ticker = flow.ticker
        LEFT JOIN market_daily AS md
          ON md.trade_date = flow.trade_date
         AND md.ticker = flow.ticker
        WHERE flow.trade_date >= ? AND flow.trade_date <= ?
        ORDER BY flow.trade_date, flow.ticker
    """
    cursor = conn.execute(sql, (start_date, end_date))
    try:
        while True:
            rows = cursor.fetchmany(fetch_size)
            if not rows:
                break
            yield rows
    finally:
        cursor.close()


def fetch_sample_rows(conn: sqlite3.Connection, *, start_date: str, end_date: str, limit: int = 5) -> list[sqlite3.Row]:
    sql = """
        SELECT
          flow.trade_date,
          flow.ticker AS stock_code,
          COALESCE(univ.name, '') AS stock_name,
          COALESCE(univ.market, '') AS market,
          CAST(ROUND(COALESCE(md.close, 0)) AS INTEGER) AS close_price,
          CAST(ROUND(COALESCE(flow.individual_net, 0)) AS INTEGER) AS individual_net,
          CAST(ROUND(COALESCE(flow.foreign_net, 0)) AS INTEGER) AS foreign_net,
          CAST(ROUND(COALESCE(flow.institution_net, 0)) AS INTEGER) AS institution_net,
          COALESCE(flow.source, 'screening_sqlite') AS source
        FROM investor_flow AS flow
        LEFT JOIN ticker_universe AS univ
          ON univ.trade_date = flow.trade_date
         AND univ.ticker = flow.ticker
        LEFT JOIN market_daily AS md
          ON md.trade_date = flow.trade_date
         AND md.ticker = flow.ticker
        WHERE flow.trade_date >= ? AND flow.trade_date <= ?
        ORDER BY flow.trade_date, flow.ticker
        LIMIT ?
    """
    cursor = conn.execute(sql, (start_date, end_date, limit))
    try:
        return cursor.fetchall()
    finally:
        cursor.close()


def row_to_payload(row: sqlite3.Row) -> dict:
    trade_date = row["trade_date"]
    return {
        "trade_date": compact_date(trade_date),
        "stock_code": str(row["stock_code"]).zfill(6),
        "stock_name": row["stock_name"] or "",
        "market": row["market"] or "",
        "close_price": int(row["close_price"] or 0),
        "individual_net": int(row["individual_net"] or 0),
        "foreign_net": int(row["foreign_net"] or 0),
        "institution_net": int(row["institution_net"] or 0),
        "source": row["source"] or "screening_sqlite",
        "collected_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def chunked(items: list[dict], size: int) -> Iterable[list[dict]]:
    for index in range(0, len(items), size):
        yield items[index : index + size]


def main() -> int:
    args = parse_args()
    db_path = Path(args.db)
    if not db_path.exists():
        print(f"[investor_flow] SQLite file not found: {db_path}", file=sys.stderr)
        return 1

    start_date = normalize_sqlite_date(args.start_date)
    end_date = normalize_sqlite_date(args.end_date)
    if start_date and end_date and start_date > end_date:
        print("[investor_flow] start-date must be <= end-date", file=sys.stderr)
        return 1

    env_file = Path(args.env_file) if args.env_file else Path(r"D:\Codex\secrets\econostock-sync.env")
    if env_file.exists():
        load_env_file(env_file)
        print(f"[investor_flow] env file loaded: {env_file}")

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    try:
        trade_dates = fetch_trade_dates(
            conn,
            start_date=start_date,
            end_date=end_date,
            limit_days=args.limit_days,
        )
        if not trade_dates:
            print("[investor_flow] No matching trade dates found.")
            return 0

        effective_start = trade_dates[0]
        effective_end = trade_dates[-1]
        total_rows = count_rows(conn, effective_start, effective_end)

        print("[investor_flow] import plan")
        print(f"  db         : {db_path}")
        print(f"  start_date : {effective_start}")
        print(f"  end_date   : {effective_end}")
        print(f"  trade_days : {len(trade_dates):,}")
        print(f"  total_rows : {total_rows:,}")
        print(f"  chunk_size : {args.chunk_size:,}")

        if args.dry_run:
            sample_rows = fetch_sample_rows(conn, start_date=effective_start, end_date=effective_end, limit=5)
            print("  mode       : dry-run")
            print("  sample     :")
            for row in sample_rows[:5]:
                payload = row_to_payload(row)
                print(
                    f"    {payload['trade_date']} {payload['stock_code']} {payload['stock_name']} "
                    f"{payload['market']} foreign={payload['foreign_net']}"
                )
            return 0

        supabase_url = require_env("SUPABASE_URL")
        service_key = require_env("SUPABASE_SERVICE_KEY")
        request_headers = {
            "Content-Type": "application/json",
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        }

        attempt_time = dt.datetime.now(dt.timezone.utc).isoformat()
        upsert_sync_status(
            supabase_url,
            service_key,
            last_attempt_at=attempt_time,
            last_success_at=None,
            last_error=None,
            row_count=0,
        )

        uploaded_rows = 0
        buffer: list[dict] = []
        try:
            for rows in iter_rows(conn, start_date=effective_start, end_date=effective_end, fetch_size=args.chunk_size):
                for row in rows:
                    buffer.append(row_to_payload(row))
                for payload in chunked(buffer, args.chunk_size):
                    post_json(f"{supabase_url}/rest/v1/investor_flow_daily", request_headers, payload)
                    uploaded_rows += len(payload)
                    print(f"[investor_flow] uploaded {uploaded_rows:,}/{total_rows:,}")
                buffer.clear()
        except Exception as exc:
            upsert_sync_status(
                supabase_url,
                service_key,
                last_attempt_at=attempt_time,
                last_success_at=None,
                last_error=str(exc),
                row_count=uploaded_rows,
            )
            raise

        success_time = dt.datetime.now(dt.timezone.utc).isoformat()
        upsert_sync_status(
            supabase_url,
            service_key,
            last_attempt_at=attempt_time,
            last_success_at=success_time,
            last_error=None,
            row_count=uploaded_rows,
        )
        print("[investor_flow] import completed")
        print(f"  uploaded_rows : {uploaded_rows:,}")
        return 0
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"[investor_flow] HTTP error {exc.code}: {body[:500]}", file=sys.stderr)
        return 1
    except Exception as exc:  # pragma: no cover - CLI guard
        print(f"[investor_flow] failed: {exc}", file=sys.stderr)
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())

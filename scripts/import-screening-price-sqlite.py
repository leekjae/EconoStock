#!/usr/bin/env python
"""
Import screening performance OHLC rows from the local Screening SQLite database.

This importer only uploads tickers that already exist in screening_candidates so the
web screening monitor can calculate entry/open performance from synced local prices
instead of relying on the live KRX proxy.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Iterable

SYNC_KEY = "screening_price_sqlite_import"
STATUS_SOURCE = "screening_sqlite"
PAGE_SIZE = 1000


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import screening price rows from Screening SQLite into Supabase")
    parser.add_argument("--db", required=True, help="Path to market_data.sqlite")
    parser.add_argument("--env-file", help="Optional env file that contains SUPABASE_URL and SUPABASE_SERVICE_KEY")
    parser.add_argument("--start-date", help="Optional start date (YYYYMMDD or YYYY-MM-DD)")
    parser.add_argument("--end-date", help="Optional end date (YYYYMMDD or YYYY-MM-DD)")
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


def get_json(url: str, headers: dict[str, str]) -> list[dict] | dict:
    request = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(request, timeout=120) as response:
        if response.status < 200 or response.status >= 300:
            body = response.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase GET failed ({response.status}): {body[:500]}")
        payload = response.read().decode("utf-8")
    return json.loads(payload) if payload else []


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


def build_headers(service_key: str) -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    }


def build_upsert_headers(service_key: str) -> dict[str, str]:
    headers = build_headers(service_key)
    headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    return headers


def fetch_first_run_date(supabase_url: str, service_key: str) -> str | None:
    params = urllib.parse.urlencode(
        {
            "select": "as_of_date",
            "order": "as_of_date.asc",
            "limit": "1",
        }
    )
    rows = get_json(f"{supabase_url}/rest/v1/screening_runs?{params}", build_headers(service_key))
    if not isinstance(rows, list) or not rows:
        return None
    return normalize_sqlite_date(str(rows[0].get("as_of_date", "")))


def fetch_candidate_codes(supabase_url: str, service_key: str) -> list[str]:
    headers = build_headers(service_key)
    codes: set[str] = set()
    offset = 0

    while True:
        params = urllib.parse.urlencode(
            {
                "select": "stock_code",
                "order": "stock_code.asc,run_key.asc",
                "limit": str(PAGE_SIZE),
                "offset": str(offset),
            }
        )
        rows = get_json(f"{supabase_url}/rest/v1/screening_candidates?{params}", headers)
        if not isinstance(rows, list) or not rows:
            break
        for row in rows:
            stock_code = str(row.get("stock_code", "")).strip()
            digits = "".join(ch for ch in stock_code if ch.isdigit())
            if digits:
                codes.add(digits.zfill(6))
        if len(rows) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    return sorted(codes)


def upsert_sync_status(
    supabase_url: str,
    service_key: str,
    *,
    last_attempt_at: str,
    last_success_at: str | None,
    last_error: str | None,
    run_count: int,
    row_count: int,
) -> None:
    payload = [
        {
            "sync_key": SYNC_KEY,
            "source": STATUS_SOURCE,
            "last_attempt_at": last_attempt_at,
            "last_success_at": last_success_at,
            "last_error": last_error,
            "run_count": run_count,
            "row_count": row_count,
        }
    ]
    post_json(f"{supabase_url}/rest/v1/screening_sync_status", build_upsert_headers(service_key), payload)


def fetch_sqlite_market_max_date(conn: sqlite3.Connection) -> str | None:
    row = conn.execute("SELECT MAX(trade_date) FROM market_daily").fetchone()
    return normalize_sqlite_date(row[0]) if row and row[0] else None


def prepare_selected_codes_table(conn: sqlite3.Connection, codes: list[str]) -> None:
    conn.execute("DROP TABLE IF EXISTS selected_screening_codes")
    conn.execute("CREATE TEMP TABLE selected_screening_codes (ticker TEXT PRIMARY KEY)")
    conn.executemany(
        "INSERT OR IGNORE INTO selected_screening_codes (ticker) VALUES (?)",
        [(code,) for code in codes],
    )


def count_trade_days(conn: sqlite3.Connection, *, start_date: str, end_date: str) -> int:
    sql = """
        SELECT COUNT(DISTINCT md.trade_date)
        FROM market_daily AS md
        INNER JOIN selected_screening_codes AS codes
          ON codes.ticker = md.ticker
        WHERE md.trade_date >= ? AND md.trade_date <= ?
    """
    return int(conn.execute(sql, (start_date, end_date)).fetchone()[0] or 0)


def count_rows(conn: sqlite3.Connection, *, start_date: str, end_date: str) -> int:
    sql = """
        SELECT COUNT(*)
        FROM market_daily AS md
        INNER JOIN selected_screening_codes AS codes
          ON codes.ticker = md.ticker
        WHERE md.trade_date >= ? AND md.trade_date <= ?
    """
    return int(conn.execute(sql, (start_date, end_date)).fetchone()[0] or 0)


def iter_rows(
    conn: sqlite3.Connection,
    *,
    start_date: str,
    end_date: str,
    fetch_size: int,
) -> Iterable[list[sqlite3.Row]]:
    sql = """
        SELECT
          md.trade_date,
          md.ticker AS stock_code,
          COALESCE(univ.name, '') AS stock_name,
          COALESCE(univ.market, '') AS market,
          CAST(ROUND(COALESCE(md.open, 0)) AS INTEGER) AS open_price,
          CAST(ROUND(COALESCE(md.high, 0)) AS INTEGER) AS high_price,
          CAST(ROUND(COALESCE(md.low, 0)) AS INTEGER) AS low_price,
          CAST(ROUND(COALESCE(md.close, 0)) AS INTEGER) AS close_price,
          CAST(ROUND(COALESCE(md.volume, 0)) AS INTEGER) AS volume,
          CAST(ROUND(COALESCE(md.value, 0)) AS INTEGER) AS value,
          COALESCE(md.source, 'screening_sqlite') AS source
        FROM market_daily AS md
        INNER JOIN selected_screening_codes AS codes
          ON codes.ticker = md.ticker
        LEFT JOIN ticker_universe AS univ
          ON univ.trade_date = md.trade_date
         AND univ.ticker = md.ticker
        WHERE md.trade_date >= ? AND md.trade_date <= ?
        ORDER BY md.trade_date, md.ticker
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
          md.trade_date,
          md.ticker AS stock_code,
          COALESCE(univ.name, '') AS stock_name,
          COALESCE(univ.market, '') AS market,
          CAST(ROUND(COALESCE(md.open, 0)) AS INTEGER) AS open_price,
          CAST(ROUND(COALESCE(md.high, 0)) AS INTEGER) AS high_price,
          CAST(ROUND(COALESCE(md.low, 0)) AS INTEGER) AS low_price,
          CAST(ROUND(COALESCE(md.close, 0)) AS INTEGER) AS close_price,
          CAST(ROUND(COALESCE(md.volume, 0)) AS INTEGER) AS volume,
          CAST(ROUND(COALESCE(md.value, 0)) AS INTEGER) AS value,
          COALESCE(md.source, 'screening_sqlite') AS source
        FROM market_daily AS md
        INNER JOIN selected_screening_codes AS codes
          ON codes.ticker = md.ticker
        LEFT JOIN ticker_universe AS univ
          ON univ.trade_date = md.trade_date
         AND univ.ticker = md.ticker
        WHERE md.trade_date >= ? AND md.trade_date <= ?
        ORDER BY md.trade_date, md.ticker
        LIMIT ?
    """
    cursor = conn.execute(sql, (start_date, end_date, limit))
    try:
        return cursor.fetchall()
    finally:
        cursor.close()


def row_to_payload(row: sqlite3.Row) -> dict:
    return {
        "trade_date": compact_date(str(row["trade_date"])),
        "stock_code": str(row["stock_code"]).zfill(6),
        "stock_name": row["stock_name"] or "",
        "market": row["market"] or "",
        "open_price": int(row["open_price"] or 0),
        "high_price": int(row["high_price"] or 0),
        "low_price": int(row["low_price"] or 0),
        "close_price": int(row["close_price"] or 0),
        "volume": int(row["volume"] or 0),
        "value": int(row["value"] or 0),
        "source": row["source"] or STATUS_SOURCE,
        "collected_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def chunked(items: list[dict], size: int) -> Iterable[list[dict]]:
    for index in range(0, len(items), size):
        yield items[index : index + size]


def main() -> int:
    args = parse_args()
    db_path = Path(args.db)
    if not db_path.exists():
        print(f"[screening_price] SQLite file not found: {db_path}", file=sys.stderr)
        return 1

    start_date = normalize_sqlite_date(args.start_date)
    end_date = normalize_sqlite_date(args.end_date)
    if start_date and end_date and start_date > end_date:
        print("[screening_price] start-date must be <= end-date", file=sys.stderr)
        return 1

    env_file = Path(args.env_file) if args.env_file else Path(r"D:\Codex\secrets\econostock-sync.env")
    if env_file.exists():
        load_env_file(env_file)
        print(f"[screening_price] env file loaded: {env_file}")

    try:
        supabase_url = require_env("SUPABASE_URL")
        service_key = require_env("SUPABASE_SERVICE_KEY")
    except Exception as exc:
        print(f"[screening_price] failed: {exc}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    try:
        effective_start = start_date or fetch_first_run_date(supabase_url, service_key)
        if not effective_start:
            print("[screening_price] No screening runs found in Supabase. Skipping price import.")
            return 0

        effective_end = end_date or fetch_sqlite_market_max_date(conn)
        if not effective_end:
            print("[screening_price] No market_daily rows found in SQLite.", file=sys.stderr)
            return 1
        if effective_start > effective_end:
            print(
                f"[screening_price] effective start {effective_start} is after effective end {effective_end}.",
                file=sys.stderr,
            )
            return 1

        candidate_codes = fetch_candidate_codes(supabase_url, service_key)
        if not candidate_codes:
            print("[screening_price] No screening candidate codes found in Supabase. Skipping price import.")
            return 0

        prepare_selected_codes_table(conn, candidate_codes)
        trade_days = count_trade_days(conn, start_date=effective_start, end_date=effective_end)
        total_rows = count_rows(conn, start_date=effective_start, end_date=effective_end)

        print("[screening_price] import plan")
        print(f"  db             : {db_path}")
        print(f"  start_date     : {effective_start}")
        print(f"  end_date       : {effective_end}")
        print(f"  candidate_codes: {len(candidate_codes):,}")
        print(f"  trade_days     : {trade_days:,}")
        print(f"  total_rows     : {total_rows:,}")
        print(f"  chunk_size     : {args.chunk_size:,}")

        if total_rows == 0:
            print("[screening_price] No matching SQLite price rows found for screening candidates.", file=sys.stderr)
            return 1

        if args.dry_run:
            sample_rows = fetch_sample_rows(conn, start_date=effective_start, end_date=effective_end, limit=5)
            print("  mode           : dry-run")
            print("  sample         :")
            for row in sample_rows:
                payload = row_to_payload(row)
                print(
                    f"    {payload['trade_date']} {payload['stock_code']} {payload['stock_name']} "
                    f"open={payload['open_price']} close={payload['close_price']}"
                )
            return 0

        upsert_headers = build_upsert_headers(service_key)
        attempt_time = dt.datetime.now(dt.timezone.utc).isoformat()
        upsert_sync_status(
            supabase_url,
            service_key,
            last_attempt_at=attempt_time,
            last_success_at=None,
            last_error=None,
            run_count=trade_days,
            row_count=0,
        )

        uploaded_rows = 0
        try:
            for rows in iter_rows(conn, start_date=effective_start, end_date=effective_end, fetch_size=args.chunk_size):
                payload_rows = [row_to_payload(row) for row in rows]
                for payload in chunked(payload_rows, args.chunk_size):
                    post_json(f"{supabase_url}/rest/v1/screening_price_daily", upsert_headers, payload)
                    uploaded_rows += len(payload)
                    print(f"[screening_price] uploaded {uploaded_rows:,}/{total_rows:,}")
        except Exception as exc:
            upsert_sync_status(
                supabase_url,
                service_key,
                last_attempt_at=attempt_time,
                last_success_at=None,
                last_error=str(exc),
                run_count=trade_days,
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
            run_count=trade_days,
            row_count=uploaded_rows,
        )
        print("[screening_price] import completed")
        print(f"  uploaded_rows : {uploaded_rows:,}")
        return 0
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"[screening_price] HTTP error {exc.code}: {body[:500]}", file=sys.stderr)
        return 1
    except Exception as exc:  # pragma: no cover - CLI guard
        print(f"[screening_price] failed: {exc}", file=sys.stderr)
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())

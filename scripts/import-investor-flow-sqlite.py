#!/usr/bin/env python
"""
Import investor_flow rows from the local Screening SQLite database into Supabase.

Default behavior is now safe for re-runs:

- if no date filter is provided, the script compares local SQLite dates against
  Supabase date counts and uploads only missing or mismatched trade dates
- full-history upload without filters requires --allow-full-history

Examples:
  python scripts/import-investor-flow-sqlite.py --db D:\\Codex\\Screening\\data\\market_data.sqlite --dry-run
  python scripts/import-investor-flow-sqlite.py --db D:\\Codex\\Screening\\data\\market_data.sqlite
  python scripts/import-investor-flow-sqlite.py --db D:\\Codex\\Screening\\data\\market_data.sqlite --start-date 2026-06-19 --end-date 2026-06-19
  python scripts/import-investor-flow-sqlite.py --db D:\\Codex\\Screening\\data\\market_data.sqlite --allow-full-history
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
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

SYNC_KEY = "investor_flow_sqlite_import"
REMOTE_COUNT_RPC = "get_investor_flow_daily_counts"
REMOTE_COUNT_RPC_MIGRATION = "supabase/migrations/20260622000100_add_investor_flow_daily_counts_function.sql"


@dataclass(frozen=True)
class TradeDateSummary:
    iso_date: str
    compact_date: str
    row_count: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import investor_flow rows from Screening SQLite into Supabase")
    parser.add_argument("--db", required=True, help="Path to market_data.sqlite")
    parser.add_argument("--env-file", help="Optional env file that contains SUPABASE_URL and SUPABASE_SERVICE_KEY")
    parser.add_argument("--start-date", help="Optional start date (YYYYMMDD or YYYY-MM-DD)")
    parser.add_argument("--end-date", help="Optional end date (YYYYMMDD or YYYY-MM-DD)")
    parser.add_argument("--limit-days", type=int, help="Import only the latest N distinct trade dates after filters")
    parser.add_argument("--chunk-size", type=int, default=2000, help="Rows per Supabase upsert request")
    parser.add_argument("--allow-full-history", action="store_true", help="Allow importing all matching trade dates when no date filter is provided")
    parser.add_argument("--dry-run", action="store_true", help="Inspect the sync plan and sample rows without uploading")
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


def format_date_list(dates: list[str], *, limit: int = 8) -> str:
    if not dates:
        return "-"
    if len(dates) <= limit:
        return ", ".join(dates)
    head = ", ".join(dates[:limit])
    return f"{head}, ... ({len(dates):,} dates)"


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


def request_json(
    url: str,
    headers: dict[str, str],
    payload: list[dict] | dict,
    *,
    method: str = "POST",
) -> list[dict] | dict | None:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method=method,
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        if response.status < 200 or response.status >= 300:
            body = response.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase request failed ({response.status}): {body[:500]}")
        body = response.read().decode("utf-8", errors="replace").strip()
        if not body:
            return None
        return json.loads(body)


def post_json(url: str, headers: dict[str, str], payload: list[dict] | dict) -> None:
    request_json(url, headers, payload, method="POST")


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


def fetch_local_date_counts(
    conn: sqlite3.Connection,
    *,
    start_date: str | None,
    end_date: str | None,
    limit_days: int | None,
) -> list[TradeDateSummary]:
    where = []
    params: list[str] = []
    if start_date:
        where.append("trade_date >= ?")
        params.append(start_date)
    if end_date:
        where.append("trade_date <= ?")
        params.append(end_date)

    sql = """
        SELECT trade_date, COUNT(*) AS row_count
        FROM investor_flow
    """
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " GROUP BY trade_date ORDER BY trade_date DESC"

    rows = conn.execute(sql, params).fetchall()
    if limit_days:
        rows = rows[: max(1, limit_days)]

    summaries = [
        TradeDateSummary(
            iso_date=normalize_sqlite_date(str(row[0])) or str(row[0]),
            compact_date=compact_date(normalize_sqlite_date(str(row[0])) or str(row[0])),
            row_count=int(row[1]),
        )
        for row in rows
    ]
    return list(reversed(summaries))


def fetch_remote_date_counts(
    supabase_url: str,
    service_key: str,
    *,
    start_date: str | None,
    end_date: str | None,
    limit: int,
) -> dict[str, int]:
    headers = {
        "Content-Type": "application/json",
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    }
    payload: dict[str, str | int] = {
        "p_limit": max(1, min(limit, 10000)),
    }
    if start_date:
        payload["p_start_date"] = compact_date(start_date)
    if end_date:
        payload["p_end_date"] = compact_date(end_date)

    try:
        response = request_json(
            f"{supabase_url}/rest/v1/rpc/{REMOTE_COUNT_RPC}",
            headers,
            payload,
            method="POST",
        )
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            "Remote investor date-count RPC is unavailable. "
            f"Apply {REMOTE_COUNT_RPC_MIGRATION} in Supabase first. "
            f"Original error: HTTP {exc.code} {body[:300]}"
        ) from exc

    rows = response if isinstance(response, list) else []
    counts: dict[str, int] = {}
    for row in rows:
        trade_date = str(row.get("trade_date", "")).strip()
        if not trade_date:
            continue
        counts[trade_date] = int(row.get("row_count") or 0)
    return counts


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


def build_range_groups(
    all_summaries: list[TradeDateSummary],
    target_summaries: list[TradeDateSummary],
) -> list[tuple[str, str, int, int]]:
    position = {summary.compact_date: index for index, summary in enumerate(all_summaries)}
    ordered_targets = sorted(target_summaries, key=lambda summary: position[summary.compact_date])
    groups: list[tuple[str, str, int, int]] = []
    group_start = ordered_targets[0]
    group_end = ordered_targets[0]
    group_days = 1
    group_rows = ordered_targets[0].row_count

    for summary in ordered_targets[1:]:
        previous_index = position[group_end.compact_date]
        current_index = position[summary.compact_date]
        if current_index == previous_index + 1:
            group_end = summary
            group_days += 1
            group_rows += summary.row_count
            continue

        groups.append((group_start.iso_date, group_end.iso_date, group_days, group_rows))
        group_start = summary
        group_end = summary
        group_days = 1
        group_rows = summary.row_count

    groups.append((group_start.iso_date, group_end.iso_date, group_days, group_rows))
    return groups


def select_target_summaries(
    local_summaries: list[TradeDateSummary],
    *,
    explicit_filter: bool,
    allow_full_history: bool,
    supabase_url: str | None,
    service_key: str | None,
) -> tuple[str, list[TradeDateSummary], dict[str, int]]:
    if explicit_filter:
        return "filtered", local_summaries, {}

    if allow_full_history:
        return "full-history", local_summaries, {}

    if not supabase_url or not service_key:
        raise RuntimeError(
            "Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. "
            "Use --start-date/--end-date for a manual range, or set the env file so the script can compare remote dates automatically."
        )

    remote_counts = fetch_remote_date_counts(
        supabase_url,
        service_key,
        start_date=local_summaries[0].iso_date,
        end_date=local_summaries[-1].iso_date,
        limit=len(local_summaries) + 32,
    )
    missing_or_mismatched = [
        summary
        for summary in local_summaries
        if remote_counts.get(summary.compact_date) != summary.row_count
    ]
    return "missing-only", missing_or_mismatched, remote_counts


def print_plan(
    *,
    db_path: Path,
    local_summaries: list[TradeDateSummary],
    target_summaries: list[TradeDateSummary],
    remote_counts: dict[str, int],
    plan_mode: str,
    chunk_size: int,
) -> list[tuple[str, str, int, int]]:
    target_ranges = build_range_groups(local_summaries, target_summaries) if target_summaries else []
    total_target_rows = sum(summary.row_count for summary in target_summaries)
    total_target_days = len(target_summaries)
    local_latest = local_summaries[-1].iso_date
    remote_latest = max(remote_counts) if remote_counts else None
    missing_dates = [summary.iso_date for summary in target_summaries if summary.compact_date not in remote_counts]
    mismatched_dates = [
        summary.iso_date
        for summary in target_summaries
        if summary.compact_date in remote_counts and remote_counts.get(summary.compact_date) != summary.row_count
    ]

    print("[investor_flow] import plan")
    print(f"  db                : {db_path}")
    print(f"  plan_mode         : {plan_mode}")
    print(f"  local_start_date  : {local_summaries[0].iso_date}")
    print(f"  local_end_date    : {local_latest}")
    print(f"  local_trade_days  : {len(local_summaries):,}")
    print(f"  sync_trade_days   : {total_target_days:,}")
    print(f"  sync_total_rows   : {total_target_rows:,}")
    print(f"  chunk_size        : {chunk_size:,}")
    if remote_counts:
        print(f"  remote_trade_days : {len(remote_counts):,}")
        print(f"  remote_latest     : {normalize_sqlite_date(remote_latest) if remote_latest else '-'}")
        print(f"  missing_dates     : {format_date_list(missing_dates)}")
        print(f"  mismatch_dates    : {format_date_list(mismatched_dates)}")
    else:
        print("  remote_trade_days : (not checked)")

    if not target_ranges:
        print("  sync_ranges       : none")
        return []

    print("  sync_ranges       :")
    for start_date, end_date, day_count, row_count in target_ranges[:10]:
        if start_date == end_date:
            label = start_date
        else:
            label = f"{start_date} ~ {end_date}"
        print(f"    - {label} ({day_count:,} trade days, {row_count:,} rows)")
    if len(target_ranges) > 10:
        print(f"    - ... ({len(target_ranges):,} ranges total)")
    return target_ranges


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

    supabase_url = os.environ.get("SUPABASE_URL", "").strip() or None
    service_key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip() or None
    explicit_filter = any([start_date, end_date, args.limit_days])

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    try:
        local_summaries = fetch_local_date_counts(
            conn,
            start_date=start_date,
            end_date=end_date,
            limit_days=args.limit_days,
        )
        if not local_summaries:
            print("[investor_flow] No matching trade dates found.")
            return 0

        plan_mode, target_summaries, remote_counts = select_target_summaries(
            local_summaries,
            explicit_filter=explicit_filter,
            allow_full_history=args.allow_full_history,
            supabase_url=supabase_url,
            service_key=service_key,
        )
        target_ranges = print_plan(
            db_path=db_path,
            local_summaries=local_summaries,
            target_summaries=target_summaries,
            remote_counts=remote_counts,
            plan_mode=plan_mode,
            chunk_size=args.chunk_size,
        )

        if not target_summaries:
            print("[investor_flow] No missing or mismatched trade dates detected. Nothing to upload.")
            return 0

        if args.dry_run:
            first_range = target_ranges[0]
            sample_rows = fetch_sample_rows(conn, start_date=first_range[0], end_date=first_range[1], limit=5)
            print("  mode              : dry-run")
            print("  sample            :")
            for row in sample_rows[:5]:
                payload = row_to_payload(row)
                print(
                    f"    {payload['trade_date']} {payload['stock_code']} {payload['stock_name']} "
                    f"{payload['market']} foreign={payload['foreign_net']}"
                )
            return 0

        if not supabase_url or not service_key:
            raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY")

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

        total_target_rows = sum(summary.row_count for summary in target_summaries)
        uploaded_rows = 0

        try:
            for range_index, (range_start, range_end, range_days, range_rows) in enumerate(target_ranges, start=1):
                print(
                    f"[investor_flow] syncing range {range_index}/{len(target_ranges)} "
                    f"{range_start} ~ {range_end} ({range_days:,} trade days, {range_rows:,} rows)"
                )
                buffer: list[dict] = []
                for rows in iter_rows(conn, start_date=range_start, end_date=range_end, fetch_size=args.chunk_size):
                    for row in rows:
                        buffer.append(row_to_payload(row))
                    for payload in chunked(buffer, args.chunk_size):
                        post_json(f"{supabase_url}/rest/v1/investor_flow_daily", request_headers, payload)
                        uploaded_rows += len(payload)
                        print(f"[investor_flow] uploaded {uploaded_rows:,}/{total_target_rows:,}")
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


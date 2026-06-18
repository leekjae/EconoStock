#!/usr/bin/env -S deno run --allow-net --allow-env
/**
 * 투자자별 순매수 상위종목 수집기 (한국 IP 전용)
 *
 * 모드:
 *   --mode=incremental (기본) : DB의 마지막 수집일 다음 날부터 오늘까지
 *   --mode=backfill           : 오늘 기준 1년 전부터 오늘까지
 *   --mode=single             : 특정 날짜 1일만 (--date=YYYYMMDD)
 *
 * 환경변수:
 *   SUPABASE_URL         - Supabase 프로젝트 URL
 *   SUPABASE_SERVICE_KEY  - Supabase service role key
 *
 * 사용법:
 *   deno run --allow-net --allow-env scripts/collect-investor-data.ts
 *   deno run --allow-net --allow-env scripts/collect-investor-data.ts --mode=backfill
 *   deno run --allow-net --allow-env scripts/collect-investor-data.ts --mode=single --date=20260407
 */

// ─── Configuration ───
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_KEY")!;

const KRX_OTP_URL = "https://data.krx.co.kr/comm/fileDn/GenerateOTP/generate.cmd";
const KRX_CSV_URL = "https://data.krx.co.kr/comm/fileDn/download_csv/download.cmd";
const KRX_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const KRX_REFERER = "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC02020301";

const MARKETS = [
  { label: "ALL", code: "ALL" },
  { label: "STK", code: "STK" },
  { label: "KSQ", code: "KSQ" },
];

const INVESTORS = [
  { label: "개인", code: "8000" },
  { label: "외국인", code: "9000" },
  { label: "기관합계", code: "7050" },
  { label: "연기금", code: "6000" },
  { label: "금융투자", code: "4000" },
  { label: "보험", code: "2000" },
  { label: "은행", code: "1000" },
];

// ─── Helpers ───

function todayKST(): string {
  return formatYmd(new Date(Date.now() + 9 * 60 * 60 * 1000));
}

function formatYmd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function parseYmd(ymd: string): Date {
  return new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)));
}

function shiftDate(ymd: string, days: number): string {
  const d = parseYmd(ymd);
  d.setDate(d.getDate() + days);
  return formatYmd(d);
}

function isWeekend(ymd: string): boolean {
  const dow = parseYmd(ymd).getDay();
  return dow === 0 || dow === 6;
}

/** Generate all YYYYMMDD strings from start to end inclusive */
function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  let cur = start;
  while (cur <= end) {
    dates.push(cur);
    cur = shiftDate(cur, 1);
  }
  return dates;
}

function pn(val: string | undefined): number {
  if (!val || val === "-" || val === "") return 0;
  return Number(val.replace(/,/g, "").trim()) || 0;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current.trim()); current = ""; }
      else { current += ch; }
    }
  }
  result.push(current.trim());
  return result;
}

function parseArgs(): { mode: string; date?: string } {
  let mode = "incremental";
  let date: string | undefined;
  for (const arg of Deno.args) {
    if (arg.startsWith("--mode=")) mode = arg.slice(7);
    else if (arg.startsWith("--date=")) date = arg.slice(7);
    else if (/^\d{8}$/.test(arg)) date = arg; // legacy positional
  }
  return { mode, date };
}

// ─── KRX OTP/CSV Fetch ───

interface InvestorRow {
  trade_date: string;
  market: string;
  investor_code: string;
  stock_code: string;
  stock_name: string;
  vol_sell: number;
  vol_buy: number;
  vol_net: number;
  val_sell: number;
  val_buy: number;
  val_net: number;
}

async function fetchKrxInvestorData(
  tradeDate: string,
  marketCode: string,
  investorCode: string,
): Promise<InvestorRow[]> {
  const otpParams = new URLSearchParams({
    locale: "ko_KR",
    mktId: marketCode,
    invstTpCd: investorCode,
    strtDd: tradeDate,
    endDd: tradeDate,
    share: "1",
    money: "1",
    csvxls_is498: "false",
    name: "fileDown",
    url: "dbms/MDC/STAT/standard/MDCSTAT02401",
  });

  const otpResp = await fetch(KRX_OTP_URL, {
    method: "POST",
    headers: {
      "User-Agent": KRX_UA,
      Referer: KRX_REFERER,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: otpParams.toString(),
  });

  if (!otpResp.ok) throw new Error(`OTP_HTTP_${otpResp.status}`);

  const otp = await otpResp.text();
  if (!otp || otp.length < 10 || otp === "LOGOUT") throw new Error("OTP_FAILED");

  const csvResp = await fetch(KRX_CSV_URL, {
    method: "POST",
    headers: {
      "User-Agent": KRX_UA,
      Referer: KRX_REFERER,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: new URLSearchParams({ code: otp }).toString(),
  });

  if (!csvResp.ok) throw new Error(`CSV_HTTP_${csvResp.status}`);

  const rawBytes = new Uint8Array(await csvResp.arrayBuffer());
  let csvText: string;
  try {
    csvText = new TextDecoder("euc-kr").decode(rawBytes);
  } catch {
    csvText = new TextDecoder("utf-8").decode(rawBytes);
  }

  if (csvText.includes("LOGOUT") || csvText.length < 20) throw new Error("SESSION_ERROR");

  const lines = csvText.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error("EMPTY_DATA");

  const header = parseCSVLine(lines[0]);
  const colMap: Record<string, number> = {};
  header.forEach((h, i) => { colMap[h.trim()] = i; });

  const isuCdIdx = colMap["종목코드"] ?? 0;
  const isuNmIdx = colMap["종목명"] ?? 1;
  const askVolIdx = colMap["매도거래량"] ?? 2;
  const bidVolIdx = colMap["매수거래량"] ?? 3;
  const netVolIdx = colMap["순매수거래량"] ?? 4;
  const askValIdx = colMap["매도거래대금"] ?? 5;
  const bidValIdx = colMap["매수거래대금"] ?? 6;
  const netValIdx = colMap["순매수거래대금"] ?? 7;

  const rows: InvestorRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 4) continue;
    rows.push({
      trade_date: tradeDate,
      market: marketCode,
      investor_code: investorCode,
      stock_code: (cols[isuCdIdx] || "").padStart(6, "0"),
      stock_name: cols[isuNmIdx] || "",
      vol_sell: pn(cols[askVolIdx]),
      vol_buy: pn(cols[bidVolIdx]),
      vol_net: pn(cols[netVolIdx]),
      val_sell: pn(cols[askValIdx]),
      val_buy: pn(cols[bidValIdx]),
      val_net: pn(cols[netValIdx]),
    });
  }

  return rows;
}

// ─── Supabase helpers ───

async function upsertToSupabase(rows: InvestorRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const CHUNK = 500;
  let total = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/investor_snapshots`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(chunk),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Supabase upsert failed [${resp.status}]: ${text.slice(0, 300)}`);
    }
    await resp.text();
    total += chunk.length;
  }
  return total;
}

async function updateSyncStatus(
  syncKey: string,
  success: boolean,
  rowCount: number,
  error?: string,
) {
  const now = new Date().toISOString();
  const body: Record<string, unknown> = {
    sync_key: syncKey,
    last_attempt_at: now,
    row_count: rowCount,
  };
  if (success) {
    body.last_success_at = now;
    body.last_error = null;
  } else {
    body.last_error = error || "unknown";
  }

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/investor_sync_status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    console.error(`Failed to update sync status: ${await resp.text()}`);
  } else {
    await resp.text();
  }
}

async function getMaxTradeDate(): Promise<string | null> {
  const url = `${SUPABASE_URL}/rest/v1/investor_snapshots?select=trade_date&order=trade_date.desc&limit=1`;
  const resp = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!resp.ok) return null;
  const rows = await resp.json();
  return rows?.[0]?.trade_date ?? null;
}

// ─── Main ───

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    Deno.exit(1);
  }

  const { mode, date } = parseArgs();
  const today = todayKST();

  let datesToProcess: string[] = [];

  if (mode === "single") {
    datesToProcess = [date || today];
    console.log(`[collector] Mode: single, date: ${datesToProcess[0]}`);
  } else if (mode === "backfill") {
    const oneYearAgo = shiftDate(today, -365);
    datesToProcess = dateRange(oneYearAgo, today);
    console.log(`[collector] Mode: backfill, range: ${oneYearAgo} ~ ${today} (${datesToProcess.length} days)`);
  } else {
    // incremental
    const maxDate = await getMaxTradeDate();
    if (maxDate) {
      const nextDate = shiftDate(maxDate, 1);
      if (nextDate > today) {
        console.log(`[collector] Mode: incremental, DB is up-to-date (max: ${maxDate})`);
        datesToProcess = [];
      } else {
        datesToProcess = dateRange(nextDate, today);
        console.log(`[collector] Mode: incremental, range: ${nextDate} ~ ${today} (${datesToProcess.length} days)`);
      }
    } else {
      // No data at all — default to last 30 days
      const start = shiftDate(today, -30);
      datesToProcess = dateRange(start, today);
      console.log(`[collector] Mode: incremental (no existing data), range: ${start} ~ ${today}`);
    }
  }

  // Filter out weekends
  datesToProcess = datesToProcess.filter((d) => !isWeekend(d));
  console.log(`[collector] ${datesToProcess.length} weekday(s) to process`);

  if (datesToProcess.length === 0) {
    console.log("[collector] Nothing to do.");
    return;
  }

  const summary = {
    processed_dates: 0,
    success_dates: 0,
    skipped_dates: 0,
    failed_dates: 0,
    total_rows: 0,
  };

  for (const tradeDate of datesToProcess) {
    summary.processed_dates++;
    let dateRows = 0;
    let dateHasError = false;
    let dateEmpty = true;
    const dateErrors: string[] = [];

    for (const market of MARKETS) {
      for (const investor of INVESTORS) {
        const label = `${tradeDate} ${market.label}/${investor.label}`;
        try {
          console.log(`[collector] Fetching ${label}...`);
          const rows = await fetchKrxInvestorData(tradeDate, market.code, investor.code);
          if (rows.length > 0) {
            dateEmpty = false;
            const upserted = await upsertToSupabase(rows);
            dateRows += upserted;
            console.log(`[collector]   -> ${upserted} rows`);
          } else {
            console.log(`[collector]   -> 0 rows (empty)`);
          }
        } catch (e) {
          const msg = (e as Error).message;
          if (msg === "EMPTY_DATA") {
            console.log(`[collector]   -> EMPTY_DATA (skip)`);
          } else {
            console.error(`[collector]   -> ERROR: ${msg}`);
            dateErrors.push(`${label}: ${msg}`);
            dateHasError = true;
          }
        }
        // Rate limit
        await new Promise((r) => setTimeout(r, 800));
      }
    }

    if (dateHasError) {
      summary.failed_dates++;
    } else if (dateEmpty) {
      summary.skipped_dates++;
    } else {
      summary.success_dates++;
    }
    summary.total_rows += dateRows;

    // Sync status per date
    await updateSyncStatus(
      `investor_daily_${tradeDate}`,
      !dateHasError && !dateEmpty,
      dateRows,
      dateHasError ? dateErrors.join("; ") : dateEmpty ? "EMPTY_DATA" : undefined,
    );
  }

  console.log(`\n[collector] ========== Summary ==========`);
  console.log(`  processed_dates : ${summary.processed_dates}`);
  console.log(`  success_dates   : ${summary.success_dates}`);
  console.log(`  skipped_dates   : ${summary.skipped_dates} (weekends/holidays)`);
  console.log(`  failed_dates    : ${summary.failed_dates}`);
  console.log(`  total_rows      : ${summary.total_rows}`);

  if (summary.failed_dates > 0) {
    Deno.exit(1);
  }
}

main();

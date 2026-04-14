import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const KRX_DATA_URL = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";
const KRX_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── KRX fetch (only called when feature is enabled) ──
async function krxFetchWithSession(params: Record<string, string>): Promise<Record<string, unknown>> {
  const commonHeaders = {
    "User-Agent": KRX_UA,
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC02020301",
    "Origin": "https://data.krx.co.kr",
    "Content-Type": "application/x-www-form-urlencoded",
    "X-Requested-With": "XMLHttpRequest",
  };

  const pageResp = await fetch(
    "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC02020301",
    { method: "GET", headers: { "User-Agent": KRX_UA, "Accept": "text/html" } }
  );
  await pageResp.text();
  const setCookie = pageResp.headers.get("set-cookie") || "";
  const cookieMatch = setCookie.match(/JSESSIONID=([^;]+)/);
  const cookie = cookieMatch ? `JSESSIONID=${cookieMatch[1]}` : "";

  const body = new URLSearchParams(params);
  const dataResp = await fetch(KRX_DATA_URL, {
    method: "POST",
    headers: { ...commonHeaders, ...(cookie ? { "Cookie": cookie } : {}) },
    body: body.toString(),
  });

  const text = await dataResp.text();
  if (text.includes("LOGOUT") || text.includes("접근이 거부")) {
    throw new Error("KRX_LOGOUT");
  }
  return JSON.parse(text);
}

// ── Cache ──
interface CacheEntry { data: unknown; ts: number; ttl: number }
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

const TTL_DEFAULT = 24 * 60 * 60 * 1000;
const TTL_RECENT = 6 * 60 * 60 * 1000;

function isRecentDate(endDate: string): boolean {
  const today = new Date();
  const todayStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  return endDate >= todayStr;
}

function getCached(key: string): { data: unknown; ts: number } | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < entry.ttl) {
    return { data: entry.data, ts: entry.ts };
  }
  // Return stale data if it exists (for fallback)
  if (entry) return { data: entry.data, ts: entry.ts };
  return null;
}

function setCache(key: string, data: unknown, ttl: number) {
  cache.set(key, { data, ts: Date.now(), ttl });
  if (cache.size > 200) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.ts > v.ttl * 2) cache.delete(k); // keep stale entries longer for fallback
    }
  }
}

function isCacheFresh(key: string): boolean {
  const entry = cache.get(key);
  return !!entry && Date.now() - entry.ts < entry.ttl;
}

// ── Mappings ──
const INVESTOR_MAP: Record<string, string> = {
  "금융투자": "1000", "보험": "2000", "투신": "3000", "사모": "3100",
  "은행": "4000", "기타금융": "5000", "연기금": "6000", "기관합계": "7050",
  "기타법인": "7100", "개인": "8000", "외국인": "9000", "기타외국인": "9001", "전체": "9999",
};

const MARKET_MAP: Record<string, string> = {
  "ALL": "ALL", "KOSPI": "STK", "KOSDAQ": "KSQ", "KONEX": "KNX",
};

interface InvestorRow {
  isuCd: string; isuNm: string;
  volSell: number; volBuy: number; volNet: number;
  valSell: number; valBuy: number; valNet: number;
}

const EMPTY_DATA_MESSAGE = "현재 KRX 투자자별 데이터 응답이 비어 있습니다. 잠시 후 다시 시도해주세요.";

function pn(val: string | undefined): number {
  if (!val || val === "-" || val === "") return 0;
  return Number(val.replace(/,/g, "").trim()) || 0;
}

async function fetchInvestorData(startDate: string, endDate: string, mktId: string, invstTpCd: string): Promise<InvestorRow[]> {
  const params: Record<string, string> = {
    bld: "dbms/MDC/STAT/standard/MDCSTAT02401",
    strtDd: startDate, endDd: endDate, mktId, invstTpCd,
  };
  const json = await krxFetchWithSession(params);
  const output = (json?.output as Record<string, string>[]) ?? [];
  if (output.length === 0) {
    throw new Error("EMPTY_DATA");
  }
  return output.map((row) => ({
    isuCd: (row.ISU_SRT_CD || "").padStart(6, "0"),
    isuNm: row.ISU_NM || "",
    volSell: pn(row.ASK_TRDVOL), volBuy: pn(row.BID_TRDVOL), volNet: pn(row.NETBID_TRDVOL),
    valSell: pn(row.ASK_TRDVAL), valBuy: pn(row.BID_TRDVAL), valNet: pn(row.NETBID_TRDVAL),
  }));
}

// ── CSV ──
function toCSV(rows: InvestorRow[], meta: Record<string, string>): string {
  const BOM = "\uFEFF";
  const header = "종목코드,종목명,거래량_매도,거래량_매수,거래량_순매수,거래대금_매도,거래대금_매수,거래대금_순매수,시장구분,투자자구분,조회시작일,조회종료일,생성시각";
  const now = new Date().toISOString();
  const body = rows.map(r => [
    r.isuCd, `"${r.isuNm}"`, r.volSell, r.volBuy, r.volNet,
    r.valSell, r.valBuy, r.valNet,
    meta.market, meta.investor, meta.startDate, meta.endDate, now,
  ].join(",")).join("\n");
  return BOM + header + "\n" + body;
}

// ── Standard response helpers ──
function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fallbackResponse(cachedEntry: { data: unknown; ts: number } | null, topN: number, message = EMPTY_DATA_MESSAGE) {
  if (cachedEntry) {
    const rows = (cachedEntry.data as InvestorRow[]).slice(0, topN);
    return jsonResp({
      ok: true,
      items: rows,
      totalRows: (cachedEntry.data as InvestorRow[]).length,
      generatedAt: cachedEntry.ts,
      stale: true,
      note: "최신 갱신 실패로 마지막 성공 데이터를 표시합니다.",
    });
  }
  return jsonResp({
    ok: false,
    errorCode: "UPSTREAM_UNAVAILABLE",
    message,
  });
}

// ── Main handler ──
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const market = url.searchParams.get("market") || "ALL";
    const investor = url.searchParams.get("investor") || "전체";
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const topN = parseInt(url.searchParams.get("topN") || "50", 10);
    const mode = url.searchParams.get("mode") || "json";

    if (!startDate || !endDate) {
      return jsonResp({ ok: false, errorCode: "BAD_REQUEST", message: "startDate and endDate are required (YYYYMMDD)" }, 400);
    }

    if (startDate > endDate) {
      return jsonResp({ ok: false, errorCode: "BAD_REQUEST", message: "startDate must be less than or equal to endDate" }, 400);
    }

    const mktId = MARKET_MAP[market] || "ALL";
    const invstTpCd = INVESTOR_MAP[investor] || "9999";
    const cacheKey = `invTopEq:${mktId}:${invstTpCd}:${startDate}:${endDate}`;

    // Direct KRX fetch with cache fallback
    let rows: InvestorRow[];
    let stale = false;
    let generatedAt = Date.now();

    const cachedEntry = getCached(cacheKey);

    if (cachedEntry && isCacheFresh(cacheKey)) {
      rows = cachedEntry.data as InvestorRow[];
      generatedAt = cachedEntry.ts;
    } else {
      try {
        if (inflight.has(cacheKey)) {
          rows = (await inflight.get(cacheKey)!) as InvestorRow[];
        } else {
          const promise = fetchInvestorData(startDate, endDate, mktId, invstTpCd);
          inflight.set(cacheKey, promise);
          try {
            rows = await promise;
            const ttl = isRecentDate(endDate) ? TTL_RECENT : TTL_DEFAULT;
            setCache(cacheKey, rows, ttl);
            generatedAt = Date.now();
          } finally {
            inflight.delete(cacheKey);
          }
        }
      } catch (fetchErr) {
        console.error("KRX fetch failed, falling back to cache:", (fetchErr as Error).message);
        if (cachedEntry) {
          rows = cachedEntry.data as InvestorRow[];
          generatedAt = cachedEntry.ts;
          stale = true;
        } else {
          const message = (fetchErr as Error).message === "EMPTY_DATA"
            ? EMPTY_DATA_MESSAGE
            : "현재 데이터 소스 점검 중입니다. 잠시 후 다시 시도해주세요.";
          return fallbackResponse(null, topN, message);
        }
      }
    }

    const limitedRows = rows.slice(0, topN);

    if (mode === "csv") {
      const csv = toCSV(limitedRows, { market, investor, startDate, endDate });
      return new Response(csv, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="investor_top_equities.csv"`,
        },
      });
    }

    return jsonResp({
      ok: true,
      items: limitedRows,
      totalRows: rows.length,
      generatedAt,
      stale,
      ...(stale ? { note: "최신 갱신 실패로 마지막 성공 데이터를 표시합니다." } : {}),
    });

  } catch (error: unknown) {
    // NEVER return 500 – always a parseable JSON response
    console.error("Investor proxy unexpected error:", (error as Error).message);
    return jsonResp({
      ok: false,
      errorCode: "INTERNAL_ERROR",
      message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
    });
  }
});

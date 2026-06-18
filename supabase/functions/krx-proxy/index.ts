import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const KRX_BASE = "https://data-dbg.krx.co.kr/svc/apis";

// --- Cache with variable TTL ---
interface CacheEntry { data: unknown; ts: number; ttl: number }
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

const TTL_LIVE = 60 * 1000;             // 1m for current market day
const TTL_DAILY = 24 * 60 * 60 * 1000;    // 24h for daily trade/index
const TTL_BASE = 72 * 60 * 60 * 1000;     // 72h for base info

function getKstTodayYmd() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date()).replaceAll("-", "");
}

function getTTL(endpoint: string, basDd?: string): number {
  if (endpoint.includes("_base_info")) return TTL_BASE;
  if (basDd && basDd === getKstTodayYmd()) return TTL_LIVE;
  return TTL_DAILY;
}

function getRangeTTL(startDate: string, endDate: string) {
  return endDate >= getKstTodayYmd() ? TTL_LIVE : TTL_DAILY;
}

function getCached(key: string): { data: unknown; status: "HIT" | "MISS" } {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < entry.ttl) {
    return { data: entry.data, status: "HIT" };
  }
  return { data: null, status: "MISS" };
}

function setCache(key: string, data: unknown, ttl: number) {
  cache.set(key, { data, ts: Date.now(), ttl });
  // Evict old entries if too many
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.ts > v.ttl) cache.delete(k);
    }
  }
}

// Single-flight fetch from KRX
async function fetchFromKrx(endpoint: string, basDd: string, apiKey: string): Promise<unknown> {
  const cacheKey = `krx:${endpoint}:${basDd}`;
  
  const cached = getCached(cacheKey);
  if (cached.status === "HIT") return cached.data;

  // Single-flight: reuse in-progress request
  if (inflight.has(cacheKey)) {
    return inflight.get(cacheKey)!;
  }

  const promise = (async () => {
    try {
      const krxUrl = `${KRX_BASE}/${endpoint}?basDd=${basDd}&AUTH_KEY=${apiKey}`;
      const response = await fetch(krxUrl);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`KRX API error [${response.status}]: ${text}`);
      }
      const data = await response.json();
      setCache(cacheKey, data, getTTL(endpoint, basDd));
      return data;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, promise);
  return promise;
}

// Generate date strings between start and end (inclusive)
function getDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = parseYMD(startDate);
  const end = parseYMD(endDate);
  const d = new Date(start);
  while (d <= end) {
    // Skip weekends
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      dates.push(formatYMD(d));
    }
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function parseYMD(s: string): Date {
  return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
}

function formatYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function pn(val: string | undefined): number {
  if (!val || val === "-" || val === "") return 0;
  return Number(val.replace(/,/g, "").trim()) || 0;
}

// Compute aggregation for stock-like data
function computeAggregation(dailyByIsu: Map<string, Record<string, string>[]>): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  
  for (const [isuCd, days] of dailyByIsu) {
    if (days.length === 0) continue;
    const sorted = [...days].sort((a, b) => (a.BAS_DD || "").localeCompare(b.BAS_DD || ""));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    
    const startClose = pn(first.TDD_CLSPRC || first.CLSPRC_IDX);
    const endClose = pn(last.TDD_CLSPRC || last.CLSPRC_IDX);
    const periodChangeRate = startClose !== 0 ? ((endClose / startClose) - 1) * 100 : 0;
    
    let totalVol = 0, totalVal = 0;
    let highPrice = -Infinity, lowPrice = Infinity;
    const dailyReturns: number[] = [];
    
    for (let i = 0; i < sorted.length; i++) {
      const d = sorted[i];
      totalVol += pn(d.ACC_TRDVOL);
      totalVal += pn(d.ACC_TRDVAL);
      const hp = pn(d.TDD_HGPRC || d.HGPRC_IDX);
      const lp = pn(d.TDD_LWPRC || d.LWPRC_IDX);
      if (hp > highPrice) highPrice = hp;
      if (lp > 0 && lp < lowPrice) lowPrice = lp;
      
      if (i > 0) {
        const prevClose = pn(sorted[i - 1].TDD_CLSPRC || sorted[i - 1].CLSPRC_IDX);
        const curClose = pn(d.TDD_CLSPRC || d.CLSPRC_IDX);
        if (prevClose !== 0) dailyReturns.push((curClose / prevClose) - 1);
      }
    }
    
    // Volatility (std dev of daily returns)
    let volatility = 0;
    if (dailyReturns.length > 1) {
      const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
      const variance = dailyReturns.reduce((a, r) => a + (r - mean) ** 2, 0) / (dailyReturns.length - 1);
      volatility = Math.sqrt(variance) * 100;
    }
    
    results.push({
      ISU_CD: isuCd,
      ISU_NM: last.ISU_NM || last.IDX_NM || last.OIL_NM || "",
      MKT_NM: last.MKT_NM || "",
      SECUGRP_NM: last.SECUGRP_NM || "",
      startDate: first.BAS_DD,
      endDate: last.BAS_DD,
      startClose,
      endClose,
      periodChangeRate: Math.round(periodChangeRate * 100) / 100,
      periodHigh: highPrice === -Infinity ? 0 : highPrice,
      periodLow: lowPrice === Infinity ? 0 : lowPrice,
      totalVolume: totalVol,
      totalValue: totalVal,
      avgVolume: sorted.length > 0 ? Math.round(totalVol / sorted.length) : 0,
      avgValue: sorted.length > 0 ? Math.round(totalVal / sorted.length) : 0,
      volatility: Math.round(volatility * 100) / 100,
      tradingDays: sorted.length,
      MKTCAP: last.MKTCAP || "",
    });
  }
  
  return results;
}

// Generate CSV string
function toCSV(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return "";
  const cols = columns || Object.keys(rows[0]);
  const BOM = "\uFEFF";
  const header = cols.join(",");
  const body = rows.map(r =>
    cols.map(c => {
      const v = r[c];
      const s = v === null || v === undefined ? "" : String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    }).join(",")
  ).join("\n");
  return BOM + header + "\n" + body;
}

// Standard CSV columns for stocks
const STOCK_CSV_COLS = ["date", "market", "isu_cd", "isu_nm", "close", "change", "change_rate", "volume", "value", "mktcap", "secugrp_nm"];
const SUMMARY_CSV_COLS = ["isu_cd", "isu_nm", "market", "start_date", "end_date", "start_close", "end_close", "period_change_rate", "period_high", "period_low", "total_volume", "total_value", "avg_volume", "avg_value", "volatility", "trading_days"];

function stockToStandardRow(d: Record<string, string>): Record<string, string> {
  return {
    date: d.BAS_DD || "",
    market: d.MKT_NM || "",
    isu_cd: d.ISU_CD || "",
    isu_nm: d.ISU_NM || "",
    close: d.TDD_CLSPRC || d.CLSPRC_IDX || "",
    change: d.CMPPREVDD_PRC || d.CMPPREVDD_IDX || "",
    change_rate: d.FLUC_RT || "",
    volume: d.ACC_TRDVOL || "",
    value: d.ACC_TRDVAL || "",
    mktcap: d.MKTCAP || "",
    secugrp_nm: d.SECUGRP_NM || "",
  };
}

function summaryToStandardRow(d: Record<string, unknown>): Record<string, string> {
  return {
    isu_cd: String(d.ISU_CD || ""),
    isu_nm: String(d.ISU_NM || ""),
    market: String(d.MKT_NM || ""),
    start_date: String(d.startDate || ""),
    end_date: String(d.endDate || ""),
    start_close: String(d.startClose || ""),
    end_close: String(d.endClose || ""),
    period_change_rate: String(d.periodChangeRate || ""),
    period_high: String(d.periodHigh || ""),
    period_low: String(d.periodLow || ""),
    total_volume: String(d.totalVolume || ""),
    total_value: String(d.totalValue || ""),
    avg_volume: String(d.avgVolume || ""),
    avg_value: String(d.avgValue || ""),
    volatility: String(d.volatility || ""),
    trading_days: String(d.tradingDays || ""),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const KRX_API_KEY = Deno.env.get("KRX_API_KEY");
    if (!KRX_API_KEY) throw new Error("KRX_API_KEY is not configured");

    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") || "single"; // single | range | csv
    const endpoint = url.searchParams.get("endpoint");
    const basDd = url.searchParams.get("basDd");
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const csvType = url.searchParams.get("csvType") || "raw"; // raw | summary

    // === SINGLE DATE MODE (existing behavior, enhanced) ===
    if (mode === "single") {
      if (!endpoint || !basDd) {
        return new Response(
          JSON.stringify({ error: "Missing endpoint or basDd parameter" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const cacheKey = `krx:${endpoint}:${basDd}`;
      const cached = getCached(cacheKey);
      if (cached.status === "HIT") {
        return new Response(JSON.stringify(cached.data), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "X-Cache": "HIT",
            "X-Cache-Key": cacheKey,
          },
        });
      }

      const data = await fetchFromKrx(endpoint, basDd, KRX_API_KEY);
      return new Response(JSON.stringify(data), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "X-Cache": "MISS",
          "X-Cache-Key": cacheKey,
        },
      });
    }

    // === RANGE MODE ===
    if (mode === "range" || mode === "csv") {
      if (!endpoint || !startDate || !endDate) {
        return new Response(
          JSON.stringify({ error: "Missing endpoint, startDate or endDate" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check aggregation cache
      const aggCacheKey = `krx:agg:${endpoint}:${startDate}:${endDate}`;
      const aggCached = getCached(aggCacheKey);

      let allDaily: Record<string, string>[] = [];
      let aggregation: Record<string, unknown>[] = [];
      let cacheStatus = "HIT";

      if (aggCached.status === "HIT") {
        const c = aggCached.data as { daily: Record<string, string>[]; aggregation: Record<string, unknown>[] };
        allDaily = c.daily;
        aggregation = c.aggregation;
      } else {
        cacheStatus = "MISS";
        const dates = getDateRange(startDate, endDate);
        
        // Limit to 60 business days max to prevent abuse
        const datesToFetch = dates.slice(0, 60);

        // Parallel fetch with concurrency limit of 8
        const CONCURRENCY = 8;
        for (let i = 0; i < datesToFetch.length; i += CONCURRENCY) {
          const batch = datesToFetch.slice(i, i + CONCURRENCY);
          const results = await Promise.allSettled(
            batch.map(d => fetchFromKrx(endpoint, d, KRX_API_KEY))
          );
          for (const r of results) {
            if (r.status === "fulfilled") {
              const res = r.value as Record<string, unknown>;
              const items = (res?.OutBlock_1 ?? []) as Record<string, string>[];
              allDaily.push(...items);
            }
          }
        }

        // Compute aggregation
        const byIsu = new Map<string, Record<string, string>[]>();
        for (const d of allDaily) {
          const key = d.ISU_CD || d.IDX_NM || d.OIL_NM || "default";
          if (!byIsu.has(key)) byIsu.set(key, []);
          byIsu.get(key)!.push(d);
        }
        aggregation = computeAggregation(byIsu);

        // Cache the result
        setCache(aggCacheKey, { daily: allDaily, aggregation }, getRangeTTL(startDate, endDate));
      }

      // CSV mode
      if (mode === "csv") {
        let csvContent: string;
        let filename: string;
        
        if (csvType === "summary") {
          csvContent = toCSV(aggregation.map(summaryToStandardRow), SUMMARY_CSV_COLS);
          filename = `${endpoint.replace(/\//g, "_")}_${startDate}_${endDate}_summary.csv`;
        } else {
          csvContent = toCSV(allDaily.map(stockToStandardRow), STOCK_CSV_COLS);
          filename = `${endpoint.replace(/\//g, "_")}_${startDate}_${endDate}_raw.csv`;
        }

        return new Response(csvContent, {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "X-Cache": cacheStatus,
          },
        });
      }

      // Range JSON response
      return new Response(
        JSON.stringify({
          daily: allDaily,
          aggregation,
          meta: { startDate, endDate, tradingDays: new Set(allDaily.map(d => d.BAS_DD)).size, totalRecords: allDaily.length },
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "X-Cache": cacheStatus,
            "X-Cache-Key": aggCacheKey,
          },
        }
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown mode: ${mode}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("KRX proxy error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

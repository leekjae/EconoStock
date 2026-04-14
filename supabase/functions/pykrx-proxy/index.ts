import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// KRX internal API (same as pykrx's Post class)
const KRX_URL = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";
const KRX_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const KRX_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  "User-Agent": KRX_UA,
  "Accept": "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "Referer": "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201010101",
  "Origin": "https://data.krx.co.kr",
  "X-Requested-With": "XMLHttpRequest",
};

// Cache
interface CacheEntry { data: unknown; ts: number }
const cache = new Map<string, CacheEntry>();
const TTL = 24 * 60 * 60 * 1000;

function getCached(key: string): unknown | null {
  const e = cache.get(key);
  if (e && Date.now() - e.ts < TTL) return e.data;
  return null;
}

function setCache(key: string, data: unknown) {
  cache.set(key, { data, ts: Date.now() });
  if (cache.size > 300) {
    for (const [k, v] of cache) {
      if (Date.now() - v.ts > TTL) cache.delete(k);
    }
  }
}

function formatYmd(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function latestCandidateDates(maxDays = 10): string[] {
  return Array.from({ length: maxDays }, (_, idx) => {
    const d = new Date();
    d.setDate(d.getDate() - idx);
    return formatYmd(d);
  });
}

// POST to KRX internal API (same as pykrx's Post.read)
async function krxPost(params: Record<string, string>): Promise<Record<string, unknown> | null> {
  const body = new URLSearchParams(params).toString();
  try {
    const pageResp = await fetch(
      "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201010101",
      { method: "GET", headers: { "User-Agent": KRX_UA, "Accept": "text/html" } }
    );
    await pageResp.text();
    const setCookie = pageResp.headers.get("set-cookie") || "";
    const cookieMatch = setCookie.match(/JSESSIONID=([^;]+)/);
    const cookie = cookieMatch ? `JSESSIONID=${cookieMatch[1]}` : "";

    const resp = await fetch(KRX_URL, {
      method: "POST",
      headers: { ...KRX_HEADERS, ...(cookie ? { Cookie: cookie } : {}) },
      body,
    });
    if (!resp.ok) {
      console.error(`KRX POST error: ${resp.status}`);
      return null;
    }
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch {
      console.error(`KRX non-JSON response: ${text.substring(0, 200)}`);
      return null;
    }
  } catch (e) {
    console.error("KRX fetch error:", e);
    return null;
  }
}

// pykrx: 주가지수검색 (bld=dbms/comm/finder/finder_equidx)
// Returns index list with full_code (group_id) and short_code (ticker)
interface IndexItem {
  indexTicker: string;   // full_code (e.g. "1018", "2001")
  indexName: string;     // codeName
  groupId: string;       // full_code (same, used for component lookup indIdx)
  shortCode: string;     // short_code (e.g. "018", "001") used for indIdx2
  marketName: string;
}

async function fetchIndexList(market: string): Promise<IndexItem[]> {
  // pykrx market mapping: 1=전체, 2=KRX, 3=KOSPI, 4=KOSDAQ, 5=테마
  const marketMap: Record<string, string> = {
    ALL: "1",
    KRX: "2",
    KOSPI: "3",
    KOSDAQ: "4",
    THEME: "5",
  };
  const mktsel = marketMap[market] || "1";

  const json = await krxPost({
    bld: "dbms/comm/finder/finder_equidx",
    mktsel,
  });

  if (!json || !json.block1) {
    console.error("No block1 in finder_equidx response");
    return [];
  }

  const items = json.block1 as Record<string, string>[];
  return items.map((item) => {
    const groupId = String(item.full_code || "");
    const shortCode = String(item.short_code || "");

    return {
      indexTicker: `${groupId}${shortCode}`,
      indexName: String(item.codeName || ""),
      groupId,
      shortCode,
      marketName: String(item.marketName || ""),
    };
  });
}

// pykrx: 지수구성종목 (bld=dbms/MDC/STAT/standard/MDCSTAT00601)
// params: indIdx2=ticker, indIdx=group_id, trdDd=date
async function fetchIndexComponents(
  ticker: string,
  groupId: string,
): Promise<{ stockTicker: string; stockName: string }[]> {
  for (const trdDd of latestCandidateDates()) {
    const json = await krxPost({
      bld: "dbms/MDC/STAT/standard/MDCSTAT00601",
      trdDd,
      indIdx2: ticker,
      indIdx: groupId,
    });

    if (!json) continue;

    const items = (json.output || []) as Record<string, string>[];
    if (items.length === 0) continue;

    return items.map((item) => ({
      stockTicker: item.ISU_SRT_CD || "",
      stockName: item.ISU_ABBRV || "",
    }));
  }

  return [];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (action === "list") {
      const market = url.searchParams.get("market") || "ALL";
      const q = (url.searchParams.get("q") || "").trim().toLowerCase();
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
      const pageSize = Math.min(200, Math.max(10, parseInt(url.searchParams.get("pageSize") || "50")));

      const cacheKey = `pykrx:indexes:${market}`;
      let allItems = getCached(cacheKey) as IndexItem[] | null;

      if (!allItems) {
        allItems = await fetchIndexList(market);
        if (allItems.length > 0) {
          setCache(cacheKey, allItems);
        }
      }

      let filtered = allItems;
      if (q) {
        filtered = allItems.filter(
          (item) =>
            item.indexName.toLowerCase().includes(q) ||
            item.indexTicker.toLowerCase().includes(q)
        );
      }

      filtered.sort((a, b) => a.indexName.localeCompare(b.indexName, "ko"));

      const total = filtered.length;
      const start = (page - 1) * pageSize;
      const paged = filtered.slice(start, start + pageSize);

      return new Response(
        JSON.stringify({
          items: paged,
          total,
          page,
          pageSize,
          generatedAt: new Date().toISOString(),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "components") {
      const ticker = url.searchParams.get("ticker");
      const groupId = url.searchParams.get("groupId");
      const indexName = url.searchParams.get("indexName") || "";
      if (!ticker || !groupId) {
        return new Response(
          JSON.stringify({ error: "Missing ticker or groupId parameter" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const cacheKey = `pykrx:components:${groupId}:${ticker}`;
      const cached = getCached(cacheKey);
      if (cached) {
        return new Response(
          JSON.stringify({
            indexTicker: ticker,
            indexName,
            components: cached,
            cacheStatus: "HIT",
            generatedAt: new Date().toISOString(),
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const components = await fetchIndexComponents(ticker, groupId);
      if (components.length > 0) {
        setCache(cacheKey, components);
      }

      return new Response(
        JSON.stringify({
          indexTicker: ticker,
          indexName,
          components,
          cacheStatus: "MISS",
          generatedAt: new Date().toISOString(),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action. Use action=list or action=components" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("pykrx-proxy error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

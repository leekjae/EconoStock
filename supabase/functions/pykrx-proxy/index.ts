import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const NAVER_BASE = "https://finance.naver.com";
const NAVER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Referer: `${NAVER_BASE}/`,
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
};
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const STATUS_KEY = "naver_theme";
let syncPromise: Promise<SyncResult> | null = null;

interface ThemeRow {
  theme_no: number;
  theme_name: string;
  detail_url: string;
  stock_count: number;
  page_no: number;
  scraped_at: string;
}

interface ThemeStockRow {
  theme_no: number;
  stock_code: string;
  stock_name: string;
  rank_no: number;
  scraped_at: string;
}

interface SyncStatusRow {
  sync_key: string;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  theme_count: number;
  stock_count: number;
}

interface ThemeSummary {
  themeNo: number;
  themeName: string;
  detailUrl: string;
  pageNo: number;
}

interface ThemeStock {
  stockCode: string;
  stockName: string;
  rankNo: number;
}

interface SyncResult {
  synced: boolean;
  status: SyncStatusRow | null;
}

interface ThemeProbeResult {
  page1Bytes: number;
  page1ThemeLinkCount: number;
  firstThemeUrl: string | null;
  firstThemeStockLinkCount: number | null;
  note: string;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function createAdminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

async function readHtml(url: string) {
  const response = await fetch(url, { headers: NAVER_HEADERS });
  if (!response.ok) throw new Error(`NAVER_HTML_${response.status}`);
  const buffer = await response.arrayBuffer();
  try {
    return new TextDecoder("euc-kr").decode(buffer);
  } catch {
    return new TextDecoder().decode(buffer);
  }
}

function decodeHtml(text: string) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function stripTags(text: string) {
  return decodeHtml(text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function extractThemeNo(href: string | null) {
  const match = href?.match(/no=(\d+)/);
  return match ? Number(match[1]) : null;
}

function extractStockCode(href: string | null) {
  const match = href?.match(/code=(\d{6})/);
  return match ? match[1] : null;
}

function countThemeLinks(html: string) {
  const regex = /<a[^>]+href\s*=\s*(['"])([^'"]*sise_group_detail\.naver\?[^'"]*no=\d+[^'"]*)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let count = 0;
  for (const _ of html.matchAll(regex)) count += 1;
  return count;
}

function countStockLinks(html: string) {
  const regex = /<a[^>]+href\s*=\s*(['"])([^'"]*item\/main(?:\.naver)?\?code=\d{6}[^'"]*)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let count = 0;
  for (const _ of html.matchAll(regex)) count += 1;
  return count;
}

async function fetchThemePage(page: number): Promise<ThemeSummary[]> {
  const html = await readHtml(`${NAVER_BASE}/sise/theme.naver?page=${page}`);
  const themes: ThemeSummary[] = [];
  const seen = new Set<number>();

  const regex =
    /<a[^>]+href\s*=\s*(['"])([^'"]*sise_group_detail\.naver\?type=theme(?:&|&amp;)no=\d+[^'"]*)\1[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(regex)) {
    const href = decodeHtml(match[2]);
    const themeNo = extractThemeNo(href);
    const themeName = stripTags(match[3]);
    if (!themeNo || !themeName || seen.has(themeNo)) continue;
    seen.add(themeNo);
    themes.push({
      themeNo,
      themeName,
      detailUrl: `${NAVER_BASE}${href.startsWith("/") ? href : `/${href}`}`,
      pageNo: page,
    });
  }

  return themes;
}

async function fetchAllThemes() {
  const results: ThemeSummary[] = [];
  const seen = new Set<number>();

  for (let page = 1; page <= 20; page += 1) {
    const items = await fetchThemePage(page);
    if (items.length === 0) break;
    for (const item of items) {
      if (seen.has(item.themeNo)) continue;
      seen.add(item.themeNo);
      results.push(item);
    }
  }

  return results.sort((a, b) => a.themeName.localeCompare(b.themeName, "ko"));
}

async function runProbe(): Promise<ThemeProbeResult> {
  const html = await readHtml(`${NAVER_BASE}/sise/theme.naver?page=1`);
  const page1ThemeLinkCount = countThemeLinks(html);
  const firstPageThemes = await fetchThemePage(1);
  const firstTheme = firstPageThemes[0];

  let firstThemeStockLinkCount: number | null = null;
  if (firstTheme?.detailUrl) {
    const detailHtml = await readHtml(firstTheme.detailUrl);
    firstThemeStockLinkCount = countStockLinks(detailHtml);
  }

  return {
    page1Bytes: html.length,
    page1ThemeLinkCount,
    firstThemeUrl: firstTheme?.detailUrl ?? null,
    firstThemeStockLinkCount,
    note: "If page1ThemeLinkCount is 0, Naver markup changed or bot-block page is being served in this runtime.",
  };
}

async function fetchThemeStocks(theme: ThemeSummary): Promise<ThemeStock[]> {
  const html = await readHtml(theme.detailUrl);
  const stocks: ThemeStock[] = [];
  const seen = new Set<string>();

  const regex = /<a[^>]+href\s*=\s*(['"])([^'"]*item\/main(?:\.naver)?\?code=\d{6}[^'"]*)\1[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(regex)) {
    const href = decodeHtml(match[2]);
    const stockCode = extractStockCode(href);
    const stockName = stripTags(match[3]);
    if (!stockCode || !stockName || seen.has(stockCode)) continue;
    seen.add(stockCode);
    stocks.push({ stockCode, stockName, rankNo: stocks.length + 1 });
  }

  return stocks;
}

async function fetchThemeStocksInBatches(themes: ThemeSummary[]) {
  const results: { theme: ThemeSummary; stocks: ThemeStock[] }[] = [];
  const concurrency = 4;

  for (let index = 0; index < themes.length; index += concurrency) {
    const slice = themes.slice(index, index + concurrency);
    const batch = await Promise.all(slice.map(async (theme) => ({ theme, stocks: await fetchThemeStocks(theme) })));
    results.push(...batch);
  }

  return results;
}

async function writeSyncStatus(supabase: ReturnType<typeof createAdminClient>, patch: Partial<SyncStatusRow>) {
  const { error } = await supabase.from("naver_theme_sync_status").upsert({
    sync_key: STATUS_KEY,
    ...patch,
  });
  if (error) throw error;
}

async function getSyncStatus(supabase: ReturnType<typeof createAdminClient>) {
  const { data, error } = await supabase
    .from("naver_theme_sync_status")
    .select("sync_key,last_attempt_at,last_success_at,last_error,theme_count,stock_count")
    .eq("sync_key", STATUS_KEY)
    .maybeSingle();

  if (error) throw error;
  return data as SyncStatusRow | null;
}

function isFresh(status: SyncStatusRow | null) {
  if (!status?.last_success_at) return false;
  return Date.now() - new Date(status.last_success_at).getTime() < WEEK_MS;
}

async function replaceThemeSnapshot(supabase: ReturnType<typeof createAdminClient>) {
  const now = new Date().toISOString();
  const themes = await fetchAllThemes();
  const themeStocks = await fetchThemeStocksInBatches(themes);
  const totalStocks = themeStocks.reduce((sum, item) => sum + item.stocks.length, 0);

  if (themes.length < 10 || totalStocks < 50) {
    throw new Error(`THEME_SCRAPE_RESULT_TOO_SMALL: themes=${themes.length}, stocks=${totalStocks}`);
  }

  const themeRows: ThemeRow[] = themeStocks.map(({ theme, stocks }) => ({
    theme_no: theme.themeNo,
    theme_name: theme.themeName,
    detail_url: theme.detailUrl,
    stock_count: stocks.length,
    page_no: theme.pageNo,
    scraped_at: now,
  }));

  const stockRows: ThemeStockRow[] = themeStocks.flatMap(({ theme, stocks }) =>
    stocks.map((stock) => ({
      theme_no: theme.themeNo,
      stock_code: stock.stockCode,
      stock_name: stock.stockName,
      rank_no: stock.rankNo,
      scraped_at: now,
    })),
  );

  const themeNos = themeRows.map((row) => row.theme_no);
  const inClause = `(${themeNos.join(",")})`;
  const { error: upsertThemesError } = await supabase.from("naver_themes").upsert(themeRows);
  if (upsertThemesError) throw upsertThemesError;

  const { error: deleteStocksError } = await supabase.from("naver_theme_stocks").delete().in("theme_no", themeNos);
  if (deleteStocksError) throw deleteStocksError;

  const { error: insertStocksError } = await supabase.from("naver_theme_stocks").insert(stockRows);
  if (insertStocksError) throw insertStocksError;

  const { error: deleteOrphanStocksError } = await supabase
    .from("naver_theme_stocks")
    .delete()
    .not("theme_no", "in", inClause);
  if (deleteOrphanStocksError) throw deleteOrphanStocksError;

  const { error: deleteOrphanThemesError } = await supabase
    .from("naver_themes")
    .delete()
    .not("theme_no", "in", inClause);
  if (deleteOrphanThemesError) throw deleteOrphanThemesError;

  await writeSyncStatus(supabase, {
    sync_key: STATUS_KEY,
    last_success_at: now,
    last_attempt_at: now,
    last_error: null,
    theme_count: themeRows.length,
    stock_count: stockRows.length,
  });

  return {
    synced: true,
    status: {
      sync_key: STATUS_KEY,
      last_success_at: now,
      last_attempt_at: now,
      last_error: null,
      theme_count: themeRows.length,
      stock_count: stockRows.length,
    } satisfies SyncStatusRow,
  };
}

async function ensureFreshSnapshot(supabase: ReturnType<typeof createAdminClient>, force = false): Promise<SyncResult> {
  const status = await getSyncStatus(supabase);
  if (!force && isFresh(status)) {
    return { synced: false, status };
  }

  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    const attemptAt = new Date().toISOString();
    await writeSyncStatus(supabase, { sync_key: STATUS_KEY, last_attempt_at: attemptAt });

    try {
      return await replaceThemeSnapshot(supabase);
    } catch (error) {
      const message = error instanceof Error ? error.message : "UNKNOWN_THEME_SYNC_ERROR";
      await writeSyncStatus(supabase, {
        sync_key: STATUS_KEY,
        last_attempt_at: attemptAt,
        last_error: message,
      });

      const fallback = await getSyncStatus(supabase);
      if (fallback) {
        return { synced: false, status: fallback };
      }
      throw error;
    } finally {
      syncPromise = null;
    }
  })();

  return syncPromise;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createAdminClient();
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "list";

    if (action === "sync") {
      const result = await ensureFreshSnapshot(supabase, false);
      return jsonResponse({ ok: true, synced: result.synced, status: result.status });
    }

    if (action === "probe") {
      const probe = await runProbe();
      return jsonResponse({ ok: true, probe });
    }

    await ensureFreshSnapshot(supabase, false);
    const status = await getSyncStatus(supabase);

    if (action === "list") {
      const q = (url.searchParams.get("q") || "").trim();
      const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
      const pageSize = Math.min(200, Math.max(10, Number(url.searchParams.get("pageSize") || "50")));

      let query = supabase
        .from("naver_themes")
        .select("theme_no,theme_name,detail_url,stock_count,scraped_at", { count: "exact" })
        .order("theme_name", { ascending: true });

      if (q) query = query.ilike("theme_name", `%${q}%`);

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      const { data, count, error } = await query.range(from, to);
      if (error) throw error;

      return jsonResponse({
        items: (data ?? []).map((item) => ({
          themeNo: item.theme_no,
          themeName: item.theme_name,
          stockCount: item.stock_count,
          updatedAt: item.scraped_at,
        })),
        total: count ?? 0,
        page,
        pageSize,
        generatedAt: status?.last_success_at ?? null,
        syncStatus: status,
      });
    }

    if (action === "components") {
      const themeNo = Number(url.searchParams.get("themeNo") || "0");
      if (!themeNo) {
        return jsonResponse({ error: "Missing themeNo parameter" }, 400);
      }

      const [{ data: theme, error: themeError }, { data: stocks, error: stockError }] = await Promise.all([
        supabase
          .from("naver_themes")
          .select("theme_no,theme_name,stock_count,scraped_at")
          .eq("theme_no", themeNo)
          .maybeSingle(),
        supabase
          .from("naver_theme_stocks")
          .select("stock_code,stock_name,rank_no")
          .eq("theme_no", themeNo)
          .order("rank_no", { ascending: true }),
      ]);

      if (themeError) throw themeError;
      if (stockError) throw stockError;

      return jsonResponse({
        themeNo,
        themeName: theme?.theme_name ?? "",
        stockCount: theme?.stock_count ?? 0,
        updatedAt: theme?.scraped_at ?? status?.last_success_at ?? null,
        components: (stocks ?? []).map((item) => ({
          stockTicker: item.stock_code,
          stockName: item.stock_name,
          rankNo: item.rank_no,
        })),
        syncStatus: status,
      });
    }

    return jsonResponse(
      { error: "Unknown action. Use action=list, action=components, action=sync, or action=probe" },
      400,
    );
  } catch (error: unknown) {
    console.error("theme-proxy error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
});

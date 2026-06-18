import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Investor / Market mapping ───
const INVESTOR_CODES: Record<string, string> = {
  ALL: "9999", PERSONAL: "8000", FOREIGN: "9000", INSTITUTION: "7050",
  PENSION: "6000", BANK: "1000", INSURANCE: "2000", TRUST: "3000",
  PRIVATE_EQUITY: "3100", SECURITIES: "4000", OTHER_FINANCIAL: "5000",
  OTHER_CORPORATE: "7100", OTHER_FOREIGN: "9001",
};

const INVESTOR_ALIASES: Record<string, string> = {
  전체: "ALL", 개인: "PERSONAL", 외국인: "FOREIGN",
  기관: "INSTITUTION", 기관합계: "INSTITUTION",
  연기금: "PENSION", 금융투자: "SECURITIES", 보험: "INSURANCE",
  신탁: "TRUST", 사모: "PRIVATE_EQUITY", 은행: "BANK",
  기타금융: "OTHER_FINANCIAL", 기타법인: "OTHER_CORPORATE", 기타외국인: "OTHER_FOREIGN",
  투신: "TRUST",
  "?꾩껜": "ALL", 媛쒖씤: "PERSONAL", "?멸뎅??": "FOREIGN",
  "湲곌??⑷퀎": "INSTITUTION", "?곌린湲?": "PENSION",
  "湲덉쑖?ъ옄": "SECURITIES", 蹂댄뿕: "INSURANCE",
  "?ъ떊": "TRUST", "?щえ": "PRIVATE_EQUITY", "???": "BANK",
  "湲고?湲덉쑖": "OTHER_FINANCIAL", "湲고?踰뺤씤": "OTHER_CORPORATE",
  "湲고??멸뎅??": "OTHER_FOREIGN",
};

const MARKET_MAP: Record<string, string> = {
  ALL: "ALL", KOSPI: "STK", KOSDAQ: "KSQ", KONEX: "KNX",
  STK: "STK", KSQ: "KSQ", KNX: "KNX",
};

function normalizeInvestor(input: string): string {
  const raw = (input || "ALL").trim();
  if (/^\d{4}$/.test(raw)) return raw;
  const upper = raw.toUpperCase();
  if (INVESTOR_CODES[upper]) return INVESTOR_CODES[upper];
  const canonical = INVESTOR_ALIASES[raw];
  if (canonical && INVESTOR_CODES[canonical]) return INVESTOR_CODES[canonical];
  return INVESTOR_CODES.ALL;
}

function normalizeMarket(input: string): string {
  return MARKET_MAP[(input || "ALL").trim().toUpperCase()] || "ALL";
}

function isValidYmd(s: string) { return /^\d{8}$/.test(s); }

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const url = new URL(req.url);
    const action = (url.searchParams.get("action") || "query").toLowerCase();
    const marketRaw = url.searchParams.get("market") || "ALL";
    const investorRaw = url.searchParams.get("investor") || "전체";
    const startDate = url.searchParams.get("startDate") || "";
    const endDate = url.searchParams.get("endDate") || "";
    const topN = Math.min(500, Math.max(1, Number(url.searchParams.get("topN") || "50")));
    const mode = (url.searchParams.get("mode") || "json").toLowerCase();

    const marketCode = normalizeMarket(marketRaw);
    const investorCode = normalizeInvestor(investorRaw);

    // ─── PROBE ───
    if (action === "probe") {
      const [{ data: latestRow }, { data: oldestRow }, { data: syncStatus }] = await Promise.all([
        supabase.from("investor_snapshots").select("trade_date, collected_at").order("trade_date", { ascending: false }).limit(1).single(),
        supabase.from("investor_snapshots").select("trade_date").order("trade_date", { ascending: true }).limit(1).single(),
        supabase.from("investor_sync_status").select("*").order("last_attempt_at", { ascending: false }).limit(1).single(),
      ]);

      return jsonResp({
        ok: true,
        probe: {
          source: "database",
          marketRaw, marketCode, investorRaw, investorCode,
          minTradeDate: oldestRow?.trade_date || null,
          maxTradeDate: latestRow?.trade_date || null,
          latestTradeDate: latestRow?.trade_date || null,
          latestCollectedAt: latestRow?.collected_at || null,
          syncStatus: syncStatus || null,
        },
      });
    }

    // ─── Validate dates ───
    if (!isValidYmd(startDate) || !isValidYmd(endDate)) {
      return jsonResp({ ok: false, errorCode: "BAD_REQUEST", message: "startDate and endDate required (YYYYMMDD)." }, 400);
    }
    if (startDate > endDate) {
      return jsonResp({ ok: false, errorCode: "BAD_REQUEST", message: "startDate must be <= endDate." }, 400);
    }

    // ─── Get DB date range ───
    const [{ data: minRow }, { data: maxRow }] = await Promise.all([
      supabase.from("investor_snapshots").select("trade_date").order("trade_date", { ascending: true }).limit(1).single(),
      supabase.from("investor_snapshots").select("trade_date").order("trade_date", { ascending: false }).limit(1).single(),
    ]);
    const minTradeDate = (minRow?.trade_date as string) || null;
    const maxTradeDate = (maxRow?.trade_date as string) || null;

    // ─── Query DB ───
    let query = supabase
      .from("investor_snapshots")
      .select("*")
      .eq("investor_code", investorCode)
      .eq("market", marketCode)
      .gte("trade_date", startDate)
      .lte("trade_date", endDate);

    // Order by absolute net value descending for "top" ranking
    query = query.order("val_net", { ascending: false });

    const { data: rows, error: dbError } = await query.limit(topN);

    if (dbError) {
      console.error("DB query error:", dbError);
      return jsonResp({ ok: false, errorCode: "DB_ERROR", message: dbError.message });
    }

    // Check if we have data
    const items = (rows || []).map((r: Record<string, unknown>) => ({
      isuCd: r.stock_code as string,
      isuNm: r.stock_name as string,
      volSell: r.vol_sell as number,
      volBuy: r.vol_buy as number,
      volNet: r.vol_net as number,
      valSell: r.val_sell as number,
      valBuy: r.val_buy as number,
      valNet: r.val_net as number,
    }));

    // Determine resolved dates and stale status
    let resolvedStartDate = startDate;
    let resolvedEndDate = endDate;
    let usedFallbackDate = false;
    let stale = false;

    if (items.length === 0 && startDate === endDate) {
      // Try to find nearest available date (fallback)
      const { data: fallbackRows } = await supabase
        .from("investor_snapshots")
        .select("trade_date")
        .eq("investor_code", investorCode)
        .eq("market", marketCode)
        .lt("trade_date", startDate)
        .order("trade_date", { ascending: false })
        .limit(1)
        .single();

      if (fallbackRows?.trade_date) {
        const fbDate = fallbackRows.trade_date as string;
        const { data: fbRows } = await supabase
          .from("investor_snapshots")
          .select("*")
          .eq("investor_code", investorCode)
          .eq("market", marketCode)
          .eq("trade_date", fbDate)
          .order("val_net", { ascending: false })
          .limit(topN);

        if (fbRows && fbRows.length > 0) {
          items.length = 0;
          fbRows.forEach((r: Record<string, unknown>) => {
            items.push({
              isuCd: r.stock_code as string,
              isuNm: r.stock_name as string,
              volSell: r.vol_sell as number,
              volBuy: r.vol_buy as number,
              volNet: r.vol_net as number,
              valSell: r.val_sell as number,
              valBuy: r.val_buy as number,
              valNet: r.val_net as number,
            });
          });
          resolvedStartDate = fbDate;
          resolvedEndDate = fbDate;
          usedFallbackDate = true;
        }
      }
    }

    // Check sync status for staleness
    const { data: syncRow } = await supabase
      .from("investor_sync_status")
      .select("last_success_at, last_error")
      .order("last_attempt_at", { ascending: false })
      .limit(1)
      .single();

    if (syncRow?.last_error && !syncRow?.last_success_at) {
      stale = true;
    }

    const generatedAt = syncRow?.last_success_at
      ? new Date(syncRow.last_success_at as string).getTime()
      : Date.now();

    // ─── CSV mode ───
    if (mode === "csv") {
      const header = "stock_code,stock_name,vol_sell,vol_buy,vol_net,val_sell,val_buy,val_net";
      const body = items.map((r) =>
        `${r.isuCd},"${r.isuNm.replace(/"/g, '""')}",${r.volSell},${r.volBuy},${r.volNet},${r.valSell},${r.valBuy},${r.valNet}`
      ).join("\n");
      const csv = `\uFEFF${header}\n${body}`;
      return new Response(csv, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="investor_top_equities.csv"`,
        },
      });
    }

    // Out-of-range message
    let outOfRangeMsg: string | undefined;
    if (items.length === 0 && minTradeDate && maxTradeDate) {
      if (endDate < minTradeDate || startDate > maxTradeDate) {
        outOfRangeMsg = `조회 가능 범위: ${minTradeDate} ~ ${maxTradeDate}`;
      }
    }

    // ─── JSON response ───
    return jsonResp({
      ok: true,
      items,
      totalRows: items.length,
      generatedAt,
      stale,
      resolvedStartDate,
      resolvedEndDate,
      usedFallbackDate,
      minTradeDate,
      maxTradeDate,
      ...(stale ? { note: "Data may be outdated due to collection failure." } : {}),
      ...(outOfRangeMsg ? { message: outOfRangeMsg } : {}),
    });
  } catch (error: unknown) {
    console.error("investor-proxy error:", error);
    return jsonResp({
      ok: false,
      errorCode: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

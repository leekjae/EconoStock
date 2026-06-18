import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

type ScreeningRun = Tables<"screening_runs">;
type ScreeningCandidate = Tables<"screening_candidates">;
type ScreeningPriceDaily = Tables<"screening_price_daily">;

const PRICE_PAGE_SIZE = 1000;

export interface ScreeningPerformanceRow extends ScreeningCandidate {
  entryTradeDate: string | null;
  entryOpenPrice: number | null;
  latestTradeDate: string | null;
  latestClosePrice: number | null;
  highestPrice: number | null;
  lowestPrice: number | null;
  maxReturnPct: number | null;
  maxDrawdownPct: number | null;
  returnPct: number | null;
  performanceStatus: "ready" | "awaiting_entry" | "entry_missing" | "latest_missing";
}

interface PerformanceSummary {
  monitoredCount: number;
  averageReturn: number;
  positiveCount: number;
  negativeCount: number;
  pendingCount: number;
  latestReferenceDate: string | null;
  bestReturn: number | null;
  worstDrawdown: number | null;
}

function parseCompactDate(ymd: string) {
  return new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)));
}

function shiftCompactDate(ymd: string, dayOffset: number) {
  const next = parseCompactDate(ymd);
  next.setDate(next.getDate() + dayOffset);
  const year = String(next.getFullYear());
  const month = String(next.getMonth() + 1).padStart(2, "0");
  const day = String(next.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function normalizeStockCode(stockCode: string) {
  const digits = String(stockCode || "").replace(/[^\d]/g, "");
  return digits.padStart(6, "0");
}

function buildQuoteMap(rows: ScreeningPriceDaily[] | undefined) {
  const map = new Map<string, ScreeningPriceDaily[]>();

  for (const row of rows ?? []) {
    const stockCode = normalizeStockCode(row.stock_code);
    if (!stockCode) continue;
    const bucket = map.get(stockCode) ?? [];
    bucket.push(row);
    map.set(stockCode, bucket);
  }

  for (const bucket of map.values()) {
    bucket.sort((left, right) => left.trade_date.localeCompare(right.trade_date));
  }

  return map;
}

async function fetchLatestScreeningPriceDate() {
  const { data, error } = await supabase
    .from("screening_price_daily")
    .select("trade_date")
    .order("trade_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.trade_date ?? null;
}

async function fetchScreeningPriceRows(stockCodes: string[], startDate: string, endDate: string) {
  if (stockCodes.length === 0) {
    return [] as ScreeningPriceDaily[];
  }

  const rows: ScreeningPriceDaily[] = [];

  for (let from = 0; ; from += PRICE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("screening_price_daily")
      .select("*")
      .in("stock_code", stockCodes)
      .gte("trade_date", startDate)
      .lte("trade_date", endDate)
      .order("stock_code", { ascending: true })
      .order("trade_date", { ascending: true })
      .range(from, from + PRICE_PAGE_SIZE - 1);

    if (error) {
      throw error;
    }

    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < PRICE_PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

export function useScreeningPerformance(run: ScreeningRun | null, candidates: ScreeningCandidate[]) {
  const stockCodes = useMemo(() => {
    return Array.from(
      new Set(
        candidates
          .map((candidate) => normalizeStockCode(candidate.stock_code))
          .filter(Boolean)
      )
    ).sort();
  }, [candidates]);

  const entryStartDate = run ? shiftCompactDate(run.as_of_date, 1) : undefined;

  const latestPriceDateQuery = useQuery({
    queryKey: ["screening-price-latest-date"],
    queryFn: fetchLatestScreeningPriceDate,
    staleTime: 60 * 1000,
  });

  const latestAvailableTradeDate = latestPriceDateQuery.data ?? null;
  const priceRowsQuery = useQuery<ScreeningPriceDaily[]>({
    queryKey: ["screening-price-rows", stockCodes.join(","), entryStartDate, latestAvailableTradeDate],
    queryFn: () => fetchScreeningPriceRows(stockCodes, entryStartDate!, latestAvailableTradeDate!),
    enabled: !!run && stockCodes.length > 0 && !!entryStartDate && !!latestAvailableTradeDate,
    staleTime: 60 * 1000,
  });

  const rows = useMemo<ScreeningPerformanceRow[]>(() => {
    if (!run) {
      return [];
    }

    const quoteMap = buildQuoteMap(priceRowsQuery.data);

    return candidates.map((candidate) => {
      const stockCode = normalizeStockCode(candidate.stock_code);
      const quoteRows = quoteMap.get(stockCode) ?? [];
      const entryRow =
        quoteRows.find((row) => row.trade_date > run.as_of_date && Number(row.open_price) > 0) ?? null;
      const effectiveRows = entryRow ? quoteRows.filter((row) => row.trade_date >= entryRow.trade_date) : [];
      const latestRow =
        [...effectiveRows].reverse().find((row) => Number(row.close_price) > 0) ?? null;

      let performanceStatus: ScreeningPerformanceRow["performanceStatus"] = "ready";
      if (!entryRow) {
        performanceStatus =
          latestAvailableTradeDate && latestAvailableTradeDate <= run.as_of_date
            ? "awaiting_entry"
            : "entry_missing";
      } else if (!latestRow) {
        performanceStatus = "latest_missing";
      }

      const entryOpenPrice = entryRow ? Number(entryRow.open_price) : null;
      const latestClosePrice = latestRow ? Number(latestRow.close_price) : null;
      const highestPrice =
        entryOpenPrice && effectiveRows.length > 0
          ? effectiveRows.reduce((max, row) => Math.max(max, Number(row.high_price || 0)), 0)
          : null;
      const lowestPrice =
        entryOpenPrice && effectiveRows.length > 0
          ? effectiveRows.reduce((min, row) => {
              const low = Number(row.low_price || 0);
              if (low <= 0) return min;
              return min === null ? low : Math.min(min, low);
            }, null as number | null)
          : null;
      const returnPct =
        entryOpenPrice && latestClosePrice ? ((latestClosePrice / entryOpenPrice) - 1) * 100 : null;
      const maxReturnPct =
        entryOpenPrice && highestPrice ? ((highestPrice / entryOpenPrice) - 1) * 100 : null;
      const maxDrawdownPct =
        entryOpenPrice && lowestPrice ? ((lowestPrice / entryOpenPrice) - 1) * 100 : null;

      return {
        ...candidate,
        entryTradeDate: entryRow?.trade_date ?? null,
        entryOpenPrice,
        latestTradeDate: latestRow?.trade_date ?? null,
        latestClosePrice,
        highestPrice,
        lowestPrice,
        maxReturnPct,
        maxDrawdownPct,
        returnPct,
        performanceStatus,
      };
    });
  }, [candidates, latestAvailableTradeDate, priceRowsQuery.data, run]);

  const summary = useMemo<PerformanceSummary>(() => {
    const readyRows = rows.filter((row) => row.returnPct !== null);
    const positiveCount = readyRows.filter((row) => (row.returnPct ?? 0) > 0).length;
    const negativeCount = readyRows.filter((row) => (row.returnPct ?? 0) < 0).length;
    const pendingCount = rows.length - readyRows.length;
    const latestReferenceDate =
      readyRows
        .map((row) => row.latestTradeDate)
        .filter((date): date is string => Boolean(date))
        .sort((left, right) => right.localeCompare(left))[0] ?? latestAvailableTradeDate ?? null;

    return {
      monitoredCount: readyRows.length,
      averageReturn:
        readyRows.length === 0
          ? 0
          : readyRows.reduce((sum, row) => sum + Number(row.returnPct || 0), 0) / readyRows.length,
      positiveCount,
      negativeCount,
      pendingCount,
      latestReferenceDate,
      bestReturn:
        readyRows.length === 0
          ? null
          : readyRows.reduce(
              (max, row) => Math.max(max, Number(row.maxReturnPct ?? Number.NEGATIVE_INFINITY)),
              Number.NEGATIVE_INFINITY
            ),
      worstDrawdown:
        readyRows.length === 0
          ? null
          : readyRows.reduce(
              (min, row) => Math.min(min, Number(row.maxDrawdownPct ?? Number.POSITIVE_INFINITY)),
              Number.POSITIVE_INFINITY
            ),
    };
  }, [latestAvailableTradeDate, rows]);

  return {
    latestAvailableTradeDate,
    rows,
    summary,
    isLoading: !!run && stockCodes.length > 0 && (latestPriceDateQuery.isLoading || priceRowsQuery.isLoading),
    isFetching: latestPriceDateQuery.isFetching || priceRowsQuery.isFetching,
    isLatestDateFetching: latestPriceDateQuery.isFetching,
    error: latestPriceDateQuery.error || priceRowsQuery.error,
    async refetch() {
      await latestPriceDateQuery.refetch();
      await priceRowsQuery.refetch();
    },
  };
}

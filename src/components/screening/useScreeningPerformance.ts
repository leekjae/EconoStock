import { useMemo } from "react";

import { useBusinessDate, useStockRangeData } from "@/hooks/useKrxData";
import { formatDate, parseNum } from "@/lib/krx-api";
import type { Tables } from "@/integrations/supabase/types";
import type { StockData } from "@/types/krx";

type ScreeningRun = Tables<"screening_runs">;
type ScreeningCandidate = Tables<"screening_candidates">;

type MarketKey = "stk" | "ksq" | "knx";

const ENTRY_LOOKAHEAD_DAYS = 10;

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
  return formatDate(next);
}

function normalizeStockCode(stockCode: string) {
  const digits = String(stockCode || "").replace(/[^\d]/g, "");
  return digits.padStart(6, "0");
}

function normalizeMarket(market: string): MarketKey | null {
  const normalized = String(market || "").trim().toUpperCase();
  if (normalized === "KOSPI" || normalized === "STK") return "stk";
  if (normalized === "KOSDAQ" || normalized === "KSQ") return "ksq";
  if (normalized === "KONEX" || normalized === "KNX") return "knx";
  return null;
}

function buildQuoteMap(rows: StockData[] | undefined) {
  const map = new Map<string, StockData[]>();

  for (const row of rows ?? []) {
    const marketKey = normalizeMarket(row.MKT_NM);
    if (!marketKey) continue;
    const key = `${marketKey}:${normalizeStockCode(row.ISU_CD)}`;
    const bucket = map.get(key) ?? [];
    bucket.push(row);
    map.set(key, bucket);
  }

  for (const bucket of map.values()) {
    bucket.sort((left, right) => left.BAS_DD.localeCompare(right.BAS_DD));
  }

  return map;
}

export function useScreeningPerformance(run: ScreeningRun | null, candidates: ScreeningCandidate[]) {
  const {
    data: latestBusinessDate,
    isLoading: isLatestDateLoading,
    isFetching: isLatestDateFetching,
    error: latestDateError,
    refetch: refetchLatestDate,
  } = useBusinessDate();

  const markets = useMemo(() => {
    const values = Array.from(
      new Set(
        candidates
          .map((candidate) => normalizeMarket(candidate.market))
          .filter((market): market is MarketKey => market !== null)
      )
    );
    values.sort();
    return values;
  }, [candidates]);

  const entryStartDate = run ? shiftCompactDate(run.as_of_date, 1) : undefined;
  const entryEndDate = run ? shiftCompactDate(run.as_of_date, ENTRY_LOOKAHEAD_DAYS) : undefined;
  const enabled = !!run && candidates.length > 0 && markets.length > 0;

  const entryQuery = useStockRangeData(markets, entryStartDate, entryEndDate, enabled);
  const pathQuery = useStockRangeData(markets, entryStartDate, latestBusinessDate, enabled && !!latestBusinessDate);

  const rows = useMemo<ScreeningPerformanceRow[]>(() => {
    if (!run) {
      return [];
    }

    const entryMap = buildQuoteMap(entryQuery.data?.daily);
    const pathMap = buildQuoteMap(pathQuery.data?.daily);

    return candidates.map((candidate) => {
      const marketKey = normalizeMarket(candidate.market);
      const lookupKey = marketKey ? `${marketKey}:${normalizeStockCode(candidate.stock_code)}` : null;
      const entryRows = lookupKey ? entryMap.get(lookupKey) ?? [] : [];
      const pathRows = lookupKey ? pathMap.get(lookupKey) ?? [] : [];

      const entryRow =
        entryRows.find((row) => row.BAS_DD > run.as_of_date && parseNum(row.TDD_OPNPRC) > 0) ?? null;
      const effectiveRows = entryRow
        ? pathRows.filter((row) => row.BAS_DD >= entryRow.BAS_DD)
        : [];
      const latestRow =
        [...effectiveRows].reverse().find((row) => parseNum(row.TDD_CLSPRC) > 0) ?? null;

      let performanceStatus: ScreeningPerformanceRow["performanceStatus"] = "ready";
      if (!entryRow) {
        performanceStatus = latestBusinessDate && latestBusinessDate <= run.as_of_date ? "awaiting_entry" : "entry_missing";
      } else if (!latestRow) {
        performanceStatus = "latest_missing";
      }

      const entryOpenPrice = entryRow ? parseNum(entryRow.TDD_OPNPRC) : null;
      const latestClosePrice = latestRow ? parseNum(latestRow.TDD_CLSPRC) : null;
      const highestPrice =
        entryOpenPrice && effectiveRows.length > 0
          ? effectiveRows.reduce((max, row) => Math.max(max, parseNum(row.TDD_HGPRC)), 0)
          : null;
      const lowestPrice =
        entryOpenPrice && effectiveRows.length > 0
          ? effectiveRows.reduce((min, row) => {
              const low = parseNum(row.TDD_LWPRC);
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
        entryTradeDate: entryRow?.BAS_DD ?? null,
        entryOpenPrice,
        latestTradeDate: latestRow?.BAS_DD ?? null,
        latestClosePrice,
        highestPrice,
        lowestPrice,
        maxReturnPct,
        maxDrawdownPct,
        returnPct,
        performanceStatus,
      };
    });
  }, [candidates, entryQuery.data?.daily, latestBusinessDate, pathQuery.data?.daily, run]);

  const summary = useMemo<PerformanceSummary>(() => {
    const readyRows = rows.filter((row) => row.returnPct !== null);
    const positiveCount = readyRows.filter((row) => (row.returnPct ?? 0) > 0).length;
    const negativeCount = readyRows.filter((row) => (row.returnPct ?? 0) < 0).length;
    const pendingCount = rows.length - readyRows.length;
    const latestReferenceDate =
      readyRows
        .map((row) => row.latestTradeDate)
        .filter((date): date is string => Boolean(date))
        .sort((left, right) => right.localeCompare(left))[0] ?? latestBusinessDate ?? null;

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
          : readyRows.reduce((max, row) => Math.max(max, Number(row.maxReturnPct ?? Number.NEGATIVE_INFINITY)), Number.NEGATIVE_INFINITY),
      worstDrawdown:
        readyRows.length === 0
          ? null
          : readyRows.reduce((min, row) => Math.min(min, Number(row.maxDrawdownPct ?? Number.POSITIVE_INFINITY)), Number.POSITIVE_INFINITY),
    };
  }, [latestBusinessDate, rows]);

  return {
    latestBusinessDate: latestBusinessDate ?? null,
    rows,
    summary,
    isLoading: enabled && (isLatestDateLoading || entryQuery.isLoading || pathQuery.isLoading),
    isFetching: entryQuery.isFetching || pathQuery.isFetching,
    isLatestDateFetching,
    error: latestDateError || entryQuery.error || pathQuery.error,
    async refetch() {
      await refetchLatestDate();
      await Promise.all([entryQuery.refetch(), pathQuery.refetch()]);
    },
  };
}

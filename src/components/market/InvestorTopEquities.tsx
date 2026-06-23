import { useEffect, useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowDownUp, ArrowUp, CalendarDays, Database, RefreshCw, Users } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  aggregateArchiveRankedRows,
  extractArchiveDetailRows,
  filterArchiveFilesForRange,
  getPreviousCompactDate,
  mergeDetailRows,
  mergeRankedRows,
  type DirectionType,
  type InvestorArchiveFileMeta,
  type InvestorArchiveManifest,
  type InvestorArchiveMonthFile,
  type InvestorArchiveStockMeta,
  type InvestorFlowDailyRow,
  type InvestorFlowOverview,
  type InvestorFlowRankedRow,
  type InvestorFlowTradeDate,
  type InvestorType,
  type MarketType,
} from "@/lib/investorFlowHybrid";

type InvestorSyncStatus = Tables<"investor_sync_status">;
type HybridMode = "hot" | "archive" | "hybrid";

interface InvestorTopEquitiesProps {
  initialStartDate?: Date;
  initialEndDate?: Date;
}

const SORT_OPTIONS: Array<{ value: InvestorType; label: string }> = [
  { value: "foreign", label: "외국인" },
  { value: "institution", label: "기관" },
  { value: "individual", label: "개인" },
];

const DIRECTION_OPTIONS: Array<{ value: DirectionType; label: string }> = [
  { value: "buy", label: "순매수 상위" },
  { value: "sell", label: "순매도 상위" },
];

const MARKET_OPTIONS: Array<{ value: MarketType; label: string }> = [
  { value: "ALL", label: "전체" },
  { value: "KOSPI", label: "KOSPI" },
  { value: "KOSDAQ", label: "KOSDAQ" },
  { value: "KONEX", label: "KONEX" },
];

const TOP_N_OPTIONS = [30, 50, 100];
const DEFAULT_LOOKBACK_DAYS = 20;
const HYBRID_FETCH_LIMIT = 5000;
const INVESTOR_DATA_BASE = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/") + "data/investor-flow/";
const archiveJsonCache = new Map<string, Promise<unknown>>();

function compactDateFromDate(value?: Date) {
  if (!value) return null;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return String(year) + month + day;
}

function dateFromCompact(value: string | null | undefined) {
  if (!value || !/^\d{8}$/.test(value)) return undefined;
  return new Date(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)));
}

function formatTradeDate(value: string | null | undefined) {
  if (!value || !/^\d{8}$/.test(value)) return value ?? "-";
  return value.slice(0, 4) + "." + value.slice(4, 6) + "." + value.slice(6, 8);
}

function formatCalendarLabel(value: string | null | undefined) {
  const date = dateFromCompact(value);
  return date ? format(date, "yyyy.MM.dd", { locale: ko }) : "날짜 선택";
}

function formatPrice(value: number | null | undefined) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "-";
  return numeric.toLocaleString("ko-KR");
}

function formatSignedEok(value: number | null | undefined) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  const rounded = Math.round(Math.abs(numeric) / 100000000);
  const sign = rounded === 0 ? "" : numeric > 0 ? "+" : "-";
  return sign + rounded.toLocaleString("ko-KR") + "억";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "기록 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return format(date, "yyyy.MM.dd HH:mm:ss", { locale: ko });
}

function getValueTone(value: number | null | undefined) {
  if (value === null || value === undefined) return "text-muted-foreground";
  if (value > 0) return "text-up";
  if (value < 0) return "text-down";
  return "text-muted-foreground";
}

function getErrorMessage(error: unknown) {
  if (!error) return "";
  if (typeof error === "object" && error !== null && "message" in error) return String(error.message);
  return String(error);
}

function isSchemaMissing(error: unknown) {
  const message = getErrorMessage(error);
  return /investor_flow_daily|get_investor_flow_ranked|get_investor_flow_trade_dates|get_investor_flow_overview|does not exist|could not find the function/i.test(message);
}

function findTradeDateOnOrBefore(target: string, datesDesc: string[]) {
  for (const tradeDate of datesDesc) {
    if (tradeDate <= target) return tradeDate;
  }
  return datesDesc.at(-1) ?? null;
}

function subtractCalendarDays(value: string, days: number) {
  const date = dateFromCompact(value);
  if (!date) return value;
  date.setDate(date.getDate() - days);
  return compactDateFromDate(date) ?? value;
}

function clampCompactDate(value: string, minDate?: string | null, maxDate?: string | null) {
  let next = value;
  if (minDate && next < minDate) next = minDate;
  if (maxDate && next > maxDate) next = maxDate;
  return next;
}

function getDefaultStartDate(endDate: string, hotTradeDatesDesc: string[]) {
  const index = hotTradeDatesDesc.indexOf(endDate);
  if (index !== -1) return hotTradeDatesDesc[Math.min(hotTradeDatesDesc.length - 1, index + DEFAULT_LOOKBACK_DAYS - 1)] ?? endDate;
  return subtractCalendarDays(endDate, 30);
}

function getRangeMode(startDate: string, endDate: string, cutoffTradeDate?: string | null): HybridMode {
  if (!cutoffTradeDate) return "hot";
  if (endDate < cutoffTradeDate) return "archive";
  if (startDate >= cutoffTradeDate) return "hot";
  return "hybrid";
}

function getRangeModeLabel(mode: HybridMode) {
  if (mode === "archive") return "과거 아카이브";
  if (mode === "hybrid") return "혼합 조회";
  return "최근 데이터";
}

function getInvestorDataUrl(path: string) {
  return INVESTOR_DATA_BASE + path.replace(/^\/+/, "");
}

async function fetchArchiveJson<T>(path: string) {
  const url = getInvestorDataUrl(path);
  const cached = archiveJsonCache.get(url);
  if (cached) return cached as Promise<T>;
  const pending = fetch(url)
    .then(async (response) => {
      if (!response.ok) throw new Error("투자자 아카이브 파일을 불러오지 못했습니다. (" + response.status + ")");
      return (await response.json()) as T;
    })
    .catch((error) => {
      archiveJsonCache.delete(url);
      throw error;
    });
  archiveJsonCache.set(url, pending);
  return pending as Promise<T>;
}

async function fetchArchiveManifest() { return fetchArchiveJson<InvestorArchiveManifest>("manifest.json"); }
async function fetchArchiveStockMeta(manifest: InvestorArchiveManifest) { return fetchArchiveJson<InvestorArchiveStockMeta>(manifest.stock_meta_path); }
async function fetchArchiveMonthFile(file: InvestorArchiveFileMeta) { return fetchArchiveJson<InvestorArchiveMonthFile>(file.path); }
async function fetchInvestorFlowOverview() {
  const { data, error } = await supabase.rpc("get_investor_flow_overview");
  if (error) throw error;
  return ((data as InvestorFlowOverview[] | null)?.[0] ?? null) as InvestorFlowOverview | null;
}

async function fetchInvestorFlowTradeDates(limit = 4000) {
  const { data, error } = await supabase.rpc("get_investor_flow_trade_dates", { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as InvestorFlowTradeDate[];
}

async function fetchInvestorFlowRanked(params: { startDate: string; endDate: string; market: MarketType; sortBy: InvestorType; direction: DirectionType; topN: number; }) {
  const { data, error } = await supabase.rpc("get_investor_flow_ranked", {
    p_start_date: params.startDate,
    p_end_date: params.endDate,
    p_market: params.market,
    p_sort_by: params.sortBy,
    p_limit: params.topN,
    p_direction: params.direction,
  });
  if (error) throw error;
  return (data ?? []) as InvestorFlowRankedRow[];
}

async function fetchInvestorFlowSyncStatus() {
  const { data, error } = await supabase.from("investor_sync_status").select("*").eq("sync_key", "investor_flow_sqlite_import").maybeSingle();
  if (error) throw error;
  return data as InvestorSyncStatus | null;
}

async function fetchInvestorFlowDetail(params: { stockCode: string; startDate: string; endDate: string; }) {
  const { data, error } = await supabase
    .from("investor_flow_daily")
    .select("trade_date, stock_code, stock_name, market, close_price, individual_net, foreign_net, institution_net, source, collected_at")
    .eq("stock_code", params.stockCode)
    .gte("trade_date", params.startDate)
    .lte("trade_date", params.endDate)
    .order("trade_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as InvestorFlowDailyRow[];
}

async function fetchArchiveRankedRange(params: { manifest: InvestorArchiveManifest; stockMeta: InvestorArchiveStockMeta; startDate: string; endDate: string; market: MarketType; sortBy: InvestorType; direction: DirectionType; topN: number; }) {
  const filesMeta = filterArchiveFilesForRange(params.manifest, params.startDate, params.endDate);
  if (filesMeta.length === 0) return [] as InvestorFlowRankedRow[];
  const files = await Promise.all(filesMeta.map((file) => fetchArchiveMonthFile(file)));
  return aggregateArchiveRankedRows({ files, stockMeta: params.stockMeta, startDate: params.startDate, endDate: params.endDate, market: params.market, sortBy: params.sortBy, direction: params.direction, topN: params.topN });
}

async function fetchArchiveDetailRange(params: { manifest: InvestorArchiveManifest; stockMeta: InvestorArchiveStockMeta; stockCode: string; startDate: string; endDate: string; }) {
  const filesMeta = filterArchiveFilesForRange(params.manifest, params.startDate, params.endDate);
  if (filesMeta.length === 0) return [] as InvestorFlowDailyRow[];
  const files = await Promise.all(filesMeta.map((file) => fetchArchiveMonthFile(file)));
  return extractArchiveDetailRows({ files, stockMeta: params.stockMeta, stockCode: params.stockCode, startDate: params.startDate, endDate: params.endDate });
}

export function InvestorTopEquities({ initialStartDate, initialEndDate }: InvestorTopEquitiesProps) {
  const [selectedStartDate, setSelectedStartDate] = useState("");
  const [selectedEndDate, setSelectedEndDate] = useState("");
  const [sortBy, setSortBy] = useState<InvestorType>("foreign");
  const [direction, setDirection] = useState<DirectionType>("buy");
  const [market, setMarket] = useState<MarketType>("ALL");
  const [topN, setTopN] = useState(50);
  const [detailTarget, setDetailTarget] = useState<InvestorFlowRankedRow | null>(null);

  const preferredStartDate = useMemo(() => compactDateFromDate(initialStartDate), [initialStartDate]);
  const preferredEndDate = useMemo(() => compactDateFromDate(initialEndDate), [initialEndDate]);

  const archiveManifestQuery = useQuery({ queryKey: ["investor-flow-archive-manifest"], queryFn: fetchArchiveManifest, staleTime: 600000, retry: false });
  const archiveManifest = archiveManifestQuery.data ?? null;
  const archiveStockMetaQuery = useQuery({ queryKey: ["investor-flow-archive-stock-meta", archiveManifest?.stock_meta_path], queryFn: () => fetchArchiveStockMeta(archiveManifest!), enabled: !!archiveManifest, staleTime: 600000, retry: false });
  const stockMeta = archiveStockMetaQuery.data ?? null;
  const overviewQuery = useQuery({ queryKey: ["investor-flow-overview"], queryFn: fetchInvestorFlowOverview, staleTime: 300000, retry: false });
  const tradeDatesQuery = useQuery({ queryKey: ["investor-flow-trade-dates"], queryFn: () => fetchInvestorFlowTradeDates(4000), staleTime: 300000, retry: false });
  const syncStatusQuery = useQuery({ queryKey: ["investor-flow-sync-status"], queryFn: fetchInvestorFlowSyncStatus, staleTime: 60000, retry: false });

  const tradeDates = tradeDatesQuery.data ?? [];
  const hotTradeDateValuesDesc = useMemo(() => tradeDates.map((entry) => entry.trade_date), [tradeDates]);
  const hotLatestTradeDate = hotTradeDateValuesDesc[0] ?? overviewQuery.data?.max_trade_date ?? null;
  const archiveMinTradeDate = archiveManifest?.archive_files[0]?.trade_date_start ?? null;
  const archiveMaxTradeDate = archiveManifest?.hot_cutoff_trade_date ? getPreviousCompactDate(archiveManifest.hot_cutoff_trade_date) : null;
  const overallMinTradeDate = archiveMinTradeDate ?? overviewQuery.data?.min_trade_date ?? null;
  const overallMaxTradeDate = hotLatestTradeDate ?? archiveMaxTradeDate ?? null;

  useEffect(() => {
    if (!overallMaxTradeDate) return;
    const nextEndDate = clampCompactDate(preferredEndDate ?? hotLatestTradeDate ?? overallMaxTradeDate, overallMinTradeDate, overallMaxTradeDate);
    if (!selectedEndDate || selectedEndDate === archiveMaxTradeDate || selectedEndDate > overallMaxTradeDate || (overallMinTradeDate && selectedEndDate < overallMinTradeDate)) {
      setSelectedEndDate(nextEndDate);
    }
  }, [archiveMaxTradeDate, hotLatestTradeDate, overallMaxTradeDate, overallMinTradeDate, preferredEndDate, selectedEndDate]);

  useEffect(() => {
    if (!selectedEndDate) return;
    const nextStartDate = clampCompactDate(preferredStartDate ?? getDefaultStartDate(selectedEndDate, hotTradeDateValuesDesc), overallMinTradeDate, selectedEndDate);
    if (!selectedStartDate || selectedStartDate === archiveMaxTradeDate || selectedStartDate > selectedEndDate || (overallMinTradeDate && selectedStartDate < overallMinTradeDate)) {
      setSelectedStartDate(nextStartDate);
    }
  }, [archiveMaxTradeDate, hotTradeDateValuesDesc, overallMinTradeDate, preferredStartDate, selectedEndDate, selectedStartDate]);

  const selectedRange = useMemo(() => {
    if (!selectedStartDate || !selectedEndDate) return null;
    return selectedStartDate <= selectedEndDate ? { startDate: selectedStartDate, endDate: selectedEndDate } : { startDate: selectedEndDate, endDate: selectedStartDate };
  }, [selectedEndDate, selectedStartDate]);

  const rangeMode = useMemo(() => selectedRange ? getRangeMode(selectedRange.startDate, selectedRange.endDate, archiveManifest?.hot_cutoff_trade_date) : "hot", [archiveManifest?.hot_cutoff_trade_date, selectedRange]);
  const leadersQuery = useQuery({
    queryKey: ["investor-flow-ranked", selectedRange?.startDate, selectedRange?.endDate, rangeMode, sortBy, direction, market, topN, archiveManifest?.generated_at, hotLatestTradeDate],
    enabled: !!selectedRange && (!!overallMaxTradeDate || !!archiveManifest),
    staleTime: 300000,
    retry: false,
    queryFn: async () => {
      if (!selectedRange) return [] as InvestorFlowRankedRow[];
      const cutoffTradeDate = archiveManifest?.hot_cutoff_trade_date ?? null;
      const activeMode = getRangeMode(selectedRange.startDate, selectedRange.endDate, cutoffTradeDate);
      let archiveRows: InvestorFlowRankedRow[] = [];
      let hotRows: InvestorFlowRankedRow[] = [];
      if (activeMode !== "hot") {
        if (!archiveManifest || !stockMeta) throw new Error("과거 투자자 아카이브를 아직 불러오지 못했습니다.");
        const archiveEndDate = activeMode === "archive" ? selectedRange.endDate : getPreviousCompactDate(cutoffTradeDate!);
        archiveRows = await fetchArchiveRankedRange({ manifest: archiveManifest, stockMeta, startDate: selectedRange.startDate, endDate: archiveEndDate, market, sortBy, direction, topN: activeMode === "hybrid" ? HYBRID_FETCH_LIMIT : topN });
        if (activeMode === "archive") return archiveRows;
      }
      if (activeMode !== "archive") {
        const hotStartDate = activeMode === "hot" ? selectedRange.startDate : cutoffTradeDate!;
        const hotEndDate = findTradeDateOnOrBefore(selectedRange.endDate, hotTradeDateValuesDesc);
        if (hotEndDate && hotStartDate <= hotEndDate) hotRows = await fetchInvestorFlowRanked({ startDate: hotStartDate, endDate: hotEndDate, market, sortBy, direction, topN: activeMode === "hybrid" ? HYBRID_FETCH_LIMIT : topN });
        if (activeMode === "hot") return hotRows;
      }
      return mergeRankedRows({ archiveRows, hotRows, sortBy, direction, topN });
    },
  });

  const detailQuery = useQuery({
    queryKey: ["investor-flow-detail", detailTarget?.stock_code, selectedRange?.startDate, selectedRange?.endDate, rangeMode, archiveManifest?.generated_at],
    enabled: !!detailTarget && !!selectedRange,
    staleTime: 300000,
    retry: false,
    queryFn: async () => {
      if (!detailTarget || !selectedRange) return [] as InvestorFlowDailyRow[];
      const cutoffTradeDate = archiveManifest?.hot_cutoff_trade_date ?? null;
      const activeMode = getRangeMode(selectedRange.startDate, selectedRange.endDate, cutoffTradeDate);
      let archiveRows: InvestorFlowDailyRow[] = [];
      let hotRows: InvestorFlowDailyRow[] = [];
      if (activeMode !== "hot") {
        if (!archiveManifest || !stockMeta) throw new Error("과거 투자자 아카이브를 아직 불러오지 못했습니다.");
        const archiveEndDate = activeMode === "archive" ? selectedRange.endDate : getPreviousCompactDate(cutoffTradeDate!);
        archiveRows = await fetchArchiveDetailRange({ manifest: archiveManifest, stockMeta, stockCode: detailTarget.stock_code, startDate: selectedRange.startDate, endDate: archiveEndDate });
        if (activeMode === "archive") return archiveRows;
      }
      if (activeMode !== "archive") {
        const hotStartDate = activeMode === "hot" ? selectedRange.startDate : cutoffTradeDate!;
        const hotEndDate = findTradeDateOnOrBefore(selectedRange.endDate, hotTradeDateValuesDesc);
        if (hotEndDate && hotStartDate <= hotEndDate) hotRows = await fetchInvestorFlowDetail({ stockCode: detailTarget.stock_code, startDate: hotStartDate, endDate: hotEndDate });
        if (activeMode === "hot") return hotRows;
      }
      return mergeDetailRows(archiveRows, hotRows);
    },
  });

  const leaders = leadersQuery.data ?? [];
  const detailRows = detailQuery.data ?? [];
  const isLoading = overviewQuery.isLoading || tradeDatesQuery.isLoading || syncStatusQuery.isLoading || archiveManifestQuery.isLoading || (!!archiveManifest && archiveStockMetaQuery.isLoading);
  const schemaMissing = isSchemaMissing(overviewQuery.error) || isSchemaMissing(tradeDatesQuery.error) || isSchemaMissing(leadersQuery.error) || isSchemaMissing(syncStatusQuery.error);
  const archiveWarning = archiveManifestQuery.error || archiveStockMetaQuery.error;

  if (schemaMissing) return <Card className="border-dashed border-amber-300 bg-amber-50/60 shadow-none"><CardHeader><CardTitle className="text-xl">투자자 집계 함수가 아직 없습니다</CardTitle><CardDescription>Supabase 투자자 마이그레이션이 먼저 적용되어야 합니다.</CardDescription></CardHeader></Card>;
  if (!isLoading && !overallMaxTradeDate) return <Card className="border-dashed shadow-none"><CardHeader><CardTitle className="text-xl">아직 적재된 투자자 데이터가 없습니다</CardTitle><CardDescription>데이터 적재 후 이 화면에서 기간별 누적 순매수 현황을 확인할 수 있습니다.</CardDescription></CardHeader></Card>;

  return (
    <div className="min-h-full space-y-6 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div><h2 className="text-2xl font-semibold tracking-tight">주요 투자자별 누적 순매수</h2></div>
        <Button variant="outline" size="sm" onClick={() => { overviewQuery.refetch(); tradeDatesQuery.refetch(); syncStatusQuery.refetch(); leadersQuery.refetch(); }} disabled={leadersQuery.isFetching}><RefreshCw className={cn("mr-2 h-4 w-4", leadersQuery.isFetching && "animate-spin")} />데이터 새로고침</Button>
      </div>

      {archiveWarning ? <Card className="border-dashed border-amber-300 bg-amber-50/50 shadow-none"><CardContent className="flex items-start gap-3 p-4 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" /><div><p className="font-medium text-foreground">과거 아카이브를 아직 읽지 못했습니다</p><p className="text-xs text-muted-foreground">최근 구간은 계속 조회되지만 오래된 기준일은 비어 보일 수 있습니다.</p></div></CardContent></Card> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard title="데이터 범위" value={overallMinTradeDate && overallMaxTradeDate ? formatTradeDate(overallMinTradeDate) + " ~ " + formatTradeDate(overallMaxTradeDate) : "데이터 없음"} note={getRangeModeLabel(rangeMode)} icon={<Database className="h-4 w-4" />} />
        <SummaryCard title="현재 조회" value={selectedRange ? formatTradeDate(selectedRange.startDate) + " ~ " + formatTradeDate(selectedRange.endDate) : "기간 선택"} note={MARKET_OPTIONS.find((option) => option.value === market)?.label ?? market} icon={<CalendarDays className="h-4 w-4" />} />
        <SummaryCard title="최근 Supabase 적재" value={formatDateTime(syncStatusQuery.data?.last_success_at)} note={hotLatestTradeDate ? "최근 거래일 " + formatTradeDate(hotLatestTradeDate) : "최근 구간 적재 필요"} icon={<Users className="h-4 w-4" />} />
      </div>

      <Card className="shadow-none">
        <CardHeader className="pb-4"><CardTitle className="text-lg">결과 필터</CardTitle><CardDescription>기간을 직접 고르면 최근 데이터와 과거 아카이브가 자동으로 이어서 합산됩니다.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DateField label="시작일" value={selectedStartDate} onSelect={(date) => { const compact = compactDateFromDate(date); if (compact) setSelectedStartDate(clampCompactDate(compact, overallMinTradeDate, selectedEndDate || overallMaxTradeDate)); }} minDate={dateFromCompact(overallMinTradeDate)} maxDate={dateFromCompact(overallMaxTradeDate)} />
          <DateField label="종료일" value={selectedEndDate} onSelect={(date) => { const compact = compactDateFromDate(date); if (compact) setSelectedEndDate(clampCompactDate(compact, selectedStartDate || overallMinTradeDate, overallMaxTradeDate)); }} minDate={dateFromCompact(overallMinTradeDate)} maxDate={dateFromCompact(overallMaxTradeDate)} />
          <Field label="시장"><Select value={market} onValueChange={(value) => setMarket(value as MarketType)}><SelectTrigger className="h-10"><SelectValue /></SelectTrigger><SelectContent>{MARKET_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="표시 종목 수"><Select value={String(topN)} onValueChange={(value) => setTopN(Number(value))}><SelectTrigger className="h-10"><SelectValue /></SelectTrigger><SelectContent>{TOP_N_OPTIONS.map((option) => <SelectItem key={option} value={String(option)}>상위 {option}개</SelectItem>)}</SelectContent></Select></Field>
        </CardContent>
      </Card>
      <Card className="shadow-none">
        <CardContent className="pt-6">
          {leadersQuery.isLoading ? <div className="space-y-3">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-12 w-full rounded-xl" />)}</div> : leadersQuery.error ? <div className="rounded-2xl border border-dashed py-12 text-center text-sm text-muted-foreground">{getErrorMessage(leadersQuery.error)}</div> : leaders.length === 0 ? <div className="rounded-2xl border border-dashed py-12 text-center text-sm text-muted-foreground">선택한 조건에 맞는 종목이 없습니다.</div> : <div className="overflow-x-auto rounded-2xl border"><Table><TableHeader><TableRow><TableHead className="w-16">순위</TableHead><TableHead className="min-w-[220px]">종목</TableHead><TableHead className="w-24">시장</TableHead><TableHead className="w-28 text-right">최근 거래일 종가</TableHead><TableHead className="w-40 text-right"><SortHeader label="개인" active={sortBy === "individual"} direction={direction} onClick={() => sortBy === "individual" ? setDirection(direction === "buy" ? "sell" : "buy") : setSortBy("individual")} /></TableHead><TableHead className="w-40 text-right"><SortHeader label="외국인" active={sortBy === "foreign"} direction={direction} onClick={() => sortBy === "foreign" ? setDirection(direction === "buy" ? "sell" : "buy") : setSortBy("foreign")} /></TableHead><TableHead className="w-40 text-right"><SortHeader label="기관" active={sortBy === "institution"} direction={direction} onClick={() => sortBy === "institution" ? setDirection(direction === "buy" ? "sell" : "buy") : setSortBy("institution")} /></TableHead><TableHead className="w-24 text-right">집계일수</TableHead></TableRow></TableHeader><TableBody>{leaders.map((row, index) => <TableRow key={row.stock_code + "-" + row.latest_trade_date}><TableCell className="font-medium">{index + 1}</TableCell><TableCell><button type="button" onClick={() => setDetailTarget(row)} className="text-left transition-colors hover:text-primary"><p className="font-medium">{row.stock_name || row.stock_code}</p><p className="text-xs text-muted-foreground">{row.stock_code}</p></button></TableCell><TableCell>{row.market || "-"}</TableCell><TableCell className="text-right font-medium">{formatPrice(row.latest_close_price)}</TableCell><TableCell className="text-right"><InvestorValueCell periodValue={row.individual_period_net} dailyValue={row.individual_daily_net} highlight={sortBy === "individual"} /></TableCell><TableCell className="text-right"><InvestorValueCell periodValue={row.foreign_period_net} dailyValue={row.foreign_daily_net} highlight={sortBy === "foreign"} /></TableCell><TableCell className="text-right"><InvestorValueCell periodValue={row.institution_period_net} dailyValue={row.institution_daily_net} highlight={sortBy === "institution"} /></TableCell><TableCell className="text-right">{row.days_count.toLocaleString("ko-KR")}</TableCell></TableRow>)}</TableBody></Table></div>}
        </CardContent>
      </Card>

      <Dialog open={!!detailTarget} onOpenChange={(open) => { if (!open) setDetailTarget(null); }}><DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden p-0"><DialogHeader className="border-b px-6 py-5"><DialogTitle className="text-xl">{detailTarget?.stock_name || detailTarget?.stock_code || "종목 상세"}</DialogTitle><DialogDescription>{selectedRange ? formatTradeDate(selectedRange.startDate) + " ~ " + formatTradeDate(selectedRange.endDate) : "선택한 기간 기준 일자별 상세"}</DialogDescription></DialogHeader><div className="overflow-auto px-6 py-5">{detailQuery.isLoading ? <Skeleton className="h-64 w-full rounded-2xl" /> : detailQuery.error ? <div className="rounded-2xl border border-dashed py-12 text-center text-sm text-muted-foreground">{getErrorMessage(detailQuery.error)}</div> : detailRows.length === 0 ? <div className="rounded-2xl border border-dashed py-12 text-center text-sm text-muted-foreground">상세 데이터가 없습니다.</div> : <div className="overflow-x-auto rounded-2xl border"><Table><TableHeader><TableRow><TableHead className="w-28">날짜</TableHead><TableHead className="w-28 text-right">종가</TableHead><TableHead className="w-32 text-right">개인</TableHead><TableHead className="w-32 text-right">외국인</TableHead><TableHead className="w-32 text-right">기관</TableHead></TableRow></TableHeader><TableBody>{[...detailRows].reverse().map((row) => <TableRow key={row.stock_code + "-" + row.trade_date}><TableCell>{formatTradeDate(row.trade_date)}</TableCell><TableCell className="text-right">{formatPrice(row.close_price)}</TableCell><TableCell className={cn("text-right", getValueTone(row.individual_net))}>{formatSignedEok(row.individual_net)}</TableCell><TableCell className={cn("text-right", getValueTone(row.foreign_net))}>{formatSignedEok(row.foreign_net)}</TableCell><TableCell className={cn("text-right", getValueTone(row.institution_net))}>{formatSignedEok(row.institution_net)}</TableCell></TableRow>)}</TableBody></Table></div>}</div></DialogContent></Dialog>
    </div>
  );
}

function SummaryCard({ title, value, note, icon }: { title: string; value: string; note: string; icon: ReactNode }) {
  return <Card className="shadow-none"><CardContent className="flex items-start justify-between gap-3 p-5"><div><p className="text-sm text-muted-foreground">{title}</p><p className="mt-1 text-lg font-semibold leading-tight">{value}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></div><div className="rounded-2xl bg-muted p-2 text-muted-foreground">{icon}</div></CardContent></Card>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="space-y-2 text-sm"><span className="font-medium text-foreground">{label}</span>{children}</label>;
}

function DateField({ label, value, onSelect, minDate, maxDate }: { label: string; value: string; onSelect: (date?: Date) => void; minDate?: Date; maxDate?: Date; }) {
  return <Field label={label}><Popover><PopoverTrigger asChild><Button variant="outline" className="h-10 w-full justify-start gap-2 text-left text-sm font-normal"><CalendarDays className="h-4 w-4 text-muted-foreground" /><span>{formatCalendarLabel(value)}</span></Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={dateFromCompact(value)} defaultMonth={dateFromCompact(value) ?? maxDate ?? new Date()} onSelect={onSelect} initialFocus disabled={(date) => Boolean((minDate && date < minDate) || (maxDate && date > maxDate))} className="pointer-events-auto p-3" /></PopoverContent></Popover></Field>;
}

function SortHeader({ label, active, direction, onClick }: { label: string; active: boolean; direction: DirectionType; onClick: () => void; }) {
  return <button type="button" onClick={onClick} className={cn("ml-auto flex flex-col items-end rounded-md px-2 py-1 text-right transition-colors hover:bg-muted", active && "text-primary")}><span className="flex items-center gap-1">{label}{active ? (direction === "buy" ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />) : <ArrowDownUp className="h-3.5 w-3.5 text-muted-foreground" />}</span><span className="text-[11px] font-normal text-muted-foreground">누적 / 마지막일</span></button>;
}

function InvestorValueCell({ periodValue, dailyValue, highlight }: { periodValue: number; dailyValue: number; highlight?: boolean; }) {
  return <div className={cn("inline-flex min-w-[120px] flex-col items-end rounded-xl px-2 py-1", highlight && "bg-primary/5")}><span className={cn("font-medium", getValueTone(periodValue))}>{formatSignedEok(periodValue)}</span><span className={cn("text-xs", getValueTone(dailyValue))}>마지막일 {formatSignedEok(dailyValue)}</span></div>;
}




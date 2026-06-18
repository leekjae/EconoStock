import { useEffect, useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  CalendarDays,
  ChartColumnBig,
  Database,
  Info,
  LineChart as LineChartIcon,
  RefreshCw,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type InvestorSyncStatus = Tables<"investor_sync_status">;
type InvestorFlowDailyRow = Tables<"investor_flow_daily">;

type InvestorType = "foreign" | "institution" | "individual";
type DirectionType = "buy" | "sell";
type MarketType = "ALL" | "KOSPI" | "KOSDAQ" | "KONEX";

interface InvestorFlowOverview {
  min_trade_date: string | null;
  max_trade_date: string | null;
  row_count: number;
  stock_count: number;
}

interface InvestorFlowTradeDate {
  trade_date: string;
}

interface InvestorFlowRankedRow {
  days_count: number;
  foreign_daily_net: number;
  foreign_period_net: number;
  individual_daily_net: number;
  individual_period_net: number;
  institution_daily_net: number;
  institution_period_net: number;
  latest_close_price: number;
  latest_trade_date: string;
  market: string;
  sort_period_value: number;
  stock_code: string;
  stock_name: string;
}

interface InvestorTopEquitiesProps {
  initialStartDate?: Date;
  initialEndDate?: Date;
}

const SORT_OPTIONS: Array<{ value: InvestorType; label: string; note: string }> = [
  { value: "foreign", label: "외국인", note: "외국인 누적 수급 기준으로 정렬" },
  { value: "institution", label: "기관", note: "기관 누적 수급 기준으로 정렬" },
  { value: "individual", label: "개인", note: "개인 누적 수급 기준으로 정렬" },
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

function compactDateFromDate(value?: Date) {
  if (!value) {
    return null;
  }

  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}${month}${day}`;
}

function dateFromCompact(value: string | null | undefined) {
  if (!value || !/^\d{8}$/.test(value)) {
    return undefined;
  }

  return new Date(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)));
}

function formatTradeDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  if (!/^\d{8}$/.test(value)) {
    return value;
  }

  return `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}`;
}

function formatCalendarLabel(value: string | null | undefined) {
  const date = dateFromCompact(value);
  return date ? format(date, "yyyy.MM.dd", { locale: ko }) : "날짜 선택";
}

function formatShortTradeDate(value: string | null | undefined) {
  if (!value || !/^\d{8}$/.test(value)) {
    return value ?? "-";
  }

  return `${value.slice(4, 6)}.${value.slice(6, 8)}`;
}

function formatPrice(value: number | null | undefined) {
  if (!value || value <= 0) {
    return "-";
  }

  return Number(value).toLocaleString("ko-KR");
}

function formatSignedEok(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }

  const numeric = Number(value);
  const roundedEok = Math.round(Math.abs(numeric) / 100_000_000);
  const sign = roundedEok === 0 ? "" : numeric > 0 ? "+" : numeric < 0 ? "-" : "";
  return `${sign}${roundedEok.toLocaleString("ko-KR")}억`;
}

function formatAxisEok(value: number) {
  return `${Math.round(value / 100_000_000).toLocaleString("ko-KR")}억`;
}

function getValueTone(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "text-muted-foreground";
  }

  if (value > 0) {
    return "text-up";
  }
  if (value < 0) {
    return "text-down";
  }
  return "text-muted-foreground";
}

function getErrorMessage(error: unknown) {
  if (!error) {
    return "";
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }

  return String(error);
}

function isSchemaMissing(error: unknown) {
  const message = getErrorMessage(error);
  return /investor_flow_daily|get_investor_flow_ranked|get_investor_flow_trade_dates|get_investor_flow_overview|does not exist|could not find the function/i.test(
    message
  );
}

function findTradeDateOnOrBefore(target: string, datesDesc: string[]) {
  for (const tradeDate of datesDesc) {
    if (tradeDate <= target) {
      return tradeDate;
    }
  }

  return datesDesc.at(-1) ?? null;
}

function findTradeDateOnOrAfter(target: string, datesAsc: string[]) {
  for (const tradeDate of datesAsc) {
    if (tradeDate >= target) {
      return tradeDate;
    }
  }

  return datesAsc.at(-1) ?? null;
}

async function fetchInvestorFlowOverview() {
  const { data, error } = await supabase.rpc("get_investor_flow_overview");
  if (error) {
    throw error;
  }

  return ((data as InvestorFlowOverview[] | null)?.[0] ?? null) as InvestorFlowOverview | null;
}

async function fetchInvestorFlowTradeDates(limit = 4000) {
  const { data, error } = await supabase.rpc("get_investor_flow_trade_dates", { p_limit: limit });
  if (error) {
    throw error;
  }

  return (data ?? []) as InvestorFlowTradeDate[];
}

async function fetchInvestorFlowRanked(params: {
  startDate: string;
  endDate: string;
  market: MarketType;
  sortBy: InvestorType;
  direction: DirectionType;
  topN: number;
}) {
  const { data, error } = await supabase.rpc("get_investor_flow_ranked", {
    p_start_date: params.startDate,
    p_end_date: params.endDate,
    p_market: params.market,
    p_sort_by: params.sortBy,
    p_limit: params.topN,
    p_direction: params.direction,
  });
  if (error) {
    throw error;
  }

  return (data ?? []) as InvestorFlowRankedRow[];
}

async function fetchInvestorFlowSyncStatus() {
  const { data, error } = await supabase
    .from("investor_sync_status")
    .select("*")
    .eq("sync_key", "investor_flow_sqlite_import")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as InvestorSyncStatus | null;
}

async function fetchInvestorFlowDetail(params: { stockCode: string; startDate: string; endDate: string }) {
  const { data, error } = await supabase
    .from("investor_flow_daily")
    .select(
      "trade_date, stock_code, stock_name, market, close_price, individual_net, foreign_net, institution_net"
    )
    .eq("stock_code", params.stockCode)
    .gte("trade_date", params.startDate)
    .lte("trade_date", params.endDate)
    .order("trade_date", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as InvestorFlowDailyRow[];
}

export function InvestorTopEquities({ initialStartDate, initialEndDate }: InvestorTopEquitiesProps) {
  const [selectedStartDate, setSelectedStartDate] = useState("");
  const [selectedEndDate, setSelectedEndDate] = useState("");
  const [sortBy, setSortBy] = useState<InvestorType>("foreign");
  const [direction, setDirection] = useState<DirectionType>("buy");
  const [market, setMarket] = useState<MarketType>("ALL");
  const [topN, setTopN] = useState(50);
  const [detailTarget, setDetailTarget] = useState<InvestorFlowRankedRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const preferredStartDate = useMemo(() => compactDateFromDate(initialStartDate), [initialStartDate]);
  const preferredEndDate = useMemo(() => compactDateFromDate(initialEndDate), [initialEndDate]);

  const {
    data: overview,
    error: overviewError,
    isLoading: overviewLoading,
    refetch: refetchOverview,
    isFetching: overviewFetching,
  } = useQuery({
    queryKey: ["investor-flow-overview"],
    queryFn: fetchInvestorFlowOverview,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const {
    data: tradeDates = [],
    error: tradeDatesError,
    isLoading: tradeDatesLoading,
    refetch: refetchTradeDates,
    isFetching: tradeDatesFetching,
  } = useQuery({
    queryKey: ["investor-flow-trade-dates"],
    queryFn: () => fetchInvestorFlowTradeDates(4000),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const {
    data: syncStatus,
    error: syncStatusError,
    isLoading: syncStatusLoading,
    refetch: refetchSyncStatus,
    isFetching: syncStatusFetching,
  } = useQuery({
    queryKey: ["investor-flow-sync-status"],
    queryFn: fetchInvestorFlowSyncStatus,
    staleTime: 60 * 1000,
    retry: false,
  });

  const tradeDateValues = useMemo(() => tradeDates.map((entry) => entry.trade_date), [tradeDates]);
  const tradeDateValuesAsc = useMemo(() => [...tradeDateValues].reverse(), [tradeDateValues]);
  const tradeDateSet = useMemo(() => new Set(tradeDateValues), [tradeDateValues]);
  const minSelectableDate = dateFromCompact(tradeDateValuesAsc[0]);
  const maxSelectableDate = dateFromCompact(tradeDateValues[0]);

  useEffect(() => {
    if (tradeDateValues.length === 0) {
      return;
    }

    if (!selectedEndDate || !tradeDateSet.has(selectedEndDate)) {
      const fallbackEndDate =
        (preferredEndDate ? findTradeDateOnOrBefore(preferredEndDate, tradeDateValues) : null) ?? tradeDateValues[0];
      setSelectedEndDate(fallbackEndDate);
    }
  }, [preferredEndDate, selectedEndDate, tradeDateSet, tradeDateValues]);

  useEffect(() => {
    if (tradeDateValues.length === 0 || !selectedEndDate) {
      return;
    }

    if (selectedStartDate && tradeDateSet.has(selectedStartDate) && selectedStartDate <= selectedEndDate) {
      return;
    }

    const endIndex = tradeDateValues.indexOf(selectedEndDate);
    const fallbackStartDate =
      tradeDateValues[Math.min(tradeDateValues.length - 1, Math.max(endIndex, 0) + DEFAULT_LOOKBACK_DAYS - 1)] ??
      selectedEndDate;
    const preferredStartResolved = preferredStartDate
      ? findTradeDateOnOrAfter(preferredStartDate, tradeDateValuesAsc)
      : null;
    const nextStartDate =
      preferredStartResolved && preferredStartResolved <= selectedEndDate ? preferredStartResolved : fallbackStartDate;

    setSelectedStartDate(nextStartDate);
  }, [preferredStartDate, selectedEndDate, selectedStartDate, tradeDateSet, tradeDateValues, tradeDateValuesAsc]);

  const selectedRange = useMemo(() => {
    if (!selectedStartDate || !selectedEndDate) {
      return null;
    }

    const startIndex = tradeDateValues.indexOf(selectedStartDate);
    const endIndex = tradeDateValues.indexOf(selectedEndDate);
    if (startIndex === -1 || endIndex === -1) {
      return null;
    }

    const newerIndex = Math.min(startIndex, endIndex);
    const olderIndex = Math.max(startIndex, endIndex);
    const startDate = tradeDateValues[olderIndex];
    const endDate = tradeDateValues[newerIndex];

    if (!startDate || !endDate) {
      return null;
    }

    return {
      startDate,
      endDate,
      coveredDays: olderIndex - newerIndex + 1,
    };
  }, [selectedEndDate, selectedStartDate, tradeDateValues]);

  const {
    data: leaders = [],
    error: leadersError,
    isLoading: leadersLoading,
    refetch: refetchLeaders,
    isFetching: leadersFetching,
  } = useQuery({
    queryKey: ["investor-flow-ranked", selectedRange, sortBy, direction, market, topN],
    queryFn: () =>
      fetchInvestorFlowRanked({
        startDate: selectedRange!.startDate,
        endDate: selectedRange!.endDate,
        market,
        sortBy,
        direction,
        topN,
      }),
    enabled: !!selectedRange,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const {
    data: detailRows = [],
    error: detailError,
    isLoading: detailLoading,
  } = useQuery({
    queryKey: ["investor-flow-detail", detailTarget?.stock_code, selectedRange?.startDate, selectedRange?.endDate],
    queryFn: () =>
      fetchInvestorFlowDetail({
        stockCode: detailTarget!.stock_code,
        startDate: selectedRange!.startDate,
        endDate: selectedRange!.endDate,
      }),
    enabled: detailOpen && !!detailTarget && !!selectedRange,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const sortLabel = SORT_OPTIONS.find((option) => option.value === sortBy)?.label ?? sortBy;
  const sortNote = SORT_OPTIONS.find((option) => option.value === sortBy)?.note ?? "";
  const directionLabel = DIRECTION_OPTIONS.find((option) => option.value === direction)?.label ?? direction;
  const marketLabel = MARKET_OPTIONS.find((option) => option.value === market)?.label ?? market;
  const totalSortPeriodNet = useMemo(
    () => leaders.reduce((sum, row) => sum + Number(row.sort_period_value || 0), 0),
    [leaders]
  );
  const detailRowsDesc = useMemo(() => [...detailRows].reverse(), [detailRows]);
  const detailChartData = useMemo(
    () =>
      detailRows.map((row) => ({
        ...row,
        dateLabel: formatShortTradeDate(row.trade_date),
      })),
    [detailRows]
  );
  const isLoading = overviewLoading || tradeDatesLoading || syncStatusLoading;
  const isRefreshing = overviewFetching || tradeDatesFetching || syncStatusFetching || leadersFetching;
  const schemaMissing =
    isSchemaMissing(overviewError) ||
    isSchemaMissing(tradeDatesError) ||
    isSchemaMissing(leadersError) ||
    isSchemaMissing(syncStatusError);

  const handleRefresh = () => {
    refetchOverview();
    refetchTradeDates();
    refetchSyncStatus();
    if (selectedRange) {
      refetchLeaders();
    }
  };

  const handleStartDateChange = (date?: Date) => {
    const compact = compactDateFromDate(date);
    if (!compact) {
      return;
    }

    const resolved = findTradeDateOnOrAfter(compact, tradeDateValuesAsc);
    if (!resolved) {
      return;
    }

    setSelectedStartDate(resolved);
    if (!selectedEndDate || resolved > selectedEndDate) {
      setSelectedEndDate(resolved);
    }
  };

  const handleEndDateChange = (date?: Date) => {
    const compact = compactDateFromDate(date);
    if (!compact) {
      return;
    }

    const resolved = findTradeDateOnOrBefore(compact, tradeDateValues);
    if (!resolved) {
      return;
    }

    setSelectedEndDate(resolved);
    if (!selectedStartDate || resolved < selectedStartDate) {
      setSelectedStartDate(resolved);
    }
  };

  const handleSortColumnClick = (nextSortBy: InvestorType) => {
    if (sortBy === nextSortBy) {
      setDirection((previous) => (previous === "buy" ? "sell" : "buy"));
      return;
    }

    setSortBy(nextSortBy);
  };

  const openDetail = (row: InvestorFlowRankedRow) => {
    setDetailTarget(row);
    setDetailOpen(true);
  };

  if (schemaMissing) {
    return (
      <Card className="border-dashed border-amber-300 bg-amber-50/60 shadow-none">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-amber-500/15 p-3 text-amber-700">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl">투자자 수급 집계 함수가 아직 없습니다</CardTitle>
              <CardDescription>
                이번 화면은 <code className="font-mono">get_investor_flow_ranked</code> 함수를 사용하므로 최신 투자자
                마이그레이션이 한 번 더 필요합니다.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="rounded-2xl bg-background p-4 font-mono text-xs">
            supabase/migrations/20260618000200_add_investor_flow_ranked_function.sql
          </div>
          <div className="rounded-2xl border bg-background p-4 text-sm text-muted-foreground">
            <p>1. Supabase SQL Editor에서 위 파일 내용을 실행합니다.</p>
            <p>2. 웹페이지를 새로고침합니다.</p>
            <p>3. 별도 재적재는 필요 없고, 기존 investor_flow_daily 데이터는 그대로 사용합니다.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!isLoading && tradeDateValues.length === 0) {
    return (
      <Card className="border-dashed shadow-none">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-primary/10 p-3 text-primary">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl">아직 적재된 투자자 수급 데이터가 없습니다</CardTitle>
              <CardDescription>
                현재 화면은 Screening 로컬 DB의 <code className="font-mono">investor_flow</code>를 Supabase로 적재한 뒤
                사용합니다.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div className="rounded-2xl border bg-background p-4">
            <p className="font-medium text-foreground">현재 화면 구성</p>
            <p className="mt-2">기간을 직접 선택하고, 종목별로 개인·외국인·기관 누적/기준일 수급을 한 표에서 함께 봅니다.</p>
            <p className="mt-2">기관 세부 분류는 아직 없고, 현재는 3주체 기준으로 먼저 제공합니다.</p>
          </div>
          <div className="rounded-2xl border bg-background p-4 font-mono text-xs">
            python scripts/import-investor-flow-sqlite.py --db D:\Codex\Screening\data\market_data.sqlite --limit-days 60
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-6 overflow-auto p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">주체별 누적 순매수</h2>
            <p className="text-sm text-muted-foreground">
              기간을 직접 고르고, 종목별로 개인·외국인·기관 수급을 한 표에서 비교합니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {syncStatus?.last_success_at ? (
              <Badge variant="outline">마지막 적재 {new Date(syncStatus.last_success_at).toLocaleString("ko-KR")}</Badge>
            ) : (
              <Badge variant="outline">적재 이력 없음</Badge>
            )}
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
              <RefreshCw className={cn("mr-2 h-4 w-4", isRefreshing && "animate-spin")} />
              데이터 새로고침
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="선택 기간"
            value={selectedRange ? `${formatTradeDate(selectedRange.startDate)} ~ ${formatTradeDate(selectedRange.endDate)}` : "-"}
            note={selectedRange ? `${selectedRange.coveredDays}거래일 집계` : "기간을 계산하는 중입니다."}
            loading={isLoading}
            icon={<CalendarDays className="h-4 w-4" />}
          />
          <MetricCard
            title="정렬 상태"
            value={`${sortLabel} · ${directionLabel}`}
            note={`${marketLabel} · 상위 ${topN}종목`}
            loading={leadersLoading}
            icon={<ArrowDownUp className="h-4 w-4" />}
          />
          <MetricCard
            title="표시 종목 수"
            value={leaders.length.toLocaleString("ko-KR")}
            note={overview ? `보유 데이터 ${overview.row_count.toLocaleString("ko-KR")}행` : "데이터 범위를 확인하는 중입니다."}
            loading={leadersLoading}
            icon={<Users className="h-4 w-4" />}
          />
          <MetricCard
            title="정렬 열 누적 합계"
            value={formatSignedEok(totalSortPeriodNet)}
            note="모든 수급 금액은 억원 단위로 반올림해 표시합니다."
            loading={leadersLoading}
            icon={<TrendingUp className="h-4 w-4" />}
          />
        </div>

        <Card className="shadow-none">
          <CardHeader>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="text-lg">결과 필터</CardTitle>
                <CardDescription>
                  시작일과 기준일을 직접 고르고, 시장과 방향만 먼저 정합니다. 정렬 기준은 표 머리글에서 바꿉니다.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">표에는 누적 수급 / 기준일 수급을 함께 표시</Badge>
                <Badge variant="outline">헤더를 누르면 해당 주체 기준 정렬</Badge>
                <Badge variant="outline">같은 헤더를 다시 누르면 순매수/순매도 전환</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <FilterField label="시작일">
                <TradeDateField
                  value={selectedStartDate}
                  onSelect={handleStartDateChange}
                  minDate={minSelectableDate}
                  maxDate={maxSelectableDate}
                />
              </FilterField>

              <FilterField label="기준일">
                <TradeDateField
                  value={selectedEndDate}
                  onSelect={handleEndDateChange}
                  minDate={minSelectableDate}
                  maxDate={maxSelectableDate}
                />
              </FilterField>

              <FilterField label="방향">
                <Select value={direction} onValueChange={(value) => setDirection(value as DirectionType)}>
                  <SelectTrigger className="h-10 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIRECTION_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>

              <FilterField label="시장">
                <Select value={market} onValueChange={(value) => setMarket(value as MarketType)}>
                  <SelectTrigger className="h-10 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MARKET_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>

              <FilterField label="상위 개수">
                <Select value={String(topN)} onValueChange={(value) => setTopN(Number(value))}>
                  <SelectTrigger className="h-10 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TOP_N_OPTIONS.map((option) => (
                      <SelectItem key={option} value={String(option)}>
                        상위 {option}개
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr),360px]">
              <div className="rounded-2xl border bg-muted/30 p-4 text-sm text-muted-foreground">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-foreground">현재 해석</p>
                  <Badge variant="secondary">{sortLabel}</Badge>
                  <Badge variant="outline">{directionLabel}</Badge>
                </div>
                <p className="mt-2">
                  {selectedRange
                    ? `${formatTradeDate(selectedRange.startDate)}부터 ${formatTradeDate(selectedRange.endDate)}까지 ${selectedRange.coveredDays}거래일 동안의 누적 수급입니다.`
                    : "거래일 범위를 계산하는 중입니다."}
                </p>
                <p className="mt-2">{sortNote}</p>
                <p className="mt-2">표 안의 각 주체 열은 윗줄이 기간 누적, 아랫줄이 기준일 수급이며 모두 억원 단위입니다.</p>
              </div>

              <div className="rounded-2xl border bg-muted/30 p-4 text-sm text-muted-foreground">
                <div className="flex items-start gap-2">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium text-foreground">데이터 기준</p>
                    <p className="mt-2">로컬 Screening DB의 investor_flow를 Supabase로 적재한 값을 사용합니다.</p>
                    <p className="mt-2">현재는 개인·외국인·기관 3주체만 제공하며, 세부 기관 분류는 이후 확장 가능합니다.</p>
                    {overview ? (
                      <p className="mt-2">
                        선택 가능 범위는 {formatTradeDate(overview.min_trade_date)} ~ {formatTradeDate(overview.max_trade_date)}입니다.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="text-lg">종목 목록</CardTitle>
                <CardDescription>
                  {selectedRange
                    ? `${sortLabel} ${directionLabel} 기준 · ${formatTradeDate(selectedRange.endDate)} 기준일`
                    : "필터를 계산하는 중입니다."}
                </CardDescription>
              </div>
              {overview ? (
                <div className="max-w-sm rounded-2xl bg-muted px-3 py-2 text-xs text-muted-foreground">
                  데이터 보유 범위 {formatTradeDate(overview.min_trade_date)} ~ {formatTradeDate(overview.max_trade_date)} · 종목{" "}
                  {overview.stock_count.toLocaleString("ko-KR")}개
                </div>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <CompactSortStatus
              sortLabel={sortLabel}
              directionLabel={directionLabel}
              marketLabel={marketLabel}
              topN={topN}
              periodLabel={
                selectedRange
                  ? `${formatTradeDate(selectedRange.startDate)} ~ ${formatTradeDate(selectedRange.endDate)}`
                  : "-"
              }
            />

            {leadersLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, index) => (
                  <Skeleton key={index} className="h-12 w-full rounded-xl" />
                ))}
              </div>
            ) : leadersError ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <AlertTriangle className="h-8 w-8 text-amber-500" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">투자자 수급 데이터를 불러오지 못했습니다</p>
                  <p className="text-xs text-muted-foreground">{getErrorMessage(leadersError)}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => refetchLeaders()} disabled={leadersFetching}>
                  다시 시도
                </Button>
              </div>
            ) : leaders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                <p className="text-sm font-medium">조건과 일치하는 종목이 없습니다</p>
                <p className="mt-1 text-xs">기간, 시장, 방향을 바꿔 다시 확인해보세요.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">순위</TableHead>
                      <TableHead>종목</TableHead>
                      <TableHead className="w-24">시장</TableHead>
                      <TableHead className="w-28 text-right">기준일 종가</TableHead>
                      <TableHead className="w-36 text-right">
                        <SortColumnHeader
                          label="개인"
                          active={sortBy === "individual"}
                          direction={direction}
                          onClick={() => handleSortColumnClick("individual")}
                        />
                      </TableHead>
                      <TableHead className="w-36 text-right">
                        <SortColumnHeader
                          label="외국인"
                          active={sortBy === "foreign"}
                          direction={direction}
                          onClick={() => handleSortColumnClick("foreign")}
                        />
                      </TableHead>
                      <TableHead className="w-36 text-right">
                        <SortColumnHeader
                          label="기관"
                          active={sortBy === "institution"}
                          direction={direction}
                          onClick={() => handleSortColumnClick("institution")}
                        />
                      </TableHead>
                      <TableHead className="w-20 text-right">집계일수</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leaders.map((row, index) => (
                      <TableRow key={`${row.stock_code}-${row.latest_trade_date}`}>
                        <TableCell className="font-medium">{index + 1}</TableCell>
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => openDetail(row)}
                            className="text-left transition-colors hover:text-primary"
                          >
                            <p className="font-medium">{row.stock_name || row.stock_code}</p>
                            <p className="text-xs text-muted-foreground">{row.stock_code}</p>
                          </button>
                        </TableCell>
                        <TableCell>{row.market || "-"}</TableCell>
                        <TableCell className="text-right font-medium">{formatPrice(row.latest_close_price)}</TableCell>
                        <TableCell className="text-right">
                          <InvestorValueCell
                            periodValue={row.individual_period_net}
                            dailyValue={row.individual_daily_net}
                            highlight={sortBy === "individual"}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <InvestorValueCell
                            periodValue={row.foreign_period_net}
                            dailyValue={row.foreign_daily_net}
                            highlight={sortBy === "foreign"}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <InvestorValueCell
                            periodValue={row.institution_period_net}
                            dailyValue={row.institution_daily_net}
                            highlight={sortBy === "institution"}
                          />
                        </TableCell>
                        <TableCell className="text-right">{row.days_count.toLocaleString("ko-KR")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <InvestorFlowDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        row={detailTarget}
        range={selectedRange}
        detailRows={detailRowsDesc}
        chartRows={detailChartData}
        loading={detailLoading}
        error={detailError}
      />
    </>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-2 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

function MetricCard({
  title,
  value,
  note,
  loading,
  icon,
}: {
  title: string;
  value: string;
  note: string;
  loading: boolean;
  icon: ReactNode;
}) {
  return (
    <Card className="shadow-none">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{title}</p>
            {loading ? <Skeleton className="h-7 w-24" /> : <p className="text-2xl font-semibold">{value}</p>}
            <p className="text-xs text-muted-foreground">{note}</p>
          </div>
          <div className="rounded-2xl bg-muted p-2 text-muted-foreground">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function TradeDateField({
  value,
  onSelect,
  minDate,
  maxDate,
}: {
  value: string;
  onSelect: (date?: Date) => void;
  minDate?: Date;
  maxDate?: Date;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-10 w-full justify-start gap-2 text-left text-sm font-normal">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <span>{formatCalendarLabel(value)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={dateFromCompact(value)}
          defaultMonth={dateFromCompact(value) ?? maxDate ?? new Date()}
          onSelect={onSelect}
          initialFocus
          disabled={(date) => {
            if (minDate && date < minDate) {
              return true;
            }
            if (maxDate && date > maxDate) {
              return true;
            }
            return false;
          }}
          className="pointer-events-auto p-3"
        />
      </PopoverContent>
    </Popover>
  );
}

function CompactSortStatus({
  sortLabel,
  directionLabel,
  marketLabel,
  topN,
  periodLabel,
}: {
  sortLabel: string;
  directionLabel: string;
  marketLabel: string;
  topN: number;
  periodLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border bg-muted/20 px-3 py-2 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">현재 정렬</span>
        <Badge variant="secondary">{sortLabel}</Badge>
        <Badge variant="outline">{directionLabel}</Badge>
        <span>{marketLabel}</span>
        <span>상위 {topN}개</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span>조회 기간 {periodLabel}</span>
        <span>종목명을 누르면 일자별 수급 팝업</span>
      </div>
    </div>
  );
}

function SortColumnHeader({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: DirectionType;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "ml-auto flex flex-col items-end rounded-md px-2 py-1 text-right transition-colors hover:bg-muted",
        active && "text-primary"
      )}
      title={active ? "한 번 더 누르면 순매수/순매도가 전환됩니다." : `${label} 기준으로 정렬`}
    >
      <span className="flex items-center gap-1">
        {label}
        {active ? (
          direction === "buy" ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />
        ) : (
          <ArrowDownUp className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </span>
      <span className="text-[11px] font-normal text-muted-foreground">누적 / 기준일 (억원)</span>
    </button>
  );
}

function InvestorValueCell({
  periodValue,
  dailyValue,
  highlight,
}: {
  periodValue: number;
  dailyValue: number;
  highlight?: boolean;
}) {
  return (
    <div className={cn("inline-flex min-w-[110px] flex-col items-end rounded-xl px-2 py-1", highlight && "bg-primary/5")}>
      <span className={cn("font-medium", getValueTone(periodValue))}>{formatSignedEok(periodValue)}</span>
      <span className={cn("text-xs", getValueTone(dailyValue))}>기준일 {formatSignedEok(dailyValue)}</span>
    </div>
  );
}

function InvestorFlowDetailDialog({
  open,
  onOpenChange,
  row,
  range,
  detailRows,
  chartRows,
  loading,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: InvestorFlowRankedRow | null;
  range: { startDate: string; endDate: string; coveredDays: number } | null;
  detailRows: InvestorFlowDailyRow[];
  chartRows: Array<InvestorFlowDailyRow & { dateLabel: string }>;
  loading: boolean;
  error: unknown;
}) {
  const title = row?.stock_name || row?.stock_code || "종목 상세";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-6xl overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="text-xl">
            {title}
            {row?.stock_code ? <span className="ml-2 text-sm font-normal text-muted-foreground">{row.stock_code}</span> : null}
          </DialogTitle>
          <DialogDescription>
            {range
              ? `${formatTradeDate(range.startDate)} ~ ${formatTradeDate(range.endDate)} · ${range.coveredDays}거래일 기준 상세 수급`
              : "선택 기간을 기준으로 일자별 수급을 표시합니다."}
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-auto px-6 py-5">
          {!row ? null : (
            <div className="space-y-5">
              <CompactDetailSummary row={row} />

              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-64 w-full rounded-2xl" />
                  <Skeleton className="h-64 w-full rounded-2xl" />
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed py-16 text-center">
                  <AlertTriangle className="h-8 w-8 text-amber-500" />
                  <div>
                    <p className="text-sm font-medium">일자별 수급 데이터를 불러오지 못했습니다</p>
                    <p className="mt-1 text-xs text-muted-foreground">{getErrorMessage(error)}</p>
                  </div>
                </div>
              ) : detailRows.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed py-16 text-center text-muted-foreground">
                  <p className="text-sm font-medium">표시할 일자별 수급 데이터가 없습니다</p>
                  <p className="text-xs">선택 기간을 바꾼 뒤 다시 확인해보세요.</p>
                </div>
              ) : (
                <>
                  <div className="grid gap-4 xl:grid-cols-2">
                    <Card className="shadow-none">
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <LineChartIcon className="h-4 w-4" />
                          종가 흐름
                        </CardTitle>
                        <CardDescription>선택 기간 기준일 종가 추이</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartRows} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis dataKey="dateLabel" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                              <YAxis
                                tick={{ fontSize: 11 }}
                                stroke="hsl(var(--muted-foreground))"
                                tickFormatter={(value) => Number(value).toLocaleString("ko-KR")}
                              />
                              <Tooltip
                                formatter={(value: number) => [Number(value).toLocaleString("ko-KR"), "종가"]}
                                labelFormatter={(_, payload) =>
                                  payload?.[0]?.payload?.trade_date
                                    ? formatTradeDate(String(payload[0].payload.trade_date))
                                    : ""
                                }
                              />
                              <Line type="monotone" dataKey="close_price" stroke="#2563eb" strokeWidth={2} dot={false} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="shadow-none">
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <ChartColumnBig className="h-4 w-4" />
                          일자별 수급
                        </CardTitle>
                        <CardDescription>개인, 외국인, 기관의 기준일별 수급</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartRows} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis dataKey="dateLabel" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                              <YAxis
                                tick={{ fontSize: 11 }}
                                stroke="hsl(var(--muted-foreground))"
                                tickFormatter={formatAxisEok}
                              />
                              <Tooltip
                                formatter={(value: number, name: string) => [formatSignedEok(value), name]}
                                labelFormatter={(_, payload) =>
                                  payload?.[0]?.payload?.trade_date
                                    ? formatTradeDate(String(payload[0].payload.trade_date))
                                    : ""
                                }
                              />
                              <Legend />
                              <Bar dataKey="individual_net" name="개인" fill="#ef4444" radius={[4, 4, 0, 0]} />
                              <Bar dataKey="foreign_net" name="외국인" fill="#2563eb" radius={[4, 4, 0, 0]} />
                              <Bar dataKey="institution_net" name="기관" fill="#10b981" radius={[4, 4, 0, 0]} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <Card className="shadow-none">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">일자별 상세</CardTitle>
                      <CardDescription>최신일이 위에 오도록 정렬했습니다.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="max-h-[320px] overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-28">날짜</TableHead>
                              <TableHead className="w-28 text-right">종가</TableHead>
                              <TableHead className="w-32 text-right">개인</TableHead>
                              <TableHead className="w-32 text-right">외국인</TableHead>
                              <TableHead className="w-32 text-right">기관</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {detailRows.map((detailRow) => (
                              <TableRow key={`${detailRow.stock_code}-${detailRow.trade_date}`}>
                                <TableCell>{formatTradeDate(detailRow.trade_date)}</TableCell>
                                <TableCell className="text-right">{formatPrice(detailRow.close_price)}</TableCell>
                                <TableCell className={cn("text-right", getValueTone(detailRow.individual_net))}>
                                  {formatSignedEok(detailRow.individual_net)}
                                </TableCell>
                                <TableCell className={cn("text-right", getValueTone(detailRow.foreign_net))}>
                                  {formatSignedEok(detailRow.foreign_net)}
                                </TableCell>
                                <TableCell className={cn("text-right", getValueTone(detailRow.institution_net))}>
                                  {formatSignedEok(detailRow.institution_net)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CompactDetailSummary({ row }: { row: InvestorFlowRankedRow }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <DetailSummaryCard title="기준일 종가" value={formatPrice(row.latest_close_price)} note={row.market || "-"} />
      <DetailSummaryCard title="개인 누적" value={formatSignedEok(row.individual_period_net)} note={`기준일 ${formatSignedEok(row.individual_daily_net)}`} />
      <DetailSummaryCard title="외국인 누적" value={formatSignedEok(row.foreign_period_net)} note={`기준일 ${formatSignedEok(row.foreign_daily_net)}`} />
      <DetailSummaryCard title="기관 누적" value={formatSignedEok(row.institution_period_net)} note={`기준일 ${formatSignedEok(row.institution_daily_net)}`} />
    </div>
  );
}

function DetailSummaryCard({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl border bg-muted/20 p-4">
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

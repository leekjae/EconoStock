import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BookOpenText,
  CircleHelp,
  Database,
  RefreshCw,
  Search,
  TrendingUp,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import {
  useScreeningPerformance,
  type ScreeningPerformancePoint,
  type ScreeningPerformanceRow,
} from "@/components/screening/useScreeningPerformance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ScreeningRun = Tables<"screening_runs">;
type ScreeningCandidate = Tables<"screening_candidates">;
type ScreeningPriceDate = Tables<"screening_price_dates">;
type ScreeningSyncStatus = Tables<"screening_sync_status">;

const SIGNAL_ORDER = ["strategy_a", "strategy_b", "cash", "overlap", "spike", "rebound"] as const;
const PRICE_CHART_DAYS = 10;

const SELECTION_GUIDE = [
  {
    key: "strategy_a",
    title: "전략A 후보",
    summary: "매우 약한 장세에서 공포성 하락 뒤 단기 반등을 노리는 메인 평균회귀 전략입니다.",
    horizon: "다음 거래일 시가 검토 기준, 기대 구간은 1~5거래일입니다.",
  },
  {
    key: "strategy_b",
    title: "전략B 후보",
    summary: "조정을 받은 종목의 기술적 반등을 노리는 메인 평균회귀 전략입니다.",
    horizon: "다음 거래일 시가 검토 기준, 기대 구간은 1~5거래일입니다.",
  },
  {
    key: "cash",
    title: "관망(cash)",
    summary: "그날은 메인 진입보다 관망이 우선이라는 뜻입니다.",
    horizon: "메인 진입은 없고, 필요하면 보조 감시 목록만 함께 봅니다.",
  },
  {
    key: "overlap",
    title: "감시(overlap) 후보",
    summary: "룰 기반 점수와 ML 점수가 동시에 좋은 종목만 모은 보조 감시 목록입니다.",
    horizon: "메인 진입 목록은 아니며, 우선 확인할 강세 감시 목록에 가깝습니다.",
  },
  {
    key: "spike",
    title: "단기급등(spike) 후보",
    summary: "급팽창 이후 단기 연속성이 붙을 수 있는 빠른 이벤트형 후보입니다.",
    horizon: "빠른 이벤트 구간은 1~2거래일입니다.",
  },
  {
    key: "rebound",
    title: "눌림반등(rebound) 후보",
    summary: "강한 추세 종목의 눌림목 이후 되돌림을 노리는 지연형 반등 후보입니다.",
    horizon: "지연 반등 구간은 3~5거래일입니다.",
  },
];

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
  return /screening_runs|screening_candidates|screening_sync_status|screening_price_daily|does not exist|could not find the table/i.test(
    message
  );
}

function isPriceDateTableMissing(error: unknown) {
  const message = getErrorMessage(error);
  return /screening_price_dates|does not exist|could not find the table/i.test(message);
}

function normalizeSignalKey(value: string) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.includes("strategy_a")) return "strategy_a";
  if (normalized.includes("strategy_b")) return "strategy_b";
  if (normalized.includes("overlap")) return "overlap";
  if (normalized.includes("spike")) return "spike";
  if (normalized.includes("rebound")) return "rebound";
  if (normalized.includes("cash")) return "cash";
  return normalized;
}

function getSignalGuide(signal: string) {
  const key = normalizeSignalKey(signal);
  return SELECTION_GUIDE.find((entry) => entry.key === key) || null;
}

function getSignalLabel(signal: string) {
  const guide = getSignalGuide(signal);
  return guide?.title || signal || "-";
}

function getSignalOrder(signal: string) {
  const key = normalizeSignalKey(signal);
  const index = SIGNAL_ORDER.indexOf(key as (typeof SIGNAL_ORDER)[number]);
  return index === -1 ? SIGNAL_ORDER.length : index;
}

async function fetchScreeningRuns() {
  const { data, error } = await supabase
    .from("screening_runs")
    .select("*")
    .order("as_of_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(48);

  if (error) {
    throw error;
  }

  return data ?? [];
}

async function fetchScreeningCandidates(runKeys: string[]) {
  if (runKeys.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("screening_candidates")
    .select("*")
    .in("run_key", runKeys)
    .order("rank_no", { ascending: true })
    .order("score", { ascending: false });

  if (error) {
    throw error;
  }

  return data ?? [];
}

async function fetchScreeningSyncStatus() {
  const { data, error } = await supabase
    .from("screening_sync_status")
    .select("*")
    .eq("sync_key", "manual_import_screening")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function fetchScreeningPriceDates() {
  const pageSize = 1000;
  const rows: ScreeningPriceDate[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("screening_price_dates")
      .select("*")
      .order("trade_date", { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      throw error;
    }

    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < pageSize) {
      break;
    }
  }

  return rows;
}

function formatDateLabel(ymd: string | null | undefined) {
  if (!ymd) {
    return "-";
  }

  if (!/^\d{8}$/.test(ymd)) {
    return ymd;
  }

  return `${ymd.slice(0, 4)}.${ymd.slice(4, 6)}.${ymd.slice(6, 8)}`;
}

function formatDateIso(ymd: string | null | undefined) {
  if (!ymd) {
    return "-";
  }

  if (!/^\d{8}$/.test(ymd)) {
    return ymd;
  }

  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function formatShortDateLabel(ymd: string | null | undefined) {
  if (!ymd) {
    return "-";
  }

  if (!/^\d{8}$/.test(ymd)) {
    return ymd;
  }

  return `${ymd.slice(4, 6)}.${ymd.slice(6, 8)}`;
}

function formatCompactPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }

  const numeric = Number(value);
  const decimals = Math.abs(numeric) >= 10 ? 0 : 1;
  const signed = numeric > 0 ? `+${numeric.toFixed(decimals)}` : numeric.toFixed(decimals);
  return `${signed}%`;
}


function formatResultLabel(run: ScreeningRun | null | undefined) {
  if (!run) {
    return "-";
  }

  const guide = getSignalGuide(run.strategy_key);
  if (guide) {
    return guide.title;
  }

  return run.run_label || getSignalLabel(run.strategy_key);
}

function formatNumber(value: number) {
  return Number(value || 0).toLocaleString("ko-KR");
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }

  const numeric = Number(value);
  const signed = numeric > 0 ? `+${numeric.toFixed(2)}` : numeric.toFixed(2);
  return `${signed}%`;
}

function formatPrice(value: number | null | undefined) {
  if (value === null || value === undefined || value <= 0) {
    return "-";
  }

  return formatNumber(value);
}

function getStatusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  const normalized = status.toLowerCase();
  if (normalized.includes("fail") || normalized.includes("error")) return "destructive";
  if (normalized.includes("done") || normalized.includes("complete")) return "default";
  if (normalized.includes("run") || normalized.includes("progress")) return "secondary";
  return "outline";
}

function getPerformanceStateLabel(candidate: ScreeningPerformanceRow) {
  if (candidate.performanceStatus === "ready") return null;
  if (candidate.performanceStatus === "awaiting_entry") return "다음 시가 대기";
  if (candidate.performanceStatus === "entry_missing") return "진입 시가 없음";
  if (candidate.performanceStatus === "latest_missing") return "최근 거래일 종가 없음";
  return "가격 없음";
}

function getCandidateSignalKey(
  candidate: Pick<ScreeningCandidate, "signal" | "run_key">,
  runByKey: Map<string, ScreeningRun>,
) {
  return normalizeSignalKey(candidate.signal || runByKey.get(candidate.run_key)?.strategy_key || "");
}

function sortPerformanceRows(rows: ScreeningPerformanceRow[], runByKey: Map<string, ScreeningRun>) {
  return [...rows].sort((left, right) => {
    const leftSignal = getCandidateSignalKey(left, runByKey);
    const rightSignal = getCandidateSignalKey(right, runByKey);

    const signalCompare = getSignalOrder(leftSignal) - getSignalOrder(rightSignal);
    if (signalCompare !== 0) {
      return signalCompare;
    }

    const leftRank = Number(left.rank_no || Number.MAX_SAFE_INTEGER);
    const rightRank = Number(right.rank_no || Number.MAX_SAFE_INTEGER);
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.stock_name.localeCompare(right.stock_name, "ko-KR");
  });
}

export function ScreeningMonitor() {
  const [searchText, setSearchText] = useState("");
  const [runDateFilter, setRunDateFilter] = useState("");
  const [runSignalFilter, setRunSignalFilter] = useState("all");
  const deferredSearch = useDeferredValue(searchText);

  const {
    data: runs = [],
    error: runsError,
    isLoading: runsLoading,
    refetch: refetchRuns,
    isFetching: runsFetching,
  } = useQuery({
    queryKey: ["screening-runs"],
    queryFn: fetchScreeningRuns,
    staleTime: 60 * 1000,
    retry: false,
  });

  const {
    data: syncStatus,
    error: syncError,
    isLoading: syncLoading,
    refetch: refetchSync,
    isFetching: syncFetching,
  } = useQuery<ScreeningSyncStatus | null>({
    queryKey: ["screening-sync-status"],
    queryFn: fetchScreeningSyncStatus,
    staleTime: 60 * 1000,
    retry: false,
  });

  const {
    data: priceDates = [],
    error: priceDatesError,
    isLoading: priceDatesLoading,
    refetch: refetchPriceDates,
    isFetching: priceDatesFetching,
  } = useQuery<ScreeningPriceDate[]>({
    queryKey: ["screening-price-dates"],
    queryFn: fetchScreeningPriceDates,
    staleTime: 60 * 1000,
    retry: false,
  });

  const orderedRuns = useMemo(() => {
    return [...runs].sort((left, right) => {
      const dateCompare = right.as_of_date.localeCompare(left.as_of_date);
      if (dateCompare !== 0) {
        return dateCompare;
      }

      const signalCompare = getSignalOrder(left.strategy_key) - getSignalOrder(right.strategy_key);
      if (signalCompare !== 0) {
        return signalCompare;
      }

      const createdAtCompare = String(right.created_at || "").localeCompare(String(left.created_at || ""));
      if (createdAtCompare !== 0) {
        return createdAtCompare;
      }

      return String(left.run_label || "").localeCompare(String(right.run_label || ""), "ko-KR");
    });
  }, [runs]);

  const priceDateOptions = useMemo(() => {
    if (isPriceDateTableMissing(priceDatesError)) {
      return [] as string[];
    }

    return Array.from(new Set(priceDates.map((row) => row.trade_date).filter(Boolean))).sort((left, right) => right.localeCompare(left));
  }, [priceDates, priceDatesError]);

  const runDateOptions = useMemo(() => {
    const runDates = orderedRuns.map((run) => run.as_of_date);
    return Array.from(new Set([...runDates, ...priceDateOptions])).sort((left, right) => right.localeCompare(left));
  }, [orderedRuns, priceDateOptions]);

  const runsForSelectedDate = useMemo(() => {
    return orderedRuns.filter((run) => !runDateFilter || run.as_of_date === runDateFilter);
  }, [orderedRuns, runDateFilter]);

  const runSignalOptions = useMemo(() => {
    const values = Array.from(new Set(runsForSelectedDate.map((run) => normalizeSignalKey(run.strategy_key)).filter(Boolean)));
    return values.sort((left, right) => getSignalOrder(left) - getSignalOrder(right));
  }, [runsForSelectedDate]);

  useEffect(() => {
    if (!runDateFilter && runDateOptions.length > 0) {
      setRunDateFilter(runDateOptions[0]);
    }
  }, [runDateFilter, runDateOptions]);

  useEffect(() => {
    if (runSignalFilter !== "all" && !runSignalOptions.includes(runSignalFilter)) {
      setRunSignalFilter("all");
    }
  }, [runSignalFilter, runSignalOptions]);

  const filteredRuns = useMemo(() => {
    return runsForSelectedDate.filter((run) => {
      const matchesSignal = runSignalFilter === "all" || normalizeSignalKey(run.strategy_key) === runSignalFilter;
      return matchesSignal;
    });
  }, [runSignalFilter, runsForSelectedDate]);

  const selectedDateRunKeys = useMemo(() => runsForSelectedDate.map((run) => run.run_key), [runsForSelectedDate]);
  const referenceRun = runsForSelectedDate[0] ?? null;
  const selectedSignalRun = filteredRuns[0] ?? null;
  const runByKey = useMemo(() => new Map(runsForSelectedDate.map((run) => [run.run_key, run] as const)), [runsForSelectedDate]);
  const selectedSignalLabel = runSignalFilter === "all" ? "전체" : getSignalLabel(runSignalFilter);

  const {
    data: candidates = [],
    error: candidatesError,
    isLoading: candidatesLoading,
    refetch: refetchCandidates,
    isFetching: candidatesFetching,
  } = useQuery<ScreeningCandidate[]>({
    queryKey: ["screening-candidates", selectedDateRunKeys.join(",")],
    queryFn: () => fetchScreeningCandidates(selectedDateRunKeys),
    enabled: selectedDateRunKeys.length > 0,
    staleTime: 60 * 1000,
    retry: false,
  });

  const performance = useScreeningPerformance(referenceRun, candidates);

  const displayRows = useMemo(() => {
    const rows =
      runSignalFilter === "all"
        ? performance.rows
        : performance.rows.filter((candidate) => getCandidateSignalKey(candidate, runByKey) === runSignalFilter);

    return sortPerformanceRows(rows, runByKey);
  }, [performance.rows, runByKey, runSignalFilter]);

  const filteredCandidates = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();

    return displayRows.filter((candidate) => {
      const matchesQuery =
        !query ||
        candidate.stock_name.toLowerCase().includes(query) ||
        candidate.stock_code.toLowerCase().includes(query) ||
        (candidate.reason_summary || "").toLowerCase().includes(query) ||
        (candidate.tags || "").toLowerCase().includes(query);

      return matchesQuery;
    });
  }, [deferredSearch, displayRows]);

  const screeningStats = useMemo(() => {
    const readyRows = displayRows.filter((row) => row.returnPct !== null);
    const latestReferenceDate =
      readyRows
        .map((row) => row.latestTradeDate)
        .filter((date): date is string => Boolean(date))
        .sort((left, right) => right.localeCompare(left))[0] ?? performance.latestAvailableTradeDate ?? null;
    const bestCandidate =
      readyRows.length === 0
        ? null
        : readyRows.reduce<ScreeningPerformanceRow | null>((best, row) => {
            if (row.maxReturnPct === null) {
              return best;
            }
            if (!best || Number(row.maxReturnPct) > Number(best.maxReturnPct ?? Number.NEGATIVE_INFINITY)) {
              return row;
            }
            return best;
          }, null);
    const worstCandidate =
      readyRows.length === 0
        ? null
        : readyRows.reduce<ScreeningPerformanceRow | null>((worst, row) => {
            if (row.maxDrawdownPct === null) {
              return worst;
            }
            if (!worst || Number(row.maxDrawdownPct) < Number(worst.maxDrawdownPct ?? Number.POSITIVE_INFINITY)) {
              return row;
            }
            return worst;
          }, null);

    return {
      candidateCount: displayRows.length,
      monitoredCount: readyRows.length,
      averageReturn:
        readyRows.length === 0
          ? null
          : readyRows.reduce((sum, row) => sum + Number(row.returnPct || 0), 0) / readyRows.length,
      latestReferenceDate,
      bestCandidate,
      worstCandidate,
    };
  }, [displayRows, performance.latestAvailableTradeDate]);

  const signalSummaries = useMemo(() => {
    return SIGNAL_ORDER.map((signal) => {
      const signalRows = performance.rows.filter((candidate) => getCandidateSignalKey(candidate, runByKey) === signal);
      const readyRows = signalRows.filter((row) => row.returnPct !== null);

      return {
        signal,
        label: getSignalLabel(signal),
        candidateCount: signalRows.length,
        monitoredCount: readyRows.length,
        averageReturn:
          readyRows.length === 0
            ? null
            : readyRows.reduce((sum, row) => sum + Number(row.returnPct || 0), 0) / readyRows.length,
      };
    });
  }, [performance.rows, runByKey]);

  const schemaMissing = isSchemaMissing(runsError) || isSchemaMissing(candidatesError) || isSchemaMissing(syncError);
  const isLoading = runsLoading || syncLoading || priceDatesLoading;
  const isRefreshing =
    runsFetching || syncFetching || priceDatesFetching || candidatesFetching || performance.isFetching || performance.isLatestDateFetching;
  const selectedRunGuide = runSignalFilter === "all" ? null : getSignalGuide(runSignalFilter);
  const selectedDateHasScreening = runsForSelectedDate.length > 0;
  const selectedDateHasPrice = runDateFilter ? priceDateOptions.includes(runDateFilter) : false;
  const selectedRunTiming = runDateFilter
    ? `${formatDateIso(runDateFilter)} 결과는 해당 거래일 종가 기준으로 생성되며, 실무적으로는 다음 거래일 시가 기준 검토 리스트로 해석합니다.`
    : "스크리닝 결과는 장 종료 후 생성되고, 다음 거래일 시가 기준으로 성과를 추적합니다.";

  const handleRefresh = () => {
    refetchRuns();
    refetchSync();
    refetchPriceDates();
    if (selectedDateRunKeys.length > 0) {
      refetchCandidates();
    }
    void performance.refetch();
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
              <CardTitle className="text-xl">스크리닝 테이블이 아직 없습니다</CardTitle>
              <CardDescription>
                대시보드를 열기 전에 `screening_runs`, `screening_candidates`, `screening_sync_status`,
                `screening_price_daily` 테이블이 먼저 만들어져 있어야 합니다.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="rounded-2xl bg-background p-4 font-mono text-xs">
            supabase/migrations/20260617000100_add_screening_monitor_tables.sql
          </div>
          <div className="rounded-2xl border bg-background p-4 text-sm text-muted-foreground">
            <p>1. Supabase SQL Editor에서 스크리닝 마이그레이션을 먼저 적용합니다.</p>
            <p>2. 별도 운영 파이프라인에서 스크리닝 결과와 가격 데이터를 먼저 적재합니다.</p>
            <p>3. 적재 대상 테이블과 함수가 모두 준비됐는지 확인합니다.</p>
            <p>4. 적재가 끝나면 페이지를 새로고침합니다.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!isLoading && runs.length === 0) {
    return (
      <Card className="border-dashed shadow-none">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-primary/10 p-3 text-primary">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl">아직 적재된 스크리닝 결과가 없습니다</CardTitle>
              <CardDescription>
                별도 운영 파이프라인에서 스크리닝 결과를 적재하면, 대시보드에서 다음 거래일 시가 기준 성과를 추적할 수 있습니다.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border bg-background p-4">
            <p className="text-sm font-medium">데이터 준비 조건</p>
            <p className="mt-2 text-sm text-muted-foreground">
              1. 기준일별 스크리닝 결과가 <code className="font-mono">screening_runs</code> 와{" "}
              <code className="font-mono">screening_candidates</code>에 적재되어 있어야 합니다.
            </p>
            <p className="text-sm text-muted-foreground">
              2. 성과표를 위해 <code className="font-mono">screening_price_daily</code> 가격 테이블도 함께 준비되어야 합니다.
            </p>
            <p className="text-sm text-muted-foreground">
              3. 이 공개 웹 레포에는 운영용 로컬 경로와 서비스 키를 두지 않는 구성을 권장합니다.
            </p>
          </div>
          <div className="rounded-2xl border bg-background p-4">
            <p className="text-sm font-medium">운영 분리 권장</p>
            <div className="mt-2 space-y-2 text-sm text-muted-foreground">
              <p>운영 스크립트, 백필 배치, 로컬 SQLite 연동 코드는 별도 비공개 저장소에서 관리하는 편이 안전합니다.</p>
              <p>이 공개 웹 레포는 화면 코드, 배포 설정, 브라우저용 환경변수만 유지하는 구조가 가장 단순합니다.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">스크리닝 성과</h2>
          <p className="text-sm text-muted-foreground">
            각 스크리닝 결과를 다음 거래일 시가부터 최근 거래일 종가까지 기준으로 추적합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {syncStatus?.last_success_at ? (
            <Badge variant="outline">마지막 적재 {new Date(syncStatus.last_success_at).toLocaleString("ko-KR")}</Badge>
          ) : (
            <Badge variant="outline">적재 이력 없음</Badge>
          )}
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            데이터 새로고침
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="기준일"
          value={runDateFilter ? formatDateLabel(runDateFilter) : "-"}
          note={
            selectedDateHasScreening
              ? `${selectedSignalLabel} 라벨`
              : selectedDateHasPrice
                ? "스크리닝 미실행일"
                : "선택된 결과 없음"
          }
          loading={isLoading}
          icon={<Activity className="h-4 w-4" />}
        />
        <MetricCard
          title="후보 종목 수"
          value={formatNumber(screeningStats.candidateCount)}
          note={
            selectedDateHasScreening
              ? `조건에 맞는 run ${formatNumber(filteredRuns.length)}개`
              : selectedDateHasPrice
                ? "이 날짜에는 후보 종목이 생성되지 않았습니다"
                : "최신 결과 불러오는 중"
          }
          loading={candidatesLoading}
          icon={<Database className="h-4 w-4" />}
        />
        <MetricCard
          title="평균 수익률"
          value={screeningStats.averageReturn !== null ? formatPercent(screeningStats.averageReturn) : "-"}
          note={
            !selectedDateHasScreening && selectedDateHasPrice
              ? "스크리닝 미실행일이라 성과 계산 대상이 없습니다"
              : screeningStats.monitoredCount > 0
                ? `${formatNumber(screeningStats.monitoredCount)}개 종목이 성과 계산에 반영되었습니다`
              : "아직 성과 계산에 반영된 가격이 없습니다"
          }
          loading={performance.isLoading}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <MetricCard
          title="최근 반영 거래일"
          value={formatDateLabel(screeningStats.latestReferenceDate || performance.latestAvailableTradeDate)}
          note={
            screeningStats.monitoredCount > 0
              ? `${formatNumber(screeningStats.monitoredCount)}개 종목의 최근 종가가 반영되었습니다`
              : "최근 종가가 아직 성과표에 반영되지 않았습니다"
          }
          loading={performance.isLoading}
          icon={<BookOpenText className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr),minmax(320px,1fr)]">
        <Card className="shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">라벨별 요약</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {signalSummaries.map((summary) => (
                <LabelSummaryCard
                  key={summary.signal}
                  title={summary.label}
                  value={summary.candidateCount > 0 ? `후보 ${formatNumber(summary.candidateCount)}개` : "후보 없음"}
                  note={
                    summary.candidateCount === 0
                      ? "수익률 없음"
                      : summary.averageReturn !== null
                        ? formatPercent(summary.averageReturn)
                        : "성과 반영 대기"
                  }
                  noteTone={
                    summary.averageReturn === null
                      ? "muted"
                      : summary.averageReturn > 0
                        ? "up"
                        : summary.averageReturn < 0
                          ? "down"
                          : "neutral"
                  }
                  active={runSignalFilter === summary.signal}
                  loading={candidatesLoading || performance.isLoading}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">최고/최저 수익률</CardTitle>
          </CardHeader>
          <CardContent className="grid flex-1 gap-2 min-h-0 md:grid-cols-2 xl:grid-cols-1 xl:grid-rows-2">
            <ExtremeMetricCard
              title="최고가 수익률"
              value={
                screeningStats.bestCandidate?.maxReturnPct !== null && screeningStats.bestCandidate?.maxReturnPct !== undefined
                  ? formatPercent(screeningStats.bestCandidate.maxReturnPct)
                  : "-"
              }
              note={
                screeningStats.bestCandidate
                  ? `${getSignalLabel(getCandidateSignalKey(screeningStats.bestCandidate, runByKey))} · ${screeningStats.bestCandidate.stock_name}`
                  : "아직 최고가 수익률을 계산할 종목이 없습니다"
              }
              tone="up"
              loading={performance.isLoading}
              icon={<ArrowUpRight className="h-4 w-4" />}
            />
            <ExtremeMetricCard
              title="최저가 수익률"
              value={
                screeningStats.worstCandidate?.maxDrawdownPct !== null && screeningStats.worstCandidate?.maxDrawdownPct !== undefined
                  ? formatPercent(screeningStats.worstCandidate.maxDrawdownPct)
                  : "-"
              }
              note={
                screeningStats.worstCandidate
                  ? `${getSignalLabel(getCandidateSignalKey(screeningStats.worstCandidate, runByKey))} · ${screeningStats.worstCandidate.stock_name}`
                  : "아직 최저가 수익률을 계산할 종목이 없습니다"
              }
              tone="down"
              loading={performance.isLoading}
              icon={<ArrowDownRight className="h-4 w-4" />}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="text-lg">결과 필터</CardTitle>
              <CardDescription>
                기준일을 먼저 고르고, 스크리닝이 실행된 날짜라면 라벨을 골라 해당 조건의 종목을 바로 확인할 수 있습니다.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                {selectedDateHasScreening
                  ? `현재 조건에 맞는 run ${formatNumber(filteredRuns.length)}개`
                  : selectedDateHasPrice
                    ? "이 날짜는 가격 데이터만 있습니다"
                    : `현재 조건에 맞는 run ${formatNumber(filteredRuns.length)}개`}
              </span>
              <SelectionGuideHover />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:max-w-[380px]">
            <label className="space-y-2 text-sm">
              <span className="font-medium text-foreground">기준일</span>
              <select
                value={runDateFilter}
                onChange={(event) => setRunDateFilter(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {runDateOptions.map((date) => (
                  <option key={date} value={date}>
                    {formatDateLabel(date)}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm">
              <span className="font-medium text-foreground">라벨</span>
              <select
                value={runSignalFilter}
                onChange={(event) => setRunSignalFilter(event.target.value)}
                disabled={!selectedDateHasScreening}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">전체</option>
                {runSignalOptions.map((signal) => (
                  <option key={signal} value={signal}>
                    {getSignalLabel(signal)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr),minmax(320px,1fr)]">
            <div className="rounded-2xl border bg-muted/30 p-4 text-sm text-muted-foreground">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-foreground">현재 선택</p>
                {runSignalFilter === "all" ? <Badge variant="outline">전체</Badge> : <SignalGuideBadge signal={runSignalFilter} />}
                {runSignalFilter !== "all" && selectedSignalRun ? (
                  <Badge variant={getStatusVariant(selectedSignalRun.status)}>{selectedSignalRun.status}</Badge>
                ) : null}
                {!selectedDateHasScreening && selectedDateHasPrice ? <Badge variant="secondary">스크리닝 미실행</Badge> : null}
              </div>
              {filteredRuns.length > 0 ? (
                <>
                  <p className="mt-2 text-foreground">{runSignalFilter === "all" ? "전체 라벨 종목" : selectedSignalLabel}</p>
                  <p className="mt-1">{selectedRunTiming}</p>
                  <p className="mt-2">
                    후보 {formatNumber(screeningStats.candidateCount)}개, 성과 반영 {formatNumber(screeningStats.monitoredCount)}개
                  </p>
                  {selectedRunGuide ? (
                    <>
                      <p className="mt-2">{selectedRunGuide.summary}</p>
                      <p className="mt-1">{selectedRunGuide.horizon}</p>
                    </>
                  ) : null}
                </>
              ) : selectedDateHasPrice ? (
                <>
                  <p className="mt-2 text-foreground">스크리닝 미실행일</p>
                  <p className="mt-1">{`${formatDateIso(runDateFilter)} 가격 데이터는 적재되어 있지만, 이 날짜에는 스크리닝 결과를 생성하지 않았습니다.`}</p>
                  <p className="mt-2">후보 종목은 표시되지 않으며, 이후 해당 날짜 스크리닝 결과를 백필하면 기준일 기록에 자동으로 반영됩니다.</p>
                </>
              ) : (
                <p className="mt-2">필터와 일치하는 결과가 없습니다. 기준일 또는 라벨 조건을 바꿔보세요.</p>
              )}
            </div>

            <div className="rounded-2xl border bg-muted/30 p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">성과 계산 기준</p>
              <p className="mt-2">진입가는 다음 거래일 첫 시가, 성과 평가는 최근 거래일 종가를 기준으로 계산합니다.</p>
              <p className="mt-2">
                최고가와 최저가는 진입 이후 구간의 일중 고가와 저가를 사용하며, 최고가 수익률과 최저가 수익률은 모두 진입 시가 대비 값입니다.
              </p>
              <p className="mt-2">
                우측 그래프는 진입 이후 최대 {PRICE_CHART_DAYS}영업일의 시가·고가·저가·종가 흐름을 보여주며, 표의 최고가·최저가 숫자는 최근 반영 거래일까지의 전체 구간 기준입니다.
              </p>
              <p className="mt-2">라벨 배지에 마우스를 올리면 각 라벨의 의미를 바로 볼 수 있습니다.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="text-lg">후보 성과표</CardTitle>
              <CardDescription>
                {filteredRuns.length > 0
                  ? `${formatDateLabel(runDateFilter)} · ${selectedSignalLabel}`
                  : selectedDateHasPrice
                    ? `${formatDateLabel(runDateFilter)} · 스크리닝 미실행`
                    : "상단 필터에서 기준일을 선택하면 후보 종목의 성과를 볼 수 있습니다."}
              </CardDescription>
            </div>
            {runSignalFilter !== "all" && selectedSignalRun?.notes ? (
              <div className="max-w-sm rounded-2xl bg-muted px-3 py-2 text-xs text-muted-foreground">
                {selectedSignalRun.notes}
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                className="pl-9"
                disabled={!selectedDateHasScreening}
                placeholder="종목명, 종목코드, 태그, 사유 검색"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {filteredRuns.length > 0 ? (
                <>
                  <span>후보 {formatNumber(screeningStats.candidateCount)}개</span>
                  <span>표시 {formatNumber(filteredCandidates.length)}개</span>
                  <span>정렬: 라벨 순 → 순위</span>
                </>
              ) : selectedDateHasPrice ? (
                <span>이 날짜는 가격 데이터만 있고, 후보 종목은 생성되지 않았습니다.</span>
              ) : (
                <span>기준일을 선택하면 종목 표가 표시됩니다.</span>
              )}
            </div>
          </div>

          {filteredRuns.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              {selectedDateHasPrice
                ? "이 날짜는 스크리닝 미실행일이라 표시할 후보 종목이 없습니다. 가격 데이터는 이미 적재되어 있습니다."
                : "조건에 맞는 run이 없어 아직 표시할 종목이 없습니다."}
            </div>
          ) : candidatesLoading || performance.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">순위</TableHead>
                    <TableHead className="w-32">라벨</TableHead>
                    <TableHead className="w-[120px] min-w-[120px]">종목</TableHead>
                    <TableHead className="w-32 text-right">진입 시가</TableHead>
                    <TableHead className="w-32 text-right">최근 거래일 종가</TableHead>
                    <TableHead className="w-36 whitespace-nowrap text-right">전일 종가 수익률</TableHead>
                    <TableHead className="w-32 text-right">최고가</TableHead>
                    <TableHead className="w-28 text-right">최고가 수익률</TableHead>
                    <TableHead className="w-32 text-right">최저가</TableHead>
                    <TableHead className="w-28 text-right">최저가 수익률</TableHead>
                    <TableHead className="w-[680px] min-w-[680px]">10일 가격 흐름</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCandidates.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="py-12 text-center text-muted-foreground">
                        {screeningStats.candidateCount === 0
                          ? "이 결과에는 실제 후보 종목이 없습니다. 관망(cash) 같은 날은 0개 후보로 표시될 수 있습니다."
                          : "현재 검색 조건과 일치하는 종목이 없습니다."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredCandidates.map((candidate) => {
                      const performanceStateLabel = getPerformanceStateLabel(candidate);
                      const candidateSignal = candidate.signal || runByKey.get(candidate.run_key)?.strategy_key || "";

                      return (
                        <TableRow key={`${candidate.run_key}-${candidate.stock_code}`}>
                          <TableCell className="font-medium">{candidate.rank_no || "-"}</TableCell>
                          <TableCell>
                            {candidateSignal ? <SignalGuideBadge signal={candidateSignal} /> : <span>-</span>}
                          </TableCell>
                          <TableCell className="w-[120px] min-w-[120px]">
                            <div>
                              <p className="break-words font-medium">{candidate.stock_name}</p>
                              <p className="text-xs text-muted-foreground">
                                {candidate.stock_code}
                                {candidate.market ? ` · ${candidate.market}` : ""}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="space-y-1">
                              <p className="font-medium">{formatPrice(candidate.entryOpenPrice)}</p>
                              <p className="text-xs text-muted-foreground">{formatDateLabel(candidate.entryTradeDate)}</p>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="space-y-1">
                              <p className="font-medium">{formatPrice(candidate.latestClosePrice)}</p>
                              <p className="text-xs text-muted-foreground">{formatDateLabel(candidate.latestTradeDate)}</p>
                            </div>
                          </TableCell>
                          <TableCell
                            className={`text-right font-medium ${
                              candidate.returnPct !== null && candidate.returnPct > 0
                                ? "text-up"
                                : candidate.returnPct !== null && candidate.returnPct < 0
                                  ? "text-down"
                                  : "text-muted-foreground"
                            }`}
                          >
                            {candidate.returnPct !== null ? (
                              formatPercent(candidate.returnPct)
                            ) : (
                              <span className="text-xs">{performanceStateLabel}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-medium">{formatPrice(candidate.highestPrice)}</TableCell>
                          <TableCell
                            className={`text-right font-medium ${
                              candidate.maxReturnPct !== null && candidate.maxReturnPct > 0 ? "text-up" : "text-muted-foreground"
                            }`}
                          >
                            {formatPercent(candidate.maxReturnPct)}
                          </TableCell>
                          <TableCell className="text-right font-medium">{formatPrice(candidate.lowestPrice)}</TableCell>
                          <TableCell
                            className={`text-right font-medium ${
                              candidate.maxDrawdownPct !== null && candidate.maxDrawdownPct < 0
                                ? "text-down"
                                : "text-muted-foreground"
                            }`}
                          >
                            {formatPercent(candidate.maxDrawdownPct)}
                          </TableCell>
                          <TableCell className="w-[680px] min-w-[680px]">
                            <CandidatePriceMiniChart candidate={candidate} />
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {(syncStatus?.last_error || runsError || candidatesError || performance.error) && (
        <Card className="border-destructive/40 bg-destructive/5 shadow-none">
          <CardContent className="flex gap-3 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
            <div className="space-y-1">
              <p className="font-medium text-destructive">확인이 필요한 데이터 오류가 있습니다</p>
              {syncStatus?.last_error ? <p>{syncStatus.last_error}</p> : null}
              {!syncStatus?.last_error && runsError ? <p>{getErrorMessage(runsError)}</p> : null}
              {!syncStatus?.last_error && !runsError && candidatesError ? <p>{getErrorMessage(candidatesError)}</p> : null}
              {!syncStatus?.last_error && !runsError && !candidatesError && performance.error ? (
                <p>{getErrorMessage(performance.error)}</p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SelectionGuideHover() {
  return (
    <HoverCard openDelay={120}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <CircleHelp className="h-3.5 w-3.5" />
          라벨 안내
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-[360px] space-y-3">
        <div>
          <p className="text-sm font-semibold">라벨 안내</p>
        </div>
        <div className="space-y-3">
          {SELECTION_GUIDE.map((item) => (
            <div key={item.key} className="space-y-1">
              <p className="text-sm font-medium">{item.title}</p>
              <p className="text-xs text-muted-foreground">{item.summary}</p>
              <p className="text-xs text-muted-foreground">{item.horizon}</p>
            </div>
          ))}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function SignalGuideBadge({ signal }: { signal: string }) {
  const guide = getSignalGuide(signal);
  const label = getSignalLabel(signal);

  if (!guide) {
    return <Badge variant="secondary">{label}</Badge>;
  }

  return (
    <HoverCard openDelay={100}>
      <HoverCardTrigger asChild>
        <div className="inline-flex">
          <Badge variant="secondary" className="cursor-help">
            {label}
          </Badge>
        </div>
      </HoverCardTrigger>
      <HoverCardContent className="w-[320px] space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{guide.title}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{guide.summary}</p>
        <p className="text-xs text-muted-foreground">{guide.horizon}</p>
      </HoverCardContent>
    </HoverCard>
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

function LabelSummaryCard({
  title,
  value,
  note,
  noteTone,
  active,
  loading,
}: {
  title: string;
  value: string;
  note: string;
  noteTone: "up" | "down" | "neutral" | "muted";
  active?: boolean;
  loading: boolean;
}) {
  const noteClassName =
    noteTone === "up"
      ? "text-up"
      : noteTone === "down"
        ? "text-down"
        : noteTone === "neutral"
          ? "text-foreground"
          : "text-muted-foreground";

  return (
    <div className={`rounded-2xl border p-3 ${active ? "border-primary/40 bg-primary/5" : "bg-background"}`}>
      <p className="text-xs font-medium text-foreground">{title}</p>
      {loading ? <Skeleton className="mt-2 h-5 w-24" /> : <p className="mt-2 text-base font-semibold text-foreground">{value}</p>}
      <p className={`mt-1 text-base font-semibold leading-tight ${noteClassName}`}>{note}</p>
    </div>
  );
}

function ExtremeMetricCard({
  title,
  value,
  note,
  tone,
  loading,
  icon,
}: {
  title: string;
  value: string;
  note: string;
  tone: "up" | "down";
  loading: boolean;
  icon: ReactNode;
}) {
  return (
    <div className={`rounded-2xl border p-3 ${tone === "up" ? "bg-up-subtle/40" : "bg-down-subtle/30"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-foreground">{title}</p>
          {loading ? (
            <Skeleton className="h-5 w-24" />
          ) : (
            <p className={`text-lg font-semibold ${tone === "up" ? "text-up" : "text-down"}`}>{value}</p>
          )}
          <p className="text-sm leading-tight text-muted-foreground">{note}</p>
        </div>
        <div className="rounded-2xl bg-background/80 p-1.5 text-muted-foreground">{icon}</div>
      </div>
    </div>
  );
}

function CandidatePriceMiniChart({ candidate }: { candidate: ScreeningPerformanceRow }) {
  const performanceStateLabel = getPerformanceStateLabel(candidate);
  const series = candidate.priceSeries.filter(
    (point) => point.openPrice > 0 && point.highPrice > 0 && point.lowPrice > 0 && point.closePrice > 0
  );

  if (!candidate.entryOpenPrice || series.length === 0) {
    return (
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>{performanceStateLabel || "표시할 가격 데이터가 없습니다."}</p>
        <p className="text-xs">진입 시가가 확정된 뒤부터 가격 흐름 그래프가 표시됩니다.</p>
      </div>
    );
  }

  const highestPoint = series.reduce((max, point) => (point.highPrice > max.highPrice ? point : max), series[0]);
  const lowestPoint = series.reduce((min, point) => (point.lowPrice < min.lowPrice ? point : min), series[0]);

  return (
    <div className="w-full min-w-[660px] space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="rounded-full bg-up-subtle px-2 py-0.5 text-up">
          {`10일 최고 ${formatShortDateLabel(highestPoint.tradeDate)} ${formatPrice(highestPoint.highPrice)} (${formatCompactPercent(
            highestPoint.highReturnPct
          )})`}
        </span>
        <span className="rounded-full bg-down-subtle px-2 py-0.5 text-down">
          {`10일 최저 ${formatShortDateLabel(lowestPoint.tradeDate)} ${formatPrice(lowestPoint.lowPrice)} (${formatCompactPercent(
            lowestPoint.lowReturnPct
          )})`}
        </span>
      </div>
      <PriceSeriesSvg series={series} entryOpenPrice={candidate.entryOpenPrice} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-foreground/80" />
            캔들봉(시가·고가·저가·종가)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-0.5 w-3 rounded-full bg-muted-foreground/60" />
            진입 기준선
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-0.5 w-3 rounded-full bg-up/70" />
            익절선 +6%
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-0.5 w-3 rounded-full bg-down/70" />
            손절선 -4%
          </span>
        </div>
        <span>{`진입 후 최대 ${PRICE_CHART_DAYS}영업일`}</span>
        <span>{`기준선 ${formatPrice(candidate.entryOpenPrice)}`}</span>
      </div>
    </div>
  );
}

function PriceSeriesSvg({
  series,
  entryOpenPrice,
}: {
  series: ScreeningPerformancePoint[];
  entryOpenPrice: number;
}) {
  const width = 720;
  const height = 176;
  const padding = { top: 18, right: 22, bottom: 34, left: 18 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const step = series.length > 1 ? plotWidth / (series.length - 1) : 0;
  const targetPrice = entryOpenPrice * 1.06;
  const stopPrice = entryOpenPrice * 0.96;
  const priceValues = [
    entryOpenPrice,
    targetPrice,
    stopPrice,
    ...series.flatMap((point) => [point.openPrice, point.highPrice, point.lowPrice, point.closePrice]),
  ].filter((value) => value > 0);
  const rawMin = Math.min(...priceValues);
  const rawMax = Math.max(...priceValues);
  const paddingRange = Math.max((rawMax - rawMin) * 0.12, rawMax * 0.02, 1);
  const scaledMin = Math.max(0, rawMin - paddingRange);
  const scaledMax = rawMax + paddingRange;
  const scaleRange = Math.max(scaledMax - scaledMin, 1);
  const baselineY = padding.top + ((scaledMax - entryOpenPrice) / scaleRange) * plotHeight;
  const markerTextStroke = "rgba(255,255,255,0.92)";
  const highestIndex = series.reduce((maxIndex, point, index, items) => {
    return point.highPrice > items[maxIndex].highPrice ? index : maxIndex;
  }, 0);
  const lowestIndex = series.reduce((minIndex, point, index, items) => {
    return point.lowPrice < items[minIndex].lowPrice ? index : minIndex;
  }, 0);

  const getX = (index: number) => (series.length === 1 ? padding.left + plotWidth / 2 : padding.left + step * index);
  const getY = (price: number) => padding.top + ((scaledMax - price) / scaleRange) * plotHeight;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-40 w-full rounded-xl border bg-background/80">
      {[0.25, 0.5, 0.75].map((ratio) => {
        const y = padding.top + plotHeight * ratio;
        return (
          <line
            key={`grid-${ratio}`}
            x1={padding.left}
            x2={width - padding.right}
            y1={y}
            y2={y}
            stroke="hsl(var(--border) / 0.7)"
            strokeDasharray="2 4"
          />
        );
      })}
      <line
        x1={padding.left}
        x2={width - padding.right}
        y1={baselineY}
        y2={baselineY}
        stroke="hsl(var(--muted-foreground) / 0.45)"
        strokeDasharray="4 4"
      />
      <line
        x1={padding.left}
        x2={width - padding.right}
        y1={getY(targetPrice)}
        y2={getY(targetPrice)}
        stroke="hsl(var(--up) / 0.72)"
        strokeDasharray="6 4"
        strokeWidth="1.3"
      />
      <line
        x1={padding.left}
        x2={width - padding.right}
        y1={getY(stopPrice)}
        y2={getY(stopPrice)}
        stroke="hsl(var(--down) / 0.72)"
        strokeDasharray="6 4"
        strokeWidth="1.3"
      />
      <text
        x={width - padding.right}
        y={Math.max(12, getY(targetPrice) - 6)}
        textAnchor="end"
        fontSize="10"
        fontWeight="600"
        fill="hsl(var(--up))"
      >
        익절 +6%
      </text>
      <text
        x={width - padding.right}
        y={Math.min(height - 10, getY(stopPrice) - 6)}
        textAnchor="end"
        fontSize="10"
        fontWeight="600"
        fill="hsl(var(--down))"
      >
        손절 -4%
      </text>
      {series.map((point, index) => {
        const x = getX(index);
        const openY = getY(point.openPrice);
        const highY = getY(point.highPrice);
        const lowY = getY(point.lowPrice);
        const closeY = getY(point.closePrice);
        const isUpCandle = point.closePrice >= point.openPrice;
        const bodyTop = Math.min(openY, closeY);
        const bodyHeight = Math.max(3, Math.abs(closeY - openY));
        const bodyWidth = Math.max(8, Math.min(16, plotWidth / Math.max(series.length * 2.3, 1)));
        const candleColor = isUpCandle ? "hsl(var(--up))" : "hsl(var(--down))";

        return (
          <g key={`${point.tradeDate}-candle`}>
            <line
              x1={x}
              x2={x}
              y1={highY}
              y2={lowY}
              stroke={candleColor}
              strokeOpacity="1"
              strokeWidth="1.2"
              vectorEffect="non-scaling-stroke"
            />
            <rect
              x={x - bodyWidth / 2}
              y={bodyTop}
              width={bodyWidth}
              height={bodyHeight}
              rx={2}
              fill={candleColor}
              stroke={candleColor}
              strokeOpacity="1"
              strokeWidth="1.1"
              vectorEffect="non-scaling-stroke"
            />
            <title>
              {`${formatDateIso(point.tradeDate)} 시 ${formatPrice(point.openPrice)} · 고 ${formatPrice(point.highPrice)} · 저 ${formatPrice(
                point.lowPrice
              )} · 종 ${formatPrice(point.closePrice)} · 종가수익률 ${formatPercent(point.closeReturnPct)}`}
            </title>
            <line
              x1={x}
              x2={x}
              y1={padding.top}
              y2={height - padding.bottom}
              stroke="hsl(var(--border) / 0.4)"
              strokeDasharray="2 5"
            />
            <rect
              x={x - Math.max(10, plotWidth / Math.max(series.length * 2.4, 1))}
              y={padding.top}
              width={Math.max(20, plotWidth / Math.max(series.length * 1.2, 1))}
              height={plotHeight}
              fill="transparent"
            />
          </g>
        );
      })}
      <PriceMarker
        x={getX(highestIndex)}
        y={getY(series[highestIndex].highPrice)}
        label={`최고 ${formatCompactPercent(series[highestIndex].highReturnPct)}`}
        tone="up"
        position="top"
        textStroke={markerTextStroke}
      />
      <PriceMarker
        x={getX(lowestIndex)}
        y={getY(series[lowestIndex].lowPrice)}
        label={`최저 ${formatCompactPercent(series[lowestIndex].lowReturnPct)}`}
        tone="down"
        position="bottom"
        textStroke={markerTextStroke}
      />
      {series.map((point, index) => (
          <text
            key={`${point.tradeDate}-label`}
            x={getX(index)}
            y={height - 8}
            textAnchor="middle"
            fontSize="9"
            fill="hsl(var(--muted-foreground))"
          >
            {formatShortDateLabel(point.tradeDate)}
          </text>
        ))}
    </svg>
  );
}

function PriceMarker({
  x,
  y,
  label,
  tone,
  position,
  textStroke,
}: {
  x: number;
  y: number;
  label: string;
  tone: "up" | "down";
  position: "top" | "bottom";
  textStroke: string;
}) {
  const markerColor = tone === "up" ? "hsl(var(--up))" : "hsl(var(--down))";
  const textY = position === "top" ? Math.max(12, y - 8) : Math.min(104, y + 14);

  return (
    <g>
      <circle cx={x} cy={y} r={3.2} fill={markerColor} stroke="white" strokeWidth={1.4} />
      <text
        x={x}
        y={textY}
        textAnchor="middle"
        fontSize="9.5"
        fontWeight="600"
        fill={markerColor}
        stroke={textStroke}
        strokeWidth={3}
        paintOrder="stroke"
      >
        {label}
      </text>
    </g>
  );
}

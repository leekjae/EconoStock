import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, BookOpenText, CircleHelp, Database, RefreshCw, Search, TrendingUp } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useScreeningPerformance, type ScreeningPerformanceRow } from "@/components/screening/useScreeningPerformance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ScreeningRun = Tables<"screening_runs">;
type ScreeningCandidate = Tables<"screening_candidates">;
type ScreeningSyncStatus = Tables<"screening_sync_status">;

const SIGNAL_ORDER = ["strategy_a", "strategy_b", "cash", "overlap", "spike", "rebound"] as const;

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

function formatScore(value: number) {
  return Number(value || 0).toFixed(2);
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

  const runDateOptions = useMemo(() => {
    return Array.from(new Set(orderedRuns.map((run) => run.as_of_date))).sort((left, right) => right.localeCompare(left));
  }, [orderedRuns]);

  const runSignalOptions = useMemo(() => {
    const values = Array.from(new Set(orderedRuns.map((run) => normalizeSignalKey(run.strategy_key)).filter(Boolean)));
    return values.sort((left, right) => getSignalOrder(left) - getSignalOrder(right));
  }, [orderedRuns]);

  useEffect(() => {
    if (!runDateFilter && runDateOptions.length > 0) {
      setRunDateFilter(runDateOptions[0]);
    }
  }, [runDateFilter, runDateOptions]);

  const filteredRuns = useMemo(() => {
    return orderedRuns.filter((run) => {
      const matchesDate = !runDateFilter || run.as_of_date === runDateFilter;
      const matchesSignal = runSignalFilter === "all" || normalizeSignalKey(run.strategy_key) === runSignalFilter;
      return matchesDate && matchesSignal;
    });
  }, [orderedRuns, runDateFilter, runSignalFilter]);

  const filteredRunKeys = useMemo(() => filteredRuns.map((run) => run.run_key), [filteredRuns]);
  const referenceRun = filteredRuns[0] ?? null;
  const runByKey = useMemo(() => new Map(filteredRuns.map((run) => [run.run_key, run] as const)), [filteredRuns]);
  const selectedSignalLabel = runSignalFilter === "all" ? "전체" : getSignalLabel(runSignalFilter);

  const {
    data: candidates = [],
    error: candidatesError,
    isLoading: candidatesLoading,
    refetch: refetchCandidates,
    isFetching: candidatesFetching,
  } = useQuery<ScreeningCandidate[]>({
    queryKey: ["screening-candidates", filteredRunKeys.join(",")],
    queryFn: () => fetchScreeningCandidates(filteredRunKeys),
    enabled: filteredRunKeys.length > 0,
    staleTime: 60 * 1000,
    retry: false,
  });

  const performance = useScreeningPerformance(referenceRun, candidates);

  const filteredCandidates = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();

    return performance.rows
      .filter((candidate) => {
        const matchesQuery =
          !query ||
          candidate.stock_name.toLowerCase().includes(query) ||
          candidate.stock_code.toLowerCase().includes(query) ||
          (candidate.reason_summary || "").toLowerCase().includes(query) ||
          (candidate.tags || "").toLowerCase().includes(query);

        return matchesQuery;
      })
      .sort((left, right) => {
        const leftSignal = normalizeSignalKey(left.signal || runByKey.get(left.run_key)?.strategy_key || "");
        const rightSignal = normalizeSignalKey(right.signal || runByKey.get(right.run_key)?.strategy_key || "");

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
  }, [deferredSearch, performance.rows, runByKey]);

  const screeningStats = useMemo(() => {
    const totalScore = candidates.reduce((sum, candidate) => sum + Number(candidate.score || 0), 0);
    return {
      candidateCount: candidates.length,
      averageScore: candidates.length === 0 ? 0 : totalScore / candidates.length,
      topScore: candidates.reduce((max, candidate) => Math.max(max, Number(candidate.score || 0)), 0),
    };
  }, [candidates]);

  const schemaMissing = isSchemaMissing(runsError) || isSchemaMissing(candidatesError) || isSchemaMissing(syncError);
  const isLoading = runsLoading || syncLoading;
  const isRefreshing =
    runsFetching || syncFetching || candidatesFetching || performance.isFetching || performance.isLatestDateFetching;
  const selectedRunGuide = runSignalFilter === "all" ? null : getSignalGuide(runSignalFilter);
  const selectedRunTiming = runDateFilter
    ? `${formatDateIso(runDateFilter)} 결과는 해당 거래일 종가 기준으로 생성되며, 실무적으로는 다음 거래일 시가 기준 검토 리스트로 해석합니다.`
    : "스크리닝 결과는 장 종료 후 생성되고, 다음 거래일 시가 기준으로 성과를 추적합니다.";

  const handleRefresh = () => {
    refetchRuns();
    refetchSync();
    if (filteredRunKeys.length > 0) {
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
            <p>2. `screening.csv` 또는 `daily_action_sheet_*.csv` 파일을 적재합니다.</p>
            <p>3. 이어서 screening price SQLite 동기화를 한 번 실행합니다.</p>
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
                스크리닝 CSV 또는 <code className="font-mono">output</code> 폴더를 적재하면, 대시보드에서 다음 거래일 시가 기준
                성과를 추적할 수 있습니다.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border bg-background p-4">
            <p className="text-sm font-medium">지원 입력 형식</p>
            <p className="mt-2 text-sm text-muted-foreground">
              1. 정규화된 <code className="font-mono">screening.csv</code> 단일 파일
            </p>
            <p className="text-sm text-muted-foreground">
              2. <code className="font-mono">daily_action_sheet_YYYY-MM-DD.csv</code>
            </p>
            <p className="text-sm text-muted-foreground">
              3. 여러 일자 CSV가 들어 있는 <code className="font-mono">output</code> 폴더
            </p>
          </div>
          <div className="rounded-2xl border bg-background p-4">
            <p className="text-sm font-medium">CMD 예시</p>
            <div className="mt-2 space-y-2 font-mono text-xs text-muted-foreground">
              <p>npm run import:screening -- --file .\data\screening.csv --dry-run</p>
              <p>npm run import:screening -- --file D:\Codex\Screening\output --dry-run</p>
              <p>npm run import:screening -- --file D:\Codex\Screening\output</p>
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
          note={filteredRuns.length > 0 ? `${selectedSignalLabel} 라벨` : "선택된 결과 없음"}
          loading={isLoading}
          icon={<Activity className="h-4 w-4" />}
        />
        <MetricCard
          title="후보 종목 수"
          value={formatNumber(screeningStats.candidateCount)}
          note={filteredRuns.length > 0 ? `조건에 맞는 run ${formatNumber(filteredRuns.length)}개` : "최신 결과 불러오는 중"}
          loading={candidatesLoading}
          icon={<Database className="h-4 w-4" />}
        />
        <MetricCard
          title="평균 수익률"
          value={performance.summary.monitoredCount > 0 ? formatPercent(performance.summary.averageReturn) : "-"}
          note={
            performance.summary.monitoredCount > 0
              ? `${formatNumber(performance.summary.monitoredCount)}개 종목이 성과 계산에 반영되었습니다`
              : "아직 성과 계산에 반영된 가격이 없습니다"
          }
          loading={performance.isLoading}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <MetricCard
          title="최근 반영 거래일"
          value={formatDateLabel(performance.summary.latestReferenceDate || performance.latestAvailableTradeDate)}
          note={`최고가 수익률 ${formatPercent(performance.summary.bestReturn)} / 최저가 수익률 ${formatPercent(performance.summary.worstDrawdown)}`}
          loading={performance.isLoading}
          icon={<BookOpenText className="h-4 w-4" />}
        />
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="text-lg">결과 필터</CardTitle>
              <CardDescription>
                기준일과 라벨을 먼저 고르면, 아래 표에서 해당 조건의 종목이 바로 정렬되어 표시됩니다.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>현재 조건에 맞는 run {formatNumber(filteredRuns.length)}개</span>
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

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr),320px]">
            <div className="rounded-2xl border bg-muted/30 p-4 text-sm text-muted-foreground">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-foreground">현재 선택</p>
                {runSignalFilter === "all" ? <Badge variant="outline">전체</Badge> : <SignalGuideBadge signal={runSignalFilter} />}
                {runSignalFilter !== "all" && referenceRun ? (
                  <Badge variant={getStatusVariant(referenceRun.status)}>{referenceRun.status}</Badge>
                ) : null}
              </div>
              {filteredRuns.length > 0 ? (
                <>
                  <p className="mt-2 text-foreground">{runSignalFilter === "all" ? "전체 라벨 종목" : selectedSignalLabel}</p>
                  <p className="mt-1">{selectedRunTiming}</p>
                  <p className="mt-2">
                    후보 {formatNumber(screeningStats.candidateCount)}개, 평균 점수 {formatScore(screeningStats.averageScore)}, 최고 점수 {formatScore(screeningStats.topScore)}
                  </p>
                  {selectedRunGuide ? (
                    <>
                      <p className="mt-2">{selectedRunGuide.summary}</p>
                      <p className="mt-1">{selectedRunGuide.horizon}</p>
                    </>
                  ) : (
                    <>
                      <p className="mt-2">
                        전체 라벨을 선택하면 종목은 <code className="font-mono text-xs">strategy_a → strategy_b → cash → overlap → spike → rebound</code> 순서로 먼저 정렬됩니다.
                      </p>
                      <p className="mt-1">같은 라벨 안에서는 순위가 높은 종목부터 표시됩니다.</p>
                    </>
                  )}
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
                  : "상단 필터에서 기준일을 선택하면 후보 종목의 성과를 볼 수 있습니다."}
              </CardDescription>
            </div>
            {runSignalFilter !== "all" && referenceRun?.notes ? (
              <div className="max-w-sm rounded-2xl bg-muted px-3 py-2 text-xs text-muted-foreground">
                {referenceRun.notes}
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
                placeholder="종목명, 종목코드, 태그, 메모 검색"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {filteredRuns.length > 0 ? (
                <>
                  <span>후보 {formatNumber(screeningStats.candidateCount)}개</span>
                  <span>표시 {formatNumber(filteredCandidates.length)}개</span>
                  <span>정렬: 라벨 순 → 순위</span>
                </>
              ) : (
                <span>기준일을 선택하면 종목 표가 표시됩니다.</span>
              )}
            </div>
          </div>

          {filteredRuns.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              조건에 맞는 run이 없어 아직 표시할 종목이 없습니다.
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
                    <TableHead>종목</TableHead>
                    <TableHead className="w-32 text-right">진입 시가</TableHead>
                    <TableHead className="w-32 text-right">최근 거래일 종가</TableHead>
                    <TableHead className="w-28 text-right">전일 종가 수익률</TableHead>
                    <TableHead className="w-32 text-right">최고가</TableHead>
                    <TableHead className="w-28 text-right">최고가 수익률</TableHead>
                    <TableHead className="w-32 text-right">최저가</TableHead>
                    <TableHead className="w-28 text-right">최저가 수익률</TableHead>
                    <TableHead>메모</TableHead>
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
                          <TableCell>
                            <div>
                              <p className="font-medium">{candidate.stock_name}</p>
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
                          <TableCell>
                            <div className="space-y-1">
                              {candidate.reason_summary ? (
                                <p className="line-clamp-2 text-sm text-foreground">{candidate.reason_summary}</p>
                              ) : (
                                <p className="text-sm text-muted-foreground">메모 없음</p>
                              )}
                              {candidate.tags ? <p className="text-xs text-muted-foreground">{candidate.tags}</p> : null}
                            </div>
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






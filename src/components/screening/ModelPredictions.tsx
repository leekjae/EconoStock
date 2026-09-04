import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BrainCircuit, CalendarDays, Clock3, Database, Info } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type PredictionRun = Tables<"model_prediction_runs">;
type PredictionCandidate = Tables<"model_prediction_candidates">;
type PredictionForwardPrice = Tables<"model_prediction_forward_prices">;

async function fetchPredictionRuns() {
  const { data, error } = await supabase
    .from("model_prediction_runs")
    .select("*")
    .order("trade_date", { ascending: false })
    .limit(260);
  if (error) throw error;
  return data ?? [];
}

async function fetchPredictionCandidates(tradeDate: string) {
  const { data, error } = await supabase
    .from("model_prediction_candidates")
    .select("*")
    .eq("trade_date", tradeDate)
    .order("rank_no", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function fetchPredictionForwardPrices(tradeDate: string) {
  const { data, error } = await supabase
    .from("model_prediction_forward_prices")
    .select("*")
    .eq("signal_date", tradeDate)
    .order("horizon_day", { ascending: true })
    .order("ticker", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const normalized = value.replace(/-/g, "");
  if (!/^\d{8}$/.test(normalized)) return value;
  return `${normalized.slice(0, 4)}.${normalized.slice(4, 6)}.${normalized.slice(6, 8)}`;
}

function formatGeneratedAt(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(parsed);
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-";
  const percentage = Number(value) * 100;
  const sign = percentage > 0 ? "+" : "";
  return `${sign}${percentage.toFixed(1)}%`;
}

function formatPrice(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-";
  return `${Math.round(Number(value)).toLocaleString("ko-KR")}원`;
}

function percentTone(value: number | null | undefined) {
  if (value === null || value === undefined) return "text-muted-foreground";
  return Number(value) > 0 ? "text-up" : Number(value) < 0 ? "text-down" : "text-foreground";
}

function confidenceLabel(value: string) {
  const labels: Record<string, string> = {
    "short+theme+consensus": "모델·테마 합의",
    "short+theme": "단기·테마 합의",
    "short+consensus": "모델 합의",
    short_only: "단기 모델",
  };
  return labels[value] || value || "-";
}

function isMissingTableError(error: unknown) {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : String(error || "");
  return /model_prediction_runs|model_prediction_candidates|model_prediction_forward_prices|does not exist|schema cache/i.test(message);
}

export function ModelPredictions() {
  const [selectedDate, setSelectedDate] = useState("");
  const runsQuery = useQuery({ queryKey: ["model-prediction-runs"], queryFn: fetchPredictionRuns });
  const runs = (runsQuery.data ?? []) as PredictionRun[];

  useEffect(() => {
    if (!selectedDate && runs.length > 0) setSelectedDate(runs[0].trade_date);
    if (selectedDate && runs.length > 0 && !runs.some((run) => run.trade_date === selectedDate)) {
      setSelectedDate(runs[0].trade_date);
    }
  }, [runs, selectedDate]);

  const candidatesQuery = useQuery({
    queryKey: ["model-prediction-candidates", selectedDate],
    queryFn: () => fetchPredictionCandidates(selectedDate),
    enabled: Boolean(selectedDate),
  });
  const candidates = (candidatesQuery.data ?? []) as PredictionCandidate[];
  const forwardPricesQuery = useQuery({
    queryKey: ["model-prediction-forward-prices", selectedDate],
    queryFn: () => fetchPredictionForwardPrices(selectedDate),
    enabled: Boolean(selectedDate),
  });
  const forwardPrices = (forwardPricesQuery.data ?? []) as PredictionForwardPrice[];
  const forwardPriceMap = useMemo(
    () => new Map(forwardPrices.map((row) => [`${row.ticker}:${row.horizon_day}`, row])),
    [forwardPrices],
  );
  const selectedRun = useMemo(() => runs.find((run) => run.trade_date === selectedDate), [runs, selectedDate]);
  const isLoading =
    runsQuery.isLoading ||
    (Boolean(selectedDate) && (candidatesQuery.isLoading || forwardPricesQuery.isLoading));
  const error = runsQuery.error || candidatesQuery.error || forwardPricesQuery.error;

  if (error) {
    return (
      <Card className="border-amber-200 bg-amber-50/70">
        <CardContent className="flex gap-3 p-5 text-sm text-amber-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">모델 예측 데이터를 불러오지 못했습니다.</p>
            <p className="mt-1 text-xs">
              {isMissingTableError(error)
                ? "Supabase에 모델 예측 테이블을 먼저 생성한 뒤 최신 결과를 동기화해 주세요."
                : "잠시 후 다시 시도해 주세요."}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-xl font-bold tracking-tight">다음 거래일 상승 후보</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            장 마감 데이터로 계산한 모델 상위 후보입니다. 예측값은 가능성을 나타내며 수익을 보장하지 않습니다.
          </p>
        </div>
        <div className="w-full sm:w-48">
          <label className="mb-1.5 block text-xs font-semibold">기준일</label>
          <Select value={selectedDate} onValueChange={setSelectedDate} disabled={runs.length === 0}>
            <SelectTrigger className="h-9 bg-background text-xs">
              <SelectValue placeholder="기준일 선택" />
            </SelectTrigger>
            <SelectContent>
              {runs.map((run) => (
                <SelectItem key={run.trade_date} value={run.trade_date}>
                  {formatDate(run.trade_date)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-24" />)}
        </div>
      ) : runs.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">아직 적재된 모델 예측 결과가 없습니다.</CardContent></Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard icon={CalendarDays} label="기준일" value={formatDate(selectedRun?.trade_date)} />
            <SummaryCard icon={Clock3} label="생성 일시" value={formatGeneratedAt(selectedRun?.generated_at)} />
            <SummaryCard icon={BrainCircuit} label="상승 후보" value={`${selectedRun?.candidate_count ?? candidates.length}개`} />
            <SummaryCard icon={Database} label="모델 학습 기준일" value={formatDate(selectedRun?.model_train_through)} />
          </div>

          <Card className="overflow-hidden">
            <CardHeader className="border-b px-4 py-3">
              <CardTitle className="text-sm">예측 순위</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table className="min-w-[1580px]">
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="w-14 text-center">순위</TableHead>
                      <TableHead className="min-w-40">종목</TableHead>
                      <ForwardHighHead horizon={1} />
                      <ForwardHighHead horizon={2} />
                      <ForwardHighHead horizon={3} />
                      <TableHead className="text-right">상승 확률</TableHead>
                      <TableHead className="text-right">+5% 이상 확률</TableHead>
                      <TableHead className="text-right">예상 종가 수익률</TableHead>
                      <TableHead className="text-right">예상 최고 상승률</TableHead>
                      <TableHead className="text-right">예상 최대 하락률</TableHead>
                      <TableHead className="min-w-32">모델 합의</TableHead>
                      <TableHead className="min-w-44">주요 테마</TableHead>
                      <TableHead className="text-center">기존 스크리닝</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {candidates.map((candidate) => (
                      <TableRow key={`${candidate.trade_date}-${candidate.ticker}`}>
                        <TableCell className="text-center font-semibold">{candidate.rank_no}</TableCell>
                        <TableCell>
                          <p className="font-semibold text-foreground">{candidate.stock_name || "-"}</p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">{candidate.ticker} · {candidate.market}</p>
                        </TableCell>
                        <ForwardHighCell row={forwardPriceMap.get(`${candidate.ticker}:1`)} />
                        <ForwardHighCell row={forwardPriceMap.get(`${candidate.ticker}:2`)} />
                        <ForwardHighCell row={forwardPriceMap.get(`${candidate.ticker}:3`)} />
                        <TableCell className="text-right tabular-nums">{formatPercent(candidate.p_up_1d)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPercent(candidate.p_max_up_ge_5pct_1d)}</TableCell>
                        <TableCell className={`text-right font-medium tabular-nums ${percentTone(candidate.pred_return_1d)}`}>
                          {formatPercent(candidate.pred_return_1d)}
                        </TableCell>
                        <TableCell className={`text-right font-medium tabular-nums ${percentTone(candidate.pred_max_upside_1d)}`}>
                          {formatPercent(candidate.pred_max_upside_1d)}
                        </TableCell>
                        <TableCell className={`text-right font-medium tabular-nums ${percentTone(candidate.pred_max_downside_1d)}`}>
                          {formatPercent(candidate.pred_max_downside_1d)}
                        </TableCell>
                        <TableCell><Badge variant="secondary">{confidenceLabel(candidate.confidence)}</Badge></TableCell>
                        <TableCell className="max-w-56">
                          <p className="truncate" title={candidate.all_theme_names || candidate.primary_theme_name}>
                            {candidate.primary_theme_name || "미분류"}
                          </p>
                        </TableCell>
                        <TableCell className="text-center">
                          {candidate.in_screening ? <Badge>포함</Badge> : <span className="text-muted-foreground">-</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                    {candidates.length === 0 ? (
                      <TableRow><TableCell colSpan={13} className="h-32 text-center text-muted-foreground">후보 데이터가 없습니다.</TableCell></TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function ForwardHighHead({ horizon }: { horizon: number }) {
  return (
    <TableHead className="min-w-32 text-right">
      <span className="block">+{horizon}영업일</span>
      <span className="block text-[10px] font-normal text-muted-foreground">고가(상승률)</span>
    </TableHead>
  );
}

function ForwardHighCell({ row }: { row: PredictionForwardPrice | undefined }) {
  if (!row || row.high_price === null || row.high_return === null) {
    return <TableCell className="text-right text-xs text-muted-foreground">데이터 미확보</TableCell>;
  }

  return (
    <TableCell className="text-right tabular-nums">
      <p className="font-medium text-foreground">{formatPrice(row.high_price)}</p>
      <p className={`mt-0.5 text-xs font-semibold ${percentTone(row.high_return)}`}>
        {formatPercent(row.high_return)}
      </p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{formatDate(row.trade_date)}</p>
    </TableCell>
  );
}

function SummaryCard({ icon: Icon, label, value }: { icon: typeof CalendarDays; label: string; value: string }) {
  return (
    <Card className="border-slate-200 bg-white/95 shadow-sm">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-lg bg-slate-100 p-2 text-slate-600"><Icon className="h-4 w-4" /></div>
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
          <p className="mt-0.5 truncate text-sm font-semibold text-foreground" title={value}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

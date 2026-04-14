import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { CalendarIcon, Search as SearchIcon, Download, Info, AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatNum, formatDate } from "@/lib/krx-api";
import { toast } from "sonner";

const INVESTORS = [
  "금융투자", "보험", "투신", "사모", "은행", "기타금융",
  "연기금", "기관합계", "기타법인", "개인", "외국인", "기타외국인", "전체",
];

const MARKETS = [
  { value: "ALL", label: "전체" },
  { value: "KOSPI", label: "KOSPI" },
  { value: "KOSDAQ", label: "KOSDAQ" },
  { value: "KONEX", label: "KONEX" },
];

const TOP_N_OPTIONS = [10, 30, 50, 100];

const QUICK_RANGES = [
  { label: "1일", days: 0 },
  { label: "1개월", days: 30 },
  { label: "6개월", days: 180 },
  { label: "1년", days: 365 },
];

interface InvestorRow {
  isuCd: string;
  isuNm: string;
  volSell: number;
  volBuy: number;
  volNet: number;
  valSell: number;
  valBuy: number;
  valNet: number;
}

// New standardized response from edge function
interface InvestorApiResponse {
  ok: boolean;
  items?: InvestorRow[];
  totalRows?: number;
  generatedAt?: number;
  stale?: boolean;
  note?: string;
  errorCode?: string;
  message?: string;
}

function getInvestorProxyUrl() {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  return `https://${projectId}.supabase.co/functions/v1/investor-proxy`;
}

function getHeaders() {
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  return {
    Authorization: `Bearer ${anonKey}`,
    apikey: anonKey,
  };
}

async function fetchInvestorData(
  market: string,
  investor: string,
  startDate: string,
  endDate: string,
  topN: number,
): Promise<InvestorApiResponse> {
  const params = new URLSearchParams({ market, investor, startDate, endDate, topN: String(topN) });
  const resp = await fetch(`${getInvestorProxyUrl()}?${params}`, { headers: getHeaders() });
  // Always try to parse JSON (edge function now never returns 500)
  const json = await resp.json().catch(() => ({
    ok: false,
    errorCode: "PARSE_ERROR",
    message: "서버 응답을 처리할 수 없습니다.",
  }));
  return json as InvestorApiResponse;
}

async function downloadInvestorCSV(
  market: string, investor: string, startDate: string, endDate: string, topN: number,
) {
  const params = new URLSearchParams({ market, investor, startDate, endDate, topN: String(topN), mode: "csv" });
  const resp = await fetch(`${getInvestorProxyUrl()}?${params}`, { headers: getHeaders() });
  if (!resp.ok) throw new Error("CSV download failed");
  const blob = await resp.blob();
  const filename = `investor_top_equities_${investor}_${market}_${startDate}_${endDate}_top${topN}.csv`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

interface InvestorTopEquitiesProps {
  initialStartDate?: Date;
  initialEndDate?: Date;
}

export function InvestorTopEquities({ initialStartDate, initialEndDate }: InvestorTopEquitiesProps) {
  const [market, setMarket] = useState("ALL");
  const [investor, setInvestor] = useState("개인");
  const [topN, setTopN] = useState(50);
  const [startDate, setStartDate] = useState<Date | undefined>(initialStartDate);
  const [endDate, setEndDate] = useState<Date | undefined>(initialEndDate);
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);

  const [queryParams, setQueryParams] = useState<{
    market: string; investor: string; startDate: string; endDate: string; topN: number;
  } | null>(null);

  const effectiveParams = useMemo(() => {
    if (queryParams) return queryParams;
    if (startDate && endDate) {
      return { market, investor, startDate: formatDate(startDate), endDate: formatDate(endDate), topN };
    }
    return null;
  }, [queryParams, startDate, endDate, market, investor, topN]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<InvestorApiResponse>({
    queryKey: ["investor-top", effectiveParams],
    queryFn: () => fetchInvestorData(
      effectiveParams!.market, effectiveParams!.investor,
      effectiveParams!.startDate, effectiveParams!.endDate, effectiveParams!.topN,
    ),
    enabled: !!effectiveParams,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const handleSearch = useCallback(() => {
    if (!startDate || !endDate) {
      toast.error("조회기간을 선택해주세요");
      return;
    }
    setQueryParams({ market, investor, startDate: formatDate(startDate), endDate: formatDate(endDate), topN });
  }, [market, investor, startDate, endDate, topN]);

  const handleQuickRange = (days: number) => {
    const end = endDate || new Date();
    if (days === 0) {
      setStartDate(end);
      setEndDate(end);
    } else {
      const start = new Date(end);
      start.setDate(start.getDate() - days);
      setStartDate(start);
      setEndDate(end);
    }
  };

  const handleDownload = useCallback(async () => {
    if (!effectiveParams) return;
    try {
      await downloadInvestorCSV(
        effectiveParams.market, effectiveParams.investor,
        effectiveParams.startDate, effectiveParams.endDate, effectiveParams.topN,
      );
      toast.success("CSV 다운로드 완료");
    } catch {
      toast.error("다운로드 실패");
    }
  }, [effectiveParams]);

  // Derive display state — all access is null-safe
  const isDisabled = isError || (data != null && data.ok === false);
  const isStale = data?.ok === true && data.stale === true;
  const items: InvestorRow[] = (data?.ok === true && Array.isArray(data.items)) ? data.items : [];
  const errorMessage = isError
    ? "서버 연결에 실패했습니다. 잠시 후 다시 시도해주세요."
    : data?.message || "KRX 제공 정책/접속 환경 문제로 최신 데이터 조회가 제한됩니다.";

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="border-b border-border bg-card">
        <div className="px-4 pt-3 pb-1">
          <h2 className="text-sm font-bold text-foreground">[INV001] 투자자별 매매 상위종목</h2>
        </div>

        <div className="px-4 py-1">
          <div className="flex items-center gap-1.5 text-[10px] text-foreground/70 bg-muted px-2 py-1 rounded border border-border">
            <Info className="w-3 h-3 shrink-0" />
            최종 매매내역은 당일 오후 6시 이후 제공됩니다
          </div>
        </div>

        {/* Filters row 1 */}
        <div className="px-4 py-2 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium shrink-0">시장구분</span>
            <RadioGroup value={market} onValueChange={setMarket} className="flex items-center gap-1.5">
              {MARKETS.map(m => (
                <div key={m.value} className="flex items-center gap-1">
                  <RadioGroupItem value={m.value} id={`mkt-${m.value}`} className="w-3.5 h-3.5" />
                  <Label htmlFor={`mkt-${m.value}`} className="text-xs cursor-pointer">{m.label}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground font-medium shrink-0">투자자</span>
            <Select value={investor} onValueChange={setInvestor}>
              <SelectTrigger className="h-7 text-xs w-[100px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {INVESTORS.map(inv => (
                  <SelectItem key={inv} value={inv} className="text-xs">{inv}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground font-medium shrink-0">Top N</span>
            <Select value={String(topN)} onValueChange={v => setTopN(Number(v))}>
              <SelectTrigger className="h-7 text-xs w-[70px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TOP_N_OPTIONS.map(n => (
                  <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Filters row 2 */}
        <div className="px-4 py-2 flex flex-wrap items-center gap-2 border-t border-border/50">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground font-medium shrink-0">조회기간</span>
            <Popover open={startOpen} onOpenChange={setStartOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("h-7 px-2 text-xs gap-1 font-normal", !startDate && "text-muted-foreground")}>
                  <CalendarIcon className="w-3 h-3" />
                  {startDate ? format(startDate, "yyyy.MM.dd", { locale: ko }) : "시작일"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={startDate} defaultMonth={startDate}
                  onSelect={(d) => { setStartDate(d); setStartOpen(false); }}
                  disabled={(d) => d > new Date() || (endDate ? d > endDate : false)}
                  className="p-3 pointer-events-auto" initialFocus />
              </PopoverContent>
            </Popover>

            <span className="text-muted-foreground">~</span>

            <Popover open={endOpen} onOpenChange={setEndOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("h-7 px-2 text-xs gap-1 font-normal", !endDate && "text-muted-foreground")}>
                  <CalendarIcon className="w-3 h-3" />
                  {endDate ? format(endDate, "yyyy.MM.dd", { locale: ko }) : "종료일"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={endDate} defaultMonth={endDate}
                  onSelect={(d) => { setEndDate(d); setEndOpen(false); }}
                  disabled={(d) => d > new Date() || (startDate ? d < startDate : false)}
                  className="p-3 pointer-events-auto" initialFocus />
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex items-center gap-1">
            {QUICK_RANGES.map(r => (
              <Button key={r.label} variant="secondary" size="sm" className="h-7 px-2 text-xs" onClick={() => handleQuickRange(r.days)}>
                {r.label}
              </Button>
            ))}
          </div>

          <Button size="sm" className="h-7 px-4 text-xs ml-auto" onClick={handleSearch} disabled={isLoading}>
            <SearchIcon className="w-3 h-3 mr-1" />
            조회
          </Button>
        </div>
      </div>

      {/* Result */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Stale banner */}
        {isStale && (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/30">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-xs text-amber-700 dark:text-amber-300 flex-1">
              {data.note || "최신 갱신 실패로 마지막 성공 데이터를 표시합니다."}
              {data.generatedAt && (
                <span className="ml-2 text-[10px] text-amber-600/70 dark:text-amber-400/70">
                  마지막 업데이트: {new Date(data.generatedAt).toLocaleString("ko-KR")}
                </span>
              )}
            </span>
            <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-600 dark:text-amber-400">캐시</Badge>
          </div>
        )}

        {/* Toolbar */}
        {!isDisabled && (
          <div className="flex items-center justify-between px-4 py-1.5 border-b border-border bg-muted/30">
            <span className="text-xs text-muted-foreground">
              {items.length > 0 ? `총 ${items.length}건${data?.totalRows ? ` (전체 ${data.totalRows}건 중 상위)` : ""}` : "조회 결과"}
            </span>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={handleDownload} disabled={items.length === 0}>
              <Download className="w-3 h-3" />
              CSV
            </Button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 15 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : isDisabled ? (
            /* ── Disabled / Error panel ── */
            <div className="flex flex-col items-center justify-center py-20 px-6">
              <div className="max-w-sm w-full rounded-lg border border-border bg-card p-6 text-center space-y-3">
                <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
                <h3 className="text-sm font-bold text-foreground">현재 데이터 소스 점검 중</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {errorMessage}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 gap-1.5"
                  onClick={() => refetch()}
                  disabled={isFetching}
                >
                  <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
                  다시 시도
                </Button>
              </div>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <p className="text-sm font-medium">데이터 없음</p>
              <p className="text-xs mt-1">해당 기간/조건에 데이터가 없습니다 (휴장/집계 미제공 가능)</p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/50 z-10">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap" style={{ width: "70px" }}>종목코드</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap" style={{ width: "150px" }}>종목명</th>
                  <th colSpan={3} className="px-3 py-1.5 text-center font-semibold text-muted-foreground border-b border-border bg-primary/5">거래량</th>
                  <th colSpan={3} className="px-3 py-1.5 text-center font-semibold text-muted-foreground border-b border-border bg-accent/50">거래대금</th>
                </tr>
                <tr className="border-b border-border">
                  <th className="px-3 py-1.5" />
                  <th className="px-3 py-1.5" />
                  <th className="px-3 py-1.5 text-right font-medium text-muted-foreground whitespace-nowrap bg-primary/5">매도</th>
                  <th className="px-3 py-1.5 text-right font-medium text-muted-foreground whitespace-nowrap bg-primary/5">매수</th>
                  <th className="px-3 py-1.5 text-right font-medium text-muted-foreground whitespace-nowrap bg-primary/5">순매수</th>
                  <th className="px-3 py-1.5 text-right font-medium text-muted-foreground whitespace-nowrap bg-accent/30">매도</th>
                  <th className="px-3 py-1.5 text-right font-medium text-muted-foreground whitespace-nowrap bg-accent/30">매수</th>
                  <th className="px-3 py-1.5 text-right font-medium text-muted-foreground whitespace-nowrap bg-accent/30">순매수</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((row, i) => (
                  <tr key={row.isuCd + i} className="hover:bg-secondary/50 transition-colors">
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">{row.isuCd}</td>
                    <td className="px-3 py-2 font-medium truncate max-w-[200px]">{row.isuNm}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNum(row.volSell)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNum(row.volBuy)}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums font-semibold", row.volNet > 0 ? "text-up" : row.volNet < 0 ? "text-down" : "text-flat")}>
                      {row.volNet > 0 ? "+" : ""}{formatNum(row.volNet)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNum(row.valSell)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNum(row.valBuy)}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums font-semibold", row.valNet > 0 ? "text-up" : row.valNet < 0 ? "text-down" : "text-flat")}>
                      {row.valNet > 0 ? "+" : ""}{formatNum(row.valNet)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

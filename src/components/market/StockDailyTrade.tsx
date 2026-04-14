import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { CalendarIcon, Search, TrendingUp, TrendingDown, Minus, Download, X, ChevronDown, ArrowUp, ArrowDown, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { fetchKrxRange, formatDate, parseNum, formatNum, formatLargeNum, getDirection } from "@/lib/krx-api";
import { StockData } from "@/types/krx";

const STOCK_MARKETS = [
  { value: "ALL", label: "전체" },
  { value: "KOSPI", label: "KOSPI" },
  { value: "KOSDAQ", label: "KOSDAQ" },
  { value: "KONEX", label: "KONEX" },
];

const MARKET_ENDPOINTS: Record<string, string> = {
  ALL: "sto/stk_bydd_trd",
  KOSPI: "sto/stk_bydd_trd",
  KOSDAQ: "sto/ksq_bydd_trd",
  KONEX: "sto/knx_bydd_trd",
};

const QUICK_RANGES = [
  { label: "1개월", days: 30 },
  { label: "3개월", days: 90 },
  { label: "6개월", days: 180 },
  { label: "1년", days: 365 },
];

const PAGE_SIZE = 50;

interface StockDailyTradeProps {
  latestDate?: string;
  onStockDetailClick?: (isuCd: string) => void;
}

export function StockDailyTrade({ latestDate, onStockDetailClick }: StockDailyTradeProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [market, setMarket] = useState("ALL");
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);

  // Query state (submitted values)
  const [queryParams, setQueryParams] = useState<{ search: string; market: string; start: string; end: string } | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [downloadOpen, setDownloadOpen] = useState(false);

  // Set default dates
  useEffect(() => {
    if (latestDate && !startDate) {
      const y = parseInt(latestDate.slice(0, 4));
      const m = parseInt(latestDate.slice(4, 6)) - 1;
      const d = parseInt(latestDate.slice(6, 8));
      const date = new Date(y, m, d);
      const start = new Date(date);
      start.setMonth(start.getMonth() - 1);
      setStartDate(start);
      setEndDate(date);
    }
  }, [latestDate, startDate]);

  const handleQuickRange = (days: number) => {
    const end = endDate || new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - days);
    setStartDate(start);
    setEndDate(end);
  };

  const handleSearch = useCallback(() => {
    if (!searchQuery.trim()) {
      toast.error("종목명 또는 종목코드를 입력하세요");
      return;
    }
    if (!startDate || !endDate) {
      toast.error("조회 기간을 선택하세요");
      return;
    }
    setQueryParams({
      search: searchQuery.trim(),
      market,
      start: formatDate(startDate),
      end: formatDate(endDate),
    });
    setVisibleCount(PAGE_SIZE);
  }, [searchQuery, market, startDate, endDate]);

  // Fetch range data
  const { data: rangeData, isLoading } = useQuery({
    queryKey: ["stockDailyTrade", queryParams],
    queryFn: async () => {
      if (!queryParams) return null;
      const endpoints = queryParams.market === "ALL"
        ? ["sto/stk_bydd_trd", "sto/ksq_bydd_trd", "sto/knx_bydd_trd"]
        : [MARKET_ENDPOINTS[queryParams.market]];

      const results = await Promise.all(
        endpoints.map(ep => fetchKrxRange<StockData>(ep, queryParams.start, queryParams.end))
      );

      const allDaily = results.flatMap(r => r.daily);
      return allDaily;
    },
    enabled: !!queryParams,
    staleTime: 10 * 60 * 1000,
  });

  // Filter by stock name/code
  const filteredData = useMemo(() => {
    if (!rangeData || !queryParams) return [];
    const q = queryParams.search.toLowerCase().replace(/[\s\-]/g, "");
    const matched = rangeData.filter((row: any) => {
      const name = (row.ISU_NM || "").toLowerCase().replace(/[\s\-]/g, "");
      const code = (row.ISU_CD || "").toLowerCase();
      return name.includes(q) || code.includes(q);
    });
    // Sort by date desc
    return matched.sort((a: any, b: any) => (b.BAS_DD || "").localeCompare(a.BAS_DD || ""));
  }, [rangeData, queryParams]);

  // Stock summary: period-based change (end vs start)
  const stockSummary = useMemo(() => {
    if (filteredData.length === 0) return null;
    const latest = filteredData[0] as any; // most recent (sorted desc)
    const earliest = filteredData[filteredData.length - 1] as any; // earliest
    const endPrice = parseNum(latest.TDD_CLSPRC);
    const startPrice = parseNum(earliest.TDD_CLSPRC);

    let change = 0;
    let rate = 0;
    let dir: "up" | "down" | "flat" = "flat";

    if (filteredData.length > 1 && startPrice !== 0) {
      change = endPrice - startPrice;
      rate = (change / startPrice) * 100;
      dir = change > 0 ? "up" : change < 0 ? "down" : "flat";
    }

    return {
      name: latest.ISU_NM,
      code: latest.ISU_CD,
      price: endPrice,
      change,
      rate,
      dir,
      isPeriod: filteredData.length > 1,
    };
  }, [filteredData]);

  function csvFromData(rows: any[]) {
    const bom = "\uFEFF";
    const cols = ["날짜", "종목명", "종목코드", "종가", "전일대비", "등락률", "거래량", "거래대금"];
    const header = cols.join(",");
    const body = rows.map((r: any) =>
      [r.BAS_DD, r.ISU_NM, r.ISU_CD, r.TDD_CLSPRC, r.CMPPREVDD_PRC, r.FLUC_RT, r.ACC_TRDVOL, r.ACC_TRDVAL]
        .map(v => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(",")
    ).join("\n");
    return bom + header + "\n" + body;
  }

  const handleDownload = (scope: "filtered" | "all") => {
    const rows = scope === "filtered" ? filteredData : rangeData || [];
    const csv = csvFromData(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `stock_daily_${queryParams?.search || ""}_${queryParams?.start || ""}_${queryParams?.end || ""}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`CSV 다운로드 완료 (${rows.length}건)`);
    setDownloadOpen(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="border-b border-border bg-card">
        <div className="px-4 pt-3 pb-1">
          <h2 className="text-sm font-bold text-foreground">[STO003] 종목 일별매매정보</h2>
        </div>

        {/* Market filter */}
        <div className="px-4 py-2 flex items-center gap-2 border-b border-border/50">
          <span className="text-xs text-muted-foreground font-medium shrink-0">시장구분</span>
          <RadioGroup value={market} onValueChange={setMarket} className="flex items-center gap-2">
            {STOCK_MARKETS.map(m => (
              <div key={m.value} className="flex items-center gap-1">
                <RadioGroupItem value={m.value} id={`sd-mkt-${m.value}`} className="w-3.5 h-3.5" />
                <Label htmlFor={`sd-mkt-${m.value}`} className="text-xs cursor-pointer">{m.label}</Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        {/* Search + Date row */}
        <div className="px-4 py-2.5 flex flex-wrap items-center gap-2">
          {/* Stock search */}
          <div className="relative flex-shrink-0 w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="종목명/종목코드"
              className="h-7 pl-8 pr-8 text-xs"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Date range */}
          <div className="flex items-center gap-1.5 text-xs">
            <Popover open={startOpen} onOpenChange={setStartOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("h-7 px-2 text-xs gap-1 font-normal", !startDate && "text-muted-foreground")}>
                  <CalendarIcon className="w-3 h-3" />
                  {startDate ? format(startDate, "yyyy.MM.dd", { locale: ko }) : "시작일"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={startDate} defaultMonth={startDate} onSelect={(d) => { setStartDate(d); setStartOpen(false); }} disabled={(d) => d > new Date() || (endDate ? d > endDate : false)} className="p-3 pointer-events-auto" initialFocus />
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
                <Calendar mode="single" selected={endDate} defaultMonth={endDate} onSelect={(d) => { setEndDate(d); setEndOpen(false); }} disabled={(d) => d > new Date() || (startDate ? d < startDate : false)} className="p-3 pointer-events-auto" initialFocus />
              </PopoverContent>
            </Popover>
          </div>

          {/* Quick range */}
          <div className="flex items-center gap-1">
            {QUICK_RANGES.map(r => (
              <Button key={r.label} variant="secondary" size="sm" className="h-7 px-2 text-xs" onClick={() => handleQuickRange(r.days)}>
                {r.label}
              </Button>
            ))}
          </div>

          <Button size="sm" className="h-7 px-4 text-xs ml-auto" onClick={handleSearch} disabled={isLoading}>
            <Search className="w-3 h-3 mr-1" />조회
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {!queryParams ? (
          <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground">
            <Search className="w-8 h-8 mb-3 opacity-30" />
            <p className="text-sm font-medium">종목명 또는 종목코드를 입력하고 조회하세요</p>
            <p className="text-xs mt-1">기간별 일별매매정보를 확인할 수 있습니다</p>
          </div>
        ) : isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : filteredData.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground">
            <p className="text-sm font-medium">"{queryParams.search}" 검색 결과가 없습니다</p>
            <p className="text-xs mt-1">종목명 또는 종목코드를 확인해 주세요</p>
          </div>
        ) : (
          <>
            {/* Stock summary */}
            {stockSummary && (
              <div className="px-4 py-3 border-b border-border bg-card">
                <div className="flex items-center gap-3">
                  <div>
                    <button
                      className="text-base font-bold text-foreground hover:text-primary hover:underline transition-colors cursor-pointer"
                      onClick={() => onStockDetailClick?.(stockSummary.code)}
                    >
                      {stockSummary.name}
                    </button>
                    <span className="text-xs text-muted-foreground ml-2">{stockSummary.code}</span>
                  </div>
                  <div className="flex items-center gap-2 ml-auto">
                    <span className="text-lg font-bold tabular-nums">{formatNum(stockSummary.price)}</span>
                    <div className="flex flex-col items-end">
                      <span className={`flex items-center gap-0.5 text-sm font-semibold tabular-nums ${stockSummary.dir === "up" ? "text-up" : stockSummary.dir === "down" ? "text-down" : "text-flat"}`}>
                        {stockSummary.dir === "up" && <TrendingUp className="w-3.5 h-3.5" />}
                        {stockSummary.dir === "down" && <TrendingDown className="w-3.5 h-3.5" />}
                        {stockSummary.dir === "flat" && <Minus className="w-3.5 h-3.5" />}
                        {stockSummary.change > 0 ? "+" : ""}{formatNum(stockSummary.change)}
                        <span className="ml-1">({stockSummary.rate > 0 ? "+" : ""}{stockSummary.rate.toFixed(2)}%)</span>
                      </span>
                      {stockSummary.isPeriod && (
                        <span className="text-[10px] text-muted-foreground mt-0.5">기간 시작 대비</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Table toolbar */}
            <div className="flex items-center justify-between px-4 py-1.5 border-b border-border bg-muted/30 gap-2">
              <span className="text-xs text-muted-foreground">총 {filteredData.length.toLocaleString()}건</span>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => setDownloadOpen(true)}>
                <Download className="w-3 h-3" />CSV
              </Button>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/50 z-10">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 font-medium text-muted-foreground text-left whitespace-nowrap">날짜</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground text-right whitespace-nowrap">종가</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground text-right whitespace-nowrap">전일대비</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground text-right whitespace-nowrap">등락률</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground text-right whitespace-nowrap">거래량</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground text-right whitespace-nowrap">거래대금</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredData.slice(0, visibleCount).map((row: any, i: number) => {
                    const change = parseNum(row.CMPPREVDD_PRC);
                    const rate = parseNum(row.FLUC_RT);
                    const dir = getDirection(row.FLUC_RT);
                    const dateStr = row.BAS_DD ? `${row.BAS_DD.slice(0,4)}.${row.BAS_DD.slice(4,6)}.${row.BAS_DD.slice(6,8)}` : "-";
                    return (
                      <tr key={i} className="hover:bg-secondary/50 transition-colors">
                        <td className="px-3 py-2 whitespace-nowrap text-left">{dateStr}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-right font-semibold tabular-nums">{formatNum(parseNum(row.TDD_CLSPRC))}</td>
                        <td className={`px-3 py-2 whitespace-nowrap text-right tabular-nums font-medium ${dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-flat"}`}>
                          {change > 0 ? "+" : ""}{formatNum(change)}
                        </td>
                        <td className={`px-3 py-2 whitespace-nowrap text-right tabular-nums font-semibold ${dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-flat"}`}>
                          {rate > 0 ? "+" : ""}{rate.toFixed(2)}%
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums">{formatLargeNum(parseNum(row.ACC_TRDVOL))}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums">{formatLargeNum(parseNum(row.ACC_TRDVAL))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {visibleCount < filteredData.length && (
                <button
                  onClick={() => setVisibleCount(v => v + PAGE_SIZE)}
                  className="w-full py-3 text-xs text-primary font-medium hover:bg-secondary/50 flex items-center justify-center gap-1 border-t border-border"
                >
                  더보기 ({filteredData.length - visibleCount}건 남음)
                  <ChevronDown className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Download dialog */}
            <Dialog open={downloadOpen} onOpenChange={setDownloadOpen}>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader><DialogTitle>CSV 다운로드</DialogTitle></DialogHeader>
                <div className="space-y-2 pt-2">
                  <button onClick={() => handleDownload("filtered")} className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-secondary/50 transition-colors text-left">
                    <Download className="w-5 h-5 text-primary shrink-0" />
                    <div>
                      <div className="text-sm font-medium">다운로드</div>
                      <div className="text-xs text-muted-foreground">{filteredData.length.toLocaleString()}건</div>
                    </div>
                  </button>
                </div>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    </div>
  );
}

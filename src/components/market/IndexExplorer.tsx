import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, Search, X, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface IndexItem {
  indexTicker: string;
  indexName: string;
  groupId: string;
  shortCode: string;
  marketName: string;
}

interface ComponentItem {
  stockTicker: string;
  stockName: string;
}

async function fetchViaUrl(action: string, params: Record<string, string>) {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const base = `https://${projectId}.supabase.co/functions/v1/pykrx-proxy`;
  const qs = new URLSearchParams({ action, ...params }).toString();
  const resp = await fetch(`${base}?${qs}`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
  });
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json();
}

export function IndexExplorer() {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [market, setMarket] = useState("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedIndex, setSelectedIndex] = useState<IndexItem | null>(null);
  const [compSearch, setCompSearch] = useState("");

  // Debounce
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = useCallback((val: string) => {
    setSearchQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setDebouncedQuery(val);
      setPage(1);
    }, 250);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // Fetch index list
  const { data: indexData, isLoading: indexLoading } = useQuery({
    queryKey: ["pykrx-indexes", market, debouncedQuery, page, pageSize],
    queryFn: () =>
      fetchViaUrl("list", { market, q: debouncedQuery, page: String(page), pageSize: String(pageSize) }),
    staleTime: 24 * 60 * 60 * 1000,
  });

  const indexItems: IndexItem[] = indexData?.items || [];
  const totalItems: number = indexData?.total || 0;
  const totalPages = Math.ceil(totalItems / pageSize);

  // Fetch components
  const { data: compData, isLoading: compLoading } = useQuery({
    queryKey: ["pykrx-components", selectedIndex?.groupId, selectedIndex?.shortCode],
    queryFn: () =>
      fetchViaUrl("components", {
        ticker: selectedIndex!.shortCode,
        groupId: selectedIndex!.groupId,
        indexName: selectedIndex!.indexName,
      }),
    enabled: !!selectedIndex,
    staleTime: 24 * 60 * 60 * 1000,
  });

  const components: ComponentItem[] = useMemo(() => compData?.components || [], [compData]);
  const compNote: string | undefined = compData?.note;

  const filteredComponents = useMemo(() => {
    if (!compSearch.trim()) return components;
    const q = compSearch.trim().toLowerCase();
    return components.filter(
      (c) => c.stockName.toLowerCase().includes(q) || c.stockTicker.toLowerCase().includes(q)
    );
  }, [components, compSearch]);

  const handleCSVDownload = useCallback(() => {
    if (!selectedIndex || components.length === 0) return;
    const BOM = "\uFEFF";
    const header = "종목코드,종목명";
    const body = components.map((c) => `${c.stockTicker},${c.stockName}`).join("\n");
    const blob = new Blob([BOM + header + "\n" + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `index_${selectedIndex.indexTicker}_components.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV 다운로드 완료");
  }, [selectedIndex, components]);

  const markets = [
    { value: "ALL", label: "전체" },
    { value: "KOSPI", label: "KOSPI" },
    { value: "KOSDAQ", label: "KOSDAQ" },
    { value: "KRX", label: "KRX" },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="shrink-0 border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-foreground mr-1">
            [PXI001] 인덱스 목록/구성종목
          </span>
          <div className="flex items-center gap-1 ml-2">
            {markets.map((m) => (
              <button
                key={m.value}
                onClick={() => { setMarket(m.value); setPage(1); }}
                className={cn(
                  "px-2.5 py-1 text-xs rounded-md transition-colors",
                  market === m.value
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:bg-secondary"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-56">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="인덱스명 검색"
              className="h-8 pl-8 pr-8 text-xs"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(""); setDebouncedQuery(""); setPage(1); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            className="h-8 text-xs border border-input rounded-md bg-background px-2"
          >
            <option value={50}>50개</option>
            <option value={100}>100개</option>
          </select>
        </div>
      </div>

      {/* Main 2-column layout */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left: Index list */}
        <div className="w-1/2 border-r border-border flex flex-col min-h-0">
          <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              인덱스 목록 ({totalItems}건)
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="h-6 text-xs px-2">이전</Button>
                <span className="text-xs text-muted-foreground">{page}/{totalPages}</span>
                <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="h-6 text-xs px-2">다음</Button>
              </div>
            )}
          </div>
          <ScrollArea className="flex-1">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground w-20">티커</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">인덱스명</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground w-16">시장</th>
                </tr>
              </thead>
              <tbody>
                {indexLoading
                  ? Array.from({ length: 10 }).map((_, i) => (
                      <tr key={i} className="border-b border-border">
                        <td className="px-3 py-1.5"><div className="h-3 w-12 bg-muted animate-pulse rounded" /></td>
                        <td className="px-3 py-1.5"><div className="h-3 w-32 bg-muted animate-pulse rounded" /></td>
                        <td className="px-3 py-1.5"><div className="h-3 w-10 bg-muted animate-pulse rounded" /></td>
                      </tr>
                    ))
                  : indexItems.length === 0
                  ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-8 text-center text-muted-foreground">데이터 없음</td>
                    </tr>
                  )
                  : indexItems.map((item) => (
                      <tr
                        key={`${item.groupId}-${item.indexTicker}`}
                        onClick={() => { setSelectedIndex(item); setCompSearch(""); }}
                        className={cn(
                          "border-b border-border cursor-pointer transition-colors",
                          selectedIndex?.indexTicker === item.indexTicker && selectedIndex?.groupId === item.groupId
                            ? "bg-primary/10 font-medium"
                            : "hover:bg-muted/40"
                        )}
                      >
                        <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{item.indexTicker}</td>
                        <td className="px-3 py-1.5 text-foreground">{item.indexName}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{item.marketName}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </ScrollArea>
        </div>

        {/* Right: Components panel */}
        <div className="w-1/2 flex flex-col min-h-0">
          {!selectedIndex ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
              좌측에서 인덱스를 선택하세요
            </div>
          ) : (
            <>
              <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-bold text-foreground truncate">
                    {selectedIndex.indexName}
                  </span>
                  {!compLoading && components.length > 0 && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {components.length}종목
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {components.length > 0 && (
                    <>
                      <div className="relative w-36">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                        <Input
                          value={compSearch}
                          onChange={(e) => setCompSearch(e.target.value)}
                          placeholder="종목 검색"
                          className="h-7 pl-7 text-xs"
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-7 h-7"
                        onClick={handleCSVDownload}
                        title="CSV 다운로드"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {compLoading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-3 bg-muted animate-pulse rounded w-3/4" />
                  ))}
                </div>
              ) : compNote && components.length === 0 ? (
                <div className="flex-1 flex items-center justify-center p-6">
                  <div className="text-center space-y-2 max-w-xs">
                    <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto" />
                    <p className="text-xs text-muted-foreground">{compNote}</p>
                  </div>
                </div>
              ) : (
                <ScrollArea className="flex-1">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-card z-10">
                      <tr className="border-b border-border">
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground w-20">종목코드</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">종목명</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredComponents.length === 0 ? (
                        <tr>
                          <td colSpan={2} className="px-3 py-8 text-center text-muted-foreground">구성종목 없음</td>
                        </tr>
                      ) : (
                        filteredComponents.map((c) => (
                          <tr key={c.stockTicker} className="border-b border-border last:border-0 hover:bg-muted/30">
                            <td className="px-3 py-1.5 text-foreground tabular-nums">{c.stockTicker}</td>
                            <td className="px-3 py-1.5 text-foreground">{c.stockName}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </ScrollArea>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

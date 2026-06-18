import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, Search, X, AlertCircle, RefreshCw, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ThemeItem {
  themeNo: number;
  themeName: string;
  stockCount: number;
  updatedAt: string | null;
}

interface ThemeComponentItem {
  stockTicker: string;
  stockName: string;
  rankNo: number;
}

interface ThemeSyncStatus {
  last_attempt_at?: string | null;
  last_success_at?: string | null;
  last_error?: string | null;
  theme_count?: number;
  stock_count?: number;
}

interface ThemeListResponse {
  items: ThemeItem[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt?: string | null;
  syncStatus?: ThemeSyncStatus | null;
}

interface ThemeComponentsResponse {
  themeNo: number;
  themeName: string;
  stockCount: number;
  updatedAt?: string | null;
  components: ThemeComponentItem[];
  syncStatus?: ThemeSyncStatus | null;
}

function getProxyBaseUrl() {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  return `https://${projectId}.supabase.co/functions/v1/pykrx-proxy`;
}

function getHeaders() {
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
  };
}

async function fetchViaUrl<T>(action: string, params: Record<string, string>) {
  const qs = new URLSearchParams({ action, ...params }).toString();
  const response = await fetch(`${getProxyBaseUrl()}?${qs}`, {
    headers: getHeaders(),
  });
  const json = await response.json().catch(() => ({ error: `API error: ${response.status}` }));
  if (!response.ok) {
    throw new Error(json.error || `API error: ${response.status}`);
  }
  return json as T;
}

async function syncThemes() {
  return fetchViaUrl<{ ok: boolean; synced: boolean; status?: ThemeSyncStatus | null }>("sync", {});
}

export function IndexExplorer() {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedTheme, setSelectedTheme] = useState<ThemeItem | null>(null);
  const [compSearch, setCompSearch] = useState("");

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setDebouncedQuery(value);
      setPage(1);
    }, 250);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const {
    data: themeData,
    isLoading: themeLoading,
    refetch: refetchThemes,
    isFetching: themesFetching,
  } = useQuery<ThemeListResponse>({
    queryKey: ["naver-themes", debouncedQuery, page, pageSize],
    queryFn: () =>
      fetchViaUrl<ThemeListResponse>("list", {
        q: debouncedQuery,
        page: String(page),
        pageSize: String(pageSize),
      }),
    staleTime: 60 * 60 * 1000,
  });

  const themeItems = themeData?.items || [];
  const totalItems = themeData?.total || 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const {
    data: componentData,
    isLoading: compLoading,
    refetch: refetchComponents,
    isFetching: compFetching,
  } = useQuery<ThemeComponentsResponse>({
    queryKey: ["naver-theme-components", selectedTheme?.themeNo],
    queryFn: () =>
      fetchViaUrl<ThemeComponentsResponse>("components", {
        themeNo: String(selectedTheme!.themeNo),
      }),
    enabled: !!selectedTheme,
    staleTime: 60 * 60 * 1000,
  });

  const components = useMemo(() => componentData?.components || [], [componentData]);
  const filteredComponents = useMemo(() => {
    if (!compSearch.trim()) return components;
    const q = compSearch.trim().toLowerCase();
    return components.filter(
      (item) => item.stockName.toLowerCase().includes(q) || item.stockTicker.toLowerCase().includes(q),
    );
  }, [components, compSearch]);

  const handleSync = useCallback(async () => {
    try {
      const result = await syncThemes();
      await refetchThemes();
      if (selectedTheme) await refetchComponents();
      toast.success(result.synced ? "테마 데이터를 새로 수집했습니다" : "최신 테마 데이터를 확인했습니다");
    } catch (error) {
      toast.error((error as Error).message || "테마 데이터 갱신에 실패했습니다");
    }
  }, [refetchThemes, refetchComponents, selectedTheme]);

  const handleCSVDownload = useCallback(() => {
    if (!selectedTheme || filteredComponents.length === 0) return;
    const BOM = "\uFEFF";
    const header = "테마번호,테마명,순번,종목코드,종목명";
    const body = filteredComponents
      .map((item) =>
        [selectedTheme.themeNo, selectedTheme.themeName, item.rankNo, item.stockTicker, item.stockName].join(","),
      )
      .join("\n");
    const blob = new Blob([BOM + header + "\n" + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `theme_${selectedTheme.themeNo}_stocks.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("CSV 다운로드 완료");
  }, [filteredComponents, selectedTheme]);

  const updatedAt =
    componentData?.updatedAt || themeData?.generatedAt || themeData?.syncStatus?.last_success_at || null;

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 border-b border-border bg-card px-4 py-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-foreground mr-1">[PXI001] 네이버금융 테마/편입종목</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="h-8 text-xs border border-input rounded-md bg-background px-2 ml-auto"
          >
            <option value={50}>50개</option>
            <option value={100}>100개</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={handleSync}
            disabled={themesFetching || compFetching}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", (themesFetching || compFetching) && "animate-spin")} />
            업데이트 확인
          </Button>
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>네이버금융 테마를 기준으로 주 1회 자동 갱신합니다. 수동 확인 시 최신성만 점검합니다.</span>
          <span>
            {updatedAt ? `마지막 갱신: ${new Date(updatedAt).toLocaleString("ko-KR")}` : "마지막 갱신 정보 없음"}
          </span>
        </div>
      </div>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="w-1/2 border-r border-border flex flex-col min-h-0">
          <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">테마 목록 ({totalItems}건)</span>
            <div className="relative w-36">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="테마명 검색"
                className="h-7 pl-7 text-xs"
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setDebouncedQuery("");
                    setPage(1);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          <ScrollArea className="flex-1">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground w-16">번호</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">테마명</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground w-16">종목수</th>
                </tr>
              </thead>
              <tbody>
                {themeLoading ? (
                  Array.from({ length: 10 }).map((_, index) => (
                    <tr key={index} className="border-b border-border">
                      <td className="px-3 py-1.5">
                        <Skeleton className="h-3 w-8" />
                      </td>
                      <td className="px-3 py-1.5">
                        <Skeleton className="h-3 w-32" />
                      </td>
                      <td className="px-3 py-1.5">
                        <Skeleton className="h-3 w-10" />
                      </td>
                    </tr>
                  ))
                ) : themeItems.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center text-muted-foreground">
                      테마 데이터 없음
                    </td>
                  </tr>
                ) : (
                  themeItems.map((item) => (
                    <tr
                      key={item.themeNo}
                      onClick={() => {
                        setSelectedTheme(item);
                        setCompSearch("");
                      }}
                      className={cn(
                        "border-b border-border cursor-pointer transition-colors",
                        selectedTheme?.themeNo === item.themeNo ? "bg-primary/10 font-medium" : "hover:bg-muted/40",
                      )}
                    >
                      <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{item.themeNo}</td>
                      <td className="px-3 py-1.5 text-foreground">{item.themeName}</td>
                      <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{item.stockCount}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ScrollArea>
          {totalPages > 1 && (
            <div className="px-4 py-2 border-t border-border bg-muted/30 flex items-center justify-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((prev) => prev - 1)}
                className="h-6 text-xs px-2"
              >
                이전
              </Button>
              <span className="text-xs text-muted-foreground">
                {page}/{totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((prev) => prev + 1)}
                className="h-6 text-xs px-2"
              >
                다음
              </Button>
            </div>
          )}
        </div>

        <div className="w-1/2 flex flex-col min-h-0">
          {!selectedTheme ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
              좌측에서 테마를 선택하세요
            </div>
          ) : (
            <>
              <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Tag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs font-bold text-foreground truncate">{selectedTheme.themeName}</span>
                  {!compLoading && components.length > 0 && (
                    <span className="text-xs text-muted-foreground shrink-0">{components.length}종목</span>
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
                  {Array.from({ length: 6 }).map((_, index) => (
                    <Skeleton key={index} className="h-4 w-3/4" />
                  ))}
                </div>
              ) : components.length === 0 ? (
                <div className="flex-1 flex items-center justify-center p-6">
                  <div className="text-center space-y-2 max-w-xs">
                    <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto" />
                    <p className="text-xs text-muted-foreground">
                      테마 편입 종목이 없습니다. 수집이 아직 완료되지 않았을 수 있습니다.
                    </p>
                  </div>
                </div>
              ) : (
                <ScrollArea className="flex-1">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-card z-10">
                      <tr className="border-b border-border">
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground w-12">순번</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground w-20">종목코드</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">종목명</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredComponents.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-3 py-8 text-center text-muted-foreground">
                            검색 결과 없음
                          </td>
                        </tr>
                      ) : (
                        filteredComponents.map((item) => (
                          <tr
                            key={`${item.stockTicker}-${item.rankNo}`}
                            className="border-b border-border last:border-0 hover:bg-muted/30"
                          >
                            <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{item.rankNo}</td>
                            <td className="px-3 py-1.5 text-foreground tabular-nums">{item.stockTicker}</td>
                            <td className="px-3 py-1.5 text-foreground">{item.stockName}</td>
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

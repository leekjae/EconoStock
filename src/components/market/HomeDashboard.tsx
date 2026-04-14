import { useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { fetchKrx, parseNum, formatNum, getDirection } from "@/lib/krx-api";
import { IndexData, KRX_ENDPOINTS } from "@/types/krx";
import { IndexCard } from "./IndexCard";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// ── Component ──
interface HomeDashboardProps {
  basDd: string | undefined;
  dateLoading: boolean;
}

/** Generate N calendar dates going backwards from basDd (YYYYMMDD) */
function generatePastDates(basDd: string, calendarDays: number): string[] {
  const y = Number(basDd.slice(0, 4));
  const m = Number(basDd.slice(4, 6)) - 1;
  const d = Number(basDd.slice(6, 8));
  const end = new Date(y, m, d);
  const dates: string[] = [];
  for (let i = 0; i < calendarDays; i++) {
    const dt = new Date(end);
    dt.setDate(dt.getDate() - i);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    dates.push(`${yy}${mm}${dd}`);
  }
  return dates; // newest first
}

export function HomeDashboard({ basDd, dateLoading }: HomeDashboardProps) {
  // Generate ~20 calendar days to ensure we get 10 business days
  const datesToFetch = useMemo(() => (basDd ? generatePastDates(basDd, 20) : []), [basDd]);

  // ── Fetch KOSPI index for each date ──
  const kospiQueries = useQueries({
    queries: datesToFetch.map((dd) => ({
      queryKey: ["index", "kospi", dd],
      queryFn: () => fetchKrx<IndexData>(KRX_ENDPOINTS.kospi_index, dd),
      enabled: !!basDd,
      staleTime: 6 * 60 * 60 * 1000,
      retry: 1,
    })),
  });

  const kosdaqQueries = useQueries({
    queries: datesToFetch.map((dd) => ({
      queryKey: ["index", "kosdaq", dd],
      queryFn: () => fetchKrx<IndexData>(KRX_ENDPOINTS.kosdaq_index, dd),
      enabled: !!basDd,
      staleTime: 6 * 60 * 60 * 1000,
      retry: 1,
    })),
  });

  // Extract history rows for a specific index name, limited to 10 business days
  const extractHistory = (queries: typeof kospiQueries, indexName: string): IndexHistoryRow[] => {
    const rows: IndexHistoryRow[] = [];
    for (const q of queries) {
      if (!q.data || q.data.length === 0) continue;
      const found = q.data.find((d) => d.IDX_NM === indexName);
      if (found) {
        rows.push({
          date: found.BAS_DD,
          close: parseNum(found.CLSPRC_IDX),
          change: parseNum(found.CMPPREVDD_IDX),
          changeRate: parseNum(found.FLUC_RT),
        });
      }
      if (rows.length >= 10) break;
    }
    return rows;
  };

  const kospiHistory = useMemo(() => extractHistory(kospiQueries, "코스피"), [kospiQueries]);
  const kosdaqHistory = useMemo(() => extractHistory(kosdaqQueries, "코스닥"), [kosdaqQueries]);
  const kospi200History = useMemo(() => extractHistory(kospiQueries, "코스피 200"), [kospiQueries]);

  // Main index cards (latest day)
  const kospiMain = kospiHistory[0];
  const kosdaqMain = kosdaqHistory[0];
  const kospi200Main = kospi200History[0];

  const isLoading = dateLoading || kospiQueries.some((q) => q.isLoading) || kosdaqQueries.some((q) => q.isLoading);

  // Chart data (reverse to show oldest→newest)
  const chartData = useMemo(() => {
    const map = new Map<string, { date: string; KOSPI?: number; KOSDAQ?: number; KOSPI200?: number }>();
    for (const r of kospiHistory) map.set(r.date, { date: r.date, KOSPI: r.close });
    for (const r of kosdaqHistory) {
      const existing = map.get(r.date) || { date: r.date };
      existing.KOSDAQ = r.close;
      map.set(r.date, existing);
    }
    for (const r of kospi200History) {
      const existing = map.get(r.date) || { date: r.date };
      existing.KOSPI200 = r.close;
      map.set(r.date, existing);
    }
    return Array.from(map.values()).reverse();
  }, [kospiHistory, kosdaqHistory, kospi200History]);

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-lg font-bold text-foreground">KRX 시장현황 대시보드</h1>
      </div>

      {/* Index Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <IndexCardFromHistory row={kospiMain} label="KOSPI" isLoading={isLoading} />
        <IndexCardFromHistory row={kosdaqMain} label="KOSDAQ" isLoading={isLoading} />
        <IndexCardFromHistory row={kospi200Main} label="KOSPI200" isLoading={isLoading} />
      </div>

      {/* Index Charts – 3-column grid */}
      {chartData.length > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <SingleIndexChart title="KOSPI" data={chartData} dataKey="KOSPI" stroke="#2563eb" />
          <SingleIndexChart title="KOSDAQ" data={chartData} dataKey="KOSDAQ" stroke="#10b981" />
          <SingleIndexChart title="KOSPI200" data={chartData} dataKey="KOSPI200" stroke="#f59e0b" />
        </div>
      )}

      {/* 최근 10영업일 이력 */}
      <section>
        {/* <h2 className="text-sm font-bold text-foreground mb-3">최근 10영업일</h2> */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <HistoryTable title="KOSPI" rows={kospiHistory} isLoading={isLoading} />
          <HistoryTable title="KOSDAQ" rows={kosdaqHistory} isLoading={isLoading} />
          <HistoryTable title="KOSPI200" rows={kospi200History} isLoading={isLoading} />
        </div>
      </section>
    </div>
  );
}

// ── Single Index Chart ──
function SingleIndexChart({
  title,
  data,
  dataKey,
  stroke,
}: {
  title: string;
  data: { date: string; KOSPI?: number; KOSDAQ?: number; KOSPI200?: number }[];
  dataKey: string;
  stroke: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-xs font-bold text-foreground mb-3">{title}</h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10 }}
            stroke="hsl(var(--muted-foreground))"
            tickFormatter={(v: string) => `${v.slice(4, 6)}.${v.slice(6, 8)}`}
          />
          <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            labelFormatter={(v: string) => `${v.slice(0, 4)}.${v.slice(4, 6)}.${v.slice(6, 8)}`}
          />
          <Line type="monotone" dataKey={dataKey} stroke={stroke} dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Types ──
interface IndexHistoryRow {
  date: string;
  close: number;
  change: number;
  changeRate: number;
}

// ── IndexCard from history row ──
function IndexCardFromHistory({
  row,
  label,
  isLoading,
}: {
  row: IndexHistoryRow | undefined;
  label: string;
  isLoading: boolean;
}) {
  if (isLoading || !row) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-3 w-16" />
      </div>
    );
  }

  const dir = getDirection(row.change);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
      <div className="mt-1 text-xl font-bold tabular-nums text-foreground">{formatNum(row.close)}</div>
      <div
        className={cn(
          "text-xs tabular-nums mt-0.5",
          dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-flat",
        )}
      >
        {row.change > 0 ? "+" : ""}
        {formatNum(row.change)} ({row.changeRate > 0 ? "+" : ""}
        {row.changeRate.toFixed(2)}%)
      </div>
    </div>
  );
}

// ── History Table ──
function HistoryTable({ title, rows, isLoading }: { title: string; rows: IndexHistoryRow[]; isLoading: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-xs font-bold text-foreground">{title}</h3>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">날짜</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">종가</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">전일대비</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">등락률</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border">
                  <td className="px-3 py-1.5">
                    <Skeleton className="h-3 w-16" />
                  </td>
                  <td className="px-3 py-1.5">
                    <Skeleton className="h-3 w-14 ml-auto" />
                  </td>
                  <td className="px-3 py-1.5">
                    <Skeleton className="h-3 w-12 ml-auto" />
                  </td>
                  <td className="px-3 py-1.5">
                    <Skeleton className="h-3 w-12 ml-auto" />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">
                  데이터 없음
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const dir = getDirection(r.change);
                const colorClass = dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-muted-foreground";
                return (
                  <tr key={r.date} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-1.5 text-foreground">
                      {r.date.slice(0, 4)}.{r.date.slice(4, 6)}.{r.date.slice(6, 8)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-foreground font-medium">
                      {Number(r.close).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className={cn("px-3 py-1.5 text-right tabular-nums font-medium", colorClass)}>
                      {r.change > 0 ? "+" : ""}
                      {Number(r.change).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className={cn("px-3 py-1.5 text-right tabular-nums font-medium", colorClass)}>
                      {r.changeRate > 0 ? "+" : ""}
                      {r.changeRate.toFixed(2)}%
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

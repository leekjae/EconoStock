import { parseNum, getDirection, formatNum, formatLargeNum } from "@/lib/krx-api";
import { IndexData } from "@/types/krx";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface IndexCardProps {
  data: IndexData | undefined;
  isLoading: boolean;
  label?: string;
}

export function IndexCard({ data, isLoading, label }: IndexCardProps) {
  if (isLoading || !data) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-20" />
      </div>
    );
  }

  const dir = getDirection(data.FLUC_RT);
  const price = parseNum(data.CLSPRC_IDX);
  const change = parseNum(data.CMPPREVDD_IDX);
  const rate = parseNum(data.FLUC_RT);
  const volume = parseNum(data.ACC_TRDVAL);

  return (
    <div className="rounded-2xl border border-border bg-card p-5 hover:shadow-md transition-shadow cursor-pointer">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-muted-foreground">
          {label || data.IDX_NM}
        </span>
        <span className="text-xs text-muted-foreground">{data.BAS_DD}</span>
      </div>

      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-2xl font-bold tabular-nums tracking-tight">
          {formatNum(price)}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <div
          className={`flex items-center gap-1 text-sm font-semibold tabular-nums ${
            dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-flat"
          }`}
        >
          {dir === "up" && <TrendingUp className="w-3.5 h-3.5" />}
          {dir === "down" && <TrendingDown className="w-3.5 h-3.5" />}
          {dir === "flat" && <Minus className="w-3.5 h-3.5" />}
          <span>
            {change > 0 ? "+" : ""}
            {formatNum(change)}
          </span>
          <span>
            ({rate > 0 ? "+" : ""}
            {rate.toFixed(2)}%)
          </span>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-border">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>거래대금</span>
          <span className="tabular-nums font-medium">{formatLargeNum(volume)}</span>
        </div>
      </div>

      {/* Chart placeholder */}
      <div className="mt-3 h-16 rounded-lg bg-muted/50 flex items-center justify-center">
        <span className="text-xs text-muted-foreground">차트 영역</span>
      </div>
    </div>
  );
}

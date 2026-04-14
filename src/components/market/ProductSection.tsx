import { useState, useMemo } from "react";
import { ProductType, ETFData, ETNData, ELWData, GoldData, OilData } from "@/types/krx";
import { parseNum, formatNum, formatLargeNum, getDirection } from "@/lib/krx-api";
import { useETFData, useETNData, useELWData, useGoldData, useOilData } from "@/hooks/useKrxData";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown } from "lucide-react";

const PRODUCT_TABS: { label: string; value: ProductType }[] = [
  { label: "ETF", value: "ETF" },
  { label: "ETN", value: "ETN" },
  { label: "ELW", value: "ELW" },
  { label: "금", value: "GOLD" },
  { label: "석유", value: "OIL" },
];

const PAGE_SIZE = 50;

interface ProductSectionProps {
  basDd: string | undefined;
}

export function ProductSection({ basDd }: ProductSectionProps) {
  const [tab, setTab] = useState<ProductType>("ETF");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const etf = useETFData(tab === "ETF" ? basDd : undefined);
  const etn = useETNData(tab === "ETN" ? basDd : undefined);
  const elw = useELWData(tab === "ELW" ? basDd : undefined);
  const gold = useGoldData(tab === "GOLD" ? basDd : undefined);
  const oil = useOilData(tab === "OIL" ? basDd : undefined);

  const isLoading =
    (tab === "ETF" && etf.isLoading) ||
    (tab === "ETN" && etn.isLoading) ||
    (tab === "ELW" && elw.isLoading) ||
    (tab === "GOLD" && gold.isLoading) ||
    (tab === "OIL" && oil.isLoading);

  const handleTabChange = (t: ProductType) => {
    setTab(t);
    setVisibleCount(PAGE_SIZE);
  };

  return (
    <div>
      {/* Product tabs */}
      <div className="flex gap-1 px-4 py-3 overflow-x-auto scrollbar-hide">
        {PRODUCT_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => handleTabChange(t.value)}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              tab === t.value
                ? "bg-foreground text-background"
                : "bg-secondary text-muted-foreground hover:bg-accent"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3 p-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : tab === "OIL" ? (
        <OilTable data={oil.data ?? []} />
      ) : (
        <GenericProductList
          tab={tab}
          data={
            tab === "ETF"
              ? etf.data ?? []
              : tab === "ETN"
              ? etn.data ?? []
              : tab === "ELW"
              ? elw.data ?? []
              : gold.data ?? []
          }
          visibleCount={visibleCount}
          onLoadMore={() => setVisibleCount((v) => v + PAGE_SIZE)}
        />
      )}
    </div>
  );
}

function GenericProductList({
  tab,
  data,
  visibleCount,
  onLoadMore,
}: {
  tab: ProductType;
  data: (ETFData | ETNData | ELWData | GoldData)[];
  visibleCount: number;
  onLoadMore: () => void;
}) {
  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const aVol = parseNum(a.ACC_TRDVAL);
      const bVol = parseNum(b.ACC_TRDVAL);
      return bVol - aVol;
    });
  }, [data]);

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <p className="text-lg font-medium">데이터 없음</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-[1fr_100px_80px_80px] gap-2 px-4 py-2 text-xs text-muted-foreground border-b border-border">
        <span>종목</span>
        <span className="text-right">현재가</span>
        <span className="text-right">등락률</span>
        <span className="text-right">거래대금</span>
      </div>
      <div className="divide-y divide-border">
        {sorted.slice(0, visibleCount).map((item, i) => {
          const name = "ISU_NM" in item ? item.ISU_NM : "";
          const code = "ISU_CD" in item ? item.ISU_CD : "";
          const price = parseNum(item.TDD_CLSPRC);
          const flucRt =
            "FLUC_RT" in item ? parseNum((item as ETFData | ETNData | GoldData).FLUC_RT) : 0;
          const dir = flucRt > 0 ? "up" : flucRt < 0 ? "down" : "flat";
          const trdval = parseNum(item.ACC_TRDVAL);

          return (
            <div
              key={`${code}-${i}`}
              className="grid grid-cols-[1fr_100px_80px_80px] gap-2 px-4 py-3 hover:bg-secondary/50 transition-colors"
            >
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{code}</div>
              </div>
              <div className="text-right tabular-nums text-sm font-semibold self-center">
                {formatNum(price)}
              </div>
              <div
                className={`text-right tabular-nums text-sm font-semibold self-center ${
                  dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-flat"
                }`}
              >
                {flucRt > 0 ? "+" : ""}
                {flucRt.toFixed(2)}%
              </div>
              <div className="text-right tabular-nums text-xs text-muted-foreground self-center">
                {formatLargeNum(trdval)}
              </div>
            </div>
          );
        })}
      </div>
      {visibleCount < sorted.length && (
        <button
          onClick={onLoadMore}
          className="w-full py-4 text-sm text-primary font-medium hover:bg-secondary/50 flex items-center justify-center gap-1"
        >
          더보기 ({sorted.length - visibleCount}개 남음)
          <ChevronDown className="w-4 h-4" />
        </button>
      )}
    </>
  );
}

function OilTable({ data }: { data: OilData[] }) {
  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <p className="text-lg font-medium">데이터 없음</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-[1fr_100px_100px_80px] gap-2 px-4 py-2 text-xs text-muted-foreground border-b border-border">
        <span>유종</span>
        <span className="text-right">경쟁 가중평균</span>
        <span className="text-right">협의 가중평균</span>
        <span className="text-right">거래량</span>
      </div>
      <div className="divide-y divide-border">
        {data.map((item, i) => (
          <div
            key={i}
            className="grid grid-cols-[1fr_100px_100px_80px] gap-2 px-4 py-3"
          >
            <div className="font-medium text-sm">{item.OIL_NM}</div>
            <div className="text-right tabular-nums text-sm font-semibold">
              {formatNum(parseNum(item.WT_AVG_PRC))}
            </div>
            <div className="text-right tabular-nums text-sm">
              {formatNum(parseNum(item.WT_DIS_AVG_PRC))}
            </div>
            <div className="text-right tabular-nums text-xs text-muted-foreground">
              {formatLargeNum(parseNum(item.ACC_TRDVOL))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

import { useState, useMemo, useCallback } from "react";
import { StockData, MarketType, SortCriteria, SECTOR_COLORS } from "@/types/krx";
import { parseNum, formatNum, formatLargeNum, getDirection } from "@/lib/krx-api";
import { AggregatedData } from "@/lib/krx-api";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus, ChevronDown } from "lucide-react";
import { DownloadButton } from "./DownloadButton";
import { KRX_ENDPOINTS } from "@/types/krx";

type DateModeType = "single" | "range";
type RangeSortCriteria = "PERIOD_CHANGE_DESC" | "PERIOD_CHANGE_ASC" | "TOTAL_VOLUME" | "TOTAL_VALUE" | "VOLATILITY";

interface RankingSectionProps {
  allStocks: StockData[];
  kospiStocks: StockData[];
  kosdaqStocks: StockData[];
  konexStocks: StockData[];
  isLoading: boolean;
  onStockClick: (stock: StockData) => void;
  // Range mode
  dateMode: DateModeType;
  rangeAggregation?: AggregatedData[];
  rangeLoading?: boolean;
  basDd?: string;
  startDate?: string;
  endDate?: string;
}

const MARKET_TABS: { label: string; value: MarketType }[] = [
  { label: "전체", value: "ALL" },
  { label: "KOSPI", value: "KOSPI" },
  { label: "KOSDAQ", value: "KOSDAQ" },
  { label: "KONEX", value: "KONEX" },
];

const SORT_TABS: { label: string; value: SortCriteria }[] = [
  { label: "등락률 ↑", value: "FLUC_RT_DESC" },
  { label: "등락률 ↓", value: "FLUC_RT_ASC" },
  { label: "거래량", value: "ACC_TRDVOL" },
  { label: "거래대금", value: "ACC_TRDVAL" },
  { label: "시가총액", value: "MKTCAP" },
];

const RANGE_SORT_TABS: { label: string; value: RangeSortCriteria }[] = [
  { label: "변동률 ↑", value: "PERIOD_CHANGE_DESC" },
  { label: "변동률 ↓", value: "PERIOD_CHANGE_ASC" },
  { label: "거래량합", value: "TOTAL_VOLUME" },
  { label: "거래대금합", value: "TOTAL_VALUE" },
  { label: "변동성", value: "VOLATILITY" },
];

const PAGE_SIZE = 50;

export function RankingSection({
  allStocks,
  kospiStocks,
  kosdaqStocks,
  konexStocks,
  isLoading,
  onStockClick,
  dateMode,
  rangeAggregation,
  rangeLoading,
  basDd,
  startDate,
  endDate,
}: RankingSectionProps) {
  const [market, setMarket] = useState<MarketType>("ALL");
  const [sort, setSort] = useState<SortCriteria>("FLUC_RT_DESC");
  const [rangeSort, setRangeSort] = useState<RangeSortCriteria>("PERIOD_CHANGE_DESC");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [rangeTab, setRangeTab] = useState<"daily" | "summary">("summary");

  // Single mode stocks
  const stocks = useMemo(() => {
    const list =
      market === "ALL" ? allStocks
      : market === "KOSPI" ? kospiStocks
      : market === "KOSDAQ" ? kosdaqStocks
      : konexStocks;

    return [...list].sort((a, b) => {
      switch (sort) {
        case "FLUC_RT_DESC": return parseNum(b.FLUC_RT) - parseNum(a.FLUC_RT);
        case "FLUC_RT_ASC": return parseNum(a.FLUC_RT) - parseNum(b.FLUC_RT);
        case "ACC_TRDVOL": return parseNum(b.ACC_TRDVOL) - parseNum(a.ACC_TRDVOL);
        case "ACC_TRDVAL": return parseNum(b.ACC_TRDVAL) - parseNum(a.ACC_TRDVAL);
        case "MKTCAP": return parseNum(b.MKTCAP) - parseNum(a.MKTCAP);
        default: return 0;
      }
    });
  }, [market, sort, allStocks, kospiStocks, kosdaqStocks, konexStocks]);

  // Range aggregation sorted
  const sortedAgg = useMemo(() => {
    if (!rangeAggregation) return [];
    let filtered = rangeAggregation;
    if (market !== "ALL") {
      filtered = rangeAggregation.filter((a) => a.MKT_NM?.includes(market === "KOSPI" ? "KOSPI" : market === "KOSDAQ" ? "KOSDAQ" : "KONEX"));
    }
    return [...filtered].sort((a, b) => {
      switch (rangeSort) {
        case "PERIOD_CHANGE_DESC": return b.periodChangeRate - a.periodChangeRate;
        case "PERIOD_CHANGE_ASC": return a.periodChangeRate - b.periodChangeRate;
        case "TOTAL_VOLUME": return b.totalVolume - a.totalVolume;
        case "TOTAL_VALUE": return b.totalValue - a.totalValue;
        case "VOLATILITY": return b.volatility - a.volatility;
        default: return 0;
      }
    });
  }, [rangeAggregation, market, rangeSort]);

  const handleMarketChange = useCallback((m: MarketType) => {
    setMarket(m);
    setVisibleCount(PAGE_SIZE);
  }, []);

  const currentEndpoint = market === "KOSPI" ? KRX_ENDPOINTS.stk_trade 
    : market === "KOSDAQ" ? KRX_ENDPOINTS.ksq_trade 
    : market === "KONEX" ? KRX_ENDPOINTS.knx_trade 
    : KRX_ENDPOINTS.stk_trade;

  const effectiveStart = dateMode === "range" && startDate ? startDate : basDd || "";
  const effectiveEnd = dateMode === "range" && endDate ? endDate : basDd || "";

  const showLoading = dateMode === "single" ? isLoading : rangeLoading;

  if (showLoading) {
    return (
      <div className="space-y-3 p-4">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* Market tabs + download */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex gap-1 overflow-x-auto scrollbar-hide">
          {MARKET_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => handleMarketChange(tab.value)}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                market === tab.value
                  ? "bg-foreground text-background"
                  : "bg-secondary text-muted-foreground hover:bg-accent"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {effectiveStart && effectiveEnd && (
          <DownloadButton endpoint={currentEndpoint} startDate={effectiveStart} endDate={effectiveEnd} />
        )}
      </div>

      {/* Range mode: daily/summary tab */}
      {dateMode === "range" && (
        <div className="flex gap-1 px-4 pb-2">
          <button
            onClick={() => setRangeTab("summary")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              rangeTab === "summary" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            기간 요약
          </button>
          <button
            onClick={() => setRangeTab("daily")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              rangeTab === "daily" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            일별 데이터
          </button>
        </div>
      )}

      {/* Sort tabs */}
      <div className="flex gap-1 px-4 pb-2 overflow-x-auto scrollbar-hide">
        {dateMode === "single" || rangeTab === "daily" ? (
          SORT_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setSort(tab.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                sort === tab.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              {tab.label}
            </button>
          ))
        ) : (
          RANGE_SORT_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setRangeSort(tab.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                rangeSort === tab.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              {tab.label}
            </button>
          ))
        )}
      </div>

      {/* Content */}
      {dateMode === "range" && rangeTab === "summary" ? (
        <RangeAggregationList data={sortedAgg} visibleCount={visibleCount} onLoadMore={() => setVisibleCount(v => v + PAGE_SIZE)} />
      ) : (
        <SingleDayList stocks={stocks} visibleCount={visibleCount} onStockClick={onStockClick} onLoadMore={() => setVisibleCount(v => v + PAGE_SIZE)} />
      )}
    </div>
  );
}

// Single day stock list
function SingleDayList({ stocks, visibleCount, onStockClick, onLoadMore }: {
  stocks: StockData[];
  visibleCount: number;
  onStockClick: (s: StockData) => void;
  onLoadMore: () => void;
}) {
  if (stocks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <p className="text-lg font-medium">데이터 없음</p>
        <p className="text-sm mt-1">해당 날짜에 데이터가 없습니다 (휴장일 가능)</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-[1fr_100px_80px_80px] gap-2 px-4 py-2 text-xs text-muted-foreground border-b border-border">
        <span>종목</span>
        <span className="text-right">현재가</span>
        <span className="text-right">등락률</span>
        <span className="text-right">거래량</span>
      </div>
      <div className="divide-y divide-border">
        {stocks.slice(0, visibleCount).map((stock, i) => {
          const dir = getDirection(stock.FLUC_RT);
          const rate = parseNum(stock.FLUC_RT);
          const sectorClass = stock.SECUGRP_NM
            ? SECTOR_COLORS[stock.SECUGRP_NM] || "bg-secondary text-secondary-foreground"
            : "";
          return (
            <button
              key={`${stock.ISU_CD}-${i}`}
              onClick={() => onStockClick(stock)}
              className="w-full grid grid-cols-[1fr_100px_80px_80px] gap-2 px-4 py-3 hover:bg-secondary/50 transition-colors text-left"
            >
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{stock.ISU_NM}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-xs text-muted-foreground">{stock.ISU_CD}</span>
                  {stock.SECUGRP_NM && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${sectorClass}`}>
                      {stock.SECUGRP_NM}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right tabular-nums text-sm font-semibold self-center">
                {formatNum(parseNum(stock.TDD_CLSPRC))}
              </div>
              <div className={`text-right tabular-nums text-sm font-semibold self-center ${
                dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-flat"
              }`}>
                {rate > 0 ? "+" : ""}{rate.toFixed(2)}%
              </div>
              <div className="text-right tabular-nums text-xs text-muted-foreground self-center">
                {formatLargeNum(parseNum(stock.ACC_TRDVOL))}
              </div>
            </button>
          );
        })}
      </div>
      {visibleCount < stocks.length && (
        <button onClick={onLoadMore} className="w-full py-4 text-sm text-primary font-medium hover:bg-secondary/50 flex items-center justify-center gap-1">
          더보기 ({stocks.length - visibleCount}개 남음)
          <ChevronDown className="w-4 h-4" />
        </button>
      )}
    </>
  );
}

// Range aggregation list
function RangeAggregationList({ data, visibleCount, onLoadMore }: {
  data: AggregatedData[];
  visibleCount: number;
  onLoadMore: () => void;
}) {
  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <p className="text-lg font-medium">데이터 없음</p>
        <p className="text-sm mt-1">기간 데이터를 불러올 수 없습니다</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-[1fr_80px_80px_80px] gap-2 px-4 py-2 text-xs text-muted-foreground border-b border-border">
        <span>종목</span>
        <span className="text-right">기간변동률</span>
        <span className="text-right">거래량합</span>
        <span className="text-right">변동성</span>
      </div>
      <div className="divide-y divide-border">
        {data.slice(0, visibleCount).map((item, i) => {
          const dir = item.periodChangeRate > 0 ? "up" : item.periodChangeRate < 0 ? "down" : "flat";
          return (
            <div
              key={`${item.ISU_CD}-${i}`}
              className="grid grid-cols-[1fr_80px_80px_80px] gap-2 px-4 py-3 hover:bg-secondary/50 transition-colors"
            >
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{item.ISU_NM}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{item.ISU_CD}</div>
              </div>
              <div className={`text-right tabular-nums text-sm font-semibold self-center ${
                dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-flat"
              }`}>
                {item.periodChangeRate > 0 ? "+" : ""}{item.periodChangeRate.toFixed(2)}%
              </div>
              <div className="text-right tabular-nums text-xs text-muted-foreground self-center">
                {formatLargeNum(item.totalVolume)}
              </div>
              <div className="text-right tabular-nums text-xs text-muted-foreground self-center">
                {item.volatility.toFixed(2)}%
              </div>
            </div>
          );
        })}
      </div>
      {visibleCount < data.length && (
        <button onClick={onLoadMore} className="w-full py-4 text-sm text-primary font-medium hover:bg-secondary/50 flex items-center justify-center gap-1">
          더보기 ({data.length - visibleCount}개 남음)
          <ChevronDown className="w-4 h-4" />
        </button>
      )}
    </>
  );
}

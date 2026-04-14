import { useState } from "react";
import { StockData, SECTOR_COLORS } from "@/types/krx";
import { parseNum, formatNum, formatLargeNum, getDirection, AggregatedData } from "@/lib/krx-api";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { TrendingUp, TrendingDown, Minus, X, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DownloadButton } from "./DownloadButton";
import { KRX_ENDPOINTS } from "@/types/krx";

interface StockBottomSheetProps {
  stock: StockData | null;
  open: boolean;
  onClose: () => void;
  // Range mode
  dateMode?: "single" | "range";
  aggregation?: AggregatedData | null;
  basDd?: string;
  startDate?: string;
  endDate?: string;
}

export function StockBottomSheet({ stock, open, onClose, dateMode = "single", aggregation, basDd, startDate, endDate }: StockBottomSheetProps) {
  const [tab, setTab] = useState<"current" | "summary">("current");
  
  if (!stock) return null;

  const dir = getDirection(stock.FLUC_RT);
  const price = parseNum(stock.TDD_CLSPRC);
  const change = parseNum(stock.CMPPREVDD_PRC);
  const rate = parseNum(stock.FLUC_RT);
  const sectorClass = stock.SECUGRP_NM
    ? SECTOR_COLORS[stock.SECUGRP_NM] || "bg-secondary text-secondary-foreground"
    : "";

  const metrics = [
    { label: "시가", value: formatNum(parseNum(stock.TDD_OPNPRC)) },
    { label: "고가", value: formatNum(parseNum(stock.TDD_HGPRC)) },
    { label: "저가", value: formatNum(parseNum(stock.TDD_LWPRC)) },
    { label: "거래량", value: formatLargeNum(parseNum(stock.ACC_TRDVOL)) },
    { label: "거래대금", value: formatLargeNum(parseNum(stock.ACC_TRDVAL)) },
    { label: "시가총액", value: formatLargeNum(parseNum(stock.MKTCAP)) },
    { label: "상장주식수", value: formatLargeNum(parseNum(stock.LIST_SHRS)) },
  ];

  const effectiveEndpoint = KRX_ENDPOINTS.stk_trade;
  const effectiveStart = dateMode === "range" && startDate ? startDate : basDd || "";
  const effectiveEnd = dateMode === "range" && endDate ? endDate : basDd || "";

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="max-h-[85vh]">
        <div className="overflow-y-auto">
          <DrawerHeader className="pb-2">
            <div className="flex items-start justify-between">
              <div>
                <DrawerTitle className="text-xl font-bold">{stock.ISU_NM}</DrawerTitle>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm text-muted-foreground">{stock.ISU_CD}</span>
                  <span className="text-sm text-muted-foreground">{stock.MKT_NM}</span>
                  {stock.SECUGRP_NM && (
                    <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${sectorClass}`}>
                      {stock.SECUGRP_NM}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {effectiveStart && effectiveEnd && (
                  <DownloadButton endpoint={effectiveEndpoint} startDate={effectiveStart} endDate={effectiveEnd} />
                )}
                <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
                  <X className="w-5 h-5" />
                </Button>
              </div>
            </div>
          </DrawerHeader>

          {/* Tabs for range mode */}
          {dateMode === "range" && aggregation && (
            <div className="flex gap-1 px-4 pb-2">
              <button
                onClick={() => setTab("current")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  tab === "current" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
                }`}
              >
                현재가
              </button>
              <button
                onClick={() => setTab("summary")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  tab === "summary" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
                }`}
              >
                기간 요약
              </button>
            </div>
          )}

          {tab === "current" ? (
            <>
              <div className="px-4 pb-2">
                <div className="flex items-baseline gap-3 mb-2">
                  <span className="text-3xl font-bold tabular-nums">{formatNum(price)}</span>
                  <span className="text-lg text-muted-foreground">원</span>
                </div>
                <div className={`flex items-center gap-1.5 text-base font-semibold tabular-nums ${
                  dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-flat"
                }`}>
                  {dir === "up" && <TrendingUp className="w-4 h-4" />}
                  {dir === "down" && <TrendingDown className="w-4 h-4" />}
                  {dir === "flat" && <Minus className="w-4 h-4" />}
                  <span>{change > 0 ? "+" : ""}{formatNum(change)}</span>
                  <span>({rate > 0 ? "+" : ""}{rate.toFixed(2)}%)</span>
                </div>
              </div>

              <div className="mx-4 my-4 h-40 rounded-xl bg-muted/50 flex items-center justify-center">
                <span className="text-sm text-muted-foreground">차트 영역 (추후 구현)</span>
              </div>

              <div className="px-4 pb-6">
                <div className="grid grid-cols-2 gap-3">
                  {metrics.map((m) => (
                    <div key={m.label} className="flex items-center justify-between py-2.5 px-3 bg-secondary/50 rounded-xl">
                      <span className="text-sm text-muted-foreground">{m.label}</span>
                      <span className="text-sm font-semibold tabular-nums">{m.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : aggregation ? (
            <PeriodSummaryView agg={aggregation} />
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function PeriodSummaryView({ agg }: { agg: AggregatedData }) {
  const dir = agg.periodChangeRate > 0 ? "up" : agg.periodChangeRate < 0 ? "down" : "flat";

  const summaryMetrics = [
    { label: "시작 종가", value: formatNum(agg.startClose) },
    { label: "종료 종가", value: formatNum(agg.endClose) },
    { label: "기간 최고가", value: formatNum(agg.periodHigh) },
    { label: "기간 최저가", value: formatNum(agg.periodLow) },
    { label: "거래량 합계", value: formatLargeNum(agg.totalVolume) },
    { label: "거래대금 합계", value: formatLargeNum(agg.totalValue) },
    { label: "일평균 거래량", value: formatLargeNum(agg.avgVolume) },
    { label: "일평균 거래대금", value: formatLargeNum(agg.avgValue) },
    { label: "변동성", value: `${agg.volatility.toFixed(2)}%` },
    { label: "영업일 수", value: `${agg.tradingDays}일` },
  ];

  return (
    <div className="px-4 pb-6">
      {/* Period change rate hero */}
      <div className="mb-4 p-4 rounded-xl bg-secondary/50">
        <div className="text-sm text-muted-foreground mb-1">기간 변동률</div>
        <div className={`text-2xl font-bold tabular-nums ${
          dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-flat"
        }`}>
          {agg.periodChangeRate > 0 ? "+" : ""}{agg.periodChangeRate.toFixed(2)}%
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {agg.startDate?.slice(0, 4)}.{agg.startDate?.slice(4, 6)}.{agg.startDate?.slice(6, 8)} ~ {agg.endDate?.slice(0, 4)}.{agg.endDate?.slice(4, 6)}.{agg.endDate?.slice(6, 8)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {summaryMetrics.map((m) => (
          <div key={m.label} className="flex items-center justify-between py-2.5 px-3 bg-secondary/50 rounded-xl">
            <span className="text-sm text-muted-foreground">{m.label}</span>
            <span className="text-sm font-semibold tabular-nums">{m.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

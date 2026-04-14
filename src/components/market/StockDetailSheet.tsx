import { useQuery } from "@tanstack/react-query";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { X, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { fetchKrx, parseNum, formatNum, formatLargeNum, getDirection } from "@/lib/krx-api";
import { StockData, StockBaseInfo, SECTOR_COLORS } from "@/types/krx";

interface StockDetailSheetProps {
  isuCd: string | null;
  open: boolean;
  onClose: () => void;
  basDd?: string;
}

export function StockDetailSheet({ isuCd, open, onClose, basDd }: StockDetailSheetProps) {
  // Fetch trade data to get current price
  const { data: tradeData, isLoading: tradeLoading } = useQuery({
    queryKey: ["stockDetail-trade", isuCd, basDd],
    queryFn: async () => {
      if (!isuCd || !basDd) return null;
      // Try all markets
      const endpoints = ["sto/stk_bydd_trd", "sto/ksq_bydd_trd", "sto/knx_bydd_trd"];
      for (const ep of endpoints) {
        const data = await fetchKrx<StockData>(ep, basDd);
        const found = data.find((d) => d.ISU_CD === isuCd);
        if (found) return found;
      }
      return null;
    },
    enabled: !!isuCd && !!basDd && open,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch base info (cached 24h)
  const { data: baseInfo, isLoading: baseLoading } = useQuery({
    queryKey: ["stockDetail-base", isuCd, basDd],
    queryFn: async () => {
      if (!isuCd || !basDd) return null;
      const endpoints = ["sto/stk_isu_base_info", "sto/ksq_isu_base_info", "sto/knx_isu_base_info"];
      for (const ep of endpoints) {
        const data = await fetchKrx<StockBaseInfo>(ep, basDd);
        const found = data.find((d) => d.ISU_CD === isuCd);
        if (found) return found;
      }
      return null;
    },
    enabled: !!isuCd && !!basDd && open,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
  });

  const isLoading = tradeLoading || baseLoading;

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="max-h-[85vh]">
        <div className="overflow-y-auto">
          <DrawerHeader className="pb-2">
            <div className="flex items-start justify-between">
              <div>
                <DrawerTitle className="text-xl font-bold">
                  {isLoading ? <Skeleton className="h-6 w-32" /> : (tradeData?.ISU_NM || baseInfo?.ISU_NM || "종목 상세")}
                </DrawerTitle>
                {!isLoading && (tradeData || baseInfo) && (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-sm text-muted-foreground">{isuCd}</span>
                    {tradeData?.MKT_NM && <span className="text-sm text-muted-foreground">{tradeData.MKT_NM}</span>}
                    {baseInfo?.SECUGRP_NM && (
                      <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${SECTOR_COLORS[baseInfo.SECUGRP_NM] || "bg-secondary text-secondary-foreground"}`}>
                        {baseInfo.SECUGRP_NM}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
                <X className="w-5 h-5" />
              </Button>
            </div>
          </DrawerHeader>

          {isLoading ? (
            <div className="px-4 pb-6 space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-8 w-2/3" />
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            </div>
          ) : (
            <>
              {/* Price section */}
              {tradeData && (
                <div className="px-4 pb-3">
                  <div className="flex items-baseline gap-3 mb-1">
                    <span className="text-3xl font-bold tabular-nums">{formatNum(parseNum(tradeData.TDD_CLSPRC))}</span>
                    <span className="text-lg text-muted-foreground">원</span>
                  </div>
                  {(() => {
                    const change = parseNum(tradeData.CMPPREVDD_PRC);
                    const rate = parseNum(tradeData.FLUC_RT);
                    const dir = getDirection(tradeData.FLUC_RT);
                    return (
                      <div className={`flex items-center gap-1.5 text-base font-semibold tabular-nums ${dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-flat"}`}>
                        {dir === "up" && <TrendingUp className="w-4 h-4" />}
                        {dir === "down" && <TrendingDown className="w-4 h-4" />}
                        {dir === "flat" && <Minus className="w-4 h-4" />}
                        <span>{change > 0 ? "+" : ""}{formatNum(change)}</span>
                        <span>({rate > 0 ? "+" : ""}{rate.toFixed(2)}%)</span>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Trade metrics */}
              {tradeData && (
                <div className="px-4 pb-4">
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "시가", value: formatNum(parseNum(tradeData.TDD_OPNPRC)) },
                      { label: "고가", value: formatNum(parseNum(tradeData.TDD_HGPRC)) },
                      { label: "저가", value: formatNum(parseNum(tradeData.TDD_LWPRC)) },
                      { label: "거래량", value: formatLargeNum(parseNum(tradeData.ACC_TRDVOL)) },
                      { label: "거래대금", value: formatLargeNum(parseNum(tradeData.ACC_TRDVAL)) },
                      { label: "시가총액", value: formatLargeNum(parseNum(tradeData.MKTCAP)) },
                    ].map(m => (
                      <div key={m.label} className="flex items-center justify-between py-2.5 px-3 bg-secondary/50 rounded-xl">
                        <span className="text-sm text-muted-foreground">{m.label}</span>
                        <span className="text-sm font-semibold tabular-nums">{m.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Base info section */}
              {baseInfo && (
                <div className="px-4 pb-6">
                  <h3 className="text-sm font-bold text-foreground mb-3">종목 기본정보</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "상장일", value: baseInfo.LIST_DD ? `${baseInfo.LIST_DD.slice(0,4)}.${baseInfo.LIST_DD.slice(4,6)}.${baseInfo.LIST_DD.slice(6,8)}` : "-" },
                      { label: "액면가", value: formatNum(parseNum(baseInfo.PARVAL)) + "원" },
                      { label: "상장주식수", value: formatLargeNum(parseNum(baseInfo.LIST_SHRS)) },
                      { label: "시장구분", value: baseInfo.MKT_TP_NM || "-" },
                      { label: "증권구분", value: baseInfo.SECUGRP_NM || "-" },
                      { label: "업종", value: baseInfo.SECT_TP_NM || "-" },
                    ].map(m => (
                      <div key={m.label} className="flex items-center justify-between py-2.5 px-3 bg-secondary/50 rounded-xl">
                        <span className="text-sm text-muted-foreground">{m.label}</span>
                        <span className="text-sm font-semibold">{m.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!tradeData && !baseInfo && (
                <div className="px-4 pb-6 text-center text-muted-foreground">
                  <p className="text-sm">종목 정보를 찾을 수 없습니다</p>
                </div>
              )}
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

import { useQuery } from "@tanstack/react-query";
import { fetchKrx, fetchKrxRange, findLatestBusinessDate, RangeResult, AggregatedData } from "@/lib/krx-api";
import {
  IndexData,
  StockData,
  StockBaseInfo,
  ETFData,
  ETNData,
  ELWData,
  GoldData,
  OilData,
  KRX_ENDPOINTS,
} from "@/types/krx";

export function useBusinessDate() {
  return useQuery({
    queryKey: ["businessDate"],
    queryFn: findLatestBusinessDate,
    staleTime: 60 * 1000,
    gcTime: 60 * 1000,
  });
}

export function useIndexData(series: "krx" | "kospi" | "kosdaq", basDd: string | undefined) {
  const endpointMap = {
    krx: KRX_ENDPOINTS.krx_index,
    kospi: KRX_ENDPOINTS.kospi_index,
    kosdaq: KRX_ENDPOINTS.kosdaq_index,
  };
  return useQuery<IndexData[]>({
    queryKey: ["index", series, basDd],
    queryFn: () => fetchKrx<IndexData>(endpointMap[series], basDd!),
    enabled: !!basDd,
    staleTime: 5 * 60 * 1000,
  });
}

export function useStockData(
  market: "stk" | "ksq" | "knx",
  basDd: string | undefined
) {
  const endpointMap = {
    stk: KRX_ENDPOINTS.stk_trade,
    ksq: KRX_ENDPOINTS.ksq_trade,
    knx: KRX_ENDPOINTS.knx_trade,
  };
  return useQuery<StockData[]>({
    queryKey: ["stock", market, basDd],
    queryFn: () => fetchKrx<StockData>(endpointMap[market], basDd!),
    enabled: !!basDd,
    staleTime: 5 * 60 * 1000,
  });
}

export function useStockBaseInfo(
  market: "stk" | "ksq" | "knx",
  basDd: string | undefined
) {
  const endpointMap = {
    stk: KRX_ENDPOINTS.stk_base,
    ksq: KRX_ENDPOINTS.ksq_base,
    knx: KRX_ENDPOINTS.knx_base,
  };
  return useQuery<StockBaseInfo[]>({
    queryKey: ["baseInfo", market, basDd],
    queryFn: () => fetchKrx<StockBaseInfo>(endpointMap[market], basDd!),
    enabled: !!basDd,
    staleTime: 30 * 60 * 1000,
  });
}

export function useAllStockData(basDd: string | undefined) {
  const stk = useStockData("stk", basDd);
  const ksq = useStockData("ksq", basDd);
  const knx = useStockData("knx", basDd);

  const stkBase = useStockBaseInfo("stk", basDd);
  const ksqBase = useStockBaseInfo("ksq", basDd);
  const knxBase = useStockBaseInfo("knx", basDd);

  const isLoading = stk.isLoading || ksq.isLoading || knx.isLoading;
  const isBaseLoading = stkBase.isLoading || ksqBase.isLoading || knxBase.isLoading;

  const baseInfoMap = new Map<string, StockBaseInfo>();
  [stkBase.data, ksqBase.data, knxBase.data].forEach((list) => {
    list?.forEach((item) => {
      baseInfoMap.set(item.ISU_CD, item);
      baseInfoMap.set(item.ISU_SRT_CD, item);
    });
  });

  const mergeWithBaseInfo = (stocks: StockData[] | undefined): StockData[] => {
    if (!stocks) return [];
    return stocks.map((s) => {
      const base = baseInfoMap.get(s.ISU_CD);
      return { ...s, SECUGRP_NM: base?.SECUGRP_NM ?? "" };
    });
  };

  return {
    kospiStocks: mergeWithBaseInfo(stk.data),
    kosdaqStocks: mergeWithBaseInfo(ksq.data),
    konexStocks: mergeWithBaseInfo(knx.data),
    allStocks: [
      ...mergeWithBaseInfo(stk.data),
      ...mergeWithBaseInfo(ksq.data),
      ...mergeWithBaseInfo(knx.data),
    ],
    baseInfoMap,
    baseInfoList: [
      ...(stkBase.data ?? []),
      ...(ksqBase.data ?? []),
      ...(knxBase.data ?? []),
    ],
    isLoading,
    isBaseLoading,
    error: stk.error || ksq.error || knx.error,
  };
}

// Range data hooks
export function useStockRangeData(
  markets: ("stk" | "ksq" | "knx")[],
  startDate: string | undefined,
  endDate: string | undefined,
  enabled: boolean
) {
  const endpointMap = {
    stk: KRX_ENDPOINTS.stk_trade,
    ksq: KRX_ENDPOINTS.ksq_trade,
    knx: KRX_ENDPOINTS.knx_trade,
  };

  return useQuery<{ daily: StockData[]; aggregation: AggregatedData[] }>({
    queryKey: ["stockRange", markets, startDate, endDate],
    queryFn: async () => {
      const results = await Promise.all(
        markets.map((m) => fetchKrxRange<StockData>(endpointMap[m], startDate!, endDate!))
      );
      const daily = results.flatMap((r) => r.daily);
      const aggregation = results.flatMap((r) => r.aggregation);
      return { daily, aggregation };
    },
    enabled: enabled && !!startDate && !!endDate,
    staleTime: 10 * 60 * 1000,
  });
}

export function useETFData(basDd: string | undefined) {
  return useQuery<ETFData[]>({
    queryKey: ["etf", basDd],
    queryFn: () => fetchKrx<ETFData>(KRX_ENDPOINTS.etf, basDd!),
    enabled: !!basDd,
    staleTime: 5 * 60 * 1000,
  });
}

export function useETNData(basDd: string | undefined) {
  return useQuery<ETNData[]>({
    queryKey: ["etn", basDd],
    queryFn: () => fetchKrx<ETNData>(KRX_ENDPOINTS.etn, basDd!),
    enabled: !!basDd,
    staleTime: 5 * 60 * 1000,
  });
}

export function useELWData(basDd: string | undefined) {
  return useQuery<ELWData[]>({
    queryKey: ["elw", basDd],
    queryFn: () => fetchKrx<ELWData>(KRX_ENDPOINTS.elw, basDd!),
    enabled: !!basDd,
    staleTime: 5 * 60 * 1000,
  });
}

export function useGoldData(basDd: string | undefined) {
  return useQuery<GoldData[]>({
    queryKey: ["gold", basDd],
    queryFn: () => fetchKrx<GoldData>(KRX_ENDPOINTS.gold, basDd!),
    enabled: !!basDd,
    staleTime: 5 * 60 * 1000,
  });
}

export function useOilData(basDd: string | undefined) {
  return useQuery<OilData[]>({
    queryKey: ["oil", basDd],
    queryFn: () => fetchKrx<OilData>(KRX_ENDPOINTS.oil, basDd!),
    enabled: !!basDd,
    staleTime: 5 * 60 * 1000,
  });
}

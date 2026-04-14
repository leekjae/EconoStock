import { useState, useEffect, useCallback, useMemo } from "react";
import { useBusinessDate, useAllStockData } from "@/hooks/useKrxData";
import { useMultiKrxData } from "@/hooks/useMultiKrxData";
import { formatDate } from "@/lib/krx-api";
import { StockData } from "@/types/krx";
import { KrxSidebar, MenuItem, MENU_STRUCTURE, HOME_MENU, TOOLS_MENU, MenuCategory } from "@/components/market/KrxSidebar";
import { ChevronRight } from "lucide-react";
import { HomeDashboard } from "@/components/market/HomeDashboard";
import { FilterBar } from "@/components/market/FilterBar";
import {
  DataTable,
  getStockColumns,
  getIndexColumns,
  getETFColumns,
  getETNColumns,
  getELWColumns,
  getGoldColumns,
  getOilColumns,
  getBaseInfoColumns,
} from "@/components/market/DataTable";
import { StockBottomSheet } from "@/components/market/StockBottomSheet";
import { StockDetailSheet } from "@/components/market/StockDetailSheet";
import { StockDailyTrade } from "@/components/market/StockDailyTrade";
import { IndexDailyTrade } from "@/components/market/IndexDailyTrade";
import { ProductDailyTrade } from "@/components/market/ProductDailyTrade";

import { InvestorTopEquities } from "@/components/market/InvestorTopEquities";
import { IndexExplorer } from "@/components/market/IndexExplorer";
import { AveragePriceCalculator } from "@/components/market/AveragePriceCalculator";

import { toast } from "sonner";

const DEFAULT_MENU = HOME_MENU;
type TableRow = Record<string, string | number | undefined>;

// Endpoint maps for "전체" multi-fetch
const INDEX_ENDPOINTS: Record<string, string[]> = {
  ALL: ["idx/krx_dd_trd", "idx/kospi_dd_trd", "idx/kosdaq_dd_trd"],
  KRX: ["idx/krx_dd_trd"],
  KOSPI: ["idx/kospi_dd_trd"],
  KOSDAQ: ["idx/kosdaq_dd_trd"],
};

const STOCK_TRADE_ENDPOINTS: Record<string, string[]> = {
  ALL: ["sto/stk_bydd_trd", "sto/ksq_bydd_trd", "sto/knx_bydd_trd"],
  KOSPI: ["sto/stk_bydd_trd"],
  KOSDAQ: ["sto/ksq_bydd_trd"],
  KONEX: ["sto/knx_bydd_trd"],
};

const STOCK_BASE_ENDPOINTS: Record<string, string[]> = {
  ALL: ["sto/stk_isu_base_info", "sto/ksq_isu_base_info", "sto/knx_isu_base_info"],
  KOSPI: ["sto/stk_isu_base_info"],
  KOSDAQ: ["sto/ksq_isu_base_info"],
  KONEX: ["sto/knx_isu_base_info"],
};

const PRODUCT_ENDPOINTS: Record<string, string> = {
  ETF: "etp/etf_bydd_trd",
  ETN: "etp/etn_bydd_trd",
  ELW: "etp/elw_bydd_trd",
};

const Index = () => {
  const { data: latestDate, isLoading: dateLoading } = useBusinessDate();
  const [basDd, setBasDd] = useState<string | undefined>();
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [selectedMenu, setSelectedMenu] = useState<MenuItem>(DEFAULT_MENU);

  const [selectedStock, setSelectedStock] = useState<StockData | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Stock detail sheet state
  const [detailIsuCd, setDetailIsuCd] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Category-specific filter state
  const [indexMarket, setIndexMarket] = useState("ALL");
  const [stockMarket, setStockMarket] = useState("ALL");

  const [productType, setProductType] = useState("ETF");

  // Set initial date
  useEffect(() => {
    if (latestDate && !basDd) {
      setBasDd(latestDate);
      const y = parseInt(latestDate.slice(0, 4));
      const m = parseInt(latestDate.slice(4, 6)) - 1;
      const d = parseInt(latestDate.slice(6, 8));
      const date = new Date(y, m, d);
      setStartDate(date);
      setEndDate(date);
    }
  }, [latestDate, basDd]);

  // Determine endpoints based on category + filters
  const resolvedEndpoints = useMemo((): string[] => {
    const cat = selectedMenu.category;
    if (cat === "home") return [];
    if (cat === "investor") return [];
    if (cat === "pykrx") return [];
    if (cat === "stock_daily") return [];
    if (cat === "index_daily") return [];
    if (cat === "product_daily") return [];
    if (cat === "index") return INDEX_ENDPOINTS[indexMarket] || [];
    if (cat === "stock") return STOCK_TRADE_ENDPOINTS[stockMarket] || [];
    if (cat === "stock_base") return STOCK_BASE_ENDPOINTS[stockMarket] || [];
    if (cat === "product") return [PRODUCT_ENDPOINTS[productType] || "etp/etf_bydd_trd"];
    // general - single endpoint from menu
    return [selectedMenu.endpoint];
  }, [selectedMenu, indexMarket, stockMarket, productType]);

  // Use multi-fetch for all categories (handles single endpoint too)
  const { data: multiData, isLoading: multiLoading } = useMultiKrxData<TableRow>(
    resolvedEndpoints.length > 0 ? resolvedEndpoints : undefined,
    basDd,
  );

  // Stock data for search (always loaded)
  const stockData = useAllStockData(basDd);

  const handleMenuSelect = useCallback((item: MenuItem) => {
    setSelectedMenu(item);
  }, []);

  const handleSearch = useCallback(() => {
    if (startDate) {
      setBasDd(formatDate(startDate));
    }
  }, [startDate]);

  const handleStockClick = useCallback((stock: StockData) => {
    setSelectedStock(stock);
    setSheetOpen(true);
  }, []);

  const handleStockDetailClick = useCallback((isuCd: string) => {
    setDetailIsuCd(isuCd);
    setDetailOpen(true);
  }, []);

  // Determine effective category for columns
  const effectiveCategory = useMemo(() => {
    return selectedMenu.category;
  }, [selectedMenu.category]);

  // Get columns based on effective category
  const columns = useMemo(() => {
    switch (effectiveCategory) {
      case "index":
        return getIndexColumns();
      case "stock":
        return getStockColumns();
      case "stock_base":
        return getBaseInfoColumns();
      case "product":
        if (productType === "ETN") return getETNColumns();
        if (productType === "ELW") return getELWColumns();
        return getETFColumns();
      case "general":
        if (selectedMenu.id === "oil") return getOilColumns();
        return getGoldColumns();
      default:
        return getStockColumns();
    }
  }, [effectiveCategory, productType, selectedMenu.id]);

  // Merge SECUGRP_NM for stock trade data
  const tableData = useMemo(() => {
    if (!multiData || multiData.length === 0) return [];
    if (effectiveCategory === "stock" && stockData.baseInfoMap.size > 0) {
      return multiData.map((s) => {
        const base = stockData.baseInfoMap.get(s.ISU_CD);
        return { ...s, SECUGRP_NM: base?.SECUGRP_NM ?? "" };
      });
    }
    return multiData;
  }, [multiData, effectiveCategory, stockData.baseInfoMap]);

  // Build screen title
  const screenTitle = useMemo(() => {
    const base = `[${selectedMenu.screenId}] ${selectedMenu.label}`;
    if (selectedMenu.category === "index" && indexMarket !== "ALL") return `${base} (${indexMarket})`;
    if (selectedMenu.category === "stock" || selectedMenu.category === "stock_base") {
      const mkt = stockMarket !== "ALL" ? ` (${stockMarket})` : "";
      return `${base}${mkt}`;
    }
    if (selectedMenu.category === "product") return `${base} (${productType})`;
    return base;
  }, [selectedMenu, indexMarket, stockMarket, productType]);

  // Build breadcrumb from menu structure
  const breadcrumb = useMemo(() => {
    if (selectedMenu.category === "home") return { parent: null, current: "홈" };
    const allCategories: MenuCategory[] = [...MENU_STRUCTURE, TOOLS_MENU];
    for (const cat of allCategories) {
      const found = cat.items.find((item) => item.id === selectedMenu.id);
      if (found) return { parent: cat.label, current: found.label };
    }
    return { parent: null, current: selectedMenu.label };
  }, [selectedMenu]);

  const onRowClick = effectiveCategory === "stock"
    ? (row: StockData) => handleStockClick(row)
    : undefined;

  const isHome = selectedMenu.category === "home";
  const isInvestor = selectedMenu.category === "investor";
  const isPykrx = selectedMenu.category === "pykrx";
  const isTools = selectedMenu.category === "tools";
  const isStockDaily = selectedMenu.category === "stock_daily";
  const isIndexDaily = selectedMenu.category === "index_daily";
  const isProductDaily = selectedMenu.category === "product_daily";

  useEffect(() => {
    if (stockData.error) {
      toast.error("데이터를 불러오는데 실패했습니다", {
        description: (stockData.error as Error).message,
      });
    }
  }, [stockData.error]);

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      {/* Left Sidebar */}
      <KrxSidebar selectedMenuId={selectedMenu.id} onMenuSelect={handleMenuSelect} />

      {/* Right Content */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Top header bar with Breadcrumb */}
        <header className="h-10 border-b border-border bg-background flex items-center justify-between px-4 shrink-0">
          <nav className="flex items-center gap-1 text-xs">
            {breadcrumb.parent ? (
              <>
                <span className="text-muted-foreground">{breadcrumb.parent}</span>
                <ChevronRight className="w-3 h-3 text-muted-foreground" />
                <span className="font-bold text-foreground">{breadcrumb.current}</span>
              </>
            ) : (
              <span className="font-bold text-foreground">{breadcrumb.current}</span>
            )}
          </nav>
          {dateLoading && <span className="text-[10px] text-muted-foreground">영업일 확인 중...</span>}
        </header>

        {/* Filter bar - hide for home, investor, pykrx, tools, stock_daily */}
        {!isHome && !isInvestor && !isPykrx && !isTools && !isStockDaily && !isIndexDaily && !isProductDaily && (
          <FilterBar
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            onSearch={handleSearch}
            loading={multiLoading}
            screenTitle={screenTitle}
            category={selectedMenu.category}
            indexMarket={indexMarket}
            onIndexMarketChange={setIndexMarket}
            stockMarket={stockMarket}
            onStockMarketChange={setStockMarket}
            productType={productType}
            onProductTypeChange={setProductType}
          />
        )}

        {/* Main content */}
        <div className="flex-1 overflow-hidden">
          {isHome ? (
            <HomeDashboard basDd={basDd} dateLoading={dateLoading} />
          ) : isTools ? (
            <AveragePriceCalculator />
          ) : isPykrx ? (
            <IndexExplorer />
          ) : isInvestor ? (
            <InvestorTopEquities initialStartDate={startDate} initialEndDate={endDate} />
          ) : isStockDaily ? (
            <StockDailyTrade latestDate={latestDate} onStockDetailClick={handleStockDetailClick} />
          ) : isIndexDaily ? (
            <IndexDailyTrade latestDate={latestDate} />
          ) : isProductDaily ? (
            <ProductDailyTrade latestDate={latestDate} onStockDetailClick={handleStockDetailClick} />
          ) : (
            <DataTable
              data={tableData}
              columns={columns}
              isLoading={multiLoading || dateLoading}
              onRowClick={onRowClick}
              onStockNameClick={handleStockDetailClick}
              endpoint={resolvedEndpoints[0]}
              startDate={basDd}
              endDate={basDd}
              emptyMessage="데이터 없음"
            />
          )}
        </div>
      </div>

      {/* Stock Bottom Sheet (row click) */}
      <StockBottomSheet stock={selectedStock} open={sheetOpen} onClose={() => setSheetOpen(false)} basDd={basDd} />

      {/* Stock Detail Sheet (name click) */}
      <StockDetailSheet isuCd={detailIsuCd} open={detailOpen} onClose={() => setDetailOpen(false)} basDd={basDd} />
    </div>
  );
};

export default Index;

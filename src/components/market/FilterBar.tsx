import { useState } from "react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { CalendarIcon, Search as SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface FilterBarProps {
  startDate: Date | undefined;
  endDate: Date | undefined;
  onStartDateChange: (date: Date | undefined) => void;
  onEndDateChange: (date: Date | undefined) => void;
  onSearch: () => void;
  loading?: boolean;
  screenTitle?: string;
  // Category-specific filters
  category?: string;
  // Index: market filter
  indexMarket?: string;
  onIndexMarketChange?: (v: string) => void;
  // Stock: market filter
  stockMarket?: string;
  onStockMarketChange?: (v: string) => void;
  // Product: product type
  productType?: string;
  onProductTypeChange?: (v: string) => void;
}

const QUICK_RANGES = [
  { label: "1일", days: 0 },
  { label: "1개월", days: 30 },
  { label: "6개월", days: 180 },
  { label: "1년", days: 365 },
];

const INDEX_MARKETS = [
  { value: "ALL", label: "전체" },
  { value: "KRX", label: "KRX" },
  { value: "KOSPI", label: "KOSPI" },
  { value: "KOSDAQ", label: "KOSDAQ" },
];

const STOCK_MARKETS = [
  { value: "ALL", label: "전체" },
  { value: "KOSPI", label: "KOSPI" },
  { value: "KOSDAQ", label: "KOSDAQ" },
  { value: "KONEX", label: "KONEX" },
];

const PRODUCT_TYPES = [
  { value: "ETF", label: "ETF" },
  { value: "ETN", label: "ETN" },
  { value: "ELW", label: "ELW" },
];

export function FilterBar({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  onSearch,
  loading,
  screenTitle,
  category,
  indexMarket,
  onIndexMarketChange,
  stockMarket,
  onStockMarketChange,
  productType,
  onProductTypeChange,
}: FilterBarProps) {
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);

  const handleQuickRange = (days: number) => {
    const end = endDate || new Date();
    if (days === 0) {
      onStartDateChange(end);
      onEndDateChange(end);
    } else {
      const start = new Date(end);
      start.setDate(start.getDate() - days);
      onStartDateChange(start);
      onEndDateChange(end);
    }
  };

  return (
    <div className="border-b border-border bg-card">
      {/* Screen title */}
      {screenTitle && (
        <div className="px-4 pt-3 pb-1">
          <h2 className="text-sm font-bold text-foreground">{screenTitle}</h2>
        </div>
      )}

      {/* Category-specific filters */}
      {category === "index" && onIndexMarketChange && (
        <div className="px-4 py-2 flex items-center gap-3 border-b border-border/50">
          <span className="text-xs text-muted-foreground font-medium shrink-0">시장구분</span>
          <RadioGroup
            value={indexMarket || "ALL"}
            onValueChange={onIndexMarketChange}
            className="flex items-center gap-2"
          >
            {INDEX_MARKETS.map(m => (
              <div key={m.value} className="flex items-center gap-1">
                <RadioGroupItem value={m.value} id={`idx-mkt-${m.value}`} className="w-3.5 h-3.5" />
                <Label htmlFor={`idx-mkt-${m.value}`} className="text-xs cursor-pointer">{m.label}</Label>
              </div>
            ))}
          </RadioGroup>
        </div>
      )}

      {(category === "stock" || category === "stock_base") && onStockMarketChange && (
        <div className="px-4 py-2 flex items-center gap-2 border-b border-border/50">
          <span className="text-xs text-muted-foreground font-medium shrink-0">시장구분</span>
          <RadioGroup
            value={stockMarket || "ALL"}
            onValueChange={onStockMarketChange}
            className="flex items-center gap-2"
          >
            {STOCK_MARKETS.map(m => (
              <div key={m.value} className="flex items-center gap-1">
                <RadioGroupItem value={m.value} id={`stk-mkt-${m.value}`} className="w-3.5 h-3.5" />
                <Label htmlFor={`stk-mkt-${m.value}`} className="text-xs cursor-pointer">{m.label}</Label>
              </div>
            ))}
          </RadioGroup>
        </div>
      )}

      {category === "product" && onProductTypeChange && (
        <div className="px-4 py-2 flex items-center gap-3 border-b border-border/50">
          <span className="text-xs text-muted-foreground font-medium shrink-0">상품구분</span>
          <RadioGroup
            value={productType || "ETF"}
            onValueChange={onProductTypeChange}
            className="flex items-center gap-2"
          >
            {PRODUCT_TYPES.map(p => (
              <div key={p.value} className="flex items-center gap-1">
                <RadioGroupItem value={p.value} id={`prd-${p.value}`} className="w-3.5 h-3.5" />
                <Label htmlFor={`prd-${p.value}`} className="text-xs cursor-pointer">{p.label}</Label>
              </div>
            ))}
          </RadioGroup>
        </div>
      )}

      {/* Date filter row */}
      <div className="px-4 py-2.5 flex flex-wrap items-center gap-2">
        {/* Date range - single date for stock, range for others */}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground font-medium shrink-0">
            {category === "stock" || category === "stock_base" || category === "index" || category === "product" ? "기준일" : "조회기간"}
          </span>

          <Popover open={startOpen} onOpenChange={setStartOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "h-7 px-2 text-xs gap-1 font-normal",
                  !startDate && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="w-3 h-3" />
                {startDate ? format(startDate, "yyyy.MM.dd", { locale: ko }) : "시작일"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={startDate}
                defaultMonth={startDate}
                onSelect={(d) => {
                  onStartDateChange(d);
                  // For single date categories, sync end date
                  if (category === "stock" || category === "stock_base" || category === "index" || category === "product") {
                    onEndDateChange(d);
                  }
                  setStartOpen(false);
                }}
                disabled={(d) => d > new Date() || (endDate && category !== "stock" && category !== "stock_base" && category !== "index" && category !== "product" ? d > endDate : false)}
                className="p-3 pointer-events-auto"
                initialFocus
              />
            </PopoverContent>
          </Popover>

          {category !== "stock" && category !== "stock_base" && category !== "index" && category !== "product" && (
            <>
              <span className="text-muted-foreground">~</span>

              <Popover open={endOpen} onOpenChange={setEndOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "h-7 px-2 text-xs gap-1 font-normal",
                      !endDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="w-3 h-3" />
                    {endDate ? format(endDate, "yyyy.MM.dd", { locale: ko }) : "종료일"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={endDate}
                    defaultMonth={endDate}
                    onSelect={(d) => {
                      onEndDateChange(d);
                      setEndOpen(false);
                    }}
                    disabled={(d) => d > new Date() || (startDate ? d < startDate : false)}
                    className="p-3 pointer-events-auto"
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </>
          )}
        </div>

        {/* Quick range buttons - hide for single date categories */}
        {category !== "stock" && category !== "stock_base" && category !== "index" && category !== "product" && (
          <div className="flex items-center gap-1">
            {QUICK_RANGES.map((r) => (
              <Button
                key={r.label}
                variant="secondary"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => handleQuickRange(r.days)}
              >
                {r.label}
              </Button>
            ))}
          </div>
        )}

        {/* Search button */}
        <Button
          size="sm"
          className="h-7 px-4 text-xs ml-auto"
          onClick={onSearch}
          disabled={loading}
        >
          <SearchIcon className="w-3 h-3 mr-1" />
          조회
        </Button>
      </div>
    </div>
  );
}

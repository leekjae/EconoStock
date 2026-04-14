import { useState, useMemo } from "react";
import { ChevronRight, ChevronDown, Search, X, Home, Calculator } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface MenuItem {
  id: string;
  screenId: string;
  label: string;
  endpoint: string;
  category: string;
}

export interface MenuCategory {
  id: string;
  label: string;
  items: MenuItem[];
}

export const HOME_MENU: MenuItem = {
  id: "home",
  screenId: "HOME",
  label: "시장현황 대시보드",
  endpoint: "",
  category: "home",
};

export const MENU_STRUCTURE: MenuCategory[] = [
  {
    id: "index",
    label: "지수",
    items: [
      {
        id: "index_main",
        screenId: "IDX001",
        label: "전체지수 단일 시세정보",
        endpoint: "idx/krx_dd_trd",
        category: "index",
      },
      { id: "index_daily", screenId: "IDX002", label: "개별지수 일별 시세정보", endpoint: "", category: "index_daily" },
    ],
  },
  {
    id: "stock",
    label: "주식",
    items: [
      {
        id: "stock_trade",
        screenId: "STO001",
        label: "전체종목 단일 매매정보",
        endpoint: "sto/stk_bydd_trd",
        category: "stock",
      },
      { id: "stock_daily", screenId: "STO003", label: "개별종목 일별 매매정보", endpoint: "", category: "stock_daily" },
      {
        id: "stock_base",
        screenId: "STO002",
        label: "종목 기본정보",
        endpoint: "sto/stk_isu_base_info",
        category: "stock_base",
      },
    ],
  },
  {
    id: "product",
    label: "증권상품(ETF/ETN/ELW)",
    items: [
      {
        id: "product_main",
        screenId: "ETP001",
        label: "전체상품 단일 매매정보",
        endpoint: "etp/etf_bydd_trd",
        category: "product",
      },
      {
        id: "product_daily",
        screenId: "ETP002",
        label: "개별상품 일별 매매정보",
        endpoint: "",
        category: "product_daily",
      },
    ],
  },
  {
    id: "general",
    label: "일반상품",
    items: [
      {
        id: "oil",
        screenId: "GEN001",
        label: "석유시장 일별매매정보",
        endpoint: "gen/oil_bydd_trd",
        category: "general",
      },
      {
        id: "gold",
        screenId: "GEN002",
        label: "금시장 일별매매정보",
        endpoint: "gen/gold_bydd_trd",
        category: "general",
      },
    ],
  },
  {
    id: "investor",
    label: "투자자별",
    items: [
      { id: "inv_top", screenId: "INV001", label: "순매수 상위종목", endpoint: "investor", category: "investor" },
    ],
  },
  {
    id: "pykrx",
    label: "업종(섹터)별",
    items: [{ id: "pxi_list", screenId: "PXI001", label: "구성종목", endpoint: "pykrx", category: "pykrx" }],
  },
];

export const TOOLS_MENU: MenuCategory = {
  id: "tools",
  label: "도구",
  items: [{ id: "avg_calc", screenId: "CAL001", label: "평단가 계산기", endpoint: "", category: "tools" }],
};

interface KrxSidebarProps {
  selectedMenuId: string;
  onMenuSelect: (item: MenuItem) => void;
}

export function KrxSidebar({ selectedMenuId, onMenuSelect }: KrxSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(MENU_STRUCTURE.map((c) => c.id)));

  const toggleCategory = (catId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  const filteredMenu = useMemo(() => {
    if (!searchQuery.trim()) return MENU_STRUCTURE;
    const q = searchQuery.trim().toLowerCase();
    return MENU_STRUCTURE.map((cat) => ({
      ...cat,
      items: cat.items.filter(
        (item) => item.label.toLowerCase().includes(q) || item.screenId.toLowerCase().includes(q),
      ),
    })).filter((cat) => cat.items.length > 0);
  }, [searchQuery]);

  return (
    <div className="w-56 min-w-[224px] border-r border-border bg-sidebar flex flex-col h-full">
      {/* Search */}
      <div className="p-3 border-b border-sidebar-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="화면번호/화면명 검색"
            className="h-8 pl-8 pr-8 text-xs bg-sidebar-accent border-sidebar-border"
          />

          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Tree menu */}
      <ScrollArea className="flex-1">
        <div className="py-1">
          {/* Home */}
          <button
            onClick={() => onMenuSelect(HOME_MENU)}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold transition-colors",
              selectedMenuId === "home"
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent",
            )}
          >
            <Home className="w-3.5 h-3.5 shrink-0" />홈
          </button>

          {filteredMenu.map((cat) => {
            const isExpanded = expandedCategories.has(cat.id) || !!searchQuery.trim();
            return (
              <div key={cat.id}>
                <button
                  onClick={() => toggleCategory(cat.id)}
                  className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                  )}
                  {cat.label}
                </button>
                {isExpanded && (
                  <div className="pb-1">
                    {cat.items.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => onMenuSelect(item)}
                        className={cn(
                          "w-full text-left pl-7 pr-3 py-1.5 text-xs transition-colors truncate",
                          selectedMenuId === item.id
                            ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Tools separator + section */}
          <Separator className="my-1" />
          <div>
            <button
              onClick={() => toggleCategory(TOOLS_MENU.id)}
              className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
            >
              {expandedCategories.has(TOOLS_MENU.id) ? (
                <ChevronDown className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 shrink-0" />
              )}
              {TOOLS_MENU.label}
            </button>
            {expandedCategories.has(TOOLS_MENU.id) && (
              <div className="pb-1">
                {TOOLS_MENU.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onMenuSelect(item)}
                    className={cn(
                      "w-full text-left pl-7 pr-3 py-1.5 text-xs transition-colors truncate flex items-center gap-1.5",
                      selectedMenuId === item.id
                        ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    )}
                  >
                    <Calculator className="w-3 h-3 shrink-0" />
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

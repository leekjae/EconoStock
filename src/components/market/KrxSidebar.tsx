import { useMemo, useState } from "react";
import { BarChart3, Calculator, ChevronDown, ChevronRight, Home, Search, Sparkles, Users, X } from "lucide-react";

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
  label: "홈",
  endpoint: "",
  category: "home",
};

export const SCREENING_MENU: MenuItem = {
  id: "screening_monitor",
  screenId: "SCR001",
  label: "스크리닝 종목",
  endpoint: "screening",
  category: "screening",
};

export const MENU_STRUCTURE: MenuCategory[] = [
  {
    id: "screening",
    label: "스크리닝 결과",
    items: [SCREENING_MENU],
  },
  {
    id: "investor",
    label: "투자자별 매매",
    items: [
      {
        id: "inv_top",
        screenId: "INV001",
        label: "주체별 누적 순매수",
        endpoint: "investor",
        category: "investor",
      },
    ],
  },
  {
    id: "theme",
    label: "테마",
    items: [
      {
        id: "theme_browser",
        screenId: "PXI001",
        label: "테마별 종목",
        endpoint: "pykrx",
        category: "pykrx",
      },
    ],
  },
];

export const TOOLS_MENU: MenuCategory = {
  id: "tools",
  label: "도구",
  items: [
    {
      id: "avg_calc",
      screenId: "CAL001",
      label: "평단가 계산기",
      endpoint: "",
      category: "tools",
    },
  ],
};

interface KrxSidebarProps {
  selectedMenuId: string;
  onMenuSelect: (item: MenuItem) => void;
}

export function KrxSidebar({ selectedMenuId, onMenuSelect }: KrxSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set([...MENU_STRUCTURE.map((category) => category.id), TOOLS_MENU.id]),
  );

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((previous) => {
      const next = new Set(previous);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  const filteredMenu = useMemo(() => {
    if (!searchQuery.trim()) {
      return MENU_STRUCTURE;
    }

    const query = searchQuery.trim().toLowerCase();
    return MENU_STRUCTURE.map((category) => ({
      ...category,
      items: category.items.filter(
        (item) =>
          item.label.toLowerCase().includes(query) || item.screenId.toLowerCase().includes(query),
      ),
    })).filter((category) => category.items.length > 0);
  }, [searchQuery]);

  return (
    <div className="flex h-full w-56 min-w-[224px] flex-col border-r border-border bg-sidebar">
      <div className="border-b border-sidebar-border p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="메뉴 검색"
            className="h-8 border-sidebar-border bg-sidebar-accent pl-8 pr-8 text-xs"
          />

          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="py-1">
          <button
            type="button"
            onClick={() => onMenuSelect(HOME_MENU)}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold transition-colors",
              selectedMenuId === "home"
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent",
            )}
          >
            <Home className="h-3.5 w-3.5 shrink-0" />
            {HOME_MENU.label}
          </button>

          {filteredMenu.map((category) => {
            const isExpanded = expandedCategories.has(category.id) || !!searchQuery.trim();
            const categoryIcon =
              category.id === "screening" ? (
                <BarChart3 className="h-3.5 w-3.5 shrink-0" />
              ) : category.id === "investor" ? (
                <Users className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
              );

            return (
              <div key={category.id}>
                <button
                  type="button"
                  onClick={() => toggleCategory(category.id)}
                  className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-semibold text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  )}
                  {categoryIcon}
                  {category.label}
                </button>
                {isExpanded ? (
                  <div className="pb-1">
                    {category.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onMenuSelect(item)}
                        className={cn(
                          "w-full truncate px-3 py-1.5 pl-7 pr-3 text-left text-xs transition-colors",
                          selectedMenuId === item.id
                            ? "bg-sidebar-primary font-medium text-sidebar-primary-foreground"
                            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}

          <Separator className="my-1" />
          <div>
            <button
              type="button"
              onClick={() => toggleCategory(TOOLS_MENU.id)}
              className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-semibold text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
            >
              {expandedCategories.has(TOOLS_MENU.id) ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              )}
              <Calculator className="h-3.5 w-3.5 shrink-0" />
              {TOOLS_MENU.label}
            </button>
            {expandedCategories.has(TOOLS_MENU.id) ? (
              <div className="pb-1">
                {TOOLS_MENU.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onMenuSelect(item)}
                    className={cn(
                      "flex w-full items-center gap-1.5 truncate px-3 py-1.5 pl-7 pr-3 text-left text-xs transition-colors",
                      selectedMenuId === item.id
                        ? "bg-sidebar-primary font-medium text-sidebar-primary-foreground"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    )}
                  >
                    <Calculator className="h-3 w-3 shrink-0" />
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

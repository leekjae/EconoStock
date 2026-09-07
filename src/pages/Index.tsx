import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Menu } from "lucide-react";

import { useBusinessDate } from "@/hooks/useKrxData";
import {
  HOME_MENU,
  KrxSidebar,
  MENU_STRUCTURE,
  type MenuCategory,
  type MenuItem,
  TOOLS_MENU,
} from "@/components/market/KrxSidebar";
import { HomeDashboard } from "@/components/market/HomeDashboard";
import { InvestorTopEquities } from "@/components/market/InvestorTopEquities";
import { IndexExplorer } from "@/components/market/IndexExplorer";
import { AveragePriceCalculator } from "@/components/market/AveragePriceCalculator";
import { ScreeningMonitor } from "@/components/screening/ScreeningMonitor";
import { ModelPredictions } from "@/components/screening/ModelPredictions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

const DEFAULT_MENU = HOME_MENU;

function parseBusinessDate(dateText?: string) {
  if (!dateText || !/^\d{8}$/.test(dateText)) {
    return undefined;
  }

  const year = Number(dateText.slice(0, 4));
  const month = Number(dateText.slice(4, 6)) - 1;
  const day = Number(dateText.slice(6, 8));
  return new Date(year, month, day);
}

const Index = () => {
  const { data: latestDate, isLoading: dateLoading } = useBusinessDate();
  const [selectedMenu, setSelectedMenu] = useState<MenuItem>(DEFAULT_MENU);
  const [initialDate, setInitialDate] = useState<Date | undefined>();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!initialDate && latestDate) {
      setInitialDate(parseBusinessDate(latestDate));
    }
  }, [initialDate, latestDate]);

  const breadcrumb = useMemo(() => {
    if (selectedMenu.category === "home") {
      return { parent: null, current: HOME_MENU.label };
    }

    const categories: MenuCategory[] = [...MENU_STRUCTURE, TOOLS_MENU];
    for (const category of categories) {
      const item = category.items.find((entry) => entry.id === selectedMenu.id);
      if (item) {
        return { parent: category.label, current: item.label };
      }
    }

    return { parent: null, current: selectedMenu.label };
  }, [selectedMenu]);

  const latestDateLabel =
    latestDate && /^\d{8}$/.test(latestDate)
      ? `${latestDate.slice(0, 4)}.${latestDate.slice(4, 6)}.${latestDate.slice(6, 8)}`
      : latestDate;

  const handleMenuSelect = (item: MenuItem) => {
    setSelectedMenu(item);
    setMobileMenuOpen(false);
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <KrxSidebar
        selectedMenuId={selectedMenu.id}
        onMenuSelect={handleMenuSelect}
        className="hidden md:flex"
      />

      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="w-[280px] max-w-[85vw] p-0 md:hidden">
          <SheetTitle className="sr-only">EconoStock 메뉴</SheetTitle>
          <KrxSidebar
            selectedMenuId={selectedMenu.id}
            onMenuSelect={handleMenuSelect}
            className="w-full min-w-0 border-r-0"
            headerLabel="EconoStock 메뉴"
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-2 sm:px-4">
          <div className="flex min-w-0 items-center gap-1 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 md:hidden"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="h-4 w-4" />
              <span className="sr-only">메뉴 열기</span>
            </Button>
            <nav className="flex min-w-0 items-center gap-1 overflow-hidden text-xs">
              {breadcrumb.parent ? (
                <>
                  <span className="hidden shrink-0 text-muted-foreground sm:inline">
                    {breadcrumb.parent}
                  </span>
                  <ChevronRight className="hidden h-3 w-3 shrink-0 text-muted-foreground sm:block" />
                  <span className="truncate font-bold text-foreground">{breadcrumb.current}</span>
                </>
              ) : (
                <span className="truncate font-bold text-foreground">{breadcrumb.current}</span>
              )}
            </nav>
          </div>
          <div className="hidden shrink-0 items-center gap-3 sm:flex">
            {dateLoading ? (
              <span className="text-[10px] text-muted-foreground">기준 영업일 불러오는 중...</span>
            ) : latestDateLabel ? (
              <span className="text-[10px] text-muted-foreground">기준 영업일 {latestDateLabel}</span>
            ) : null}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden">
          {selectedMenu.category === "home" ? (
            <MarketHome basDd={latestDate} dateLoading={dateLoading} />
          ) : null}

          {selectedMenu.category === "screening" ? (
            <div className="h-full overflow-auto p-3 sm:p-4">
              <ScreeningMonitor />
            </div>
          ) : null}

          {selectedMenu.category === "model_prediction" ? (
            <div className="h-full overflow-auto p-3 sm:p-4">
              <ModelPredictions />
            </div>
          ) : null}

          {selectedMenu.category === "investor" ? (
            <div className="h-full overflow-hidden">
              <InvestorTopEquities initialStartDate={initialDate} initialEndDate={initialDate} />
            </div>
          ) : null}

          {selectedMenu.category === "pykrx" ? (
            <div className="h-full overflow-hidden">
              <IndexExplorer />
            </div>
          ) : null}

          {selectedMenu.category === "tools" ? (
            <div className="h-full overflow-hidden">
              <AveragePriceCalculator />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

function MarketHome({ basDd, dateLoading }: { basDd?: string; dateLoading: boolean }) {
  return (
    <div
      className="h-full min-h-0 touch-pan-y overflow-y-auto overscroll-y-contain p-3 sm:p-4"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      <Card className="overflow-hidden border-slate-200 bg-white/95 shadow-sm">
        <CardContent className="p-0">
          <div className="min-h-[620px]">
            <HomeDashboard basDd={basDd} dateLoading={dateLoading} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default Index;

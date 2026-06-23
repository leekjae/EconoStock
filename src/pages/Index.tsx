import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

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
import { Card, CardContent } from "@/components/ui/card";

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

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <KrxSidebar selectedMenuId={selectedMenu.id} onMenuSelect={setSelectedMenu} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-10 items-center justify-between border-b border-border bg-background px-4 shrink-0">
          <nav className="flex items-center gap-1 text-xs">
            {breadcrumb.parent ? (
              <>
                <span className="text-muted-foreground">{breadcrumb.parent}</span>
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <span className="font-bold text-foreground">{breadcrumb.current}</span>
              </>
            ) : (
              <span className="font-bold text-foreground">{breadcrumb.current}</span>
            )}
          </nav>
          <div className="flex items-center gap-3">
            {dateLoading ? (
              <span className="text-[10px] text-muted-foreground">기준 영업일 불러오는 중...</span>
            ) : latestDateLabel ? (
              <span className="text-[10px] text-muted-foreground">기준 영업일 {latestDateLabel}</span>
            ) : null}
          </div>
        </header>

        <div className="flex-1 overflow-hidden">
          {selectedMenu.category === "home" ? (
            <MarketHome basDd={latestDate} dateLoading={dateLoading} />
          ) : null}

          {selectedMenu.category === "screening" ? (
            <div className="h-full overflow-auto p-4">
              <ScreeningMonitor />
            </div>
          ) : null}

          {selectedMenu.category === "investor" ? (
            <div className="h-full overflow-auto">
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
    <div className="flex h-full flex-col gap-4 overflow-auto p-4">
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

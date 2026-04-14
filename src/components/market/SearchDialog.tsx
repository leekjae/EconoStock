import { useState, useMemo, useRef, useEffect } from "react";
import { StockBaseInfo, StockData } from "@/types/krx";
import { Search, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
  baseInfoList: StockBaseInfo[];
  allStocks: StockData[];
  onSelect: (stock: StockData) => void;
}

export function SearchDialog({ open, onClose, baseInfoList, allStocks, onSelect }: SearchDialogProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();
    // Search base info for matching names/codes
    const matchedCodes = new Set<string>();
    baseInfoList.forEach((info) => {
      if (
        info.ISU_NM.toLowerCase().includes(q) ||
        info.ISU_ABBRV.toLowerCase().includes(q) ||
        info.ISU_SRT_CD.toLowerCase().includes(q) ||
        info.ISU_CD.toLowerCase().includes(q)
      ) {
        matchedCodes.add(info.ISU_CD);
        matchedCodes.add(info.ISU_SRT_CD);
      }
    });

    // Also search allStocks directly
    return allStocks
      .filter(
        (s) =>
          matchedCodes.has(s.ISU_CD) ||
          s.ISU_NM.toLowerCase().includes(q) ||
          s.ISU_CD.toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [query, baseInfoList, allStocks]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg p-0 gap-0">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle className="sr-only">종목 검색</DialogTitle>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="종목명 또는 종목코드 검색"
              className="pl-10 pr-10 h-12 text-base border-0 border-b border-border rounded-none focus-visible:ring-0"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          {query && results.length === 0 && (
            <div className="py-12 text-center text-muted-foreground text-sm">
              검색 결과가 없습니다
            </div>
          )}

          {results.map((stock, i) => (
            <button
              key={`${stock.ISU_CD}-${i}`}
              onClick={() => {
                onSelect(stock);
                onClose();
              }}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/50 transition-colors text-left border-b border-border last:border-0"
            >
              <div>
                <div className="font-medium text-sm">{stock.ISU_NM}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {stock.ISU_CD} · {stock.MKT_NM}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold tabular-nums">
                  {stock.TDD_CLSPRC}
                </div>
                <div
                  className={`text-xs tabular-nums ${
                    Number(stock.FLUC_RT?.replace(/,/g, "")) > 0
                      ? "text-up"
                      : Number(stock.FLUC_RT?.replace(/,/g, "")) < 0
                      ? "text-down"
                      : "text-flat"
                  }`}
                >
                  {stock.FLUC_RT}%
                </div>
              </div>
            </button>
          ))}

          {!query && (
            <div className="py-12 text-center text-muted-foreground text-sm">
              종목명 또는 코드를 입력하세요
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

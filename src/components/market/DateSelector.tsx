import { useState } from "react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { CalendarIcon, CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type DateMode = "single" | "range";

interface DateSelectorProps {
  date: Date | undefined;
  endDate?: Date | undefined;
  dateMode: DateMode;
  onDateChange: (date: Date | undefined) => void;
  onEndDateChange?: (date: Date | undefined) => void;
  onDateModeChange: (mode: DateMode) => void;
  label?: string;
}

export function DateSelector({
  date,
  endDate,
  dateMode,
  onDateChange,
  onEndDateChange,
  onDateModeChange,
  label,
}: DateSelectorProps) {
  const [open, setOpen] = useState(false);

  const displayLabel = () => {
    if (dateMode === "single" && date) {
      return format(date, "yyyy.MM.dd", { locale: ko });
    }
    if (dateMode === "range" && date && endDate) {
      return `${format(date, "MM.dd")} ~ ${format(endDate, "MM.dd")}`;
    }
    return label || "날짜 선택";
  };

  return (
    <div className="flex items-center gap-1">
      {/* Mode toggle */}
      <Button
        variant="ghost"
        size="icon"
        className="w-8 h-8"
        onClick={() => onDateModeChange(dateMode === "single" ? "range" : "single")}
        title={dateMode === "single" ? "기간 선택 모드" : "단일 날짜 모드"}
      >
        {dateMode === "single" ? (
          <CalendarIcon className="w-3.5 h-3.5" />
        ) : (
          <CalendarRange className="w-3.5 h-3.5 text-primary" />
        )}
      </Button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "h-9 px-3 text-sm font-medium justify-start gap-2",
              !date && "text-muted-foreground",
              dateMode === "range" && "border-primary/50"
            )}
          >
            <CalendarIcon className="w-3.5 h-3.5" />
            {displayLabel()}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          {dateMode === "single" ? (
            <Calendar
              mode="single"
              selected={date}
              defaultMonth={date}
              onSelect={(d) => {
                onDateChange(d);
                setOpen(false);
              }}
              initialFocus
              className="p-3 pointer-events-auto"
              disabled={(d) => d > new Date()}
            />
          ) : (
            <div className="p-3 space-y-3">
              <div className="flex gap-3">
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1.5 px-1">시작일</div>
                  <Calendar
                    mode="single"
                    selected={date}
                    defaultMonth={date}
                    onSelect={(d) => onDateChange(d)}
                    className="pointer-events-auto"
                    disabled={(d) => d > new Date() || (endDate ? d > endDate : false)}
                  />
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1.5 px-1">종료일</div>
                  <Calendar
                    mode="single"
                    selected={endDate}
                    defaultMonth={endDate}
                    onSelect={(d) => {
                      onEndDateChange?.(d);
                      if (date && d) setOpen(false);
                    }}
                    className="pointer-events-auto"
                    disabled={(d) => d > new Date() || (date ? d < date : false)}
                  />
                </div>
              </div>
              {/* Quick range presets */}
              <div className="flex gap-1.5 border-t border-border pt-2">
                {[
                  { label: "5일", days: 7 },
                  { label: "1개월", days: 30 },
                  { label: "3개월", days: 90 },
                ].map((preset) => (
                  <Button
                    key={preset.label}
                    variant="secondary"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => {
                      const end = endDate || new Date();
                      const start = new Date(end);
                      start.setDate(start.getDate() - preset.days);
                      onDateChange(start);
                      onEndDateChange?.(end);
                      setOpen(false);
                    }}
                  >
                    최근 {preset.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

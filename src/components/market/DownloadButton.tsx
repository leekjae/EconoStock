import { useState } from "react";
import { Download, FileSpreadsheet, BarChart3, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { downloadCSV } from "@/lib/krx-api";
import { toast } from "sonner";

interface DownloadButtonProps {
  endpoint: string;
  startDate: string;
  endDate: string;
  label?: string;
  size?: "sm" | "default" | "icon";
}

export function DownloadButton({ endpoint, startDate, endDate, label, size = "icon" }: DownloadButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleDownload = async (csvType: "raw" | "summary") => {
    setLoading(true);
    try {
      await downloadCSV(endpoint, startDate, endDate, csvType);
      toast.success("CSV 다운로드 완료");
      setOpen(false);
    } catch (e) {
      toast.error("다운로드 실패", {
        description: (e as Error).message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size={size}
        onClick={() => setOpen(true)}
        className={size === "icon" ? "w-9 h-9" : ""}
        title="CSV 다운로드"
      >
        <Download className="w-4 h-4" />
        {label && <span className="ml-1.5">{label}</span>}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>CSV 다운로드</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 pt-2">
            <p className="text-sm text-muted-foreground mb-3">
              {startDate.slice(0, 4)}.{startDate.slice(4, 6)}.{startDate.slice(6, 8)}
              {startDate !== endDate && ` ~ ${endDate.slice(0, 4)}.${endDate.slice(4, 6)}.${endDate.slice(6, 8)}`}
            </p>
            <button
              onClick={() => handleDownload("raw")}
              disabled={loading}
              className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-secondary/50 transition-colors text-left"
            >
              <FileSpreadsheet className="w-5 h-5 text-primary shrink-0" />
              <div>
                <div className="text-sm font-medium">원천 일별 데이터</div>
                <div className="text-xs text-muted-foreground">기간 내 모든 일별 데이터 행</div>
              </div>
            </button>
            <button
              onClick={() => handleDownload("summary")}
              disabled={loading}
              className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-secondary/50 transition-colors text-left"
            >
              <BarChart3 className="w-5 h-5 text-primary shrink-0" />
              <div>
                <div className="text-sm font-medium">집계 요약</div>
                <div className="text-xs text-muted-foreground">종목별 변동률/거래량/거래대금 요약</div>
              </div>
            </button>
          </div>
          {loading && (
            <div className="text-center py-2 text-sm text-muted-foreground">
              다운로드 중...
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

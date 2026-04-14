import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RotateCcw, Copy } from "lucide-react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";

/* ── helpers ─────────────────────────────────────────── */

/** Parse a comma-formatted string back to number */
const parseNum = (v: string): number => {
  const cleaned = v.replace(/,/g, "");
  if (cleaned === "" || cleaned === "-") return 0;
  return Number(cleaned);
};

/** Format number with commas; keep up to `dec` decimals */
const fmt = (n: number, dec = 0): string => {
  if (!isFinite(n)) return "-";
  return n.toLocaleString("ko-KR", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
};

/** Validate: not negative, not NaN */
const isValid = (v: string): boolean => {
  const n = parseNum(v);
  return !isNaN(n) && n >= 0;
};

/** Format input value with commas while preserving decimal */
const formatInput = (raw: string): string => {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length === 0) return "";
  const intPart = parts[0].replace(/^0+(?=\d)/, "");
  const formatted = intPart ? Number(intPart).toLocaleString("ko-KR") : intPart;
  if (parts.length > 1) {
    return `${formatted}.${parts[1].slice(0, 4)}`;
  }
  return formatted;
};

/* ── component ───────────────────────────────────────── */

export function AveragePriceCalculator() {
  const [q1, setQ1] = useState("");
  const [p1, setP1] = useState("");
  const [q2, setQ2] = useState("");
  const [p2, setP2] = useState("");

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (q1 && !isValid(q1)) e.q1 = "올바른 숫자를 입력하세요";
    if (p1 && !isValid(p1)) e.p1 = "올바른 숫자를 입력하세요";
    if (q2 && !isValid(q2)) e.q2 = "올바른 숫자를 입력하세요";
    if (p2 && !isValid(p2)) e.p2 = "올바른 숫자를 입력하세요";
    return e;
  }, [q1, p1, q2, p2]);

  const hasError = Object.keys(errors).length > 0;

  const result = useMemo(() => {
    if (hasError) return null;
    const nq1 = parseNum(q1);
    const np1 = parseNum(p1);
    const nq2 = parseNum(q2);
    const np2 = parseNum(p2);
    const totalQty = nq1 + nq2;
    const totalAmt = nq1 * np1 + nq2 * np2;
    if (totalQty === 0) return null;
    const avgPrice = totalAmt / totalQty;
    // Determine decimal places based on user input
    const hasDec = p1.includes(".") || p2.includes(".");
    const dec = hasDec ? 2 : 0;
    return {
      avgPrice,
      totalQty,
      totalAmt,
      holdAmt: nq1 * np1,
      addAmt: nq2 * np2,
      dec,
    };
  }, [q1, p1, q2, p2, hasError]);

  const handleChange = useCallback(
    (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setter(formatInput(e.target.value));
    },
    [],
  );

  const handleReset = useCallback(() => {
    setQ1("");
    setP1("");
    setQ2("");
    setP2("");
  }, []);

  const handleCopy = useCallback(() => {
    if (!result) return;
    const text = `평균단가: ${fmt(result.avgPrice, result.dec)}원\n총 수량: ${fmt(result.totalQty)}주\n총 매입금액: ${fmt(result.totalAmt)}원`;
    navigator.clipboard.writeText(text).then(() => {
      toast.success("복사 완료", { description: "결과가 클립보드에 복사되었습니다." });
    });
  }, [result]);

  return (
    <ScrollArea className="h-full">
      <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-5">
        {/* Title */}
        <div>
          <h2 className="text-lg font-bold text-foreground">[CAL001] 평단가 계산기</h2>
          <p className="text-xs text-muted-foreground mt-1">
            현재 보유와 추가 매수 정보를 입력하면 최종 평균단가를 계산합니다.
          </p>
        </div>

        {/* Input cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Card A */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">현재 보유</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">보유 수량 (주)</Label>
                <Input
                  inputMode="decimal"
                  placeholder="0"
                  value={q1}
                  onChange={handleChange(setQ1)}
                  className="text-right tabular-nums"
                />
                {errors.q1 && <p className="text-[11px] text-destructive">{errors.q1}</p>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">매입 평균단가 (원)</Label>
                <Input
                  inputMode="decimal"
                  placeholder="0"
                  value={p1}
                  onChange={handleChange(setP1)}
                  className="text-right tabular-nums"
                />
                {errors.p1 && <p className="text-[11px] text-destructive">{errors.p1}</p>}
              </div>
            </CardContent>
          </Card>

          {/* Card B */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">추가 매수</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">추가 수량 (주)</Label>
                <Input
                  inputMode="decimal"
                  placeholder="0"
                  value={q2}
                  onChange={handleChange(setQ2)}
                  className="text-right tabular-nums"
                />
                {errors.q2 && <p className="text-[11px] text-destructive">{errors.q2}</p>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">매수 평균단가 (원)</Label>
                <Input
                  inputMode="decimal"
                  placeholder="0"
                  value={p2}
                  onChange={handleChange(setP2)}
                  className="text-right tabular-nums"
                />
                {errors.p2 && <p className="text-[11px] text-destructive">{errors.p2}</p>}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Result card */}
        <Card className="bg-accent/40 border-accent">
          <CardContent className="pt-5 space-y-3">
            {result ? (
              <>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">최종 매입 평균단가</p>
                  <p className="text-2xl md:text-3xl font-bold text-foreground tabular-nums">
                    {fmt(result.avgPrice, result.dec)}
                    <span className="text-sm font-normal text-muted-foreground ml-1">원</span>
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="text-center">
                    <p className="text-[11px] text-muted-foreground">최종 보유수량</p>
                    <p className="text-sm font-semibold tabular-nums">{fmt(result.totalQty)} 주</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[11px] text-muted-foreground">총 매입금액</p>
                    <p className="text-sm font-semibold tabular-nums">{fmt(result.totalAmt)} 원</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center">
                    <p className="text-[11px] text-muted-foreground">현재 보유금액</p>
                    <p className="text-xs tabular-nums text-muted-foreground">{fmt(result.holdAmt)} 원</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[11px] text-muted-foreground">추가 매수금액</p>
                    <p className="text-xs tabular-nums text-muted-foreground">{fmt(result.addAmt)} 원</p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-center text-sm text-muted-foreground py-4">
                {hasError ? "입력값을 확인해주세요" : "수량과 단가를 입력하면 결과가 표시됩니다"}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Buttons */}
        <div className="flex gap-3 justify-center">
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            초기화
          </Button>
          <Button size="sm" onClick={handleCopy} disabled={!result}>
            <Copy className="w-3.5 h-3.5 mr-1.5" />
            결과 복사
          </Button>
        </div>
      </div>
    </ScrollArea>
  );
}

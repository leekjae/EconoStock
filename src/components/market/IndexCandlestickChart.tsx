import { useState } from "react";

export interface IndexCandle {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
}

export function parseIndexPrice(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const number = (value: number) => value.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateLabel = (date: string) => `${date.slice(4, 6)}.${date.slice(6, 8)}`;
const hasCandle = (r: IndexCandle) => r.open !== null && r.high !== null && r.low !== null
  && r.high >= Math.max(r.open, r.close) && r.low <= Math.min(r.open, r.close);

export function IndexCandlestickChart({ title, rows }: { title: string; rows: IndexCandle[] }) {
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const data = [...rows].filter(r => Number.isFinite(r.close) && r.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (!data.length) return null;
  const complete = data.filter(hasCandle);
  const highest = complete.reduce<IndexCandle | null>((a, b) => !a || b.high! > a.high! ? b : a, null);
  const lowest = complete.reduce<IndexCandle | null>((a, b) => !a || b.low! < a.low! ? b : a, null);
  const values = data.flatMap(r => hasCandle(r) ? [r.low!, r.high!] : [r.close]);
  const min = Math.min(...values), max = Math.max(...values);
  const padding = Math.max((max - min) * 0.18, max * 0.002);
  const lower = min - padding, upper = max + padding;
  const left = 76, right = 538, top = 40, bottom = 224;
  const step = (right - left) / data.length;
  const x = (index: number) => left + step * (index + 0.5);
  const y = (value: number) => bottom - (value - lower) / (upper - lower) * (bottom - top);
  const selected = data.find(r => r.date === activeDate);
  const selectedX = selected ? x(data.indexOf(selected)) / 560 * 100 : 0;
  const marker = (row: IndexCandle | null, isHigh: boolean) => {
    if (!row) return null;
    const cx = x(data.indexOf(row)), cy = y(isHigh ? row.high! : row.low!);
    const color = isHigh ? "#dc2626" : "#2563eb";
    const anchor = cx < 200 ? "start" : cx > 410 ? "end" : "middle";
    return <g pointerEvents="none">
      <circle cx={cx} cy={cy} r={4} fill={color} stroke="white" strokeWidth={1.5} />
      <text x={cx} y={cy + (isHigh ? -12 : 20)} textAnchor={anchor} fill={color} fontSize={13} fontWeight={600}
        stroke="hsl(var(--card))" strokeWidth={3} paintOrder="stroke">
        {isHigh ? "최고" : "최저"} {number(isHigh ? row.high! : row.low!)}
      </text>
    </g>;
  };
  return <div className="rounded-xl border border-border bg-card p-4">
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-xs font-bold">{title}</h3>
      <span className="text-[10px] text-muted-foreground">최근 {data.length}영업일 · 일봉</span>
    </div>
    <div className="relative" onMouseLeave={() => setActiveDate(null)}>
    <svg viewBox="0 0 560 260" className="w-full" role="img" aria-label={`${title} 최근 ${data.length}영업일 캔들 차트`}>
      {Array.from({ length: 4 }, (_, i) => {
        const value = lower + (upper - lower) * i / 3;
        return <g key={i}>
          <line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="hsl(var(--border))" strokeDasharray="3 3" />
          <text x={left - 8} y={y(value) + 4} textAnchor="end" fontSize={12} fill="hsl(var(--muted-foreground))">{number(value)}</text>
        </g>;
      })}
      {data.map((r, i) => {
        const color = !hasCandle(r) || r.close === r.open ? "#64748b" : r.close > r.open! ? "#dc2626" : "#2563eb";
        const width = Math.min(step * 0.5, 22);
        const description = `${dateLabel(r.date)} 시가 ${r.open === null ? "미확보" : number(r.open)}, 고가 ${r.high === null ? "미확보" : number(r.high)}, 저가 ${r.low === null ? "미확보" : number(r.low)}, 종가 ${number(r.close)}`;
        return <g key={r.date} tabIndex={0} role="button" aria-label={description}
          onMouseEnter={() => setActiveDate(r.date)} onMouseLeave={() => setActiveDate(null)}
          onFocus={() => setActiveDate(r.date)} onBlur={() => setActiveDate(null)}
          onKeyDown={event => { if (event.key === "Escape") setActiveDate(null); }}
          onClick={() => setActiveDate(r.date)}>
          <rect x={x(i) - width / 2 - 5} y={y(hasCandle(r) ? r.high! : r.close) - 5}
            width={width + 10} height={hasCandle(r) ? Math.max(12, y(r.low!) - y(r.high!) + 10) : 12} fill="transparent" />
          {hasCandle(r) ? <>
            <line x1={x(i)} x2={x(i)} y1={y(r.high!)} y2={y(r.low!)} stroke={color} strokeWidth={1.5} />
            <rect x={x(i) - width / 2} y={Math.min(y(r.open!), y(r.close))} width={width}
              height={Math.max(2, Math.abs(y(r.open!) - y(r.close)))} fill={color} />
          </> : <circle cx={x(i)} cy={y(r.close)} r={3} fill={color} />}
          <text x={x(i)} y={249} textAnchor="middle" fontSize={11} fill="hsl(var(--muted-foreground))">{dateLabel(r.date)}</text>
        </g>;
      })}
      {marker(highest, true)}{marker(lowest, false)}
    </svg>
    {selected && <div role="tooltip" className="pointer-events-none absolute top-1 z-10 w-32 rounded-lg border border-border bg-popover px-2.5 py-2 text-[11px] leading-4 text-popover-foreground shadow-md tabular-nums"
      style={selectedX > 55 ? { right: `${100 - selectedX}%` } : { left: `${selectedX}%` }}>
      <span className="font-semibold">{dateLabel(selected.date)}</span>
      {([["시가", selected.open], ["고가", selected.high], ["저가", selected.low], ["종가", selected.close]] as const).map(([label, value]) =>
        <div key={label} className="flex justify-between gap-2"><span className="text-muted-foreground">{label}</span><span>{value === null ? "미확보" : number(value)}</span></div>)}
    </div>}
    </div>
    <p className="mt-2 text-[10px] text-muted-foreground">시가 대비 <span className="text-red-600">상승</span> · <span className="text-blue-600">하락</span> · 봉을 선택하면 일별 수치 표시</p>
    {complete.length < data.length && <p className="mt-1 text-[10px] text-muted-foreground">일부 일자는 시가·고가·저가가 없어 종가 점만 표시합니다. 최고·최저는 완전한 일봉 기준입니다.</p>}
  </div>;
}

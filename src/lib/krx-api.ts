import {
  SUPABASE_PROJECT_ID,
  SUPABASE_PUBLISHABLE_KEY,
} from "@/integrations/supabase/config";

const getProxyUrl = () => {
  const base = `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1/krx-proxy`;
  return base;
};

const LIVE_CACHE_MS = 60 * 1000;

const getHeaders = () => {
  return {
    Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    apikey: SUPABASE_PUBLISHABLE_KEY,
  };
};

export async function fetchKrx<T>(endpoint: string, basDd: string): Promise<T[]> {
  const url = `${getProxyUrl()}?endpoint=${encodeURIComponent(endpoint)}&basDd=${encodeURIComponent(basDd)}`;
  const response = await fetch(url, { headers: getHeaders() });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(err.error || `API error: ${response.status}`);
  }

  const result = await response.json();
  return result?.OutBlock_1 ?? [];
}

// Range query types
export interface RangeResult<T> {
  daily: T[];
  aggregation: AggregatedData[];
  meta: { startDate: string; endDate: string; tradingDays: number; totalRecords: number };
}

export interface AggregatedData {
  ISU_CD: string;
  ISU_NM: string;
  MKT_NM: string;
  SECUGRP_NM: string;
  startDate: string;
  endDate: string;
  startClose: number;
  endClose: number;
  periodChangeRate: number;
  periodHigh: number;
  periodLow: number;
  totalVolume: number;
  totalValue: number;
  avgVolume: number;
  avgValue: number;
  volatility: number;
  tradingDays: number;
  MKTCAP: string;
}

export async function fetchKrxRange<T>(endpoint: string, startDate: string, endDate: string): Promise<RangeResult<T>> {
  const url = `${getProxyUrl()}?mode=range&endpoint=${encodeURIComponent(endpoint)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
  const response = await fetch(url, { headers: getHeaders() });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(err.error || `API error: ${response.status}`);
  }

  return response.json();
}

export function getCSVDownloadUrl(endpoint: string, startDate: string, endDate: string, csvType: "raw" | "summary"): string {
  return `${getProxyUrl()}?mode=csv&endpoint=${encodeURIComponent(endpoint)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&csvType=${csvType}`;
}

export async function downloadCSV(endpoint: string, startDate: string, endDate: string, csvType: "raw" | "summary") {
  const url = getCSVDownloadUrl(endpoint, startDate, endDate, csvType);
  const response = await fetch(url, { headers: getHeaders() });
  if (!response.ok) throw new Error("CSV download failed");

  const blob = await response.blob();
  const filename = `${endpoint.replace(/\//g, "_")}_${startDate}_${endDate}_${csvType}.csv`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Format date to YYYYMMDD
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

// Parse YYYYMMDD to Date
export function parseDate(s: string): Date {
  return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
}

// Parse numeric string (remove commas, handle '-')
export function parseNum(val: string | undefined): number {
  if (!val || val === "-" || val === "") return 0;
  return Number(val.replace(/,/g, "").trim()) || 0;
}

// Format number with commas
export function formatNum(n: number): string {
  return n.toLocaleString("ko-KR");
}

// Format large number (억/조)
export function formatLargeNum(n: number): string {
  if (Math.abs(n) >= 1_0000_0000_0000) {
    return `${(n / 1_0000_0000_0000).toFixed(1)}조`;
  }
  if (Math.abs(n) >= 1_0000_0000) {
    return `${(n / 1_0000_0000).toFixed(0)}억`;
  }
  if (Math.abs(n) >= 1_0000) {
    return `${(n / 1_0000).toFixed(0)}만`;
  }
  return formatNum(n);
}

// Get change direction
export function getDirection(val: string | number): "up" | "down" | "flat" {
  const n = typeof val === "string" ? parseNum(val) : val;
  if (n > 0) return "up";
  if (n < 0) return "down";
  return "flat";
}

function getKstToday(): Date {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [year, month, day] = formatter.format(now).split("-");
  return new Date(Number(year), Number(month) - 1, Number(day));
}

// Find latest business date by trying today and going back
export async function findLatestBusinessDate(): Promise<string> {
  const cached = localStorage.getItem("krx_latest_biz_date");
  if (cached) {
    const { date, ts } = JSON.parse(cached);
    if (Date.now() - ts < LIVE_CACHE_MS) return date;
  }

  const today = getKstToday();
  for (let i = 0; i < 10; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = formatDate(d);
    try {
      const data = await fetchKrx("idx/kospi_dd_trd", dateStr);
      if (data && data.length > 0) {
        localStorage.setItem(
          "krx_latest_biz_date",
          JSON.stringify({ date: dateStr, ts: Date.now() })
        );
        return dateStr;
      }
    } catch {
      continue;
    }
  }
  return formatDate(today);
}

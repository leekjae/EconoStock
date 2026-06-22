import type { Tables } from "@/integrations/supabase/types";

export type InvestorFlowDailyRow = Tables<"investor_flow_daily">;

export type InvestorType = "foreign" | "institution" | "individual";
export type DirectionType = "buy" | "sell";
export type MarketType = "ALL" | "KOSPI" | "KOSDAQ" | "KONEX";

export interface InvestorFlowOverview {
  min_trade_date: string | null;
  max_trade_date: string | null;
  row_count: number;
  stock_count: number;
}

export interface InvestorFlowTradeDate {
  trade_date: string;
}

export interface InvestorFlowRankedRow {
  days_count: number;
  foreign_daily_net: number;
  foreign_period_net: number;
  individual_daily_net: number;
  individual_period_net: number;
  institution_daily_net: number;
  institution_period_net: number;
  latest_close_price: number;
  latest_trade_date: string;
  market: string;
  sort_period_value: number;
  stock_code: string;
  stock_name: string;
}

export interface InvestorArchiveFileMeta {
  month: string;
  path: string;
  trade_date_start: string;
  trade_date_end: string;
  trade_days: number;
  row_count: number;
  stock_count: number;
  signature: string;
}

export interface InvestorArchiveManifest {
  version: number;
  mode: string;
  latest_trade_date: string;
  hot_cutoff_trade_date: string;
  hot_trade_days: number;
  archive_trade_days: number;
  archive_row_schema: string[];
  stock_meta_path: string;
  archive_files: InvestorArchiveFileMeta[];
  generated_at: string;
}

export interface InvestorArchiveStockMeta {
  version: number;
  stocks: Record<string, [string, string]>;
}

export interface InvestorArchiveMonthFile {
  version: number;
  month: string;
  trade_dates: string[];
  stock_codes: string[];
  rows: Array<[number, number, number, number, number, number]>;
}

function getSortValue(row: Pick<InvestorFlowRankedRow, "individual_period_net" | "foreign_period_net" | "institution_period_net">, sortBy: InvestorType) {
  if (sortBy === "individual") {
    return Number(row.individual_period_net || 0);
  }
  if (sortBy === "institution") {
    return Number(row.institution_period_net || 0);
  }
  return Number(row.foreign_period_net || 0);
}

function passesDirection(value: number, direction: DirectionType) {
  return direction === "buy" ? value > 0 : value < 0;
}

export function compareTradeDate(left: string, right: string) {
  return left.localeCompare(right);
}

export function getPreviousCompactDate(value: string) {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6)) - 1;
  const day = Number(value.slice(6, 8));
  const date = new Date(year, month, day);
  date.setDate(date.getDate() - 1);
  const nextYear = date.getFullYear();
  const nextMonth = `${date.getMonth() + 1}`.padStart(2, "0");
  const nextDay = `${date.getDate()}`.padStart(2, "0");
  return `${nextYear}${nextMonth}${nextDay}`;
}

export function filterArchiveFilesForRange(manifest: InvestorArchiveManifest, startDate: string, endDate: string) {
  return manifest.archive_files.filter(
    (file) => compareTradeDate(file.trade_date_start, endDate) <= 0 && compareTradeDate(file.trade_date_end, startDate) >= 0
  );
}

export function aggregateArchiveRankedRows(params: {
  files: InvestorArchiveMonthFile[];
  stockMeta: InvestorArchiveStockMeta;
  startDate: string;
  endDate: string;
  market: MarketType;
  sortBy: InvestorType;
  direction: DirectionType;
  topN: number;
}) {
  const rowMap = new Map<string, InvestorFlowRankedRow>();

  for (const file of params.files) {
    const tradeDates = file.trade_dates;
    const stockCodes = file.stock_codes;

    for (const rawRow of file.rows) {
      const [dateIndex, stockIndex, closePrice, individualNet, foreignNet, institutionNet] = rawRow;
      const tradeDate = tradeDates[dateIndex];
      if (!tradeDate || compareTradeDate(tradeDate, params.startDate) < 0 || compareTradeDate(tradeDate, params.endDate) > 0) {
        continue;
      }

      const stockCode = stockCodes[stockIndex];
      if (!stockCode) {
        continue;
      }

      const meta = params.stockMeta.stocks[stockCode];
      const stockName = meta?.[0] ?? stockCode;
      const market = meta?.[1] ?? "";
      if (params.market !== "ALL" && market !== params.market) {
        continue;
      }

      const existing = rowMap.get(stockCode);
      if (!existing) {
        rowMap.set(stockCode, {
          stock_code: stockCode,
          stock_name: stockName,
          market,
          days_count: 1,
          latest_trade_date: tradeDate,
          latest_close_price: closePrice ?? 0,
          individual_daily_net: individualNet ?? 0,
          individual_period_net: individualNet ?? 0,
          foreign_daily_net: foreignNet ?? 0,
          foreign_period_net: foreignNet ?? 0,
          institution_daily_net: institutionNet ?? 0,
          institution_period_net: institutionNet ?? 0,
          sort_period_value: 0,
        });
        continue;
      }

      existing.days_count += 1;
      existing.individual_period_net += individualNet ?? 0;
      existing.foreign_period_net += foreignNet ?? 0;
      existing.institution_period_net += institutionNet ?? 0;

      if (compareTradeDate(tradeDate, existing.latest_trade_date) >= 0) {
        existing.latest_trade_date = tradeDate;
        existing.latest_close_price = closePrice ?? 0;
        existing.individual_daily_net = individualNet ?? 0;
        existing.foreign_daily_net = foreignNet ?? 0;
        existing.institution_daily_net = institutionNet ?? 0;
      }
    }
  }

  return sortRankedRows(
    Array.from(rowMap.values()).map((row) => ({
      ...row,
      sort_period_value: getSortValue(row, params.sortBy),
    })),
    params.sortBy,
    params.direction,
    params.topN
  );
}

export function sortRankedRows(
  rows: InvestorFlowRankedRow[],
  sortBy: InvestorType,
  direction: DirectionType,
  topN: number
) {
  return rows
    .map((row) => ({
      ...row,
      sort_period_value: getSortValue(row, sortBy),
    }))
    .filter((row) => passesDirection(row.sort_period_value, direction))
    .sort((left, right) => {
      if (direction === "sell") {
        if (left.sort_period_value !== right.sort_period_value) {
          return left.sort_period_value - right.sort_period_value;
        }
      } else if (left.sort_period_value !== right.sort_period_value) {
        return right.sort_period_value - left.sort_period_value;
      }

      return left.stock_code.localeCompare(right.stock_code);
    })
    .slice(0, topN);
}

export function mergeRankedRows(params: {
  archiveRows: InvestorFlowRankedRow[];
  hotRows: InvestorFlowRankedRow[];
  sortBy: InvestorType;
  direction: DirectionType;
  topN: number;
}) {
  const rowMap = new Map<string, InvestorFlowRankedRow>();

  for (const row of [...params.archiveRows, ...params.hotRows]) {
    const existing = rowMap.get(row.stock_code);
    if (!existing) {
      rowMap.set(row.stock_code, { ...row });
      continue;
    }

    existing.days_count += row.days_count;
    existing.individual_period_net += row.individual_period_net;
    existing.foreign_period_net += row.foreign_period_net;
    existing.institution_period_net += row.institution_period_net;

    if (compareTradeDate(row.latest_trade_date, existing.latest_trade_date) >= 0) {
      existing.latest_trade_date = row.latest_trade_date;
      existing.latest_close_price = row.latest_close_price;
      existing.individual_daily_net = row.individual_daily_net;
      existing.foreign_daily_net = row.foreign_daily_net;
      existing.institution_daily_net = row.institution_daily_net;
    }

    if (!existing.stock_name && row.stock_name) {
      existing.stock_name = row.stock_name;
    }
    if (!existing.market && row.market) {
      existing.market = row.market;
    }
  }

  return sortRankedRows(Array.from(rowMap.values()), params.sortBy, params.direction, params.topN);
}

export function extractArchiveDetailRows(params: {
  files: InvestorArchiveMonthFile[];
  stockMeta: InvestorArchiveStockMeta;
  stockCode: string;
  startDate: string;
  endDate: string;
}) {
  const meta = params.stockMeta.stocks[params.stockCode];
  const rows: InvestorFlowDailyRow[] = [];

  for (const file of params.files) {
    const tradeDates = file.trade_dates;
    const stockCodes = file.stock_codes;

    for (const rawRow of file.rows) {
      const [dateIndex, stockIndex, closePrice, individualNet, foreignNet, institutionNet] = rawRow;
      const stockCode = stockCodes[stockIndex];
      if (stockCode !== params.stockCode) {
        continue;
      }

      const tradeDate = tradeDates[dateIndex];
      if (!tradeDate || compareTradeDate(tradeDate, params.startDate) < 0 || compareTradeDate(tradeDate, params.endDate) > 0) {
        continue;
      }

      rows.push({
        trade_date: tradeDate,
        stock_code: stockCode,
        stock_name: meta?.[0] ?? stockCode,
        market: meta?.[1] ?? "",
        close_price: closePrice ?? 0,
        individual_net: individualNet ?? 0,
        foreign_net: foreignNet ?? 0,
        institution_net: institutionNet ?? 0,
        source: "investor_archive",
        collected_at: "",
      });
    }
  }

  return rows.sort((left, right) => compareTradeDate(left.trade_date, right.trade_date));
}

export function mergeDetailRows(archiveRows: InvestorFlowDailyRow[], hotRows: InvestorFlowDailyRow[]) {
  const rowMap = new Map<string, InvestorFlowDailyRow>();

  for (const row of [...archiveRows, ...hotRows]) {
    rowMap.set(`${row.stock_code}-${row.trade_date}`, row);
  }

  return Array.from(rowMap.values()).sort((left, right) => compareTradeDate(left.trade_date, right.trade_date));
}


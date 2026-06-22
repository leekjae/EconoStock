import { describe, expect, it } from "vitest";

import {
  aggregateArchiveRankedRows,
  extractArchiveDetailRows,
  filterArchiveFilesForRange,
  mergeDetailRows,
  mergeRankedRows,
  type InvestorArchiveManifest,
  type InvestorArchiveMonthFile,
  type InvestorArchiveStockMeta,
} from "./investorFlowHybrid";

const stockMeta: InvestorArchiveStockMeta = {
  version: 1,
  stocks: {
    "000001": ["Alpha", "KOSPI"],
    "000002": ["Beta", "KOSDAQ"],
  },
};

const archiveFiles: InvestorArchiveMonthFile[] = [
  {
    version: 1,
    month: "2025-05",
    trade_dates: ["20250530", "20250531"],
    stock_codes: ["000001", "000002"],
    rows: [
      [0, 0, 1000, 10, 20, 30],
      [0, 1, 2000, -5, 50, -45],
    ],
  },
  {
    version: 1,
    month: "2025-06",
    trade_dates: ["20250602", "20250603"],
    stock_codes: ["000001", "000002"],
    rows: [
      [0, 0, 1100, 30, 40, 50],
      [1, 0, 1200, 50, 60, 70],
      [0, 1, 2100, 5, 10, 15],
    ],
  },
];

describe("investorFlowHybrid", () => {
  it("filters archive files by overlapping range", () => {
    const manifest: InvestorArchiveManifest = {
      version: 1,
      mode: "hot-archive",
      latest_trade_date: "20250619",
      hot_cutoff_trade_date: "20250612",
      hot_trade_days: 250,
      archive_trade_days: 1826,
      archive_row_schema: [],
      stock_meta_path: "stock-meta.json",
      generated_at: "",
      archive_files: [
        {
          month: "2025-05",
          path: "archive/2025/investor-flow-2025-05.json",
          trade_date_start: "20250501",
          trade_date_end: "20250531",
          trade_days: 20,
          row_count: 100,
          stock_count: 2,
          signature: "a",
        },
        {
          month: "2025-06",
          path: "archive/2025/investor-flow-2025-06.json",
          trade_date_start: "20250601",
          trade_date_end: "20250611",
          trade_days: 8,
          row_count: 50,
          stock_count: 2,
          signature: "b",
        },
      ],
    };

    expect(filterArchiveFilesForRange(manifest, "20250531", "20250602").map((entry) => entry.month)).toEqual([
      "2025-05",
      "2025-06",
    ]);
  });

  it("aggregates archive rows and sorts by selected investor", () => {
    const rows = aggregateArchiveRankedRows({
      files: archiveFiles,
      stockMeta,
      startDate: "20250530",
      endDate: "20250603",
      market: "ALL",
      sortBy: "foreign",
      direction: "buy",
      topN: 10,
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].stock_code).toBe("000001");
    expect(rows[0].foreign_period_net).toBe(120);
    expect(rows[0].latest_trade_date).toBe("20250603");
    expect(rows[0].foreign_daily_net).toBe(60);
  });

  it("merges archive and hot ranked rows", () => {
    const merged = mergeRankedRows({
      archiveRows: [
        {
          stock_code: "000001",
          stock_name: "Alpha",
          market: "KOSPI",
          days_count: 2,
          latest_trade_date: "20250611",
          latest_close_price: 1200,
          individual_daily_net: 10,
          individual_period_net: 30,
          foreign_daily_net: 20,
          foreign_period_net: 40,
          institution_daily_net: 30,
          institution_period_net: 50,
          sort_period_value: 40,
        },
      ],
      hotRows: [
        {
          stock_code: "000001",
          stock_name: "Alpha",
          market: "KOSPI",
          days_count: 1,
          latest_trade_date: "20250612",
          latest_close_price: 1300,
          individual_daily_net: 15,
          individual_period_net: 15,
          foreign_daily_net: 25,
          foreign_period_net: 25,
          institution_daily_net: 35,
          institution_period_net: 35,
          sort_period_value: 25,
        },
      ],
      sortBy: "foreign",
      direction: "buy",
      topN: 10,
    });

    expect(merged[0].days_count).toBe(3);
    expect(merged[0].foreign_period_net).toBe(65);
    expect(merged[0].latest_trade_date).toBe("20250612");
    expect(merged[0].latest_close_price).toBe(1300);
  });

  it("extracts and merges detail rows without duplicates", () => {
    const archiveRows = extractArchiveDetailRows({
      files: archiveFiles,
      stockMeta,
      stockCode: "000001",
      startDate: "20250530",
      endDate: "20250603",
    });

    const merged = mergeDetailRows(archiveRows, [
      {
        trade_date: "20250612",
        stock_code: "000001",
        stock_name: "Alpha",
        market: "KOSPI",
        close_price: 1300,
        individual_net: 15,
        foreign_net: 25,
        institution_net: 35,
        source: "supabase",
        collected_at: "",
      },
    ]);

    expect(archiveRows).toHaveLength(3);
    expect(merged.map((row) => row.trade_date)).toEqual(["20250530", "20250602", "20250603", "20250612"]);
  });
});


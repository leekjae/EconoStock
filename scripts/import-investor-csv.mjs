#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const REQUIRED_COLUMNS = [
  "trade_date",
  "market",
  "investor_code",
  "stock_code",
  "stock_name",
  "vol_sell",
  "vol_buy",
  "vol_net",
  "val_sell",
  "val_buy",
  "val_net",
];

const ALLOWED_MARKETS = new Set(["ALL", "STK", "KSQ", "KNX"]);
const CHUNK_SIZE = 500;

function usage() {
  console.log(
    "Usage: node scripts/import-investor-csv.mjs --file <csv-path> [--dry-run]\n" +
      "Example: node scripts/import-investor-csv.mjs --file ./data/investor.csv --dry-run"
  );
}

function parseArgs(argv) {
  let filePath = "";
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--file") {
      filePath = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (arg.startsWith("--file=")) {
      filePath = arg.slice("--file=".length);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
  }

  return { filePath, dryRun };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (ch !== "\r") {
      field += ch;
    }
  }

  row.push(field);
  rows.push(row);

  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .replace(/^\uFEFF/, "")
    .toLowerCase();
}

function parseInteger(raw) {
  const s = String(raw ?? "").trim();
  if (!s || s === "-") return 0;
  const normalized = s.replace(/,/g, "");
  if (!/^-?\d+$/.test(normalized)) {
    throw new Error(`invalid integer: ${raw}`);
  }
  return Number(normalized);
}

function normalizeStockCode(raw) {
  const digits = String(raw ?? "")
    .trim()
    .replace(/[^\d]/g, "");
  if (!digits) throw new Error("stock_code is required");
  if (digits.length > 6) throw new Error("stock_code must be <= 6 digits");
  return digits.padStart(6, "0");
}

function validateTradeDate(raw) {
  const v = String(raw ?? "").trim();
  if (!/^\d{8}$/.test(v)) throw new Error("trade_date must be YYYYMMDD");
  return v;
}

function validateInvestorCode(raw) {
  const v = String(raw ?? "").trim();
  if (!/^\d{4}$/.test(v)) throw new Error("investor_code must be 4 digits");
  return v;
}

function validateMarket(raw) {
  const v = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (!ALLOWED_MARKETS.has(v)) {
    throw new Error("market must be one of ALL/STK/KSQ/KNX");
  }
  return v;
}

async function upsertSnapshots(supabaseUrl, serviceKey, rows) {
  let total = 0;

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const resp = await fetch(`${supabaseUrl}/rest/v1/investor_snapshots`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(chunk),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`upsert failed (${resp.status}): ${text.slice(0, 500)}`);
    }

    await resp.text();
    total += chunk.length;
    console.log(`[upsert] ${total}/${rows.length}`);
  }

  return total;
}

async function updateSyncStatus(supabaseUrl, serviceKey, payload) {
  const resp = await fetch(`${supabaseUrl}/rest/v1/investor_sync_status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([payload]),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`[sync-status] failed: ${resp.status} ${text.slice(0, 500)}`);
    return;
  }
  await resp.text();
}

async function main() {
  const { filePath, dryRun } = parseArgs(process.argv.slice(2));
  if (!filePath) {
    usage();
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(1);
  }

  const resolvedFile = path.resolve(process.cwd(), filePath);
  const csvRaw = await fs.readFile(resolvedFile, "utf8");
  const csvRows = parseCsv(csvRaw);
  if (csvRows.length < 2) {
    console.error("CSV has no data rows.");
    process.exit(1);
  }

  const header = csvRows[0].map(normalizeHeader);
  const headerIndex = new Map();
  for (let i = 0; i < header.length; i++) {
    headerIndex.set(header[i], i);
  }

  const missing = REQUIRED_COLUMNS.filter((col) => !headerIndex.has(col));
  if (missing.length > 0) {
    console.error(`Missing required columns: ${missing.join(", ")}`);
    process.exit(1);
  }

  const hasCollectedAt = headerIndex.has("collected_at");
  const validRows = [];
  const skipped = [];

  for (let i = 1; i < csvRows.length; i++) {
    const sourceLine = i + 1;
    const row = csvRows[i];

    try {
      const tradeDate = validateTradeDate(row[headerIndex.get("trade_date")]);
      const market = validateMarket(row[headerIndex.get("market")]);
      const investorCode = validateInvestorCode(row[headerIndex.get("investor_code")]);
      const stockCode = normalizeStockCode(row[headerIndex.get("stock_code")]);
      const stockName = String(row[headerIndex.get("stock_name")] ?? "").trim();
      if (!stockName) throw new Error("stock_name is required");

      const item = {
        trade_date: tradeDate,
        market,
        investor_code: investorCode,
        stock_code: stockCode,
        stock_name: stockName,
        vol_sell: parseInteger(row[headerIndex.get("vol_sell")]),
        vol_buy: parseInteger(row[headerIndex.get("vol_buy")]),
        vol_net: parseInteger(row[headerIndex.get("vol_net")]),
        val_sell: parseInteger(row[headerIndex.get("val_sell")]),
        val_buy: parseInteger(row[headerIndex.get("val_buy")]),
        val_net: parseInteger(row[headerIndex.get("val_net")]),
      };

      if (hasCollectedAt) {
        const collectedAt = String(row[headerIndex.get("collected_at")] ?? "").trim();
        if (collectedAt) {
          const ts = new Date(collectedAt);
          if (Number.isNaN(ts.getTime())) {
            throw new Error("collected_at must be ISO datetime");
          }
          item.collected_at = ts.toISOString();
        }
      }

      validRows.push(item);
    } catch (err) {
      skipped.push({
        line: sourceLine,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log(`file: ${resolvedFile}`);
  console.log(`total rows: ${csvRows.length - 1}`);
  console.log(`valid rows: ${validRows.length}`);
  console.log(`skipped rows: ${skipped.length}`);

  if (skipped.length > 0) {
    console.log("skipped details (first 50):");
    for (const s of skipped.slice(0, 50)) {
      console.log(`  line ${s.line}: ${s.reason}`);
    }
  }

  const nowIso = new Date().toISOString();

  if (dryRun) {
    console.log("[dry-run] no database write");
    return;
  }

  if (validRows.length === 0) {
    await updateSyncStatus(supabaseUrl, serviceKey, {
      sync_key: "manual_import_csv",
      last_attempt_at: nowIso,
      last_error: "NO_VALID_ROWS",
      row_count: 0,
    });
    console.error("No valid rows to import.");
    process.exit(1);
  }

  try {
    const imported = await upsertSnapshots(supabaseUrl, serviceKey, validRows);
    await updateSyncStatus(supabaseUrl, serviceKey, {
      sync_key: "manual_import_csv",
      last_attempt_at: nowIso,
      last_success_at: nowIso,
      last_error: null,
      row_count: imported,
    });
    console.log(`done: imported ${imported} row(s)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateSyncStatus(supabaseUrl, serviceKey, {
      sync_key: "manual_import_csv",
      last_attempt_at: nowIso,
      last_error: message.slice(0, 2000),
      row_count: 0,
    });
    console.error(`import failed: ${message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

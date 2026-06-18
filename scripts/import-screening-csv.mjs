#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const NORMALIZED_REQUIRED_COLUMNS = ["run_key", "as_of_date", "strategy_key", "stock_code", "stock_name"];
const DAILY_ACTION_REQUIRED_COLUMNS = ["trade_date", "ticker", "name", "market"];
const CANDIDATE_CHUNK_SIZE = 500;
const RUN_CHUNK_SIZE = 100;

const SCREENING_GUIDE = {
  strategy_a: {
    title: "Strategy A Main",
    note: "아주 약한 장에서 공포성 하락 뒤 단기 반발을 노리는 메인 평균회귀 후보입니다.",
    horizon: "다음 거래일 시가 검토, 기대 구간 1~5거래일",
  },
  strategy_b: {
    title: "Strategy B Main",
    note: "조정받은 종목의 기술적 반등을 보는 메인 평균회귀 후보입니다.",
    horizon: "다음 거래일 시가 검토, 기대 구간 1~5거래일",
  },
  overlap: {
    title: "Overlap Watchlist",
    note: "룰 점수와 ML 점수가 동시에 붙은 보조 강세 감시목록입니다.",
    horizon: "다음 거래일 우선 확인용 watchlist",
  },
  spike: {
    title: "Spike Event",
    note: "급팽창 뒤 단기 연속성이 붙을 수 있는 이벤트 후보입니다.",
    horizon: "다음 거래일~2거래일 fast event",
  },
  rebound: {
    title: "Rebound Setup",
    note: "강한 추세 종목의 눌림목 반등을 보는 지연형 후보입니다.",
    horizon: "3~5거래일 delayed rebound",
  },
  cash: {
    title: "Cash",
    note: "시장 상태상 메인 진입보다 관망이 우선인 날입니다.",
    horizon: "메인 진입 없음",
  },
  screening: {
    title: "Screening Run",
    note: "수동으로 적재한 스크리닝 결과입니다.",
    horizon: "",
  },
};

export function usage() {
  console.log(
    "Usage: node scripts/import-screening-csv.mjs --file <csv-or-directory> [--dry-run]\n" +
      "Examples:\n" +
      "  node scripts/import-screening-csv.mjs --file ./data/screening.csv --dry-run\n" +
      "  node scripts/import-screening-csv.mjs --file D:\\\\Codex\\\\Screening\\\\output"
  );
}

export function parseArgs(argv) {
  let filePath = "";
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
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

  for (let i = 0; i < text.length; i += 1) {
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

  return rows.filter((entry) => !(entry.length === 1 && entry[0].trim() === ""));
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .replace(/^\uFEFF/, "")
    .toLowerCase();
}

function optionalText(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function requireText(value, label) {
  const normalized = optionalText(value);
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function compactDate(value, label = "date") {
  const normalized = requireText(value, label).replace(/[^0-9]/g, "");
  if (!/^\d{8}$/.test(normalized)) {
    throw new Error(`${label} must be YYYYMMDD or YYYY-MM-DD`);
  }
  return normalized;
}

function parseNumber(value, label) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/,/g, "")
    .replace(/%/g, "");
  if (!normalized) {
    return 0;
  }
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`${label} must be numeric`);
  }
  return Number(normalized);
}

function parseInteger(value, label) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/,/g, "");
  if (!normalized) {
    return 0;
  }
  if (!/^-?\d+$/.test(normalized)) {
    throw new Error(`${label} must be an integer`);
  }
  return Number(normalized);
}

function normalizeStockCode(value) {
  const digits = requireText(value, "stock_code").replace(/[^\d]/g, "");
  if (!digits) {
    throw new Error("stock_code must contain digits");
  }
  if (digits.length > 6) {
    throw new Error("stock_code must be 6 digits or fewer");
  }
  return digits.padStart(6, "0");
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "default";
}

function formatDateIso(ymd) {
  if (!/^\d{8}$/.test(ymd)) {
    return ymd;
  }
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function buildHeaderMap(header) {
  const headerMap = new Map();
  for (let i = 0; i < header.length; i += 1) {
    headerMap.set(header[i], i);
  }
  return headerMap;
}

function getCell(row, headerMap, column) {
  const index = headerMap.get(column);
  if (index === undefined) {
    return "";
  }
  return row[index] ?? "";
}

function firstPresentValue(row, headerMap, columns) {
  for (const column of columns) {
    const value = optionalText(getCell(row, headerMap, column));
    if (value) {
      return value;
    }
  }
  return null;
}

function firstPresentNumber(row, headerMap, columns) {
  for (const column of columns) {
    const raw = optionalText(getCell(row, headerMap, column));
    if (!raw) {
      continue;
    }
    return parseNumber(raw, column);
  }
  return 0;
}

function firstPresentInteger(row, headerMap, columns) {
  for (const column of columns) {
    const raw = optionalText(getCell(row, headerMap, column));
    if (!raw) {
      continue;
    }
    return parseInteger(raw, column);
  }
  return 0;
}

function detectFormat(headerMap) {
  if (NORMALIZED_REQUIRED_COLUMNS.every((column) => headerMap.has(column))) {
    return "normalized";
  }
  if (DAILY_ACTION_REQUIRED_COLUMNS.every((column) => headerMap.has(column))) {
    return "daily_action_sheet";
  }
  return "unknown";
}

function normalizeSignalKey(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return "screening";
  }
  if (normalized.includes("strategy_a")) {
    return "strategy_a";
  }
  if (normalized.includes("strategy_b")) {
    return "strategy_b";
  }
  if (normalized.includes("overlap")) {
    return "overlap";
  }
  if (normalized.includes("spike")) {
    return "spike";
  }
  if (normalized.includes("rebound")) {
    return "rebound";
  }
  if (normalized.includes("cash")) {
    return "cash";
  }
  return slugify(normalized);
}

function buildRunNote(signalKey, asOfDate) {
  const guide = SCREENING_GUIDE[signalKey] || SCREENING_GUIDE.screening;
  const timing = `${formatDateIso(asOfDate)} 종가까지 반영된 신호이며 다음 거래일 시가 전후에 검토하는 리스트입니다.`;
  return [guide.note, timing, guide.horizon ? `기대 구간: ${guide.horizon}.` : null].filter(Boolean).join(" ");
}

function collectTagText(values) {
  const unique = Array.from(
    new Set(
      values
        .map((value) => optionalText(value))
        .filter(Boolean)
        .flatMap((value) => String(value).split(/[|;]/))
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
  return unique.length > 0 ? unique.join(" | ") : null;
}

function createNormalizedImport(rows, headerMap) {
  const candidateRows = [];
  const runMetaMap = new Map();
  const skipped = [];

  for (let i = 1; i < rows.length; i += 1) {
    const sourceLine = i + 1;
    const row = rows[i];

    try {
      const runKey = requireText(getCell(row, headerMap, "run_key"), "run_key");
      const asOfDate = compactDate(getCell(row, headerMap, "as_of_date"), "as_of_date");
      const strategyKey = normalizeSignalKey(getCell(row, headerMap, "strategy_key"));
      const runLabel = optionalText(getCell(row, headerMap, "run_label")) || runKey;
      const source = optionalText(getCell(row, headerMap, "source")) || "csv";
      const status = optionalText(getCell(row, headerMap, "status")) || "completed";
      const notes = optionalText(getCell(row, headerMap, "notes"));

      runMetaMap.set(runKey, {
        run_key: runKey,
        as_of_date: asOfDate,
        run_label: runLabel,
        strategy_key: strategyKey,
        source,
        status,
        notes,
      });

      candidateRows.push({
        run_key: runKey,
        stock_code: normalizeStockCode(getCell(row, headerMap, "stock_code")),
        stock_name: requireText(getCell(row, headerMap, "stock_name"), "stock_name"),
        market: optionalText(getCell(row, headerMap, "market")) || "",
        rank_no: parseInteger(getCell(row, headerMap, "rank_no"), "rank_no"),
        score: parseNumber(getCell(row, headerMap, "score"), "score"),
        signal: optionalText(getCell(row, headerMap, "signal")) || strategyKey,
        close_price: parseNumber(getCell(row, headerMap, "close_price"), "close_price"),
        change_rate: parseNumber(getCell(row, headerMap, "change_rate"), "change_rate"),
        volume: parseInteger(getCell(row, headerMap, "volume"), "volume"),
        reason_summary: optionalText(getCell(row, headerMap, "reason_summary")),
        tags: optionalText(getCell(row, headerMap, "tags")),
      });
    } catch (error) {
      skipped.push({
        line: sourceLine,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    format: "normalized",
    runMetaRows: Array.from(runMetaMap.values()),
    candidateRows,
    skipped,
  };
}

function createDailyActionImport(rows, headerMap, sourceFile) {
  const candidateRows = [];
  const runMetaMap = new Map();
  const skipped = [];

  for (let i = 1; i < rows.length; i += 1) {
    const sourceLine = i + 1;
    const row = rows[i];

    try {
      const asOfDate = compactDate(getCell(row, headerMap, "trade_date"), "trade_date");
      const selectionLabel =
        firstPresentValue(row, headerMap, ["selection_label", "selection_bucket"]) ||
        SCREENING_GUIDE.screening.title;
      const rawSignal =
        firstPresentValue(row, headerMap, [
          "source_list",
          "primary_strategy_code",
          "strategy_code",
          "event_mode_code",
          "selection_bucket",
          "selection_label",
        ]) || "screening";
      const signalKey = normalizeSignalKey(rawSignal);
      const runKey = `screening_${asOfDate}_${slugify(signalKey)}_${slugify(selectionLabel)}`;

      runMetaMap.set(runKey, {
        run_key: runKey,
        as_of_date: asOfDate,
        run_label: selectionLabel,
        strategy_key: signalKey,
        source: "daily_action_sheet",
        status: "completed",
        notes: buildRunNote(signalKey, asOfDate),
      });

      const stockCodeRaw = optionalText(getCell(row, headerMap, "ticker"));
      if (!stockCodeRaw) {
        if (signalKey === "cash") {
          continue;
        }
        throw new Error("stock_code is required");
      }

      const stockCode = normalizeStockCode(stockCodeRaw);
      const stockName = requireText(getCell(row, headerMap, "name"), "name");
      const market = optionalText(getCell(row, headerMap, "market")) || "";

      candidateRows.push({
        run_key: runKey,
        stock_code: stockCode,
        stock_name: stockName,
        market,
        rank_no:
          firstPresentInteger(row, headerMap, ["display_rank", "view_order", "ml_rank", "rank_no"]) || i,
        score: firstPresentNumber(row, headerMap, ["ml_score", "rule_score", "score"]),
        signal: signalKey,
        close_price: firstPresentNumber(row, headerMap, ["close_price", "close", "current_price", "price"]),
        change_rate: firstPresentNumber(row, headerMap, ["change_rate", "pct_change", "change_pct", "return_1d"]),
        volume: firstPresentInteger(row, headerMap, ["volume", "trade_volume"]),
        reason_summary:
          firstPresentValue(row, headerMap, [
            "selection_reason",
            "primary_strategy_reason",
            "event_mode_profile",
            "strategy_profile",
            "selection_label",
          ]) || `${path.basename(sourceFile)} row ${sourceLine}`,
        tags: collectTagText([
          getCell(row, headerMap, "source_list"),
          getCell(row, headerMap, "theme_name"),
          getCell(row, headerMap, "strategy_name"),
          getCell(row, headerMap, "event_mode_name"),
          getCell(row, headerMap, "rule_flags"),
        ]),
      });
    } catch (error) {
      skipped.push({
        line: sourceLine,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    format: "daily_action_sheet",
    runMetaRows: Array.from(runMetaMap.values()),
    candidateRows,
    skipped,
  };
}

export function finalizeRuns(runMetaMap, candidateRows) {
  const statsMap = new Map();

  for (const candidate of candidateRows) {
    const current = statsMap.get(candidate.run_key) || {
      candidate_count: 0,
      score_sum: 0,
      max_score: Number.NEGATIVE_INFINITY,
    };

    current.candidate_count += 1;
    current.score_sum += Number(candidate.score || 0);
    current.max_score = Math.max(current.max_score, Number(candidate.score || 0));
    statsMap.set(candidate.run_key, current);
  }

  return Array.from(runMetaMap.values()).map((meta) => {
    const stats = statsMap.get(meta.run_key) || {
      candidate_count: 0,
      score_sum: 0,
      max_score: Number.NEGATIVE_INFINITY,
    };

    return {
      ...meta,
      candidate_count: stats.candidate_count,
      average_score:
        stats.candidate_count === 0 ? 0 : Number((stats.score_sum / stats.candidate_count).toFixed(4)),
      max_score: Number.isFinite(stats.max_score) ? stats.max_score : 0,
    };
  });
}

export async function resolveInputFiles(targetPath) {
  const stat = await fs.stat(targetPath);

  if (stat.isFile()) {
    return [targetPath];
  }

  if (!stat.isDirectory()) {
    throw new Error("Input path must be a CSV file or a directory");
  }

  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const csvFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csv"))
    .map((entry) => path.join(targetPath, entry.name))
    .sort((left, right) => left.localeCompare(right, "en"));

  if (csvFiles.length === 0) {
    throw new Error("No CSV files found in the provided directory");
  }

  const preferred = csvFiles.filter((file) =>
    path.basename(file).toLowerCase().startsWith("daily_action_sheet_")
  );

  return preferred.length > 0 ? preferred : csvFiles;
}

export async function parseInputFile(filePath) {
  const csvText = await fs.readFile(filePath, "utf8");
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    throw new Error("CSV has no data rows.");
  }

  const header = rows[0].map(normalizeHeader);
  const headerMap = buildHeaderMap(header);
  const format = detectFormat(headerMap);

  if (format === "normalized") {
    return createNormalizedImport(rows, headerMap);
  }

  if (format === "daily_action_sheet") {
    return createDailyActionImport(rows, headerMap, filePath);
  }

  throw new Error(
    `Unsupported CSV schema in ${path.basename(filePath)}. Supported formats: normalized screening.csv or daily_action_sheet CSV.`
  );
}

async function upsertRows({ supabaseUrl, serviceKey, table, rows, chunkSize }) {
  let total = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const resp = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
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
      throw new Error(`${table} upsert failed (${resp.status}): ${text.slice(0, 500)}`);
    }

    await resp.text();
    total += chunk.length;
  }

  return total;
}

async function updateSyncStatus({ supabaseUrl, serviceKey, payload }) {
  const resp = await fetch(`${supabaseUrl}/rest/v1/screening_sync_status`, {
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
    console.error(`[screening_sync_status] ${resp.status}: ${text.slice(0, 300)}`);
    return;
  }

  await resp.text();
}

export async function main() {
  const { filePath, dryRun } = parseArgs(process.argv.slice(2));
  if (!filePath) {
    usage();
    process.exit(1);
  }

  const resolvedInput = path.resolve(process.cwd(), filePath);
  const inputFiles = await resolveInputFiles(resolvedInput);
  const runMetaMap = new Map();
  const candidateMap = new Map();
  const skipped = [];

  console.log(`source: ${resolvedInput}`);
  console.log(`files: ${inputFiles.length}`);

  for (const inputFile of inputFiles) {
    const result = await parseInputFile(inputFile);
    console.log(
      `[parsed] ${path.basename(inputFile)} -> ${result.format}, runs ${result.runMetaRows.length}, candidates ${result.candidateRows.length}, skipped ${result.skipped.length}`
    );

    for (const runMeta of result.runMetaRows) {
      runMetaMap.set(runMeta.run_key, runMeta);
    }

    for (const candidate of result.candidateRows) {
      candidateMap.set(`${candidate.run_key}::${candidate.stock_code}`, candidate);
    }

    for (const item of result.skipped) {
      skipped.push({
        file: path.basename(inputFile),
        line: item.line,
        reason: item.reason,
      });
    }
  }

  const candidateRows = Array.from(candidateMap.values());
  const runRows = finalizeRuns(runMetaMap, candidateRows);

  console.log(`runs: ${runRows.length}`);
  console.log(`candidates: ${candidateRows.length}`);
  console.log(`skipped: ${skipped.length}`);

  if (skipped.length > 0) {
    console.log("skipped details (first 50):");
    for (const item of skipped.slice(0, 50)) {
      console.log(`  ${item.file} line ${item.line}: ${item.reason}`);
    }
  }

  if (dryRun) {
    console.log("[dry-run] no database write");
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(1);
  }

  const nowIso = new Date().toISOString();

  if (candidateRows.length === 0 || runRows.length === 0) {
    await updateSyncStatus({
      supabaseUrl,
      serviceKey,
      payload: {
        sync_key: "manual_import_screening",
        source: "manual",
        last_attempt_at: nowIso,
        last_error: "NO_VALID_ROWS",
        run_count: 0,
        row_count: 0,
      },
    });
    console.error("No valid screening rows to import.");
    process.exit(1);
  }

  try {
    const importedRuns = await upsertRows({
      supabaseUrl,
      serviceKey,
      table: "screening_runs",
      rows: runRows,
      chunkSize: RUN_CHUNK_SIZE,
    });

    const importedCandidates = await upsertRows({
      supabaseUrl,
      serviceKey,
      table: "screening_candidates",
      rows: candidateRows,
      chunkSize: CANDIDATE_CHUNK_SIZE,
    });

    await updateSyncStatus({
      supabaseUrl,
      serviceKey,
      payload: {
        sync_key: "manual_import_screening",
        source: "manual",
        last_attempt_at: nowIso,
        last_success_at: nowIso,
        last_error: null,
        run_count: importedRuns,
        row_count: importedCandidates,
      },
    });

    console.log(`done: imported ${importedRuns} run(s), ${importedCandidates} candidate row(s)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateSyncStatus({
      supabaseUrl,
      serviceKey,
      payload: {
        sync_key: "manual_import_screening",
        source: "manual",
        last_attempt_at: nowIso,
        last_error: message.slice(0, 2000),
        run_count: 0,
        row_count: 0,
      },
    });
    console.error(`import failed: ${message}`);
    process.exit(1);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";

if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";

import { finalizeRuns, parseInputFile, resolveInputFiles } from "./import-screening-csv.mjs";

const STATUS_KEY = "manual_import_screening";

function usage() {
  console.log(
    "Usage: node scripts/sync-screening-output.mjs --file <csv-or-directory> [--dry-run] [--force]\n" +
      "Examples:\n" +
      "  node scripts/sync-screening-output.mjs --file D:\\\\Codex\\\\Screening\\\\output\n" +
      "  node scripts/sync-screening-output.mjs --file D:\\\\Codex\\\\Screening\\\\output --dry-run\n" +
      "  node scripts/sync-screening-output.mjs --file D:\\\\Codex\\\\Screening\\\\output --force"
  );
}

function parseArgs(argv) {
  let filePath = "";
  let dryRun = false;
  let force = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--force") {
      force = true;
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

  return { filePath, dryRun, force };
}

async function fetchSyncStatus(supabaseUrl, serviceKey) {
  const url = new URL(`${supabaseUrl}/rest/v1/screening_sync_status`);
  url.searchParams.set("select", "sync_key,last_success_at,last_attempt_at,last_error,run_count,row_count");
  url.searchParams.set("sync_key", `eq.${STATUS_KEY}`);

  const resp = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/json",
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`screening_sync_status fetch failed (${resp.status}): ${text.slice(0, 300)}`);
  }

  const rows = await resp.json();
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function collectFileInfo(resolvedInput) {
  const files = await resolveInputFiles(resolvedInput);
  const fileInfo = [];

  for (const filePath of files) {
    const stat = await fs.stat(filePath);
    fileInfo.push({
      filePath,
      baseName: path.basename(filePath),
      modifiedAt: stat.mtime.toISOString(),
      modifiedMs: stat.mtimeMs,
    });
  }

  return fileInfo.sort((left, right) => left.filePath.localeCompare(right.filePath, "en"));
}

async function summarizeFiles(files) {
  const runMetaMap = new Map();
  const candidateMap = new Map();
  let skippedCount = 0;

  for (const file of files) {
    const result = await parseInputFile(file.filePath);
    skippedCount += result.skipped.length;

    for (const runMeta of result.runMetaRows) {
      runMetaMap.set(runMeta.run_key, runMeta);
    }

    for (const candidate of result.candidateRows) {
      candidateMap.set(`${candidate.run_key}::${candidate.stock_code}`, candidate);
    }
  }

  const candidateRows = Array.from(candidateMap.values());
  const runRows = finalizeRuns(runMetaMap, candidateRows);

  return {
    runRows,
    candidateRows,
    skippedCount,
  };
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("ko-KR");
}

async function runImport(resolvedInput) {
  const currentFile = fileURLToPath(import.meta.url);
  const importScriptPath = path.join(path.dirname(currentFile), "import-screening-csv.mjs");

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [importScriptPath, "--file", resolvedInput], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`import-screening-csv exited with code ${code ?? "unknown"}`));
    });
  });
}

async function prepareImportTarget(resolvedInput, filesToImport) {
  const stat = await fs.stat(resolvedInput);
  if (stat.isFile()) {
    return {
      importTarget: resolvedInput,
      cleanup: async () => {},
    };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "screening-sync-"));
  for (const file of filesToImport) {
    const targetPath = path.join(tempDir, file.baseName);
    await fs.copyFile(file.filePath, targetPath);
  }

  return {
    importTarget: tempDir,
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}

async function main() {
  const { filePath, dryRun, force } = parseArgs(process.argv.slice(2));
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

  const resolvedInput = path.resolve(process.cwd(), filePath);
  const allFiles = await collectFileInfo(resolvedInput);
  const syncStatus = await fetchSyncStatus(supabaseUrl, serviceKey);
  const lastSuccessMs = syncStatus?.last_success_at ? Date.parse(syncStatus.last_success_at) : 0;

  const changedFiles = force
    ? allFiles
    : allFiles.filter((file) => !lastSuccessMs || file.modifiedMs > lastSuccessMs + 1000);

  console.log(`source: ${resolvedInput}`);
  console.log(`tracked files: ${allFiles.length}`);
  console.log(`last successful import: ${formatDateTime(syncStatus?.last_success_at ?? null)}`);

  if (force) {
    console.log("mode: force");
  } else if (changedFiles.length === 0) {
    console.log("mode: skip");
    console.log("No new or updated screening files since the last successful import.");
    return;
  }

  const filesToCheck = force ? changedFiles : changedFiles;
  console.log(`files to inspect: ${filesToCheck.length}`);
  for (const file of filesToCheck) {
    console.log(`  - ${file.baseName} (${formatDateTime(file.modifiedAt)})`);
  }

  const summary = await summarizeFiles(filesToCheck);
  console.log(`affected runs: ${summary.runRows.length}`);
  console.log(`affected candidates: ${summary.candidateRows.length}`);
  console.log(`skipped rows while parsing: ${summary.skippedCount}`);

  if (dryRun) {
    console.log("[dry-run] import skipped");
    return;
  }

  console.log("Starting screening import...");
  const { importTarget, cleanup } = await prepareImportTarget(resolvedInput, filesToCheck);

  try {
    await runImport(importTarget);
    console.log("Screening sync completed.");
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

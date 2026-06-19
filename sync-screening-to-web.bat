@echo off
setlocal

set "ROOT_DIR=%~dp0"
set "OUTPUT_DIR=D:\Codex\Screening\output"
set "SCREENING_DB=D:\Codex\Screening\data\market_data.sqlite"
set "ENV_FILE=D:\Codex\secrets\econostock-sync.env"

cd /d "%ROOT_DIR%"

if not exist "%OUTPUT_DIR%" (
  echo [screening-sync] Output folder not found: %OUTPUT_DIR%
  exit /b 1
)

if not exist "%SCREENING_DB%" (
  echo [screening-sync] SQLite DB not found: %SCREENING_DB%
  exit /b 1
)

if not exist "%ENV_FILE%" (
  echo [screening-sync] Env file not found: %ENV_FILE%
  exit /b 1
)

echo [screening-sync] Starting sync
echo   output   : %OUTPUT_DIR%
echo   db       : %SCREENING_DB%
echo   env file : %ENV_FILE%

node scripts\sync-screening-output.mjs --file "%OUTPUT_DIR%" --db "%SCREENING_DB%" --env-file "%ENV_FILE%" %*
if errorlevel 1 (
  echo [screening-sync] Failed
  exit /b 1
)

echo [screening-sync] Completed successfully
exit /b 0

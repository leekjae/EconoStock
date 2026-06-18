# 투자자별 순매수 상위종목 수집기 (한국 IP 전용)

## 개요

KRX `data.krx.co.kr`는 한국 외 IP에서 접근이 차단될 수 있습니다.  
이 스크립트는 **서울 리전 서버**에서 실행하여 데이터를 수집하고 Supabase에 적재합니다.

## 아키텍처

```
[한국 서버] → KRX OTP/CSV (한국 IP 필수) → Supabase REST API → investor_snapshots 테이블
↓
[Edge Function] ← DB 조회 ← [웹 클라이언트]
```

## 실행 환경 설정

### 1. 서울 리전 서버 준비

아래 중 하나를 사용하세요:

- **AWS Lambda** (ap-northeast-2)
- **NCP Cloud Functions** (KR)
- **서울 리전 VM** (EC2, NCP Server 등)

### 2. Deno 설치

```bash
curl -fsSL https://deno.land/install.sh | sh
```

### 3. 환경변수 설정

```bash
export SUPABASE_URL="https://your-project-id.supabase.co"
export SUPABASE_SERVICE_KEY="<service_role_key>"
```

## 실행 모드

### 1. 초기 백필 (최근 1년치)

최초 1회 실행하여 과거 데이터를 채웁니다:

```bash
deno run --allow-net --allow-env scripts/collect-investor-data.ts --mode=backfill
```

- 오늘 기준 365일 전부터 오늘까지 모든 평일을 순회
- 휴장일(EMPTY_DATA)은 자동 skip
- 약 250 영업일 × 21 조합 = ~5,250회 호출 (대기 포함 약 70분)

### 2. 증분 수집 (일일 실행)

마지막 수집일 다음 영업일부터 오늘까지 수집합니다:

```bash
deno run --allow-net --allow-env scripts/collect-investor-data.ts --mode=incremental
```

- DB에서 `max(trade_date)` 조회 후 그 다음 날부터 수집
- DB에 데이터가 없으면 최근 30일 수집
- `--mode=incremental`은 기본값이므로 생략 가능

### 3. 단일 날짜 수집

```bash
deno run --allow-net --allow-env scripts/collect-investor-data.ts --mode=single --date=20260407
# 또는 레거시 방식:
deno run --allow-net --allow-env scripts/collect-investor-data.ts 20260407
```

## 스케줄 설정 (cron)

### 매일 21:00 KST 증분 수집

```cron
# 서버 타임존이 KST(Asia/Seoul)인 경우
0 21 * * * cd /path/to/project && /usr/bin/deno run --allow-net --allow-env scripts/collect-investor-data.ts >> /var/log/investor-collector.log 2>&1

# 서버 타임존이 UTC인 경우 (21:00 KST = 12:00 UTC)
0 12 * * * cd /path/to/project && /usr/bin/deno run --allow-net --allow-env scripts/collect-investor-data.ts >> /var/log/investor-collector.log 2>&1
```

### AWS Lambda 사용 시

1. Deno Lambda Layer 추가
2. EventBridge 규칙으로 매일 21:00 KST 스케줄 설정
3. 환경변수에 `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` 설정
4. 최초 배포 시 `--mode=backfill`로 1회 수동 실행

### GitHub Actions 사용 시 (비권장 — IP 한국 아님)

GitHub Actions 기본 러너는 미국 IP를 사용하므로 KRX 접근이 차단됩니다.
한국 리전 self-hosted runner를 사용하는 경우에만 가능합니다.

## 수집 범위

| 시장         | 투자자 유형     |
| ------------ | --------------- |
| ALL (전체)   | 개인 (8000)     |
| STK (KOSPI)  | 외국인 (9000)   |
| KSQ (KOSDAQ) | 기관합계 (7050) |
|              | 연기금 (6000)   |
|              | 금융투자 (4000) |
|              | 보험 (2000)     |
|              | 은행 (1000)     |

총 3 × 7 = **21회 호출/날짜** (약 0.8초 간격 대기 포함)

## 실행 결과 요약

수집 완료 시 아래 summary가 출력됩니다:

```
[collector] ========== Summary ==========
  processed_dates : 250
  success_dates   : 248
  skipped_dates   : 2 (weekends/holidays)
  failed_dates    : 0
  total_rows      : 52080
```

## 모니터링

수집 결과는 `investor_sync_status` 테이블에 자동 기록됩니다:

```sql
SELECT *
FROM investor_sync_status
ORDER BY last_attempt_at DESC
LIMIT 20;
```

최신 데이터 적재 확인:

```sql
SELECT trade_date, market, investor_code, COUNT(*) AS row_count
FROM investor_snapshots
GROUP BY 1,2,3
ORDER BY trade_date DESC, market, investor_code
LIMIT 50;
```

데이터 범위 확인:

```sql
SELECT MIN(trade_date) AS min_date, MAX(trade_date) AS max_date, COUNT(DISTINCT trade_date) AS date_count
FROM investor_snapshots;
```

## 문제 해결

| 에러                     | 원인               | 해결                                             |
| ------------------------ | ------------------ | ------------------------------------------------ |
| `OTP_FAILED`             | KRX 세션 차단      | 한국 IP 여부 확인, 서버 리전 확인                |
| `EMPTY_DATA`             | 휴장일/집계 미완료 | 21:00 KST 이후 재시도, 자동 skip 처리됨          |
| `Supabase upsert failed` | 인증/권한 오류     | SUPABASE_SERVICE_KEY 값 및 권한 확인             |
| `SESSION_ERROR`          | KRX 일시 장애/차단 | 로그 확인 후 재시도                              |

## Manual CSV Upload (Node)

When Deno collection is unavailable, you can import investor rows directly from CSV.

### 1) Required environment variables (cmd)

```cmd
set SUPABASE_URL=https://your-project-id.supabase.co
set SUPABASE_SERVICE_KEY=your_service_role_key
```

### 2) Dry run first

```cmd
npm run import:investor -- --file .\data\investor.csv --dry-run
```

### 3) Import to database

```cmd
npm run import:investor -- --file .\data\investor.csv
```

### 4) Supported CSV schema

Required columns:
- trade_date, market, investor_code, stock_code, stock_name
- vol_sell, vol_buy, vol_net, val_sell, val_buy, val_net

Optional column:
- collected_at (ISO datetime)

Rules:
- trade_date: YYYYMMDD
- market: ALL / STK / KSQ / KNX
- investor_code: 4 digits
- stock_code: auto-normalized to 6 digits
- numeric columns: commas allowed in input, saved as integers

### 5) Validation SQL

```sql
SELECT MIN(trade_date), MAX(trade_date), COUNT(*) FROM investor_snapshots;
SELECT * FROM investor_sync_status WHERE sync_key = 'manual_import_csv';
```

# B2B 발주 / 거래명세서 관리

실제 회사 업무용 발주, 거래명세서, 매출, 마진, 정산 프로그램입니다.

현재는 **안전한 삭제**까지 완료된 상태입니다. 확정 Snapshot과 정산 이력을 깨는 물리 삭제는 차단하고, 참조가 없는 데이터만 Hard delete합니다.

## 기술 스택

- Frontend: Vue 3, Vite, Pinia, Vue Router
- Backend: Node.js, Express
- Database: PostgreSQL
- 금액 원칙: 모든 KRW 금액은 **정수 원(INTEGER)** 으로 저장합니다. float/double로 계산하지 않습니다.
- 시스템 시간(`created_at`, `updated_at`): `TIMESTAMPTZ`
- 업무 날짜(발주일, 거래일 등): 이후 단계에서 `DATE` (Asia/Seoul 달력일)

## 폴더 구조

```
b2b/
  frontend/          Vue 3 + Vite
  backend/           Express API
    src/
    migrations/
    tests/
  storage/
    masters/         거래명세서 MASTER (읽기 전용 자산. 프로그램이 수정하지 않음)
    uploads/orders/  업로드 원본 발주서
    generated/invoices/  생성 거래명세서
  docker-compose.yml PostgreSQL (로컬 개발용)
```

루트의 `날짜_거래처명_거래명세서.xlsx`는 레이아웃 원본입니다. 프로그램이 이 파일을 수정하지 않습니다. 클린 MASTER는 OpenXML에서 샘플 셀 값만 비워 `storage/masters/invoice_MASTER.xlsx`로 복사한 것이며, ExcelJS / SheetJS / openpyxl로 Workbook을 다시 저장하지 않았습니다.

## 필요 프로그램

- Node.js 20 이상 (개발 환경 확인값: 24)
- npm 11 이상
- Docker (로컬 PostgreSQL 실행용) 또는 별도 PostgreSQL 16

## PostgreSQL 준비

이 저장소는 실제 PostgreSQL만 사용합니다. SQLite나 메모리 DB는 사용하지 않습니다.

### Docker로 실행 (권장)

프로젝트 루트에서:

```bash
docker compose up -d
```

기본 접속 정보:

- Host: `localhost`
- Port: `5432`
- Database: `b2b`
- User: `b2b`
- Password: `b2b`

이미 5432 포트를 다른 PostgreSQL이 사용 중이면 `docker-compose.yml`의 포트와 `.env`의 `DB_PORT`를 함께 바꿉니다.

### 기존 PostgreSQL을 쓰는 경우

```sql
CREATE DATABASE b2b;
CREATE USER b2b WITH PASSWORD 'your-password';
GRANT ALL PRIVILEGES ON DATABASE b2b TO b2b;
```

PostgreSQL 15 이상이라면 해당 데이터베이스에 접속한 뒤 스키마 권한도 부여합니다.

```sql
GRANT ALL ON SCHEMA public TO b2b;
```

## 환경변수

실제 비밀번호가 들어간 `.env`는 Git에 포함하지 않습니다.

1. `backend/.env.example`을 `backend/.env`로 복사합니다.
2. `frontend/.env.example`을 `frontend/.env`로 복사합니다.
3. DB 비밀번호와 CORS origin을 환경에 맞게 수정합니다.

주요 변수:

| 변수 | 위치 | 설명 |
| --- | --- | --- |
| `NODE_ENV` | backend | `development` / `production` |
| `PORT` | backend | API 포트. 기본 3000 |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | backend | PostgreSQL 접속 |
| `DATABASE_URL` | backend | 설정 시 위의 DB_* 대신 사용. 파싱 위치는 `backend/src/config/env.js` 하나 |
| `CORS_ORIGIN` | backend | 허용 Origin. 여러 개는 쉼표로 구분. 운영에서 `*` 금지 |
| `STORAGE_ROOT` | backend | 기본 `../storage` |
| `UPLOAD_MAX_BYTES` | backend | 발주서 업로드 상한. 기본 20MB |
| `VITE_API_BASE_URL` | frontend | 예: `http://localhost:3000/api` |

운영(`NODE_ENV=production`)에서 `CORS_ORIGIN`이 없거나 `*`이면 서버가 시작되지 않습니다.

## Migration

DB 스키마는 수동 생성이 아니라 migration으로 관리합니다.

```bash
npm run db:migrate
```

또는

```bash
npm run db:migrate --prefix backend
```

적용 이력은 `schema_migrations` 테이블에 이름과 `applied_at`으로 기록됩니다. 같은 migration을 다시 실행해도 중복 적용되지 않습니다.

현재 적용되는 migration:

- `001_app_metadata.sql` — 동작 확인용 `app_metadata`
- `002_suppliers_products.sql` — `suppliers`, `products`, `product_cost_history`
- `003_sales_clients_prices.sql` — `sales_clients`, `client_product_prices` (`btree_gist` 필요)
- `004_order_imports_mappings_aliases.sql` — `excel_mappings`, `product_aliases`, `order_imports`, `order_import_rows`
- `005_orders_calculations.sql` — `orders`, `order_items`, `order_shipping_groups`
- `006_generated_invoices.sql` — `generated_documents`, `orders.invoice_note`
- `007_order_client_name_snapshot.sql` — `orders.client_name_snapshot` 및 기존 CONFIRMED backfill
- `008_settlements.sql` — `settlements`, `payment_transactions` 및 기존 CONFIRMED 정산 backfill
- `009_safe_deletes.sql` — `audit_logs`, `storage_orphan_files`, `generated_documents.is_hidden`

기존에 적용된 migration 파일은 수정하지 않습니다.

`003`은 가격 기간 겹침 방지에 PostgreSQL `btree_gist` extension을 사용합니다. 운영 DB에서 해당 extension을 허용해야 합니다.

## 실행 방법

루트에서 의존성 설치:

```bash
npm install
npm install --prefix backend
npm install --prefix frontend
```

개발 실행 (frontend + backend):

```bash
npm run dev
```

개별 실행:

```bash
npm run dev:backend
npm run dev:frontend
```

Backend만 운영 모드로 실행:

```bash
npm run start --prefix backend
```

Frontend production build:

```bash
npm run build
```

접속:

- Frontend: http://localhost:5173
- 매입처 관리: http://localhost:5173/suppliers
- 상품 관리: http://localhost:5173/products
- 매출처 관리: http://localhost:5173/sales-clients
- 제안가 관리: http://localhost:5173/sales-clients/:id/prices
- 발주서 업로드: http://localhost:5173/order-imports/new
- 업로드 내역: http://localhost:5173/order-imports
- 발주 Preview: http://localhost:5173/orders/:id/preview
- 거래내역: http://localhost:5173/orders
- 거래 상세: http://localhost:5173/orders/:id
- 정산관리: http://localhost:5173/settlements
- 미수금: http://localhost:5173/receivables
- System Status: http://localhost:5173/system
- Health API: http://localhost:3000/api/health

## 테스트

```bash
npm test
```

Backend health, migration 멱등성, 매입처/상품/매출처/제안가/발주서 업로드/발주 계산·확정/거래명세서/정산·입금 API를 확인합니다. PostgreSQL이 실행 중이어야 합니다.

## 기준정보 API 개요

매입처:

- `GET /api/suppliers` — 목록. `search`, `is_active`
- `GET /api/suppliers/:id` — 상세
- `POST /api/suppliers` — 등록
- `PATCH /api/suppliers/:id` — 수정
- `PATCH /api/suppliers/:id/status` — 활성/비활성

상품:

- `GET /api/products` — 목록. `search`, `supplier_id`, `is_active`, `page`, `limit`(최대 200). 각 상품은 `options[]`를 포함합니다.
- `GET /api/products/:id` — 상세(본체 + 옵션)
- `POST /api/products` — 등록. 본체(`product_name`, `supplier_id`, `memo`)와 옵션 배열. `options`가 없으면 기존 flat 필드(원가/카톤/택배비 등)를 옵션 1개로 받습니다. 옵션의 `product_code`는 선택이며 빈 값은 NULL, 값이 있을 때만 unique입니다. 제안가/Alias/발주 매칭은 `product_options.id` 기준입니다.
- `PATCH /api/products/:id` — 본체 수정. `options` 배열이 있으면 옵션 추가/수정. 옵션이 1개인 상품은 flat 원가 변경도 허용합니다. 원가가 바뀌면 `product_cost_history`에 한 건 기록
- `POST /api/products/:id/options` — 옵션 추가
- `PATCH /api/products/:id/options/:optionId` — 옵션 수정
- `PATCH /api/products/:id/options/:optionId/status` — 옵션 활성/비활성
- `DELETE /api/products/:id/options/:optionId` — 옵션 삭제. 마지막 옵션은 삭제할 수 없습니다.
- `PATCH /api/products/:id/status` — 상품 본체 활성/비활성
- `GET /api/products/:id/cost-history` — 해당 상품의 옵션 원가 변경이력

삭제 API는 없습니다. 로그인/권한 기능은 없습니다.

매출처:

- `GET /api/sales-clients` — 목록. `search`, `is_active`
- `GET /api/sales-clients/:id` — 상세 + 제안가 등록/미등록 요약
- `POST /api/sales-clients` — 등록
- `PATCH /api/sales-clients/:id` — 수정
- `PATCH /api/sales-clients/:id/status` — 활성/비활성
- `GET /api/sales-clients/:id/products` — 전체 상품 + 지정일 제안가/예상마진. `date`, `include_inactive`
- `GET /api/sales-clients/:id/prices` — 가격 이력
- `GET /api/sales-clients/:id/prices/current` — 오늘(Asia/Seoul) 적용가
- `GET /api/sales-clients/:id/prices/effective?date=YYYY-MM-DD` — 지정일 적용가
- `POST /api/sales-clients/:id/prices` — 제안가 등록/변경(기존 기간 종료 + 신규 row)
- `PUT /api/sales-clients/:id/prices/bulk` — 변경분 일괄 저장. 한 트랜잭션

발주 확정 시 Frontend에 보이는 제안가를 그대로 쓰지 않습니다. Backend가 매출처 + 상품 + 발주일(`DATE`)로 `client_product_prices`를 다시 조회합니다.

## 발주서 업로드 API 개요

지원 형식: `.xls`, `.xlsx`. SheetJS는 발주서 읽기 전용입니다. 원본 바이트는 `storage/uploads/orders/`에 UUID 파일명으로 그대로 보관하며, workbook을 다시 저장하지 않습니다.

같은 매출처 + 같은 파일 hash는 경고만 하고 자동 차단하지 않습니다. 사용자가 중복을 확인하면 계속 진행할 수 있습니다.

워크플로: 매출처/발주일 선택 → 업로드 → Sheet/Header 확인 → 컬럼 Mapping → Parsing → Alias/수동 매칭 → Preview. 이번 단계에서는 제안가/카톤/택배비/마진을 조회하거나 계산하지 않습니다.

- `POST /api/order-imports/upload` — `client_id`, `order_date`, 파일
- `GET /api/order-imports` — 목록. `client_id`, `status`
- `GET /api/order-imports/:id` — 상태/요약
- `GET /api/order-imports/:id/raw-preview` — Sheet 원본 미리보기
- `PATCH /api/order-imports/:id/config` — sheet, header, mapping
- `POST /api/order-imports/:id/parse` — Mapping 기준 Parsing (한 트랜잭션)
- `GET /api/order-imports/:id/rows` — Parsed rows
- `PATCH /api/order-imports/:id/rows/:rowId/match` — 수동 상품 연결. 기본 Alias 저장
- `PATCH /api/order-imports/:id/rows/:rowId/quantity` — 수량 수동입력. `{ "quantity": 200 }` 또는 `{ "reset": true }`. 1 이상 정수만 허용. CONFIRMED면 `ORDER_IMPORT_CONFIRMED`
- `POST /api/order-imports/:id/acknowledge-duplicate` — hash 중복 확인
- `GET/PUT /api/sales-clients/:id/excel-mapping` — 매출처별 Excel Mapping
- `GET/POST /api/sales-clients/:id/aliases` — 상품 Alias
- `PATCH/DELETE /api/sales-clients/:id/aliases/:aliasId` — Alias 수정/삭제. 과거 import row는 변경하지 않음

자동매칭은 저장된 Alias → 내부 옵션 `product_code` 정확 일치(값이 있을 때만) → 상품명+옵션 exact match 순입니다. 최종 매칭 대상은 `product_option_id`입니다. Alias의 `external_product_code`는 선택적 보조 조건입니다. 유사도/부분문자열 자동매칭은 사용하지 않습니다. 내부 상품코드가 없어도 READY/CONFIRMED와 거래명세서 생성은 가능합니다.

발주 수량은 `parsed_quantity`(엑셀 파싱)와 `manual_quantity`(Preview 수동입력)를 구분합니다. 업무수량(`quantity`)은 `manual_quantity`가 있으면 그 값, 없으면 `parsed_quantity`입니다. READY·카톤·매출·원가·마진은 이 최종 수량을 씁니다. 재분석 시 같은 행(시트/행번호/외부상품)이면 수동수량을 유지하고, 행 구조가 바뀌면 붙이지 않습니다.

## 발주 계산 / 확정

READY 발주서에서 DRAFT `orders`를 만들고, Preview는 매번 Backend가 `client_id + product_option_id + order_date`로 제안가를 다시 조회합니다. 원가/카톤/택배비도 옵션 기준입니다. Frontend 표시 가격은 확정에 쓰지 않습니다.

Confirm은 한 트랜잭션에서 재계산 후 `order_items` / `order_shipping_groups` Snapshot을 저장하고 `CONFIRMED`로 바꿉니다. 확정 이후 원가·제안가 변경은 과거 거래에 반영되지 않습니다. 확정된 import는 재Parsing/매칭 변경이 차단됩니다.

카톤수는 `ceil(quantity / cartonQty)`와 같되 `Math.floor` + 나머지만 사용합니다. `TOTAL_QUANTITY`는 상품별 총수량 합산 후 카톤, `PER_ORDER`는 주문번호×상품, `PER_ADDRESS`는 주소×상품입니다. 다른 상품끼리는 카톤을 합치지 않습니다.

PARCEL 배송비 단가: `shipping_fee_override`가 NULL이면 상품 기본값, 0이면 0원. FREE/COLLECT는 카톤만 계산하고 청구 배송비 0. TRUCK/MANUAL은 `manual_shipping_charge`(NULL 불가, 0은 가능).

상품마진 = 상품매출 − 상품원가. 청구 배송비는 마진에 더하지 않습니다. 실제 순마진은 표시하지 않습니다.

거래명세서 예상 행 = 상품행(`product_id`+판매가) + 배송비행(택배비 단가별 묶음, 0원 행 생략). 행 수 제한은 없습니다. 7행을 넘으면 MASTER 품목행을 복제해 같은 시트에서 아래로 확장하고, 합계/특이사항/Print Area를 함께 내립니다. Confirm은 가격·상품·수량·배송 오류만 막습니다.

- `POST /api/order-imports/:id/order` — READY Import에서 DRAFT 생성 또는 기존 order 반환
- `GET /api/orders/:id/preview` — DRAFT는 현재 DB 기준 재계산, CONFIRMED는 Snapshot
- `PATCH /api/orders/:id/settings` — DRAFT만 배송방식/계산방식/수동배송비 변경 후 재계산
- `POST /api/orders/:id/confirm` — Backend 재계산 후 Snapshot 확정. `preview_signature`가 달라지면 409. 매출처명은 `client_name_snapshot`에 저장하고 초기 정산(`UNPAID`)을 만듭니다.

## 거래명세서 MASTER

`storage/masters/invoice_MASTER.xlsx`는 읽기 전용입니다. 프로그램 시작 시 checksum을 확인하고, 없거나 다르면 경고만 합니다. 자동 수정하지 않습니다.

허용 Cell 주소는 `backend/src/domain/invoice-template-map.js`에만 둡니다. 생성 흐름은 MASTER raw bytes 복사 → output만 patch → output 저장이며, MASTER 경로에는 쓰지 않습니다.

Sheet 이름 `2021-12-28`, 공급자 영역, 도장(`xl/media/image1.jpeg` / drawing 관계), styles/theme, 기본 A4 portrait는 유지합니다. 출력 파일이 품목행을 늘릴 때는 행 복제, 병합/수식 추가, 합계·특이사항 이동, Print Area 확장, 세로 여러 페이지(`fitToWidth=1`, `fitToHeight=0`)만 허용합니다. MASTER 원본은 자동 수정하지 않습니다.

클린본 재생성(개발용): `npm run invoice:master:build --prefix backend` — 이미 MASTER가 있으면 거부합니다.

CONFIRMED 거래만 생성할 수 있습니다. 생성 직전 MASTER checksum과 Snapshot Projection을 다시 검사합니다. 현재 상품/제안가는 다시 조회하지 않습니다. 상품 행이 많아도 파일을 쪼개지 않고 한 시트에서 확장합니다.

- `POST /api/orders/:id/invoices` — 거래명세서 생성 (v1, v2, …)
- `GET /api/orders/:id/invoices` — 생성 이력 / Projection
- `GET /api/orders/:id/invoices/:documentId/download` — 다운로드. 실제 저장 경로는 노출하지 않습니다.

거래명세서 매출처명은 생성 시점의 `sales_clients.client_name`이 아니라 확정 시 저장한 `client_name_snapshot`만 사용합니다. 새 버전을 만들어도 기존 버전은 `GENERATED`로 남기고 `SUPERSEDED`로 바꾸지 않습니다. `INVALID`는 검증 실패로 격리된 파일에만 해당하며 DB row를 만들지 않습니다.

## 거래내역 / 정산 / 대시보드

CONFIRMED 거래만 조회합니다. 목록·상세·정산·KPI는 Snapshot 금액과 매출처명을 사용합니다.

정산 상태: `UNPAID` / `PARTIAL` / `PAID`. 청구액은 `orders.total_invoice_amount` Snapshot, 미수금은 `billing_amount - paid_amount`입니다. 입금기록은 `payment_transactions`에 두고, insert/update/delete 후 Backend가 트랜잭션으로 다시 계산합니다. Frontend 계산값은 저장하지 않습니다. 과입금은 `OVERPAYMENT`로 차단합니다.

세금계산서는 전자세금계산서 API 없이 수동 상태만 관리합니다. `NOT_ISSUED` / `ISSUED` + `tax_invoice_issued_at`.

- `GET /api/orders` — 거래내역. `from`, `to`, `client_id`, `product_id`, `order_number`, `settlement_status`, `sort=date_desc|expected_asc`, `page`, `limit`
- `GET /api/orders/:id` — 거래 상세. Snapshot 상품/배송, 명세서 버전, 정산, 입금이력
- `PATCH /api/orders/:id/settlement` — 입금예정일, 세금계산서 상태, 메모
- `POST /api/orders/:id/payments` — 입금 등록
- `PATCH /api/orders/:id/payments/:paymentId` — 입금 수정
- `DELETE /api/orders/:id/payments/:paymentId` — 입금 삭제
- `GET /api/dashboard` — 오늘/이번달 매출, 이번달 상품마진, 미수금 총액, 미정산 건수, 최근 거래 10건, 미수금 상위 거래. 날짜는 Asia/Seoul `todayKst()`

## 안전한 삭제

과거 거래/정산/Snapshot을 깨는 물리 DELETE는 금지합니다. `ON DELETE CASCADE`를 업무 이력 테이블에 추가하지 않습니다. Backend가 참조를 최종 검증하며, Frontend 버튼 숨김만으로 보호하지 않습니다.

Hard delete가 가능한 경우: 참조가 없는 매입처/상품/매출처, 확정 거래에 쓰이지 않은 제안가, Alias, Excel Mapping, 미확정 Import, DRAFT 거래, 잘못된 입금기록.

삭제 불가: 참조가 있는 기준정보, CONFIRMED/CANCELLED 거래와 그 settlement, 정상 거래명세서 DB 기록. CONFIRMED는 `[거래 취소]`만 가능하며 Snapshot/명세서/정산은 유지합니다.

Import 파일은 DB COMMIT 이후에만 삭제합니다. 파일 삭제 실패 시 `storage_orphan_files`에 남깁니다. 범용 TRUNCATE/전체 DELETE API는 없습니다. 테스트 prefix의 미참조 데이터만 `POST /api/maintenance/purge-unused-test-data`로 개별 삭제할 수 있습니다.

- `GET /api/:entity/:id/delete-impact` — 삭제 가능 여부와 참조 건수
- `DELETE /api/suppliers/:id` / `DELETE /api/products/:id` / `DELETE /api/sales-clients/:id`
- `DELETE /api/sales-clients/:id/prices/:priceId` — `PRICE_IN_USE`면 차단
- `DELETE /api/sales-clients/:id/aliases/:aliasId` — 과거 매칭/Snapshot 불변
- `DELETE /api/sales-clients/:id/excel-mapping`
- `DELETE /api/order-imports/:id` — CONFIRMED면 `ORDER_IMPORT_CONFIRMED`. DRAFT가 있으면 `delete_draft=true`
- `DELETE /api/orders/:id` — DRAFT만. 기본은 import 유지(`keep_import=false`면 import도 삭제)
- `POST /api/orders/:id/cancel` — CONFIRMED → CANCELLED
- 삭제는 `audit_logs`에 `DELETE` / `DEACTIVATE` / `REACTIVATE` / `CANCEL`로 기록합니다.

## 현재 구현된 것

- Vue 3 / Vite frontend
- Express backend
- PostgreSQL connection pool
- migration 러너
- `GET /api/health`
- System Status 화면
- 매입처 관리
- 상품 관리
- 상품 원가 변경이력
- 매출처 관리
- 매출처별 제안가 / 가격 이력
- 제안가 일괄 입력
- 제안가 기준 예상마진
- `.xls` / `.xlsx` 발주서 업로드
- Excel Mapping / Product Alias
- 발주서 Parsing Preview (상품 식별)
- 발주 DRAFT Preview / 카톤·배송비·상품마진 계산
- 발주 CONFIRMED Snapshot
- 거래명세서 클린 MASTER / OpenXML 무결성 검사
- CONFIRMED Snapshot 거래명세서 생성 / 버전 / 다운로드
- 거래내역 / 거래 상세
- 정산관리 / 입금기록 / 미수금 / 세금계산서 수동 상태
- Dashboard KPI
- 안전한 삭제 / 거래 취소 / delete-impact / audit log
- storage 디렉터리 자동 생성 (개발 환경에서 없을 때)
- 공통 API 에러 형식

## 아직 구현하지 않은 것

- 로그인 / 권한
- 거래명세서 메모(`invoice_note`) 편집 UI
- 전자세금계산서 API 연동
- 출고·배송완료·반품 상태

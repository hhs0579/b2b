import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrations.js";
import { env } from "../src/config/env.js";
import { resolveStoredFilePath } from "../src/utils/order-files.js";
import { xlsxBuffer, xlsxBufferAdvanced } from "./helpers/xlsx-fixture.js";
import { deleteProductsByIds, mapCreatedProduct } from "./helpers/product.js";

const prefix = `MH${Date.now()}`;
const created = {
  importIds: [],
  clientIds: [],
  productIds: [],
  supplierIds: [],
  storedFiles: [],
};

function findRealPoPath() {
  const dir = path.resolve(env.backendRoot, "..");
  const name = fs.readdirSync(dir).find((file) => file.includes("260903") && file.toLowerCase().endsWith(".xlsx"));
  assert.ok(name, "실파일 (주)에쎄르 발주서 260903.xlsx 가 필요합니다.");
  return path.join(dir, name);
}

async function startServer() {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  return { server, port: server.address().port };
}

async function api(port, method, pathname, body) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

async function upload(port, fields, buffer, filename) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) {
      form.append(key, String(value));
    }
  }
  form.append("file", new File([buffer], filename));
  const response = await fetch(`http://127.0.0.1:${port}/api/order-imports/upload`, {
    method: "POST",
    body: form,
  });
  const json = await response.json();
  if (json?.data?.id) created.importIds.push(json.data.id);
  if (json?.data?.stored_file_name) created.storedFiles.push(json.data.stored_file_name);
  return { status: response.status, json };
}

test("multi-header excel mapping import", async (t) => {
  await runMigrations();
  const { server, port } = await startServer();
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  );

  let client;
  let chocolate;
  let chestnut;
  let barcodeOnly;

  await t.test("seed", async () => {
    const supplierRes = await api(port, "POST", "/api/suppliers", {
      supplier_code: `${prefix}-SUP`,
      supplier_name: "다중헤더매입처",
    });
    assert.equal(supplierRes.status, 201);
    created.supplierIds.push(supplierRes.json.data.id);

    const p1 = await api(port, "POST", "/api/products", {
      product_code: "8809424490334",
      product_name: "[티알에스큐] 두바이 스타일 쫀득 초콜릿 45g",
      purchase_price: 1000,
      vat_type: "INCLUDED",
      carton_qty: 60,
      default_shipping_fee: 0,
      default_shipping_type: "PARCEL",
      supplier_id: supplierRes.json.data.id,
    });
    const p2 = await api(port, "POST", "/api/products", {
      product_code: "8809424490433",
      product_name: "[더 레어] 영양 맛밤 50g",
      purchase_price: 1000,
      vat_type: "INCLUDED",
      carton_qty: 50,
      default_shipping_fee: 0,
      default_shipping_type: "PARCEL",
      supplier_id: supplierRes.json.data.id,
    });
    const p3 = await api(port, "POST", "/api/products", {
      product_code: `${prefix}-BAR`,
      barcode: "8800000000999",
      product_name: "바코드전용상품",
      purchase_price: 1000,
      vat_type: "INCLUDED",
      carton_qty: 1,
      default_shipping_fee: 0,
      default_shipping_type: "PARCEL",
      supplier_id: supplierRes.json.data.id,
    });
    assert.equal(p1.status, 201, JSON.stringify(p1.json));
    chocolate = mapCreatedProduct(p1.json.data);
    chestnut = mapCreatedProduct(p2.json.data);
    barcodeOnly = mapCreatedProduct(p3.json.data);
    created.productIds.push(chocolate.id, chestnut.id, barcodeOnly.id);

    const clientRes = await api(port, "POST", "/api/sales-clients", {
      client_code: `${prefix}-CL`,
      client_name: "다중헤더매출처",
    });
    assert.equal(clientRes.status, 201);
    client = clientRes.json.data;
    created.clientIds.push(client.id);
  });

  await t.test("real 260903 file auto-detects 2-row header and parses two products", async () => {
    const buffer = fs.readFileSync(findRealPoPath());
    const up = await upload(port, { client_id: client.id, order_date: "2026-09-03" }, buffer, "esser-260903.xlsx");
    assert.equal(up.status, 201, JSON.stringify(up.json));
    assert.equal(up.json.data.header_start_row, 1);
    assert.equal(up.json.data.header_end_row, 2);
    assert.equal(up.json.data.data_start_row, 3);
    assert.equal(up.json.data.suggested_header_range.headerEndRow, 2);

    const g = up.json.data.header_columns.find((col) => col.excel_col === "G");
    const f = up.json.data.header_columns.find((col) => col.excel_col === "F");
    assert.equal(g.display_name, "발주 / 발주수량");
    assert.equal(g.normalized_name, "발주 / 발주수량");
    assert.equal(g.composite_header, "발주 / 발주수량");
    assert.equal(f.composite_header, "발주 / 발주box");
    assert.equal(up.json.data.column_map.quantity.column_letter, "G");

    const mappedWrong = await api(port, "PATCH", `/api/order-imports/${up.json.data.id}/config`, {
      sheet_name: "발주서",
      header_start_row: 1,
      header_end_row: 2,
      data_start_row: 3,
      column_map: {
        external_product_code: "상품코드",
        external_product_name: "상품명",
        quantity: {
          column_index: 5,
          column_letter: "F",
          composite_header: "발주 / 발주box",
          normalized_header: "발주",
        },
        address: "입고지",
        shipping_memo: "비고",
      },
    });
    assert.equal(mappedWrong.status, 200, JSON.stringify(mappedWrong.json));
    assert.equal(mappedWrong.json.data.column_map.quantity.column_letter, "F");

    const configured = await api(port, "PATCH", `/api/order-imports/${up.json.data.id}/config`, {
      sheet_name: "발주서",
      header_start_row: 1,
      header_end_row: 2,
      data_start_row: 3,
      column_map: {
        external_product_code: "상품코드",
        external_product_name: "상품명",
        quantity: {
          column_index: 6,
          column_letter: "G",
          composite_header: "발주 / 발주수량",
          normalized_header: "발주",
        },
        address: "입고지",
        shipping_memo: "비고",
      },
    });
    assert.equal(configured.status, 200, JSON.stringify(configured.json));
    assert.equal(configured.json.data.column_map.quantity.column_letter, "G");
    assert.equal(configured.json.data.column_map.quantity.column_index, 6);
    assert.equal(configured.json.data.column_map.quantity.composite_header, "발주 / 발주수량");
    assert.equal(configured.json.data.mapping_ok, true);
    const headerF = configured.json.data.header_columns.find((col) => col.excel_col === "F");
    const headerG = configured.json.data.header_columns.find((col) => col.excel_col === "G");
    assert.equal(headerF.mapped_field, null);
    assert.equal(headerG.mapped_field, "quantity");

    const reloaded = await api(port, "GET", `/api/order-imports/${up.json.data.id}`);
    assert.equal(reloaded.status, 200, JSON.stringify(reloaded.json));
    assert.equal(reloaded.json.data.column_map.quantity.column_letter, "G");
    assert.equal(reloaded.json.data.column_map.quantity.composite_header, "발주 / 발주수량");
    assert.equal(reloaded.json.data.header_columns.find((col) => col.excel_col === "F").mapped_field, null);
    assert.equal(reloaded.json.data.header_columns.find((col) => col.excel_col === "G").mapped_field, "quantity");

    const parsed = await api(port, "POST", `/api/order-imports/${up.json.data.id}/parse`);
    assert.equal(parsed.status, 200, JSON.stringify(parsed.json));
    assert.equal(parsed.json.data.parsed_row_count, 2);
    const [row1, row2] = parsed.json.data.items;
    assert.equal(row1.source_row_number, 3);
    assert.equal(row1.external_product_code, "8809424490334");
    assert.equal(row1.external_product_name, "[티알에스큐] 두바이 스타일 쫀득 초콜릿 45g");
    assert.equal(row1.quantity, 8640);
    assert.equal(row1.match_status, "MATCHED_PRODUCT_CODE");
    assert.equal(row2.source_row_number, 4);
    assert.equal(row2.external_product_code, "8809424490433");
    assert.equal(row2.external_product_name, "[더 레어] 영양 맛밤 50g");
    assert.equal(row2.quantity, 12000);
    assert.equal(row2.match_status, "MATCHED_PRODUCT_CODE");
    assert.ok(parsed.json.data.items.every((row) => row.source_row_number !== 5));
    assert.equal(parsed.json.data.status, "READY");

    const mapping = await api(port, "GET", `/api/sales-clients/${client.id}/excel-mapping`);
    assert.equal(mapping.json.data.mapping.header_start_row, 1);
    assert.equal(mapping.json.data.mapping.header_end_row, 2);
    assert.equal(mapping.json.data.mapping.column_map.quantity.column_letter, "G");
    assert.equal(mapping.json.data.mapping.column_map.quantity.composite_header, "발주 / 발주수량");
  });

  await t.test("dated header from a later PO still matches saved mapping", async () => {
    const buffer = xlsxBufferAdvanced({
      sheetName: "발주서",
      rows: [
        ["상품코드", "상품명", "입수", "발주(260910)", null, "입고지", "비고"],
        [null, null, null, "발주box", "발주수량", null, null],
        ["8809424490334", "[티알에스큐] 두바이 스타일 쫀득 초콜릿 45g", "60", 10, 600, "창고", ""],
      ],
      merges: [
        { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
        { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } },
        { s: { r: 0, c: 2 }, e: { r: 1, c: 2 } },
        { s: { r: 0, c: 3 }, e: { r: 0, c: 4 } },
        { s: { r: 0, c: 5 }, e: { r: 1, c: 5 } },
        { s: { r: 0, c: 6 }, e: { r: 1, c: 6 } },
      ],
    });
    const up = await upload(port, { client_id: client.id, order_date: "2026-09-10" }, buffer, "esser-260910.xlsx");
    assert.equal(up.status, 201, JSON.stringify(up.json));
    assert.equal(up.json.data.mapping_ok, true);
    assert.equal(up.json.data.column_map.quantity.column_letter, "E");
    assert.equal(up.json.data.column_map.quantity.composite_header, "발주 / 발주수량");
    const parsed = await api(port, "POST", `/api/order-imports/${up.json.data.id}/parse`);
    assert.equal(parsed.status, 200, JSON.stringify(parsed.json));
    assert.equal(parsed.json.data.parsed_row_count, 1);
    assert.equal(parsed.json.data.items[0].quantity, 600);
  });

  await t.test("quantity fallback multiplies 입수 x 발주box", async () => {
    const sheetRows = [
      ["상품코드", "상품명", "입수", "발주(260903)", null],
      [null, null, null, "발주box", "발주수량"],
      ["8809424490334", "[티알에스큐] 두바이 스타일 쫀득 초콜릿 45g", "60", 144, null],
    ];
    const buffer = xlsxBufferAdvanced({
      sheetName: "발주서",
      rows: sheetRows,
      merges: [{ s: { r: 0, c: 3 }, e: { r: 0, c: 4 } }],
    });
    const up = await upload(port, { client_id: client.id, order_date: "2026-09-11" }, buffer, "fallback.xlsx");
    await api(port, "PATCH", `/api/order-imports/${up.json.data.id}/config`, {
      sheet_name: "발주서",
      header_start_row: 1,
      header_end_row: 2,
      data_start_row: 3,
      column_map: {
        external_product_code: "상품코드",
        external_product_name: "상품명",
        quantity: "발주 / 발주수량",
      },
      save_mapping: false,
    });
    const parsed = await api(port, "POST", `/api/order-imports/${up.json.data.id}/parse`);
    assert.equal(parsed.status, 200, JSON.stringify(parsed.json));
    assert.equal(parsed.json.data.items[0].quantity, 8640);
  });

  await t.test("barcode exact match and unmatched remains manually matchable", async () => {
    const buffer = xlsxBuffer([
      ["상품코드", "상품명", "수량"],
      ["8800000000999", "다른이름", 3],
      ["9999999999999", "없는상품", 1],
    ]);
    const up = await upload(port, { client_id: client.id, order_date: "2026-09-12" }, buffer, "barcode.xlsx");
    await api(port, "PATCH", `/api/order-imports/${up.json.data.id}/config`, {
      header_row_number: 1,
      column_map: {
        external_product_code: "상품코드",
        external_product_name: "상품명",
        quantity: "수량",
      },
      save_mapping: false,
    });
    const parsed = await api(port, "POST", `/api/order-imports/${up.json.data.id}/parse`);
    assert.equal(parsed.status, 200, JSON.stringify(parsed.json));
    assert.equal(parsed.json.data.items[0].match_status, "MATCHED_BARCODE");
    assert.equal(parsed.json.data.items[1].match_status, "UNMATCHED");
    const matched = await api(port, "PATCH", `/api/order-imports/${up.json.data.id}/rows/${parsed.json.data.items[1].id}/match`, {
      product_option_id: chocolate.product_option_id,
      save_alias: false,
    });
    assert.equal(matched.status, 200, JSON.stringify(matched.json));
    assert.equal(matched.json.data.row.match_status, "MANUAL");
  });

  await t.test("single-header xlsx still works after multi-header support", async () => {
    const buffer = xlsxBuffer([
      ["상품명", "수량"],
      ["[티알에스큐] 두바이 스타일 쫀득 초콜릿 45g", 7],
    ]);
    const up = await upload(port, { client_id: client.id, order_date: "2026-09-13" }, buffer, "single.xlsx");
    await api(port, "PATCH", `/api/order-imports/${up.json.data.id}/config`, {
      header_row_number: 1,
      column_map: { external_product_name: "상품명", quantity: "수량" },
      save_mapping: false,
    });
    const parsed = await api(port, "POST", `/api/order-imports/${up.json.data.id}/parse`);
    assert.equal(parsed.status, 200, JSON.stringify(parsed.json));
    assert.equal(parsed.json.data.parsed_row_count, 1);
    assert.equal(parsed.json.data.items[0].quantity, 7);
    assert.equal(parsed.json.data.items[0].external_product_name, "[티알에스큐] 두바이 스타일 쫀득 초콜릿 45g");
    assert.equal(parsed.json.data.items[0].match_status, "MATCHED_EXACT");
  });
});

after(async () => {
  if (created.importIds.length) {
    await pool.query(`DELETE FROM order_import_rows WHERE order_import_id = ANY($1::bigint[])`, [created.importIds]);
    await pool.query(`DELETE FROM order_imports WHERE id = ANY($1::bigint[])`, [created.importIds]);
  }
  if (created.clientIds.length) {
    await pool.query(`DELETE FROM excel_mappings WHERE client_id = ANY($1::bigint[])`, [created.clientIds]);
    await pool.query(`DELETE FROM product_aliases WHERE client_id = ANY($1::bigint[])`, [created.clientIds]);
    await pool.query(`DELETE FROM sales_clients WHERE id = ANY($1::bigint[])`, [created.clientIds]);
  }
  await deleteProductsByIds(pool, created.productIds);
  if (created.supplierIds.length) {
    await pool.query(`DELETE FROM suppliers WHERE id = ANY($1::bigint[])`, [created.supplierIds]);
  }
  for (const name of created.storedFiles) {
    const stored = resolveStoredFilePath(name);
    if (fs.existsSync(stored)) fs.unlinkSync(stored);
  }
  await pool.end();
});

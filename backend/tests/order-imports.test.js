import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { env } from "../src/config/env.js";
import { runMigrations } from "../src/db/migrations.js";
import { sha256, resolveStoredFilePath } from "../src/utils/order-files.js";
import { xlsxBuffer, xlsxBufferWithTextCells } from "./helpers/xlsx-fixture.js";
import { deleteProductsByIds, mapCreatedProduct } from "./helpers/product.js";

const prefix = `P4${Date.now()}`;
const realXlsPath = path.resolve(env.backendRoot, "..", "발주서 에쎄르 (36).xls");
const storedFiles = [];
const created = {
  importIds: [],
  clientIds: [],
  productIds: [],
  supplierIds: [],
};

async function startServer() {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  return { server, port: server.address().port };
}

async function api(port, method, path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
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
  if (json?.data?.id) {
    created.importIds.push(json.data.id);
  }
  if (json?.data?.stored_file_name) {
    storedFiles.push(json.data.stored_file_name);
  }
  return { status: response.status, json };
}

function esserMapping() {
  return {
    external_product_name: "상품명",
    external_option_name: "옵션",
    quantity: "수량",
    external_order_number: "주문번호",
    recipient_name: "수령자이름",
    phone: "수령자휴대폰",
    address: "주소",
    shipping_memo: "배송메세지",
  };
}

test("phase 4 order imports mappings aliases", async (t) => {
  await runMigrations();
  const { server, port } = await startServer();
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  );

  let client;
  let inactiveClient;
  let supplier;
  let product;
  let product2;
  let product3;
  let realImport;
  let xlsxImport;
  let zeroImport;

  await t.test("seed client supplier products", async () => {
    const supplierRes = await api(port, "POST", "/api/suppliers", {
      supplier_code: `${prefix}-SUP001`,
      supplier_name: "테스트매입처",
    });
    assert.equal(supplierRes.status, 201);
    supplier = supplierRes.json.data;
    created.supplierIds.push(supplier.id);

    const p1 = await api(port, "POST", "/api/products", {
      product_code: `${prefix}-TEST001`,
      product_name: "테스트 상품",
      option_name: "아이보리",
      purchase_price: 2500,
      vat_type: "INCLUDED",
      carton_qty: 6,
      default_shipping_fee: 5000,
      default_shipping_type: "PARCEL",
      supplier_id: supplier.id,
    });
    const p2 = await api(port, "POST", "/api/products", {
      product_code: `${prefix}-TEST002`,
      product_name: "두번째 상품",
      purchase_price: 1000,
      vat_type: "INCLUDED",
      carton_qty: 1,
      default_shipping_fee: 0,
      default_shipping_type: "PARCEL",
      supplier_id: supplier.id,
    });
    const p3 = await api(port, "POST", "/api/products", {
      product_code: `${prefix}-TEST003`,
      product_name: "세번째 상품",
      purchase_price: 1000,
      vat_type: "INCLUDED",
      carton_qty: 1,
      default_shipping_fee: 0,
      default_shipping_type: "PARCEL",
      supplier_id: supplier.id,
    });
    assert.equal(p1.status, 201);
    product = mapCreatedProduct(p1.json.data);
    product2 = mapCreatedProduct(p2.json.data);
    product3 = mapCreatedProduct(p3.json.data);
    created.productIds.push(product.id, product2.id, product3.id);

    const clientRes = await api(port, "POST", "/api/sales-clients", {
      client_code: `${prefix}-CLIENT001`,
      client_name: "에쎄르테스트",
    });
    assert.equal(clientRes.status, 201);
    client = clientRes.json.data;
    created.clientIds.push(client.id);

    const inactiveRes = await api(port, "POST", "/api/sales-clients", {
      client_code: `${prefix}-CLIENT-OFF`,
      client_name: "비활성매출처",
    });
    inactiveClient = inactiveRes.json.data;
    created.clientIds.push(inactiveClient.id);
    await api(port, "PATCH", `/api/sales-clients/${inactiveClient.id}/status`, { is_active: false });
  });

  await t.test("TEST 1 active client xls upload succeeds", async () => {
    assert.equal(fs.existsSync(realXlsPath), true);
    const original = fs.readFileSync(realXlsPath);
    const result = await upload(
      port,
      { client_id: client.id, order_date: "2026-09-04" },
      original,
      "발주서 에쎄르 (36).xls",
    );
    assert.equal(result.status, 201, JSON.stringify(result.json));
    realImport = result.json.data;
    assert.equal(realImport.original_file_name, "발주서 에쎄르 (36).xls");
    assert.equal(realImport.order_date, "2026-09-04");
    assert.equal(realImport.duplicate_hash_detected, false);
    assert.match(realImport.stored_file_name, /\.xls$/i);
    assert.equal(realImport.stored_file_path, undefined);
    const stored = fs.readFileSync(resolveStoredFilePath(realImport.stored_file_name));
    assert.equal(sha256(stored), sha256(original));
    assert.equal(stored.equals(original), true);
  });

  await t.test("TEST 2 xlsx upload succeeds", async () => {
    const buffer = xlsxBuffer([
      ["상품명", "수량", "주문번호"],
      ["테스트 상품", 2, "A-001"],
    ]);
    const result = await upload(
      port,
      { client_id: client.id, order_date: "2026-09-04" },
      buffer,
      "sample.xlsx",
    );
    assert.equal(result.status, 201, JSON.stringify(result.json));
    xlsxImport = result.json.data;
    assert.match(xlsxImport.stored_file_name, /\.xlsx$/i);
  });

  await t.test("TEST 3 invalid file is rejected", async () => {
    const result = await upload(port, { client_id: client.id, order_date: "2026-09-04" }, Buffer.from("not excel"), "note.txt");
    assert.equal(result.status, 400);
    assert.equal(result.json.error.code, "INVALID_FILE_TYPE");
  });

  await t.test("TEST 4 inactive client upload blocked", async () => {
    const buffer = xlsxBuffer([["상품명", "수량"], ["A", 1]]);
    const result = await upload(
      port,
      { client_id: inactiveClient.id, order_date: "2026-09-04" },
      buffer,
      "inactive.xlsx",
    );
    assert.equal(result.status, 400);
    assert.equal(result.json.error.code, "CLIENT_INACTIVE");
  });

  await t.test("TEST 5 duplicate hash warns", async () => {
    const original = fs.readFileSync(realXlsPath);
    const result = await upload(
      port,
      { client_id: client.id, order_date: "2026-09-04" },
      original,
      "발주서 에쎄르 (36).xls",
    );
    assert.equal(result.status, 201);
    assert.equal(result.json.data.duplicate_hash_detected, true);
    assert.equal(result.json.data.duplicate_acknowledged, false);
    realImport.duplicateId = result.json.data.id;
  });

  await t.test("TEST 6 acknowledge duplicate then continue", async () => {
    const blocked = await api(port, "POST", `/api/order-imports/${realImport.duplicateId}/parse`);
    assert.equal(blocked.status, 400);
    assert.equal(blocked.json.error.code, "DUPLICATE_NOT_ACKNOWLEDGED");
    const ack = await api(port, "POST", `/api/order-imports/${realImport.duplicateId}/acknowledge-duplicate`);
    assert.equal(ack.status, 200);
    assert.equal(ack.json.data.duplicate_acknowledged, true);
  });

  await t.test("real xls preview sheet and header", async () => {
    const preview = await api(port, "GET", `/api/order-imports/${realImport.id}/raw-preview`);
    assert.equal(preview.status, 200);
    assert.equal(preview.json.data.sheets.length, 1);
    assert.equal(preview.json.data.sheets[0].sheet_name, "Sheet1");
    assert.equal(preview.json.data.sheets[0].used_range, "A1:O29");
    const first = preview.json.data.sheets[0].preview[0];
    assert.equal(first.row_number, 1);
    assert.ok(first.cells.includes("상품명"));
    assert.ok(first.cells.includes("수량"));
  });

  await t.test("TEST 7 header row change", async () => {
    const changed = await api(port, "PATCH", `/api/order-imports/${xlsxImport.id}/config`, {
      sheet_name: "Sheet1",
      header_row_number: 1,
      column_map: { external_product_name: "상품명", quantity: "수량" },
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.json.data.header_row_number, 1);
    const mapping = await api(port, "GET", `/api/sales-clients/${client.id}/excel-mapping`);
    assert.equal(mapping.json.data.mapping.header_row_number, 1);
  });

  await t.test("TEST 8 missing required mapping blocks parse", async () => {
    await api(port, "PATCH", `/api/order-imports/${xlsxImport.id}/config`, {
      sheet_name: "Sheet1",
      header_row_number: 1,
      column_map: { external_product_name: "상품명" },
      save_mapping: false,
    });
    const parsed = await api(port, "POST", `/api/order-imports/${xlsxImport.id}/parse`);
    assert.equal(parsed.status, 400);
    assert.equal(parsed.json.error.code, "MAPPING_REQUIRED");
  });

  await t.test("TEST 9 product name and quantity mapping parses", async () => {
    await api(port, "PATCH", `/api/order-imports/${xlsxImport.id}/config`, {
      sheet_name: "Sheet1",
      header_row_number: 1,
      column_map: { external_product_name: "상품명", quantity: "수량", external_order_number: "주문번호" },
      save_mapping: false,
    });
    const parsed = await api(port, "POST", `/api/order-imports/${xlsxImport.id}/parse`);
    assert.equal(parsed.status, 200, JSON.stringify(parsed.json));
    assert.equal(parsed.json.data.parsed_row_count, 1);
    assert.equal(parsed.json.data.items[0].external_product_name, "테스트 상품");
    assert.equal(parsed.json.data.items[0].quantity, 2);
    assert.equal(parsed.json.data.items[0].match_status, "MATCHED_EXACT");
  });

  await t.test("parse real esser xls", async () => {
    const configured = await api(port, "PATCH", `/api/order-imports/${realImport.id}/config`, {
      sheet_name: "Sheet1",
      header_row_number: 1,
      column_map: esserMapping(),
    });
    assert.equal(configured.status, 200, JSON.stringify(configured.json));
    assert.equal(configured.json.data.mapping_ok, true);
    const parsed = await api(port, "POST", `/api/order-imports/${realImport.id}/parse`);
    assert.equal(parsed.status, 200, JSON.stringify(parsed.json));
    assert.equal(parsed.json.data.parsed_row_count, 4);
    const names = parsed.json.data.items.map((row) => row.external_product_name);
    assert.deepEqual(names, ["v9치약", "롱롱그린백 m", "롱롱그린백 L", "영양맛밤"]);
    assert.deepEqual(
      parsed.json.data.items.map((row) => row.quantity),
      [30, 200, 200, 200],
    );
    assert.deepEqual(
      parsed.json.data.items.map((row) => row.source_row_number),
      [2, 3, 4, 5],
    );
    assert.equal(parsed.json.data.items[0].phone, "010.4900.1080");
    assert.equal(parsed.json.data.items[0].match_status, "UNMATCHED");
    assert.equal(parsed.json.data.items[1].match_status, "UNMATCHED");
    assert.equal(parsed.json.data.items[2].match_status, "UNMATCHED");
    assert.equal(parsed.json.data.status, "PARSED");
  });

  await t.test("TEST 10 empty rows are excluded", async () => {
    const buffer = xlsxBuffer([
      ["상품명", "수량"],
      ["상품A", 1],
      ["", ""],
      [null, null],
      ["상품B", 2],
    ]);
    const up = await upload(port, { client_id: client.id, order_date: "2026-09-04" }, buffer, "empty-rows.xlsx");
    await api(port, "PATCH", `/api/order-imports/${up.json.data.id}/config`, {
      header_row_number: 1,
      column_map: { external_product_name: "상품명", quantity: "수량" },
      save_mapping: false,
    });
    const parsed = await api(port, "POST", `/api/order-imports/${up.json.data.id}/parse`);
    assert.equal(parsed.json.data.parsed_row_count, 2);
  });

  await t.test("TEST 11 name without quantity is invalid", async () => {
    const buffer = xlsxBuffer([
      ["상품명", "수량"],
      ["상품만있음", ""],
    ]);
    const up = await upload(port, { client_id: client.id, order_date: "2026-09-04" }, buffer, "no-qty.xlsx");
    await api(port, "PATCH", `/api/order-imports/${up.json.data.id}/config`, {
      header_row_number: 1,
      column_map: { external_product_name: "상품명", quantity: "수량" },
      save_mapping: false,
    });
    const parsed = await api(port, "POST", `/api/order-imports/${up.json.data.id}/parse`);
    assert.equal(parsed.json.data.items[0].validation_status, "INVALID");
    assert.equal(parsed.json.data.status, "PARSED");
  });

  await t.test("TEST 12 quantity 0 invalid", async () => {
    const buffer = xlsxBuffer([["상품명", "수량"], ["상품A", 0]]);
    const up = await upload(port, { client_id: client.id, order_date: "2026-09-04" }, buffer, "qty0.xlsx");
    await api(port, "PATCH", `/api/order-imports/${up.json.data.id}/config`, {
      header_row_number: 1,
      column_map: { external_product_name: "상품명", quantity: "수량" },
      save_mapping: false,
    });
    const parsed = await api(port, "POST", `/api/order-imports/${up.json.data.id}/parse`);
    assert.equal(parsed.json.data.items[0].validation_status, "INVALID");
  });

  await t.test("TEST 13 quantity -1 invalid", async () => {
    const buffer = xlsxBuffer([["상품명", "수량"], ["상품A", -1]]);
    const up = await upload(port, { client_id: client.id, order_date: "2026-09-04" }, buffer, "qty-neg.xlsx");
    await api(port, "PATCH", `/api/order-imports/${up.json.data.id}/config`, {
      header_row_number: 1,
      column_map: { external_product_name: "상품명", quantity: "수량" },
      save_mapping: false,
    });
    const parsed = await api(port, "POST", `/api/order-imports/${up.json.data.id}/parse`);
    assert.equal(parsed.json.data.items[0].validation_status, "INVALID");
  });

  await t.test("TEST 14 quantity 1.5 invalid", async () => {
    const buffer = xlsxBuffer([["상품명", "수량"], ["상품A", 1.5]]);
    const up = await upload(port, { client_id: client.id, order_date: "2026-09-04" }, buffer, "qty-float.xlsx");
    await api(port, "PATCH", `/api/order-imports/${up.json.data.id}/config`, {
      header_row_number: 1,
      column_map: { external_product_name: "상품명", quantity: "수량" },
      save_mapping: false,
    });
    const parsed = await api(port, "POST", `/api/order-imports/${up.json.data.id}/parse`);
    assert.equal(parsed.json.data.items[0].validation_status, "INVALID");
  });

  await t.test("TEST 15 unmatched without alias", async () => {
    const rows = await api(port, "GET", `/api/order-imports/${realImport.id}/rows`);
    assert.equal(rows.json.data.items[0].match_status, "UNMATCHED");
    assert.equal(rows.json.data.items[0].external_product_name, "v9치약");
  });

  await t.test("TEST 16 manual match", async () => {
    const rows = await api(port, "GET", `/api/order-imports/${realImport.id}/rows`);
    const first = rows.json.data.items[0];
    const matched = await api(port, "PATCH", `/api/order-imports/${realImport.id}/rows/${first.id}/match`, {
      product_option_id: product.product_option_id,
      save_alias: true,
    });
    assert.equal(matched.status, 200, JSON.stringify(matched.json));
    assert.equal(matched.json.data.row.match_status, "MANUAL");
    assert.equal(matched.json.data.row.matched_product_id, product.id);
    assert.equal(matched.json.data.import.status, "PARSED");
  });

  await t.test("TEST 17 alias reused after reparse", async () => {
    const parsed = await api(port, "POST", `/api/order-imports/${realImport.id}/parse`);
    assert.equal(parsed.status, 200);
    const first = parsed.json.data.items.find((row) => row.external_product_name === "v9치약");
    assert.equal(first.match_status, "MATCHED_ALIAS");
    assert.equal(first.matched_product_id, product.id);
  });

  await t.test("TEST 18 inactive product alias blocks READY", async () => {
    const buffer = xlsxBuffer([["상품명", "수량"], ["비활성대상", 1]]);
    const up = await upload(port, { client_id: client.id, order_date: "2026-09-04" }, buffer, "inactive-product.xlsx");
    await api(port, "PATCH", `/api/order-imports/${up.json.data.id}/config`, {
      header_row_number: 1,
      column_map: { external_product_name: "상품명", quantity: "수량" },
      save_mapping: false,
    });
    const parsed = await api(port, "POST", `/api/order-imports/${up.json.data.id}/parse`);
    const row = parsed.json.data.items[0];
    await api(port, "PATCH", `/api/order-imports/${up.json.data.id}/rows/${row.id}/match`, {
      product_option_id: product2.product_option_id,
      save_alias: true,
    });
    await api(port, "PATCH", `/api/products/${product2.id}/status`, { is_active: false });
    const again = await api(port, "POST", `/api/order-imports/${up.json.data.id}/parse`);
    assert.equal(again.json.data.items[0].match_status, "MATCHED_BUT_INACTIVE");
    assert.notEqual(again.json.data.status, "READY");
    await api(port, "PATCH", `/api/products/${product2.id}/status`, { is_active: true });
  });

  await t.test("TEST 19 all rows matched becomes READY", async () => {
    const buffer = xlsxBuffer([
      ["상품명", "수량"],
      ["테스트 상품", 1],
    ]);
    const up = await upload(port, { client_id: client.id, order_date: "2026-09-04" }, buffer, "ready.xlsx");
    await api(port, "PATCH", `/api/order-imports/${up.json.data.id}/config`, {
      header_row_number: 1,
      column_map: { external_product_name: "상품명", quantity: "수량" },
      save_mapping: false,
    });
    const parsed = await api(port, "POST", `/api/order-imports/${up.json.data.id}/parse`);
    const row = parsed.json.data.items[0];
    const matched = await api(port, "PATCH", `/api/order-imports/${up.json.data.id}/rows/${row.id}/match`, {
      product_option_id: product.product_option_id,
      save_alias: false,
    });
    assert.equal(matched.json.data.import.status, "READY");
  });

  await t.test("TEST 20 unmatched row cannot be READY", async () => {
    const got = await api(port, "GET", `/api/order-imports/${realImport.id}`);
    assert.notEqual(got.json.data.status, "READY");
    assert.ok(got.json.data.unmatched_row_count >= 1);
  });

  await t.test("TEST 21 reparse error keeps previous rows", async () => {
    const before = await api(port, "GET", `/api/order-imports/${xlsxImport.id}/rows`);
    const previousCount = before.json.data.items.length;
    assert.ok(previousCount >= 1);
    await api(port, "PATCH", `/api/order-imports/${xlsxImport.id}/config`, {
      header_row_number: 1,
      column_map: { external_product_name: "상품명" },
      save_mapping: false,
    });
    const failed = await api(port, "POST", `/api/order-imports/${xlsxImport.id}/parse`);
    assert.equal(failed.status, 400);
    await api(port, "PATCH", `/api/order-imports/${xlsxImport.id}/config`, {
      header_row_number: 1,
      column_map: { external_product_name: "상품명", quantity: "수량", external_order_number: "주문번호" },
      save_mapping: false,
    });
    const after = await api(port, "GET", `/api/order-imports/${xlsxImport.id}/rows`);
    assert.equal(after.json.data.items.length, previousCount);
    assert.equal(after.json.data.items[0].external_product_name, "테스트 상품");
  });

  await t.test("TEST 22 source_row_number preserved", async () => {
    const rows = await api(port, "GET", `/api/order-imports/${realImport.id}/rows`);
    assert.deepEqual(
      rows.json.data.items.map((row) => row.source_row_number),
      [2, 3, 4, 5],
    );
  });

  await t.test("TEST 23 raw_row_json available", async () => {
    const rows = await api(port, "GET", `/api/order-imports/${realImport.id}/rows`);
    const first = rows.json.data.items[0];
    assert.equal(first.raw_row_json["상품명"], "v9치약");
    assert.ok(first.raw_row_json["수량"] === 30 || first.raw_row_json["수량"] === "30");
  });

  await t.test("TEST 24 leading zeros preserved for text identifiers", async () => {
    const buffer = xlsxBufferWithTextCells(
      [
        ["상품명", "수량", "상품코드", "연락처"],
        ["제로상품", 1, "000123", "01012345678"],
      ],
      ["C2", "D2"],
    );
    const up = await upload(port, { client_id: client.id, order_date: "2026-09-04" }, buffer, "zeros.xlsx");
    zeroImport = up.json.data;
    await api(port, "PATCH", `/api/order-imports/${zeroImport.id}/config`, {
      header_row_number: 1,
      column_map: {
        external_product_name: "상품명",
        quantity: "수량",
        external_product_code: "상품코드",
        phone: "연락처",
      },
      save_mapping: false,
    });
    const parsed = await api(port, "POST", `/api/order-imports/${zeroImport.id}/parse`);
    assert.equal(parsed.status, 200, JSON.stringify(parsed.json));
    assert.equal(parsed.json.data.items[0].external_product_code, "000123");
    assert.equal(parsed.json.data.items[0].phone, "01012345678");
  });

  await t.test("TEST 25 suppliers products sales-clients regression", async () => {
    const suppliers = await api(port, "GET", "/api/suppliers?is_active=true");
    assert.equal(suppliers.status, 200);
    const products = await api(port, "GET", `/api/products?search=${prefix}-TEST001`);
    assert.equal(products.json.data.items[0].options[0].product_code, `${prefix}-TEST001`);
    const clients = await api(port, "GET", `/api/sales-clients?search=${prefix}-CLIENT001`);
    assert.equal(clients.json.data.items[0].client_name, "에쎄르테스트");
    const prices = await api(port, "GET", `/api/sales-clients/${client.id}/prices/current`);
    assert.equal(prices.status, 200);
  });

  await t.test("alias delete does not change past import rows", async () => {
    const aliases = await api(port, "GET", `/api/sales-clients/${client.id}/aliases`);
    assert.ok(aliases.json.data.items.length >= 1);
    const alias = aliases.json.data.items.find((item) => item.external_product_name === "v9치약");
    assert.ok(alias);
    const removed = await api(port, "DELETE", `/api/sales-clients/${client.id}/aliases/${alias.id}`);
    assert.equal(removed.status, 200);
    const rows = await api(port, "GET", `/api/order-imports/${realImport.id}/rows`);
    const first = rows.json.data.items.find((row) => row.external_product_name === "v9치약");
    assert.equal(first.matched_product_id, product.id);
  });
});

after(async () => {
  try {
    if (created.importIds.length) {
      await pool.query("DELETE FROM order_import_rows WHERE order_import_id = ANY($1::bigint[])", [created.importIds]);
      await pool.query("DELETE FROM order_imports WHERE id = ANY($1::bigint[])", [created.importIds]);
    }
    if (created.clientIds.length) {
      await pool.query("DELETE FROM product_aliases WHERE client_id = ANY($1::bigint[])", [created.clientIds]);
      await pool.query("DELETE FROM excel_mappings WHERE client_id = ANY($1::bigint[])", [created.clientIds]);
      await pool.query("DELETE FROM client_product_prices WHERE client_id = ANY($1::bigint[])", [created.clientIds]);
      await pool.query("DELETE FROM sales_clients WHERE id = ANY($1::bigint[])", [created.clientIds]);
    }
    if (created.productIds.length) {
      await deleteProductsByIds(pool, created.productIds);
    }
    if (created.supplierIds.length) {
      await pool.query("DELETE FROM suppliers WHERE id = ANY($1::bigint[])", [created.supplierIds]);
    }
    for (const name of storedFiles) {
      const filePath = resolveStoredFilePath(name);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  } finally {
    await pool.end();
  }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import { after, test } from "node:test";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrations.js";
import { resolveStoredFilePath } from "../src/utils/order-files.js";
import { resolveInvoiceStoredPath } from "../src/utils/invoice-files.js";
import { xlsxBuffer } from "./helpers/xlsx-fixture.js";
import { deleteProductsByIds, mapCreatedProduct } from "./helpers/product.js";
import { listAuditLogs } from "../src/modules/audit/audit.repository.js";

const prefix = `P12${Date.now()}`;
const created = {
  importIds: [],
  orderIds: [],
  clientIds: [],
  productIds: [],
  supplierIds: [],
  storedFiles: [],
  invoiceFiles: [],
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

async function upload(port, clientId, buffer, filename, orderDate = "2026-09-07") {
  const form = new FormData();
  form.append("client_id", String(clientId));
  form.append("order_date", orderDate);
  form.append("file", new File([buffer], filename));
  const response = await fetch(`http://127.0.0.1:${port}/api/order-imports/upload`, { method: "POST", body: form });
  const json = await response.json();
  if (json?.data?.id) created.importIds.push(json.data.id);
  if (json?.data?.stored_file_name) created.storedFiles.push(json.data.stored_file_name);
  return { status: response.status, json };
}

function productBody(supplierId, fields = {}) {
  return {
    product_name: `${prefix}-상품`,
    vat_type: "INCLUDED",
    default_shipping_type: "PARCEL",
    purchase_price: 1000,
    carton_qty: 6,
    default_shipping_fee: 3000,
    supplier_id: supplierId,
    ...fields,
  };
}

async function parseFile(port, clientId, rows, filename, columnMap = { external_product_name: "상품명", quantity: "수량" }) {
  const up = await upload(port, clientId, xlsxBuffer(rows), filename);
  if (up.json.data?.duplicate_hash_detected && !up.json.data.duplicate_acknowledged) {
    await api(port, "POST", `/api/order-imports/${up.json.data.id}/acknowledge-duplicate`);
  }
  await api(port, "PATCH", `/api/order-imports/${up.json.data.id}/config`, {
    sheet_name: "Sheet1",
    header_row_number: 1,
    column_map: columnMap,
    save_mapping: false,
  });
  const parsed = await api(port, "POST", `/api/order-imports/${up.json.data.id}/parse`);
  assert.equal(parsed.status, 200, JSON.stringify(parsed.json));
  return { importId: up.json.data.id, parsed };
}

test("manual quantity override on order import preview", async (t) => {
  const migrated = await runMigrations();
  assert.ok(migrated.files.includes("012_manual_quantity.sql"));

  const { server, port } = await startServer();
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  );

  const supplier = (await api(port, "POST", "/api/suppliers", {
    supplier_code: `${prefix}-SUP`,
    supplier_name: "수동수량매입처",
  })).json.data;
  created.supplierIds.push(supplier.id);

  const client = (await api(port, "POST", "/api/sales-clients", {
    client_code: `${prefix}-CL`,
    client_name: "수동수량매출처",
    default_shipping_type: "PARCEL",
    shipping_calculation_mode: "TOTAL_QUANTITY",
  })).json.data;
  created.clientIds.push(client.id);

  const createdProduct = await api(port, "POST", "/api/products", productBody(supplier.id, {
    product_name: `${prefix}-본품`,
  }));
  assert.equal(createdProduct.status, 201, JSON.stringify(createdProduct.json));
  const product = mapCreatedProduct(createdProduct.json.data);
  created.productIds.push(product.id);

  const price = await api(port, "POST", `/api/sales-clients/${client.id}/prices`, {
    product_option_id: product.product_option_id,
    sale_price: 3000,
    shipping_fee_override: null,
    effective_from: "2026-01-01",
  });
  assert.equal(price.status, 201, JSON.stringify(price.json));

  await t.test("TEST 1 수량 없음 → 직접 10 입력 → 오류 해제", async () => {
    const { importId, parsed } = await parseFile(
      port,
      client.id,
      [["상품명", "수량"], [`${prefix}-본품`, ""]],
      `${prefix}-empty.xlsx`,
    );
    assert.equal(parsed.status, 200, JSON.stringify(parsed.json));
    const row = parsed.json.data.items[0];
    assert.equal(row.quantity, null);
    assert.equal(row.parsed_quantity, null);
    assert.equal(row.manual_quantity, null);
    assert.equal(row.quantity_source, "PARSED");
    assert.equal(row.validation_status, "INVALID");
    assert.ok(row.validation_errors.some((message) => message.includes("수량")));
    assert.equal(row.match_status, "MATCHED_EXACT");
    assert.equal(parsed.json.data.status, "PARSED");

    const overridden = await api(port, "PATCH", `/api/order-imports/${importId}/rows/${row.id}/quantity`, {
      quantity: 10,
    });
    assert.equal(overridden.status, 200, JSON.stringify(overridden.json));
    assert.equal(overridden.json.data.row.quantity, 10);
    assert.equal(overridden.json.data.row.parsed_quantity, null);
    assert.equal(overridden.json.data.row.manual_quantity, 10);
    assert.equal(overridden.json.data.row.quantity_source, "MANUAL");
    assert.equal(overridden.json.data.row.validation_status, "VALID");
    assert.deepEqual(overridden.json.data.row.validation_errors, []);
    assert.equal(overridden.json.data.import.invalid_row_count, 0);
    assert.equal(overridden.json.data.import.status, "READY");

    const logs = await listAuditLogs({ entityType: "ORDER_IMPORT_ROW", entityId: row.id, limit: 5 });
    assert.ok(logs.some((log) => log.action === "QUANTITY_OVERRIDE"));
  });

  await t.test("TEST 2 수량 0 → 직접 5 입력", async () => {
    const { importId, parsed } = await parseFile(
      port,
      client.id,
      [["상품명", "수량"], [`${prefix}-본품`, 0]],
      `${prefix}-zero.xlsx`,
    );
    const row = parsed.json.data.items[0];
    assert.equal(row.validation_status, "INVALID");
    assert.equal(row.parsed_quantity, null);

    const overridden = await api(port, "PATCH", `/api/order-imports/${importId}/rows/${row.id}/quantity`, {
      quantity: 5,
    });
    assert.equal(overridden.status, 200, JSON.stringify(overridden.json));
    assert.equal(overridden.json.data.row.quantity, 5);
    assert.equal(overridden.json.data.row.quantity_source, "MANUAL");
    assert.equal(overridden.json.data.row.validation_status, "VALID");
    assert.equal(overridden.json.data.import.status, "READY");
  });

  await t.test("TEST 3 수량 1.5 → 직접 2 입력", async () => {
    const { importId, parsed } = await parseFile(
      port,
      client.id,
      [["상품명", "수량"], [`${prefix}-본품`, 1.5]],
      `${prefix}-decimal.xlsx`,
    );
    const row = parsed.json.data.items[0];
    assert.equal(row.validation_status, "INVALID");

    const overridden = await api(port, "PATCH", `/api/order-imports/${importId}/rows/${row.id}/quantity`, {
      quantity: 2,
    });
    assert.equal(overridden.status, 200, JSON.stringify(overridden.json));
    assert.equal(overridden.json.data.row.quantity, 2);
    assert.equal(overridden.json.data.row.validation_status, "VALID");
  });

  await t.test("TEST 4-6 수동수량 0 / -1 / 1.5 저장 거부", async () => {
    const { importId, parsed } = await parseFile(
      port,
      client.id,
      [["상품명", "수량"], [`${prefix}-본품`, ""]],
      `${prefix}-reject.xlsx`,
    );
    const row = parsed.json.data.items[0];

    const zero = await api(port, "PATCH", `/api/order-imports/${importId}/rows/${row.id}/quantity`, {
      quantity: 0,
    });
    assert.equal(zero.status, 400);
    assert.equal(zero.json.error.code, "INVALID_QUANTITY");

    const negative = await api(port, "PATCH", `/api/order-imports/${importId}/rows/${row.id}/quantity`, {
      quantity: -1,
    });
    assert.equal(negative.status, 400);
    assert.equal(negative.json.error.code, "INVALID_QUANTITY");

    const decimal = await api(port, "PATCH", `/api/order-imports/${importId}/rows/${row.id}/quantity`, {
      quantity: 1.5,
    });
    assert.equal(decimal.status, 400);
    assert.equal(decimal.json.error.code, "INVALID_QUANTITY");
  });

  await t.test("TEST 7 자동수량 10 → 수동 12 → effective 12", async () => {
    const { importId, parsed } = await parseFile(
      port,
      client.id,
      [["상품명", "수량"], [`${prefix}-본품`, 10]],
      `${prefix}-auto.xlsx`,
    );
    const row = parsed.json.data.items[0];
    assert.equal(row.quantity, 10);
    assert.equal(row.parsed_quantity, 10);
    assert.equal(row.quantity_source, "PARSED");
    assert.equal(parsed.json.data.status, "READY");

    const overridden = await api(port, "PATCH", `/api/order-imports/${importId}/rows/${row.id}/quantity`, {
      quantity: 12,
    });
    assert.equal(overridden.status, 200, JSON.stringify(overridden.json));
    assert.equal(overridden.json.data.row.quantity, 12);
    assert.equal(overridden.json.data.row.parsed_quantity, 10);
    assert.equal(overridden.json.data.row.manual_quantity, 12);
    assert.equal(overridden.json.data.row.quantity_source, "MANUAL");
    assert.equal(overridden.json.data.import.status, "READY");

    const reset = await api(port, "PATCH", `/api/order-imports/${importId}/rows/${row.id}/quantity`, {
      reset: true,
      quantity: null,
    });
    assert.equal(reset.json.data.row.quantity, 10);
    assert.equal(reset.json.data.row.manual_quantity, null);
    assert.equal(reset.json.data.row.quantity_source, "PARSED");
  });

  let readyImportId;
  let readyRowId;

  await t.test("TEST 8-9 수동입력 후 READY / 입수6 → 2카톤", async () => {
    const { importId, parsed } = await parseFile(
      port,
      client.id,
      [["상품명", "수량"], [`${prefix}-본품`, ""]],
      `${prefix}-carton.xlsx`,
    );
    const row = parsed.json.data.items[0];
    const overridden = await api(port, "PATCH", `/api/order-imports/${importId}/rows/${row.id}/quantity`, {
      quantity: 10,
    });
    assert.equal(overridden.json.data.import.status, "READY");
    readyImportId = importId;
    readyRowId = row.id;

    const draft = await api(port, "POST", `/api/order-imports/${importId}/order`);
    assert.equal(draft.status, 201, JSON.stringify(draft.json));
    created.orderIds.push(draft.json.data.id);

    await api(port, "PATCH", `/api/orders/${draft.json.data.id}/settings`, {
      shipping_type: "PARCEL",
      shipping_calculation_mode: "TOTAL_QUANTITY",
    });
    const preview = await api(port, "GET", `/api/orders/${draft.json.data.id}/preview`);
    assert.equal(preview.status, 200, JSON.stringify(preview.json));
    const line = preview.json.data.product_totals.find((item) => item.product_id === product.id);
    assert.equal(line.total_quantity, 10);
    assert.equal(line.carton_qty, 6);
    assert.equal(line.carton_count, 2);
  });

  await t.test("TEST 10 Confirm 이후 수량 수정 차단", async () => {
    const orderId = created.orderIds[created.orderIds.length - 1];
    const preview = await api(port, "GET", `/api/orders/${orderId}/preview`);
    const confirmed = await api(port, "POST", `/api/orders/${orderId}/confirm`, {
      preview_signature: preview.json.data.calculation_signature,
    });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));

    const blocked = await api(port, "PATCH", `/api/order-imports/${readyImportId}/rows/${readyRowId}/quantity`, {
      quantity: 20,
    });
    assert.equal(blocked.status, 400);
    assert.equal(blocked.json.error.code, "ORDER_IMPORT_CONFIRMED");
  });

  await t.test("TEST 11 기존 Alias 매칭 회귀", async () => {
    const alias = await api(port, "POST", `/api/sales-clients/${client.id}/aliases`, {
      product_option_id: product.product_option_id,
      external_product_name: `${prefix}-별칭`,
    });
    assert.equal(alias.status, 201, JSON.stringify(alias.json));

    const { importId, parsed } = await parseFile(
      port,
      client.id,
      [["상품명", "수량"], [`${prefix}-별칭`, 3]],
      `${prefix}-alias.xlsx`,
    );
    assert.equal(parsed.json.data.status, "READY", JSON.stringify(parsed.json.data));
    assert.equal(parsed.json.data.items[0].match_status, "MATCHED_ALIAS");
    assert.equal(parsed.json.data.items[0].matched_product_id, product.id);

    const overridden = await api(port, "PATCH", `/api/order-imports/${importId}/rows/${parsed.json.data.items[0].id}/quantity`, {
      quantity: 4,
    });
    assert.equal(overridden.json.data.row.match_status, "MATCHED_ALIAS");
    assert.equal(overridden.json.data.row.quantity, 4);
    assert.equal(overridden.json.data.import.status, "READY");
  });

  await t.test("TEST 12 기존 거래명세서 회귀", async () => {
    const orderId = created.orderIds[created.orderIds.length - 1];
    const result = await api(port, "POST", `/api/orders/${orderId}/invoices`);
    assert.equal(result.status, 201, JSON.stringify(result.json));
    assert.equal(result.json.data.document.status, "GENERATED");
    if (result.json.data.document.stored_file_name) {
      created.invoiceFiles.push(result.json.data.document.stored_file_name);
    }
  });

  await t.test("재분석 시 같은 행이면 수동수량 유지", async () => {
    const { importId, parsed } = await parseFile(
      port,
      client.id,
      [
        ["상품명", "다른명", "수량"],
        [`${prefix}-본품`, `${prefix}-다른`, ""],
      ],
      `${prefix}-reparse.xlsx`,
      { external_product_name: "상품명", quantity: "수량" },
    );
    const row = parsed.json.data.items[0];
    await api(port, "PATCH", `/api/order-imports/${importId}/rows/${row.id}/quantity`, { quantity: 8 });

    const same = await api(port, "POST", `/api/order-imports/${importId}/parse`);
    assert.equal(same.json.data.items[0].manual_quantity, 8);
    assert.equal(same.json.data.items[0].quantity, 8);
    assert.equal(same.json.data.items[0].quantity_source, "MANUAL");

    await api(port, "PATCH", `/api/order-imports/${importId}/config`, {
      sheet_name: "Sheet1",
      header_row_number: 1,
      column_map: { external_product_name: "다른명", quantity: "수량" },
      save_mapping: false,
    });
    const changed = await api(port, "POST", `/api/order-imports/${importId}/parse`);
    assert.equal(changed.json.data.items[0].external_product_name, `${prefix}-다른`);
    assert.equal(changed.json.data.items[0].manual_quantity, null);
    assert.equal(changed.json.data.items[0].quantity_source, "PARSED");
  });
});

after(async () => {
  try {
    if (created.orderIds.length) {
      await pool.query(
        `
          DELETE FROM payment_transactions
          WHERE settlement_id IN (SELECT id FROM settlements WHERE order_id = ANY($1::bigint[]))
        `,
        [created.orderIds],
      );
      await pool.query("DELETE FROM settlements WHERE order_id = ANY($1::bigint[])", [created.orderIds]);
      await pool.query("DELETE FROM generated_documents WHERE order_id = ANY($1::bigint[])", [created.orderIds]);
      await pool.query("DELETE FROM order_items WHERE order_id = ANY($1::bigint[])", [created.orderIds]);
      await pool.query("DELETE FROM order_shipping_groups WHERE order_id = ANY($1::bigint[])", [created.orderIds]);
      await pool.query("DELETE FROM orders WHERE id = ANY($1::bigint[])", [created.orderIds]);
    }
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
    for (const name of created.storedFiles) {
      const filePath = resolveStoredFilePath(name);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    for (const name of created.invoiceFiles) {
      try {
        const filePath = resolveInvoiceStoredPath(name);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        // ignore leftover names
      }
    }
  } finally {
    await pool.end();
  }
});

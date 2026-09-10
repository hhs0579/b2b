import assert from "node:assert/strict";
import fs from "node:fs";
import { after, test } from "node:test";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrations.js";
import { resolveStoredFilePath } from "../src/utils/order-files.js";
import { xlsxBuffer } from "./helpers/xlsx-fixture.js";
import { deleteProductsByIds } from "./helpers/product.js";

const prefix = `P11${Date.now()}`;
const created = {
  importIds: [],
  orderIds: [],
  clientIds: [],
  productIds: [],
  supplierIds: [],
  storedFiles: [],
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

async function upload(port, clientId, buffer, filename, orderDate = "2026-08-15") {
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

test("product options drive matching, prices, and order snapshots", async (t) => {
  const migrated = await runMigrations();
  assert.ok(migrated.files.includes("011_product_options.sql"));

  const { server, port } = await startServer();
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  );

  const supplier = (await api(port, "POST", "/api/suppliers", {
    supplier_code: `${prefix}-SUP`,
    supplier_name: "옵션매입처",
  })).json.data;
  created.supplierIds.push(supplier.id);

  const client = (await api(port, "POST", "/api/sales-clients", {
    client_code: `${prefix}-CL`,
    client_name: "옵션매출처",
    default_shipping_type: "PARCEL",
    shipping_calculation_mode: "TOTAL_QUANTITY",
  })).json.data;
  created.clientIds.push(client.id);

  const createdProduct = await api(port, "POST", "/api/products", {
    product_name: `${prefix}-롱롱그린백`,
    supplier_id: supplier.id,
    options: [
      {
        option_name: "블랙",
        product_code: `${prefix}-BLACK`,
        purchase_price: 1000,
        vat_type: "INCLUDED",
        carton_qty: 6,
        default_shipping_fee: 3000,
        default_shipping_type: "PARCEL",
      },
      {
        option_name: "아이보리",
        product_code: `${prefix}-IVORY`,
        purchase_price: 2000,
        vat_type: "INCLUDED",
        carton_qty: 10,
        default_shipping_fee: 5000,
        default_shipping_type: "PARCEL",
      },
    ],
  });
  assert.equal(createdProduct.status, 201, JSON.stringify(createdProduct.json));
  const product = createdProduct.json.data;
  created.productIds.push(product.id);
  const black = product.options.find((item) => item.option_name === "블랙");
  const ivory = product.options.find((item) => item.option_name === "아이보리");
  assert.ok(black);
  assert.ok(ivory);

  await t.test("옵션별 제안가 등록", async () => {
    const blackPrice = await api(port, "POST", `/api/sales-clients/${client.id}/prices`, {
      product_option_id: black.id,
      sale_price: 3000,
      shipping_fee_override: null,
      effective_from: "2026-01-01",
    });
    const ivoryPrice = await api(port, "POST", `/api/sales-clients/${client.id}/prices`, {
      product_option_id: ivory.id,
      sale_price: 4000,
      shipping_fee_override: null,
      effective_from: "2026-01-01",
    });
    assert.equal(blackPrice.status, 201, JSON.stringify(blackPrice.json));
    assert.equal(ivoryPrice.status, 201, JSON.stringify(ivoryPrice.json));
  });

  await t.test("옵션별 원가/카톤/택배비로 발주 계산 후 스냅샷 유지", async () => {
    const up = await upload(
      port,
      client.id,
      xlsxBuffer([
        ["상품명", "옵션", "수량"],
        [`${prefix}-롱롱그린백`, "블랙", 6],
        [`${prefix}-롱롱그린백`, "아이보리", 10],
      ]),
      `${prefix}-options.xlsx`,
    );
    await api(port, "PATCH", `/api/order-imports/${up.json.data.id}/config`, {
      sheet_name: "Sheet1",
      header_row_number: 1,
      column_map: {
        external_product_name: "상품명",
        external_option_name: "옵션",
        quantity: "수량",
      },
      save_mapping: false,
    });
    const parsed = await api(port, "POST", `/api/order-imports/${up.json.data.id}/parse`);
    assert.equal(parsed.json.data.status, "READY", JSON.stringify(parsed.json.data));
    assert.equal(parsed.json.data.items[0].matched_product_id, product.id);
    assert.equal(parsed.json.data.items[1].matched_product_id, product.id);
    const matchedOptionIds = parsed.json.data.items.map((row) => row.matched_product_option_id).sort();
    assert.deepEqual(matchedOptionIds, [black.id, ivory.id].sort());

    const draft = await api(port, "POST", `/api/order-imports/${up.json.data.id}/order`);
    created.orderIds.push(draft.json.data.id);
    await api(port, "PATCH", `/api/orders/${draft.json.data.id}/settings`, {
      shipping_type: "PARCEL",
      shipping_calculation_mode: "TOTAL_QUANTITY",
    });
    const preview = await api(port, "GET", `/api/orders/${draft.json.data.id}/preview`);
    assert.equal(preview.status, 200, JSON.stringify(preview.json));
    const blackLine = preview.json.data.product_totals.find((row) => row.option_name === "블랙");
    const ivoryLine = preview.json.data.product_totals.find((row) => row.option_name === "아이보리");
    assert.equal(blackLine.purchase_price, 1000);
    assert.equal(blackLine.sale_price, 3000);
    assert.equal(blackLine.carton_qty, 6);
    assert.equal(blackLine.carton_count, 1);
    assert.equal(blackLine.shipping_fee_per_carton, 3000);
    assert.equal(ivoryLine.purchase_price, 2000);
    assert.equal(ivoryLine.sale_price, 4000);
    assert.equal(ivoryLine.carton_qty, 10);
    assert.equal(ivoryLine.carton_count, 1);
    assert.equal(ivoryLine.shipping_fee_per_carton, 5000);

    const confirmed = await api(port, "POST", `/api/orders/${draft.json.data.id}/confirm`, {
      preview_signature: preview.json.data.calculation_signature,
    });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
    const blackItem = confirmed.json.data.items.find((row) => row.option_name === "블랙");
    const ivoryItem = confirmed.json.data.items.find((row) => row.option_name === "아이보리");
    assert.equal(blackItem.product_id, product.id);
    assert.equal(blackItem.product_option_id, black.id);
    assert.equal(blackItem.product_name, `${prefix}-롱롱그린백`);
    assert.equal(ivoryItem.product_id, product.id);
    assert.equal(ivoryItem.product_option_id, ivory.id);

    await api(port, "PATCH", `/api/products/${product.id}/options/${black.id}`, {
      purchase_price: 9999,
      vat_type: "INCLUDED",
      carton_qty: 6,
      default_shipping_fee: 3000,
      default_shipping_type: "PARCEL",
    });
    const snapshot = await api(port, "GET", `/api/orders/${draft.json.data.id}`);
    const blackSnapshot = snapshot.json.data.items.find((row) => row.option_name === "블랙");
    assert.equal(blackSnapshot.purchase_price, 1000);
    assert.equal(blackSnapshot.product_option_id, black.id);
  });
});

after(async () => {
  try {
    if (created.orderIds.length) {
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
  } finally {
    await pool.end();
  }
});

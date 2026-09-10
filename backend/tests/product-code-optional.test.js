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

const prefix = `P10${Date.now()}`;
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

function productBody(supplierId, fields) {
  return {
    product_name: `${prefix}-상품`,
    vat_type: "INCLUDED",
    default_shipping_type: "PARCEL",
    purchase_price: 1000,
    carton_qty: 6,
    default_shipping_fee: 0,
    supplier_id: supplierId,
    ...fields,
  };
}

test("product_code is optional across register, alias, confirm, invoice", async (t) => {
  const migrated = await runMigrations();
  assert.ok(migrated.files.includes("010_product_code_optional.sql"));
  assert.ok(migrated.files.includes("011_product_options.sql"));
  const again = await runMigrations();
  assert.equal(again.appliedCount, 0);

  const { server, port } = await startServer();
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  );

  const supplier = (await api(port, "POST", "/api/suppliers", {
    supplier_code: `${prefix}-SUP`,
    supplier_name: "코드선택매입처",
  })).json.data;
  created.supplierIds.push(supplier.id);

  const client = (await api(port, "POST", "/api/sales-clients", {
    client_code: `${prefix}-CL`,
    client_name: "코드선택매출처",
    default_shipping_type: "PARCEL",
    shipping_calculation_mode: "TOTAL_QUANTITY",
  })).json.data;
  created.clientIds.push(client.id);

  let product;
  let codedProduct;
  let orderId;

  await t.test("1. 상품코드 없이 상품 등록 성공", async () => {
    const omitted = await api(port, "POST", "/api/products", productBody(supplier.id, {
      product_name: `${prefix}-무코드`,
    }));
    assert.equal(omitted.status, 201, JSON.stringify(omitted.json));
    product = mapCreatedProduct(omitted.json.data);
    assert.equal(product.product_code, null);
    created.productIds.push(product.id);

    const blank = await api(port, "POST", "/api/products", productBody(supplier.id, {
      product_name: `${prefix}-빈문자`,
      product_code: "   ",
    }));
    assert.equal(blank.status, 201, JSON.stringify(blank.json));
    assert.equal(mapCreatedProduct(blank.json.data).product_code, null);
    created.productIds.push(blank.json.data.id);

    const secondNull = await api(port, "POST", "/api/products", productBody(supplier.id, {
      product_name: `${prefix}-두번째무코드`,
    }));
    assert.equal(secondNull.status, 201, JSON.stringify(secondNull.json));
    assert.equal(mapCreatedProduct(secondNull.json.data).product_code, null);
    created.productIds.push(secondNull.json.data.id);
  });

  await t.test("2. 상품코드 없이 제안가 등록 성공", async () => {
    const result = await api(port, "POST", `/api/sales-clients/${client.id}/prices`, {
      product_option_id: product.product_option_id,
      sale_price: 3500,
      shipping_fee_override: null,
      effective_from: "2026-01-01",
    });
    assert.equal(result.status, 201, JSON.stringify(result.json));
    assert.equal(result.json.data.product_option_id, product.product_option_id);
    assert.equal(result.json.data.sale_price, 3500);
  });

  await t.test("3. 상품코드 없이 Alias 매칭 성공", async () => {
    const alias = await api(port, "POST", `/api/sales-clients/${client.id}/aliases`, {
      product_option_id: product.product_option_id,
      external_product_name: `${prefix}-외부별칭`,
    });
    assert.equal(alias.status, 201, JSON.stringify(alias.json));
    assert.equal(alias.json.data.product_option_id, product.product_option_id);
    assert.equal(alias.json.data.product_id, product.id);
    assert.equal(alias.json.data.external_product_code, null);

    const nameOnly = await upload(
      port,
      client.id,
      xlsxBuffer([["상품명", "수량"], [`${prefix}-외부별칭`, 2]]),
      `${prefix}-alias-name.xlsx`,
    );
    await api(port, "PATCH", `/api/order-imports/${nameOnly.json.data.id}/config`, {
      sheet_name: "Sheet1",
      header_row_number: 1,
      column_map: { external_product_name: "상품명", quantity: "수량" },
      save_mapping: false,
    });
    const parsedName = await api(port, "POST", `/api/order-imports/${nameOnly.json.data.id}/parse`);
    assert.equal(parsedName.json.data.status, "READY", JSON.stringify(parsedName.json.data));
    assert.equal(parsedName.json.data.items[0].match_status, "MATCHED_ALIAS");
    assert.equal(parsedName.json.data.items[0].matched_product_id, product.id);

    const withAuxCode = await upload(
      port,
      client.id,
      xlsxBuffer([["상품코드", "상품명", "수량"], ["IGNORED-CODE", `${prefix}-외부별칭`, 2]]),
      `${prefix}-alias-aux.xlsx`,
    );
    await api(port, "PATCH", `/api/order-imports/${withAuxCode.json.data.id}/config`, {
      sheet_name: "Sheet1",
      header_row_number: 1,
      column_map: {
        external_product_code: "상품코드",
        external_product_name: "상품명",
        quantity: "수량",
      },
      save_mapping: false,
    });
    const parsedAux = await api(port, "POST", `/api/order-imports/${withAuxCode.json.data.id}/parse`);
    assert.equal(parsedAux.json.data.status, "READY", JSON.stringify(parsedAux.json.data));
    assert.equal(parsedAux.json.data.items[0].match_status, "MATCHED_ALIAS");
    assert.equal(parsedAux.json.data.items[0].matched_product_id, product.id);
  });

  await t.test("4. 상품코드 없이 발주 Confirm 성공", async () => {
    const draft = await api(port, "POST", `/api/order-imports/${created.importIds[0]}/order`);
    assert.equal(draft.status, 201, JSON.stringify(draft.json));
    orderId = draft.json.data.id;
    created.orderIds.push(orderId);

    await api(port, "PATCH", `/api/orders/${orderId}/settings`, {
      shipping_type: "FREE",
      shipping_calculation_mode: "TOTAL_QUANTITY",
    });
    const preview = await api(port, "GET", `/api/orders/${orderId}/preview`);
    assert.equal(preview.status, 200, JSON.stringify(preview.json));
    const confirmed = await api(port, "POST", `/api/orders/${orderId}/confirm`, {
      preview_signature: preview.json.data.calculation_signature,
    });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
    assert.equal(confirmed.json.data.order.status, "CONFIRMED");
    assert.equal(confirmed.json.data.items[0].product_code, null);
    assert.equal(confirmed.json.data.items[0].product_id, product.id);
    assert.equal(confirmed.json.data.items[0].product_option_id, product.product_option_id);
  });

  await t.test("5. 상품코드 없이 거래명세서 생성 성공", async () => {
    const result = await api(port, "POST", `/api/orders/${orderId}/invoices`);
    assert.equal(result.status, 201, JSON.stringify(result.json));
    assert.equal(result.json.data.document.status, "GENERATED");
    if (result.json.data.document.stored_file_name) {
      created.invoiceFiles.push(result.json.data.document.stored_file_name);
    }
  });

  await t.test("6. 동일한 non-null 상품코드는 중복 차단", async () => {
    const first = await api(port, "POST", "/api/products", productBody(supplier.id, {
      product_name: `${prefix}-코드상품`,
      product_code: `${prefix}-DUP`,
    }));
    assert.equal(first.status, 201, JSON.stringify(first.json));
    assert.equal(first.json.data.options[0].product_code, `${prefix}-DUP`);
    created.productIds.push(first.json.data.id);
    codedProduct = mapCreatedProduct(first.json.data);

    const duplicate = await api(port, "POST", "/api/products", productBody(supplier.id, {
      product_name: `${prefix}-코드상품2`,
      product_code: `${prefix}-DUP`,
    }));
    assert.equal(duplicate.status, 409, JSON.stringify(duplicate.json));
    assert.equal(duplicate.json.error.code, "PRODUCT_CODE_DUPLICATED");

    const fetched = await api(port, "GET", `/api/products/${codedProduct.id}`);
    assert.equal(fetched.json.data.options[0].product_code, `${prefix}-DUP`);

    const thirdNull = await api(port, "POST", "/api/products", productBody(supplier.id, {
      product_name: `${prefix}-세번째무코드`,
    }));
    assert.equal(thirdNull.status, 201, JSON.stringify(thirdNull.json));
    created.productIds.push(thirdNull.json.data.id);
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
        // ignore invalid leftover names
      }
    }
  } finally {
    await pool.end();
  }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import { after, test } from "node:test";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrations.js";
import { resolveStoredFilePath } from "../src/utils/order-files.js";
import { resolveInvoiceStoredPath } from "../src/utils/invoice-files.js";
import { xlsxBuffer } from "./helpers/xlsx-fixture.js";
import { sha256 } from "../src/domain/invoice-openxml.js";
import { todayKst } from "../src/domain/dates.js";
import { listAuditLogs } from "../src/modules/audit/audit.repository.js";
import { deleteProductsByIds, mapCreatedProduct } from "./helpers/product.js";
import { esserInvoiceBody } from "./helpers/invoice-supplier.js";

const prefix = `P8${Date.now()}`;
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
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return { status: response.status, json: await response.json() };
  }
  return { status: response.status, buffer: Buffer.from(await response.arrayBuffer()) };
}

async function seedSupplier(port, extra = {}) {
  const result = await api(port, "POST", "/api/suppliers", {
    supplier_code: `${prefix}-SUP-${created.supplierIds.length + 1}`,
    supplier_name: extra.supplier_name || "삭제테스트매입처",
    ...extra,
  });
  if (result.json?.data?.id) created.supplierIds.push(result.json.data.id);
  return result;
}

async function seedClient(port, extra = {}) {
  const result = await api(port, "POST", "/api/sales-clients", {
    client_code: `${prefix}-CL-${created.clientIds.length + 1}`,
    client_name: extra.client_name || "삭제테스트매출처",
    default_shipping_type: "FREE",
    shipping_calculation_mode: "TOTAL_QUANTITY",
    ...extra,
  });
  if (result.json?.data?.id) created.clientIds.push(result.json.data.id);
  return result;
}

async function seedProduct(port, supplierId, fields = {}) {
  const result = await api(port, "POST", "/api/products", {
    product_code: `${prefix}-P-${created.productIds.length + 1}`,
    product_name: fields.product_name || `${prefix}-상품`,
    vat_type: "INCLUDED",
    default_shipping_type: "PARCEL",
    purchase_price: fields.purchase_price ?? 1000,
    carton_qty: fields.carton_qty ?? 10,
    default_shipping_fee: fields.default_shipping_fee ?? 0,
    supplier_id: supplierId,
    ...fields,
  });
  if (result.json?.data?.id) {
    result.json.data = mapCreatedProduct(result.json.data);
    created.productIds.push(result.json.data.id);
  }
  return result;
}

async function makeDraft(port, { clientId, supplierId, productName, sale = 10000, purchase = 4000, qty = 1 }) {
  const uniqueName = `${prefix}-${productName}-${created.productIds.length + 1}`;
  const productRes = await seedProduct(port, supplierId, { product_name: uniqueName, purchase_price: purchase });
  const product = productRes.json.data;
  await api(port, "POST", `/api/sales-clients/${clientId}/prices`, {
    product_option_id: product.product_option_id,
    sale_price: sale,
    shipping_fee_override: null,
    effective_from: "2026-01-01",
  });
  const form = new FormData();
  form.append("client_id", String(clientId));
  form.append("order_date", todayKst());
  form.append("file", new File([xlsxBuffer([["상품명", "수량"], [uniqueName, qty]])], `${prefix}.xlsx`));
  const uploadRes = await fetch(`http://127.0.0.1:${port}/api/order-imports/upload`, { method: "POST", body: form });
  const uploadJson = await uploadRes.json();
  created.importIds.push(uploadJson.data.id);
  created.storedFiles.push(uploadJson.data.stored_file_name);
  await api(port, "PATCH", `/api/order-imports/${uploadJson.data.id}/config`, {
    sheet_name: "Sheet1",
    header_row_number: 1,
    column_map: { external_product_name: "상품명", quantity: "수량" },
    save_mapping: false,
  });
  await api(port, "POST", `/api/order-imports/${uploadJson.data.id}/parse`);
  const draft = await api(port, "POST", `/api/order-imports/${uploadJson.data.id}/order`);
  created.orderIds.push(draft.json.data.id);
  return { importId: uploadJson.data.id, orderId: draft.json.data.id, product, storedFileName: uploadJson.data.stored_file_name };
}

async function confirmDraft(port, orderId) {
  await api(port, "PATCH", `/api/orders/${orderId}/settings`, {
    shipping_type: "FREE",
    shipping_calculation_mode: "TOTAL_QUANTITY",
  });
  const preview = await api(port, "GET", `/api/orders/${orderId}/preview`);
  const confirmed = await api(port, "POST", `/api/orders/${orderId}/confirm`, {
    preview_signature: preview.json.data.calculation_signature,
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
  return confirmed.json.data;
}

test("phase 8 safe deletions", async (t) => {
  const migrated = await runMigrations();
  assert.ok(migrated.files.includes("009_safe_deletes.sql"));
  assert.equal((await runMigrations()).appliedCount, 0);

  const { server, port } = await startServer();
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  );

  await t.test("TEST 1 unused supplier delete succeeds", async () => {
    const createdSupplier = await seedSupplier(port, { supplier_name: "미사용매입처" });
    const id = createdSupplier.json.data.id;
    const impact = await api(port, "GET", `/api/suppliers/${id}/delete-impact`);
    assert.equal(impact.json.data.can_delete, true);
    const deleted = await api(port, "DELETE", `/api/suppliers/${id}`);
    assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
    const missing = await api(port, "GET", `/api/suppliers/${id}`);
    assert.equal(missing.status, 404);
    const logs = await listAuditLogs({ entityType: "supplier", entityId: id, limit: 5 });
    assert.equal(logs[0].action, "DELETE");
  });

  await t.test("TEST 2 supplier with product is blocked", async () => {
    const supplier = (await seedSupplier(port)).json.data;
    await seedProduct(port, supplier.id);
    const impact = await api(port, "GET", `/api/suppliers/${supplier.id}/delete-impact`);
    assert.equal(impact.json.data.can_delete, false);
    assert.equal(impact.json.data.references.products >= 1, true);
    const deleted = await api(port, "DELETE", `/api/suppliers/${supplier.id}`);
    assert.equal(deleted.status, 409);
    assert.equal(deleted.json.error.code, "SUPPLIER_IN_USE");
  });

  await t.test("TEST 3 unused product delete succeeds", async () => {
    const supplier = (await seedSupplier(port)).json.data;
    const product = (await seedProduct(port, supplier.id, { product_name: `${prefix}-미사용상품` })).json.data;
    const impact = await api(port, "GET", `/api/products/${product.id}/delete-impact`);
    assert.equal(impact.json.data.can_delete, true);
    const deleted = await api(port, "DELETE", `/api/products/${product.id}`);
    assert.equal(deleted.status, 200);
    const missing = await api(port, "GET", `/api/products/${product.id}`);
    assert.equal(missing.status, 404);
  });

  await t.test("TEST 4 product with price is blocked", async () => {
    const supplier = (await seedSupplier(port)).json.data;
    const client = (await seedClient(port)).json.data;
    const product = (await seedProduct(port, supplier.id)).json.data;
    await api(port, "POST", `/api/sales-clients/${client.id}/prices`, {
      product_option_id: product.product_option_id,
      sale_price: 3000,
      effective_from: "2026-01-01",
    });
    const deleted = await api(port, "DELETE", `/api/products/${product.id}`);
    assert.equal(deleted.status, 409);
    assert.equal(deleted.json.error.code, "PRODUCT_IN_USE");
  });

  const sharedSupplier = (await seedSupplier(port)).json.data;
  const sharedClient = (await seedClient(port, { client_name: "삭제정책매출처" })).json.data;
  const confirmed = await makeDraft(port, {
    clientId: sharedClient.id,
    supplierId: sharedSupplier.id,
    productName: "확정상품",
    sale: 100000,
    purchase: 40000,
  });
  await confirmDraft(port, confirmed.orderId);

  await t.test("TEST 5 confirmed snapshot product cannot be deleted", async () => {
    const deleted = await api(port, "DELETE", `/api/products/${confirmed.product.id}`);
    assert.equal(deleted.status, 409);
    assert.equal(deleted.json.error.code, "PRODUCT_IN_USE");
    const impact = await api(port, "GET", `/api/products/${confirmed.product.id}/delete-impact`);
    assert.equal(impact.json.data.references.confirmed_orders >= 1, true);
  });

  await t.test("TEST 6 unused sales client delete succeeds", async () => {
    const client = (await seedClient(port, { client_name: "미사용매출처" })).json.data;
    const impact = await api(port, "GET", `/api/sales-clients/${client.id}/delete-impact`);
    assert.equal(impact.json.data.can_delete, true);
    const deleted = await api(port, "DELETE", `/api/sales-clients/${client.id}`);
    assert.equal(deleted.status, 200);
  });

  await t.test("TEST 7 sales client with order is blocked", async () => {
    const deleted = await api(port, "DELETE", `/api/sales-clients/${sharedClient.id}`);
    assert.equal(deleted.status, 409);
    assert.equal(deleted.json.error.code, "SALES_CLIENT_IN_USE");
  });

  await t.test("TEST 8 alias delete does not change past match or snapshot", async () => {
    const alias = await api(port, "POST", `/api/sales-clients/${sharedClient.id}/aliases`, {
      external_product_name: `${prefix}-별칭`,
      product_option_id: confirmed.product.product_option_id,
    });
    assert.ok(alias.status === 200 || alias.status === 201, JSON.stringify(alias.json));
    const rowsBefore = await api(port, "GET", `/api/order-imports/${confirmed.importId}/rows`);
    const matched = rowsBefore.json.data.items[0].matched_product_id;
    const snapshotBefore = await api(port, "GET", `/api/orders/${confirmed.orderId}`);
    const removed = await api(port, "DELETE", `/api/sales-clients/${sharedClient.id}/aliases/${alias.json.data.id}`);
    assert.equal(removed.status, 200);
    const rowsAfter = await api(port, "GET", `/api/order-imports/${confirmed.importId}/rows`);
    assert.equal(rowsAfter.json.data.items[0].matched_product_id, matched);
    const snapshotAfter = await api(port, "GET", `/api/orders/${confirmed.orderId}`);
    assert.equal(snapshotAfter.json.data.items[0].product_name, snapshotBefore.json.data.items[0].product_name);
    assert.equal(snapshotAfter.json.data.order.total_invoice_amount, 100000);
  });

  await t.test("TEST 9 DRAFT order delete succeeds", async () => {
    const draft = await makeDraft(port, {
      clientId: sharedClient.id,
      supplierId: sharedSupplier.id,
      productName: "초안상품",
    });
    const impact = await api(port, "GET", `/api/orders/${draft.orderId}/delete-impact`);
    assert.equal(impact.json.data.can_delete, true);
    const deleted = await api(port, "DELETE", `/api/orders/${draft.orderId}`);
    assert.equal(deleted.status, 200);
    const missing = await api(port, "GET", `/api/orders/${draft.orderId}/preview`);
    assert.equal(missing.status, 404);
    const stillImport = await api(port, "GET", `/api/order-imports/${draft.importId}`);
    assert.equal(stillImport.status, 200);
  });

  await t.test("TEST 10 CONFIRMED order hard delete is blocked", async () => {
    const deleted = await api(port, "DELETE", `/api/orders/${confirmed.orderId}`);
    assert.equal(deleted.status, 409);
    assert.equal(deleted.json.error.code, "ORDER_NOT_DELETABLE");
  });

  let invoiceHash;
  await t.test("TEST 11 CONFIRMED cancel keeps snapshot and invoice", async () => {
    const invoice = await api(port, "POST", `/api/orders/${confirmed.orderId}/invoices`, await esserInvoiceBody(port));
    assert.equal(invoice.status, 201, JSON.stringify(invoice.json));
    created.invoiceFiles.push(invoice.json.data.document.stored_file_name);
    const filePath = resolveInvoiceStoredPath(invoice.json.data.document.stored_file_name);
    invoiceHash = sha256(fs.readFileSync(filePath));
    const cancelled = await api(port, "POST", `/api/orders/${confirmed.orderId}/cancel`);
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.json.data.status, "CANCELLED");
    const detail = await api(port, "GET", `/api/orders/${confirmed.orderId}`);
    assert.equal(detail.json.data.order.status, "CANCELLED");
    assert.equal(detail.json.data.items.length >= 1, true);
    assert.equal(detail.json.data.documents.length >= 1, true);
    assert.equal(detail.json.data.settlement.billing_amount, 100000);
    assert.equal(sha256(fs.readFileSync(filePath)), invoiceHash);
    const logs = await listAuditLogs({ entityType: "order", entityId: confirmed.orderId, limit: 5 });
    assert.ok(logs.some((row) => row.action === "CANCEL"));
  });

  await t.test("TEST 12 confirmed import delete is blocked", async () => {
    const deleted = await api(port, "DELETE", `/api/order-imports/${confirmed.importId}`);
    assert.equal(deleted.status, 409);
    assert.equal(deleted.json.error.code, "ORDER_IMPORT_CONFIRMED");
  });

  await t.test("TEST 13 unconfirmed import delete removes rows and file", async () => {
    const draft = await makeDraft(port, {
      clientId: sharedClient.id,
      supplierId: sharedSupplier.id,
      productName: "업로드삭제",
    });
    await api(port, "DELETE", `/api/orders/${draft.orderId}`);
    const filePath = resolveStoredFilePath(draft.storedFileName);
    assert.equal(fs.existsSync(filePath), true);
    const deleted = await api(port, "DELETE", `/api/order-imports/${draft.importId}`);
    assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
    const missing = await api(port, "GET", `/api/order-imports/${draft.importId}`);
    assert.equal(missing.status, 404);
    assert.equal(fs.existsSync(filePath), false);
  });

  await t.test("TEST 14 payment delete recalculates and writes audit", async () => {
    const live = await makeDraft(port, {
      clientId: sharedClient.id,
      supplierId: sharedSupplier.id,
      productName: "입금삭제",
      sale: 100000,
    });
    await confirmDraft(port, live.orderId);
    const pay = await api(port, "POST", `/api/orders/${live.orderId}/payments`, {
      amount: 30000,
      paid_at: todayKst(),
    });
    assert.equal(pay.json.data.settlement.settlement_status, "PARTIAL");
    const removed = await api(port, "DELETE", `/api/orders/${live.orderId}/payments/${pay.json.data.payment.id}`);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.data.settlement.paid_amount, 0);
    assert.equal(removed.json.data.settlement.outstanding_amount, 100000);
    assert.equal(removed.json.data.settlement.settlement_status, "UNPAID");
    const logs = await listAuditLogs({ entityType: "payment_transaction", entityId: pay.json.data.payment.id, limit: 3 });
    assert.equal(logs[0].action, "DELETE");
  });

  await t.test("TEST 15-16 delete-impact and deactivate audit", async () => {
    const supplier = (await seedSupplier(port)).json.data;
    await seedProduct(port, supplier.id);
    const impact = await api(port, "GET", `/api/suppliers/${supplier.id}/delete-impact`);
    assert.equal(impact.json.data.can_delete, false);
    assert.equal(impact.json.data.references.products, 1);
    const deactivated = await api(port, "PATCH", `/api/suppliers/${supplier.id}/status`, { is_active: false });
    assert.equal(deactivated.status, 200);
    const logs = await listAuditLogs({ entityType: "supplier", entityId: supplier.id, limit: 3 });
    assert.ok(logs.some((row) => row.action === "DEACTIVATE"));
  });

  await t.test("TEST 17 invoice file remains unchanged", async () => {
    const file = created.invoiceFiles[0];
    assert.ok(file);
    const filePath = resolveInvoiceStoredPath(file);
    assert.equal(fs.existsSync(filePath), true);
    assert.equal(sha256(fs.readFileSync(filePath)), invoiceHash);
  });

  await t.test("TEST 18 existing APIs still work", async () => {
    const health = await api(port, "GET", "/api/health");
    const suppliers = await api(port, "GET", "/api/suppliers");
    const dashboard = await api(port, "GET", "/api/dashboard");
    assert.equal(health.status, 200);
    assert.equal(suppliers.status, 200);
    assert.equal(dashboard.status, 200);
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
        // leftover
      }
    }
  } finally {
    await pool.end();
  }
});

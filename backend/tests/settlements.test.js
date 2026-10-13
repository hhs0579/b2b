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
import { inspectInvoiceWorkbook } from "../src/domain/invoice-openxml.js";
import { recalcSettlement } from "../src/domain/settlement.js";
import { todayKst } from "../src/domain/dates.js";
import { AppError } from "../src/utils/app-error.js";
import { esserInvoiceBody } from "./helpers/invoice-supplier.js";

const prefix = `P7${Date.now()}`;
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

async function upload(port, clientId, buffer, filename, orderDate) {
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

async function seedSupplier(port) {
  const result = await api(port, "POST", "/api/suppliers", {
    supplier_code: `${prefix}-SUP-${created.supplierIds.length + 1}`,
    supplier_name: "정산테스트매입처",
  });
  created.supplierIds.push(result.json.data.id);
  return result.json.data;
}

async function seedClient(port, extra = {}) {
  const result = await api(port, "POST", "/api/sales-clients", {
    client_code: `${prefix}-CL-${created.clientIds.length + 1}`,
    client_name: extra.client_name || "정산테스트매출처",
    default_shipping_type: "FREE",
    shipping_calculation_mode: "TOTAL_QUANTITY",
    ...extra,
  });
  created.clientIds.push(result.json.data.id);
  return result.json.data;
}

async function seedProduct(port, supplierId, fields) {
  const result = await api(port, "POST", "/api/products", {
    product_code: `${prefix}-P-${created.productIds.length + 1}`,
    vat_type: "INCLUDED",
    default_shipping_type: "PARCEL",
    supplier_id: supplierId,
    ...fields,
  });
  const product = mapCreatedProduct(result.json.data);
  created.productIds.push(product.id);
  return product;
}

async function setPrice(port, clientId, optionId, salePrice, override = null, from = "2026-01-01") {
  return api(port, "POST", `/api/sales-clients/${clientId}/prices`, {
    product_option_id: optionId,
    sale_price: salePrice,
    shipping_fee_override: override,
    effective_from: from,
  });
}

async function makeConfirmed(port, { clientId, supplierId, productName, sale, purchase, qty = 1, orderDate }) {
  const uniqueName = `${prefix}-${productName}-${created.productIds.length + 1}`;
  const product = await seedProduct(port, supplierId, {
    product_name: uniqueName,
    purchase_price: purchase,
    carton_qty: 10,
    default_shipping_fee: 0,
  });
  await setPrice(port, clientId, product.product_option_id, sale);
  const up = await upload(
    port,
    clientId,
    xlsxBuffer([["상품명", "수량"], [uniqueName, qty]]),
    `${prefix}.xlsx`,
    orderDate,
  );
  await api(port, "PATCH", `/api/order-imports/${up.json.data.id}/config`, {
    sheet_name: "Sheet1",
    header_row_number: 1,
    column_map: { external_product_name: "상품명", quantity: "수량" },
    save_mapping: false,
  });
  const parsed = await api(port, "POST", `/api/order-imports/${up.json.data.id}/parse`);
  assert.equal(parsed.json.data.status, "READY", JSON.stringify(parsed.json));
  const draft = await api(port, "POST", `/api/order-imports/${up.json.data.id}/order`);
  created.orderIds.push(draft.json.data.id);
  await api(port, "PATCH", `/api/orders/${draft.json.data.id}/settings`, {
    shipping_type: "FREE",
    shipping_calculation_mode: "TOTAL_QUANTITY",
  });
  const preview = await api(port, "GET", `/api/orders/${draft.json.data.id}/preview`);
  const confirmed = await api(port, "POST", `/api/orders/${draft.json.data.id}/confirm`, {
    preview_signature: preview.json.data.calculation_signature,
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
  return { orderId: draft.json.data.id, product, preview: confirmed.json.data };
}

test("recalcSettlement partial/paid/overpay", () => {
  const partial = recalcSettlement(100000, [{ amount: 30000, paid_at: "2026-09-01" }]);
  assert.equal(partial.paid_amount, 30000);
  assert.equal(partial.outstanding_amount, 70000);
  assert.equal(partial.settlement_status, "PARTIAL");

  const paid = recalcSettlement(100000, [
    { amount: 30000, paid_at: "2026-09-01" },
    { amount: 70000, paid_at: "2026-09-02" },
  ]);
  assert.equal(paid.paid_amount, 100000);
  assert.equal(paid.outstanding_amount, 0);
  assert.equal(paid.settlement_status, "PAID");

  assert.throws(
    () => recalcSettlement(100000, [{ amount: 100001, paid_at: "2026-09-01" }]),
    (err) => err instanceof AppError && err.code === "OVERPAYMENT",
  );
});

test("phase 7 ledger settlements dashboard", async (t) => {
  const migrated = await runMigrations();
  assert.ok(migrated.files.includes("007_order_client_name_snapshot.sql"));
  assert.ok(migrated.files.includes("008_settlements.sql"));
  assert.equal((await runMigrations()).appliedCount, 0);

  const { server, port } = await startServer();
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  );

  const supplier = await seedSupplier(port);
  const client = await seedClient(port, { client_name: "확정당시매출처" });
  const today = todayKst();
  const { orderId, product } = await makeConfirmed(port, {
    clientId: client.id,
    supplierId: supplier.id,
    productName: "정산상품",
    sale: 100000,
    purchase: 40000,
    qty: 1,
    orderDate: today,
  });

  await t.test("confirm stores client_name_snapshot and UNPAID settlement", async () => {
    const detail = await api(port, "GET", `/api/orders/${orderId}`);
    assert.equal(detail.status, 200, JSON.stringify(detail.json));
    assert.equal(detail.json.data.order.client_name_snapshot, "확정당시매출처");
    assert.equal(detail.json.data.order.client_name, "확정당시매출처");
    assert.equal(detail.json.data.order.total_invoice_amount, 100000);
    assert.equal(detail.json.data.settlement.billing_amount, 100000);
    assert.equal(detail.json.data.settlement.paid_amount, 0);
    assert.equal(detail.json.data.settlement.outstanding_amount, 100000);
    assert.equal(detail.json.data.settlement.settlement_status, "UNPAID");
    assert.equal(detail.json.data.settlement.tax_invoice_status, "NOT_ISSUED");
  });

  let firstPaymentId;

  await t.test("partial payment 30000 => PARTIAL outstanding 70000", async () => {
    const result = await api(port, "POST", `/api/orders/${orderId}/payments`, {
      amount: 30000,
      paid_at: today,
      memo: "1차",
    });
    assert.equal(result.status, 201, JSON.stringify(result.json));
    assert.equal(result.json.data.settlement.settlement_status, "PARTIAL");
    assert.equal(result.json.data.settlement.paid_amount, 30000);
    assert.equal(result.json.data.settlement.outstanding_amount, 70000);
    firstPaymentId = result.json.data.payment.id;
  });

  await t.test("additional 70000 => PAID outstanding 0", async () => {
    const result = await api(port, "POST", `/api/orders/${orderId}/payments`, {
      amount: 70000,
      paid_at: today,
    });
    assert.equal(result.status, 201, JSON.stringify(result.json));
    assert.equal(result.json.data.settlement.settlement_status, "PAID");
    assert.equal(result.json.data.settlement.paid_amount, 100000);
    assert.equal(result.json.data.settlement.outstanding_amount, 0);
  });

  await t.test("delete last payment recalculates PARTIAL", async () => {
    const detail = await api(port, "GET", `/api/orders/${orderId}`);
    const last = detail.json.data.payments[detail.json.data.payments.length - 1];
    const removed = await api(port, "DELETE", `/api/orders/${orderId}/payments/${last.id}`);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.data.settlement.settlement_status, "PARTIAL");
    assert.equal(removed.json.data.settlement.paid_amount, 30000);
    assert.equal(removed.json.data.settlement.outstanding_amount, 70000);
  });

  await t.test("update payment amount recalculates", async () => {
    const updated = await api(port, "PATCH", `/api/orders/${orderId}/payments/${firstPaymentId}`, {
      amount: 40000,
      paid_at: today,
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.json));
    assert.equal(updated.json.data.settlement.paid_amount, 40000);
    assert.equal(updated.json.data.settlement.outstanding_amount, 60000);
    assert.equal(updated.json.data.settlement.settlement_status, "PARTIAL");
  });

  await t.test("overpayment is blocked", async () => {
    const over = await api(port, "POST", `/api/orders/${orderId}/payments`, {
      amount: 70000,
      paid_at: today,
    });
    assert.equal(over.status, 400);
    assert.equal(over.json.error.code, "OVERPAYMENT");
    const detail = await api(port, "GET", `/api/orders/${orderId}`);
    assert.equal(detail.json.data.settlement.paid_amount, 40000);
    assert.equal(detail.json.data.payments.length, 1);
  });

  await t.test("tax invoice manual status", async () => {
    const issued = await api(port, "PATCH", `/api/orders/${orderId}/settlement`, {
      tax_invoice_status: "ISSUED",
      expected_payment_date: today,
      memo: "계산서 발행",
    });
    assert.equal(issued.status, 200, JSON.stringify(issued.json));
    assert.equal(issued.json.data.tax_invoice_status, "ISSUED");
    assert.ok(issued.json.data.tax_invoice_issued_at);
    const cleared = await api(port, "PATCH", `/api/orders/${orderId}/settlement`, {
      tax_invoice_status: "NOT_ISSUED",
    });
    assert.equal(cleared.json.data.tax_invoice_status, "NOT_ISSUED");
    assert.equal(cleared.json.data.tax_invoice_issued_at, null);
  });

  await t.test("snapshot amounts and client name stay after live changes", async () => {
    await api(port, "PATCH", `/api/products/${product.id}`, {
      purchase_price: 1,
    });
    await setPrice(port, client.id, product.product_option_id, 1, null, today);
    await api(port, "PATCH", `/api/sales-clients/${client.id}`, {
      client_name: "변경된매출처명",
    });

    const list = await api(port, "GET", `/api/orders?client_id=${client.id}`);
    assert.equal(list.status, 200);
    const row = list.json.data.items.find((item) => item.id === orderId);
    assert.ok(row);
    assert.equal(row.client_name, "확정당시매출처");
    assert.equal(row.total_invoice_amount, 100000);
    assert.equal(row.total_product_sales, 100000);
    assert.equal(row.total_product_cost, 40000);
    assert.equal(row.billing_amount, 100000);

    const detail = await api(port, "GET", `/api/orders/${orderId}`);
    assert.equal(detail.json.data.order.client_name, "확정당시매출처");
    assert.equal(detail.json.data.order.total_invoice_amount, 100000);
    assert.equal(detail.json.data.items[0].sale_price, 100000);
    assert.equal(detail.json.data.items[0].purchase_price, 40000);

    const invoice = await api(port, "POST", `/api/orders/${orderId}/invoices`, await esserInvoiceBody(port));
    assert.equal(invoice.status, 201, JSON.stringify(invoice.json));
    created.invoiceFiles.push(invoice.json.data.document.stored_file_name);
    const v2 = await api(port, "POST", `/api/orders/${orderId}/invoices`, await esserInvoiceBody(port));
    assert.equal(v2.status, 201, JSON.stringify(v2.json));
    created.invoiceFiles.push(v2.json.data.document.stored_file_name);
    const listed = await api(port, "GET", `/api/orders/${orderId}/invoices`);
    assert.equal(listed.json.data.documents.length, 2);
    assert.equal(listed.json.data.documents[0].status, "GENERATED");
    assert.equal(listed.json.data.documents[1].status, "GENERATED");
    assert.equal(listed.json.data.order.client_name, "확정당시매출처");
    const file = await api(port, "GET", `/api/orders/${orderId}/invoices/${listed.json.data.documents[0].id}/download`);
    const inspect = await inspectInvoiceWorkbook(file.buffer);
    assert.equal(inspect.cells.C6.value, "확정당시매출처");
  });

  await t.test("receivables sort and dashboard KPI use snapshots", async () => {
    const before = await api(port, "GET", "/api/dashboard");
    const extra = await makeConfirmed(port, {
      clientId: client.id,
      supplierId: supplier.id,
      productName: "대시보드상품",
      sale: 50000,
      purchase: 10000,
      qty: 1,
      orderDate: today,
    });
    await api(port, "PATCH", `/api/orders/${extra.orderId}/settlement`, {
      expected_payment_date: "2026-01-01",
    });
    const after = await api(port, "GET", "/api/dashboard");
    assert.equal(after.status, 200);
    assert.equal(after.json.data.today_sales, before.json.data.today_sales + 50000);
    assert.equal(after.json.data.month_sales, before.json.data.month_sales + 50000);
    assert.equal(after.json.data.month_product_margin, before.json.data.month_product_margin + 40000);
    assert.equal(after.json.data.outstanding_total, before.json.data.outstanding_total + 50000);
    assert.equal(after.json.data.unsettled_count, before.json.data.unsettled_count + 1);
    assert.ok(after.json.data.recent_orders.some((item) => item.id === extra.orderId));
    assert.ok(after.json.data.top_outstanding.some((item) => item.id === extra.orderId));

    const receivables = await api(
      port,
      "GET",
      `/api/orders?settlement_status=UNPAID,PARTIAL&sort=expected_asc&client_id=${client.id}`,
    );
    assert.equal(receivables.status, 200);
    assert.ok(receivables.json.data.items.length >= 2);
    const extraRow = receivables.json.data.items.find((item) => item.id === extra.orderId);
    const firstRow = receivables.json.data.items.find((item) => item.id === orderId);
    assert.equal(extraRow.settlement_status, "UNPAID");
    assert.equal(extraRow.client_name, "변경된매출처명");
    assert.equal(firstRow.client_name, "확정당시매출처");
  });

  await t.test("product filter uses snapshot items", async () => {
    const filtered = await api(port, "GET", `/api/orders?product_id=${product.id}`);
    assert.equal(filtered.status, 200);
    assert.ok(filtered.json.data.items.some((item) => item.id === orderId));
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
        // leftover names
      }
    }
  } finally {
    await pool.end();
  }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import { after, test } from "node:test";
import XLSX from "xlsx";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrations.js";
import { resolveStoredFilePath } from "../src/utils/order-files.js";
import { resolveInvoiceStoredPath } from "../src/utils/invoice-files.js";
import { xlsxBuffer } from "./helpers/xlsx-fixture.js";
import { deleteProductsByIds, mapCreatedProduct } from "./helpers/product.js";
import { inspectInvoiceWorkbook } from "../src/domain/invoice-openxml.js";
import { STAMP_IMAGE_SHA256, invoiceSheetLayout } from "../src/domain/invoice-template-map.js";
import { expectedItemMerges } from "../src/domain/invoice-openxml-expand.js";
import { getMasterPath } from "../src/domain/invoice-master.js";

const prefix = `P13${Date.now()}`;
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

async function upload(port, clientId, buffer, filename) {
  const form = new FormData();
  form.append("client_id", String(clientId));
  form.append("order_date", "2026-09-07");
  form.append("file", new File([buffer], filename));
  const response = await fetch(`http://127.0.0.1:${port}/api/order-imports/upload`, { method: "POST", body: form });
  const json = await response.json();
  if (json?.data?.id) created.importIds.push(json.data.id);
  if (json?.data?.stored_file_name) created.storedFiles.push(json.data.stored_file_name);
  return json.data;
}

function uniqueName(name) {
  return `${prefix}-${name}`;
}

async function seedProduct(port, supplierId, name) {
  const result = await api(port, "POST", "/api/products", {
    product_name: uniqueName(name),
    product_code: `${prefix}-P-${created.productIds.length + 1}`,
    vat_type: "INCLUDED",
    default_shipping_type: "PARCEL",
    purchase_price: 1000,
    carton_qty: 10,
    default_shipping_fee: 0,
    supplier_id: supplierId,
  });
  const product = mapCreatedProduct(result.json.data);
  created.productIds.push(product.id);
  return product;
}

async function makeInvoice(port, { clientId, supplierId, count }) {
  const names = Array.from({ length: count }, (_, index) => `확장${count}-${index + 1}`);
  const products = [];
  for (const name of names) {
    const product = await seedProduct(port, supplierId, name);
    await api(port, "POST", `/api/sales-clients/${clientId}/prices`, {
      product_option_id: product.product_option_id,
      sale_price: 2000,
      shipping_fee_override: null,
      effective_from: "2026-01-01",
    });
    products.push({ ...product, excelName: uniqueName(name) });
  }
  const uploaded = await upload(
    port,
    clientId,
    xlsxBuffer([["상품명", "수량"], ...products.map((item) => [item.excelName, 1])]),
    `${prefix}-${count}.xlsx`,
  );
  await api(port, "PATCH", `/api/order-imports/${uploaded.id}/config`, {
    sheet_name: "Sheet1",
    header_row_number: 1,
    column_map: { external_product_name: "상품명", quantity: "수량" },
    save_mapping: false,
  });
  const parsed = await api(port, "POST", `/api/order-imports/${uploaded.id}/parse`);
  assert.equal(parsed.json.data.status, "READY", JSON.stringify(parsed.json.data));
  const draft = await api(port, "POST", `/api/order-imports/${uploaded.id}/order`);
  created.orderIds.push(draft.json.data.id);
  await api(port, "PATCH", `/api/orders/${draft.json.data.id}/settings`, {
    shipping_type: "FREE",
    shipping_calculation_mode: "TOTAL_QUANTITY",
  });
  const preview = await api(port, "GET", `/api/orders/${draft.json.data.id}/preview`);
  assert.equal(preview.json.data.can_confirm, true, JSON.stringify(preview.json.data?.blocking_errors || preview.json));
  assert.equal(preview.json.data.totals.invoice_required_line_count, count);
  const confirmed = await api(port, "POST", `/api/orders/${draft.json.data.id}/confirm`, {
    preview_signature: preview.json.data.calculation_signature,
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
  await pool.query("DELETE FROM settlements WHERE order_id = $1", [draft.json.data.id]);
  const generated = await api(port, "POST", `/api/orders/${draft.json.data.id}/invoices`);
  assert.equal(generated.status, 201, JSON.stringify(generated.json));
  if (generated.json.data.document.stored_file_name) {
    created.invoiceFiles.push(generated.json.data.document.stored_file_name);
  }
  const file = await api(
    port,
    "GET",
    `/api/orders/${draft.json.data.id}/invoices/${generated.json.data.document.id}/download`,
  );
  assert.equal(file.status, 200);
  return {
    inspect: await inspectInvoiceWorkbook(file.buffer),
    buffer: file.buffer,
    layout: invoiceSheetLayout(count),
  };
}

function assertExpandedLayout(inspect, layout, { lastName, qtySum, amountSum }) {
  assert.equal(inspect.formulas[layout.qtySum].text, layout.qtySumFormula);
  assert.equal(inspect.formulas[layout.amountSum].text, layout.amountSumFormula);
  assert.equal(inspect.formulas.D8.text, layout.totalAmountFormula);
  assert.equal(inspect.formulas[`K${layout.itemEnd}`].text, `G${layout.itemEnd}*I${layout.itemEnd}`);
  assert.equal(Number(inspect.cells[layout.qtySum].rawValue), qtySum);
  assert.equal(Number(inspect.cells[layout.amountSum].rawValue), amountSum);
  assert.equal(Number(inspect.cells.D8.rawValue), amountSum);
  assert.equal(inspect.cells[`C${layout.itemEnd}`].value, lastName);
  assert.equal(inspect.printArea, layout.printArea);
  assert.equal(inspect.maxRow, layout.noteRow);
  assert.equal(inspect.sheetName, "2021-12-28");
  for (const ref of expectedItemMerges(layout.itemEnd)) {
    assert.equal(inspect.merges.refs.includes(ref), true, ref);
  }
  assert.equal(inspect.merges.refs.includes(`B10:B${layout.itemEnd}`), true);
  assert.equal(inspect.merges.refs.includes(`B${layout.sumRow}:F${layout.sumRow}`), true);
  assert.equal(inspect.merges.refs.includes(`C${layout.noteRow}:K${layout.noteRow}`), true);
  assert.equal(inspect.cells[`C${layout.itemEnd}`].style, inspect.cells.C16.style);
  assert.equal(inspect.cells[`K${layout.itemEnd}`].style, inspect.cells.K16.style);
  assert.equal(inspect.rowHeights[layout.itemEnd], inspect.rowHeights[16]);
  assert.equal(inspect.media.sha256, STAMP_IMAGE_SHA256);
  assert.equal(inspect.drawingRels[0].target, "../media/image1.jpeg");
  assert.equal(inspect.drawing.picCount, 2);
}

test("invoice item rows expand beyond the MASTER 7-line template", async (t) => {
  await runMigrations();
  const { server, port } = await startServer();
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  );

  const supplier = (await api(port, "POST", "/api/suppliers", {
    supplier_code: `${prefix}-SUP`,
    supplier_name: "확장매입처",
  })).json.data;
  created.supplierIds.push(supplier.id);
  const client = (await api(port, "POST", "/api/sales-clients", {
    client_code: `${prefix}-CL`,
    client_name: "확장매출처",
    default_shipping_type: "PARCEL",
    shipping_calculation_mode: "TOTAL_QUANTITY",
  })).json.data;
  created.clientIds.push(client.id);

  await t.test("TEST 2 8행 확장", async () => {
    const { inspect, buffer, layout } = await makeInvoice(port, { clientId: client.id, supplierId: supplier.id, count: 8 });
    assert.equal(layout.itemEnd, 17);
    assert.equal(layout.sumRow, 18);
    assert.equal(layout.noteRow, 19);
    assertExpandedLayout(inspect, layout, {
      lastName: uniqueName("확장8-8"),
      qtySum: 8,
      amountSum: 16000,
    });
    const reopened = XLSX.read(buffer, { type: "buffer", cellFormula: true });
    assert.equal(reopened.SheetNames.includes("2021-12-28"), true);
    assert.equal(inspect.parts.includes("xl/calcChain.xml"), false);
    const master = await inspectInvoiceWorkbook(fs.readFileSync(getMasterPath()));
    assert.equal(inspect.partHashes["xl/styles.xml"], master.partHashes["xl/styles.xml"]);
    assert.equal(inspect.partHashes["xl/drawings/drawing1.xml"], master.partHashes["xl/drawings/drawing1.xml"]);
    assert.equal(inspect.partHashes["xl/drawings/_rels/drawing1.xml.rels"], master.partHashes["xl/drawings/_rels/drawing1.xml.rels"]);
    assert.equal(inspect.pageSetup.paperSize, "9");
    assert.equal(inspect.pageSetup.orientation, "portrait");
  });

  await t.test("TEST 3 14행 확장", async () => {
    const { inspect, layout } = await makeInvoice(port, { clientId: client.id, supplierId: supplier.id, count: 14 });
    assert.equal(layout.itemEnd, 23);
    assert.equal(layout.sumRow, 24);
    assert.equal(layout.noteRow, 25);
    assert.equal(layout.printLastRow, 26);
    assertExpandedLayout(inspect, layout, {
      lastName: uniqueName("확장14-14"),
      qtySum: 14,
      amountSum: 28000,
    });
  });

  await t.test("TEST 4/15 30행 확장", async () => {
    const { inspect, buffer, layout } = await makeInvoice(port, { clientId: client.id, supplierId: supplier.id, count: 30 });
    assert.equal(layout.itemEnd, 39);
    assert.equal(layout.sumRow, 40);
    assertExpandedLayout(inspect, layout, {
      lastName: uniqueName("확장30-30"),
      qtySum: 30,
      amountSum: 60000,
    });
    assert.doesNotThrow(() => XLSX.read(buffer, { type: "buffer" }));
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

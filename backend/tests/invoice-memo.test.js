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
import { inspectInvoiceWorkbook, sha256 } from "../src/domain/invoice-openxml.js";
import { STAMP_IMAGE_SHA256 } from "../src/domain/invoice-template-map.js";
import { formatInvoiceNoteText, formatInvoiceShipDate, formatProductParcelNote } from "../src/domain/invoice-note.js";
import { getMasterPath } from "../src/domain/invoice-master.js";
import { esserInvoiceBody } from "./helpers/invoice-supplier.js";

const prefix = `P14${Date.now()}`;
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

test("invoice note formatter uses Seoul weekday and parcel notes", () => {
  assert.equal(formatInvoiceShipDate("2026-09-07"), "26/9/7(월)");
  assert.equal(formatProductParcelNote(4000, 3), "4,000원 × 3");
  assert.equal(formatProductParcelNote(5000, 17), "5,000원 × 17");
  assert.equal(
    formatInvoiceNoteText({
      shipping_method: "택배출고",
      ship_date: "2026-09-07",
      destination: "서울시 강남구 역삼동",
      manager: "제이와이컴퍼니",
    }),
    "배송방법 : 택배출고\n출고일 : 26/9/7(월)\n배송지 : 서울시 강남구 역삼동\n담당자 : 제이와이컴퍼니",
  );
  assert.equal(formatInvoiceNoteText({}), "배송방법 :\n출고일 :\n배송지 :\n담당자 :");
});

test("invoice memo fields and shipping notes are written into generated XLSX", async (t) => {
  await runMigrations();
  const { server, port } = await startServer();
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  );

  const supplier = (
    await api(port, "POST", "/api/suppliers", {
      supplier_code: `${prefix}-SUP`,
      supplier_name: "메모매입처",
    })
  ).json.data;
  created.supplierIds.push(supplier.id);
  const client = (
    await api(port, "POST", "/api/sales-clients", {
      client_code: `${prefix}-CL`,
      client_name: "메모매출처",
      manager_name: "기본담당",
      default_shipping_type: "PARCEL",
      shipping_calculation_mode: "TOTAL_QUANTITY",
    })
  ).json.data;
  created.clientIds.push(client.id);

  async function seedProduct(name, { fee, cartonQty = 1, sale = 2000 }) {
    const result = await api(port, "POST", "/api/products", {
      product_name: uniqueName(name),
      product_code: `${prefix}-P-${created.productIds.length + 1}`,
      vat_type: "INCLUDED",
      default_shipping_type: "PARCEL",
      purchase_price: 1000,
      carton_qty: cartonQty,
      default_shipping_fee: fee,
      supplier_id: supplier.id,
    });
    const product = mapCreatedProduct(result.json.data);
    created.productIds.push(product.id);
    await api(port, "POST", `/api/sales-clients/${client.id}/prices`, {
      product_option_id: product.product_option_id,
      sale_price: sale,
      shipping_fee_override: null,
      effective_from: "2026-01-01",
    });
    return { ...product, excelName: uniqueName(name) };
  }

  async function confirmFromRows(rows, settings) {
    const products = [];
    for (const row of rows) {
      products.push(await seedProduct(row.name, row));
    }
    const uploaded = await upload(
      port,
      client.id,
      xlsxBuffer([
        ["상품명", "수량", "주소"],
        ...rows.map((row, index) => [products[index].excelName, row.qty, row.address || ""]),
      ]),
      `${prefix}-${rows.length}.xlsx`,
    );
    await api(port, "PATCH", `/api/order-imports/${uploaded.id}/config`, {
      sheet_name: "Sheet1",
      header_row_number: 1,
      column_map: { external_product_name: "상품명", quantity: "수량", address: "주소" },
      save_mapping: false,
    });
    const parsed = await api(port, "POST", `/api/order-imports/${uploaded.id}/parse`);
    assert.equal(parsed.json.data.status, "READY", JSON.stringify(parsed.json.data));
    const draft = await api(port, "POST", `/api/order-imports/${uploaded.id}/order`);
    created.orderIds.push(draft.json.data.id);
    await api(port, "PATCH", `/api/orders/${draft.json.data.id}/settings`, settings);
    const preview = await api(port, "GET", `/api/orders/${draft.json.data.id}/preview`);
    assert.equal(preview.json.data.can_confirm, true, JSON.stringify(preview.json.data.blocking_errors));
    const confirmed = await api(port, "POST", `/api/orders/${draft.json.data.id}/confirm`, {
      preview_signature: preview.json.data.calculation_signature,
    });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
    await pool.query("DELETE FROM settlements WHERE order_id = $1", [draft.json.data.id]);
    return draft.json.data.id;
  }

  async function saveMemo(orderId, body) {
    const saved = await api(port, "PATCH", `/api/orders/${orderId}/invoice-memo`, body);
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    return saved.json.data;
  }

  async function generateAndInspect(orderId) {
    const generated = await api(port, "POST", `/api/orders/${orderId}/invoices`, await esserInvoiceBody(port));
    assert.equal(generated.status, 201, JSON.stringify(generated.json));
    if (generated.json.data.document.stored_file_name) {
      created.invoiceFiles.push(generated.json.data.document.stored_file_name);
    }
    const file = await api(
      port,
      "GET",
      `/api/orders/${orderId}/invoices/${generated.json.data.document.id}/download`,
    );
    assert.equal(file.status, 200);
    return {
      generated: generated.json.data,
      inspect: await inspectInvoiceWorkbook(file.buffer),
    };
  }

  await t.test("TEST 1-4 note fields appear in C18", async () => {
    const orderId = await confirmFromRows(
      [{ name: "메모상품", qty: 1, fee: 0, address: "서울시 강남구 역삼동" }],
      { shipping_type: "FREE", shipping_calculation_mode: "TOTAL_QUANTITY" },
    );
    const saved = await saveMemo(orderId, {
      invoice_shipping_method: "택배출고",
      invoice_ship_date: "2026-09-07",
      invoice_destination: "서울시 강남구 역삼동",
      invoice_manager: "제이와이컴퍼니",
    });
    assert.match(saved.invoice_note_preview, /배송방법 : 택배출고/);
    assert.match(saved.invoice_note_preview, /출고일 : 26\/9\/7\(월\)/);
    const { inspect, generated } = await generateAndInspect(orderId);
    const note = String(inspect.cells.C18.value);
    assert.match(note, /배송방법 : 택배출고/);
    assert.match(note, /출고일 : 26\/9\/7\(월\)/);
    assert.match(note, /배송지 : 서울시 강남구 역삼동/);
    assert.match(note, /담당자 : 제이와이컴퍼니/);
    assert.equal(generated.document.invoice_metadata_snapshot.manager, "제이와이컴퍼니");
  });

  await t.test("TEST 5-6 parcel notes use projection cartons", async () => {
    const orderId = await confirmFromRows(
      [
        { name: "사천", qty: 3, fee: 4000 },
        { name: "오천", qty: 17, fee: 5000 },
      ],
      { shipping_type: "PARCEL", shipping_calculation_mode: "TOTAL_QUANTITY" },
    );
    const listed = await api(port, "GET", `/api/orders/${orderId}/invoices`);
    const productNotes = listed.json.data.projection.invoice_product_lines.map((row) => row.note);
    const shippingNotes = listed.json.data.projection.invoice_shipping_lines.map((row) => row.note);
    assert.deepEqual(productNotes, ["4,000원 × 3", "5,000원 × 17"]);
    assert.deepEqual(shippingNotes, ["", ""]);
    const { inspect } = await generateAndInspect(orderId);
    assert.equal(inspect.cells.N10.value, "4,000원 × 3");
    assert.equal(inspect.cells.N11.value, "5,000원 × 17");
    assert.equal(inspect.cells.C12.value, "택배비-4,000원");
    assert.equal(inspect.cells.N12.value ?? "", "");
    assert.equal(inspect.cells.C13.value, "택배비-5,000원");
    assert.equal(inspect.cells.N13.value ?? "", "");
  });

  await t.test("TEST 7 v1 stays frozen after manager change", async () => {
    const orderId = await confirmFromRows(
      [{ name: "버전상품", qty: 1, fee: 0 }],
      { shipping_type: "FREE", shipping_calculation_mode: "TOTAL_QUANTITY" },
    );
    await saveMemo(orderId, {
      invoice_shipping_method: "택배출고",
      invoice_ship_date: "2026-09-07",
      invoice_destination: "서울",
      invoice_manager: "담당자A",
    });
    const first = await generateAndInspect(orderId);
    await saveMemo(orderId, {
      invoice_shipping_method: "택배출고",
      invoice_ship_date: "2026-09-07",
      invoice_destination: "서울",
      invoice_manager: "담당자B",
    });
    const second = await generateAndInspect(orderId);
    assert.match(String(first.inspect.cells.C18.value), /담당자 : 담당자A/);
    assert.match(String(second.inspect.cells.C18.value), /담당자 : 담당자B/);
    assert.equal(first.generated.document.invoice_metadata_snapshot.manager, "담당자A");
    assert.equal(second.generated.document.invoice_metadata_snapshot.manager, "담당자B");
    const listed = await api(port, "GET", `/api/orders/${orderId}/invoices`);
    const docs = listed.json.data.documents;
    assert.equal(docs[0].invoice_metadata_snapshot.manager, "담당자A");
    assert.equal(docs[1].invoice_metadata_snapshot.manager, "담당자B");
  });

  await t.test("TEST 8-9 expanded sheet keeps stamp/formulas and shipping notes", async () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({
      name: `확장${index + 1}`,
      qty: 1,
      fee: index === 0 ? 4000 : 0,
    }));
    const orderId = await confirmFromRows(rows, {
      shipping_type: "PARCEL",
      shipping_calculation_mode: "TOTAL_QUANTITY",
    });
    await saveMemo(orderId, {
      invoice_shipping_method: "택배출고",
      invoice_ship_date: "2026-09-07",
      invoice_destination: "부산",
      invoice_manager: "확장담당",
    });
    const { inspect } = await generateAndInspect(orderId);
    assert.equal(inspect.cells.N10.value, "4,000원 × 1");
    assert.equal(inspect.cells.C17.value, "택배비-4,000원");
    assert.equal(inspect.cells.N17.value ?? "", "");
    assert.match(String(inspect.cells.C19.value), /담당자 : 확장담당/);
    assert.equal(inspect.formulas.D8.text, "K18+N18");
    assert.equal(inspect.printArea, "'2021-12-28'!$A$1:$O$20");
    assert.equal(inspect.media.sha256, STAMP_IMAGE_SHA256);
    assert.equal(inspect.sheetName, "2021-12-28");
    assert.equal(
      sha256(fs.readFileSync(getMasterPath())),
      "306a489c061b1f29ad1e4f16678ed63ebc6847ca664b8d9688d5f4ce79a6b224",
    );
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

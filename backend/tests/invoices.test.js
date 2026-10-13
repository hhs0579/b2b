import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrations.js";
import { resolveStoredFilePath } from "../src/utils/order-files.js";
import { resolveInvoiceStoredPath } from "../src/utils/invoice-files.js";
import { xlsxBuffer } from "./helpers/xlsx-fixture.js";
import { deleteProductsByIds, mapCreatedProduct } from "./helpers/product.js";
import { inspectInvoiceWorkbook, sha256 } from "../src/domain/invoice-openxml.js";
import { FORMULA_CELLS, ITEM_ROWS, STAMP_IMAGE_SHA256 } from "../src/domain/invoice-template-map.js";
import { getMasterPath, readMasterManifest } from "../src/domain/invoice-master.js";
import { generateInvoice } from "../src/modules/invoices/invoices.service.js";
import { excelSerialFromIsoDate } from "../src/domain/dates.js";
import { invoiceDownloadFileName } from "../src/domain/invoice-generate.js";
import { esserInvoiceBody, esserSupplierId } from "./helpers/invoice-supplier.js";

const prefix = `P6${Date.now()}`;
const created = {
  importIds: [],
  orderIds: [],
  clientIds: [],
  productIds: [],
  supplierIds: [],
  storedFiles: [],
  invoiceFiles: [],
};

const masterBefore = sha256(fs.readFileSync(getMasterPath()));

test("invoice download file name is YYMMDD_매출처_거래명세서_공급자", () => {
  assert.equal(invoiceDownloadFileName("2026-09-08", "에쎄르", 1, "에쎄르"), "260908_에쎄르_거래명세서_에쎄르.xlsx");
  assert.equal(invoiceDownloadFileName("2026-09-08", "에쎄르", 2, "에쎄르"), "260908_에쎄르_거래명세서_에쎄르_v2.xlsx");
  assert.equal(
    invoiceDownloadFileName("2026-09-11", "제이와이컴퍼니", 1, "베스트하임"),
    "260911_제이와이컴퍼니_거래명세서_베스트하임.xlsx",
  );
});

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
    return { status: response.status, json: await response.json(), response };
  }
  return {
    status: response.status,
    buffer: Buffer.from(await response.arrayBuffer()),
    headers: response.headers,
    response,
  };
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

async function seedSupplier(port) {
  const result = await api(port, "POST", "/api/suppliers", {
    supplier_code: `${prefix}-SUP-${created.supplierIds.length + 1}`,
    supplier_name: "명세서매입처",
  });
  created.supplierIds.push(result.json.data.id);
  return result.json.data;
}

async function seedClient(port, extra = {}) {
  const result = await api(port, "POST", "/api/sales-clients", {
    client_code: `${prefix}-CL-${created.clientIds.length + 1}`,
    client_name: extra.client_name || "아람유통",
    default_shipping_type: "PARCEL",
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

async function setPrice(port, clientId, optionId, salePrice, override, from = "2026-01-01") {
  return api(port, "POST", `/api/sales-clients/${clientId}/prices`, {
    product_option_id: optionId,
    sale_price: salePrice,
    shipping_fee_override: override,
    effective_from: from,
  });
}

async function parseMapped(port, importId, columnMap) {
  await api(port, "PATCH", `/api/order-imports/${importId}/config`, {
    sheet_name: "Sheet1",
    header_row_number: 1,
    column_map: columnMap,
    save_mapping: false,
  });
  return api(port, "POST", `/api/order-imports/${importId}/parse`);
}

function uniqueName(name) {
  return `${prefix}-${name}`;
}

async function makeDraft(port, { clientId, supplierId, products, aoa, columnMap, orderDate }) {
  const nameMap = new Map(products.map((spec) => [spec.name, uniqueName(spec.name)]));
  for (const spec of products) {
    spec.name = nameMap.get(spec.name);
  }
  aoa = aoa.map((row) => row.map((cell) => nameMap.get(cell) ?? cell));
  for (const spec of products) {
    const product = await seedProduct(port, supplierId, {
      product_name: spec.name,
      option_name: spec.option || null,
      purchase_price: spec.purchase,
      carton_qty: spec.cartonQty,
      default_shipping_fee: spec.defaultFee,
    });
    await setPrice(port, clientId, product.product_option_id, spec.sale, spec.override === undefined ? null : spec.override);
    spec.id = product.id;
    spec.product_option_id = product.product_option_id;
  }
  const up = await upload(port, clientId, xlsxBuffer(aoa), `${prefix}.xlsx`, orderDate || "2026-09-07");
  const parsed = await parseMapped(port, up.json.data.id, columnMap);
  assert.equal(parsed.json.data.status, "READY", JSON.stringify(parsed.json.data));
  const draft = await api(port, "POST", `/api/order-imports/${up.json.data.id}/order`);
  created.orderIds.push(draft.json.data.id);
  return { importId: up.json.data.id, orderId: draft.json.data.id, products };
}

async function confirmOrder(port, orderId, settings) {
  if (settings) {
    await api(port, "PATCH", `/api/orders/${orderId}/settings`, settings);
  }
  const preview = await api(port, "GET", `/api/orders/${orderId}/preview`);
  const confirmed = await api(port, "POST", `/api/orders/${orderId}/confirm`, {
    preview_signature: preview.json.data.calculation_signature,
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
  return confirmed.json.data;
}

async function generate(port, orderId, extra = {}) {
  const result = await api(port, "POST", `/api/orders/${orderId}/invoices`, await esserInvoiceBody(port, extra));
  if (result.json?.data?.document?.stored_file_name) {
    created.invoiceFiles.push(result.json.data.document.stored_file_name);
  }
  return result;
}

async function inspectDoc(port, orderId, documentId) {
  const file = await api(port, "GET", `/api/orders/${orderId}/invoices/${documentId}/download`);
  assert.equal(file.status, 200);
  return { inspect: await inspectInvoiceWorkbook(file.buffer), buffer: file.buffer, headers: file.headers };
}

const mapQty = { external_product_name: "상품명", quantity: "수량", external_option_name: "옵션" };

test("phase 6B invoice generation", async (t) => {
  const migrated = await runMigrations();
  assert.ok(migrated.files.includes("006_generated_invoices.sql"));
  const again = await runMigrations();
  assert.equal(again.appliedCount, 0);

  const { server, port } = await startServer();
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  );

  const supplier = await seedSupplier(port);
  const client = await seedClient(port);

  let confirmedThree;

  await t.test("TEST 1 CONFIRMED order generates invoice", async () => {
    const { orderId } = await makeDraft(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "V9 치약", option: "30g", purchase: 1000, cartonQty: 10, defaultFee: 0, sale: 5500 }],
      aoa: [["상품명", "옵션", "수량"], ["V9 치약", "30g", 30]],
      columnMap: mapQty,
    });
    await confirmOrder(port, orderId, { shipping_type: "FREE", shipping_calculation_mode: "TOTAL_QUANTITY" });
    const createdInvoice = await generate(port, orderId);
    assert.equal(createdInvoice.status, 201, JSON.stringify(createdInvoice.json));
    assert.equal(createdInvoice.json.data.document.version, 1);
    assert.equal(createdInvoice.json.data.document.status, "GENERATED");
    assert.equal(createdInvoice.json.data.document.original_file_name, "260907_아람유통_거래명세서_에쎄르.xlsx");
  });

  await t.test("TEST 2 DRAFT order cannot generate", async () => {
    const { orderId } = await makeDraft(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "DRAFT상품", purchase: 1000, cartonQty: 6, defaultFee: 0, sale: 2000 }],
      aoa: [["상품명", "수량"], ["DRAFT상품", 1]],
      columnMap: { external_product_name: "상품명", quantity: "수량" },
    });
    const result = await generate(port, orderId);
    assert.equal(result.status, 400);
    assert.equal(result.json.error.code, "ORDER_NOT_CONFIRMED");
  });

  await t.test("TEST 3 CANCELLED order cannot generate", async () => {
    const { orderId } = await makeDraft(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "취소상품", purchase: 1000, cartonQty: 6, defaultFee: 0, sale: 2000 }],
      aoa: [["상품명", "수량"], ["취소상품", 1]],
      columnMap: { external_product_name: "상품명", quantity: "수량" },
    });
    await confirmOrder(port, orderId, { shipping_type: "FREE", shipping_calculation_mode: "TOTAL_QUANTITY" });
    await pool.query("UPDATE orders SET status = 'CANCELLED' WHERE id = $1", [orderId]);
    const result = await generate(port, orderId);
    assert.equal(result.status, 400);
    assert.equal(result.json.error.code, "ORDER_NOT_CONFIRMED");
  });

  await t.test("TEST 4 MASTER checksum mismatch blocks generate", async () => {
    const { orderId } = await makeDraft(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "체크썸상품", purchase: 1000, cartonQty: 6, defaultFee: 0, sale: 2000 }],
      aoa: [["상품명", "수량"], ["체크썸상품", 1]],
      columnMap: { external_product_name: "상품명", quantity: "수량" },
    });
    await confirmOrder(port, orderId, { shipping_type: "FREE", shipping_calculation_mode: "TOTAL_QUANTITY" });
    const esserId = await esserSupplierId(port);
    await assert.rejects(
      () => generateInvoice(orderId, { supplier_profile_id: esserId }, { expectedTemplateHash: "00".repeat(32) }),
      (err) => err.code === "INVOICE_MASTER_INTEGRITY_FAILED",
    );
  });

  await t.test("TEST 5 missing MASTER blocks generate", async () => {
    const { orderId } = await makeDraft(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "없는마스터", purchase: 1000, cartonQty: 6, defaultFee: 0, sale: 2000 }],
      aoa: [["상품명", "수량"], ["없는마스터", 1]],
      columnMap: { external_product_name: "상품명", quantity: "수량" },
    });
    await confirmOrder(port, orderId, { shipping_type: "FREE", shipping_calculation_mode: "TOTAL_QUANTITY" });
    const esserId = await esserSupplierId(port);
    await assert.rejects(
      () => generateInvoice(orderId, { supplier_profile_id: esserId }, { masterPath: path.join(os.tmpdir(), "missing-invoice-master.xlsx") }),
      (err) => err.code === "INVOICE_MASTER_NOT_FOUND",
    );
  });

  await t.test("TEST 6-8,17-21,24-35,38 product rows and empty remainder", async () => {
    const { orderId } = await makeDraft(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [
        { name: "상품A", option: "빨강", purchase: 1000, cartonQty: 10, defaultFee: 0, sale: 1100 },
        { name: "상품B", option: "파랑", purchase: 1000, cartonQty: 10, defaultFee: 0, sale: 2200 },
        { name: "상품C", purchase: 1000, cartonQty: 10, defaultFee: 0, sale: 3300 },
      ],
      aoa: [
        ["상품명", "옵션", "수량"],
        ["상품A", "빨강", 1],
        ["상품B", "파랑", 1],
        ["상품C", "", 1],
      ],
      columnMap: mapQty,
    });
    await confirmOrder(port, orderId, { shipping_type: "FREE", shipping_calculation_mode: "TOTAL_QUANTITY" });
    const createdInvoice = await generate(port, orderId);
    const { inspect, buffer } = await inspectDoc(port, orderId, createdInvoice.json.data.document.id);
    const master = await inspectInvoiceWorkbook(fs.readFileSync(getMasterPath()));

    assert.equal(inspect.cells.C10.value, uniqueName("상품A"));
    assert.equal(inspect.cells.E10.value, "빨강");
    assert.equal(Number(inspect.cells.G10.value), 1);
    assert.equal(Number(inspect.cells.I10.value), 1100);
    assert.equal(inspect.cells.C11.value, uniqueName("상품B"));
    assert.equal(inspect.cells.C12.value, uniqueName("상품C"));
    for (const row of ITEM_ROWS.slice(3)) {
      assert.equal(inspect.cells[row.NAME]?.value ?? "", "");
      assert.equal(inspect.cells[row.QTY]?.value ?? "", "");
      assert.equal(inspect.cells[row.PRICE]?.value ?? "", "");
    }
    assert.equal(inspect.formulas.K10.text, "G10*I10");
    assert.equal(inspect.formulas.G17.text, "SUM(G10:H16)");
    assert.equal(inspect.formulas.K17.text, "SUM(K10:M16)");
    assert.equal(inspect.formulas.D8.text, "K17+N17");
    assert.equal(Number(inspect.cells.K10.rawValue), 1100);
    assert.equal(Number(inspect.cells.G17.rawValue), 3);
    assert.equal(Number(inspect.cells.K17.rawValue), 6600);
    assert.equal(Number(inspect.cells.D8.rawValue), 6600);
    assert.equal(inspect.media.sha256, STAMP_IMAGE_SHA256);
    assert.equal(inspect.drawingRels[0].target, "../media/image1.jpeg");
    assert.equal(inspect.printArea, master.printArea);
    assert.equal(inspect.merges.count, 66);
    assert.deepEqual(inspect.rowHeights, master.rowHeights);
    assert.deepEqual(inspect.columns, master.columns);
    assert.equal(inspect.partHashes["xl/styles.xml"], master.partHashes["xl/styles.xml"]);
    assert.equal(inspect.partHashes["xl/theme/theme1.xml"], master.partHashes["xl/theme/theme1.xml"]);
    for (const cell of Object.values(inspect.cells)) {
      const text = String(cell.value ?? "");
      assert.equal(text.includes("예시"), false);
      assert.equal(text.includes("제이와이"), false);
    }
    void buffer;
  });

  await t.test("TEST 8 seven lines keep MASTER layout", async () => {
    const names = ["칠행1", "칠행2", "칠행3", "칠행4", "칠행5", "칠행6", "칠행7"];
    const { orderId, products } = await makeDraft(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: names.map((name, idx) => ({
        name,
        purchase: 1000,
        cartonQty: 10,
        defaultFee: 0,
        sale: 1000 + idx,
      })),
      aoa: [["상품명", "수량"], ...names.map((name) => [name, 1])],
      columnMap: { external_product_name: "상품명", quantity: "수량" },
    });
    await confirmOrder(port, orderId, { shipping_type: "FREE", shipping_calculation_mode: "TOTAL_QUANTITY" });
    const ok = await generate(port, orderId);
    assert.equal(ok.status, 201);
    const { inspect } = await inspectDoc(port, orderId, ok.json.data.document.id);
    const master = await inspectInvoiceWorkbook(fs.readFileSync(getMasterPath()));
    assert.equal(inspect.formulas.G17.text, "SUM(G10:H16)");
    assert.equal(inspect.formulas.K17.text, "SUM(K10:M16)");
    assert.equal(inspect.formulas.D8.text, "K17+N17");
    assert.equal(inspect.printArea, master.printArea);
    assert.equal(inspect.merges.count, 66);
    assert.equal(inspect.maxRow, 18);
    void products;
  });

  await t.test("TEST 10 same 5000 fees collapse", async () => {
    const { orderId } = await makeDraft(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "묶음택배", purchase: 1000, cartonQty: 1, defaultFee: 5000, sale: 2000 }],
      aoa: [
        ["상품명", "수량", "주문번호"],
        ["묶음택배", 2, "A"],
        ["묶음택배", 3, "B"],
      ],
      columnMap: { external_product_name: "상품명", quantity: "수량", external_order_number: "주문번호" },
    });
    await confirmOrder(port, orderId, {
      shipping_type: "PARCEL",
      shipping_calculation_mode: "PER_ORDER",
    });
    const createdInvoice = await generate(port, orderId);
    const { inspect } = await inspectDoc(port, orderId, createdInvoice.json.data.document.id);
    assert.equal(inspect.cells.C11.value, "택배비-5,000원");
    assert.equal(Number(inspect.cells.G11.value), 5);
    assert.equal(Number(inspect.cells.I11.value), 5000);
  });

  await t.test("TEST 11 4000 and 5000 become two shipping rows", async () => {
    const { orderId } = await makeDraft(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [
        { name: "오천상품", purchase: 1000, cartonQty: 1, defaultFee: 5000, sale: 2000 },
        { name: "사천상품", purchase: 1000, cartonQty: 1, defaultFee: 4000, sale: 2000 },
      ],
      aoa: [["상품명", "수량"], ["오천상품", 1], ["사천상품", 1]],
      columnMap: { external_product_name: "상품명", quantity: "수량" },
    });
    await confirmOrder(port, orderId, { shipping_type: "PARCEL", shipping_calculation_mode: "TOTAL_QUANTITY" });
    const createdInvoice = await generate(port, orderId);
    const { inspect } = await inspectDoc(port, orderId, createdInvoice.json.data.document.id);
    assert.equal(inspect.cells.C12.value, "택배비-4,000원");
    assert.equal(Number(inspect.cells.G12.value), 1);
    assert.equal(Number(inspect.cells.I12.value), 4000);
    assert.equal(inspect.cells.C13.value, "택배비-5,000원");
    assert.equal(Number(inspect.cells.I13.value), 5000);
  });

  await t.test("TEST 12 shipping 0 has no shipping row", async () => {
    const { orderId } = await makeDraft(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "택배0", purchase: 1000, cartonQty: 1, defaultFee: 0, sale: 2000 }],
      aoa: [["상품명", "수량"], ["택배0", 1]],
      columnMap: { external_product_name: "상품명", quantity: "수량" },
    });
    await confirmOrder(port, orderId, { shipping_type: "PARCEL", shipping_calculation_mode: "TOTAL_QUANTITY" });
    const createdInvoice = await generate(port, orderId);
    const { inspect } = await inspectDoc(port, orderId, createdInvoice.json.data.document.id);
    assert.equal(inspect.cells.C10.value, uniqueName("택배0"));
    assert.equal(inspect.cells.C11?.value ?? "", "");
  });

  await t.test("TEST 13 FREE has no shipping row", async () => {
    const { orderId } = await makeDraft(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "무료배송", purchase: 1000, cartonQty: 1, defaultFee: 5000, sale: 2000 }],
      aoa: [["상품명", "수량"], ["무료배송", 1]],
      columnMap: { external_product_name: "상품명", quantity: "수량" },
    });
    await confirmOrder(port, orderId, { shipping_type: "FREE", shipping_calculation_mode: "TOTAL_QUANTITY" });
    const createdInvoice = await generate(port, orderId);
    const { inspect } = await inspectDoc(port, orderId, createdInvoice.json.data.document.id);
    assert.equal(inspect.cells.C11?.value ?? "", "");
  });

  await t.test("TEST 14 COLLECT has no shipping row", async () => {
    const { orderId } = await makeDraft(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "명세서착불", purchase: 1000, cartonQty: 1, defaultFee: 5000, sale: 2000 }],
      aoa: [["상품명", "수량"], ["명세서착불", 1]],
      columnMap: { external_product_name: "상품명", quantity: "수량" },
    });
    await confirmOrder(port, orderId, { shipping_type: "COLLECT", shipping_calculation_mode: "TOTAL_QUANTITY" });
    const createdInvoice = await generate(port, orderId);
    const { inspect } = await inspectDoc(port, orderId, createdInvoice.json.data.document.id);
    assert.equal(inspect.cells.C11?.value ?? "", "");
  });

  await t.test("TEST 15 TRUCK 150000", async () => {
    const { orderId } = await makeDraft(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "용차상품", purchase: 1000, cartonQty: 1, defaultFee: 0, sale: 2000 }],
      aoa: [["상품명", "수량"], ["용차상품", 1]],
      columnMap: { external_product_name: "상품명", quantity: "수량" },
    });
    await confirmOrder(port, orderId, {
      shipping_type: "TRUCK",
      shipping_calculation_mode: "TOTAL_QUANTITY",
      manual_shipping_charge: 150000,
    });
    const createdInvoice = await generate(port, orderId);
    const { inspect } = await inspectDoc(port, orderId, createdInvoice.json.data.document.id);
    assert.equal(inspect.cells.C11.value, "용차비");
    assert.equal(Number(inspect.cells.G11.value), 1);
    assert.equal(Number(inspect.cells.I11.value), 150000);
  });

  await t.test("TEST 16 MANUAL 50000", async () => {
    const { orderId } = await makeDraft(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "수동상품", purchase: 1000, cartonQty: 1, defaultFee: 0, sale: 2000 }],
      aoa: [["상품명", "수량"], ["수동상품", 1]],
      columnMap: { external_product_name: "상품명", quantity: "수량" },
    });
    await confirmOrder(port, orderId, {
      shipping_type: "MANUAL",
      shipping_calculation_mode: "TOTAL_QUANTITY",
      manual_shipping_charge: 50000,
    });
    const createdInvoice = await generate(port, orderId);
    const { inspect } = await inspectDoc(port, orderId, createdInvoice.json.data.document.id);
    assert.equal(inspect.cells.C11.value, "배송비");
    assert.equal(Number(inspect.cells.I11.value), 50000);
  });

  await t.test("TEST 17-18 date and client cells", async () => {
    const named = await seedClient(port, { client_name: "아람유통" });
    const { orderId } = await makeDraft(port, {
      clientId: named.id,
      supplierId: supplier.id,
      products: [{ name: "날짜상품", purchase: 1000, cartonQty: 10, defaultFee: 0, sale: 2000 }],
      aoa: [["상품명", "수량"], ["날짜상품", 1]],
      columnMap: { external_product_name: "상품명", quantity: "수량" },
      orderDate: "2026-09-07",
    });
    await confirmOrder(port, orderId, { shipping_type: "FREE", shipping_calculation_mode: "TOTAL_QUANTITY" });
    const createdInvoice = await generate(port, orderId);
    const { inspect, headers } = await inspectDoc(port, orderId, createdInvoice.json.data.document.id);
    assert.equal(Number(inspect.cells.C4.value), 2026);
    assert.equal(Number(inspect.cells.E4.value), 9);
    assert.equal(Number(inspect.cells.G4.value), 7);
    assert.equal(Number(inspect.cells.B10.value), excelSerialFromIsoDate("2026-09-07"));
    assert.equal(inspect.cells.C6.value, "아람유통");
    assert.match(headers.get("content-disposition") || "", /아람유통|%EC%95%84%EB%9E%8C%EC%9C%A0%ED%86%B5/);
  });

  await t.test("TEST 22-23 snapshot is immutable after product/price change", async () => {
    const { orderId, products } = await makeDraft(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "스냅샷상품", option: "旧옵션", purchase: 1000, cartonQty: 10, defaultFee: 0, sale: 7777 }],
      aoa: [["상품명", "옵션", "수량"], ["스냅샷상품", "旧옵션", 2]],
      columnMap: mapQty,
    });
    await confirmOrder(port, orderId, { shipping_type: "FREE", shipping_calculation_mode: "TOTAL_QUANTITY" });
    await api(port, "PATCH", `/api/products/${products[0].id}`, {
      product_name: "변경된상품명",
      option_name: "새옵션",
    });
    await setPrice(port, client.id, products[0].product_option_id, 9999, null, "2026-09-20");
    const createdInvoice = await generate(port, orderId);
    const { inspect } = await inspectDoc(port, orderId, createdInvoice.json.data.document.id);
    assert.equal(inspect.cells.C10.value, uniqueName("스냅샷상품"));
    assert.equal(inspect.cells.E10.value, "旧옵션");
    assert.equal(Number(inspect.cells.I10.value), 7777);
  });

  await t.test("TEST 34 G17 1+2+3 = 6", async () => {
    const { orderId } = await makeDraft(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [
        { name: "수량1", purchase: 1000, cartonQty: 10, defaultFee: 0, sale: 100 },
        { name: "수량2", purchase: 1000, cartonQty: 10, defaultFee: 0, sale: 100 },
        { name: "수량3", purchase: 1000, cartonQty: 10, defaultFee: 0, sale: 100 },
      ],
      aoa: [["상품명", "수량"], ["수량1", 1], ["수량2", 2], ["수량3", 3]],
      columnMap: { external_product_name: "상품명", quantity: "수량" },
    });
    await confirmOrder(port, orderId, { shipping_type: "FREE", shipping_calculation_mode: "TOTAL_QUANTITY" });
    const createdInvoice = await generate(port, orderId);
    const { inspect } = await inspectDoc(port, orderId, createdInvoice.json.data.document.id);
    assert.equal(inspect.formulas.G17.text, "SUM(G10:H16)");
    assert.equal(Number(inspect.cells.G10.value), 1);
    assert.equal(Number(inspect.cells.G11.value), 2);
    assert.equal(Number(inspect.cells.G12.value), 3);
    assert.equal(Number(inspect.cells.G17.rawValue), 6);
    confirmedThree = orderId;
  });

  await t.test("TEST 39-41 versioning and download", async () => {
    const first = await api(port, "GET", `/api/orders/${confirmedThree}/invoices`);
    assert.equal(first.json.data.documents.length, 1);
    assert.equal(first.json.data.documents[0].version, 1);
    const second = await generate(port, confirmedThree);
    assert.equal(second.status, 201);
    assert.equal(second.json.data.document.version, 2);
    const listed = await api(port, "GET", `/api/orders/${confirmedThree}/invoices`);
    assert.equal(listed.json.data.documents.length, 2);
    assert.equal(listed.json.data.documents[0].version, 1);
    assert.equal(listed.json.data.documents[1].version, 2);
    assert.equal(listed.json.data.documents[0].status, "GENERATED");
    assert.equal(listed.json.data.documents[1].status, "GENERATED");
    assert.equal(
      listed.json.data.documents.some((doc) => doc.status === "SUPERSEDED"),
      false,
    );
    const v1 = await api(port, "GET", `/api/orders/${confirmedThree}/invoices/${listed.json.data.documents[0].id}/download`);
    const v2 = await api(port, "GET", `/api/orders/${confirmedThree}/invoices/${listed.json.data.documents[1].id}/download`);
    assert.equal(v1.status, 200);
    assert.equal(v2.status, 200);
    assert.match(v1.headers.get("content-disposition") || "", /260907_%EC%95%84%EB%9E%8C%EC%9C%A0%ED%86%B5_%EA%B1%B0%EB%9E%98%EB%AA%85%EC%84%B8%EC%84%9C_%EC%97%90%EC%8E%84%EB%A5%B4\.xlsx/);
    assert.match(v2.headers.get("content-disposition") || "", /260907_%EC%95%84%EB%9E%8C%EC%9C%A0%ED%86%B5_%EA%B1%B0%EB%9E%98%EB%AA%85%EC%84%B8%EC%84%9C_%EC%97%90%EC%8E%84%EB%A5%B4_v2\.xlsx/);
    assert.equal(listed.json.data.documents[0].original_file_name, "260907_아람유통_거래명세서_에쎄르.xlsx");
    assert.equal(listed.json.data.documents[1].original_file_name, "260907_아람유통_거래명세서_에쎄르_v2.xlsx");
    assert.ok(v1.buffer.length > 0);
    assert.ok(fs.existsSync(resolveInvoiceStoredPath(listed.json.data.documents[0].stored_file_name)));
    assert.ok(fs.existsSync(resolveInvoiceStoredPath(listed.json.data.documents[1].stored_file_name)));
  });

  await t.test("TEST 42 existing APIs still work", async () => {
    const suppliers = await api(port, "GET", "/api/suppliers");
    const products = await api(port, "GET", "/api/products");
    const clients = await api(port, "GET", "/api/sales-clients");
    assert.equal(suppliers.status, 200);
    assert.equal(products.status, 200);
    assert.equal(clients.status, 200);
  });

  await t.test("TEST 36 MASTER hash unchanged after generation", () => {
    const after = sha256(fs.readFileSync(getMasterPath()));
    assert.equal(after, masterBefore);
    assert.equal(after, readMasterManifest().sha256);
    assert.equal(FORMULA_CELLS.G17.text, "SUM(G10:H16)");
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
    assert.equal(sha256(fs.readFileSync(getMasterPath())), masterBefore);
  } finally {
    await pool.end();
  }
});

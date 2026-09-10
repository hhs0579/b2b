import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrations.js";
import { env } from "../src/config/env.js";
import { resolveStoredFilePath } from "../src/utils/order-files.js";
import { xlsxBuffer } from "./helpers/xlsx-fixture.js";
import { deleteProductsByIds, mapCreatedProduct } from "./helpers/product.js";
import * as ordersRepository from "../src/modules/orders/orders.repository.js";

const prefix = `P5${Date.now()}`;
const realXlsPath = path.resolve(env.backendRoot, "..", "발주서 에쎄르 (36).xls");
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

async function upload(port, clientId, buffer, filename, orderDate = "2026-09-04") {
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
    supplier_name: "계산테스트매입처",
  });
  created.supplierIds.push(result.json.data.id);
  return result.json.data;
}

async function seedClient(port, extra = {}) {
  const result = await api(port, "POST", "/api/sales-clients", {
    client_code: `${prefix}-CL-${created.clientIds.length + 1}`,
    client_name: "계산테스트매출처",
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

async function parseMapped(port, importId, columnMap, headerRowNumber = 1) {
  await api(port, "PATCH", `/api/order-imports/${importId}/config`, {
    sheet_name: "Sheet1",
    header_row_number: headerRowNumber,
    column_map: columnMap,
    save_mapping: false,
  });
  return api(port, "POST", `/api/order-imports/${importId}/parse`);
}

async function makeReadyXlsx(port, { clientId, supplierId, products, aoa, columnMap }) {
  const createdProducts = [];
  for (const spec of products) {
    const product = await seedProduct(port, supplierId, {
      product_name: spec.name,
      purchase_price: spec.purchase,
      carton_qty: spec.cartonQty,
      default_shipping_fee: spec.defaultFee,
    });
    await setPrice(port, clientId, product.product_option_id, spec.sale, spec.override === undefined ? null : spec.override, spec.from || "2026-01-01");
    createdProducts.push(product);
  }
  const up = await upload(port, clientId, xlsxBuffer(aoa), `${prefix}.xlsx`);
  const parsed = await parseMapped(port, up.json.data.id, columnMap);
  assert.equal(parsed.status, 200, JSON.stringify(parsed.json));
  assert.equal(parsed.json.data.status, "READY", JSON.stringify(parsed.json.data));
  const draft = await api(port, "POST", `/api/order-imports/${up.json.data.id}/order`);
  assert.ok(draft.status === 200 || draft.status === 201, JSON.stringify(draft.json));
  created.orderIds.push(draft.json.data.id);
  return { importId: up.json.data.id, orderId: draft.json.data.id, products: createdProducts };
}

test("phase 5 order calculation and confirm", async (t) => {
  await runMigrations();
  const { server, port } = await startServer();
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  );

  const supplier = await seedSupplier(port);
  const client = await seedClient(port);
  const mapQty = { external_product_name: "상품명", quantity: "수량" };

  await t.test("TEST 1 qty 10 pack 6 fee 5000 => 2 cartons 10000", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "카톤상품", purchase: 2400, cartonQty: 6, defaultFee: 5000, sale: 8000 }],
      aoa: [["상품명", "수량"], ["카톤상품", 10]],
      columnMap: mapQty,
    });
    const preview = await api(port, "GET", `/api/orders/${orderId}/preview`);
    assert.equal(preview.status, 200);
    assert.equal(preview.json.data.shipping_groups[0].carton_count, 2);
    assert.equal(preview.json.data.totals.total_shipping_charge, 10000);
    assert.equal(preview.json.data.can_confirm, true);
  });

  await t.test("TEST 3 TOTAL_QUANTITY 3+3 pack 6 => 1 carton", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "합산상품", purchase: 1000, cartonQty: 6, defaultFee: 5000, sale: 2000 }],
      aoa: [["상품명", "수량"], ["합산상품", 3], ["합산상품", 3]],
      columnMap: mapQty,
    });
    const preview = await api(port, "GET", `/api/orders/${orderId}/preview`);
    assert.equal(preview.json.data.shipping_groups.length, 1);
    assert.equal(preview.json.data.shipping_groups[0].carton_count, 1);
    assert.equal(preview.json.data.totals.total_shipping_charge, 5000);
  });

  await t.test("TEST 4 PER_ORDER 3+3 pack 6 => 2 cartons", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "주문별상품", purchase: 1000, cartonQty: 6, defaultFee: 5000, sale: 2000 }],
      aoa: [
        ["상품명", "수량", "주문번호"],
        ["주문별상품", 3, "ORDER-A"],
        ["주문별상품", 3, "ORDER-B"],
      ],
      columnMap: { ...mapQty, external_order_number: "주문번호" },
    });
    const preview = await api(port, "PATCH", `/api/orders/${orderId}/settings`, {
      shipping_type: "PARCEL",
      shipping_calculation_mode: "PER_ORDER",
    });
    assert.equal(preview.json.data.shipping_groups.length, 2);
    assert.equal(preview.json.data.totals.total_cartons, 2);
    assert.equal(preview.json.data.totals.total_shipping_charge, 10000);
  });

  await t.test("TEST 5 PER_ADDRESS 3+3 pack 6 => 2 cartons", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "주소별상품", purchase: 1000, cartonQty: 6, defaultFee: 5000, sale: 2000 }],
      aoa: [
        ["상품명", "수량", "주소"],
        ["주소별상품", 3, "서울 강남구 A"],
        ["주소별상품", 3, "서울 강남구 B"],
      ],
      columnMap: { ...mapQty, address: "주소" },
    });
    const preview = await api(port, "PATCH", `/api/orders/${orderId}/settings`, {
      shipping_type: "PARCEL",
      shipping_calculation_mode: "PER_ADDRESS",
    });
    assert.equal(preview.json.data.totals.total_cartons, 2);
  });

  await t.test("TEST 6 PER_ORDER missing order number blocks confirm", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "주문번호없음", purchase: 1000, cartonQty: 6, defaultFee: 5000, sale: 2000 }],
      aoa: [["상품명", "수량"], ["주문번호없음", 3]],
      columnMap: mapQty,
    });
    const preview = await api(port, "PATCH", `/api/orders/${orderId}/settings`, {
      shipping_calculation_mode: "PER_ORDER",
    });
    assert.equal(preview.json.data.can_confirm, false);
    assert.ok(preview.json.data.blocking_codes.includes("ORDER_NUMBER_REQUIRED_FOR_SHIPPING"));
    const confirm = await api(port, "POST", `/api/orders/${orderId}/confirm`);
    assert.equal(confirm.status, 400);
    assert.equal(confirm.json.error.code, "ORDER_NUMBER_REQUIRED_FOR_SHIPPING");
  });

  await t.test("TEST 7 PER_ADDRESS missing address blocks confirm", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "주소없음", purchase: 1000, cartonQty: 6, defaultFee: 5000, sale: 2000 }],
      aoa: [["상품명", "수량"], ["주소없음", 3]],
      columnMap: mapQty,
    });
    const preview = await api(port, "PATCH", `/api/orders/${orderId}/settings`, {
      shipping_calculation_mode: "PER_ADDRESS",
    });
    const confirm = await api(port, "POST", `/api/orders/${orderId}/confirm`);
    assert.equal(confirm.status, 400);
    assert.equal(confirm.json.error.code, "ADDRESS_REQUIRED_FOR_SHIPPING");
  });

  await t.test("TEST 8 override NULL uses product default 5000", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "기본택배", purchase: 1000, cartonQty: 6, defaultFee: 5000, sale: 2000, override: null }],
      aoa: [["상품명", "수량"], ["기본택배", 6]],
      columnMap: mapQty,
    });
    const preview = await api(port, "GET", `/api/orders/${orderId}/preview`);
    assert.equal(preview.json.data.shipping_groups[0].shipping_fee_per_carton, 5000);
    assert.equal(preview.json.data.shipping_groups[0].shipping_fee_source, "PRODUCT_DEFAULT");
  });

  await t.test("TEST 9 override 0 is used", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "무료override", purchase: 1000, cartonQty: 6, defaultFee: 5000, sale: 2000, override: 0 }],
      aoa: [["상품명", "수량"], ["무료override", 6]],
      columnMap: mapQty,
    });
    const preview = await api(port, "GET", `/api/orders/${orderId}/preview`);
    assert.equal(preview.json.data.shipping_groups[0].shipping_fee_per_carton, 0);
    assert.equal(preview.json.data.shipping_groups[0].shipping_fee_source, "CLIENT_OVERRIDE");
    assert.equal(preview.json.data.totals.total_shipping_charge, 0);
  });

  await t.test("TEST 10 missing price blocks confirm", async () => {
    const product = await seedProduct(port, supplier.id, {
      product_name: "가격없음",
      purchase_price: 1000,
      carton_qty: 6,
      default_shipping_fee: 5000,
    });
    const up = await upload(port, client.id, xlsxBuffer([["상품명", "수량"], ["가격없음", 1]]), "noprice.xlsx");
    const parsed = await parseMapped(port, up.json.data.id, mapQty);
    assert.equal(parsed.json.data.status, "READY");
    const draft = await api(port, "POST", `/api/order-imports/${up.json.data.id}/order`);
    created.orderIds.push(draft.json.data.id);
    const preview = await api(port, "GET", `/api/orders/${draft.json.data.id}/preview`);
    assert.ok(preview.json.data.blocking_codes.includes("PRICE_NOT_FOUND"));
    const confirm = await api(port, "POST", `/api/orders/${draft.json.data.id}/confirm`);
    assert.equal(confirm.status, 400);
    assert.equal(confirm.json.error.code, "PRICE_NOT_FOUND");
    void product;
  });

  await t.test("TEST 11 past price on 2026-09-15", async () => {
    const product = await seedProduct(port, supplier.id, {
      product_name: "기간가격",
      purchase_price: 1000,
      carton_qty: 6,
      default_shipping_fee: 5000,
    });
    await setPrice(port, client.id, product.product_option_id, 3500, null, "2026-09-01");
    await api(port, "POST", `/api/sales-clients/${client.id}/prices`, {
      product_option_id: product.product_option_id,
      sale_price: 3800,
      shipping_fee_override: null,
      effective_from: "2026-10-01",
    });
    const up = await upload(
      port,
      client.id,
      xlsxBuffer([["상품명", "수량"], ["기간가격", 1]]),
      "dated.xlsx",
      "2026-09-15",
    );
    await parseMapped(port, up.json.data.id, mapQty);
    const draft = await api(port, "POST", `/api/order-imports/${up.json.data.id}/order`);
    created.orderIds.push(draft.json.data.id);
    const preview = await api(port, "GET", `/api/orders/${draft.json.data.id}/preview`);
    assert.equal(preview.json.data.items[0].sale_price, 3500);
  });

  let snapshotOrderId;
  let snapshotProduct;
  await t.test("TEST 12 confirm uses latest cost after preview", async () => {
    const ready = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "원가변경", purchase: 2000, cartonQty: 6, defaultFee: 5000, sale: 5000 }],
      aoa: [["상품명", "수량"], ["원가변경", 1]],
      columnMap: mapQty,
    });
    snapshotOrderId = ready.orderId;
    snapshotProduct = ready.products[0];
    await api(port, "GET", `/api/orders/${ready.orderId}/preview`);
    await api(port, "PATCH", `/api/products/${snapshotProduct.id}`, {
      product_code: snapshotProduct.product_code,
      product_name: snapshotProduct.product_name,
      purchase_price: 3000,
      vat_type: "INCLUDED",
      carton_qty: 6,
      default_shipping_fee: 5000,
      default_shipping_type: "PARCEL",
      supplier_id: supplier.id,
    });
    const confirmed = await api(port, "POST", `/api/orders/${ready.orderId}/confirm`);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
    assert.equal(confirmed.json.data.items[0].purchase_price, 3000);
    assert.equal(confirmed.json.data.order.status, "CONFIRMED");
  });

  await t.test("TEST 13 confirmed snapshot cost does not change", async () => {
    await api(port, "PATCH", `/api/products/${snapshotProduct.id}`, {
      product_code: snapshotProduct.product_code,
      product_name: snapshotProduct.product_name,
      purchase_price: 9999,
      vat_type: "INCLUDED",
      carton_qty: 6,
      default_shipping_fee: 5000,
      default_shipping_type: "PARCEL",
      supplier_id: supplier.id,
    });
    const preview = await api(port, "GET", `/api/orders/${snapshotOrderId}/preview`);
    assert.equal(preview.json.data.snapshot, true);
    assert.equal(preview.json.data.items[0].purchase_price, 3000);
  });

  await t.test("TEST 14 confirmed sale_price snapshot does not change", async () => {
    await api(port, "POST", `/api/sales-clients/${client.id}/prices`, {
      product_option_id: snapshotProduct.product_option_id,
      sale_price: 12345,
      shipping_fee_override: null,
      effective_from: "2026-09-04",
    });
    const preview = await api(port, "GET", `/api/orders/${snapshotOrderId}/preview`);
    assert.equal(preview.json.data.items[0].sale_price, 5000);
  });

  await t.test("TEST 15 FREE shipping charge 0 but cartons exist", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "무료배송상품", purchase: 1000, cartonQty: 6, defaultFee: 5000, sale: 2000 }],
      aoa: [["상품명", "수량"], ["무료배송상품", 10]],
      columnMap: mapQty,
    });
    const preview = await api(port, "PATCH", `/api/orders/${orderId}/settings`, { shipping_type: "FREE" });
    assert.equal(preview.json.data.totals.total_cartons, 2);
    assert.equal(preview.json.data.totals.total_shipping_charge, 0);
    assert.equal(preview.json.data.invoice_shipping_lines.length, 0);
  });

  await t.test("TEST 16 COLLECT shipping charge 0", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "착불상품", purchase: 1000, cartonQty: 6, defaultFee: 5000, sale: 2000 }],
      aoa: [["상품명", "수량"], ["착불상품", 10]],
      columnMap: mapQty,
    });
    const preview = await api(port, "PATCH", `/api/orders/${orderId}/settings`, { shipping_type: "COLLECT" });
    assert.equal(preview.json.data.totals.total_cartons, 2);
    assert.equal(preview.json.data.totals.total_shipping_charge, 0);
  });

  await t.test("TEST 17 TRUCK null manual blocks confirm", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "용차필수", purchase: 1000, cartonQty: 6, defaultFee: 5000, sale: 2000 }],
      aoa: [["상품명", "수량"], ["용차필수", 1]],
      columnMap: mapQty,
    });
    const preview = await api(port, "PATCH", `/api/orders/${orderId}/settings`, { shipping_type: "TRUCK" });
    const confirm = await api(port, "POST", `/api/orders/${orderId}/confirm`);
    assert.equal(confirm.status, 400);
    assert.equal(confirm.json.error.code, "MANUAL_SHIPPING_CHARGE_REQUIRED");
    void preview;
  });

  await t.test("TEST 18 TRUCK 150000 invoice 용차비 1 line", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "용차입력", purchase: 1000, cartonQty: 6, defaultFee: 5000, sale: 2000 }],
      aoa: [["상품명", "수량"], ["용차입력", 1]],
      columnMap: mapQty,
    });
    const preview = await api(port, "PATCH", `/api/orders/${orderId}/settings`, {
      shipping_type: "TRUCK",
      manual_shipping_charge: 150000,
    });
    assert.equal(preview.json.data.totals.total_shipping_charge, 150000);
    assert.equal(preview.json.data.invoice_shipping_lines.length, 1);
    assert.equal(preview.json.data.invoice_shipping_lines[0].label, "용차비");
  });

  await t.test("TEST 19 MANUAL 0 is valid with 0 shipping lines", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "수동0원", purchase: 1000, cartonQty: 6, defaultFee: 5000, sale: 2000 }],
      aoa: [["상품명", "수량"], ["수동0원", 1]],
      columnMap: mapQty,
    });
    const preview = await api(port, "PATCH", `/api/orders/${orderId}/settings`, {
      shipping_type: "MANUAL",
      manual_shipping_charge: 0,
    });
    assert.equal(preview.json.data.can_confirm, true);
    assert.equal(preview.json.data.invoice_shipping_lines.length, 0);
  });

  await t.test("TEST 20 same 5000 fee groups collapse to one invoice shipping line", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [
        { name: "묶음A", purchase: 1000, cartonQty: 6, defaultFee: 5000, sale: 2000 },
        { name: "묶음B", purchase: 1000, cartonQty: 6, defaultFee: 5000, sale: 2000 },
      ],
      aoa: [["상품명", "수량"], ["묶음A", 10], ["묶음B", 13]],
      columnMap: mapQty,
    });
    const preview = await api(port, "GET", `/api/orders/${orderId}/preview`);
    assert.equal(preview.json.data.invoice_shipping_lines.length, 1);
    assert.equal(preview.json.data.invoice_shipping_lines[0].quantity, 5);
    assert.equal(preview.json.data.invoice_shipping_lines[0].amount, 25000);
  });

  await t.test("TEST 21 5000 and 4000 shipping become 2 invoice lines", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [
        { name: "단가5천", purchase: 1000, cartonQty: 6, defaultFee: 5000, sale: 2000 },
        { name: "단가4천", purchase: 1000, cartonQty: 6, defaultFee: 4000, sale: 2000 },
      ],
      aoa: [["상품명", "수량"], ["단가5천", 6], ["단가4천", 6]],
      columnMap: mapQty,
    });
    const preview = await api(port, "GET", `/api/orders/${orderId}/preview`);
    assert.equal(preview.json.data.invoice_shipping_lines.length, 2);
  });

  await t.test("TEST 22 five products + two shipping lines = 7 confirm ok", async () => {
    const names = ["행제한A", "행제한B", "행제한C", "행제한D", "행제한E"];
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: names.map((name, idx) => ({
        name,
        purchase: 1000,
        cartonQty: 6,
        defaultFee: idx < 3 ? 5000 : 4000,
        sale: 2000,
      })),
      aoa: [["상품명", "수량"], ...names.map((name) => [name, 6])],
      columnMap: mapQty,
    });
    const preview = await api(port, "GET", `/api/orders/${orderId}/preview`);
    assert.equal(preview.json.data.totals.invoice_product_line_count, 5);
    assert.equal(preview.json.data.totals.invoice_shipping_line_count, 2);
    assert.equal(preview.json.data.totals.invoice_required_line_count, 7);
    const confirm = await api(port, "POST", `/api/orders/${orderId}/confirm`);
    assert.equal(confirm.status, 200, JSON.stringify(confirm.json));
  });

  await t.test("TEST 23 six products + two shipping lines can confirm", async () => {
    const names = ["초과A", "초과B", "초과C", "초과D", "초과E", "초과F"];
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: names.map((name, idx) => ({
        name,
        purchase: 1000,
        cartonQty: 6,
        defaultFee: idx < 4 ? 5000 : 4000,
        sale: 2000,
      })),
      aoa: [["상품명", "수량"], ...names.map((name) => [name, 6])],
      columnMap: mapQty,
    });
    const preview = await api(port, "GET", `/api/orders/${orderId}/preview`);
    assert.equal(preview.json.data.totals.invoice_required_line_count, 8);
    assert.equal(preview.json.data.can_confirm, true);
    assert.equal(
      preview.json.data.blocking_errors.some((item) => item.code === "INVOICE_ROW_LIMIT_EXCEEDED"),
      false,
    );
  });

  await t.test("TEST 24 snapshot insert failure rolls back to DRAFT", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "롤백상품", purchase: 1000, cartonQty: 6, defaultFee: 5000, sale: 2000 }],
      aoa: [["상품명", "수량"], ["롤백상품", 1]],
      columnMap: mapQty,
    });
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await ordersRepository.insertOrderItems(
        orderId,
        [
          {
            source_import_row_id: 999999999,
            product_id: 999999999,
            product_option_id: 999999999,
            product_code: "X",
            product_name: "X",
            option_name: null,
            quantity: 1,
            purchase_price: 1,
            sale_price: 1,
            price_source_id: null,
            carton_qty: 1,
            shipping_fee_per_carton: 0,
            shipping_fee_source: "PRODUCT_DEFAULT",
            product_sales_amount: 1,
            product_cost_amount: 1,
            product_margin_amount: 0,
            product_margin_rate: 0,
            external_order_number: null,
            recipient_name: null,
            phone: null,
            address: null,
            shipping_memo: null,
          },
        ],
        db,
      );
      assert.fail("insert should fail");
    } catch {
      await db.query("ROLLBACK");
    } finally {
      db.release();
    }
    const preview = await api(port, "GET", `/api/orders/${orderId}/preview`);
    assert.equal(preview.json.data.order.status, "DRAFT");
    const count = await ordersRepository.countOrderItems(orderId);
    assert.equal(count, 0);
  });

  await t.test("TEST 25 confirm writes items and shipping groups", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "확정스냅샷", purchase: 1000, cartonQty: 6, defaultFee: 5000, sale: 2000 }],
      aoa: [["상품명", "수량"], ["확정스냅샷", 10]],
      columnMap: mapQty,
    });
    const confirmed = await api(port, "POST", `/api/orders/${orderId}/confirm`);
    assert.equal(confirmed.status, 200);
    assert.ok(confirmed.json.data.items.length >= 1);
    assert.ok(confirmed.json.data.shipping_groups.length >= 1);
    const blockedSettings = await api(port, "PATCH", `/api/orders/${orderId}/settings`, { shipping_type: "FREE" });
    assert.equal(blockedSettings.status, 400);
  });

  await t.test("TEST 26 and 27 confirmed import cannot reparse or rematch", async () => {
    const parsed = await api(port, "POST", `/api/order-imports/${(await api(port, "GET", `/api/orders/${snapshotOrderId}/preview`)).json.data.order.order_import_id}/parse`);
    assert.equal(parsed.status, 400);
    assert.equal(parsed.json.error.code, "ORDER_CONFIRMED");
    const rows = await api(
      port,
      "GET",
      `/api/order-imports/${(await api(port, "GET", `/api/orders/${snapshotOrderId}/preview`)).json.data.order.order_import_id}/rows`,
    );
    const match = await api(
      port,
      "PATCH",
      `/api/order-imports/${rows.json.data.import.id}/rows/${rows.json.data.items[0].id}/match`,
      { product_option_id: snapshotProduct.product_option_id, save_alias: false },
    );
    assert.equal(match.status, 400);
    assert.equal(match.json.error.code, "ORDER_CONFIRMED");
  });

  await t.test("TEST 28 negative margin warns but does not block", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "역마진", purchase: 4000, cartonQty: 6, defaultFee: 0, sale: 3500 }],
      aoa: [["상품명", "수량"], ["역마진", 1]],
      columnMap: mapQty,
    });
    const preview = await api(port, "GET", `/api/orders/${orderId}/preview`);
    assert.equal(preview.json.data.product_totals[0].product_margin_amount, -500);
    assert.equal(preview.json.data.totals.negative_margin_count, 1);
    assert.equal(preview.json.data.can_confirm, true);
  });

  await t.test("TEST 29 real esser xls preview with test products", async () => {
    const names = ["v9치약", "롱롱그린백 m", "롱롱그린백 L", "영양맛밤"];
    const products = [];
    for (const name of names) {
      const product = await seedProduct(port, supplier.id, {
        product_name: name,
        purchase_price: 1000,
        carton_qty: 6,
        default_shipping_fee: 5000,
      });
      await setPrice(port, client.id, product.product_option_id, 2000, null);
      products.push(product);
    }
    const original = fs.readFileSync(realXlsPath);
    const up = await upload(port, client.id, original, "발주서 에쎄르 (36).xls");
    const parsed = await parseMapped(port, up.json.data.id, {
      external_product_name: "상품명",
      quantity: "수량",
      external_option_name: "옵션",
      recipient_name: "수령자이름",
      phone: "수령자휴대폰",
      address: "주소",
    });
    assert.equal(parsed.status, 200, JSON.stringify(parsed.json));
    for (const row of parsed.json.data.items) {
      if (row.match_status === "UNMATCHED") {
        const product = products.find((item) => item.product_name === row.external_product_name);
        assert.ok(product, `missing seeded product for ${row.external_product_name}`);
        const matched = await api(port, "PATCH", `/api/order-imports/${up.json.data.id}/rows/${row.id}/match`, {
          product_option_id: product.product_option_id,
          save_alias: false,
        });
        assert.equal(matched.status, 200, JSON.stringify(matched.json));
      }
    }
    const ready = await api(port, "GET", `/api/order-imports/${up.json.data.id}`);
    assert.equal(ready.json.data.status, "READY", JSON.stringify(ready.json.data));
    const draft = await api(port, "POST", `/api/order-imports/${up.json.data.id}/order`);
    created.orderIds.push(draft.json.data.id);
    const preview = await api(port, "GET", `/api/orders/${draft.json.data.id}/preview`);
    assert.equal(preview.status, 200);
    assert.equal(preview.json.data.totals.total_quantity, 630);
    assert.equal(preview.json.data.can_confirm, true);
    void products;
  });

  await t.test("TEST 30 phase 4 regression", async () => {
    const list = await api(port, "GET", "/api/order-imports");
    assert.equal(list.status, 200);
    const clients = await api(port, "GET", `/api/sales-clients/${client.id}/prices/current`);
    assert.equal(clients.status, 200);
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

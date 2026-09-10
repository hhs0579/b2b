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
import { groupIdentity } from "../src/domain/shipping-config.js";

const prefix = `SM${Date.now()}`;
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
    supplier_name: "혼합배송매입처",
  });
  created.supplierIds.push(result.json.data.id);
  return result.json.data;
}

async function seedClient(port, extra = {}) {
  const result = await api(port, "POST", "/api/sales-clients", {
    client_code: `${prefix}-CL-${created.clientIds.length + 1}`,
    client_name: extra.client_name || "혼합배송매출처",
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

async function setPrice(port, clientId, optionId, salePrice, override = null) {
  return api(port, "POST", `/api/sales-clients/${clientId}/prices`, {
    product_option_id: optionId,
    sale_price: salePrice,
    shipping_fee_override: override,
    effective_from: "2026-01-01",
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

async function makeReadyXlsx(port, { clientId, supplierId, products, aoa, columnMap }) {
  const nameMap = new Map(products.map((spec) => [spec.name, uniqueName(spec.name)]));
  for (const spec of products) {
    spec.name = nameMap.get(spec.name);
  }
  aoa = aoa.map((row) => row.map((cell) => nameMap.get(cell) ?? cell));
  const createdProducts = [];
  for (const spec of products) {
    const product = await seedProduct(port, supplierId, {
      product_name: spec.name,
      purchase_price: spec.purchase,
      carton_qty: spec.cartonQty,
      default_shipping_fee: spec.defaultFee,
      default_shipping_type: spec.defaultShippingType || "PARCEL",
    });
    await setPrice(port, clientId, product.product_option_id, spec.sale, spec.override === undefined ? null : spec.override);
    createdProducts.push({ ...product, spec });
  }
  const up = await upload(port, clientId, xlsxBuffer(aoa), `${prefix}.xlsx`);
  const parsed = await parseMapped(port, up.json.data.id, columnMap || { external_product_name: "상품명", quantity: "수량" });
  assert.equal(parsed.status, 200, JSON.stringify(parsed.json));
  assert.equal(parsed.json.data.status, "READY", JSON.stringify(parsed.json.data));
  const draft = await api(port, "POST", `/api/order-imports/${up.json.data.id}/order`);
  assert.ok(draft.status === 200 || draft.status === 201, JSON.stringify(draft.json));
  created.orderIds.push(draft.json.data.id);
  return { importId: up.json.data.id, orderId: draft.json.data.id, products: createdProducts };
}

async function confirm(port, orderId) {
  const preview = await api(port, "GET", `/api/orders/${orderId}/preview`);
  const confirmed = await api(port, "POST", `/api/orders/${orderId}/confirm`, {
    preview_signature: preview.json.data.calculation_signature,
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
  return confirmed.json.data;
}

test("mixed shipping groups, truck grouping, and invoice notes", async (t) => {
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

  await t.test("TEST 1 all PARCEL matches existing carton math", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "전체택배", purchase: 1000, cartonQty: 6, defaultFee: 5000, sale: 2000 }],
      aoa: [["상품명", "수량"], ["전체택배", 10]],
    });
    const preview = await api(port, "GET", `/api/orders/${orderId}/preview`);
    assert.equal(preview.json.data.shipping_groups[0].carton_count, 2);
    assert.equal(preview.json.data.totals.total_shipping_charge, 10000);
    assert.equal(preview.json.data.totals.parcel_shipping_charge, 10000);
    assert.equal(preview.json.data.totals.truck_shipping_charge, 0);
    assert.equal(preview.json.data.shipping_summary.is_mixed, false);
    assert.equal(preview.json.data.invoice_product_lines[0].note, "5,000원 × 2");
    assert.equal(preview.json.data.invoice_shipping_lines[0].note, "");
  });

  await t.test("TEST 2 all TRUCK charges truck only", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "전체용차", purchase: 1000, cartonQty: 6, defaultFee: 5000, sale: 2000 }],
      aoa: [["상품명", "수량"], ["전체용차", 10]],
    });
    const preview = await api(port, "PATCH", `/api/orders/${orderId}/settings`, {
      shipping_type: "TRUCK",
      manual_shipping_charge: 150000,
    });
    assert.equal(preview.json.data.totals.parcel_shipping_charge, 0);
    assert.equal(preview.json.data.totals.truck_shipping_charge, 150000);
    assert.equal(preview.json.data.totals.total_shipping_charge, 150000);
    assert.equal(preview.json.data.invoice_shipping_lines.length, 1);
    assert.equal(preview.json.data.invoice_shipping_lines[0].label, "용차비");
    assert.equal(preview.json.data.invoice_product_lines[0].note, "용차출고");
    assert.equal(preview.json.data.invoice_shipping_lines[0].note, "");
  });

  await t.test("TEST 3-8 mixed parcel+truck confirm, notes, memo default", async () => {
    const { orderId, products } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [
        { name: "영양맛밤", purchase: 500, cartonQty: 50, defaultFee: 4000, sale: 690 },
        { name: "올리브오일", purchase: 10000, cartonQty: 6, defaultFee: 5000, sale: 18000 },
      ],
      aoa: [["상품명", "수량"], ["영양맛밤", 150], ["올리브오일", 24]],
    });
    const oliveIdentity = groupIdentity("TOTAL", products[1].product_option_id);
    const preview = await api(port, "PATCH", `/api/orders/${orderId}/settings`, {
      shipping_type: "PARCEL",
      shipping_config: {
        overrides: {
          [oliveIdentity]: { shipping_type: "TRUCK", truck_group_key: "TRUCK-1", group_note: "용차출고" },
        },
        truck_groups: { "TRUCK-1": { label: "용차 1", manual_shipping_charge: 150000 } },
        splits: [],
      },
    });
    const data = preview.json.data;
    assert.equal(data.shipping_summary.is_mixed, true);
    assert.equal(data.shipping_summary.display_shipping_type, "혼합배송");
    assert.equal(data.shipping_summary.invoice_shipping_method, "택배 / 용차 혼합출고");
    assert.equal(data.totals.parcel_shipping_charge, 12000);
    assert.equal(data.totals.truck_shipping_charge, 150000);
    assert.equal(data.totals.total_shipping_charge, 162000);
    assert.equal(data.can_confirm, true);
    const parcelGroup = data.shipping_groups.find((row) => row.shipping_type === "PARCEL");
    const truckGroup = data.shipping_groups.find((row) => row.shipping_type === "TRUCK");
    assert.equal(parcelGroup.shipping_charge, 12000);
    assert.equal(truckGroup.shipping_charge, 0);
    assert.equal(truckGroup.group_note, "용차출고");
    const productNotes = data.invoice_product_lines.map((row) => [row.product_name.includes("올리브오일") ? "올리브오일" : row.product_name.includes("영양맛밤") ? "영양맛밤" : row.product_name, row.note]);
    assert.deepEqual(productNotes.find((row) => row[0] === "올리브오일"), ["올리브오일", "용차출고"]);
    assert.equal(data.invoice_product_lines.find((row) => row.product_name.includes("영양맛밤")).note, "4,000원 × 3");
    assert.equal(data.invoice_shipping_lines.find((row) => row.shipping_kind === "PARCEL").note, "");
    assert.equal(data.invoice_shipping_lines.find((row) => row.shipping_kind === "TRUCK").note, "");
    assert.equal(data.invoice_shipping_lines.find((row) => row.shipping_kind === "TRUCK").amount, 150000);

    const confirmed = await confirm(port, orderId);
    assert.equal(confirmed.totals.total_shipping_charge, 162000);
    assert.equal(confirmed.invoice_memo_defaults.shipping_method, "택배 / 용차 혼합출고");
  });

  await t.test("TEST 5 parcel fees aggregate by unit price only", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [
        { name: "사천", purchase: 1000, cartonQty: 1, defaultFee: 4000, sale: 2000 },
        { name: "오천", purchase: 1000, cartonQty: 1, defaultFee: 5000, sale: 2000 },
      ],
      aoa: [["상품명", "수량"], ["사천", 3], ["오천", 17]],
    });
    const preview = await api(port, "GET", `/api/orders/${orderId}/preview`);
    const lines = preview.json.data.invoice_shipping_lines;
    assert.equal(lines.length, 2);
    assert.equal(lines[0].label, "택배비-4,000원");
    assert.equal(lines[0].quantity, 3);
    assert.equal(lines[0].note, "");
    assert.equal(lines[1].label, "택배비-5,000원");
    assert.equal(lines[1].quantity, 17);
    assert.equal(lines[1].note, "");
    const productNotes = preview.json.data.invoice_product_lines.map((row) => row.note);
    assert.deepEqual(productNotes, ["4,000원 × 3", "5,000원 × 17"]);
  });

  await t.test("TEST 5 same product same fee across addresses merges cartons", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "합산맛밤", purchase: 500, cartonQty: 50, defaultFee: 4000, sale: 690 }],
      aoa: [
        ["상품명", "수량", "주소"],
        ["합산맛밤", 50, "서울 A"],
        ["합산맛밤", 100, "서울 B"],
      ],
      columnMap: { external_product_name: "상품명", quantity: "수량", address: "주소" },
    });
    const preview = await api(port, "PATCH", `/api/orders/${orderId}/settings`, {
      shipping_calculation_mode: "PER_ADDRESS",
    });
    assert.equal(preview.json.data.shipping_groups.length, 2);
    const productLines = preview.json.data.invoice_product_lines.filter((row) => row.product_name.includes("합산맛밤"));
    assert.equal(productLines.length, 1);
    assert.equal(productLines[0].quantity, 150);
    assert.equal(productLines[0].note, "4,000원 × 3");
  });

  await t.test("TEST 9 TRUCK null blocks confirm", async () => {
    const { orderId, products } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "용차미입력", purchase: 1000, cartonQty: 1, defaultFee: 0, sale: 2000 }],
      aoa: [["상품명", "수량"], ["용차미입력", 1]],
    });
    const identity = groupIdentity("TOTAL", products[0].product_option_id);
    const preview = await api(port, "PATCH", `/api/orders/${orderId}/settings`, {
      shipping_config: {
        overrides: { [identity]: { shipping_type: "TRUCK", truck_group_key: "TRUCK-1" } },
        truck_groups: { "TRUCK-1": { label: "용차 1", manual_shipping_charge: null } },
        splits: [],
      },
    });
    assert.equal(preview.json.data.can_confirm, false);
    const blocked = await api(port, "POST", `/api/orders/${orderId}/confirm`);
    assert.equal(blocked.status, 400);
    assert.equal(blocked.json.error.code, "MANUAL_SHIPPING_CHARGE_REQUIRED");
  });

  await t.test("TEST 10 TRUCK 0 is valid", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "용차0원", purchase: 1000, cartonQty: 1, defaultFee: 5000, sale: 2000 }],
      aoa: [["상품명", "수량"], ["용차0원", 1]],
    });
    const preview = await api(port, "PATCH", `/api/orders/${orderId}/settings`, {
      shipping_type: "TRUCK",
      manual_shipping_charge: 0,
    });
    assert.equal(preview.json.data.can_confirm, true);
    assert.equal(preview.json.data.totals.total_shipping_charge, 0);
    await confirm(port, orderId);
  });

  await t.test("TEST 11 same product parcel+truck splits invoice rows", async () => {
    const { orderId, products } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "혼합맛밤", purchase: 500, cartonQty: 50, defaultFee: 4000, sale: 690 }],
      aoa: [["상품명", "수량"], ["혼합맛밤", 150]],
    });
    const identity = groupIdentity("TOTAL", products[0].product_option_id);
    const preview = await api(port, "PATCH", `/api/orders/${orderId}/settings`, {
      shipping_config: {
        overrides: {},
        splits: [
          {
            id: "s1",
            base_key: identity,
            quantity: 50,
            shipping_type: "TRUCK",
            truck_group_key: "TRUCK-1",
            group_note: "용차출고",
          },
        ],
        truck_groups: { "TRUCK-1": { label: "용차 1", manual_shipping_charge: 150000 } },
      },
    });
    const lines = preview.json.data.invoice_product_lines.filter((row) => row.product_name.includes("혼합맛밤"));
    assert.equal(lines.length, 2);
    const parcelLine = lines.find((row) => row.shipping_type === "PARCEL");
    const truckLine = lines.find((row) => row.shipping_type === "TRUCK");
    assert.equal(parcelLine.quantity, 100);
    assert.equal(parcelLine.note, "4,000원 × 2");
    assert.equal(truckLine.quantity, 50);
    assert.equal(truckLine.note, "용차출고");
    assert.equal(preview.json.data.totals.parcel_shipping_charge, 8000);
    assert.equal(preview.json.data.totals.truck_shipping_charge, 150000);
    await confirm(port, orderId);
  });

  await t.test("TEST 12 three products share one truck charge", async () => {
    const { orderId, products } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [
        { name: "용차A", purchase: 1000, cartonQty: 1, defaultFee: 5000, sale: 2000 },
        { name: "용차B", purchase: 1000, cartonQty: 1, defaultFee: 5000, sale: 2000 },
        { name: "용차C", purchase: 1000, cartonQty: 1, defaultFee: 5000, sale: 2000 },
      ],
      aoa: [["상품명", "수량"], ["용차A", 1], ["용차B", 1], ["용차C", 1]],
    });
    const overrides = Object.fromEntries(
      products.map((product) => [
        groupIdentity("TOTAL", product.product_option_id),
        { shipping_type: "TRUCK", truck_group_key: "TRUCK-1", group_note: "용차출고" },
      ]),
    );
    const preview = await api(port, "PATCH", `/api/orders/${orderId}/settings`, {
      shipping_config: {
        overrides,
        splits: [],
        truck_groups: { "TRUCK-1": { label: "용차 1", manual_shipping_charge: 150000 } },
      },
    });
    assert.equal(preview.json.data.totals.truck_shipping_charge, 150000);
    assert.equal(preview.json.data.totals.parcel_shipping_charge, 0);
    assert.equal(preview.json.data.totals.total_shipping_charge, 150000);
    assert.equal(preview.json.data.invoice_shipping_lines.filter((row) => row.shipping_kind === "TRUCK").length, 1);
  });

  await t.test("TEST 13 two truck groups sum to 270000", async () => {
    const { orderId, products } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [
        { name: "용차1상품", purchase: 1000, cartonQty: 1, defaultFee: 4000, sale: 2000 },
        { name: "용차2상품", purchase: 1000, cartonQty: 1, defaultFee: 5000, sale: 2000 },
      ],
      aoa: [["상품명", "수량"], ["용차1상품", 1], ["용차2상품", 1]],
    });
    const preview = await api(port, "PATCH", `/api/orders/${orderId}/settings`, {
      shipping_config: {
        overrides: {
          [groupIdentity("TOTAL", products[0].product_option_id)]: {
            shipping_type: "TRUCK",
            truck_group_key: "TRUCK-1",
          },
          [groupIdentity("TOTAL", products[1].product_option_id)]: {
            shipping_type: "TRUCK",
            truck_group_key: "TRUCK-2",
          },
        },
        splits: [],
        truck_groups: {
          "TRUCK-1": { label: "용차 1", manual_shipping_charge: 150000 },
          "TRUCK-2": { label: "용차 2", manual_shipping_charge: 120000 },
        },
      },
    });
    assert.equal(preview.json.data.totals.truck_shipping_charge, 270000);
    assert.equal(preview.json.data.invoice_shipping_lines[0].amount, 270000);
    assert.equal(preview.json.data.invoice_shipping_lines[0].note, "");
  });

  await t.test("TEST 14 new order starts from client default", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "다음발주", purchase: 1000, cartonQty: 1, defaultFee: 5000, sale: 2000 }],
      aoa: [["상품명", "수량"], ["다음발주", 1]],
    });
    const preview = await api(port, "GET", `/api/orders/${orderId}/preview`);
    assert.equal(preview.json.data.settings.shipping_type, "PARCEL");
    assert.equal(preview.json.data.settings.has_group_overrides, false);
    assert.equal(preview.json.data.totals.total_shipping_charge, 5000);
  });

  await t.test("TEST 15 confirmed snapshot stays frozen", async () => {
    const { orderId } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "확정불변", purchase: 1000, cartonQty: 6, defaultFee: 5000, sale: 2000 }],
      aoa: [["상품명", "수량"], ["확정불변", 10]],
    });
    const confirmed = await confirm(port, orderId);
    const charge = confirmed.totals.total_shipping_charge;
    const groups = await pool.query("SELECT shipping_charge, shipping_type FROM order_shipping_groups WHERE order_id = $1", [
      orderId,
    ]);
    const blocked = await api(port, "PATCH", `/api/orders/${orderId}/settings`, { shipping_type: "TRUCK" });
    assert.equal(blocked.status, 400);
    const again = await api(port, "GET", `/api/orders/${orderId}/preview`);
    assert.equal(again.json.data.totals.total_shipping_charge, charge);
    assert.equal(again.json.data.totals.total_shipping_charge, 10000);
    assert.equal(Number(groups.rows[0].shipping_charge), 10000);
  });

  await t.test("TEST 16-17 generated invoice has truck note and both shipping rows", async () => {
    const { orderId, products } = await makeReadyXlsx(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [
        { name: "명세택배", purchase: 1000, cartonQty: 1, defaultFee: 5000, sale: 2000 },
        { name: "명세용차", purchase: 1000, cartonQty: 1, defaultFee: 4000, sale: 2000 },
      ],
      aoa: [["상품명", "수량"], ["명세택배", 1], ["명세용차", 1]],
    });
    await api(port, "PATCH", `/api/orders/${orderId}/settings`, {
      shipping_config: {
        overrides: {
          [groupIdentity("TOTAL", products[1].product_option_id)]: {
            shipping_type: "TRUCK",
            truck_group_key: "TRUCK-1",
            group_note: "용차출고",
          },
        },
        splits: [],
        truck_groups: { "TRUCK-1": { label: "용차 1", manual_shipping_charge: 150000 } },
      },
    });
    await confirm(port, orderId);
    const generated = await api(port, "POST", `/api/orders/${orderId}/invoices`);
    assert.equal(generated.status, 201, JSON.stringify(generated.json));
    if (generated.json.data.document.stored_file_name) {
      created.invoiceFiles.push(generated.json.data.document.stored_file_name);
    }
    const file = await api(port, "GET", `/api/orders/${orderId}/invoices/${generated.json.data.document.id}/download`);
    const inspect = await inspectInvoiceWorkbook(file.buffer);
    const names = [inspect.cells.C10?.value, inspect.cells.C11?.value, inspect.cells.C12?.value, inspect.cells.C13?.value].map((value) => String(value || ""));
    assert.ok(names.some((value) => value.includes("명세용차")));
    assert.ok(names.some((value) => value.includes("택배비-5,000원")));
    assert.ok(names.some((value) => value.includes("용차비")));
    const truckProductRow = names.findIndex((value) => value.includes("명세용차"));
    const noteRefs = ["N10", "N11", "N12", "N13"];
    assert.equal(inspect.cells[noteRefs[truckProductRow]]?.value, "용차출고");
    const parcelProductRow = names.findIndex((value) => value.includes("명세택배"));
    assert.equal(inspect.cells[noteRefs[parcelProductRow]]?.value, "5,000원 × 1");
    const parcelRow = names.findIndex((value) => value.includes("택배비-5,000원"));
    assert.equal(inspect.cells[noteRefs[parcelRow]]?.value ?? "", "");
    const truckFeeRow = names.findIndex((value) => value.includes("용차비"));
    assert.equal(inspect.cells[noteRefs[truckFeeRow]]?.value ?? "", "");
    assert.equal(Number(inspect.cells[`I${10 + truckFeeRow}`]?.value), 150000);
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
      const filePath = resolveInvoiceStoredPath(name);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  } finally {
    await pool.end();
  }
});

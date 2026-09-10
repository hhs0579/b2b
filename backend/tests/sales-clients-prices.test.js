import assert from "node:assert/strict";
import { after, test } from "node:test";
import { estimateProductMargin } from "../src/domain/margin.js";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { deleteProductsByIds, mapCreatedProduct } from "./helpers/product.js";

const prefix = `P3${Date.now()}`;
const owned = {
  clientIds: [],
  productIds: [],
  supplierIds: [],
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

test("phase 3 sales clients and prices", async (t) => {
  const { server, port } = await startServer();
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  );

  let client;
  let supplier;
  let product;
  let bulkProducts = [];

  await t.test("TEST 1 create sales client", async () => {
    const result = await api(port, "POST", "/api/sales-clients", {
      client_code: `${prefix}-CLIENT001`,
      client_name: "아람유통",
      shipping_calculation_mode: "TOTAL_QUANTITY",
      settlement_type: "POSTPAID",
      default_shipping_type: "PARCEL",
    });
    assert.equal(result.status, 201);
    client = result.json.data;
    owned.clientIds.push(client.id);
    assert.equal(client.client_name, "아람유통");
  });

  await t.test("TEST 2 duplicate client_code returns 409", async () => {
    const result = await api(port, "POST", "/api/sales-clients", {
      client_code: `${prefix}-CLIENT001`,
      client_name: "다른이름",
    });
    assert.equal(result.status, 409);
    assert.equal(result.json.error.code, "CLIENT_CODE_DUPLICATED");
  });

  await t.test("TEST 3 update sales client", async () => {
    const result = await api(port, "PATCH", `/api/sales-clients/${client.id}`, {
      manager_name: "아람담당",
    });
    assert.equal(result.status, 200);
    assert.equal(result.json.data.manager_name, "아람담당");
    client = result.json.data;
  });

  await t.test("TEST 4 deactivate keeps row", async () => {
    const off = await api(port, "PATCH", `/api/sales-clients/${client.id}/status`, {
      is_active: false,
    });
    assert.equal(off.json.data.is_active, false);
    const got = await api(port, "GET", `/api/sales-clients/${client.id}`);
    assert.equal(got.status, 200);
    assert.equal(got.json.data.id, client.id);
    const on = await api(port, "PATCH", `/api/sales-clients/${client.id}/status`, {
      is_active: true,
    });
    client = on.json.data;
    assert.equal(client.is_active, true);
  });

  await t.test("prepare TEST001 product at cost 2500", async () => {
    const createdSupplier = await api(port, "POST", "/api/suppliers", {
      supplier_code: `${prefix}-SUP`,
      supplier_name: "테스트매입처",
    });
    assert.equal(createdSupplier.status, 201, JSON.stringify(createdSupplier.json));
    supplier = createdSupplier.json.data;
    owned.supplierIds.push(supplier.id);

    const createdProduct = await api(port, "POST", "/api/products", {
      product_code: `${prefix}-TEST001`,
      product_name: "테스트 상품",
      option_name: "아이보리",
      purchase_price: 2500,
      vat_type: "INCLUDED",
      carton_qty: 6,
      default_shipping_fee: 5000,
      default_shipping_type: "PARCEL",
      supplier_id: supplier.id,
    });
    assert.equal(createdProduct.status, 201, JSON.stringify(createdProduct.json));
    product = mapCreatedProduct(createdProduct.json.data);
    owned.productIds.push(product.id);
    assert.equal(product.purchase_price, 2500);
  });

  await t.test("TEST 5 register price 3500 from 2026-09-01", async () => {
    const result = await api(port, "POST", `/api/sales-clients/${client.id}/prices`, {
      product_option_id: product.product_option_id,
      sale_price: 3500,
      shipping_fee_override: null,
      effective_from: "2026-09-01",
    });
    assert.equal(result.status, 201);
    assert.equal(result.json.data.sale_price, 3500);
    assert.equal(result.json.data.effective_from, "2026-09-01");
    assert.equal(result.json.data.effective_to, null);
    assert.equal(result.json.data.shipping_fee_override, null);
  });

  await t.test("TEST 6 effective 2026-09-04 is 3500", async () => {
    const result = await api(
      port,
      "GET",
      `/api/sales-clients/${client.id}/prices/effective?date=2026-09-04`,
    );
    assert.equal(result.status, 200);
    const found = result.json.data.items.find((item) => item.product_id === product.id);
    assert.equal(found.sale_price, 3500);
  });

  await t.test("TEST 7 change price from 2026-10-01 to 3800", async () => {
    const result = await api(port, "POST", `/api/sales-clients/${client.id}/prices`, {
      product_option_id: product.product_option_id,
      sale_price: 3800,
      effective_from: "2026-10-01",
    });
    assert.equal(result.status, 201);
    assert.equal(result.json.data.sale_price, 3800);
    assert.equal(result.json.data.effective_from, "2026-10-01");
    assert.equal(result.json.data.effective_to, null);

    const history = await api(port, "GET", `/api/sales-clients/${client.id}/prices`);
    const rows = history.json.data.items.filter((item) => item.product_id === product.id);
    const oldRow = rows.find((row) => row.sale_price === 3500);
    const newRow = rows.find((row) => row.sale_price === 3800);
    assert.equal(oldRow.effective_from, "2026-09-01");
    assert.equal(oldRow.effective_to, "2026-09-30");
    assert.equal(newRow.effective_from, "2026-10-01");
    assert.equal(newRow.effective_to, null);
  });

  await t.test("TEST 8 effective 2026-09-15 is 3500", async () => {
    const result = await api(
      port,
      "GET",
      `/api/sales-clients/${client.id}/prices/effective?date=2026-09-15`,
    );
    const found = result.json.data.items.find((item) => item.product_id === product.id);
    assert.equal(found.sale_price, 3500);
  });

  await t.test("TEST 9 effective 2026-10-05 is 3800", async () => {
    const result = await api(
      port,
      "GET",
      `/api/sales-clients/${client.id}/prices/effective?date=2026-10-05`,
    );
    const found = result.json.data.items.find((item) => item.product_id === product.id);
    assert.equal(found.sale_price, 3800);
  });

  await t.test("TEST 10 overlapping period is rejected", async () => {
    const result = await api(port, "POST", `/api/sales-clients/${client.id}/prices`, {
      product_option_id: product.product_option_id,
      sale_price: 3600,
      effective_from: "2026-09-15",
    });
    assert.equal(result.status, 409);
    assert.equal(result.json.error.code, "PRICE_PERIOD_OVERLAP");
  });

  await t.test("TEST 11 sale_price -1 is rejected", async () => {
    const result = await api(port, "POST", `/api/sales-clients/${client.id}/prices`, {
      product_option_id: product.product_option_id,
      sale_price: -1,
      effective_from: "2026-11-01",
    });
    assert.equal(result.status, 400);
    assert.equal(result.json.error.code, "INVALID_SALE_PRICE");
  });

  await t.test("TEST 12 and 13 shipping override null vs 0", async () => {
    const nullOverride = await api(port, "GET", `/api/sales-clients/${client.id}/products?date=2026-10-05`);
    const current = nullOverride.json.data.items.find((item) => item.product_id === product.id);
    assert.equal(current.current_shipping_fee_override, null);
    assert.equal(current.default_shipping_fee, 5000);

    const zero = await api(port, "POST", `/api/sales-clients/${client.id}/prices`, {
      product_option_id: product.product_option_id,
      sale_price: 3800,
      shipping_fee_override: 0,
      effective_from: "2026-10-01",
    });
    assert.equal(zero.status, 201);
    assert.equal(zero.json.data.shipping_fee_override, 0);
    assert.notEqual(zero.json.data.shipping_fee_override, null);
  });

  await t.test("TEST 14 estimated margin", async () => {
    const catalog = await api(port, "GET", `/api/sales-clients/${client.id}/products?date=2026-09-15`);
    const row = catalog.json.data.items.find((item) => item.product_id === product.id);
    assert.equal(row.purchase_price, 2500);
    assert.equal(row.current_sale_price, 3500);
    assert.equal(row.estimated_margin, 1000);
    assert.equal(row.estimated_margin_rate, 28.57);
    const direct = estimateProductMargin(3500, 2500);
    assert.equal(direct.estimated_margin, 1000);
    assert.equal(direct.estimated_margin_rate, 28.57);
  });

  await t.test("TEST 15 bulk save 3 products", async () => {
    for (let i = 1; i <= 3; i += 1) {
      const created = await api(port, "POST", "/api/products", {
        product_code: `${prefix}-B${i}`,
        product_name: `벌크상품${i}`,
        purchase_price: 1000 * i,
        vat_type: "INCLUDED",
        carton_qty: 6,
        default_shipping_fee: 5000,
        default_shipping_type: "PARCEL",
        supplier_id: supplier.id,
      });
      assert.equal(created.status, 201);
      owned.productIds.push(created.json.data.id);
      bulkProducts.push(mapCreatedProduct(created.json.data));
    }

    const bulk = await api(port, "PUT", `/api/sales-clients/${client.id}/prices/bulk`, {
      effective_from: "2026-09-04",
      items: bulkProducts.map((item, index) => ({
        product_option_id: item.product_option_id,
        sale_price: 1500 * (index + 1),
        shipping_fee_override: null,
      })),
    });
    assert.equal(bulk.status, 200);
    assert.equal(bulk.json.data.items.length, 3);
  });

  await t.test("TEST 16 bulk rollback on invalid item", async () => {
    const before = await api(
      port,
      "GET",
      `/api/sales-clients/${client.id}/prices/effective?date=2026-09-04`,
    );
    const beforeA = before.json.data.items.find((item) => item.product_id === bulkProducts[0].id);
    assert.equal(beforeA.sale_price, 1500);

    const failed = await api(port, "PUT", `/api/sales-clients/${client.id}/prices/bulk`, {
      effective_from: "2026-09-04",
      items: [
        { product_option_id: bulkProducts[0].product_option_id, sale_price: 9999, shipping_fee_override: null },
        { product_option_id: bulkProducts[1].product_option_id, sale_price: -1, shipping_fee_override: null },
        { product_option_id: bulkProducts[2].product_option_id, sale_price: 8888, shipping_fee_override: null },
      ],
    });
    assert.equal(failed.status, 400);

    const after = await api(
      port,
      "GET",
      `/api/sales-clients/${client.id}/prices/effective?date=2026-09-04`,
    );
    const afterA = after.json.data.items.find((item) => item.product_id === bulkProducts[0].id);
    assert.equal(afterA.sale_price, 1500);
  });

  await t.test("TEST 17 past price rows remain", async () => {
    const history = await api(port, "GET", `/api/sales-clients/${client.id}/prices`);
    const rows = history.json.data.items.filter((item) => item.product_id === product.id);
    assert.ok(rows.some((row) => row.sale_price === 3500 && row.effective_to === "2026-09-30"));
    assert.ok(rows.some((row) => row.sale_price === 3800));
  });

  await t.test("TEST 18 inactive client cannot add prices", async () => {
    await api(port, "PATCH", `/api/sales-clients/${client.id}/status`, { is_active: false });
    const result = await api(port, "POST", `/api/sales-clients/${client.id}/prices`, {
      product_option_id: product.product_option_id,
      sale_price: 4000,
      effective_from: "2026-12-01",
    });
    assert.equal(result.status, 400);
    assert.equal(result.json.error.code, "CLIENT_INACTIVE");
    const detail = await api(port, "GET", `/api/sales-clients/${client.id}`);
    assert.equal(detail.status, 200);
    assert.ok(Array.isArray((await api(port, "GET", `/api/sales-clients/${client.id}/prices`)).json.data.items));
  });

  await t.test("TEST 20 suppliers/products regression", async () => {
    const suppliers = await api(port, "GET", "/api/suppliers");
    assert.equal(suppliers.status, 200);
    assert.ok(Array.isArray(suppliers.json.data.items));
    const products = await api(port, "GET", "/api/products");
    assert.equal(products.status, 200);
    assert.ok(Array.isArray(products.json.data.items));
    const health = await api(port, "GET", "/api/health");
    assert.equal(health.json.ok, true);
    assert.equal(health.json.database, "connected");
  });
});

after(async () => {
  try {
    if (owned.clientIds.length) {
      await pool.query("DELETE FROM client_product_prices WHERE client_id = ANY($1::bigint[])", [owned.clientIds]);
      await pool.query("DELETE FROM excel_mappings WHERE client_id = ANY($1::bigint[])", [owned.clientIds]);
      await pool.query("DELETE FROM product_aliases WHERE client_id = ANY($1::bigint[])", [owned.clientIds]);
      await pool.query("DELETE FROM sales_clients WHERE id = ANY($1::bigint[])", [owned.clientIds]);
    }
    if (owned.productIds.length) {
      await deleteProductsByIds(pool, owned.productIds);
    }
    if (owned.supplierIds.length) {
      await pool.query("DELETE FROM suppliers WHERE id = ANY($1::bigint[])", [owned.supplierIds]);
    }
  } finally {
    await pool.end();
  }
});

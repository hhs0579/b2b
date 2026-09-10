import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { deleteProductsByIds, mapCreatedProduct } from "./helpers/product.js";

const prefix = `P2${Date.now()}`;

async function startServer() {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const { port } = server.address();
  return { server, port };
}

async function api(port, method, path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  return { status: response.status, json };
}

test("phase 2 suppliers and products", async (t) => {
  const { server, port } = await startServer();
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  );

  let supplier;
  let product;

  await t.test("TEST 1 create supplier", async () => {
    const result = await api(port, "POST", "/api/suppliers", {
      supplier_code: `${prefix}-SUP001`,
      supplier_name: "테스트매입처",
      business_number: "123-45-67890",
      manager_name: "홍길동",
      phone: "010-0000-0000",
      email: "test@example.com",
    });
    assert.equal(result.status, 201);
    assert.equal(result.json.ok, true);
    supplier = result.json.data;
    assert.equal(supplier.supplier_code, `${prefix}-SUP001`);
    assert.equal(supplier.is_active, true);
  });

  await t.test("TEST 2 duplicate supplier_code returns 409", async () => {
    const result = await api(port, "POST", "/api/suppliers", {
      supplier_code: `${prefix}-SUP001`,
      supplier_name: "다른이름",
    });
    assert.equal(result.status, 409);
    assert.equal(result.json.ok, false);
    assert.equal(result.json.error.code, "SUPPLIER_CODE_DUPLICATED");
  });

  await t.test("TEST 3 update supplier", async () => {
    const result = await api(port, "PATCH", `/api/suppliers/${supplier.id}`, {
      manager_name: "김담당",
      phone: "02-000-0000",
    });
    assert.equal(result.status, 200);
    assert.equal(result.json.data.manager_name, "김담당");
    assert.ok(new Date(result.json.data.updated_at) >= new Date(supplier.updated_at));
    supplier = result.json.data;
  });

  await t.test("TEST 4 deactivate supplier does not delete row", async () => {
    const deactivated = await api(port, "PATCH", `/api/suppliers/${supplier.id}/status`, {
      is_active: false,
    });
    assert.equal(deactivated.status, 200);
    assert.equal(deactivated.json.data.is_active, false);

    const fetched = await api(port, "GET", `/api/suppliers/${supplier.id}`);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.json.data.id, supplier.id);
    assert.equal(fetched.json.data.is_active, false);

    const reactivated = await api(port, "PATCH", `/api/suppliers/${supplier.id}/status`, {
      is_active: true,
    });
    assert.equal(reactivated.json.data.is_active, true);
    supplier = reactivated.json.data;
  });

  await t.test("TEST 5 create product", async () => {
    const result = await api(port, "POST", "/api/products", {
      product_code: `${prefix}-TEST001`,
      product_name: "테스트 상품",
      option_name: "아이보리",
      purchase_price: 2400,
      vat_type: "INCLUDED",
      carton_qty: 6,
      default_shipping_fee: 5000,
      default_shipping_type: "PARCEL",
      supplier_id: supplier.id,
    });
    assert.equal(result.status, 201);
    assert.equal(result.json.ok, true);
    product = mapCreatedProduct(result.json.data);
    assert.equal(product.id, result.json.data.id);
    assert.ok(product.product_option_id);
    assert.equal(product.options.length, 1);
    assert.equal(product.product_code, `${prefix}-TEST001`);
    assert.equal(product.product_name, "테스트 상품");
    assert.equal(product.option_name, "아이보리");
    assert.equal(product.purchase_price, 2400);
    assert.equal(product.carton_qty, 6);
    assert.equal(product.default_shipping_fee, 5000);
    assert.equal(product.default_shipping_type, "PARCEL");
    assert.equal(product.supplier_id, supplier.id);
    assert.equal(product.options[0].product_code, `${prefix}-TEST001`);
    assert.equal(product.options[0].option_name, "아이보리");
  });

  await t.test("TEST 6 duplicate product_code returns 409", async () => {
    const result = await api(port, "POST", "/api/products", {
      product_code: `${prefix}-TEST001`,
      product_name: "테스트 상품",
      purchase_price: 2400,
      vat_type: "INCLUDED",
      carton_qty: 6,
      default_shipping_fee: 5000,
      default_shipping_type: "PARCEL",
      supplier_id: supplier.id,
    });
    assert.equal(result.status, 409);
    assert.equal(result.json.error.code, "PRODUCT_CODE_DUPLICATED");
  });

  await t.test("TEST 7 missing supplier_id is rejected", async () => {
    const result = await api(port, "POST", "/api/products", {
      product_code: `${prefix}-NOSUP`,
      product_name: "테스트 상품",
      purchase_price: 2400,
      vat_type: "INCLUDED",
      carton_qty: 6,
      default_shipping_fee: 5000,
      default_shipping_type: "PARCEL",
      supplier_id: 999999999,
    });
    assert.equal(result.status, 400);
    assert.equal(result.json.error.code, "SUPPLIER_NOT_FOUND");
  });

  await t.test("TEST 8 negative purchase_price is rejected", async () => {
    const result = await api(port, "POST", "/api/products", {
      product_code: `${prefix}-NEG`,
      product_name: "테스트 상품",
      purchase_price: -1,
      vat_type: "INCLUDED",
      carton_qty: 6,
      default_shipping_fee: 5000,
      default_shipping_type: "PARCEL",
      supplier_id: supplier.id,
    });
    assert.equal(result.status, 400);
    assert.equal(result.json.error.code, "INVALID_PURCHASE_PRICE");
  });

  await t.test("TEST 9 carton_qty 0 is rejected", async () => {
    const result = await api(port, "POST", "/api/products", {
      product_code: `${prefix}-CARTON0`,
      product_name: "테스트 상품",
      purchase_price: 2400,
      vat_type: "INCLUDED",
      carton_qty: 0,
      default_shipping_fee: 5000,
      default_shipping_type: "PARCEL",
      supplier_id: supplier.id,
    });
    assert.equal(result.status, 400);
    assert.equal(result.json.error.code, "INVALID_CARTON_QTY");
  });

  await t.test("TEST 10 negative shipping fee is rejected", async () => {
    const result = await api(port, "POST", "/api/products", {
      product_code: `${prefix}-FEE`,
      product_name: "테스트 상품",
      purchase_price: 2400,
      vat_type: "INCLUDED",
      carton_qty: 6,
      default_shipping_fee: -1,
      default_shipping_type: "PARCEL",
      supplier_id: supplier.id,
    });
    assert.equal(result.status, 400);
    assert.equal(result.json.error.code, "INVALID_SHIPPING_FEE");
  });

  await t.test("TEST 11 product search", async () => {
    const result = await api(
      port,
      "GET",
      `/api/products?search=${encodeURIComponent("테스트 상품")}`,
    );
    assert.equal(result.status, 200);
    assert.ok(result.json.data.items.some((item) => item.id === product.id));
  });

  await t.test("TEST 12 supplier filter", async () => {
    const matched = await api(port, "GET", `/api/products?supplier_id=${supplier.id}`);
    assert.equal(matched.status, 200);
    assert.ok(matched.json.data.items.some((item) => item.id === product.id));

    const other = await api(port, "GET", "/api/products?supplier_id=999999999");
    assert.equal(other.json.data.items.length, 0);
  });

  await t.test("TEST 13 deactivate product does not delete row", async () => {
    const deactivated = await api(port, "PATCH", `/api/products/${product.id}/status`, {
      is_active: false,
    });
    assert.equal(deactivated.status, 200);
    assert.equal(deactivated.json.data.is_active, false);

    const fetched = await api(port, "GET", `/api/products/${product.id}`);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.json.data.id, product.id);
    assert.equal(fetched.json.data.is_active, false);

    const reactivated = await api(port, "PATCH", `/api/products/${product.id}/status`, {
      is_active: true,
    });
    assert.equal(reactivated.json.data.is_active, true);
  });

  await t.test("TEST 14 cost change writes history", async () => {
    const updated = await api(port, "PATCH", `/api/products/${product.id}`, {
      purchase_price: 2500,
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.data.options[0].purchase_price, 2500);

    const history = await api(port, "GET", `/api/products/${product.id}/cost-history`);
    assert.equal(history.status, 200);
    assert.equal(history.json.data.length, 1);
    assert.equal(history.json.data[0].old_price, 2400);
    assert.equal(history.json.data[0].new_price, 2500);
  });

  await t.test("TEST 15 name-only update does not write cost history", async () => {
    const updated = await api(port, "PATCH", `/api/products/${product.id}`, {
      product_name: "테스트 상품 수정",
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.data.product_name, "테스트 상품 수정");
    assert.equal(updated.json.data.options[0].purchase_price, 2500);

    const history = await api(port, "GET", `/api/products/${product.id}/cost-history`);
    assert.equal(history.json.data.length, 1);
  });

  await t.test("TEST 16 named options and nameless default option", async () => {
    const named = await api(port, "POST", "/api/products", {
      product_name: `${prefix}-롱롱그린백`,
      supplier_id: supplier.id,
      options: [
        {
          option_name: "블랙",
          product_code: `${prefix}-LL-BLACK`,
          purchase_price: 1000,
          vat_type: "INCLUDED",
          carton_qty: 6,
          default_shipping_fee: 3000,
          default_shipping_type: "PARCEL",
        },
        {
          option_name: "아이보리",
          product_code: `${prefix}-LL-IVORY`,
          purchase_price: 1100,
          vat_type: "INCLUDED",
          carton_qty: 10,
          default_shipping_fee: 5000,
          default_shipping_type: "PARCEL",
        },
      ],
    });
    assert.equal(named.status, 201, JSON.stringify(named.json));
    assert.equal(named.json.data.options.length, 2);
    const black = named.json.data.options.find((item) => item.option_name === "블랙");
    const ivory = named.json.data.options.find((item) => item.option_name === "아이보리");
    assert.ok(black);
    assert.ok(ivory);
    assert.equal(black.product_id, named.json.data.id);
    assert.equal(ivory.product_id, named.json.data.id);
    assert.equal(black.purchase_price, 1000);
    assert.equal(ivory.purchase_price, 1100);
    assert.equal(black.carton_qty, 6);
    assert.equal(ivory.carton_qty, 10);
    assert.notEqual(black.id, ivory.id);

    const duplicateName = await api(port, "POST", `/api/products/${named.json.data.id}/options`, {
      option_name: "블랙",
      purchase_price: 1200,
      vat_type: "INCLUDED",
      carton_qty: 6,
      default_shipping_fee: 0,
      default_shipping_type: "PARCEL",
    });
    assert.equal(duplicateName.status, 409);
    assert.equal(duplicateName.json.error.code, "PRODUCT_OPTION_DUPLICATED");

    const lastDelete = await api(
      port,
      "DELETE",
      `/api/products/${named.json.data.id}/options/${named.json.data.options[0].id}`,
    );
    assert.equal(lastDelete.status, 200);
    const lastOnly = await api(
      port,
      "DELETE",
      `/api/products/${named.json.data.id}/options/${named.json.data.options[1].id}`,
    );
    assert.equal(lastOnly.status, 409);
    assert.equal(lastOnly.json.error.code, "LAST_OPTION_REQUIRED");

    const nameless = await api(port, "POST", "/api/products", {
      product_name: `${prefix}-단일상품`,
      supplier_id: supplier.id,
      purchase_price: 800,
      vat_type: "INCLUDED",
      carton_qty: 1,
      default_shipping_fee: 0,
      default_shipping_type: "PARCEL",
    });
    assert.equal(nameless.status, 201, JSON.stringify(nameless.json));
    assert.equal(nameless.json.data.options.length, 1);
    assert.equal(nameless.json.data.options[0].option_name, null);

    const secondDefault = await api(port, "POST", `/api/products/${nameless.json.data.id}/options`, {
      purchase_price: 900,
      vat_type: "INCLUDED",
      carton_qty: 1,
      default_shipping_fee: 0,
      default_shipping_type: "PARCEL",
    });
    assert.equal(secondDefault.status, 409);
    assert.equal(secondDefault.json.error.code, "PRODUCT_OPTION_DUPLICATED");
  });
});

after(async () => {
  try {
    const { rows } = await pool.query(
      `
        SELECT p.id
        FROM products p
        INNER JOIN suppliers s ON s.id = p.supplier_id
        WHERE s.supplier_code LIKE $1
      `,
      [`${prefix}%`],
    );
    await deleteProductsByIds(
      pool,
      rows.map((row) => row.id),
    );
    await pool.query(`DELETE FROM suppliers WHERE supplier_code LIKE $1`, [`${prefix}%`]);
  } finally {
    await pool.end();
  }
});

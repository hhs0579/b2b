import assert from "node:assert/strict";
import { test } from "node:test";
import { projectInvoiceLines } from "../src/domain/invoice-projection.js";
import { formatProductParcelNote, productInvoiceNote } from "../src/domain/invoice-note.js";

function group(overrides) {
  return {
    product_id: 1,
    product_option_id: 10,
    product_name: "영양맛밤",
    option_name: "",
    total_quantity: 150,
    sale_price: 690,
    shipping_type: "PARCEL",
    shipping_fee_per_carton: 4000,
    carton_count: 3,
    group_key: "TOTAL",
    ...overrides,
  };
}

test("TEST 1 parcel product note is 4,000원 × 3", () => {
  assert.equal(formatProductParcelNote(4000, 3), "4,000원 × 3");
  const projected = projectInvoiceLines({
    shippingType: "PARCEL",
    items: [],
    shippingGroups: [group({ total_quantity: 150, shipping_fee_per_carton: 4000, carton_count: 3 })],
  });
  assert.equal(projected.invoice_product_lines.length, 1);
  assert.equal(projected.invoice_product_lines[0].note, "4,000원 × 3");
});

test("TEST 2 parcel product note is 5,000원 × 10", () => {
  assert.equal(productInvoiceNote("PARCEL", { shippingFeePerCarton: 5000, cartonCount: 10 }), "5,000원 × 10");
  const projected = projectInvoiceLines({
    shippingType: "PARCEL",
    items: [],
    shippingGroups: [
      group({
        product_option_id: 11,
        product_name: "브이나인 치약",
        total_quantity: 600,
        sale_price: 2000,
        shipping_fee_per_carton: 5000,
        carton_count: 10,
      }),
    ],
  });
  assert.equal(projected.invoice_product_lines[0].note, "5,000원 × 10");
});

test("TEST 3 TRUCK product note is 용차출고", () => {
  const projected = projectInvoiceLines({
    shippingType: "PARCEL",
    manualCharge: 150000,
    items: [],
    shippingGroups: [
      group({
        product_name: "올리브오일",
        shipping_type: "TRUCK",
        carton_count: 4,
        truck_group_key: "TRUCK-1",
      }),
    ],
    truckGroups: { "TRUCK-1": { manual_shipping_charge: 150000 } },
  });
  assert.equal(projected.invoice_product_lines[0].note, "용차출고");
  assert.equal(productInvoiceNote("FREE"), "무료배송");
  assert.equal(productInvoiceNote("COLLECT"), "착불");
  assert.equal(productInvoiceNote("MANUAL"), "수동배송");
});

test("TEST 4 shipping projection rows have empty notes", () => {
  const projected = projectInvoiceLines({
    shippingType: "PARCEL",
    manualCharge: 150000,
    items: [],
    shippingGroups: [
      group({ carton_count: 3, shipping_fee_per_carton: 4000 }),
      group({
        product_option_id: 12,
        product_name: "올리브오일",
        shipping_type: "TRUCK",
        truck_group_key: "TRUCK-1",
      }),
    ],
    truckGroups: { "TRUCK-1": { manual_shipping_charge: 150000 } },
  });
  assert.deepEqual(
    projected.invoice_shipping_lines.map((row) => [row.label, row.note]),
    [
      ["택배비-4,000원", ""],
      ["용차비", ""],
    ],
  );
});

test("TEST 5 same product same fee merges cartons into one row", () => {
  const projected = projectInvoiceLines({
    shippingType: "PARCEL",
    items: [],
    shippingGroups: [
      group({ group_key: "서울 A", total_quantity: 50, carton_count: 1 }),
      group({ group_key: "서울 B", total_quantity: 100, carton_count: 2 }),
    ],
  });
  assert.equal(projected.invoice_product_lines.length, 1);
  assert.equal(projected.invoice_product_lines[0].quantity, 150);
  assert.equal(projected.invoice_product_lines[0].carton_count, 3);
  assert.equal(projected.invoice_product_lines[0].note, "4,000원 × 3");
});

test("TEST 6 same product different parcel fees splits rows", () => {
  const projected = projectInvoiceLines({
    shippingType: "PARCEL",
    items: [],
    shippingGroups: [
      group({ total_quantity: 100, carton_count: 2, shipping_fee_per_carton: 4000 }),
      group({ total_quantity: 50, carton_count: 1, shipping_fee_per_carton: 5000 }),
    ],
  });
  assert.equal(projected.invoice_product_lines.length, 2);
  const notes = projected.invoice_product_lines.map((row) => row.note).sort();
  assert.deepEqual(notes, ["4,000원 × 2", "5,000원 × 1"]);
});

test("TEST 7 same product parcel and truck splits rows", () => {
  const projected = projectInvoiceLines({
    shippingType: "PARCEL",
    items: [],
    shippingGroups: [
      group({ total_quantity: 100, carton_count: 2, shipping_fee_per_carton: 4000, shipping_type: "PARCEL" }),
      group({ total_quantity: 50, carton_count: 1, shipping_type: "TRUCK" }),
    ],
  });
  assert.equal(projected.invoice_product_lines.length, 2);
  const parcel = projected.invoice_product_lines.find((row) => row.shipping_type === "PARCEL");
  const truck = projected.invoice_product_lines.find((row) => row.shipping_type === "TRUCK");
  assert.equal(parcel.quantity, 100);
  assert.equal(parcel.note, "4,000원 × 2");
  assert.equal(truck.quantity, 50);
  assert.equal(truck.note, "용차출고");
});

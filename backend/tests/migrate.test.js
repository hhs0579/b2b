import assert from "node:assert/strict";
import { after, test } from "node:test";
import { runMigrations } from "../src/db/migrations.js";
import { pool } from "../src/db/pool.js";

test("migrations apply once and are idempotent on rerun", async () => {
  const first = await runMigrations();
  assert.ok(first.files.includes("005_orders_calculations.sql"));
  assert.ok(first.files.includes("006_generated_invoices.sql"));
  assert.ok(first.files.includes("007_order_client_name_snapshot.sql"));
  assert.ok(first.files.includes("008_settlements.sql"));
  assert.ok(first.files.includes("009_safe_deletes.sql"));
  assert.ok(first.files.includes("010_product_code_optional.sql"));
  assert.ok(first.files.includes("011_product_options.sql"));
  assert.ok(first.files.includes("012_manual_quantity.sql"));
  assert.ok(first.files.includes("013_invoice_memo.sql"));
  assert.ok(first.files.includes("014_shipping_groups.sql"));
  assert.ok(first.files.includes("015_excel_multi_header.sql"));

  const { rows: afterFirst } = await pool.query(
    "SELECT name, applied_at FROM schema_migrations ORDER BY name",
  );
  assert.ok(afterFirst.some((row) => row.name === "001_app_metadata.sql"));
  assert.ok(afterFirst.some((row) => row.name === "005_orders_calculations.sql"));
  assert.ok(afterFirst.some((row) => row.name === "006_generated_invoices.sql"));
  assert.ok(afterFirst.some((row) => row.name === "007_order_client_name_snapshot.sql"));
  assert.ok(afterFirst.some((row) => row.name === "008_settlements.sql"));
  assert.ok(afterFirst.some((row) => row.name === "009_safe_deletes.sql"));
  assert.ok(afterFirst.some((row) => row.name === "010_product_code_optional.sql"));
  assert.ok(afterFirst.some((row) => row.name === "011_product_options.sql"));
  assert.ok(afterFirst.some((row) => row.name === "012_manual_quantity.sql"));
  assert.ok(afterFirst.some((row) => row.name === "013_invoice_memo.sql"));
  assert.ok(afterFirst.some((row) => row.name === "014_shipping_groups.sql"));
  assert.ok(afterFirst.some((row) => row.name === "015_excel_multi_header.sql"));
  assert.ok(afterFirst[0].applied_at instanceof Date);

  const { rows: metadata } = await pool.query(
    "SELECT value FROM app_metadata WHERE key = $1",
    ["app_name"],
  );
  assert.equal(metadata[0].value, "b2b");

  const second = await runMigrations();
  assert.equal(second.appliedCount, 0);

  const { rows: afterSecond } = await pool.query(
    "SELECT name FROM schema_migrations WHERE name = $1",
    ["001_app_metadata.sql"],
  );
  assert.equal(afterSecond.length, 1);
});

after(async () => {
  await pool.end();
});

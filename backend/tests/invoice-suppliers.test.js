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
import { collectIntegrityFindings } from "../src/domain/invoice-master-integrity.js";
import {
  assertNotMasterPath,
  getMasterPath,
  readMasterManifest,
  readTemplateManifest,
} from "../src/domain/invoice-master.js";
import {
  INVOICE_TEMPLATES,
  templateMasterPath,
  templateStampPath,
} from "../src/domain/invoice-template-registry.js";
import * as invoiceSuppliersRepository from "../src/modules/invoice-suppliers/invoice-suppliers.repository.js";
import { invoiceSupplierByCode } from "./helpers/invoice-supplier.js";

const prefix = `SUPINV${Date.now()}`;
const created = {
  importIds: [],
  orderIds: [],
  clientIds: [],
  productIds: [],
  supplierIds: [],
  storedFiles: [],
  invoiceFiles: [],
  profileIds: [],
};

const ESSER_MASTER_SHA = "306a489c061b1f29ad1e4f16678ed63ebc6847ca664b8d9688d5f4ce79a6b224";
const BESTHEIM_MASTER_SHA = "fc72662c79908fe505e6157766f326a8af60b045901fcc46dedd0b14b4f64027";
const BESTHEIM_STAMP_SHA = "d61cb0f12deb3d4a4f246c00608951d3b1b4879dbbe3eecc34158b2f6e59626e";

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
    return { status: response.status, json: await response.json(), headers: response.headers, response };
  }
  return {
    status: response.status,
    buffer: Buffer.from(await response.arrayBuffer()),
    headers: response.headers,
    response,
  };
}

async function upload(port, clientId, buffer, filename, orderDate = "2026-09-11") {
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

function uniqueName(name) {
  return `${prefix}-${name}`;
}

async function seedCatalog(port) {
  const supplier = (
    await api(port, "POST", "/api/suppliers", {
      supplier_code: `${prefix}-SUP`,
      supplier_name: "공급자선택매입처",
    })
  ).json.data;
  created.supplierIds.push(supplier.id);
  const client = (
    await api(port, "POST", "/api/sales-clients", {
      client_code: `${prefix}-CL`,
      client_name: "제이와이컴퍼니",
      default_shipping_type: "PARCEL",
      shipping_calculation_mode: "TOTAL_QUANTITY",
    })
  ).json.data;
  created.clientIds.push(client.id);
  return { supplier, client };
}

async function makeConfirmed(port, { clientId, supplierId, products, aoa, settings, orderDate }) {
  const nameMap = new Map(products.map((spec) => [spec.name, uniqueName(spec.name)]));
  for (const spec of products) {
    spec.name = nameMap.get(spec.name);
  }
  aoa = aoa.map((row) => row.map((cell) => nameMap.get(cell) ?? cell));
  for (const spec of products) {
    const result = await api(port, "POST", "/api/products", {
      product_name: spec.name,
      product_code: `${prefix}-P-${created.productIds.length + 1}`,
      vat_type: "INCLUDED",
      default_shipping_type: spec.shippingType || "PARCEL",
      purchase_price: spec.purchase,
      carton_qty: spec.cartonQty,
      default_shipping_fee: spec.defaultFee,
      supplier_id: supplierId,
    });
    const product = mapCreatedProduct(result.json.data);
    created.productIds.push(product.id);
    spec.id = product.id;
    spec.product_option_id = product.product_option_id;
    await api(port, "POST", `/api/sales-clients/${clientId}/prices`, {
      product_option_id: product.product_option_id,
      sale_price: spec.sale,
      shipping_fee_override: spec.override === undefined ? null : spec.override,
      effective_from: "2026-01-01",
    });
  }
  const up = await upload(port, clientId, xlsxBuffer(aoa), `${prefix}.xlsx`, orderDate || "2026-09-11");
  await api(port, "PATCH", `/api/order-imports/${up.json.data.id}/config`, {
    sheet_name: "Sheet1",
    header_row_number: 1,
    column_map: { external_product_name: "상품명", quantity: "수량" },
    save_mapping: false,
  });
  const parsed = await api(port, "POST", `/api/order-imports/${up.json.data.id}/parse`);
  assert.equal(parsed.json.data.status, "READY", JSON.stringify(parsed.json.data));
  const draft = await api(port, "POST", `/api/order-imports/${up.json.data.id}/order`);
  created.orderIds.push(draft.json.data.id);
  await api(port, "PATCH", `/api/orders/${draft.json.data.id}/settings`, settings || {
    shipping_type: "PARCEL",
    shipping_calculation_mode: "TOTAL_QUANTITY",
  });
  const preview = await api(port, "GET", `/api/orders/${draft.json.data.id}/preview`);
  const confirmed = await api(port, "POST", `/api/orders/${draft.json.data.id}/confirm`, {
    preview_signature: preview.json.data.calculation_signature,
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
  return { orderId: draft.json.data.id, products };
}

async function generate(port, orderId, supplierId, extra = {}) {
  const result = await api(port, "POST", `/api/orders/${orderId}/invoices`, {
    supplier_profile_id: supplierId,
    ...extra,
  });
  if (result.json?.data?.document?.stored_file_name) {
    created.invoiceFiles.push(result.json.data.document.stored_file_name);
  }
  return result;
}

test("invoice supplier selection TEST 1-14", async (t) => {
  const migrated = await runMigrations();
  assert.ok(migrated.files.includes("016_invoice_supplier_profiles.sql"));

  const esserMasterBefore = sha256(fs.readFileSync(getMasterPath()));
  const bestheimPath = templateMasterPath(INVOICE_TEMPLATES.BESTHEIM);
  const bestheimMasterBefore = sha256(fs.readFileSync(bestheimPath));

  const { server, port } = await startServer();
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  );

  const listed = await api(port, "GET", "/api/invoice-suppliers?is_active=true");
  assert.equal(listed.status, 200, JSON.stringify(listed.json));
  const esser = listed.json.data.items.find((item) => item.supplier_code === "ESSER");
  const bestheim = listed.json.data.items.find((item) => item.supplier_code === "BESTHEIM");
  assert.ok(esser, "ESSER seed");
  assert.ok(bestheim, "BESTHEIM seed");
  assert.equal(esser.supplier_name, "에쎄르");
  assert.equal(esser.business_registration_number, "108-81-62352");
  assert.equal(esser.representative_name, "김동욱");
  assert.equal(esser.business_address, "경기도 김포시 양촌읍 황금로 323번길 15");
  assert.equal(esser.business_type, "도소매");
  assert.equal(esser.business_item, "잡화");
  assert.equal(esser.phone, "02-322-8285");
  assert.equal(bestheim.supplier_name, "베스트하임");
  assert.equal(bestheim.business_registration_number, "562-81-01919");
  assert.equal(bestheim.representative_name, "김성준");
  assert.equal(bestheim.business_address, "경기도 김포시 양촌읍 황금로 323번길 15");
  assert.equal(bestheim.business_type, "도소매");
  assert.equal(bestheim.business_item, "잡화");
  assert.equal(bestheim.phone, "02-322-8285");

  const { supplier, client } = await seedCatalog(port);
  const { orderId } = await makeConfirmed(port, {
    clientId: client.id,
    supplierId: supplier.id,
    products: [{ name: "영양맛밤", purchase: 1000, cartonQty: 10, defaultFee: 5000, sale: 2000 }],
    aoa: [["상품명", "수량"], ["영양맛밤", 30]],
  });

  await t.test("TEST 5 공급자 미선택 차단", async () => {
    const result = await api(port, "POST", `/api/orders/${orderId}/invoices`, {});
    assert.equal(result.status, 400);
    assert.equal(result.json.error.code, "INVOICE_SUPPLIER_REQUIRED");
    assert.equal(result.json.error.message, "거래명세서 공급자를 선택해주세요.");
  });

  await t.test("TEST 1/4/10/11/12 에쎄르 MASTER·인감·특이사항", async () => {
    const createdInvoice = await generate(port, orderId, esser.id, {
      shippingMethod: "택배출고",
      shipDate: "2026-09-11",
      destination: "김포 창고",
      manager: "담당A",
    });
    assert.equal(createdInvoice.status, 201, JSON.stringify(createdInvoice.json));
    const doc = createdInvoice.json.data.document;
    assert.equal(doc.version, 1);
    assert.equal(doc.supplier_code_snapshot, "ESSER");
    assert.equal(doc.supplier_name_snapshot, "에쎄르");
    assert.equal(doc.template_code, "ESSER");
    assert.equal(doc.template_hash, ESSER_MASTER_SHA);
    assert.equal(doc.stamp_hash, STAMP_IMAGE_SHA256);
    assert.equal(doc.supplier_profile_snapshot.business_registration_number, "108-81-62352");
    assert.equal(doc.original_file_name, "260911_제이와이컴퍼니_거래명세서_에쎄르.xlsx");

    const file = await api(port, "GET", `/api/orders/${orderId}/invoices/${doc.id}/download`);
    assert.equal(file.status, 200);
    const inspect = await inspectInvoiceWorkbook(file.buffer, {
      stampMediaPart: INVOICE_TEMPLATES.ESSER.stampMediaPart,
      frozenParts: INVOICE_TEMPLATES.ESSER.frozenParts,
    });
    assert.equal(inspect.media.sha256, STAMP_IMAGE_SHA256);
    assert.match(String(inspect.cells.M4?.value || ""), /에쎄르/);
    assert.equal(String(inspect.cells.M3?.value || ""), "108-81-62352");
    assert.match(String(inspect.cells.C18?.value || ""), /배송방법 : 택배출고/);
    assert.equal(inspect.parts.includes("xl/calcChain.xml"), false);
  });

  let v1Hash;
  await t.test("TEST 2/3/6/9 베스트하임 MASTER·인감, v1 불변", async () => {
    const listedBefore = await api(port, "GET", `/api/orders/${orderId}/invoices`);
    const v1 = listedBefore.json.data.documents[0];
    v1Hash = v1.file_hash;
    const v1Path = resolveInvoiceStoredPath(v1.stored_file_name);
    const v1BytesBefore = fs.readFileSync(v1Path);

    const createdInvoice = await generate(port, orderId, bestheim.id);
    assert.equal(createdInvoice.status, 201, JSON.stringify(createdInvoice.json));
    const doc = createdInvoice.json.data.document;
    assert.equal(doc.version, 2);
    assert.equal(doc.supplier_code_snapshot, "BESTHEIM");
    assert.equal(doc.supplier_name_snapshot, "베스트하임");
    assert.equal(doc.template_code, "BESTHEIM");
    assert.equal(doc.template_hash, BESTHEIM_MASTER_SHA);
    assert.equal(doc.stamp_hash, BESTHEIM_STAMP_SHA);
    assert.equal(doc.original_file_name, "260911_제이와이컴퍼니_거래명세서_베스트하임_v2.xlsx");

    const file = await api(port, "GET", `/api/orders/${orderId}/invoices/${doc.id}/download`);
    const inspect = await inspectInvoiceWorkbook(file.buffer, {
      stampMediaPart: INVOICE_TEMPLATES.BESTHEIM.stampMediaPart,
      frozenParts: INVOICE_TEMPLATES.BESTHEIM.frozenParts,
    });
    assert.equal(inspect.media.sha256, BESTHEIM_STAMP_SHA);
    assert.equal(inspect.mediaFiles["xl/media/image2.png"].sha256, BESTHEIM_STAMP_SHA);
    assert.match(String(inspect.cells.M4?.value || ""), /베스트하임/);
    assert.equal(String(inspect.cells.M3?.value || ""), "562-81-01919");
    assert.equal(String(inspect.cells.O4?.value || ""), "김성준");
    assert.equal(String(inspect.cells.N10?.value || ""), "5,000원 × 3");
    assert.equal(inspect.parts.includes("xl/calcChain.xml"), false);

    const listed = await api(port, "GET", `/api/orders/${orderId}/invoices`);
    assert.equal(listed.json.data.documents[0].supplier_code_snapshot, "ESSER");
    assert.equal(listed.json.data.documents[0].file_hash, v1Hash);
    assert.equal(sha256(fs.readFileSync(v1Path)), v1Hash);
    assert.deepEqual(fs.readFileSync(v1Path), v1BytesBefore);
  });

  await t.test("TEST 7 공급자 정보 수정 후 snapshot 불변", async () => {
    const inserted = await pool.query(
      `
        INSERT INTO invoice_supplier_profiles (
          supplier_code, supplier_name, business_registration_number, representative_name,
          business_address, business_type, business_item, phone, template_code, is_active
        ) VALUES ($1, $2, '108-81-62352', '김동욱', $3, '도소매', '잡화', '02-322-8285', 'ESSER', TRUE)
        RETURNING *
      `,
      [`SNAP-${prefix}`, "스냅샷공급자", "경기도 김포시 양촌읍 황금로 323번길 15"],
    );
    const profile = invoiceSuppliersRepository.mapProfile(inserted.rows[0]);
    created.profileIds.push(profile.id);
    const { orderId: snapOrderId } = await makeConfirmed(port, {
      clientId: client.id,
      supplierId: supplier.id,
      products: [{ name: "스냅샷상품", purchase: 1000, cartonQty: 10, defaultFee: 0, sale: 1500 }],
      aoa: [["상품명", "수량"], ["스냅샷상품", 1]],
      settings: { shipping_type: "FREE", shipping_calculation_mode: "TOTAL_QUANTITY" },
    });
    const createdInvoice = await generate(port, snapOrderId, profile.id);
    assert.equal(createdInvoice.status, 201, JSON.stringify(createdInvoice.json));
    assert.equal(createdInvoice.json.data.document.supplier_name_snapshot, "스냅샷공급자");
    await invoiceSuppliersRepository.updateProfile(profile.id, { supplier_name: "변경된공급자명" });
    const listed = await api(port, "GET", `/api/orders/${snapOrderId}/invoices`);
    assert.equal(listed.json.data.documents[0].supplier_name_snapshot, "스냅샷공급자");
    assert.equal(listed.json.data.documents[0].supplier_profile_snapshot.supplier_name, "스냅샷공급자");
    const current = await invoiceSupplierByCode(port, `SNAP-${prefix}`);
    assert.equal(current.supplier_name, "변경된공급자명");
  });

  await t.test("비활성 공급자 신규 생성 차단", async () => {
    const inserted = await pool.query(
      `
        INSERT INTO invoice_supplier_profiles (
          supplier_code, supplier_name, template_code, is_active
        ) VALUES ($1, '비활성공급자', 'ESSER', FALSE)
        RETURNING *
      `,
      [`OFF-${prefix}`],
    );
    const profile = invoiceSuppliersRepository.mapProfile(inserted.rows[0]);
    created.profileIds.push(profile.id);
    const result = await generate(port, orderId, profile.id);
    assert.equal(result.status, 400);
    assert.equal(result.json.error.code, "INVOICE_SUPPLIER_INACTIVE");
  });

  await t.test("TEST 13/14 MASTER checksum 분리 검증", async () => {
    assert.equal(esserMasterBefore, ESSER_MASTER_SHA);
    assert.equal(sha256(fs.readFileSync(getMasterPath())), ESSER_MASTER_SHA);
    assert.equal(readMasterManifest().sha256, ESSER_MASTER_SHA);
    assert.equal(bestheimMasterBefore, BESTHEIM_MASTER_SHA);
    assert.equal(sha256(fs.readFileSync(bestheimPath)), BESTHEIM_MASTER_SHA);
    assert.equal(readTemplateManifest(INVOICE_TEMPLATES.BESTHEIM).sha256, BESTHEIM_MASTER_SHA);
    assert.equal(sha256(fs.readFileSync(templateStampPath(INVOICE_TEMPLATES.BESTHEIM))), BESTHEIM_STAMP_SHA);
    assert.equal(sha256(fs.readFileSync(templateStampPath(INVOICE_TEMPLATES.ESSER))), STAMP_IMAGE_SHA256);
    assert.throws(() => assertNotMasterPath(bestheimPath), (err) => err.code === "MASTER_READONLY");
    assert.throws(() => assertNotMasterPath(getMasterPath()), (err) => err.code === "MASTER_READONLY");

    const bestheimBytes = fs.readFileSync(bestheimPath);
    const inspect = await inspectInvoiceWorkbook(bestheimBytes, {
      stampMediaPart: INVOICE_TEMPLATES.BESTHEIM.stampMediaPart,
      frozenParts: INVOICE_TEMPLATES.BESTHEIM.frozenParts,
    });
    const findings = collectIntegrityFindings(inspect, {
      beforeSha256: BESTHEIM_MASTER_SHA,
      afterSha256: sha256(bestheimBytes),
      template: INVOICE_TEMPLATES.BESTHEIM,
      requireSourceStampMatch: false,
    });
    for (const finding of findings) {
      assert.equal(finding.ok, true, finding.message);
    }
  });

  await t.test("CONFIRMED 이후 기본 공급자 변경 가능, 기존 문서 유지", async () => {
    const patched = await api(port, "PATCH", `/api/orders/${orderId}/invoice-supplier`, {
      supplier_profile_id: esser.id,
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.json));
    assert.equal(patched.json.data.order.invoice_supplier_profile_id, esser.id);
    const listed = await api(port, "GET", `/api/orders/${orderId}/invoices`);
    assert.equal(listed.json.data.documents[0].supplier_code_snapshot, "ESSER");
    assert.equal(listed.json.data.documents[1].supplier_code_snapshot, "BESTHEIM");
  });

  await t.test("생성 후 ESSER/BESTHEIM MASTER 불변", () => {
    assert.equal(sha256(fs.readFileSync(getMasterPath())), esserMasterBefore);
    assert.equal(sha256(fs.readFileSync(bestheimPath)), bestheimMasterBefore);
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
    if (created.profileIds.length) {
      await pool.query("DELETE FROM invoice_supplier_profiles WHERE id = ANY($1::bigint[])", [created.profileIds]);
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
        // ignore
      }
    }
  } finally {
    await pool.end();
  }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { collectIntegrityFindings } from "../src/domain/invoice-master-integrity.js";
import {
  INVOICE_MASTER_CHECKSUM_KEY,
  assertNotMasterPath,
  createMasterOutputCopy,
  getMasterPath,
  inspectMasterStatus,
  readMasterManifest,
  readMasterRawBytes,
  readStoredMasterChecksum,
  sourceInvoicePath,
  syncInvoiceMasterChecksum,
  writeGeneratedInvoice,
} from "../src/domain/invoice-master.js";
import { inspectInvoiceWorkbook, sha256 } from "../src/domain/invoice-openxml.js";
import { FROZEN_PARTS } from "../src/domain/invoice-template-map.js";
import { pool } from "../src/db/pool.js";

test("invoice MASTER integrity TEST 1-16", async (t) => {
  const sourcePath = sourceInvoicePath();
  const masterPath = getMasterPath();
  assert.ok(fs.existsSync(sourcePath), "원본 거래명세서 파일이 있어야 한다");
  assert.ok(fs.existsSync(masterPath), "storage/masters/invoice_MASTER.xlsx 가 있어야 한다");

  const sourceBefore = sha256(fs.readFileSync(sourcePath));
  const masterBefore = sha256(fs.readFileSync(masterPath));
  const manifest = readMasterManifest();
  assert.ok(manifest?.sha256, "MASTER manifest checksum이 있어야 한다");
  assert.equal(masterBefore, manifest.sha256, "MASTER 파일 checksum이 manifest와 같아야 한다");

  const masterBytes = readMasterRawBytes();
  const copy = createMasterOutputCopy(masterBytes);
  assert.notEqual(copy, masterBytes);
  assert.equal(sha256(copy), masterBefore);

  const sourceInspect = await inspectInvoiceWorkbook(fs.readFileSync(sourcePath));
  const inspect = await inspectInvoiceWorkbook(masterBytes);

  await t.test("frozen OpenXML parts match the source layout file", () => {
    for (const part of FROZEN_PARTS) {
      assert.equal(
        inspect.partHashes[part],
        sourceInspect.partHashes[part],
        `${part} uncompressed hash`,
      );
    }
  });

  const findings = collectIntegrityFindings(inspect, {
    sourceInspect,
    beforeSha256: masterBefore,
    afterSha256: sha256(fs.readFileSync(masterPath)),
  });

  for (const finding of findings) {
    await t.test(finding.id, () => {
      assert.equal(finding.ok, true, finding.message);
    });
  }

  await t.test("MASTER path cannot be used as write target", async () => {
    assert.throws(() => assertNotMasterPath(masterPath), (err) => err.code === "MASTER_READONLY");
    await assert.rejects(
      () => writeGeneratedInvoice(masterPath, Buffer.from("nope")),
      (err) => err.code === "MASTER_READONLY",
    );
    const afterBlocked = sha256(fs.readFileSync(masterPath));
    assert.equal(afterBlocked, masterBefore);
  });

  await t.test("output copy can be written outside MASTER", async () => {
    const tmp = path.join(os.tmpdir(), `invoice-master-copy-${Date.now()}.xlsx`);
    await writeGeneratedInvoice(tmp, copy);
    const written = fs.readFileSync(tmp);
    assert.equal(sha256(written), masterBefore);
    fs.unlinkSync(tmp);
    assert.equal(sha256(fs.readFileSync(masterPath)), masterBefore);
  });

  await t.test("checksum can be stored in app_metadata", async () => {
    const status = inspectMasterStatus();
    assert.equal(status.ok, true);
    await syncInvoiceMasterChecksum();
    const stored = await readStoredMasterChecksum();
    assert.equal(stored, masterBefore);
    assert.equal(INVOICE_MASTER_CHECKSUM_KEY, "invoice_master_sha256");
  });

  const sourceAfter = sha256(fs.readFileSync(sourcePath));
  const masterAfter = sha256(fs.readFileSync(masterPath));
  assert.equal(sourceAfter, sourceBefore, "원본 거래명세서는 수정되면 안 된다");
  assert.equal(masterAfter, masterBefore, "TEST 16 MASTER checksum 작업 전후 동일");
});

after(async () => {
  await pool.end();
});

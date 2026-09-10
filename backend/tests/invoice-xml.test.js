import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import JSZip from "jszip";
import XLSX from "xlsx";
import { excelSerialFromIsoDate, parseIsoDateParts } from "../src/domain/dates.js";
import { getMasterPath, readMasterManifest } from "../src/domain/invoice-master.js";
import { inspectInvoiceWorkbook, sha256 } from "../src/domain/invoice-openxml.js";
import { buildInvoiceFillPlan, patchInvoiceWorkbook } from "../src/domain/invoice-openxml-patch.js";
import { invoiceSheetLayout } from "../src/domain/invoice-template-map.js";
import { verifyGeneratedInvoice } from "../src/domain/invoice-generate.js";
import {
  assertInvoiceXmlParts,
  assertXmlParse,
  elementsByLocal,
  parseCellRef,
  parseXml,
} from "../src/domain/invoice-xml.js";
import { expectedItemMerges } from "../src/domain/invoice-openxml-expand.js";

const MASTER_SHA256 = "306a489c061b1f29ad1e4f16678ed63ebc6847ca664b8d9688d5f4ce79a6b224";

function lines(count, extras = {}) {
  return Array.from({ length: count }, (_, index) => ({
    product_name: extras.name || `품목${index + 1}`,
    option_name: extras.option || (index === 0 ? extras.firstOption || "" : ""),
    quantity: 1,
    unit_price: 1000,
  }));
}

async function generateForCount(count, extras = {}) {
  const masterBytes = fs.readFileSync(getMasterPath());
  const masterInspect = await inspectInvoiceWorkbook(masterBytes);
  const fillPlan = buildInvoiceFillPlan({
    orderDateParts: parseIsoDateParts("2026-09-07"),
    dateSerial: excelSerialFromIsoDate("2026-09-07"),
    clientName: extras.clientName || "테스트매출처",
    note: extras.note || null,
    lines: extras.lines || lines(count, extras),
  });
  const generated = await patchInvoiceWorkbook(masterBytes, fillPlan, masterInspect.sharedStrings);
  const zip = await JSZip.loadAsync(generated);
  const parts = {
    sheetXml: await zip.file("xl/worksheets/sheet1.xml").async("string"),
    sstXml: await zip.file("xl/sharedStrings.xml").async("string"),
    workbookXml: await zip.file("xl/workbook.xml").async("string"),
    relsXml: await zip.file("xl/_rels/workbook.xml.rels").async("string"),
    contentTypesXml: await zip.file("[Content_Types].xml").async("string"),
  };
  return { masterBytes, generated, zip, parts, fillPlan, inspect: await inspectInvoiceWorkbook(generated) };
}

test("invoiceSheetLayout uses a single row-number function", () => {
  const layout = invoiceSheetLayout(8);
  assert.equal(layout.firstItemRow, 10);
  assert.equal(layout.lastItemRow, 17);
  assert.equal(layout.summaryRow, 18);
  assert.equal(layout.noteRow, 19);
  assert.equal(layout.printLastRow, 20);
  assert.equal(layout.qtySumFormula, "SUM(G10:H17)");
  assert.equal(layout.amountSumFormula, "SUM(K10:M17)");
  assert.equal(layout.totalAmountFormula, "K18+N18");
});

test("malformed XML fails as INVOICE_XML_INVALID", () => {
  assert.throws(() => assertXmlParse("<row><c r='A1'></row>", "sheet1.xml"), (err) => err.code === "INVOICE_XML_INVALID");
});

for (const count of [7, 8, 9, 14, 30]) {
  test(`dynamic invoice XML is well-formed for ${count} rows`, async () => {
    const { masterBytes, generated, zip, parts, fillPlan, inspect } = await generateForCount(count);
    assertInvoiceXmlParts(parts);
    assert.equal(Boolean(zip.file("xl/calcChain.xml")), false);
    assert.equal(/calcChain/i.test(parts.relsXml), false);
    assert.equal(/calcChain/i.test(parts.contentTypesXml), false);
    assert.match(parts.workbookXml, /fullCalcOnLoad="1"/);
    const sheetDoc = parseXml(parts.sheetXml, "xl/worksheets/sheet1.xml");
    for (const row of elementsByLocal(sheetDoc, "row")) {
      const rowNum = Number(row.getAttribute("r"));
      for (const cell of elementsByLocal(row, "c")) {
        const parsed = parseCellRef(cell.getAttribute("r"));
        assert.equal(parsed.row, rowNum, cell.getAttribute("r"));
      }
    }
    const layout = invoiceSheetLayout(count);
    assert.equal(inspect.maxRow, layout.noteRow);
    assert.equal(inspect.formulas[layout.qtySum].text, layout.qtySumFormula);
    assert.equal(inspect.formulas[layout.amountSum].text, layout.amountSumFormula);
    assert.equal(inspect.formulas.D8.text, layout.totalAmountFormula);
    assert.equal(Number(inspect.cells[layout.amountSum].rawValue), count * 1000);
    assert.equal(Number(inspect.cells.D8.rawValue), count * 1000);
    if (count > 7) {
      assert.equal(inspect.printArea, layout.printArea);
      for (const ref of expectedItemMerges(layout.lastItemRow)) {
        assert.equal(inspect.merges.refs.includes(ref), true, ref);
      }
    }
    const verification = await verifyGeneratedInvoice(masterBytes, generated, fillPlan);
    assert.equal(verification.ok, true, JSON.stringify(verification.errors));
    assert.doesNotThrow(() => XLSX.read(generated, { type: "buffer", cellFormula: true }));
    assert.equal(sha256(fs.readFileSync(getMasterPath())), MASTER_SHA256);
    assert.equal(readMasterManifest()?.sha256, MASTER_SHA256);
  });
}

test("special characters stay well-formed in sheet and sharedStrings", async () => {
  const { parts, inspect } = await generateForCount(7, {
    clientName: 'TEST "COMPANY"',
    lines: [
      { product_name: "A&B 상품", option_name: "<블랙>", quantity: 2, unit_price: 3000 },
      { product_name: "A < B", option_name: "", quantity: 1, unit_price: 1000 },
      { product_name: "품목3", option_name: "", quantity: 1, unit_price: 1000 },
      { product_name: "품목4", option_name: "", quantity: 1, unit_price: 1000 },
      { product_name: "품목5", option_name: "", quantity: 1, unit_price: 1000 },
      { product_name: "품목6", option_name: "", quantity: 1, unit_price: 1000 },
      { product_name: "품목7", option_name: "", quantity: 1, unit_price: 1000 },
    ],
  });
  assertInvoiceXmlParts(parts);
  assert.equal(parts.sstXml.includes("&amp;"), true);
  assert.equal(parts.sstXml.includes("&lt;"), true);
  assert.equal(parts.sstXml.includes("A&B"), false);
  assert.equal(parts.sstXml.includes("<블랙>"), false);
  assert.equal(inspect.cells.C6.value, 'TEST "COMPANY"');
  assert.equal(inspect.cells.C10.value, "A&B 상품");
  assert.equal(inspect.cells.E10.value, "<블랙>");
  assert.equal(inspect.cells.C11.value, "A < B");
  assert.equal(Number(inspect.cells.D8.rawValue), 12000);
});

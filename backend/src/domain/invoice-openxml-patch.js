import JSZip from "jszip";
import {
  CELLS,
  invoiceSheetLayout,
  writableCellsForLayout,
} from "./invoice-template-map.js";
import { expandInvoiceSheet } from "./invoice-openxml-expand.js";
import {
  assertCalcChainRemoved,
  assertInvoiceXmlParts,
  assertRowCellRefsAligned,
  createSstLookup,
  internSharedStringDom,
  parseXml,
  prepareGeneratedWorkbookParts,
  serializeXml,
  setCellNumber,
  setCellSharedString,
  setFormulaCachedValue,
} from "./invoice-xml.js";

export function buildInvoiceFillPlan({ orderDateParts, dateSerial, clientName, note, lines }) {
  const layout = invoiceSheetLayout(lines.length);
  const cells = {
    [CELLS.DATE_YEAR]: { type: "n", value: orderDateParts.year },
    [CELLS.DATE_MONTH]: { type: "n", value: orderDateParts.month },
    [CELLS.DATE_DAY]: { type: "n", value: orderDateParts.day },
    [CELLS.DATE_ITEM]: { type: "n", value: dateSerial },
    [CELLS.CLIENT_NAME]: { type: "s", value: clientName },
  };
  if (note) {
    cells[layout.note] = { type: "s", value: note };
  }

  const formulaCached = {};
  let qtySum = 0;
  let amountSum = 0;
  layout.itemRows.forEach((row, index) => {
    const line = lines[index];
    if (!line) {
      formulaCached[row.AMOUNT] = 0;
      return;
    }
    cells[row.NAME] = { type: "s", value: line.product_name };
    if (line.option_name) {
      cells[row.OPTION] = { type: "s", value: line.option_name };
    }
    cells[row.QTY] = { type: "n", value: line.quantity };
    cells[row.PRICE] = { type: "n", value: line.unit_price };
    if (line.note) {
      cells[row.NOTE] = { type: "s", value: line.note };
    }
    const amount = line.quantity * line.unit_price;
    formulaCached[row.AMOUNT] = amount;
    qtySum += line.quantity;
    amountSum += amount;
  });
  formulaCached[layout.qtySum] = qtySum;
  formulaCached[layout.amountSum] = amountSum;
  formulaCached[layout.totalAmount] = amountSum;
  return { cells, formulaCached, layout };
}

async function readRequired(zip, name) {
  const file = zip.file(name);
  if (!file) {
    throw new Error(`MASTER OpenXML에 ${name}이 없습니다.`);
  }
  return file.async("string");
}

export async function patchInvoiceWorkbook(masterBytes, fillPlan, sharedStrings) {
  const zip = await JSZip.loadAsync(masterBytes);
  const layout = fillPlan.layout || invoiceSheetLayout(0);
  const writable = writableCellsForLayout(layout);

  const expanded = expandInvoiceSheet(await readRequired(zip, "xl/worksheets/sheet1.xml"), layout.itemCount);
  const sheetDoc = expanded.doc || parseXml(expanded.xml, "xl/worksheets/sheet1.xml");
  let sstState = createSstLookup(parseXml(await readRequired(zip, "xl/sharedStrings.xml"), "xl/sharedStrings.xml"), sharedStrings);

  for (const [ref, spec] of Object.entries(fillPlan.cells)) {
    if (!writable.includes(ref)) {
      throw new Error(`허용되지 않은 셀 변경: ${ref}`);
    }
    if (spec.type === "n") {
      setCellNumber(sheetDoc, ref, spec.value);
    } else if (spec.type === "s") {
      sstState = internSharedStringDom(sstState.sstDoc, sstState.lookup, spec.value);
      setCellSharedString(sheetDoc, ref, sstState.index);
    }
  }

  const formulaRefs = new Set([
    layout.totalAmount,
    layout.qtySum,
    layout.amountSum,
    ...layout.itemRows.map((row) => row.AMOUNT),
  ]);
  for (const [ref, value] of Object.entries(fillPlan.formulaCached)) {
    if (!formulaRefs.has(ref)) {
      throw new Error(`수식 셀이 아닌 cached 갱신: ${ref}`);
    }
    setFormulaCachedValue(sheetDoc, ref, value);
  }

  const stripped = prepareGeneratedWorkbookParts({
    workbookXml: await readRequired(zip, "xl/workbook.xml"),
    relsXml: await readRequired(zip, "xl/_rels/workbook.xml.rels"),
    contentTypesXml: await readRequired(zip, "[Content_Types].xml"),
    printArea: layout.expanded ? layout.printArea : null,
  });

  assertRowCellRefsAligned(sheetDoc);
  const parts = {
    sheetXml: serializeXml(sheetDoc),
    sstXml: serializeXml(sstState.sstDoc),
    workbookXml: stripped.workbookXml,
    relsXml: stripped.relsXml,
    contentTypesXml: stripped.contentTypesXml,
  };
  assertInvoiceXmlParts(parts);

  zip.file("xl/worksheets/sheet1.xml", parts.sheetXml);
  zip.file("xl/sharedStrings.xml", parts.sstXml);
  zip.file("xl/workbook.xml", parts.workbookXml);
  zip.file("xl/_rels/workbook.xml.rels", parts.relsXml);
  zip.file("[Content_Types].xml", parts.contentTypesXml);
  zip.remove("xl/calcChain.xml");

  const generated = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const reopened = await JSZip.loadAsync(generated);
  const reopenedParts = {
    sheetXml: await readRequired(reopened, "xl/worksheets/sheet1.xml"),
    sstXml: await readRequired(reopened, "xl/sharedStrings.xml"),
    workbookXml: await readRequired(reopened, "xl/workbook.xml"),
    relsXml: await readRequired(reopened, "xl/_rels/workbook.xml.rels"),
    contentTypesXml: await readRequired(reopened, "[Content_Types].xml"),
  };
  assertInvoiceXmlParts(reopenedParts);
  assertCalcChainRemoved({
    relsXml: reopenedParts.relsXml,
    contentTypesXml: reopenedParts.contentTypesXml,
    hasCalcChainFile: Boolean(reopened.file("xl/calcChain.xml")),
  });
  return generated;
}

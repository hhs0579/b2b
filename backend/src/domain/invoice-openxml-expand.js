import {
  INVOICE_ITEM_ROW_END,
  INVOICE_SUM_ROW,
  INVOICE_TEMPLATE_ITEM_ROW,
  ITEM_ROW_MERGE_PAIRS,
  invoiceSheetLayout,
} from "./invoice-template-map.js";
import {
  SS_NS,
  assertRowCellRefsAligned,
  childByLocal,
  elementsByLocal,
  parseXml,
  remapRowNode,
  serializeXml,
  setFormula,
} from "./invoice-xml.js";

export function expectedItemMerges(row) {
  return ITEM_ROW_MERGE_PAIRS.map(([start, end]) => `${start}${row}:${end}${row}`);
}

export function shiftMergeRef(ref, extra, lastItemRow) {
  if (ref === "B10:B16" || /^B10:B\d+$/.test(ref)) {
    return `B10:B${lastItemRow}`;
  }
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
  if (!match) {
    return ref;
  }
  const startRow = Number(match[2]);
  const endRow = Number(match[4]);
  const nextStart = startRow >= INVOICE_SUM_ROW ? startRow + extra : startRow;
  const nextEnd = endRow >= INVOICE_SUM_ROW ? endRow + extra : endRow;
  return `${match[1]}${nextStart}:${match[3]}${nextEnd}`;
}

function rowMap(sheetDoc) {
  const map = new Map();
  for (const row of elementsByLocal(sheetDoc, "row")) {
    map.set(Number(row.getAttribute("r")), row);
  }
  return map;
}

function cloneItemRow(templateRow, toRow) {
  const clone = templateRow.cloneNode(true);
  remapRowNode(clone, INVOICE_TEMPLATE_ITEM_ROW, toRow);
  const amount = elementsByLocal(clone, "c").find((cell) => cell.getAttribute("r") === `K${toRow}`);
  if (amount) {
    const formula = childByLocal(amount, "f");
    if (formula) {
      formula.removeAttribute("t");
      formula.removeAttribute("si");
      formula.removeAttribute("ref");
      formula.textContent = `G${toRow}*I${toRow}`;
    }
    const cached = childByLocal(amount, "v");
    if (cached) {
      cached.textContent = "0";
    }
  }
  return clone;
}

function rewriteMerges(sheetDoc, layout) {
  const root = elementsByLocal(sheetDoc, "mergeCells")[0];
  if (!root) {
    return;
  }
  const nextRefs = [];
  const seen = new Set();
  for (const node of elementsByLocal(root, "mergeCell")) {
    const shifted = shiftMergeRef(node.getAttribute("ref"), layout.extra, layout.lastItemRow);
    if (shifted && !seen.has(shifted)) {
      seen.add(shifted);
      nextRefs.push(shifted);
    }
  }
  for (let row = INVOICE_ITEM_ROW_END + 1; row <= layout.lastItemRow; row += 1) {
    for (const ref of expectedItemMerges(row)) {
      if (!seen.has(ref)) {
        seen.add(ref);
        nextRefs.push(ref);
      }
    }
  }
  while (root.firstChild) {
    root.removeChild(root.firstChild);
  }
  for (const ref of nextRefs) {
    const cell = sheetDoc.createElementNS(SS_NS, "mergeCell");
    cell.setAttribute("ref", ref);
    root.appendChild(cell);
  }
  root.setAttribute("count", String(nextRefs.length));
}

export function expandInvoiceSheet(sheetXml, lineCount) {
  const layout = invoiceSheetLayout(lineCount);
  const sheetDoc = parseXml(sheetXml, "xl/worksheets/sheet1.xml");
  if (!layout.expanded) {
    return { xml: sheetXml, doc: sheetDoc, layout };
  }

  const rows = rowMap(sheetDoc);
  const template = rows.get(INVOICE_TEMPLATE_ITEM_ROW);
  const sheetData = elementsByLocal(sheetDoc, "sheetData")[0];
  if (!template || !sheetData) {
    throw new Error("품목행 Template(16행)을 찾을 수 없습니다.");
  }

  const movable = [...rows.entries()].filter(([row]) => row >= INVOICE_SUM_ROW).sort((a, b) => b[0] - a[0]);
  for (const [row, node] of movable) {
    remapRowNode(node, row, row + layout.extra);
  }

  const summaryRow = rowMap(sheetDoc).get(layout.summaryRow);
  for (let row = INVOICE_ITEM_ROW_END + 1; row <= layout.lastItemRow; row += 1) {
    const cloned = cloneItemRow(template, row);
    if (summaryRow) {
      sheetData.insertBefore(cloned, summaryRow);
    } else {
      sheetData.appendChild(cloned);
    }
  }

  rewriteMerges(sheetDoc, layout);

  const dimension = elementsByLocal(sheetDoc, "dimension")[0];
  if (dimension) {
    dimension.setAttribute("ref", layout.dimensionRef);
  }

  setFormula(sheetDoc, layout.qtySum, layout.qtySumFormula, 0);
  setFormula(sheetDoc, layout.amountSum, layout.amountSumFormula, 0);
  setFormula(sheetDoc, layout.totalAmount, layout.totalAmountFormula, 0);

  const pageSetup = elementsByLocal(sheetDoc, "pageSetup")[0];
  if (pageSetup) {
    pageSetup.setAttribute("fitToWidth", "1");
    pageSetup.setAttribute("fitToHeight", "0");
  }

  assertRowCellRefsAligned(sheetDoc);
  return { xml: serializeXml(sheetDoc), doc: sheetDoc, layout };
}

export { invoiceSheetLayout };

import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { AppError } from "../utils/app-error.js";

export const SS_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function localName(node) {
  if (!node?.localName && !node?.nodeName) {
    return "";
  }
  return node.localName || String(node.nodeName).replace(/^.*:/, "");
}

export function elementsByLocal(root, name) {
  const found = [];
  const walk = (node) => {
    if (!node) {
      return;
    }
    if (node.nodeType === 1 && localName(node) === name) {
      found.push(node);
    }
    for (let child = node.firstChild; child; child = child.nextSibling) {
      walk(child);
    }
  };
  walk(root);
  return found;
}

export function childByLocal(parent, name) {
  if (!parent) {
    return null;
  }
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && localName(child) === name) {
      return child;
    }
  }
  return null;
}

export function parseXml(xml, partName = "xml") {
  let fatal = null;
  let doc;
  try {
    doc = new DOMParser({
      onError(level, message) {
        if (level === "error" || level === "fatalError") {
          fatal = `${level}: ${message}`;
        }
      },
    }).parseFromString(String(xml), "text/xml");
  } catch (err) {
    throw new AppError("INVOICE_XML_INVALID", `${partName} XML이 올바르지 않습니다.`, 500, {
      part: partName,
      detail: err.message,
    });
  }
  const parserError = elementsByLocal(doc, "parsererror")[0];
  if (fatal || parserError) {
    throw new AppError(
      "INVOICE_XML_INVALID",
      `${partName} XML이 올바르지 않습니다.`,
      500,
      { part: partName, detail: fatal || parserError?.textContent || "" },
    );
  }
  if (!doc.documentElement) {
    throw new AppError("INVOICE_XML_INVALID", `${partName} XML이 비어 있습니다.`, 500, { part: partName });
  }
  return doc;
}

export function serializeXml(doc) {
  const body = new XMLSerializer().serializeToString(doc);
  if (body.startsWith("<?xml")) {
    return body;
  }
  return `${XML_DECL}\r\n${body}`;
}

export function assertXmlParse(xml, partName) {
  parseXml(xml, partName);
}

export function findCell(sheetDoc, ref) {
  return elementsByLocal(sheetDoc, "c").find((cell) => cell.getAttribute("r") === ref) || null;
}

export function ensureChild(parent, name, ns = SS_NS) {
  const existing = childByLocal(parent, name);
  if (existing) {
    return existing;
  }
  const created = parent.ownerDocument.createElementNS(ns, name);
  parent.appendChild(created);
  return created;
}

export function setCellNumber(sheetDoc, ref, value) {
  const cell = findCell(sheetDoc, ref);
  if (!cell) {
    throw new Error(`셀을 찾을 수 없습니다: ${ref}`);
  }
  cell.removeAttribute("t");
  const v = ensureChild(cell, "v");
  v.textContent = String(value);
}

export function setCellSharedString(sheetDoc, ref, index) {
  const cell = findCell(sheetDoc, ref);
  if (!cell) {
    throw new Error(`셀을 찾을 수 없습니다: ${ref}`);
  }
  cell.setAttribute("t", "s");
  const v = ensureChild(cell, "v");
  v.textContent = String(index);
}

export function setFormula(sheetDoc, ref, text, cachedValue) {
  const cell = findCell(sheetDoc, ref);
  if (!cell) {
    throw new Error(`수식 셀을 찾을 수 없습니다: ${ref}`);
  }
  const f = ensureChild(cell, "f");
  f.removeAttribute("t");
  f.removeAttribute("si");
  f.removeAttribute("ref");
  f.textContent = text;
  if (cachedValue !== undefined) {
    const v = ensureChild(cell, "v");
    v.textContent = String(cachedValue);
  }
}

export function setFormulaCachedValue(sheetDoc, ref, value) {
  const cell = findCell(sheetDoc, ref);
  if (!cell || !childByLocal(cell, "f")) {
    throw new Error(`수식 셀이 아닙니다: ${ref}`);
  }
  const v = ensureChild(cell, "v");
  v.textContent = String(value);
}

export function parseCellRef(ref) {
  const match = /^([A-Z]+)(\d+)$/.exec(ref || "");
  if (!match) {
    return null;
  }
  return { col: match[1], row: Number(match[2]) };
}

export function remapFormulaText(text, fromRow, toRow) {
  return String(text).replace(/([A-Z]+)(\d+)/g, (all, col, row) =>
    Number(row) === fromRow ? `${col}${toRow}` : all,
  );
}

export function remapMergeRef(ref, fromRow, toRow) {
  return String(ref).replace(/([A-Z]+)(\d+)/g, (all, col, row) =>
    Number(row) === fromRow ? `${col}${toRow}` : all,
  );
}

export function remapRowNode(rowNode, fromRow, toRow) {
  rowNode.setAttribute("r", String(toRow));
  for (const cell of elementsByLocal(rowNode, "c")) {
    const parsed = parseCellRef(cell.getAttribute("r"));
    if (parsed?.row === fromRow) {
      cell.setAttribute("r", `${parsed.col}${toRow}`);
    }
    const formula = childByLocal(cell, "f");
    if (!formula) {
      continue;
    }
    if (formula.textContent) {
      formula.textContent = remapFormulaText(formula.textContent, fromRow, toRow);
    }
    const formulaRef = formula.getAttribute("ref");
    if (formulaRef) {
      formula.setAttribute("ref", remapMergeRef(formulaRef, fromRow, toRow));
    }
  }
}

export function internSharedStringDom(sstDoc, lookup, text) {
  if (text == null || text === "") {
    return { sstDoc, lookup, index: null };
  }
  const existing = lookup.get(text);
  if (existing != null) {
    return { sstDoc, lookup, index: existing };
  }
  const sst = sstDoc.documentElement;
  const items = elementsByLocal(sst, "si");
  const si = sstDoc.createElementNS(SS_NS, "si");
  const t = sstDoc.createElementNS(SS_NS, "t");
  if (/^\s|\s$|[\r\n]/.test(text)) {
    t.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
  }
  t.textContent = String(text);
  si.appendChild(t);
  sst.appendChild(si);
  const nextCount = items.length + 1;
  sst.setAttribute("count", String(nextCount));
  sst.setAttribute("uniqueCount", String(nextCount));
  lookup.set(text, items.length);
  return { sstDoc, lookup, index: items.length };
}

export function createSstLookup(sstDoc, sharedStrings) {
  const lookup = new Map();
  sharedStrings.forEach((value, index) => {
    if (value) {
      lookup.set(value, index);
    }
  });
  return { sstDoc, lookup };
}

export function prepareGeneratedWorkbookParts({ workbookXml, relsXml, contentTypesXml, printArea }) {
  const workbookDoc = parseXml(workbookXml, "xl/workbook.xml");
  const calcPr = elementsByLocal(workbookDoc, "calcPr")[0];
  if (calcPr) {
    calcPr.setAttribute("fullCalcOnLoad", "1");
  }
  if (printArea) {
    const print = elementsByLocal(workbookDoc, "definedName").find(
      (node) => node.getAttribute("name") === "_xlnm.Print_Area",
    );
    if (print) {
      print.textContent = printArea;
    }
  }
  const relsDoc = parseXml(relsXml, "xl/_rels/workbook.xml.rels");
  for (const rel of elementsByLocal(relsDoc, "Relationship")) {
    const target = rel.getAttribute("Target") || "";
    const type = rel.getAttribute("Type") || "";
    if (target.includes("calcChain.xml") || type.endsWith("/calcChain")) {
      rel.parentNode?.removeChild(rel);
    }
  }
  const typesDoc = parseXml(contentTypesXml, "[Content_Types].xml");
  for (const item of elementsByLocal(typesDoc, "Override")) {
    if ((item.getAttribute("PartName") || "").includes("calcChain.xml")) {
      item.parentNode?.removeChild(item);
    }
  }
  return {
    workbookXml: serializeXml(workbookDoc),
    relsXml: serializeXml(relsDoc),
    contentTypesXml: serializeXml(typesDoc),
  };
}

export function assertCalcChainRemoved({ relsXml, contentTypesXml, hasCalcChainFile }) {
  if (hasCalcChainFile) {
    throw new AppError("INVOICE_XML_INVALID", "생성 파일에 calcChain.xml이 남아 있습니다.", 500);
  }
  if (/calcChain/i.test(relsXml || "")) {
    throw new AppError("INVOICE_XML_INVALID", "workbook.xml.rels에 calcChain 참조가 남아 있습니다.", 500);
  }
  if (/calcChain/i.test(contentTypesXml || "")) {
    throw new AppError("INVOICE_XML_INVALID", "[Content_Types].xml에 calcChain 참조가 남아 있습니다.", 500);
  }
}

export function assertRowCellRefsAligned(sheetDoc) {
  for (const row of elementsByLocal(sheetDoc, "row")) {
    const rowNum = Number(row.getAttribute("r"));
    for (const cell of elementsByLocal(row, "c")) {
      const parsed = parseCellRef(cell.getAttribute("r"));
      if (!parsed || parsed.row !== rowNum) {
        throw new AppError(
          "INVOICE_XML_INVALID",
          `행 ${rowNum}의 셀 주소가 일치하지 않습니다: ${cell.getAttribute("r")}`,
          500,
        );
      }
    }
  }
}

export function assertInvoiceXmlParts(parts) {
  assertXmlParse(parts.sheetXml, "xl/worksheets/sheet1.xml");
  assertXmlParse(parts.sstXml, "xl/sharedStrings.xml");
  assertXmlParse(parts.workbookXml, "xl/workbook.xml");
  assertXmlParse(parts.relsXml, "xl/_rels/workbook.xml.rels");
  assertXmlParse(parts.contentTypesXml, "[Content_Types].xml");
}

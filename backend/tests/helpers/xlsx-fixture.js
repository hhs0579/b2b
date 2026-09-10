import XLSX from "xlsx";

/** 테스트용 임시 workbook 생성. 거래명세서 write에는 사용하지 않는다. */
export function xlsxBuffer(rows, sheetName = "Sheet1") {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

export function xlsxBufferWithTextCells(rows, textCells, sheetName = "Sheet1") {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  for (const address of textCells) {
    if (sheet[address]) {
      sheet[address].t = "s";
      sheet[address].v = String(sheet[address].v);
      sheet[address].w = String(sheet[address].v);
    }
  }
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

export function xlsxBufferAdvanced({ rows, merges, formulas, sheetName = "Sheet1", textCells = [] }) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  if (merges?.length) {
    sheet["!merges"] = merges;
  }
  for (const address of textCells) {
    if (sheet[address]) {
      sheet[address].t = "s";
      sheet[address].v = String(sheet[address].v);
      sheet[address].w = String(sheet[address].v);
    }
  }
  for (const [address, spec] of Object.entries(formulas || {})) {
    sheet[address] = sheet[address] || {};
    if (typeof spec === "string") {
      sheet[address].f = spec;
    } else {
      if (spec.f) sheet[address].f = spec.f;
      if (spec.v !== undefined) {
        sheet[address].v = spec.v;
        sheet[address].t = spec.t || (typeof spec.v === "number" ? "n" : "s");
      }
      if (spec.t) sheet[address].t = spec.t;
      if (spec.v === undefined && spec.f && sheet[address].v === undefined) {
        delete sheet[address].v;
      }
    }
  }
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

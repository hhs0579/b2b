import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import XLSX from "xlsx";
import { env } from "../src/config/env.js";
import {
  buildLogicalHeaders,
  combineHeaderParts,
  detectHeaderRange,
  normalizeHeaderName,
  tryEvalSimpleFormula,
} from "../src/domain/excel-headers.js";
import { extractDataRows, headerFromRow, readWorkbook } from "../src/domain/excel-reader.js";
import { mappingColumnsNotFound, stabilizeColumnMap, suggestColumnMap } from "../src/domain/excel-mapping.js";
import { resolveParsedQuantity } from "../src/domain/order-parse.js";

function findRealPoPath() {
  const dir = path.resolve(env.backendRoot, "..");
  const name = fs.readdirSync(dir).find((file) => file.includes("260903") && file.toLowerCase().endsWith(".xlsx"));
  assert.ok(name, "실파일 (주)에쎄르 발주서 260903.xlsx 가 필요합니다.");
  return path.join(dir, name);
}

test("normalizeHeaderName strips parenthetical dates", () => {
  assert.equal(normalizeHeaderName("발주(260903) / 발주수량"), "발주 / 발주수량");
  assert.equal(normalizeHeaderName("발주(260910) / 발주수량"), "발주 / 발주수량");
  assert.equal(normalizeHeaderName("상품명"), "상품명");
  assert.equal(combineHeaderParts(["발주(260903)", "발주수량"]), "발주(260903) / 발주수량");
  assert.equal(combineHeaderParts(["사업장명", "사업장명"]), "사업장명");
  assert.equal(combineHeaderParts(["입고지", ""]), "입고지");
});

test("simple formula evaluation multiplies cell refs", () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["입수", "box", "qty"],
    ["60", 144, null],
  ]);
  sheet.B2.t = "n";
  sheet.B2.v = 144;
  sheet.A2.t = "s";
  sheet.A2.v = "60";
  assert.equal(tryEvalSimpleFormula("A2*B2", sheet), 8640);
});

test("single-row header files still parse from row 2", () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["상품명", "수량"],
    ["v9치약", 30],
    ["롱롱그린백 m", 200],
  ]);
  const detected = detectHeaderRange(sheet);
  assert.equal(detected.headerStartRow, 1);
  assert.equal(detected.headerEndRow, 1);
  assert.equal(detected.dataStartRow, 2);
  const extracted = extractDataRows(sheet, 1, {
    headerStartRow: 1,
    headerEndRow: 1,
    dataStartRow: 2,
  });
  assert.equal(extracted.rows.length, 2);
  assert.equal(extracted.rows[0].raw_row_json["상품명"], "v9치약");
  assert.equal(extracted.rows[0].raw_row_json["수량"], 30);
});

test("merged two-row headers and formula without cached value", () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["상품코드", "상품명", "입수", "발주(260903)", null],
    [null, null, null, "발주box", "발주수량"],
    ["8809424490334", "[티알에스큐] 초코", "60", 144, null],
    ["8809424490433", "[더 레어] 맛밤", "50", 240, null],
    [null, null, null, null, null],
    [null, null, null, null, null],
  ]);
  sheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
    { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } },
    { s: { r: 0, c: 2 }, e: { r: 1, c: 2 } },
    { s: { r: 0, c: 3 }, e: { r: 0, c: 4 } },
  ];
  sheet.E3 = { t: "n", f: "C3*D3" };
  sheet.E4 = { t: "n", f: "C4*D4" };
  sheet.C3 = { t: "s", v: "60" };
  sheet.C4 = { t: "s", v: "50" };
  sheet.D5 = { t: "n", v: 384, f: "SUM(D3:D4)" };
  sheet.E5 = { t: "n", v: 20640, f: "SUM(E3:E4)" };

  const detected = detectHeaderRange(sheet);
  assert.equal(detected.headerStartRow, 1);
  assert.equal(detected.headerEndRow, 2);
  assert.equal(detected.dataStartRow, 3);

  const { columns } = buildLogicalHeaders(sheet, {
    headerStartRow: 1,
    headerEndRow: 2,
  });
  const byCol = Object.fromEntries(columns.map((col) => [col.excel_col, col]));
  assert.equal(byCol.A.display_name, "상품코드");
  assert.equal(byCol.B.display_name, "상품명");
  assert.equal(byCol.C.display_name, "입수");
  assert.equal(byCol.D.display_name, "발주 / 발주box");
  assert.equal(byCol.E.display_name, "발주 / 발주수량");
  assert.equal(byCol.D.normalized_name, "발주 / 발주box");
  assert.equal(byCol.E.normalized_name, "발주 / 발주수량");
  assert.equal(byCol.D.column_index, 3);
  assert.equal(byCol.E.column_index, 4);
  assert.equal(byCol.D.composite_header, "발주 / 발주box");
  assert.equal(byCol.E.composite_header, "발주 / 발주수량");

  const extracted = extractDataRows(sheet, 2, {
    headerStartRow: 1,
    headerEndRow: 2,
    dataStartRow: 3,
    identifierHeaders: new Set(["상품코드", "상품명"]),
  });
  assert.ok(extracted.rows.length >= 2);
  assert.equal(extracted.rows[0].raw_row_json.E, 8640);
  assert.equal(extracted.rows[0].raw_row_json["발주 / 발주수량"], 8640);
  assert.equal(extracted.rows[1].raw_row_json["발주 / 발주수량"], 12000);
  assert.equal(extracted.rows[0].raw_row_json["상품코드"], "8809424490334");

  const columnMap = stabilizeColumnMap(
    {
      external_product_code: "상품코드",
      external_product_name: "상품명",
      quantity: "발주(260903) / 발주수량",
    },
    columns,
  );
  assert.equal(columnMap.quantity.column_letter, "E");
  assert.equal(columnMap.quantity.column_index, 4);
  assert.equal(columnMap.quantity.composite_header, "발주 / 발주수량");
  assert.deepEqual(mappingColumnsNotFound({ quantity: "발주 / 발주수량" }, columns), []);
  assert.deepEqual(mappingColumnsNotFound({ quantity: "발주(260910) / 발주수량" }, columns), []);

  const qty = resolveParsedQuantity(extracted.rows[0].raw_row_json, columnMap, columns, {});
  assert.equal(qty.ok, true);
  assert.equal(qty.quantity, 8640);
});

test("real 260903 workbook headers formulas and skip rows", () => {
  const buffer = fs.readFileSync(findRealPoPath());
  const workbook = readWorkbook(buffer);
  const sheet = workbook.Sheets["발주서"];
  assert.ok(sheet);
  const detected = detectHeaderRange(sheet);
  assert.equal(detected.headerStartRow, 1);
  assert.equal(detected.headerEndRow, 2);
  assert.equal(detected.dataStartRow, 3);

  const { columns } = headerFromRow(sheet, 2, { headerStartRow: 1, headerEndRow: 2 });
  const g = columns.find((col) => col.excel_col === "G");
  assert.equal(g.display_name, "발주 / 발주수량");
  assert.equal(g.normalized_name, "발주 / 발주수량");
  assert.equal(g.composite_header, "발주 / 발주수량");
  assert.equal(g.column_index, 6);
  const f = columns.find((col) => col.excel_col === "F");
  assert.equal(f.normalized_name, "발주 / 발주box");
  assert.equal(f.composite_header, "발주 / 발주box");
  assert.equal(f.column_index, 5);

  const suggested = suggestColumnMap(columns);
  assert.equal(suggested.quantity.column_letter, "G");
  assert.equal(suggested.quantity.composite_header, "발주 / 발주수량");
  assert.notEqual(suggested.quantity.column_letter, "F");
  const ambiguous = stabilizeColumnMap({ quantity: "발주" }, columns);
  assert.equal(ambiguous.quantity, undefined);

  const extracted = extractDataRows(sheet, 2, {
    headerStartRow: 1,
    headerEndRow: 2,
    dataStartRow: 3,
    identifierHeaders: new Set(["상품코드", "상품명"]),
  });
  const productRows = extracted.rows.filter((row) => row.raw_row_json["상품명"] || row.raw_row_json["상품코드"]);
  assert.equal(productRows.length, 2);
  assert.equal(productRows[0].source_row_number, 3);
  assert.equal(productRows[1].source_row_number, 4);
  assert.equal(productRows[0].raw_row_json["상품코드"], "8809424490334");
  assert.equal(productRows[0].raw_row_json["상품명"], "[티알에스큐] 두바이 스타일 쫀득 초콜릿 45g");
  assert.equal(productRows[0].raw_row_json.G, 8640);
  assert.equal(productRows[0].raw_row_json.F, 144);
  assert.equal(productRows[0].raw_row_json["발주 / 발주수량"], 8640);
  assert.equal(productRows[1].raw_row_json["상품코드"], "8809424490433");
  assert.equal(productRows[1].raw_row_json["발주 / 발주수량"], 12000);
  const qtyG = resolveParsedQuantity(productRows[0].raw_row_json, suggested, columns, {});
  assert.equal(qtyG.quantity, 8640);
  const qtyF = resolveParsedQuantity(
    productRows[0].raw_row_json,
    stabilizeColumnMap({ quantity: { column_letter: "F", composite_header: "발주 / 발주box" } }, columns),
    columns,
    {},
  );
  assert.equal(qtyF.quantity, 144);
  assert.ok(!extracted.rows.some((row) => row.source_row_number >= 6 && !row.raw_row_json["상품명"] && !row.raw_row_json["상품코드"] && !row.formulas["발주 / 발주수량"]));
});

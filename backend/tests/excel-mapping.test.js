import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findMappedColumn,
  mappedFieldForColumn,
  sanitizeColumnMap,
  stabilizeColumnMap,
  suggestColumnMap,
  suggestQuantityColumn,
} from "../src/domain/excel-mapping.js";

function esserHeaders() {
  return [
    { excel_col: "D", column_index: 3, composite_header: "상품명", normalized_name: "상품명", parent_normalized: "상품명", raw_header: "상품명" },
    { excel_col: "F", column_index: 5, composite_header: "발주 / 발주box", normalized_name: "발주 / 발주box", parent_normalized: "발주", raw_header: "발주(260903) / 발주box" },
    { excel_col: "G", column_index: 6, composite_header: "발주 / 발주수량", normalized_name: "발주 / 발주수량", parent_normalized: "발주", raw_header: "발주(260903) / 발주수량" },
  ];
}

test("quantity binding stores column letter and composite header", () => {
  const map = sanitizeColumnMap({
    quantity: {
      field: "quantity",
      columnIndex: 6,
      columnLetter: "G",
      normalizedHeader: "발주",
      compositeHeader: "발주 / 발주수량",
    },
  });
  assert.equal(map.quantity.column_index, 6);
  assert.equal(map.quantity.column_letter, "G");
  assert.equal(map.quantity.normalized_header, "발주");
  assert.equal(map.quantity.composite_header, "발주 / 발주수량");
});

test("duplicate normalized header 발주 is not resolved to the first column", () => {
  const headers = esserHeaders();
  assert.equal(findMappedColumn(headers, "발주"), null);
  assert.equal(stabilizeColumnMap({ quantity: "발주" }, headers).quantity, undefined);
  const restored = findMappedColumn(headers, {
    column_index: 6,
    column_letter: "G",
    composite_header: "발주 / 발주수량",
    normalized_header: "발주",
  });
  assert.equal(restored.excel_col, "G");
});

test("quantity auto-map prefers 발주수량 over 발주box", () => {
  const headers = esserHeaders();
  const suggested = suggestQuantityColumn(headers);
  assert.equal(suggested.excel_col, "G");
  const map = suggestColumnMap(headers);
  assert.equal(map.quantity.column_letter, "G");
  assert.equal(map.quantity.composite_header, "발주 / 발주수량");
  assert.equal(mappedFieldForColumn(map, headers[1]), null);
  assert.equal(mappedFieldForColumn(map, headers[2]), "quantity");
});

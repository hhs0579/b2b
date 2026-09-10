/**
 * 거래명세서 MASTER 허용 Cell / 고정 구조.
 * 셀 주소는 이 모듈에만 둔다. 생성·검사 코드는 여기 상수를 참조한다.
 */

export const INVOICE_SHEET_NAME = "2021-12-28";
export const INVOICE_PRINT_AREA = "'2021-12-28'!$A$1:$O$19";
export const INVOICE_ITEM_ROW_START = 10;
export const INVOICE_ITEM_ROW_END = 16;
export const INVOICE_ITEM_ROW_COUNT = 7;
export const INVOICE_SUM_ROW = 17;
export const INVOICE_NOTE_ROW = 18;
export const INVOICE_PRINT_LAST_ROW = 19;
export const INVOICE_TEMPLATE_ITEM_ROW = 16;
export const INVOICE_MAX_SHEET_DATA_ROW = 18;
export const INVOICE_MERGE_COUNT = 66;
export const ITEM_ROW_MERGE_PAIRS = Object.freeze([
  ["C", "D"],
  ["E", "F"],
  ["G", "H"],
  ["I", "J"],
  ["K", "M"],
  ["N", "O"],
]);

export const MASTER_FILE_NAME = "invoice_MASTER.xlsx";
export const MASTER_MANIFEST_NAME = "invoice_MASTER.manifest.json";
export const SOURCE_INVOICE_FILE_NAME = "날짜_거래처명_거래명세서.xlsx";

export const STAMP_MEDIA_PART = "xl/media/image1.jpeg";
export const STAMP_IMAGE_SHA256 =
  "5ceb78cd86c20717d40410ea72f8b84b8806d165d1ab9adc26437e873e4d3128";
export const STAMP_DRAWING_PART = "xl/drawings/drawing1.xml";
export const STAMP_DRAWING_RELS_PART = "xl/drawings/_rels/drawing1.xml.rels";

export const FROZEN_PARTS = Object.freeze([
  "xl/styles.xml",
  "xl/theme/theme1.xml",
  STAMP_DRAWING_PART,
  STAMP_DRAWING_RELS_PART,
  STAMP_MEDIA_PART,
  "xl/workbook.xml",
  "xl/worksheets/_rels/sheet1.xml.rels",
]);

export const CELLS = Object.freeze({
  DATE_YEAR: "C4",
  DATE_MONTH: "E4",
  DATE_DAY: "G4",
  DATE_ITEM: "B10",
  CLIENT_NAME: "C6",
  NOTE: "C18",
  TOTAL_AMOUNT: "D8",
  QTY_SUM: "G17",
  AMOUNT_SUM: "K17",
});

export const ITEM_COLUMNS = Object.freeze({
  NAME: "C",
  OPTION: "E",
  QTY: "G",
  PRICE: "I",
  AMOUNT: "K",
  NOTE: "N",
});

export const ITEM_ROWS = Object.freeze(
  Array.from({ length: INVOICE_ITEM_ROW_COUNT }, (_, index) => {
    const row = INVOICE_ITEM_ROW_START + index;
    const n = index + 1;
    return Object.freeze({
      index: n,
      row,
      NAME: `${ITEM_COLUMNS.NAME}${row}`,
      OPTION: `${ITEM_COLUMNS.OPTION}${row}`,
      QTY: `${ITEM_COLUMNS.QTY}${row}`,
      PRICE: `${ITEM_COLUMNS.PRICE}${row}`,
      AMOUNT: `${ITEM_COLUMNS.AMOUNT}${row}`,
      NOTE: `${ITEM_COLUMNS.NOTE}${row}`,
    });
  }),
);

export const WRITABLE_CELLS = Object.freeze([
  CELLS.DATE_YEAR,
  CELLS.DATE_MONTH,
  CELLS.DATE_DAY,
  CELLS.DATE_ITEM,
  CELLS.CLIENT_NAME,
  CELLS.NOTE,
  ...ITEM_ROWS.flatMap((item) => [item.NAME, item.OPTION, item.QTY, item.PRICE, item.NOTE]),
]);

export const FORMULA_CELLS = Object.freeze({
  [CELLS.TOTAL_AMOUNT]: Object.freeze({ text: "K17+N17" }),
  K10: Object.freeze({ text: "G10*I10" }),
  K11: Object.freeze({ text: "G11*I11" }),
  K12: Object.freeze({ text: "G12*I12" }),
  K13: Object.freeze({
    text: "G13*I13",
    shared: true,
    si: "0",
    ref: "K13:K15",
  }),
  K14: Object.freeze({ text: "G14*I14" }),
  K15: Object.freeze({
    text: "",
    shared: true,
    si: "0",
    implied: "G15*I15",
  }),
  K16: Object.freeze({
    text: "I16*G16",
    shared: true,
    si: "1",
    ref: "K16",
  }),
  [CELLS.QTY_SUM]: Object.freeze({
    text: "SUM(G10:H16)",
    note: "승인된 계산 오류 수정. 품목 행 10~16 수량을 모두 합산한다.",
  }),
  [CELLS.AMOUNT_SUM]: Object.freeze({ text: "SUM(K10:M16)" }),
});

export const SAMPLE_SST_INDEXES = Object.freeze([
  34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50,
]);

export const SAMPLE_TEXT_MARKERS = Object.freeze([
  "예시0",
  "예시1",
  "예시2",
  "예시3",
  "예시4",
  "제이와이컴퍼니",
  "배송방법 : 택배출고",
  "4000*4",
  "5000*4",
  "5,000*4",
  "5000*1",
  "5000*2",
]);

export const EXPECTED_ROW_HEIGHTS = Object.freeze({
  1: "5.25",
  2: "58.5",
  3: "23.1",
  4: "36",
  5: "24",
  6: "23.1",
  7: "23.1",
  8: "33.75",
  9: "24.95",
  10: "24.95",
  11: "24.95",
  12: "27",
  13: "27",
  14: "27",
  15: "27",
  16: "27",
  17: "23.1",
  18: "58.5",
});

export const EXPECTED_COLUMN_WIDTHS = Object.freeze({
  1: "1.625",
  2: "11.375",
  3: "14.125",
  4: "18.375",
  5: "5.625",
  6: "3.625",
  7: "5.625",
  8: "7.625",
  "9-10": "7",
  11: "4.5",
  12: "8.625",
  13: "10.625",
  14: "6.125",
  15: "10.625",
  16: "22.625",
  17: "9",
});

export const EXPECTED_PAGE_MARGINS = Object.freeze({
  left: "3.937007874015748E-2",
  right: "3.937007874015748E-2",
  top: "3.937007874015748E-2",
  bottom: "3.937007874015748E-2",
  header: "3.937007874015748E-2",
  footer: "3.937007874015748E-2",
});

export const EXPECTED_PAGE_SETUP = Object.freeze({
  paperSize: "9",
  scale: "80",
  orientation: "portrait",
});

export const EXPECTED_PRINT_OPTIONS = Object.freeze({
  horizontalCentered: "1",
  gridLinesSet: "0",
});

export const EXPECTED_MERGE_REFS = Object.freeze([
  "B10:B16",
  "B17:F17",
  "B2:O2",
  "B3:I3",
  "B5:I5",
  "B7:I7",
  "C10:D10",
  "C11:D11",
  "C12:D12",
  "C13:D13",
  "C14:D14",
  "C15:D15",
  "C16:D16",
  "C18:K18",
  "C6:G6",
  "C9:D9",
  "D8:K8",
  "E10:F10",
  "E11:F11",
  "E12:F12",
  "E13:F13",
  "E14:F14",
  "E15:F15",
  "E16:F16",
  "E9:F9",
  "G10:H10",
  "G11:H11",
  "G12:H12",
  "G13:H13",
  "G14:H14",
  "G15:H15",
  "G16:H16",
  "G17:H17",
  "G9:H9",
  "I10:J10",
  "I11:J11",
  "I12:J12",
  "I13:J13",
  "I14:J14",
  "I15:J15",
  "I16:J16",
  "I17:J17",
  "I9:J9",
  "K10:M10",
  "K11:M11",
  "K12:M12",
  "K13:M13",
  "K14:M14",
  "K15:M15",
  "K16:M16",
  "K17:O17",
  "K3:K7",
  "K9:M9",
  "M18:O18",
  "M3:O3",
  "M5:O5",
  "M7:O7",
  "M8:O8",
  "N10:O10",
  "N11:O11",
  "N12:O12",
  "N13:O13",
  "N14:O14",
  "N15:O15",
  "N16:O16",
  "N9:O9",
]);

export const ITEM_COLUMN_ROLES = Object.freeze({
  B: "일자 (B10:B16 병합, DATE_ITEM)",
  C: "품목명 (C:D 병합)",
  E: "옵션 (E:F 병합)",
  G: "수량 (G:H 병합)",
  I: "단가 VAT포함 (I:J 병합)",
  K: "공급가액 수식 수량×단가 (K:M 병합, 쓰기 금지)",
  N: "비고 (N:O 병합)",
});

export function itemRowSpec(excelRow) {
  return Object.freeze({
    index: excelRow - INVOICE_ITEM_ROW_START + 1,
    row: excelRow,
    NAME: `${ITEM_COLUMNS.NAME}${excelRow}`,
    OPTION: `${ITEM_COLUMNS.OPTION}${excelRow}`,
    QTY: `${ITEM_COLUMNS.QTY}${excelRow}`,
    PRICE: `${ITEM_COLUMNS.PRICE}${excelRow}`,
    AMOUNT: `${ITEM_COLUMNS.AMOUNT}${excelRow}`,
    NOTE: `${ITEM_COLUMNS.NOTE}${excelRow}`,
  });
}

export function itemRowsForCount(lineCount) {
  const count = Math.max(INVOICE_ITEM_ROW_COUNT, Number(lineCount) || 0);
  return Object.freeze(
    Array.from({ length: count }, (_, index) => itemRowSpec(INVOICE_ITEM_ROW_START + index)),
  );
}

export function invoiceSheetLayout(lineCount) {
  const itemCount = Math.max(INVOICE_ITEM_ROW_COUNT, Number(lineCount) || 0);
  const firstItemRow = INVOICE_ITEM_ROW_START;
  const lastItemRow = firstItemRow + itemCount - 1;
  const summaryRow = lastItemRow + 1;
  const noteRow = summaryRow + 1;
  const printLastRow = noteRow + 1;
  const extra = itemCount - INVOICE_ITEM_ROW_COUNT;
  return Object.freeze({
    firstItemRow,
    lastItemRow,
    summaryRow,
    noteRow,
    printLastRow,
    itemStart: firstItemRow,
    itemEnd: lastItemRow,
    sumRow: summaryRow,
    itemCount,
    extra,
    expanded: extra > 0,
    qtySum: `G${summaryRow}`,
    amountSum: `K${summaryRow}`,
    note: `C${noteRow}`,
    totalAmount: CELLS.TOTAL_AMOUNT,
    totalAmountFormula: `K${summaryRow}+N${summaryRow}`,
    qtySumFormula: `SUM(G${firstItemRow}:H${lastItemRow})`,
    amountSumFormula: `SUM(K${firstItemRow}:M${lastItemRow})`,
    printArea: `'${INVOICE_SHEET_NAME}'!$A$1:$O$${printLastRow}`,
    dimensionRef: extra > 0 ? `A1:O${printLastRow}` : "B1:P18",
    itemRows: itemRowsForCount(itemCount),
  });
}

export function writableCellsForLayout(layout) {
  return Object.freeze([
    CELLS.DATE_YEAR,
    CELLS.DATE_MONTH,
    CELLS.DATE_DAY,
    CELLS.DATE_ITEM,
    CELLS.CLIENT_NAME,
    layout.note,
    ...layout.itemRows.flatMap((item) => [item.NAME, item.OPTION, item.QTY, item.PRICE, item.NOTE]),
  ]);
}

export function formulaCellsForLayout(layout) {
  const cells = {
    [CELLS.TOTAL_AMOUNT]: Object.freeze({ text: layout.totalAmountFormula }),
    [layout.qtySum]: Object.freeze({ text: layout.qtySumFormula }),
    [layout.amountSum]: Object.freeze({ text: layout.amountSumFormula }),
  };
  for (const item of layout.itemRows) {
    if (layout.expanded && item.row > INVOICE_ITEM_ROW_END) {
      cells[item.AMOUNT] = Object.freeze({ text: `G${item.row}*I${item.row}` });
      continue;
    }
    const master = FORMULA_CELLS[item.AMOUNT];
    cells[item.AMOUNT] = master || Object.freeze({ text: `G${item.row}*I${item.row}` });
  }
  return cells;
}

export function itemCell(rowIndex, field) {
  const item = itemRowSpec(INVOICE_ITEM_ROW_START + rowIndex - 1);
  const address = item[field];
  if (!address) {
    throw new Error(`알 수 없는 품목 필드: ${field}`);
  }
  return address;
}

export function isWritableCell(address) {
  return WRITABLE_CELLS.includes(address);
}

export function isFormulaCell(address) {
  return Object.hasOwn(FORMULA_CELLS, address);
}

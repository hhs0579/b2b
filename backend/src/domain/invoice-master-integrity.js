import {
  CELLS,
  EXPECTED_COLUMN_WIDTHS,
  EXPECTED_MERGE_REFS,
  EXPECTED_PAGE_MARGINS,
  EXPECTED_PAGE_SETUP,
  EXPECTED_PRINT_OPTIONS,
  EXPECTED_ROW_HEIGHTS,
  FORMULA_CELLS,
  INVOICE_ITEM_ROW_END,
  INVOICE_ITEM_ROW_START,
  INVOICE_MAX_SHEET_DATA_ROW,
  INVOICE_MERGE_COUNT,
  INVOICE_PRINT_AREA,
  INVOICE_SHEET_NAME,
  SAMPLE_TEXT_MARKERS,
  STAMP_IMAGE_SHA256,
  STAMP_MEDIA_PART,
  WRITABLE_CELLS,
} from "./invoice-template-map.js";

export function collectIntegrityFindings(inspect, options = {}) {
  const findings = [];
  const { sourceInspect, beforeSha256, afterSha256, template } = options;
  const expectedImageSha = template?.stampSha256 || STAMP_IMAGE_SHA256;
  const stampMediaPart = template?.stampMediaPart || STAMP_MEDIA_PART;
  const stampEmbedId = template?.stampEmbedId || "rId1";

  if (inspect.sheetName !== INVOICE_SHEET_NAME) {
    findings.push({
      id: "TEST_1",
      ok: false,
      message: `Sheet 이름 ${inspect.sheetName} ≠ ${INVOICE_SHEET_NAME}`,
    });
  } else {
    findings.push({ id: "TEST_1", ok: true, message: `Sheet 이름 = ${INVOICE_SHEET_NAME}` });
  }

  if (inspect.printArea !== INVOICE_PRINT_AREA) {
    findings.push({
      id: "TEST_2",
      ok: false,
      message: `Print Area ${inspect.printArea} ≠ ${INVOICE_PRINT_AREA}`,
    });
  } else {
    findings.push({ id: "TEST_2", ok: true, message: "Print Area 유지" });
  }

  const mergeOk =
    inspect.merges.count === INVOICE_MERGE_COUNT &&
    JSON.stringify(inspect.merges.refs) === JSON.stringify([...EXPECTED_MERGE_REFS]);
  findings.push({
    id: "TEST_3",
    ok: mergeOk,
    message: mergeOk
      ? `병합셀 ${inspect.merges.count}개 유지`
      : `병합셀 불일치 count=${inspect.merges.count}`,
  });

  findings.push({
    id: "TEST_4",
    ok: Boolean(inspect.media.exists),
    message: inspect.media.exists ? `${stampMediaPart} 존재` : `${stampMediaPart} 없음`,
  });

  const imageShaOk =
    Boolean(inspect.media.sha256) &&
    inspect.media.sha256 === expectedImageSha &&
    (!sourceInspect ||
      options.requireSourceStampMatch === false ||
      sourceInspect.media.sha256 === expectedImageSha);
  findings.push({
    id: "TEST_5",
    ok: imageShaOk,
    message: imageShaOk
      ? `image1.jpeg checksum=${inspect.media.sha256}`
      : "image1.jpeg checksum 불일치",
  });

  const stampTarget = `../media/${stampMediaPart.split("/").pop()}`;
  const drawingRel = inspect.drawingRels.find(
    (rel) => rel.target === stampTarget && rel.type.includes("/image"),
  );
  const drawingRelOk = Boolean(drawingRel);
  findings.push({
    id: "TEST_6",
    ok: drawingRelOk,
    message: drawingRelOk ? `drawing → ${stampTarget} 관계 유지` : "drawing rel 없음",
  });

  const stampOk =
    inspect.drawing?.picCount === 2 &&
    inspect.drawing.embeds.every((embed) => embed === stampEmbedId) &&
    Boolean(drawingRel);
  findings.push({
    id: "TEST_7",
    ok: stampOk,
    message: stampOk ? "도장 이미지 2개 모두 rId1 참조" : "도장 이미지 참조 불일치",
  });

  const heightOk = Object.entries(EXPECTED_ROW_HEIGHTS).every(
    ([row, ht]) => inspect.rowHeights[Number(row)] === ht,
  );
  findings.push({
    id: "TEST_8",
    ok: heightOk,
    message: heightOk ? "행 높이 유지" : "행 높이 불일치",
  });

  const widthByKey = {};
  for (const col of inspect.columns) {
    const key = col.min === col.max ? col.min : `${col.min}-${col.max}`;
    widthByKey[key] = col.width;
  }
  const widthOk = Object.entries(EXPECTED_COLUMN_WIDTHS).every(
    ([key, width]) => widthByKey[key] === width,
  );
  findings.push({
    id: "TEST_9",
    ok: widthOk,
    message: widthOk ? "열 너비 유지" : "열 너비 불일치",
  });

  const marginsOk = Object.entries(EXPECTED_PAGE_MARGINS).every(
    ([key, value]) => inspect.pageMargins[key] === value,
  );
  findings.push({
    id: "TEST_10",
    ok: marginsOk,
    message: marginsOk ? "pageMargins 유지" : "pageMargins 불일치",
  });

  const setupOk = Object.entries(EXPECTED_PAGE_SETUP).every(
    ([key, value]) => inspect.pageSetup[key] === value,
  );
  findings.push({
    id: "TEST_11",
    ok: setupOk,
    message: setupOk ? "pageSetup 유지" : "pageSetup 불일치",
  });

  const dataRowsOk =
    inspect.rowHeights[INVOICE_ITEM_ROW_START] != null &&
    inspect.rowHeights[INVOICE_ITEM_ROW_END] != null;
  findings.push({
    id: "TEST_12",
    ok: dataRowsOk,
    message: dataRowsOk
      ? `데이터 입력행 ${INVOICE_ITEM_ROW_START}~${INVOICE_ITEM_ROW_END}`
      : "데이터 입력행 없음",
  });

  const extraRowOk = inspect.maxRow <= INVOICE_MAX_SHEET_DATA_ROW;
  findings.push({
    id: "TEST_13",
    ok: extraRowOk,
    message: extraRowOk
      ? `sheetData 최대 행 ${inspect.maxRow} (7행 초과 품목 구조 없음)`
      : `sheetData 최대 행 ${inspect.maxRow}`,
  });

  const leftover = [];
  for (const ref of WRITABLE_CELLS) {
    const value = inspect.cells[ref]?.value;
    if (value == null || value === "") {
      continue;
    }
    leftover.push(`${ref}=${value}`);
  }
  for (const cell of Object.values(inspect.cells)) {
    const text = String(cell.value ?? "");
    if (SAMPLE_TEXT_MARKERS.some((marker) => text.includes(marker))) {
      leftover.push(`${cell.ref}:${text}`);
    }
  }
  findings.push({
    id: "TEST_14",
    ok: leftover.length === 0,
    message:
      leftover.length === 0 ? "샘플 데이터 제거 확인" : `샘플 잔여: ${leftover.slice(0, 8).join(", ")}`,
  });

  const missingFormulas = [];
  for (const [ref, expected] of Object.entries(FORMULA_CELLS)) {
    const actual = inspect.formulas[ref];
    if (!actual) {
      missingFormulas.push(`${ref} 없음`);
      continue;
    }
    if (actual.text !== expected.text) {
      missingFormulas.push(`${ref} text ${actual.text} ≠ ${expected.text}`);
    }
    if (Boolean(expected.shared) !== Boolean(actual.shared)) {
      missingFormulas.push(`${ref} shared 불일치`);
    }
    if (expected.si && actual.si !== expected.si) {
      missingFormulas.push(`${ref} si 불일치`);
    }
    if (expected.ref && actual.ref !== expected.ref) {
      missingFormulas.push(`${ref} ref 불일치`);
    }
  }
  findings.push({
    id: "TEST_15",
    ok: missingFormulas.length === 0,
    message:
      missingFormulas.length === 0
        ? "필수 수식 존재 확인"
        : `수식 불일치: ${missingFormulas.join(", ")}`,
  });

  if (beforeSha256 != null && afterSha256 != null) {
    findings.push({
      id: "TEST_16",
      ok: beforeSha256 === afterSha256,
      message:
        beforeSha256 === afterSha256
          ? "MASTER checksum 작업 전후 동일"
          : "MASTER checksum이 작업 중 변경됨",
    });
  }

  return findings;
}

export function headerCells() {
  return {
    date: {
      year: CELLS.DATE_YEAR,
      month: CELLS.DATE_MONTH,
      day: CELLS.DATE_DAY,
      item: CELLS.DATE_ITEM,
    },
    client: CELLS.CLIENT_NAME,
    note: CELLS.NOTE,
  };
}

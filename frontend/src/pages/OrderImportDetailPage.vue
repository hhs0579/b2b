<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { apiRequest } from "../api/client";
import { IMPORT_STATUS_LABELS, MATCH_STATUS_LABELS, MAPPING_FIELD_LABELS } from "../utils/labels";
import { blockedDeleteMessage, confirmHardDelete } from "../utils/confirm-delete";
import { formatProductCode } from "../utils/format";
import { flattenProductOptions, optionLabel } from "../utils/products";

const route = useRoute();
const router = useRouter();
const item = ref(null);
const preview = ref(null);
const rows = ref([]);
const products = ref([]);
const headerStartRow = ref(1);
const headerEndRow = ref(1);
const dataStartRow = ref(2);
const headerColumns = ref([]);
const suggestedRange = ref(null);
const sheetName = ref("");
const columnMap = ref({});
const selectedRow = ref(null);
const saveAlias = ref(true);
const matchProductId = ref("");
const error = ref("");
const loading = ref(false);
const rawOpen = ref(null);
const quantityDrafts = ref({});
const quantitySaving = ref(null);
const preparing = ref(false);

const selectedSheet = computed(() => {
  return preview.value?.sheets?.find((sheet) => sheet.sheet_name === sheetName.value) || preview.value?.sheets?.[0];
});

const headerOptions = computed(() => headerColumns.value || []);

function headerLabel(col) {
  return col.composite_header || col.display_name || col.normalized_name || col.excel_col;
}

function bindingLetter(stored) {
  if (stored == null || stored === "") return "";
  if (typeof stored === "object") {
    if (stored.column_letter || stored.columnLetter) {
      return stored.column_letter || stored.columnLetter;
    }
    return bindingLetter(stored.composite_header || stored.compositeHeader || stored.normalized_header || "");
  }
  const col = headerColumns.value.find((item) => {
    return (
      item.excel_col === stored ||
      item.composite_header === stored ||
      item.normalized_name === stored
    );
  });
  return col?.excel_col || "";
}

function selectedLetter(field) {
  return bindingLetter(columnMap.value[field]);
}

function bindingFromHeader(col) {
  return {
    column_index: col.column_index,
    column_letter: col.excel_col,
    raw_header: col.raw_header || col.display_name || "",
    normalized_header: col.parent_normalized || "",
    composite_header: col.composite_header || col.normalized_name || col.display_name || "",
  };
}

function setFieldColumn(field, letter) {
  const next = { ...columnMap.value };
  if (!letter) {
    delete next[field];
    columnMap.value = next;
    return;
  }
  const col = headerColumns.value.find((item) => item.excel_col === letter);
  if (!col) {
    return;
  }
  for (const [key, stored] of Object.entries(next)) {
    if (key !== field && bindingLetter(stored) === letter) {
      delete next[key];
    }
  }
  next[field] = bindingFromHeader(col);
  columnMap.value = next;
}

function mappedTargetLabel(col) {
  const matched = Object.entries(columnMap.value).find(([, stored]) => bindingLetter(stored) === col.excel_col);
  if (!matched) return "—";
  const field = MAPPING_FIELD_LABELS.find((item) => item.key === matched[0]);
  return field ? field.label.replace(" *", "") : matched[0];
}

function previewRowClass(rowNumber) {
  const n = Number(rowNumber);
  if (n >= Number(headerStartRow.value) && n <= Number(headerEndRow.value)) return "header-row";
  if (n === Number(dataStartRow.value)) return "data-start-row";
  return "";
}

const currentStep = computed(() => {
  if (!item.value) return 1;
  if (item.value.duplicate_hash_detected && !item.value.duplicate_acknowledged) return 1;
  if (item.value.status === "MAPPING_REQUIRED" || !item.value.mapping_ok) return item.value.sheet_name ? 3 : 2;
  if (!rows.value.length) return 3;
  return 4;
});

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [detail, raw, productData] = await Promise.all([
      apiRequest("GET", `/order-imports/${route.params.id}`),
      apiRequest("GET", `/order-imports/${route.params.id}/raw-preview`),
      apiRequest("GET", "/products?is_active=true&limit=200"),
    ]);
    item.value = detail;
    preview.value = raw;
    products.value = flattenProductOptions(productData.items);
    sheetName.value = detail.sheet_name || raw.selected_sheet || raw.sheets?.[0]?.sheet_name || "";
    headerStartRow.value = detail.header_start_row || detail.header_row_number || 1;
    headerEndRow.value = detail.header_end_row || detail.header_row_number || 1;
    dataStartRow.value = detail.data_start_row || Number(headerEndRow.value) + 1;
    headerColumns.value = detail.header_columns || raw.header_columns || [];
    suggestedRange.value = detail.suggested_header_range || raw.suggested_header_range || null;
    columnMap.value = { ...(detail.column_map || {}) };
    if (detail.parsed_row_count > 0) {
      const parsed = await apiRequest("GET", `/order-imports/${route.params.id}/rows`);
      rows.value = parsed.items;
      item.value = parsed.import;
      syncQuantityDrafts(parsed.items);
    } else {
      rows.value = [];
    }
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function refreshHeaderColumns() {
  if (!route.params.id || !sheetName.value) return;
  try {
    const params = new URLSearchParams({
      sheet_name: sheetName.value,
      header_start_row: String(headerStartRow.value),
      header_end_row: String(headerEndRow.value),
      data_start_row: String(dataStartRow.value),
    });
    const raw = await apiRequest("GET", `/order-imports/${route.params.id}/raw-preview?${params.toString()}`);
    preview.value = raw;
    headerColumns.value = raw.header_columns || [];
    suggestedRange.value = raw.suggested_header_range || suggestedRange.value;
  } catch (err) {
    error.value = err.message;
  }
}

function applySuggestedRange() {
  if (!suggestedRange.value) return;
  headerStartRow.value = suggestedRange.value.headerStartRow;
  headerEndRow.value = suggestedRange.value.headerEndRow;
  dataStartRow.value = suggestedRange.value.dataStartRow;
}

watch([headerStartRow, headerEndRow, dataStartRow, sheetName], () => {
  if (loading.value) return;
  refreshHeaderColumns();
});

async function acknowledge() {
  error.value = "";
  try {
    item.value = await apiRequest("POST", `/order-imports/${route.params.id}/acknowledge-duplicate`);
  } catch (err) {
    error.value = err.message;
  }
}

function syncQuantityDrafts(items) {
  const next = {};
  for (const row of items) {
    next[row.id] = row.quantity == null ? "" : String(row.quantity);
  }
  quantityDrafts.value = next;
}

function quantityHint(row) {
  if (row.quantity_source === "MANUAL") {
    return "수동입력";
  }
  if (row.quantity == null || row.validation_errors?.some((message) => message.includes("수량"))) {
    return "수량 필요";
  }
  return "자동";
}

async function saveQuantity(row) {
  error.value = "";
  const typed = String(quantityDrafts.value[row.id] ?? "").trim();
  if (!/^[1-9]\d*$/.test(typed)) {
    error.value = "수량은 1 이상의 정수여야 합니다.";
    return;
  }
  quantitySaving.value = row.id;
  try {
    const result = await apiRequest("PATCH", `/order-imports/${route.params.id}/rows/${row.id}/quantity`, {
      quantity: Number(typed),
    });
    item.value = result.import;
    rows.value = rows.value.map((itemRow) => (itemRow.id === row.id ? result.row : itemRow));
    quantityDrafts.value = { ...quantityDrafts.value, [row.id]: String(result.row.quantity) };
    if (selectedRow.value?.id === row.id) {
      selectedRow.value = result.row;
    }
  } catch (err) {
    error.value = err.message;
  } finally {
    quantitySaving.value = null;
  }
}

async function resetQuantity(row) {
  error.value = "";
  quantitySaving.value = row.id;
  try {
    const result = await apiRequest("PATCH", `/order-imports/${route.params.id}/rows/${row.id}/quantity`, {
      reset: true,
      quantity: null,
    });
    item.value = result.import;
    rows.value = rows.value.map((itemRow) => (itemRow.id === row.id ? result.row : itemRow));
    quantityDrafts.value = {
      ...quantityDrafts.value,
      [row.id]: result.row.quantity == null ? "" : String(result.row.quantity),
    };
  } catch (err) {
    error.value = err.message;
  } finally {
    quantitySaving.value = null;
  }
}

async function saveConfigAndParse() {
  error.value = "";
  const hasManual = rows.value.some((row) => row.quantity_source === "MANUAL");
  if (hasManual) {
    const confirmed = window.confirm("재분석 시 수동입력값이 초기화될 수 있습니다. 계속할까요?");
    if (!confirmed) {
      return;
    }
  }
  try {
    const saved = await apiRequest("PATCH", `/order-imports/${route.params.id}/config`, {
      sheet_name: sheetName.value,
      header_start_row: Number(headerStartRow.value),
      header_end_row: Number(headerEndRow.value),
      data_start_row: Number(dataStartRow.value),
      header_row_number: Number(headerEndRow.value),
      column_map: columnMap.value,
      save_mapping: true,
    });
    item.value = saved;
    columnMap.value = { ...(saved.column_map || columnMap.value) };
    headerColumns.value = saved.header_columns || headerColumns.value;
    const parsed = await apiRequest("POST", `/order-imports/${route.params.id}/parse`);
    item.value = parsed;
    columnMap.value = { ...(parsed.column_map || columnMap.value) };
    headerColumns.value = parsed.header_columns || headerColumns.value;
    rows.value = parsed.items;
    syncQuantityDrafts(parsed.items);
  } catch (err) {
    error.value = err.message;
    await load();
  }
}

async function matchSelected() {
  error.value = "";
  if (!selectedRow.value || !matchProductId.value) {
    error.value = "내부 상품을 선택하세요.";
    return;
  }
  try {
    const result = await apiRequest("PATCH", `/order-imports/${route.params.id}/rows/${selectedRow.value.id}/match`, {
      product_option_id: Number(matchProductId.value),
      save_alias: saveAlias.value,
    });
    item.value = result.import;
    const parsed = await apiRequest("GET", `/order-imports/${route.params.id}/rows`);
    rows.value = parsed.items;
    syncQuantityDrafts(parsed.items);
    selectedRow.value = parsed.items.find((row) => row.id === selectedRow.value.id) || null;
  } catch (err) {
    error.value = err.message;
  }
}

async function removeImport() {
  error.value = "";
  try {
    const impact = await apiRequest("GET", `/order-imports/${route.params.id}/delete-impact`);
    if (!impact.can_delete) {
      window.alert(blockedDeleteMessage("이 발주서는 삭제할 수 없습니다.", impact.references, {
        confirmed_orders: "확정/취소 거래",
      }));
      return;
    }
    const deleteDraft = impact.delete_draft_required
      ? window.confirm("연결된 DRAFT 거래도 함께 삭제할까요?")
      : false;
    if (!confirmHardDelete("이 발주서 업로드를 완전히 삭제합니다.\n원본 파일과 분석 행이 정리됩니다.")) {
      return;
    }
    await apiRequest("DELETE", `/order-imports/${route.params.id}${deleteDraft ? "?delete_draft=true" : ""}`);
    await router.push("/order-imports");
  } catch (err) {
    error.value = err.message;
  }
}

async function prepareOrder() {
  error.value = "";
  preparing.value = true;
  try {
    const order = await apiRequest("POST", `/order-imports/${route.params.id}/order`);
    await router.push(`/orders/${order.id}/preview`);
  } catch (err) {
    error.value = err.message;
  } finally {
    preparing.value = false;
  }
}

function rowClass(row) {
  if (row.match_status === "UNMATCHED" || row.match_status === "MATCHED_BUT_INACTIVE") return "row-unmatched";
  if (row.validation_status === "INVALID") return "row-invalid";
  return "";
}

onMounted(load);
</script>

<template>
  <section class="page wide">
    <div class="page-header">
      <h1>발주서 분석</h1>
      <div>
        <button type="button" @click="router.push('/order-imports')">내역</button>
        <button type="button" @click="router.push('/order-imports/new')">새 업로드</button>
        <button type="button" class="btn-danger" @click="removeImport">삭제</button>
      </div>
    </div>

    <ol class="wizard-steps">
      <li :class="{ active: currentStep === 1 }">1. 업로드</li>
      <li :class="{ active: currentStep === 2 }">2. Sheet/Header</li>
      <li :class="{ active: currentStep === 3 }">3. 컬럼 Mapping</li>
      <li :class="{ active: currentStep === 4 }">4. 상품 매칭</li>
      <li :class="{ active: item?.status === 'READY' }">5. Preview 완료</li>
    </ol>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading">불러오는 중...</p>

    <template v-if="item">
      <table class="status-table">
        <tbody>
          <tr><th>매출처</th><td>{{ item.client_name }} ({{ item.client_code }})</td></tr>
          <tr><th>발주일</th><td>{{ item.order_date }}</td></tr>
          <tr><th>원본파일</th><td>{{ item.original_file_name }}</td></tr>
          <tr><th>상태</th><td>{{ IMPORT_STATUS_LABELS[item.status] || item.status }}</td></tr>
        </tbody>
      </table>
      <p v-if="item.status === 'READY'" class="form-actions">
        <button type="button" :disabled="preparing" @click="prepareOrder">금액 계산 및 거래 준비</button>
      </p>

      <p v-if="item.duplicate_hash_detected && !item.duplicate_acknowledged" class="notice">
        같은 매출처에 동일한 파일 hash가 있습니다. 자동으로 차단하지는 않습니다.
        <button type="button" @click="acknowledge">중복 파일임을 확인하고 계속</button>
      </p>

      <div class="summary-grid" v-if="item.parsed_row_count != null">
        <div>총 데이터행 <strong>{{ item.source_row_count }}</strong></div>
        <div>정상 <strong>{{ item.valid_row_count }}</strong></div>
        <div>오류 <strong>{{ item.invalid_row_count }}</strong></div>
        <div>상품 매칭 <strong>{{ item.matched_row_count }}</strong></div>
        <div>미매칭 <strong>{{ item.unmatched_row_count }}</strong></div>
      </div>

      <h3>STEP 2 Sheet / Header</h3>
      <form class="toolbar" @submit.prevent>
        <label>
          Sheet
          <select v-model="sheetName">
            <option v-for="sheet in preview?.sheets || []" :key="sheet.sheet_name" :value="sheet.sheet_name">
              {{ sheet.sheet_name }} ({{ sheet.used_range || "빈 시트" }})
            </option>
          </select>
        </label>
        <label>
          헤더 시작행
          <input v-model.number="headerStartRow" type="number" min="1" />
        </label>
        <label>
          헤더 종료행
          <input v-model.number="headerEndRow" type="number" min="1" />
        </label>
        <label>
          데이터 시작행
          <input v-model.number="dataStartRow" type="number" min="1" />
        </label>
      </form>
      <p v-if="suggestedRange" class="suggest-note">
        자동 탐지 제안: 헤더 {{ suggestedRange.headerStartRow }}–{{ suggestedRange.headerEndRow }}행,
        데이터 {{ suggestedRange.dataStartRow }}행부터. 사용자가 수정할 수 있습니다.
        <button type="button" @click="applySuggestedRange">제안 적용</button>
      </p>
      <p v-if="selectedSheet">사용영역: {{ selectedSheet.used_range || "-" }} / 미리보기 {{ selectedSheet.preview.length }}행</p>
      <div class="table-scroll">
        <table class="data-table raw-preview">
          <thead>
            <tr>
              <th>Excel Row</th>
              <th v-for="col in selectedSheet?.columns || []" :key="col">{{ col }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in selectedSheet?.preview || []"
              :key="row.row_number"
              :class="previewRowClass(row.row_number)"
            >
              <td>{{ row.row_number }}</td>
              <td v-for="(cell, idx) in row.cells" :key="idx">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>Header Preview</h3>
      <div class="table-scroll">
        <table class="data-table header-preview">
          <thead>
            <tr>
              <th>Excel 열</th>
              <th>Header</th>
              <th>정규화 Header</th>
              <th>매핑 대상</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="col in headerColumns" :key="col.excel_col">
              <td>{{ col.excel_col }}</td>
              <td>{{ headerLabel(col) }}</td>
              <td>{{ headerLabel(col) }}</td>
              <td>{{ mappedTargetLabel(col) }}</td>
            </tr>
            <tr v-if="headerColumns.length === 0">
              <td colspan="4">헤더를 읽을 수 없습니다.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>STEP 3 컬럼 Mapping</h3>
      <p v-if="item.mapping_missing_columns?.length" class="notice">
        저장된 컬럼을 찾을 수 없습니다: {{ item.mapping_missing_columns.join(", ") }}
      </p>
      <div class="mapping-grid">
        <label v-for="field in MAPPING_FIELD_LABELS" :key="field.key">
          {{ field.label }}
          <select :value="selectedLetter(field.key)" @change="setFieldColumn(field.key, $event.target.value)">
            <option value="">선택 안 함</option>
            <option v-for="col in headerOptions" :key="col.excel_col || col.normalized_name" :value="col.excel_col">
              {{ col.excel_col }} · {{ headerLabel(col) }}
            </option>
          </select>
        </label>
      </div>
      <div class="form-actions">
        <button type="button" :disabled="item.duplicate_hash_detected && !item.duplicate_acknowledged" @click="saveConfigAndParse">
          매핑 저장 후 다시 분석
        </button>
      </div>
      <p class="notice">재분석 시 수동입력값이 초기화될 수 있습니다.</p>

      <h3>STEP 4 / 5 상품 매칭 Preview</h3>
      <p>원가/제안가/카톤/택배비/마진은 이 단계에서 계산하지 않습니다.</p>
      <div v-if="selectedRow" class="edit-form">
        <h2>원본 Excel {{ selectedRow.source_row_number }}행 수동 연결</h2>
        <p>
          외부상품: {{ selectedRow.external_product_name || "-" }}
          / 옵션: {{ selectedRow.external_option_name || "-" }}
          / 수량: {{ selectedRow.quantity ?? "-" }}
          <span v-if="selectedRow.quantity_source === 'MANUAL'">(수동입력)</span>
        </p>
        <div class="form-grid">
          <label>
            내부상품
            <select v-model="matchProductId">
              <option value="">선택</option>
              <option v-for="product in products" :key="product.id" :value="String(product.id)">
                {{ formatProductCode(product.product_code) }} / {{ optionLabel(product) }}
              </option>
            </select>
          </label>
          <label class="checkbox">
            <input v-model="saveAlias" type="checkbox" /> 다음부터 이 상품으로 자동 인식
          </label>
        </div>
        <div class="form-actions">
          <button type="button" @click="matchSelected">연결 저장</button>
          <button type="button" @click="selectedRow = null">닫기</button>
        </div>
      </div>

      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Excel 행</th>
              <th>주문번호</th>
              <th>외부 상품명</th>
              <th>외부 옵션</th>
              <th>수량</th>
              <th>내부 상품코드</th>
              <th>내부 상품명</th>
              <th>내부 옵션</th>
              <th>수취인</th>
              <th>주소</th>
              <th>매칭상태</th>
              <th>검증상태</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id" :class="rowClass(row)">
              <td>원본 Excel {{ row.source_row_number }}행</td>
              <td>{{ row.external_order_number || "-" }}</td>
              <td>{{ row.external_product_name || "-" }}</td>
              <td>{{ row.external_option_name || "-" }}</td>
              <td class="qty-cell">
                <input
                  :value="quantityDrafts[row.id] ?? ''"
                  type="text"
                  inputmode="numeric"
                  placeholder="직접 입력"
                  :disabled="quantitySaving === row.id"
                  @input="quantityDrafts[row.id] = $event.target.value"
                  @keydown.enter.prevent="saveQuantity(row)"
                />
                <div class="qty-hint" :class="quantityHint(row) === '수량 필요' ? 'needed' : quantityHint(row) === '수동입력' ? 'manual' : ''">
                  {{ quantityHint(row) }}
                </div>
                <div class="qty-actions">
                  <button type="button" :disabled="quantitySaving === row.id" @click="saveQuantity(row)">저장</button>
                  <button
                    v-if="row.quantity_source === 'MANUAL'"
                    type="button"
                    :disabled="quantitySaving === row.id"
                    @click="resetQuantity(row)"
                  >
                    자동값으로 되돌리기
                  </button>
                </div>
              </td>
              <td>{{ formatProductCode(row.product_code) }}</td>
              <td>{{ row.product_name || "-" }}</td>
              <td>{{ row.option_name || "-" }}</td>
              <td>{{ row.recipient_name || "-" }}</td>
              <td>{{ row.address || "-" }}</td>
              <td>{{ MATCH_STATUS_LABELS[row.match_status] || row.match_status }}</td>
              <td>
                {{ row.validation_status === "VALID" ? "정상" : "오류" }}
                <span v-if="row.validation_errors?.length">: {{ row.validation_errors.join(", ") }}</span>
              </td>
              <td class="row-actions">
                <button type="button" @click="selectedRow = row; matchProductId = row.matched_product_option_id ? String(row.matched_product_option_id) : ''">연결</button>
                <button type="button" @click="rawOpen = rawOpen === row.id ? null : row.id">원본</button>
              </td>
            </tr>
            <tr v-if="rows.length === 0">
              <td colspan="13">분석된 행이 없습니다. 매핑 후 다시 분석하세요.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <pre v-if="rawOpen" class="raw-json">{{ JSON.stringify(rows.find((row) => row.id === rawOpen)?.raw_row_json, null, 2) }}</pre>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { apiDownload, apiRequest } from "../api/client";
import { formatDateTimeKst, formatWon } from "../utils/format";
import { ORDER_STATUS_LABELS, SHIPPING_CALC_LABELS, SHIPPING_LABELS } from "../utils/labels";
import { confirmHardDelete } from "../utils/confirm-delete";
import InvoiceMemoPanel from "../components/InvoiceMemoPanel.vue";

const route = useRoute();
const router = useRouter();
const data = ref(null);
const error = ref("");
const loading = ref(false);
const confirming = ref(false);
const invoices = ref([]);
const generating = ref(false);
const memoPanel = ref(null);
const splitQty = reactive({});
const groupNoteDraft = reactive({});
const form = reactive({
  shipping_type: "PARCEL",
  shipping_calculation_mode: "TOTAL_QUANTITY",
  manual_shipping_charge: "",
});

const usesManual = computed(
  () => form.shipping_type === "TRUCK" || form.shipping_type === "MANUAL",
);
const isDraft = computed(() => data.value?.order?.status === "DRAFT");
const shippingSummary = computed(() => data.value?.shipping_summary || {});
const truckGroups = computed(() => data.value?.settings?.shipping_config?.truck_groups || {});
const displayShippingType = computed(() => {
  if (shippingSummary.value.is_mixed) {
    return "혼합배송";
  }
  return shippingSummary.value.display_shipping_type || SHIPPING_LABELS[form.shipping_type] || form.shipping_type;
});

function moneyClass(value) {
  return Number(value) < 0 ? "margin-neg" : "";
}

function cloneConfig() {
  const src = data.value?.settings?.shipping_config || { overrides: {}, splits: [], truck_groups: {} };
  return JSON.parse(JSON.stringify(src));
}

function nextTruckGroupKey(groups) {
  let index = 1;
  while (groups[`TRUCK-${index}`]) {
    index += 1;
  }
  return `TRUCK-${index}`;
}

function ensureTruckGroup(config, key) {
  const truckKey = key || Object.keys(config.truck_groups || {})[0] || "TRUCK-1";
  if (!config.truck_groups[truckKey]) {
    const index = Object.keys(config.truck_groups).length + 1;
    config.truck_groups[truckKey] = {
      label: `용차 ${index}`,
      manual_shipping_charge: null,
    };
  }
  return truckKey;
}

function syncForm(preview) {
  const source = preview || data.value;
  if (!source?.settings) {
    return;
  }
  form.shipping_type = source.settings.shipping_type;
  form.shipping_calculation_mode = source.settings.shipping_calculation_mode;
  form.manual_shipping_charge =
    source.settings.manual_shipping_charge == null ? "" : String(source.settings.manual_shipping_charge);
}

function groupTypeValue(row) {
  return row.shipping_type_override || "";
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const preview = await apiRequest("GET", `/orders/${route.params.id}/preview`);
    data.value = preview;
    if (preview.order.status === "CONFIRMED") {
      const listed = await apiRequest("GET", `/orders/${route.params.id}/invoices`);
      invoices.value = listed.documents || [];
    } else {
      invoices.value = [];
    }
    syncForm(preview);
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function patchSettings(extra = {}) {
  const body = {
    shipping_type: form.shipping_type,
    shipping_calculation_mode: form.shipping_calculation_mode,
    ...extra,
  };
  if (usesManual.value) {
    body.manual_shipping_charge = form.manual_shipping_charge === "" ? null : Number(form.manual_shipping_charge);
  }
  data.value = await apiRequest("PATCH", `/orders/${route.params.id}/settings`, body);
  syncForm();
}

async function recalculate() {
  error.value = "";
  try {
    const previousType = data.value?.settings?.shipping_type;
    const extra = {};
    if (form.shipping_type !== previousType && data.value?.settings?.has_group_overrides) {
      extra.apply_all_groups = window.confirm(
        `모든 배송그룹을 ${SHIPPING_LABELS[form.shipping_type]}로 변경하시겠습니까?`,
      );
    }
    await patchSettings(extra);
  } catch (err) {
    error.value = err.message;
  }
}

async function saveConfig(config) {
  error.value = "";
  try {
    await patchSettings({ shipping_config: config });
  } catch (err) {
    error.value = err.message;
  }
}

async function changeGroupType(row, type) {
  const config = cloneConfig();
  if (row.split_id) {
    const split = config.splits.find((item) => item.id === row.split_id);
    if (!split) {
      return;
    }
    split.shipping_type = type || null;
    if (type === "TRUCK") {
      split.truck_group_key = ensureTruckGroup(config, split.truck_group_key);
      split.group_note = split.group_note || "용차출고";
    } else {
      split.truck_group_key = null;
      if (type !== "MANUAL") {
        split.manual_shipping_charge = null;
      }
    }
  } else if (!type) {
    delete config.overrides[row.identity];
  } else {
    config.overrides[row.identity] = {
      ...(config.overrides[row.identity] || {}),
      shipping_type: type,
      truck_group_key: type === "TRUCK" ? ensureTruckGroup(config, row.truck_group_key) : null,
      group_note: type === "TRUCK" ? row.group_note || "용차출고" : row.group_note || null,
    };
  }
  await saveConfig(config);
}

async function changeTruckGroup(row, truckKey) {
  const config = cloneConfig();
  const key = truckKey === "__new__" ? nextTruckGroupKey(config.truck_groups) : truckKey;
  if (truckKey === "__new__") {
    ensureTruckGroup(config, key);
  }
  if (row.split_id) {
    const split = config.splits.find((item) => item.id === row.split_id);
    if (split) {
      split.truck_group_key = key;
      split.shipping_type = "TRUCK";
    }
  } else {
    config.overrides[row.identity] = {
      ...(config.overrides[row.identity] || {}),
      shipping_type: "TRUCK",
      truck_group_key: key,
      group_note: row.group_note || "용차출고",
    };
  }
  await saveConfig(config);
}

async function changeTruckCharge(truckKey, raw) {
  const config = cloneConfig();
  ensureTruckGroup(config, truckKey);
  config.truck_groups[truckKey].manual_shipping_charge = raw === "" ? null : Number(raw);
  await saveConfig(config);
}

async function changeManualCharge(row, raw) {
  const config = cloneConfig();
  const amount = raw === "" ? null : Number(raw);
  if (row.split_id) {
    const split = config.splits.find((item) => item.id === row.split_id);
    if (split) {
      split.manual_shipping_charge = amount;
      split.shipping_type = "MANUAL";
    }
  } else {
    config.overrides[row.identity] = {
      ...(config.overrides[row.identity] || {}),
      shipping_type: "MANUAL",
      manual_shipping_charge: amount,
    };
  }
  await saveConfig(config);
}

async function saveGroupNote(row) {
  const note = groupNoteDraft[row.identity] ?? row.group_note ?? "";
  const config = cloneConfig();
  if (row.split_id) {
    const split = config.splits.find((item) => item.id === row.split_id);
    if (split) {
      split.group_note = note || null;
    }
  } else {
    config.overrides[row.identity] = {
      ...(config.overrides[row.identity] || {}),
      shipping_type: row.shipping_type_override || row.shipping_type,
      group_note: note || null,
      truck_group_key: row.truck_group_key || null,
    };
  }
  await saveConfig(config);
}

async function splitGroup(row) {
  const qty = Number(splitQty[row.identity]);
  if (!Number.isInteger(qty) || qty < 1 || qty >= row.total_quantity) {
    error.value = "분리 수량은 1 이상, 원 수량 미만의 정수여야 합니다.";
    return;
  }
  const config = cloneConfig();
  const truckKey = ensureTruckGroup(config);
  config.splits.push({
    id: `s${config.splits.length + 1}`,
    base_key: row.base_identity || row.identity,
    quantity: qty,
    shipping_type: "TRUCK",
    truck_group_key: truckKey,
    group_note: "용차출고",
  });
  await saveConfig(config);
}

async function confirm() {
  error.value = "";
  confirming.value = true;
  try {
    data.value = await apiRequest("POST", `/orders/${route.params.id}/confirm`, {
      preview_signature: data.value?.calculation_signature,
    });
    const listed = await apiRequest("GET", `/orders/${route.params.id}/invoices`);
    invoices.value = listed.documents || [];
  } catch (err) {
    error.value = err.message;
    if (err.code === "ORDER_PREVIEW_CHANGED") {
      await load();
    }
  } finally {
    confirming.value = false;
  }
}

function onMemoSaved(result) {
  if (!data.value) {
    return;
  }
  data.value = {
    ...data.value,
    invoice_memo: result.invoice_memo,
    invoice_memo_defaults: result.invoice_memo_defaults,
    invoice_note_preview: result.invoice_note_preview,
    invoice_note_suggested_preview: result.invoice_note_suggested_preview,
    invoice_memo_warnings: result.invoice_memo_warnings,
  };
}

function onMemoError(err) {
  error.value = err.message;
}

async function generateInvoice() {
  error.value = "";
  generating.value = true;
  try {
    if (memoPanel.value) {
      await memoPanel.value.save();
    }
    await apiRequest("POST", `/orders/${route.params.id}/invoices`);
    const listed = await apiRequest("GET", `/orders/${route.params.id}/invoices`);
    invoices.value = listed.documents || [];
  } catch (err) {
    error.value = err.message;
  } finally {
    generating.value = false;
  }
}

async function downloadInvoice(doc) {
  error.value = "";
  try {
    await apiDownload(`/orders/${route.params.id}/invoices/${doc.id}/download`, {
      filename: doc.original_file_name,
    });
  } catch (err) {
    error.value = err.message;
  }
}

async function removeDraft() {
  error.value = "";
  if (!confirmHardDelete("이 DRAFT 거래를 삭제합니다.\n기본으로 원본 발주서 업로드는 유지됩니다.")) {
    return;
  }
  try {
    await apiRequest("DELETE", `/orders/${route.params.id}`);
    await router.push(data.value?.order ? `/order-imports/${data.value.order.order_import_id}` : "/order-imports");
  } catch (err) {
    error.value = err.message;
  }
}

async function cancelConfirmed() {
  error.value = "";
  if (!window.confirm("이 확정 거래를 취소합니다.\nSnapshot, 거래명세서, 정산 기록은 유지됩니다.")) {
    return;
  }
  try {
    await apiRequest("POST", `/orders/${route.params.id}/cancel`);
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

onMounted(load);
</script>

<template>
  <section class="page wide">
    <div class="page-header">
      <h1>발주 금액 Preview</h1>
      <button type="button" @click="router.push(data?.order ? `/order-imports/${data.order.order_import_id}` : '/order-imports')">
        발주서로
      </button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading">불러오는 중...</p>
    <template v-if="data">
      <p v-if="data.order.status === 'CANCELLED'" class="banner-warn">
        이 거래는 취소되었습니다. Snapshot과 거래명세서는 유지됩니다.
      </p>
      <p v-if="data.order.status === 'CONFIRMED'" class="notice-ok">
        발주 확정 완료. Snapshot이 저장되었습니다. 이후 원가/제안가 변경은 이 거래에 반영되지 않습니다.
        <button type="button" @click="router.push(`/orders/${data.order.id}`)">거래 상세</button>
        <button v-if="data.order.status === 'CONFIRMED'" type="button" class="btn-danger" @click="cancelConfirmed">거래 취소</button>
      </p>
      <table class="status-table">
        <tbody>
          <tr><th>매출처</th><td>{{ data.order.client_name }} ({{ data.order.client_code }})</td></tr>
          <tr><th>발주일</th><td>{{ data.order.order_date }}</td></tr>
          <tr><th>원본 발주서</th><td>{{ data.order.original_file_name }}</td></tr>
          <tr><th>상태</th><td>{{ ORDER_STATUS_LABELS[data.order.status] || data.order.status }}</td></tr>
          <tr><th>배송방식</th><td>{{ displayShippingType }}</td></tr>
          <tr><th>택배 청구</th><td>{{ formatWon(data.totals.parcel_shipping_charge || 0) }}원</td></tr>
          <tr><th>용차 청구</th><td>{{ formatWon(data.totals.truck_shipping_charge || 0) }}원</td></tr>
          <tr><th>수동배송</th><td>{{ formatWon(data.totals.manual_shipping_charge_total || 0) }}원</td></tr>
          <tr><th>상품 종류 / 총 수량</th><td>{{ data.totals.product_count }} / {{ data.totals.total_quantity }}</td></tr>
          <tr><th>상품매출</th><td>{{ formatWon(data.totals.total_product_sales) }}원</td></tr>
          <tr><th>상품원가</th><td>{{ formatWon(data.totals.total_product_cost) }}원</td></tr>
          <tr>
            <th>상품마진</th>
            <td :class="moneyClass(data.totals.total_product_margin)">
              {{ formatWon(data.totals.total_product_margin) }}원 ({{ data.totals.total_product_margin_rate }}%)
            </td>
          </tr>
          <tr><th>총 배송비</th><td>{{ formatWon(data.totals.total_shipping_charge) }}원</td></tr>
          <tr><th>총 청구액</th><td>{{ formatWon(data.totals.total_invoice_amount) }}원</td></tr>
          <tr>
            <th>거래명세서 예상 행</th>
            <td>{{ data.totals.invoice_required_line_count }}행</td>
          </tr>
        </tbody>
      </table>

      <div v-if="data.blocking_errors.length" class="banner-error">
        <div v-for="(item, idx) in data.blocking_errors" :key="idx">{{ item.message }}</div>
      </div>
      <div v-if="data.totals.negative_margin_count" class="banner-warn">
        마이너스 마진 상품 {{ data.totals.negative_margin_count }}건. 확정은 가능합니다.
      </div>
      <p v-if="data.blocking_errors.some((item) => item.code === 'PRICE_NOT_FOUND')">
        <button type="button" @click="router.push(`/sales-clients/${data.order.client_id}/prices`)">제안가 관리 열기</button>
      </p>

      <form v-if="isDraft" class="edit-form" @submit.prevent="recalculate">
        <h2>배송 설정</h2>
        <p>기본 배송방식: {{ SHIPPING_LABELS[form.shipping_type] }}</p>
        <div class="form-grid">
          <label>
            기본 배송방식
            <select v-model="form.shipping_type">
              <option v-for="(label, value) in SHIPPING_LABELS" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
          <label>
            배송비 계산
            <select v-model="form.shipping_calculation_mode">
              <option v-for="(label, value) in SHIPPING_CALC_LABELS" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
          <label v-if="usesManual">
            {{ form.shipping_type === "TRUCK" ? "용차비" : "수동 배송비" }}
            <input v-model="form.manual_shipping_charge" inputmode="numeric" placeholder="비우면 미입력(NULL)" />
          </label>
        </div>
        <div class="form-actions">
          <button type="submit">다시 계산</button>
          <button type="button" :disabled="!data.can_confirm || confirming" @click="confirm">발주 확정</button>
          <button type="button" class="btn-danger" @click="removeDraft">DRAFT 삭제</button>
        </div>
      </form>

      <h3>상품 집계</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>상품</th><th>옵션</th><th>총수량</th><th>원가</th><th>제안가</th>
            <th>상품매출</th><th>상품원가</th><th>상품마진</th><th>마진율</th>
            <th>카톤입수</th><th>계산카톤수</th><th>택배비단가</th><th>청구택배비</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in data.product_totals" :key="row.product_option_id || row.product_id">
            <td>{{ row.product_name }}</td>
            <td>{{ row.option_name || "-" }}</td>
            <td class="num">{{ row.total_quantity }}</td>
            <td class="num">{{ formatWon(row.purchase_price) }}</td>
            <td class="num">{{ formatWon(row.sale_price) }}</td>
            <td class="num">{{ formatWon(row.product_sales_amount) }}</td>
            <td class="num">{{ formatWon(row.product_cost_amount) }}</td>
            <td class="num" :class="moneyClass(row.product_margin_amount)">{{ formatWon(row.product_margin_amount) }}</td>
            <td class="num">{{ row.product_margin_rate }}%</td>
            <td class="num">{{ row.carton_qty }}</td>
            <td class="num">{{ row.carton_count }}</td>
            <td class="num">{{ formatWon(row.shipping_fee_per_carton) }}</td>
            <td class="num">{{ formatWon(row.shipping_charge) }}</td>
          </tr>
        </tbody>
      </table>

      <h3>배송 계산 상세</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>그룹</th><th>상품</th><th>수량</th><th>입수</th><th>카톤수</th>
            <th>배송방식</th><th>택배비단가</th><th>자동택배비</th><th>용차/수동배송비</th><th>비고</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, idx) in data.shipping_groups" :key="row.identity || idx">
            <td>{{ row.group_label || row.group_key }}</td>
            <td>{{ row.product_name }} {{ row.option_name || "" }}</td>
            <td class="num">{{ row.total_quantity }}</td>
            <td class="num">{{ row.carton_qty }}</td>
            <td class="num">{{ row.carton_count }}</td>
            <td>
              <select
                v-if="isDraft"
                class="shipping-select"
                :value="groupTypeValue(row)"
                @change="changeGroupType(row, $event.target.value)"
              >
                <option value="">주문 기본</option>
                <option v-for="(label, value) in SHIPPING_LABELS" :key="value" :value="value">{{ label }}</option>
              </select>
              <span v-else>{{ SHIPPING_LABELS[row.shipping_type] || row.shipping_type }}</span>
            </td>
            <td class="num">{{ row.shipping_type === "PARCEL" ? formatWon(row.shipping_fee_per_carton) : "-" }}</td>
            <td class="num">{{ row.shipping_type === "PARCEL" ? formatWon(row.shipping_charge) : "-" }}</td>
            <td>
              <template v-if="row.shipping_type === 'TRUCK'">
                <select
                  v-if="isDraft"
                  class="shipping-select"
                  :value="row.truck_group_key || ''"
                  @change="changeTruckGroup(row, $event.target.value)"
                >
                  <option v-for="(group, key) in truckGroups" :key="key" :value="key">{{ group.label || key }}</option>
                  <option value="__new__">+ 새 용차 그룹</option>
                </select>
                <input
                  v-if="isDraft && row.truck_group_key"
                  class="num-input"
                  :value="truckGroups[row.truck_group_key]?.manual_shipping_charge ?? ''"
                  inputmode="numeric"
                  placeholder="용차비"
                  @change="changeTruckCharge(row.truck_group_key, $event.target.value)"
                />
                <span v-if="!isDraft">{{ formatWon(row.manual_shipping_charge || 0) }}</span>
              </template>
              <template v-else-if="row.shipping_type === 'MANUAL'">
                <input
                  v-if="isDraft"
                  class="num-input"
                  :value="row.manual_shipping_charge ?? ''"
                  inputmode="numeric"
                  placeholder="수동배송비"
                  @change="changeManualCharge(row, $event.target.value)"
                />
                <span v-else>{{ formatWon(row.manual_shipping_charge || 0) }}</span>
              </template>
              <span v-else>-</span>
            </td>
            <td>
              <input
                v-if="isDraft"
                class="note-input"
                :value="groupNoteDraft[row.identity] ?? row.group_note ?? ''"
                @change="groupNoteDraft[row.identity] = $event.target.value; saveGroupNote(row)"
              />
              <span v-else>{{ row.group_note || "" }}</span>
              <div v-if="isDraft && !row.split_id" class="split-row">
                <input v-model="splitQty[row.identity]" class="num-input" inputmode="numeric" placeholder="분리수량" />
                <button type="button" @click="splitGroup(row)">일부 용차 분리</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <h3>거래명세서 예상 행</h3>
      <table class="data-table">
        <thead>
          <tr><th>구분</th><th>내용</th><th>수량</th><th>단가</th><th>금액</th><th>비고</th></tr>
        </thead>
        <tbody>
          <tr v-for="(row, idx) in [...data.invoice_product_lines, ...data.invoice_shipping_lines]" :key="idx">
            <td>{{ row.kind === "PRODUCT" ? "상품" : "배송비" }}</td>
            <td>{{ row.product_name || row.label }}{{ row.option_name ? ` / ${row.option_name}` : "" }}</td>
            <td class="num">{{ row.quantity }}</td>
            <td class="num">{{ formatWon(row.unit_price) }}</td>
            <td class="num">{{ formatWon(row.amount) }}</td>
            <td>{{ row.note || "" }}</td>
          </tr>
        </tbody>
      </table>
      <p>거래명세서 예상 행: {{ data.totals.invoice_required_line_count }}행</p>

      <template v-if="data.order.status === 'CONFIRMED'">
        <InvoiceMemoPanel
          ref="memoPanel"
          :order-id="data.order.id"
          :saved="data.invoice_memo"
          :defaults="data.invoice_memo_defaults"
          :note-preview="data.invoice_note_preview"
          :suggested-preview="data.invoice_note_suggested_preview"
          :warnings="data.invoice_memo_warnings || []"
          :shipping-notes="data.invoice_shipping_lines || []"
          @saved="onMemoSaved"
          @error="onMemoError"
        />
        <h3>거래명세서</h3>
        <div class="form-actions">
          <button type="button" :disabled="generating" @click="generateInvoice">
            {{ invoices.length ? "새 버전 생성" : "거래명세서 생성" }}
          </button>
        </div>
        <table v-if="invoices.length" class="data-table">
          <thead>
            <tr>
              <th>버전</th><th>상태</th><th>파일명</th><th>생성일</th><th>MASTER checksum</th><th>다운로드</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="doc in invoices" :key="doc.id">
              <td>v{{ doc.version }}</td>
              <td>{{ doc.status === "GENERATED" ? "정상" : "사용 불가" }}</td>
              <td>{{ doc.original_file_name }}</td>
              <td>{{ formatDateTimeKst(doc.created_at) }}</td>
              <td>{{ doc.template_hash }}</td>
              <td>
                <button v-if="doc.status === 'GENERATED'" type="button" @click="downloadInvoice(doc)">다운로드</button>
                <span v-else>제공하지 않음</span>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>
  </section>
</template>

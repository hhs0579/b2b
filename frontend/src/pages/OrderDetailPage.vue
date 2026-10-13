<template>
  <section class="page wide">
    <div class="page-header">
      <h1>거래 상세</h1>
      <div class="form-actions" style="margin-top: 0">
        <button type="button" @click="router.push('/orders')">거래내역</button>
        <button v-if="order" type="button" @click="router.push(`/orders/${order.id}/preview`)">Preview</button>
        <button
          v-if="order?.status === 'CONFIRMED'"
          type="button"
          class="btn-danger"
          @click="cancelConfirmed"
        >
          거래 취소
        </button>
      </div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading">불러오는 중...</p>
    <template v-if="order">
      <p v-if="order.status === 'CANCELLED'" class="banner-warn">이 거래는 취소되었습니다. Snapshot과 명세서는 유지됩니다.</p>
      <p v-else class="notice-ok">확정 Snapshot 기준입니다. 현재 상품/가격을 다시 조회하지 않습니다.</p>
      <table class="status-table">
        <tbody>
          <tr><th>매출처</th><td>{{ order.client_name }}</td></tr>
          <tr><th>발주일</th><td>{{ order.order_date }}</td></tr>
          <tr>
            <th>원본 발주서</th>
            <td>
              <RouterLink :to="`/order-imports/${order.order_import_id}`">
                {{ order.original_file_name }}
              </RouterLink>
            </td>
          </tr>
          <tr><th>상품매출</th><td>{{ formatWon(order.total_product_sales) }}원</td></tr>
          <tr><th>상품원가</th><td>{{ formatWon(order.total_product_cost) }}원</td></tr>
          <tr>
            <th>상품마진</th>
            <td :class="moneyClass(order.total_product_margin)">
              {{ formatWon(order.total_product_margin) }}원 ({{ order.total_product_margin_rate }}%)
            </td>
          </tr>
          <tr><th>청구배송비</th><td>{{ formatWon(order.total_shipping_charge) }}원</td></tr>
          <tr><th>총청구액</th><td>{{ formatWon(order.total_invoice_amount) }}원</td></tr>
        </tbody>
      </table>

      <h2>Snapshot 상품내역</h2>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>상품</th><th>옵션</th><th>수량</th><th>원가</th><th>제안가</th>
              <th>상품매출</th><th>상품원가</th><th>상품마진</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in items" :key="row.id">
              <td>{{ row.product_name }}</td>
              <td>{{ row.option_name || "-" }}</td>
              <td class="num">{{ row.quantity }}</td>
              <td class="num">{{ formatWon(row.purchase_price) }}</td>
              <td class="num">{{ formatWon(row.sale_price) }}</td>
              <td class="num">{{ formatWon(row.product_sales_amount) }}</td>
              <td class="num">{{ formatWon(row.product_cost_amount) }}</td>
              <td class="num" :class="moneyClass(row.product_margin_amount)">
                {{ formatWon(row.product_margin_amount) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>배송 계산내역</h2>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>그룹</th><th>상품</th><th>수량</th><th>입수</th>
              <th>카톤수</th><th>택배비단가</th><th>택배비</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in shippingGroups" :key="row.id">
              <td>{{ row.group_key }}</td>
              <td>{{ row.product_name }} {{ row.option_name || "" }}</td>
              <td class="num">{{ row.total_quantity }}</td>
              <td class="num">{{ row.carton_qty }}</td>
              <td class="num">{{ row.carton_count }}</td>
              <td class="num">{{ formatWon(row.shipping_fee_per_carton) }}</td>
              <td class="num">{{ formatWon(row.shipping_charge) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <InvoiceMemoPanel
        v-if="order.status === 'CONFIRMED' || order.status === 'CANCELLED'"
        ref="memoPanel"
        :order-id="order.id"
        :saved="detail?.invoice_memo"
        :defaults="detail?.invoice_memo_defaults"
        :note-preview="detail?.invoice_note_preview"
        :suggested-preview="detail?.invoice_note_suggested_preview"
        :warnings="detail?.invoice_memo_warnings || []"
        :shipping-notes="detail?.invoice_shipping_lines || []"
        :readonly="order.status !== 'CONFIRMED'"
        @saved="onMemoSaved"
        @error="onMemoError"
      />

      <h2>거래명세서</h2>
      <InvoiceSupplierPanel
        v-model="supplierProfileId"
        :readonly="order.status !== 'CONFIRMED'"
        @error="onMemoError"
      />
      <p v-if="!supplierProfileId && order.status === 'CONFIRMED'" class="error">거래명세서 공급자를 선택해주세요.</p>
      <div class="form-actions">
        <button type="button" :disabled="generating || order.status !== 'CONFIRMED'" @click="generateInvoice">
          {{ documents.length ? "새 버전 생성" : "거래명세서 생성" }}
        </button>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>버전</th><th>공급자</th><th>상태</th><th>파일명</th><th>생성일</th><th>MASTER checksum</th><th></th>
          </tr>
        </thead>
        <tbody>
            <tr v-for="doc in documents" :key="doc.id">
            <td>v{{ doc.version }}</td>
            <td>{{ doc.supplier_name_snapshot || "—" }}</td>
            <td>{{ doc.status === "GENERATED" ? "정상" : "사용 불가" }}</td>
            <td>{{ doc.original_file_name }}</td>
            <td>{{ formatDateTimeKst(doc.created_at) }}</td>
            <td>{{ doc.template_hash }}</td>
            <td>
              <button v-if="doc.status === 'GENERATED'" type="button" @click="downloadInvoice(doc)">다운로드</button>
              <span v-else>제공하지 않음</span>
            </td>
          </tr>
          <tr v-if="documents.length === 0">
            <td colspan="7">생성된 거래명세서가 없습니다.</td>
          </tr>
        </tbody>
      </table>

      <h2>정산</h2>
      <table v-if="settlement" class="status-table">
        <tbody>
          <tr><th>정산상태</th><td>{{ PAYMENT_STATUS_LABELS[settlement.settlement_status] }}</td></tr>
          <tr><th>청구액</th><td>{{ formatWon(settlement.billing_amount) }}원</td></tr>
          <tr><th>입금액</th><td>{{ formatWon(settlement.paid_amount) }}원</td></tr>
          <tr><th>미수금</th><td>{{ formatWon(settlement.outstanding_amount) }}원</td></tr>
          <tr><th>최근입금일</th><td>{{ settlement.last_payment_date || "-" }}</td></tr>
        </tbody>
      </table>
      <form v-if="settlement" class="edit-form" @submit.prevent="saveSettlement">
        <div class="form-grid">
          <label>
            입금예정일
            <input v-model="settlementForm.expected_payment_date" type="date" />
          </label>
          <label>
            세금계산서
            <select v-model="settlementForm.tax_invoice_status">
              <option v-for="(label, value) in TAX_INVOICE_LABELS" :key="value" :value="value">
                {{ label }}
              </option>
            </select>
          </label>
          <label class="full">
            메모
            <input v-model="settlementForm.memo" />
          </label>
        </div>
        <p v-if="settlement.tax_invoice_issued_at">
          발행일시: {{ formatDateTimeKst(settlement.tax_invoice_issued_at) }}
        </p>
        <div class="form-actions">
          <button type="submit">정산 정보 저장</button>
        </div>
      </form>

      <h2>입금이력</h2>
      <p>금액과 정산상태는 저장 후 Backend가 다시 계산합니다. 과입금은 차단됩니다.</p>
      <form class="edit-form" @submit.prevent="addPayment">
        <div class="form-grid">
          <label>
            입금액
            <input v-model="paymentForm.amount" inputmode="numeric" />
          </label>
          <label>
            입금일
            <input v-model="paymentForm.paid_at" type="date" />
          </label>
          <label class="full">
            메모
            <input v-model="paymentForm.memo" />
          </label>
        </div>
        <div class="form-actions">
          <button type="submit" :disabled="savingPayment">입금 등록</button>
        </div>
      </form>
      <table class="data-table">
        <thead>
          <tr>
            <th>입금일</th><th>금액</th><th>메모</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in payments" :key="row.id">
            <td>
              <input v-model="row.paid_at" type="date" />
            </td>
            <td>
              <input v-model="row.amount" class="price-input" inputmode="numeric" />
            </td>
            <td>
              <input v-model="row.memo" />
            </td>
            <td class="row-actions">
              <button type="button" @click="updatePayment(row)">수정</button>
              <button type="button" @click="removePayment(row.id)">삭제</button>
            </td>
          </tr>
          <tr v-if="payments.length === 0">
            <td colspan="4">입금기록이 없습니다.</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { apiDownload, apiRequest } from "../api/client";
import { formatDateTimeKst, formatWon } from "../utils/format";
import { PAYMENT_STATUS_LABELS, TAX_INVOICE_LABELS } from "../utils/labels";
import InvoiceMemoPanel from "../components/InvoiceMemoPanel.vue";
import InvoiceSupplierPanel from "../components/InvoiceSupplierPanel.vue";

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const error = ref("");
const generating = ref(false);
const memoPanel = ref(null);
const supplierProfileId = ref("");
const savingPayment = ref(false);
const detail = ref(null);
const settlementForm = reactive({
  expected_payment_date: "",
  tax_invoice_status: "NOT_ISSUED",
  memo: "",
});
const paymentForm = reactive({
  amount: "",
  paid_at: "",
  memo: "",
});

const order = computed(() => detail.value?.order || null);
const items = computed(() => detail.value?.items || []);
const shippingGroups = computed(() => detail.value?.shipping_groups || []);
const documents = computed(() => detail.value?.documents || []);
const payments = computed(() => detail.value?.payments || []);
const settlement = computed(() => detail.value?.settlement || null);

function moneyClass(value) {
  return Number(value) < 0 ? "margin-neg" : "";
}

function applySettlementForm(row) {
  settlementForm.expected_payment_date = row?.expected_payment_date || "";
  settlementForm.tax_invoice_status = row?.tax_invoice_status || "NOT_ISSUED";
  settlementForm.memo = row?.memo || "";
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    detail.value = await apiRequest("GET", `/orders/${route.params.id}`);
    applySettlementForm(detail.value.settlement);
    supplierProfileId.value = detail.value.order?.invoice_supplier_profile_id || "";
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function saveSettlement() {
  error.value = "";
  try {
    await apiRequest("PATCH", `/orders/${route.params.id}/settlement`, {
      expected_payment_date: settlementForm.expected_payment_date || null,
      tax_invoice_status: settlementForm.tax_invoice_status,
      memo: settlementForm.memo || null,
    });
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

async function addPayment() {
  error.value = "";
  savingPayment.value = true;
  try {
    await apiRequest("POST", `/orders/${route.params.id}/payments`, {
      amount: Number(String(paymentForm.amount).replace(/,/g, "")),
      paid_at: paymentForm.paid_at,
      memo: paymentForm.memo || null,
    });
    paymentForm.amount = "";
    paymentForm.memo = "";
    await load();
  } catch (err) {
    error.value = err.message;
  } finally {
    savingPayment.value = false;
  }
}

async function updatePayment(row) {
  error.value = "";
  try {
    await apiRequest("PATCH", `/orders/${route.params.id}/payments/${row.id}`, {
      amount: Number(String(row.amount).replace(/,/g, "")),
      paid_at: row.paid_at,
      memo: row.memo || null,
    });
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

async function removePayment(paymentId) {
  error.value = "";
  try {
    await apiRequest("DELETE", `/orders/${route.params.id}/payments/${paymentId}`);
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

function onMemoSaved(result) {
  if (!detail.value) {
    return;
  }
  detail.value = {
    ...detail.value,
    invoice_memo: result.invoice_memo,
    invoice_memo_defaults: result.invoice_memo_defaults,
    invoice_note_preview: result.invoice_note_preview,
    invoice_note_suggested_preview: result.invoice_note_suggested_preview,
    invoice_memo_warnings: result.invoice_memo_warnings,
    invoice_shipping_lines: result.invoice_shipping_lines || detail.value.invoice_shipping_lines,
  };
}

function onMemoError(err) {
  error.value = err.message;
}

async function generateInvoice() {
  error.value = "";
  if (!supplierProfileId.value) {
    error.value = "거래명세서 공급자를 선택해주세요.";
    return;
  }
  generating.value = true;
  try {
    if (memoPanel.value) {
      await memoPanel.value.save();
    }
    await apiRequest("PATCH", `/orders/${route.params.id}/invoice-supplier`, {
      supplier_profile_id: Number(supplierProfileId.value),
    });
    await apiRequest("POST", `/orders/${route.params.id}/invoices`, {
      supplier_profile_id: Number(supplierProfileId.value),
    });
    await load();
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

onMounted(() => {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  paymentForm.paid_at = today;
  load();
});
</script>

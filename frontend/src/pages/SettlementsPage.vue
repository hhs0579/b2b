<template>
  <section class="page full">
    <div class="page-header">
      <h1>정산관리</h1>
    </div>
    <form class="toolbar" @submit.prevent="load">
      <input v-model="filters.from" type="date" />
      <input v-model="filters.to" type="date" />
      <select v-model="filters.client_id">
        <option value="">매출처 전체</option>
        <option v-for="item in clients" :key="item.id" :value="String(item.id)">
          {{ item.client_name }}
        </option>
      </select>
      <select v-model="filters.settlement_status">
        <option value="">정산상태 전체</option>
        <option v-for="(label, value) in PAYMENT_STATUS_LABELS" :key="value" :value="value">
          {{ label }}
        </option>
      </select>
      <input v-model="filters.order_number" placeholder="발주번호/파일명" />
      <button type="submit">조회</button>
    </form>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>거래일</th>
            <th>매출처</th>
            <th>총청구액</th>
            <th>입금액</th>
            <th>미수금</th>
            <th>정산상태</th>
            <th>입금예정일</th>
            <th>최근입금일</th>
            <th>세금계산서</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in items" :key="row.id">
            <td>
              <RouterLink :to="`/orders/${row.id}`">{{ row.order_date }}</RouterLink>
            </td>
            <td>{{ row.client_name }}</td>
            <td class="num">{{ formatWon(row.billing_amount) }}</td>
            <td class="num">{{ formatWon(row.paid_amount) }}</td>
            <td class="num">{{ formatWon(row.outstanding_amount) }}</td>
            <td>{{ PAYMENT_STATUS_LABELS[row.settlement_status] || row.settlement_status || "-" }}</td>
            <td>{{ row.expected_payment_date || "-" }}</td>
            <td>{{ row.last_payment_date || "-" }}</td>
            <td>{{ TAX_INVOICE_LABELS[row.tax_invoice_status] || row.tax_invoice_status || "-" }}</td>
          </tr>
          <tr v-if="items.length === 0">
            <td colspan="9">정산 대상 거래가 없습니다.</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="pager">
      <button type="button" :disabled="page <= 1" @click="changePage(page - 1)">이전</button>
      <span>{{ page }} / {{ totalPages }} ({{ total }}건)</span>
      <button type="button" :disabled="page >= totalPages" @click="changePage(page + 1)">다음</button>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { apiRequest } from "../api/client";
import { formatWon } from "../utils/format";
import { PAYMENT_STATUS_LABELS, TAX_INVOICE_LABELS } from "../utils/labels";

const items = ref([]);
const clients = ref([]);
const error = ref("");
const page = ref(1);
const total = ref(0);
const limit = 50;
const filters = reactive({
  from: "",
  to: "",
  client_id: "",
  settlement_status: "",
  order_number: "",
});

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit)));

async function load() {
  error.value = "";
  try {
    const params = new URLSearchParams();
    params.set("page", String(page.value));
    params.set("limit", String(limit));
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.client_id) params.set("client_id", filters.client_id);
    if (filters.settlement_status) params.set("settlement_status", filters.settlement_status);
    if (filters.order_number) params.set("order_number", filters.order_number);
    const data = await apiRequest("GET", `/orders?${params.toString()}`);
    items.value = data.items;
    total.value = data.total;
    page.value = data.page;
  } catch (err) {
    error.value = err.message;
  }
}

async function changePage(next) {
  page.value = next;
  await load();
}

onMounted(async () => {
  try {
    const data = await apiRequest("GET", "/sales-clients");
    clients.value = data.items;
  } catch (err) {
    error.value = err.message;
  }
  await load();
});
</script>

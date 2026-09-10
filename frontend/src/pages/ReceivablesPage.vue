<template>
  <section class="page full">
    <div class="page-header">
      <h1>미수금</h1>
    </div>
    <form class="toolbar" @submit.prevent="load">
      <select v-model="filters.client_id">
        <option value="">매출처 전체</option>
        <option v-for="item in clients" :key="item.id" :value="String(item.id)">
          {{ item.client_name }}
        </option>
      </select>
      <button type="submit">조회</button>
    </form>
    <p>입금예정일 오름차순, 없으면 오래된 거래 우선. 미입금/부분입금만 표시합니다.</p>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>매출처</th>
            <th>거래일</th>
            <th>총청구액</th>
            <th>입금액</th>
            <th>미수금</th>
            <th>입금예정일</th>
            <th>정산상태</th>
            <th>세금계산서</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in items" :key="row.id">
            <td>{{ row.client_name }}</td>
            <td>
              <RouterLink :to="`/orders/${row.id}`">{{ row.order_date }}</RouterLink>
            </td>
            <td class="num">{{ formatWon(row.billing_amount) }}</td>
            <td class="num">{{ formatWon(row.paid_amount) }}</td>
            <td class="num">{{ formatWon(row.outstanding_amount) }}</td>
            <td>{{ row.expected_payment_date || "-" }}</td>
            <td>{{ PAYMENT_STATUS_LABELS[row.settlement_status] || row.settlement_status }}</td>
            <td>{{ TAX_INVOICE_LABELS[row.tax_invoice_status] || row.tax_invoice_status || "-" }}</td>
          </tr>
          <tr v-if="items.length === 0">
            <td colspan="8">미수금 거래가 없습니다.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { apiRequest } from "../api/client";
import { formatWon } from "../utils/format";
import { PAYMENT_STATUS_LABELS, TAX_INVOICE_LABELS } from "../utils/labels";

const items = ref([]);
const clients = ref([]);
const error = ref("");
const filters = reactive({ client_id: "" });

async function load() {
  error.value = "";
  try {
    const params = new URLSearchParams();
    params.set("settlement_status", "UNPAID,PARTIAL");
    params.set("sort", "expected_asc");
    params.set("limit", "200");
    if (filters.client_id) params.set("client_id", filters.client_id);
    const data = await apiRequest("GET", `/orders?${params.toString()}`);
    items.value = data.items;
  } catch (err) {
    error.value = err.message;
  }
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

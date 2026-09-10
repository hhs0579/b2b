<template>
  <section class="page full">
    <h1>Dashboard</h1>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading">불러오는 중...</p>
    <template v-if="data">
      <p>확정 Snapshot 기준. 기준일 {{ data.as_of }} (Asia/Seoul)</p>
      <div class="kpi-grid">
        <div class="kpi-card">
          <span class="label">오늘 매출</span>
          <span class="value">{{ formatWon(data.today_sales) }}원</span>
        </div>
        <div class="kpi-card">
          <span class="label">이번달 매출</span>
          <span class="value">{{ formatWon(data.month_sales) }}원</span>
        </div>
        <div class="kpi-card">
          <span class="label">이번달 상품마진</span>
          <span class="value">{{ formatWon(data.month_product_margin) }}원</span>
        </div>
        <div class="kpi-card">
          <span class="label">미수금 총액</span>
          <span class="value">{{ formatWon(data.outstanding_total) }}원</span>
        </div>
        <div class="kpi-card">
          <span class="label">미정산 거래건수</span>
          <span class="value">{{ data.unsettled_count }}건</span>
        </div>
      </div>
      <div class="dashboard-columns">
        <div>
          <h2>최근 거래</h2>
          <table class="data-table">
            <thead>
              <tr>
                <th>거래일</th>
                <th>매출처</th>
                <th>총청구액</th>
                <th>상품마진</th>
                <th>정산</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in data.recent_orders" :key="row.id">
                <td>
                  <RouterLink :to="`/orders/${row.id}`">{{ row.order_date }}</RouterLink>
                </td>
                <td>{{ row.client_name }}</td>
                <td class="num">{{ formatWon(row.total_invoice_amount) }}</td>
                <td class="num">{{ formatWon(row.total_product_margin) }}</td>
                <td>{{ PAYMENT_STATUS_LABELS[row.settlement_status] || row.settlement_status || "-" }}</td>
              </tr>
              <tr v-if="data.recent_orders.length === 0">
                <td colspan="5">최근 확정 거래가 없습니다.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h2>미수금 상위 거래</h2>
          <table class="data-table">
            <thead>
              <tr>
                <th>거래일</th>
                <th>매출처</th>
                <th>미수금</th>
                <th>입금예정일</th>
                <th>정산</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in data.top_outstanding" :key="row.id">
                <td>
                  <RouterLink :to="`/orders/${row.id}`">{{ row.order_date }}</RouterLink>
                </td>
                <td>{{ row.client_name }}</td>
                <td class="num">{{ formatWon(row.outstanding_amount) }}</td>
                <td>{{ row.expected_payment_date || "-" }}</td>
                <td>{{ PAYMENT_STATUS_LABELS[row.settlement_status] || row.settlement_status }}</td>
              </tr>
              <tr v-if="data.top_outstanding.length === 0">
                <td colspan="5">미수금 거래가 없습니다.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { apiRequest } from "../api/client";
import { formatWon } from "../utils/format";
import { PAYMENT_STATUS_LABELS } from "../utils/labels";

const data = ref(null);
const error = ref("");
const loading = ref(false);

onMounted(async () => {
  loading.value = true;
  try {
    data.value = await apiRequest("GET", "/dashboard");
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
});
</script>

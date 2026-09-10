<template>
  <section class="page full">
    <div class="page-header">
      <h1>거래내역</h1>
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
      <select v-model="filters.product_id">
        <option value="">상품 전체</option>
        <option v-for="item in products" :key="item.id" :value="String(item.id)">
          {{ item.product_name }}{{ item.option_name ? ` ${item.option_name}` : "" }}
        </option>
      </select>
      <input v-model="filters.order_number" placeholder="발주번호/파일명" />
      <select v-model="filters.settlement_status">
        <option value="">정산상태 전체</option>
        <option v-for="(label, value) in PAYMENT_STATUS_LABELS" :key="value" :value="value">
          {{ label }}
        </option>
      </select>
      <button type="submit">조회</button>
    </form>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>거래일</th>
            <th>매출처</th>
            <th>발주번호</th>
            <th>상품종류</th>
            <th>총수량</th>
            <th>상품매출</th>
            <th>청구배송비</th>
            <th>총청구액</th>
            <th>상품원가</th>
            <th>상품마진</th>
            <th>상품마진율</th>
            <th>정산상태</th>
            <th>거래명세서 버전수</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in items" :key="row.id">
            <td>
              <RouterLink :to="`/orders/${row.id}`">{{ row.order_date }}</RouterLink>
            </td>
            <td>{{ row.client_name }}</td>
            <td>{{ row.id }} / {{ row.original_file_name }}</td>
            <td class="num">{{ row.product_kind_count }}</td>
            <td class="num">{{ row.total_quantity }}</td>
            <td class="num">{{ formatWon(row.total_product_sales) }}</td>
            <td class="num">{{ formatWon(row.total_shipping_charge) }}</td>
            <td class="num">{{ formatWon(row.total_invoice_amount) }}</td>
            <td class="num">{{ formatWon(row.total_product_cost) }}</td>
            <td class="num" :class="moneyClass(row.total_product_margin)">
              {{ formatWon(row.total_product_margin) }}
            </td>
            <td class="num">{{ row.total_product_margin_rate }}%</td>
            <td>{{ PAYMENT_STATUS_LABELS[row.settlement_status] || row.settlement_status || "-" }}</td>
            <td class="num">{{ row.invoice_version_count }}</td>
          </tr>
          <tr v-if="items.length === 0">
            <td colspan="13">확정 거래가 없습니다.</td>
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
import { PAYMENT_STATUS_LABELS } from "../utils/labels";
import { flattenProductOptions } from "../utils/products";

const items = ref([]);
const clients = ref([]);
const products = ref([]);
const error = ref("");
const page = ref(1);
const total = ref(0);
const limit = 50;
const filters = reactive({
  from: "",
  to: "",
  client_id: "",
  product_id: "",
  order_number: "",
  settlement_status: "",
});

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit)));

function moneyClass(value) {
  return Number(value) < 0 ? "margin-neg" : "";
}

function buildQuery(nextPage) {
  const params = new URLSearchParams();
  params.set("page", String(nextPage));
  params.set("limit", String(limit));
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.client_id) params.set("client_id", filters.client_id);
  if (filters.product_id) params.set("product_id", filters.product_id);
  if (filters.order_number) params.set("order_number", filters.order_number);
  if (filters.settlement_status) params.set("settlement_status", filters.settlement_status);
  return params.toString();
}

async function load() {
  error.value = "";
  try {
    const data = await apiRequest("GET", `/orders?${buildQuery(page.value)}`);
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
    const [clientData, productData] = await Promise.all([
      apiRequest("GET", "/sales-clients"),
      apiRequest("GET", "/products?limit=200"),
    ]);
    clients.value = clientData.items;
    products.value = flattenProductOptions(productData.items);
  } catch (err) {
    error.value = err.message;
  }
  await load();
});
</script>

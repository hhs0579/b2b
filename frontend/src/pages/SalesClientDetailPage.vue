<script setup>
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { apiRequest } from "../api/client";
import { SETTLEMENT_LABELS, SHIPPING_CALC_LABELS, SHIPPING_LABELS } from "../utils/labels";
import { confirmHardDelete } from "../utils/confirm-delete";

const route = useRoute();
const router = useRouter();
const client = ref(null);
const mapping = ref(null);
const error = ref("");

async function load() {
  error.value = "";
  try {
    const [detail, mapped] = await Promise.all([
      apiRequest("GET", `/sales-clients/${route.params.id}`),
      apiRequest("GET", `/sales-clients/${route.params.id}/excel-mapping`),
    ]);
    client.value = detail;
    mapping.value = mapped.mapping;
  } catch (err) {
    error.value = err.message;
  }
}

async function removeMapping() {
  error.value = "";
  if (!confirmHardDelete("이 Excel Mapping을 삭제합니다.\n이미 업로드된 발주서와 확정 거래는 변경되지 않습니다.")) {
    return;
  }
  try {
    await apiRequest("DELETE", `/sales-clients/${route.params.id}/excel-mapping`);
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

onMounted(load);
</script>

<template>
  <section class="page">
    <div class="page-header">
      <h1>매출처 상세</h1>
      <div>
        <button type="button" @click="router.push('/sales-clients')">목록</button>
        <button type="button" @click="router.push(`/sales-clients/${route.params.id}/prices`)">제안가 관리</button>
        <button type="button" @click="router.push(`/sales-clients/${route.params.id}/aliases`)">상품 Alias</button>
      </div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <table v-if="client" class="status-table">
      <tbody>
        <tr><th>매출처</th><td>{{ client.client_name }} ({{ client.client_code }})</td></tr>
        <tr><th>상태</th><td>{{ client.is_active ? "활성" : "비활성" }}</td></tr>
        <tr><th>기본배송</th><td>{{ SHIPPING_LABELS[client.default_shipping_type] }}</td></tr>
        <tr><th>배송비 계산</th><td>{{ SHIPPING_CALC_LABELS[client.shipping_calculation_mode] }}</td></tr>
        <tr><th>정산</th><td>{{ SETTLEMENT_LABELS[client.settlement_type] }}</td></tr>
        <tr><th>담당자</th><td>{{ client.manager_name || "-" }} / {{ client.phone || "-" }}</td></tr>
        <tr><th>제안가 등록상품</th><td>{{ client.priced_product_count }}개</td></tr>
        <tr><th>제안가 미등록상품</th><td>{{ client.unpriced_product_count }}개</td></tr>
        <tr>
          <th>Excel Mapping</th>
          <td>
            <template v-if="mapping">
              {{ mapping.mapping_name }} / header {{ mapping.header_start_row || mapping.header_row_number }}–{{ mapping.header_end_row || mapping.header_row_number }}
            </template>
            <template v-else>없음</template>
            <button v-if="mapping" type="button" class="btn-danger" @click="removeMapping">Mapping 삭제</button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

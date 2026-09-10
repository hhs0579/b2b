<template>
  <section class="page wide">
    <div class="page-header">
      <h1>업로드 내역</h1>
      <button type="button" @click="router.push('/order-imports/new')">발주서 업로드</button>
    </div>
    <form class="toolbar" @submit.prevent="load">
      <select v-model="filters.client_id">
        <option value="">매출처 전체</option>
        <option v-for="item in clients" :key="item.id" :value="String(item.id)">
          {{ item.client_name }}
        </option>
      </select>
      <select v-model="filters.status">
        <option value="">상태 전체</option>
        <option v-for="(label, value) in IMPORT_STATUS_LABELS" :key="value" :value="value">{{ label }}</option>
      </select>
      <button type="submit">조회</button>
    </form>
    <p v-if="error" class="error">{{ error }}</p>
    <table class="data-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>매출처</th>
          <th>발주일</th>
          <th>원본파일</th>
          <th>상태</th>
          <th>행수</th>
          <th>매칭/미매칭</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in items" :key="row.id">
          <td>{{ row.id }}</td>
          <td>{{ row.client_name }}</td>
          <td>{{ row.order_date }}</td>
          <td>{{ row.original_file_name }}</td>
          <td>{{ IMPORT_STATUS_LABELS[row.status] || row.status }}</td>
          <td>{{ row.parsed_row_count }}</td>
          <td>{{ row.matched_row_count }} / {{ row.unmatched_row_count }}</td>
          <td class="row-actions">
            <button type="button" @click="router.push(`/order-imports/${row.id}`)">열기</button>
            <button type="button" class="btn-danger" @click="removeRow(row)">삭제</button>
          </td>
        </tr>
        <tr v-if="items.length === 0">
          <td colspan="8">업로드 내역이 없습니다.</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { apiRequest } from "../api/client";
import { IMPORT_STATUS_LABELS } from "../utils/labels";
import { blockedDeleteMessage, confirmHardDelete } from "../utils/confirm-delete";

const router = useRouter();
const items = ref([]);
const clients = ref([]);
const error = ref("");
const filters = reactive({ client_id: "", status: "" });

async function load() {
  error.value = "";
  try {
    const params = new URLSearchParams();
    if (filters.client_id) params.set("client_id", filters.client_id);
    if (filters.status) params.set("status", filters.status);
    const query = params.toString();
    const data = await apiRequest("GET", `/order-imports${query ? `?${query}` : ""}`);
    items.value = data.items;
  } catch (err) {
    error.value = err.message;
  }
}

async function removeRow(row) {
  error.value = "";
  try {
    const impact = await apiRequest("GET", `/order-imports/${row.id}/delete-impact`);
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
    const query = deleteDraft ? "?delete_draft=true" : "";
    await apiRequest("DELETE", `/order-imports/${row.id}${query}`);
    await load();
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

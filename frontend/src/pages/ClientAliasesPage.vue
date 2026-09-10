<script setup>
import { onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { apiRequest } from "../api/client";
import { confirmHardDelete } from "../utils/confirm-delete";
import { formatProductCode } from "../utils/format";
import { flattenProductOptions, optionLabel } from "../utils/products";

const route = useRoute();
const router = useRouter();
const items = ref([]);
const products = ref([]);
const error = ref("");
const form = reactive({
  external_product_code: "",
  external_product_name: "",
  external_option_name: "",
  product_option_id: "",
});

async function load() {
  error.value = "";
  try {
    const [aliases, productData] = await Promise.all([
      apiRequest("GET", `/sales-clients/${route.params.id}/aliases`),
      apiRequest("GET", "/products?limit=200"),
    ]);
    items.value = aliases.items;
    products.value = flattenProductOptions(productData.items);
  } catch (err) {
    error.value = err.message;
  }
}

async function save() {
  error.value = "";
  try {
    await apiRequest("POST", `/sales-clients/${route.params.id}/aliases`, {
      ...form,
      product_option_id: Number(form.product_option_id),
    });
    form.external_product_code = "";
    form.external_product_name = "";
    form.external_option_name = "";
    form.product_option_id = "";
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

async function removeAlias(row) {
  error.value = "";
  if (!confirmHardDelete("이 Alias를 삭제합니다.\n과거 발주 매칭과 확정 Snapshot은 변경되지 않습니다.")) {
    return;
  }
  try {
    await apiRequest("DELETE", `/sales-clients/${route.params.id}/aliases/${row.id}`);
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
      <h1>상품 Alias 관리</h1>
      <button type="button" @click="router.push(`/sales-clients/${route.params.id}`)">매출처 상세</button>
    </div>
    <p>Alias를 삭제해도 과거 발주서 행의 매칭 결과는 바뀌지 않습니다.</p>
    <p v-if="error" class="error">{{ error }}</p>
    <form class="edit-form" @submit.prevent="save">
      <h2>Alias 등록</h2>
      <div class="form-grid">
        <label>외부 상품코드<input v-model="form.external_product_code" /></label>
        <label>외부 상품명<input v-model="form.external_product_name" /></label>
        <label>외부 옵션<input v-model="form.external_option_name" /></label>
        <label>
          내부 상품 *
          <select v-model="form.product_option_id" required>
            <option value="">선택</option>
            <option v-for="product in products" :key="product.id" :value="String(product.id)">
              {{ formatProductCode(product.product_code) }} / {{ optionLabel(product) }}
            </option>
          </select>
        </label>
      </div>
      <div class="form-actions">
        <button type="submit">저장</button>
      </div>
    </form>
    <table class="data-table">
      <thead>
        <tr>
          <th>외부코드</th>
          <th>외부상품명</th>
          <th>외부옵션</th>
          <th>내부코드</th>
          <th>내부상품</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in items" :key="row.id">
          <td>{{ row.external_product_code || "-" }}</td>
          <td>{{ row.external_product_name || "-" }}</td>
          <td>{{ row.external_option_name || "-" }}</td>
          <td>{{ formatProductCode(row.product_code) }}</td>
          <td>{{ row.product_name }} {{ row.option_name || "" }} {{ row.is_active ? "" : "(비활성)" }}</td>
          <td class="row-actions">
            <button type="button" class="btn-danger" @click="removeAlias(row)">삭제</button>
          </td>
        </tr>
        <tr v-if="items.length === 0">
          <td colspan="6">등록된 Alias가 없습니다.</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

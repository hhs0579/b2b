<template>
  <section class="page">
    <h1>발주서 업로드</h1>
    <p>매출처와 발주일을 선택한 뒤 Excel 원본을 올립니다. 이번 단계에서는 상품 식별까지만 합니다.</p>
    <form class="edit-form" @submit.prevent="submit">
      <div class="form-grid">
        <label>
          매출처 *
          <select v-model="form.client_id" required>
            <option value="">선택</option>
            <option v-for="item in clients" :key="item.id" :value="String(item.id)">
              {{ item.client_name }} ({{ item.client_code }})
            </option>
          </select>
        </label>
        <label>발주일 *<input v-model="form.order_date" type="date" required /></label>
        <label class="full">발주서 파일 * (.xls / .xlsx)<input type="file" accept=".xls,.xlsx" @change="onFile" /></label>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="form-actions">
        <button type="submit" :disabled="saving">업로드</button>
        <button type="button" @click="router.push('/order-imports')">내역</button>
      </div>
    </form>
  </section>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { apiRequest, apiUpload } from "../api/client";
import { todayKst } from "../utils/margin";

const router = useRouter();
const clients = ref([]);
const file = ref(null);
const saving = ref(false);
const error = ref("");
const form = reactive({
  client_id: "",
  order_date: todayKst(),
});

async function loadClients() {
  const data = await apiRequest("GET", "/sales-clients?is_active=true");
  clients.value = data.items;
}

function onFile(event) {
  file.value = event.target.files?.[0] || null;
}

async function submit() {
  error.value = "";
  if (!file.value) {
    error.value = "발주서 파일을 선택하세요.";
    return;
  }
  saving.value = true;
  try {
    const body = new FormData();
    body.append("client_id", form.client_id);
    body.append("order_date", form.order_date);
    body.append("file", file.value);
    const created = await apiUpload("/order-imports/upload", body);
    await router.push(`/order-imports/${created.id}`);
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try {
    await loadClients();
  } catch (err) {
    error.value = err.message;
  }
});
</script>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { apiRequest } from "../api/client";
import { blockedDeleteMessage, confirmHardDelete } from "../utils/confirm-delete";

const items = ref([]);
const loading = ref(false);
const error = ref("");
const filters = reactive({
  search: "",
  is_active: "",
});
const editingId = ref(null);
const formOpen = ref(false);
const form = reactive(emptyForm());

function emptyForm() {
  return {
    supplier_code: "",
    supplier_name: "",
    business_number: "",
    manager_name: "",
    phone: "",
    email: "",
    memo: "",
    is_active: true,
  };
}

function resetForm() {
  Object.assign(form, emptyForm());
  editingId.value = null;
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const params = new URLSearchParams();
    if (filters.search.trim()) {
      params.set("search", filters.search.trim());
    }
    if (filters.is_active !== "") {
      params.set("is_active", filters.is_active);
    }
    const query = params.toString();
    const data = await apiRequest("GET", `/suppliers${query ? `?${query}` : ""}`);
    items.value = data.items;
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  resetForm();
  formOpen.value = true;
}

function openEdit(row) {
  editingId.value = row.id;
  Object.assign(form, {
    supplier_code: row.supplier_code,
    supplier_name: row.supplier_name,
    business_number: row.business_number || "",
    manager_name: row.manager_name || "",
    phone: row.phone || "",
    email: row.email || "",
    memo: row.memo || "",
    is_active: row.is_active,
  });
  formOpen.value = true;
}

async function save() {
  error.value = "";
  const payload = {
    supplier_code: form.supplier_code,
    supplier_name: form.supplier_name,
    business_number: form.business_number,
    manager_name: form.manager_name,
    phone: form.phone,
    email: form.email,
    memo: form.memo,
    is_active: form.is_active,
  };
  try {
    if (editingId.value) {
      await apiRequest("PATCH", `/suppliers/${editingId.value}`, payload);
    } else {
      await apiRequest("POST", "/suppliers", payload);
    }
    formOpen.value = false;
    resetForm();
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

async function setActive(row, isActive) {
  error.value = "";
  try {
    await apiRequest("PATCH", `/suppliers/${row.id}/status`, { is_active: isActive });
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

async function removeRow(row) {
  error.value = "";
  try {
    const impact = await apiRequest("GET", `/suppliers/${row.id}/delete-impact`);
    if (!impact.can_delete) {
      window.alert(blockedDeleteMessage("이 매입처는 삭제할 수 없습니다.", impact.references, { products: "연결 상품" }));
      return;
    }
    if (!confirmHardDelete("이 매입처를 완전히 삭제합니다.\n연결된 데이터가 없는 경우에만 삭제됩니다.")) {
      return;
    }
    await apiRequest("DELETE", `/suppliers/${row.id}`);
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
      <h1>매입처 관리</h1>
      <button type="button" @click="openCreate">신규 등록</button>
    </div>

    <form class="toolbar" @submit.prevent="load">
      <input v-model="filters.search" placeholder="코드 / 매입처명 검색" />
      <select v-model="filters.is_active">
        <option value="">상태 전체</option>
        <option value="true">활성</option>
        <option value="false">비활성</option>
      </select>
      <button type="submit">검색</button>
    </form>

    <p v-if="error" class="error">{{ error }}</p>

    <form v-if="formOpen" class="edit-form" @submit.prevent="save">
      <h2>{{ editingId ? "매입처 수정" : "매입처 등록" }}</h2>
      <div class="form-grid">
        <label>매입처코드 *<input v-model="form.supplier_code" required /></label>
        <label>매입처명 *<input v-model="form.supplier_name" required /></label>
        <label>사업자번호<input v-model="form.business_number" /></label>
        <label>담당자<input v-model="form.manager_name" /></label>
        <label>전화번호<input v-model="form.phone" /></label>
        <label>이메일<input v-model="form.email" /></label>
        <label class="full">비고<textarea v-model="form.memo" rows="2" /></label>
        <label class="checkbox"><input v-model="form.is_active" type="checkbox" /> 활성</label>
      </div>
      <div class="form-actions">
        <button type="submit">저장</button>
        <button type="button" @click="formOpen = false">취소</button>
      </div>
    </form>

    <p v-if="loading">불러오는 중...</p>
    <table v-else class="data-table">
      <thead>
        <tr>
          <th>매입처코드</th>
          <th>매입처명</th>
          <th>사업자번호</th>
          <th>담당자</th>
          <th>전화번호</th>
          <th>이메일</th>
          <th>상태</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in items" :key="row.id">
          <td>{{ row.supplier_code }}</td>
          <td>{{ row.supplier_name }}</td>
          <td>{{ row.business_number || "-" }}</td>
          <td>{{ row.manager_name || "-" }}</td>
          <td>{{ row.phone || "-" }}</td>
          <td>{{ row.email || "-" }}</td>
          <td>{{ row.is_active ? "활성" : "비활성" }}</td>
          <td class="row-actions">
            <button type="button" @click="openEdit(row)">수정</button>
            <button v-if="row.is_active" type="button" @click="setActive(row, false)">비활성화</button>
            <button v-else type="button" @click="setActive(row, true)">재활성화</button>
            <button type="button" class="btn-danger" @click="removeRow(row)">삭제</button>
          </td>
        </tr>
        <tr v-if="items.length === 0">
          <td colspan="8">등록된 매입처가 없습니다.</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

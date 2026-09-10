<script setup>
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { apiRequest } from "../api/client";
import { SETTLEMENT_LABELS, SHIPPING_CALC_LABELS, SHIPPING_LABELS } from "../utils/labels";
import { blockedDeleteMessage, confirmHardDelete } from "../utils/confirm-delete";

const router = useRouter();
const items = ref([]);
const loading = ref(false);
const error = ref("");
const filters = reactive({ search: "", is_active: "" });
const editingId = ref(null);
const formOpen = ref(false);
const form = reactive(emptyForm());

function emptyForm() {
  return {
    client_code: "",
    client_name: "",
    business_number: "",
    ceo_name: "",
    address: "",
    manager_name: "",
    phone: "",
    email: "",
    default_shipping_type: "PARCEL",
    shipping_calculation_mode: "TOTAL_QUANTITY",
    settlement_type: "POSTPAID",
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
    if (filters.search.trim()) params.set("search", filters.search.trim());
    if (filters.is_active !== "") params.set("is_active", filters.is_active);
    const query = params.toString();
    const data = await apiRequest("GET", `/sales-clients${query ? `?${query}` : ""}`);
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
    client_code: row.client_code,
    client_name: row.client_name,
    business_number: row.business_number || "",
    ceo_name: row.ceo_name || "",
    address: row.address || "",
    manager_name: row.manager_name || "",
    phone: row.phone || "",
    email: row.email || "",
    default_shipping_type: row.default_shipping_type,
    shipping_calculation_mode: row.shipping_calculation_mode,
    settlement_type: row.settlement_type,
    memo: row.memo || "",
    is_active: row.is_active,
  });
  formOpen.value = true;
}

async function save() {
  error.value = "";
  try {
    if (editingId.value) {
      await apiRequest("PATCH", `/sales-clients/${editingId.value}`, { ...form });
    } else {
      await apiRequest("POST", "/sales-clients", { ...form });
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
    await apiRequest("PATCH", `/sales-clients/${row.id}/status`, { is_active: isActive });
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

async function removeRow(row) {
  error.value = "";
  try {
    const impact = await apiRequest("GET", `/sales-clients/${row.id}/delete-impact`);
    if (!impact.can_delete) {
      window.alert(blockedDeleteMessage("이 매출처는 삭제할 수 없습니다.", impact.references, {
        prices: "제안가",
        aliases: "Alias",
        mappings: "Excel Mapping",
        imports: "발주 업로드",
        orders: "거래",
        settlements: "정산",
      }));
      return;
    }
    if (!confirmHardDelete("이 매출처를 완전히 삭제합니다.\n연결된 데이터가 없는 경우에만 삭제됩니다.")) {
      return;
    }
    await apiRequest("DELETE", `/sales-clients/${row.id}`);
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
      <h1>매출처 관리</h1>
      <button type="button" @click="openCreate">신규 등록</button>
    </div>

    <form class="toolbar" @submit.prevent="load">
      <input v-model="filters.search" placeholder="코드 / 매출처명 / 사업자번호 / 담당자" />
      <select v-model="filters.is_active">
        <option value="">상태 전체</option>
        <option value="true">활성</option>
        <option value="false">비활성</option>
      </select>
      <button type="submit">검색</button>
    </form>

    <p v-if="error" class="error">{{ error }}</p>

    <form v-if="formOpen" class="edit-form" @submit.prevent="save">
      <h2>{{ editingId ? "매출처 수정" : "매출처 등록" }}</h2>
      <div class="form-grid">
        <label>매출처코드 *<input v-model="form.client_code" required /></label>
        <label>매출처명 *<input v-model="form.client_name" required /></label>
        <label>사업자번호<input v-model="form.business_number" /></label>
        <label>대표자<input v-model="form.ceo_name" /></label>
        <label class="full">주소<input v-model="form.address" /></label>
        <label>담당자<input v-model="form.manager_name" /></label>
        <label>전화번호<input v-model="form.phone" /></label>
        <label>이메일<input v-model="form.email" /></label>
        <label>
          기본배송 *
          <select v-model="form.default_shipping_type">
            <option v-for="(label, value) in SHIPPING_LABELS" :key="value" :value="value">{{ label }}</option>
          </select>
        </label>
        <label>
          배송비 계산 *
          <select v-model="form.shipping_calculation_mode">
            <option v-for="(label, value) in SHIPPING_CALC_LABELS" :key="value" :value="value">{{ label }}</option>
          </select>
        </label>
        <label>
          정산방식 *
          <select v-model="form.settlement_type">
            <option v-for="(label, value) in SETTLEMENT_LABELS" :key="value" :value="value">{{ label }}</option>
          </select>
        </label>
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
          <th>매출처코드</th>
          <th>매출처명</th>
          <th>사업자번호</th>
          <th>담당자</th>
          <th>전화번호</th>
          <th>기본배송</th>
          <th>배송비계산방식</th>
          <th>정산방식</th>
          <th>상태</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in items" :key="row.id">
          <td>{{ row.client_code }}</td>
          <td>{{ row.client_name }}</td>
          <td>{{ row.business_number || "-" }}</td>
          <td>{{ row.manager_name || "-" }}</td>
          <td>{{ row.phone || "-" }}</td>
          <td>{{ SHIPPING_LABELS[row.default_shipping_type] || row.default_shipping_type }}</td>
          <td>{{ SHIPPING_CALC_LABELS[row.shipping_calculation_mode] || row.shipping_calculation_mode }}</td>
          <td>{{ SETTLEMENT_LABELS[row.settlement_type] || row.settlement_type }}</td>
          <td>{{ row.is_active ? "활성" : "비활성" }}</td>
          <td class="row-actions">
            <button type="button" @click="router.push(`/sales-clients/${row.id}`)">상세</button>
            <button type="button" @click="router.push(`/sales-clients/${row.id}/prices`)">제안가 관리</button>
            <button type="button" @click="openEdit(row)">수정</button>
            <button v-if="row.is_active" type="button" @click="setActive(row, false)">비활성화</button>
            <button v-else type="button" @click="setActive(row, true)">재활성화</button>
            <button type="button" class="btn-danger" @click="removeRow(row)">삭제</button>
          </td>
        </tr>
        <tr v-if="items.length === 0">
          <td colspan="10">등록된 매출처가 없습니다.</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { apiRequest } from "../api/client";
import { formatDateTimeKst, formatProductCode, formatWon, parseWonInput } from "../utils/format";
import { flattenProductOptions } from "../utils/products";
import { SHIPPING_LABELS, VAT_LABELS } from "../utils/labels";
import { blockedDeleteMessage, confirmHardDelete } from "../utils/confirm-delete";

const items = ref([]);
const listRows = computed(() => flattenProductOptions(items.value));
const suppliers = ref([]);
const history = ref([]);
const pagination = ref({ page: 1, limit: 50, total: 0, totalPages: 0 });
const loading = ref(false);
const error = ref("");
const filters = reactive({
  search: "",
  supplier_id: "",
  is_active: "",
});
const editingId = ref(null);
const formOpen = ref(false);
const form = reactive(emptyForm());

function emptyOption() {
  return {
    id: null,
    option_name: "",
    product_code: "",
    barcode: "",
    purchase_price: "",
    vat_type: "INCLUDED",
    carton_qty: 1,
    default_shipping_fee: "0",
    default_shipping_type: "PARCEL",
    is_active: true,
    original_price: null,
  };
}

function emptyForm() {
  return {
    product_name: "",
    supplier_id: "",
    memo: "",
    is_active: true,
    options: [emptyOption()],
  };
}

function resetForm() {
  Object.assign(form, emptyForm());
  form.options = [emptyOption()];
  editingId.value = null;
  history.value = [];
}

async function loadSuppliers() {
  const data = await apiRequest("GET", "/suppliers");
  suppliers.value = data.items;
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const params = new URLSearchParams();
    if (filters.search.trim()) {
      params.set("search", filters.search.trim());
    }
    if (filters.supplier_id !== "") {
      params.set("supplier_id", filters.supplier_id);
    }
    if (filters.is_active !== "") {
      params.set("is_active", filters.is_active);
    }
    params.set("page", String(pagination.value.page));
    params.set("limit", String(pagination.value.limit));
    const data = await apiRequest("GET", `/products?${params.toString()}`);
    items.value = data.items;
    pagination.value = data.pagination;
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function loadHistory(productId) {
  history.value = await apiRequest("GET", `/products/${productId}/cost-history`);
}

function openCreate() {
  resetForm();
  formOpen.value = true;
}

function openEdit(row) {
  const product = items.value.find((item) => item.id === row.product_id) || row;
  editingId.value = product.id;
  form.product_name = product.product_name;
  form.supplier_id = String(product.supplier_id);
  form.memo = product.memo || "";
  form.is_active = product.is_active;
  form.options = (product.options || [row]).map((option) => ({
    id: option.id,
    option_name: option.option_name || "",
    product_code: option.product_code || "",
    barcode: option.barcode || "",
    purchase_price: formatWon(option.purchase_price),
    vat_type: option.vat_type,
    carton_qty: option.carton_qty,
    default_shipping_fee: formatWon(option.default_shipping_fee),
    default_shipping_type: option.default_shipping_type,
    is_active: option.is_active,
    original_price: option.purchase_price,
  }));
  formOpen.value = true;
  error.value = "";
  loadHistory(product.id).catch((err) => {
    error.value = err.message;
  });
}

function addOption() {
  form.options.push(emptyOption());
}

async function removeOption(index) {
  const option = form.options[index];
  if (form.options.length <= 1) {
    return;
  }
  if (editingId.value && option.id) {
    try {
      const impact = await apiRequest("GET", `/products/${editingId.value}/options/${option.id}/delete-impact`);
      if (!impact.can_delete) {
        window.alert(blockedDeleteMessage("이 옵션은 삭제할 수 없습니다.", impact.references, {
          prices: "제안가 이력",
          aliases: "Alias",
          imports: "발주 참조",
          confirmed_orders: "확정 거래",
          order_items: "거래 품목",
        }));
        return;
      }
      if (!confirmHardDelete("이 옵션을 삭제합니다.")) {
        return;
      }
      await apiRequest("DELETE", `/products/${editingId.value}/options/${option.id}`);
    } catch (err) {
      error.value = err.message;
      return;
    }
  }
  form.options.splice(index, 1);
}

function parseOptionPayload(option) {
  const purchasePrice = parseWonInput(option.purchase_price);
  const shippingFee = parseWonInput(option.default_shipping_fee);
  if (!Number.isInteger(purchasePrice) || purchasePrice < 0) {
    throw new Error("원가는 0 이상의 정수(원)여야 합니다.");
  }
  if (!Number.isInteger(shippingFee) || shippingFee < 0) {
    throw new Error("카톤당 기본 택배비는 0 이상의 정수(원)여야 합니다.");
  }
  return {
    id: option.id || undefined,
    option_name: option.option_name,
    product_code: option.product_code,
    barcode: option.barcode,
    purchase_price: purchasePrice,
    vat_type: option.vat_type,
    carton_qty: Number(option.carton_qty),
    default_shipping_fee: shippingFee,
    default_shipping_type: option.default_shipping_type,
    is_active: option.is_active,
  };
}

const priceChanged = computed(() => {
  if (!editingId.value) {
    return false;
  }
  return form.options.some((option) => {
    const parsed = parseWonInput(option.purchase_price);
    return Number.isInteger(parsed) && option.original_price != null && parsed !== option.original_price;
  });
});

async function save() {
  error.value = "";
  let options;
  try {
    options = form.options.map(parseOptionPayload);
  } catch (err) {
    error.value = err.message;
    return;
  }

  if (priceChanged.value) {
    const confirmed = window.confirm("옵션 원가가 변경됩니다. 계속할까요?");
    if (!confirmed) {
      return;
    }
  }

  const payload = {
    product_name: form.product_name,
    supplier_id: Number(form.supplier_id),
    memo: form.memo,
    is_active: form.is_active,
    options,
  };

  try {
    if (editingId.value) {
      await apiRequest("PATCH", `/products/${editingId.value}`, payload);
    } else {
      await apiRequest("POST", "/products", payload);
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
    await apiRequest("PATCH", `/products/${row.product_id}/status`, { is_active: isActive });
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

async function removeRow(row) {
  error.value = "";
  try {
    const impact = await apiRequest("GET", `/products/${row.product_id}/delete-impact`);
    if (!impact.can_delete) {
      window.alert(blockedDeleteMessage("이 상품은 삭제할 수 없습니다.", impact.references, {
        prices: "제안가 이력",
        aliases: "Alias",
        imports: "발주 참조",
        confirmed_orders: "확정 거래",
        order_items: "거래 품목",
      }));
      return;
    }
    if (!confirmHardDelete("이 상품과 모든 옵션을 완전히 삭제합니다.\n연결된 데이터가 없는 경우에만 삭제됩니다.")) {
      return;
    }
    await apiRequest("DELETE", `/products/${row.product_id}`);
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

function changePage(delta) {
  const next = pagination.value.page + delta;
  if (next < 1 || (pagination.value.totalPages > 0 && next > pagination.value.totalPages)) {
    return;
  }
  pagination.value.page = next;
  load();
}

onMounted(async () => {
  try {
    await loadSuppliers();
    await load();
  } catch (err) {
    error.value = err.message;
  }
});
</script>

<template>
  <section class="page wide">
    <div class="page-header">
      <h1>상품 관리</h1>
      <button type="button" @click="openCreate">신규 등록</button>
    </div>

    <form class="toolbar" @submit.prevent="pagination.page = 1; load()">
      <input v-model="filters.search" placeholder="코드 / 상품명 / 옵션 / 바코드" />
      <select v-model="filters.supplier_id">
        <option value="">매입처 전체</option>
        <option v-for="supplier in suppliers" :key="supplier.id" :value="String(supplier.id)">
          {{ supplier.supplier_name }} ({{ supplier.supplier_code }})
        </option>
      </select>
      <select v-model="filters.is_active">
        <option value="">상태 전체</option>
        <option value="true">활성</option>
        <option value="false">비활성</option>
      </select>
      <button type="submit">검색</button>
    </form>

    <p v-if="error" class="error">{{ error }}</p>

    <form v-if="formOpen" class="edit-form" @submit.prevent="save">
      <h2>{{ editingId ? "상품 수정" : "상품 등록" }}</h2>
      <div class="form-grid">
        <label>상품명 *<input v-model="form.product_name" required /></label>
        <label>
          매입처 *
          <select v-model="form.supplier_id" required>
            <option value="" disabled>선택</option>
            <option v-for="supplier in suppliers" :key="supplier.id" :value="String(supplier.id)">
              {{ supplier.supplier_name }} ({{ supplier.supplier_code }})
              {{ supplier.is_active ? "" : " [비활성]" }}
            </option>
          </select>
        </label>
        <label class="full">비고<textarea v-model="form.memo" rows="2" /></label>
        <label class="checkbox"><input v-model="form.is_active" type="checkbox" /> 활성</label>
      </div>

      <div class="option-list">
        <div class="option-list-header">
          <h3>옵션</h3>
          <button type="button" @click="addOption">+ 옵션 추가</button>
        </div>
        <div v-for="(option, index) in form.options" :key="option.id || `new-${index}`" class="option-card">
          <div class="option-card-title">
            <strong>{{ option.option_name || "기본 옵션" }}</strong>
            <button v-if="form.options.length > 1" type="button" class="btn-danger" @click="removeOption(index)">
              옵션 삭제
            </button>
          </div>
          <div class="form-grid">
            <label>옵션명<input v-model="option.option_name" placeholder="비우면 단일 상품" /></label>
            <label>상품코드<input v-model="option.product_code" /></label>
            <label>바코드<input v-model="option.barcode" /></label>
            <label>원가 *<input v-model="option.purchase_price" inputmode="numeric" required /></label>
            <label>
              VAT *
              <select v-model="option.vat_type">
                <option v-for="(label, value) in VAT_LABELS" :key="value" :value="value">{{ label }}</option>
              </select>
            </label>
            <label>카톤입수량 *<input v-model.number="option.carton_qty" type="number" min="1" step="1" required /></label>
            <label>카톤당 기본 택배비 *<input v-model="option.default_shipping_fee" inputmode="numeric" required /></label>
            <label>
              기본 배송방식 *
              <select v-model="option.default_shipping_type">
                <option v-for="(label, value) in SHIPPING_LABELS" :key="value" :value="value">{{ label }}</option>
              </select>
            </label>
            <label class="checkbox"><input v-model="option.is_active" type="checkbox" /> 옵션 활성</label>
          </div>
        </div>
      </div>

      <p v-if="priceChanged" class="notice">옵션 원가가 변경되면 원가 이력이 기록됩니다.</p>
      <div class="form-actions">
        <button type="submit">저장</button>
        <button type="button" @click="formOpen = false">취소</button>
      </div>

      <div v-if="editingId" class="history-block">
        <h3>원가 변경이력</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>변경일</th>
              <th>옵션</th>
              <th>기존원가</th>
              <th>변경원가</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in history" :key="row.id">
              <td>{{ formatDateTimeKst(row.changed_at) }}</td>
              <td>{{ row.option_name || "-" }}</td>
              <td class="num">{{ formatWon(row.old_price) }}</td>
              <td class="num">{{ formatWon(row.new_price) }}</td>
            </tr>
            <tr v-if="history.length === 0">
              <td colspan="4">원가 변경이력이 없습니다.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </form>

    <p v-if="loading">불러오는 중...</p>
    <table v-else class="data-table">
      <thead>
        <tr>
          <th>상품코드</th>
          <th>상품명</th>
          <th>옵션</th>
          <th>매입처</th>
          <th>원가</th>
          <th>VAT</th>
          <th>카톤입수</th>
          <th>기본 택배비</th>
          <th>배송방식</th>
          <th>상태</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in listRows" :key="row.id">
          <td>{{ formatProductCode(row.product_code) }}</td>
          <td>{{ row.product_name }}</td>
          <td>{{ row.option_name || "-" }}</td>
          <td>{{ row.supplier_name }}</td>
          <td class="num">{{ formatWon(row.purchase_price) }}</td>
          <td>{{ VAT_LABELS[row.vat_type] || row.vat_type }}</td>
          <td class="num">{{ row.carton_qty }}</td>
          <td class="num">{{ formatWon(row.default_shipping_fee) }}</td>
          <td>{{ SHIPPING_LABELS[row.default_shipping_type] || row.default_shipping_type }}</td>
          <td>{{ row.is_active ? "활성" : "비활성" }}</td>
          <td class="row-actions">
            <button type="button" @click="openEdit(row)">수정</button>
            <button v-if="row.product_is_active" type="button" @click="setActive(row, false)">비활성화</button>
            <button v-else type="button" @click="setActive(row, true)">재활성화</button>
            <button type="button" class="btn-danger" @click="removeRow(row)">삭제</button>
          </td>
        </tr>
        <tr v-if="listRows.length === 0">
          <td colspan="11">등록된 상품이 없습니다.</td>
        </tr>
      </tbody>
    </table>

    <div class="pager">
      <button type="button" :disabled="pagination.page <= 1" @click="changePage(-1)">이전</button>
      <span>{{ pagination.page }} / {{ pagination.totalPages || 1 }} ({{ pagination.total }}건)</span>
      <button
        type="button"
        :disabled="pagination.totalPages === 0 || pagination.page >= pagination.totalPages"
        @click="changePage(1)"
      >
        다음
      </button>
    </div>
  </section>
</template>

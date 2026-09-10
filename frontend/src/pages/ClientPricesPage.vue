<script setup>
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { apiRequest } from "../api/client";
import { formatProductCode, formatWon, parseWonInput } from "../utils/format";
import { estimateProductMargin, formatIsoDate, todayKst } from "../utils/margin";
import { blockedDeleteMessage, confirmHardDelete } from "../utils/confirm-delete";

const route = useRoute();
const router = useRouter();
const client = ref(null);
const rows = ref([]);
const history = ref([]);
const includeInactive = ref(false);
const effectiveFrom = ref(todayKst());
const historyProductId = ref("");
const loading = ref(false);
const error = ref("");
const saving = ref(false);

function toRow(item) {
  return {
    ...item,
    new_sale_price: "",
    override_mode: item.current_shipping_fee_override == null ? "default" : "custom",
    new_override:
      item.current_shipping_fee_override == null ? "" : formatWon(item.current_shipping_fee_override),
  };
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const params = new URLSearchParams();
    if (includeInactive.value) params.set("include_inactive", "true");
    const [detail, products, prices] = await Promise.all([
      apiRequest("GET", `/sales-clients/${route.params.id}`),
      apiRequest("GET", `/sales-clients/${route.params.id}/products?${params.toString()}`),
      apiRequest("GET", `/sales-clients/${route.params.id}/prices`),
    ]);
    client.value = detail;
    rows.value = products.items.map(toRow);
    history.value = prices.items;
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

function previewMargin(row) {
  const typed = parseWonInput(row.new_sale_price);
  const sale = Number.isInteger(typed) ? typed : row.current_sale_price;
  return estimateProductMargin(sale, row.purchase_price);
}

function changedItems() {
  return rows.value.flatMap((row) => {
    const typedPrice = parseWonInput(row.new_sale_price);
    const override =
      row.override_mode === "default" ? null : parseWonInput(row.new_override);
    const priceEntered = Number.isInteger(typedPrice);
    const currentOverride = row.current_shipping_fee_override;
    const overrideChanged =
      row.override_mode === "default"
        ? currentOverride != null
        : !Number.isInteger(override) || override !== currentOverride;
    if (!priceEntered && !overrideChanged) {
      return [];
    }
    if (row.override_mode === "custom" && !Number.isInteger(override)) {
      throw new Error(`${formatProductCode(row.product_code)}: 배송비 override는 0 이상 정수여야 합니다.`);
    }
    const salePrice = priceEntered ? typedPrice : row.current_sale_price;
    if (!Number.isInteger(salePrice)) {
      throw new Error(`${formatProductCode(row.product_code)}: 제안가를 입력하세요.`);
    }
    return [
      {
        product_option_id: row.product_option_id,
        sale_price: salePrice,
        shipping_fee_override: row.override_mode === "default" ? null : override,
      },
    ];
  });
}

const changedCount = computed(() => {
  try {
    return changedItems().length;
  } catch {
    return 0;
  }
});

async function saveChanged() {
  error.value = "";
  if (!client.value?.is_active) {
    error.value = "비활성 매출처에는 제안가를 등록할 수 없습니다.";
    return;
  }
  let items;
  try {
    items = changedItems();
  } catch (err) {
    error.value = err.message;
    return;
  }
  if (items.length === 0) {
    error.value = "변경된 항목이 없습니다.";
    return;
  }
  saving.value = true;
  try {
    await apiRequest("PUT", `/sales-clients/${route.params.id}/prices/bulk`, {
      effective_from: effectiveFrom.value,
      items,
    });
    await load();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function removePrice(row) {
  error.value = "";
  try {
    const impact = await apiRequest("GET", `/sales-clients/${route.params.id}/prices/${row.id}/delete-impact`);
    if (!impact.can_delete) {
      window.alert(blockedDeleteMessage("이 제안가는 삭제할 수 없습니다.", impact.references, {
        confirmed_orders: "확정 거래 참조",
        order_items: "거래 품목",
      }));
      return;
    }
    if (!confirmHardDelete("이 제안가 이력을 삭제합니다.\n확정 거래에서 사용되지 않은 경우에만 삭제됩니다.")) {
      return;
    }
    await apiRequest("DELETE", `/sales-clients/${route.params.id}/prices/${row.id}`);
    await load();
  } catch (err) {
    error.value = err.message;
  }
}

const historyRows = computed(() => {
  if (!historyProductId.value) {
    return history.value;
  }
  return history.value.filter((row) => String(row.product_option_id) === historyProductId.value);
});

onMounted(load);
</script>

<template>
  <section class="page wide">
    <div class="page-header">
      <h1>제안가 관리</h1>
      <div>
        <button type="button" @click="router.push(`/sales-clients/${route.params.id}`)">상세</button>
        <button type="button" @click="router.push('/sales-clients')">매출처 목록</button>
      </div>
    </div>

    <p v-if="client">
      {{ client.client_name }} ({{ client.client_code }})
      / {{ client.is_active ? "활성" : "비활성" }}
    </p>
    <p v-if="client && !client.is_active" class="notice">비활성 매출처에는 신규 제안가를 등록할 수 없습니다.</p>

    <form class="toolbar" @submit.prevent="load">
      <label>적용 시작일 <input v-model="effectiveFrom" type="date" required /></label>
      <label class="checkbox">
        <input v-model="includeInactive" type="checkbox" @change="load" /> 비활성 상품 포함
      </label>
      <button type="button" :disabled="saving || !client?.is_active" @click="saveChanged">
        변경된 항목 저장 ({{ changedCount }})
      </button>
    </form>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading">불러오는 중...</p>

    <table v-else class="data-table">
      <thead>
        <tr>
          <th>상품코드</th>
          <th>상품명</th>
          <th>옵션</th>
          <th>매입처</th>
          <th>현재원가</th>
          <th>현재제안가</th>
          <th>신규제안가</th>
          <th>예상마진</th>
          <th>예상마진율</th>
          <th>기본택배비</th>
          <th>배송비 Override</th>
          <th>적용일</th>
          <th>상태</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.product_option_id">
          <td>{{ formatProductCode(row.product_code) }}</td>
          <td>{{ row.product_name }}</td>
          <td>{{ row.option_name || "-" }}</td>
          <td>{{ row.supplier_name }}</td>
          <td class="num">{{ formatWon(row.purchase_price) }}</td>
          <td class="num">{{ row.current_sale_price == null ? "-" : formatWon(row.current_sale_price) }}</td>
          <td><input v-model="row.new_sale_price" class="price-input" inputmode="numeric" /></td>
          <td class="num">
            {{ previewMargin(row).estimated_margin == null ? "-" : formatWon(previewMargin(row).estimated_margin) }}
          </td>
          <td class="num">
            {{ previewMargin(row).estimated_margin_rate == null ? "-" : `${previewMargin(row).estimated_margin_rate}%` }}
          </td>
          <td class="num">{{ formatWon(row.default_shipping_fee) }}</td>
          <td>
            <select v-model="row.override_mode">
              <option value="default">기본값 사용</option>
              <option value="custom">직접 입력</option>
            </select>
            <input
              v-if="row.override_mode === 'custom'"
              v-model="row.new_override"
              class="price-input"
              inputmode="numeric"
              placeholder="0"
            />
          </td>
          <td>{{ row.effective_from || "-" }}</td>
          <td>{{ row.current_sale_price == null ? "제안가 미등록" : row.is_active ? "등록" : "비활성" }}</td>
        </tr>
      </tbody>
    </table>

    <div class="history-block">
      <h3>가격 이력</h3>
      <p>확정 거래에서 사용된 제안가는 삭제할 수 없습니다. 일반적으로는 유효기간 수정 또는 새 가격 등록을 사용하세요.</p>
      <select v-model="historyProductId">
        <option value="">전체 상품</option>
        <option v-for="row in rows" :key="row.product_option_id" :value="String(row.product_option_id)">
          {{ row.product_name }} {{ row.option_name || "" }}
        </option>
      </select>
      <table class="data-table">
        <thead>
          <tr>
            <th>상품</th>
            <th>적용기간</th>
            <th>제안가</th>
            <th>배송비 Override</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in historyRows" :key="row.id">
            <td>{{ row.product_name }} {{ row.option_name || "" }}</td>
            <td>{{ formatIsoDate(row.effective_from) }} ~ {{ formatIsoDate(row.effective_to) }}</td>
            <td class="num">{{ formatWon(row.sale_price) }}</td>
            <td>{{ row.shipping_fee_override == null ? "기본값 사용" : formatWon(row.shipping_fee_override) }}</td>
            <td class="row-actions">
              <button type="button" class="btn-danger" @click="removePrice(row)">삭제</button>
            </td>
          </tr>
          <tr v-if="historyRows.length === 0">
            <td colspan="5">가격 이력이 없습니다.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

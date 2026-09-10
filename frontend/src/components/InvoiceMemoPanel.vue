<template>
  <section class="invoice-memo">
    <form class="edit-form" @submit.prevent="save">
      <h3>거래명세서 특이사항</h3>
      <div class="form-grid">
        <label>
          배송방법
          <input v-model="form.shipping_method" :disabled="readonly" />
        </label>
        <label>
          출고일
          <input v-model="form.ship_date" type="date" :disabled="readonly" />
        </label>
        <label class="full">
          배송지
          <input v-model="form.destination" :disabled="readonly" />
        </label>
        <label class="full">
          담당자
          <input v-model="form.manager" :disabled="readonly" />
        </label>
      </div>
      <div v-if="!readonly" class="form-actions">
        <button type="submit" :disabled="saving">저장</button>
      </div>
    </form>

    <div class="invoice-memo-preview">
      <h3>특이사항 Preview</h3>
      <pre class="note-preview">{{ displayPreview }}</pre>
      <div v-if="warnings.length" class="banner-warn">
        <div v-for="item in warnings" :key="item.field || item.message">{{ item.message }}</div>
      </div>
      <template v-if="shippingNotes.length">
        <h3>배송비 비고</h3>
        <ul class="shipping-notes">
          <li v-for="row in shippingNotes" :key="row.label">
            {{ row.label }}
            <span v-if="row.note"> — 비고: {{ row.note }}</span>
          </li>
        </ul>
      </template>
    </div>
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from "vue";
import { apiRequest } from "../api/client";

const props = defineProps({
  orderId: { type: [Number, String], required: true },
  saved: { type: Object, default: () => ({}) },
  defaults: { type: Object, default: () => ({}) },
  notePreview: { type: String, default: "" },
  suggestedPreview: { type: String, default: "" },
  warnings: { type: Array, default: () => [] },
  shippingNotes: { type: Array, default: () => [] },
  readonly: { type: Boolean, default: false },
});

const emit = defineEmits(["saved", "error"]);

const form = reactive({
  shipping_method: "",
  ship_date: "",
  destination: "",
  manager: "",
});
const saving = ref(false);

const displayPreview = computed(
  () => props.notePreview || props.suggestedPreview || "",
);

function applyForm(saved, defaults) {
  form.shipping_method = saved?.shipping_method ?? defaults?.shipping_method ?? "";
  form.ship_date = saved?.ship_date ?? defaults?.ship_date ?? "";
  form.destination = saved?.destination ?? defaults?.destination ?? "";
  form.manager = saved?.manager ?? defaults?.manager ?? "";
}

watch(
  () => [props.saved, props.defaults],
  () => applyForm(props.saved, props.defaults),
  { immediate: true, deep: true },
);

async function save() {
  if (props.readonly) {
    return null;
  }
  saving.value = true;
  try {
    const result = await apiRequest("PATCH", `/orders/${props.orderId}/invoice-memo`, {
      invoice_shipping_method: form.shipping_method || null,
      invoice_ship_date: form.ship_date || null,
      invoice_destination: form.destination || null,
      invoice_manager: form.manager || null,
    });
    emit("saved", result);
    return result;
  } catch (err) {
    emit("error", err);
    throw err;
  } finally {
    saving.value = false;
  }
}

defineExpose({ save, form });
</script>

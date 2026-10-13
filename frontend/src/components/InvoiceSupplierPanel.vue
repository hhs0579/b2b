<template>
  <section class="invoice-supplier">
    <label>
      공급자
      <select v-model="selectedId" :disabled="readonly || disabled">
        <option value="">선택</option>
        <option v-for="item in suppliers" :key="item.id" :value="String(item.id)">
          {{ item.supplier_name }}
        </option>
      </select>
    </label>
    <p v-if="selected?.supplier_code === 'BESTHEIM'" class="notice">
      베스트하임 공급자 정보와 인감으로 생성됩니다.
    </p>
    <p v-else-if="selected?.supplier_code === 'ESSER'" class="notice">
      에쎄르 공급자 정보와 인감으로 생성됩니다.
    </p>
  </section>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { apiRequest } from "../api/client";

const props = defineProps({
  modelValue: { type: [Number, String, null], default: "" },
  readonly: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
});

const emit = defineEmits(["update:modelValue", "error"]);

const suppliers = ref([]);
const selectedId = ref(props.modelValue ? String(props.modelValue) : "");

const selected = computed(() => suppliers.value.find((item) => String(item.id) === selectedId.value) || null);

watch(
  () => props.modelValue,
  (value) => {
    selectedId.value = value ? String(value) : "";
  },
);

watch(selectedId, (value) => {
  emit("update:modelValue", value ? Number(value) : "");
});

onMounted(async () => {
  try {
    const result = await apiRequest("GET", "/invoice-suppliers?is_active=true");
    suppliers.value = result.items || [];
  } catch (err) {
    emit("error", err);
  }
});
</script>

<style scoped>
.invoice-supplier {
  margin: 12px 0;
}

.invoice-supplier label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 280px;
}
</style>

<script setup>
import { computed, onMounted } from "vue";
import { useSystemStore } from "../stores/system";

const system = useSystemStore();

onMounted(() => {
  system.refreshHealth();
});

const backendStatus = computed(() => {
  if (system.error) {
    return { label: "연결 실패", ok: false };
  }
  if (!system.health) {
    return { label: "확인 중", ok: null };
  }
  return { label: "정상", ok: true };
});

const databaseStatus = computed(() => {
  if (system.loading && !system.health && !system.error) {
    return { label: "확인 중", ok: null };
  }
  if (system.error || !system.health) {
    return { label: "확인 불가", ok: false };
  }
  if (system.health.database === "connected") {
    return { label: "정상", ok: true };
  }
  return { label: "연결 실패", ok: false };
});
</script>

<template>
  <section class="page">
    <div class="page-header">
      <h1>System Status</h1>
      <button type="button" :disabled="system.loading" @click="system.refreshHealth()">
        {{ system.loading ? "확인 중..." : "다시 확인" }}
      </button>
    </div>

    <p v-if="system.error" class="error">{{ system.error }}</p>

    <table class="status-table">
      <tbody>
        <tr>
          <th>Backend</th>
          <td>
            <span
              :class="['status', backendStatus.ok === true ? 'ok' : backendStatus.ok === false ? 'fail' : 'pending']"
            >
              {{ backendStatus.label }}
            </span>
          </td>
        </tr>
        <tr>
          <th>Database</th>
          <td>
            <span
              :class="['status', databaseStatus.ok === true ? 'ok' : databaseStatus.ok === false ? 'fail' : 'pending']"
            >
              {{ databaseStatus.label }}
            </span>
          </td>
        </tr>
        <tr>
          <th>Environment</th>
          <td>{{ system.health?.environment || "-" }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

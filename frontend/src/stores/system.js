import { defineStore } from "pinia";
import { getHealth } from "../api/client";

export const useSystemStore = defineStore("system", {
  state: () => ({
    loading: false,
    error: null,
    health: null,
  }),
  actions: {
    async refreshHealth() {
      this.loading = true;
      this.error = null;
      try {
        this.health = await getHealth();
      } catch (err) {
        this.health = null;
        this.error = err.message || "상태를 확인할 수 없습니다.";
      } finally {
        this.loading = false;
      }
    },
  },
});

import { monthStartKst, todayKst } from "../../domain/dates.js";
import * as dashboardRepository from "./dashboard.repository.js";

export async function getDashboard() {
  const today = todayKst();
  const monthStart = monthStartKst(today);
  const kpi = await dashboardRepository.kpiSnapshot({ today, monthStart });
  const [recent_orders, top_outstanding] = await Promise.all([
    dashboardRepository.recentConfirmed(10),
    dashboardRepository.topOutstanding(10),
  ]);
  return {
    as_of: today,
    month_start: monthStart,
    ...kpi,
    recent_orders,
    top_outstanding,
  };
}

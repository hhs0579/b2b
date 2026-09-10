import { sendData } from "../../utils/http.js";
import * as dashboardService from "./dashboard.service.js";

export async function getDashboard(req, res) {
  sendData(res, await dashboardService.getDashboard());
}

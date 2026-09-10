import { sendData } from "../../utils/http.js";
import * as maintenanceService from "./maintenance.service.js";

export async function purgeUnused(req, res) {
  sendData(res, await maintenanceService.purgeUnusedTestData(req.body));
}

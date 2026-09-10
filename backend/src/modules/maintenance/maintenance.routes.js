import { Router } from "express";
import * as maintenanceController from "./maintenance.controller.js";

const router = Router();
router.post("/purge-unused-test-data", maintenanceController.purgeUnused);
export default router;

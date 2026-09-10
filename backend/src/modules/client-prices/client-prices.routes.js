import { Router } from "express";
import * as clientPricesController from "./client-prices.controller.js";

const router = Router({ mergeParams: true });

router.get("/current", clientPricesController.listCurrent);
router.get("/effective", clientPricesController.listEffective);
router.put("/bulk", clientPricesController.bulk);
router.get("/:priceId/delete-impact", clientPricesController.deleteImpact);
router.delete("/:priceId", clientPricesController.remove);
router.get("/", clientPricesController.listHistory);
router.post("/", clientPricesController.create);

export default router;

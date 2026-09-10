import { Router } from "express";
import * as productsController from "./products.controller.js";

const router = Router();

router.get("/", productsController.list);
router.get("/:id/cost-history", productsController.costHistory);
router.get("/:id/delete-impact", productsController.deleteImpact);
router.get("/:id/options/:optionId/delete-impact", productsController.optionDeleteImpact);
router.get("/:id", productsController.getById);
router.post("/", productsController.create);
router.post("/:id/options", productsController.addOption);
router.patch("/:id", productsController.update);
router.patch("/:id/status", productsController.updateStatus);
router.patch("/:id/options/:optionId", productsController.updateOption);
router.patch("/:id/options/:optionId/status", productsController.updateOptionStatus);
router.delete("/:id/options/:optionId", productsController.removeOption);
router.delete("/:id", productsController.remove);

export default router;

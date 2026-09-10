import { Router } from "express";
import * as suppliersController from "./suppliers.controller.js";

const router = Router();

router.get("/", suppliersController.list);
router.get("/:id/delete-impact", suppliersController.deleteImpact);
router.get("/:id", suppliersController.getById);
router.post("/", suppliersController.create);
router.patch("/:id", suppliersController.update);
router.patch("/:id/status", suppliersController.updateStatus);
router.delete("/:id", suppliersController.remove);

export default router;

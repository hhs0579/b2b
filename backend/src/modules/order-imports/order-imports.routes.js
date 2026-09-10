import { Router } from "express";
import { orderFileUpload } from "../../middleware/order-upload.js";
import * as orderImportsController from "./order-imports.controller.js";

const router = Router();

router.get("/", orderImportsController.list);
router.post("/upload", orderFileUpload, orderImportsController.upload);
router.get("/:id/raw-preview", orderImportsController.rawPreview);
router.patch("/:id/config", orderImportsController.updateConfig);
router.post("/:id/parse", orderImportsController.parse);
router.get("/:id/rows", orderImportsController.listRows);
router.patch("/:id/rows/:rowId/match", orderImportsController.matchRow);
router.patch("/:id/rows/:rowId/quantity", orderImportsController.overrideQuantity);
router.post("/:id/acknowledge-duplicate", orderImportsController.acknowledgeDuplicate);
router.post("/:id/order", orderImportsController.createOrder);
router.get("/:id/delete-impact", orderImportsController.deleteImpact);
router.delete("/:id", orderImportsController.remove);
router.get("/:id", orderImportsController.getById);

export default router;

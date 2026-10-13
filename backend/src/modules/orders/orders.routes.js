import { Router } from "express";
import * as ordersController from "./orders.controller.js";
import * as invoicesController from "../invoices/invoices.controller.js";
import * as settlementsController from "../settlements/settlements.controller.js";

const router = Router();

router.get("/", ordersController.list);
router.get("/:id/delete-impact", ordersController.deleteImpact);
router.post("/:id/cancel", ordersController.cancel);
router.delete("/:id", ordersController.remove);
router.get("/:id/preview", ordersController.preview);
router.patch("/:id/settings", ordersController.updateSettings);
router.patch("/:id/invoice-memo", ordersController.updateInvoiceMemo);
router.patch("/:id/invoice-supplier", ordersController.updateInvoiceSupplier);
router.post("/:id/confirm", ordersController.confirm);
router.get("/:id", ordersController.detail);
router.patch("/:id/settlement", settlementsController.update);
router.post("/:id/payments", settlementsController.addPayment);
router.patch("/:id/payments/:paymentId", settlementsController.updatePayment);
router.delete("/:id/payments/:paymentId", settlementsController.removePayment);
router.post("/:id/invoices", invoicesController.create);
router.get("/:id/invoices", invoicesController.list);
router.get("/:id/invoices/:documentId/download", invoicesController.download);

export default router;

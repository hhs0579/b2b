import { Router } from "express";
import * as invoiceSuppliersController from "./invoice-suppliers.controller.js";

const router = Router();

router.get("/", invoiceSuppliersController.list);
router.get("/:id", invoiceSuppliersController.getById);

export default router;

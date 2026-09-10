import { Router } from "express";
import * as salesClientsController from "./sales-clients.controller.js";
import * as clientPricesController from "../client-prices/client-prices.controller.js";
import * as excelMappingsController from "../excel-mappings/excel-mappings.controller.js";
import * as productAliasesController from "../product-aliases/product-aliases.controller.js";
import clientPricesRoutes from "../client-prices/client-prices.routes.js";

const router = Router();

router.get("/", salesClientsController.list);
router.post("/", salesClientsController.create);
router.get("/:id/excel-mapping", excelMappingsController.getMapping);
router.put("/:id/excel-mapping", excelMappingsController.saveMapping);
router.get("/:id/aliases", productAliasesController.list);
router.post("/:id/aliases", productAliasesController.create);
router.patch("/:id/aliases/:aliasId", productAliasesController.update);
router.delete("/:id/aliases/:aliasId", productAliasesController.remove);
router.get("/:clientId/products", clientPricesController.listProducts);
router.use("/:clientId/prices", clientPricesRoutes);
router.patch("/:id/status", salesClientsController.updateStatus);
router.get("/:id/delete-impact", salesClientsController.deleteImpact);
router.delete("/:id/excel-mapping/:mappingId", excelMappingsController.remove);
router.delete("/:id/excel-mapping", excelMappingsController.remove);
router.get("/:id", salesClientsController.getById);
router.patch("/:id", salesClientsController.update);
router.delete("/:id", salesClientsController.remove);

export default router;

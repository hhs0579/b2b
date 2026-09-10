import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import healthRoutes from "./routes/health.routes.js";
import suppliersRoutes from "./modules/suppliers/suppliers.routes.js";
import productsRoutes from "./modules/products/products.routes.js";
import salesClientsRoutes from "./modules/sales-clients/sales-clients.routes.js";
import orderImportsRoutes from "./modules/order-imports/order-imports.routes.js";
import ordersRoutes from "./modules/orders/orders.routes.js";
import dashboardRoutes from "./modules/dashboard/dashboard.routes.js";
import maintenanceRoutes from "./modules/maintenance/maintenance.routes.js";
import { notFound } from "./middleware/not-found.js";
import { errorHandler } from "./middleware/error-handler.js";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      exposedHeaders: ["Content-Disposition"],
    }),
  );
  app.use(express.json());
  app.use("/api", healthRoutes);
  app.use("/api/suppliers", suppliersRoutes);
  app.use("/api/products", productsRoutes);
  app.use("/api/sales-clients", salesClientsRoutes);
  app.use("/api/order-imports", orderImportsRoutes);
  app.use("/api/orders", ordersRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/maintenance", maintenanceRoutes);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

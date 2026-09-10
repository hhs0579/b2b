import { createRouter, createWebHistory } from "vue-router";
import DashboardPage from "../pages/DashboardPage.vue";
import SystemStatusPage from "../pages/SystemStatusPage.vue";
import SuppliersPage from "../pages/SuppliersPage.vue";
import ProductsPage from "../pages/ProductsPage.vue";
import SalesClientsPage from "../pages/SalesClientsPage.vue";
import SalesClientDetailPage from "../pages/SalesClientDetailPage.vue";
import ClientPricesPage from "../pages/ClientPricesPage.vue";
import ClientAliasesPage from "../pages/ClientAliasesPage.vue";
import OrderImportsPage from "../pages/OrderImportsPage.vue";
import OrderImportNewPage from "../pages/OrderImportNewPage.vue";
import OrderImportDetailPage from "../pages/OrderImportDetailPage.vue";
import OrderPreviewPage from "../pages/OrderPreviewPage.vue";
import OrdersLedgerPage from "../pages/OrdersLedgerPage.vue";
import OrderDetailPage from "../pages/OrderDetailPage.vue";
import SettlementsPage from "../pages/SettlementsPage.vue";
import ReceivablesPage from "../pages/ReceivablesPage.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "dashboard", component: DashboardPage },
    { path: "/suppliers", name: "suppliers", component: SuppliersPage },
    { path: "/products", name: "products", component: ProductsPage },
    { path: "/sales-clients", name: "sales-clients", component: SalesClientsPage },
    { path: "/sales-clients/:id/prices", name: "client-prices", component: ClientPricesPage },
    { path: "/sales-clients/:id/aliases", name: "client-aliases", component: ClientAliasesPage },
    { path: "/sales-clients/:id", name: "sales-client-detail", component: SalesClientDetailPage },
    { path: "/order-imports", name: "order-imports", component: OrderImportsPage },
    { path: "/order-imports/new", name: "order-import-new", component: OrderImportNewPage },
    { path: "/order-imports/:id", name: "order-import-detail", component: OrderImportDetailPage },
    { path: "/orders", name: "orders", component: OrdersLedgerPage },
    { path: "/orders/:id/preview", name: "order-preview", component: OrderPreviewPage },
    { path: "/orders/:id", name: "order-detail", component: OrderDetailPage },
    { path: "/settlements", name: "settlements", component: SettlementsPage },
    { path: "/receivables", name: "receivables", component: ReceivablesPage },
    { path: "/system", name: "system", component: SystemStatusPage },
  ],
});

export default router;

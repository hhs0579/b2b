import { requiredText } from "../../utils/validation.js";
import { AppError } from "../../utils/app-error.js";
import { pool } from "../../db/pool.js";
import { productImpact, salesClientImpact, supplierImpact } from "../deletions/impact.repository.js";
import * as productsService from "../products/products.service.js";
import * as suppliersService from "../suppliers/suppliers.service.js";
import * as salesClientsService from "../sales-clients/sales-clients.service.js";

export async function purgeUnusedTestData(body) {
  const prefix = requiredText(body.prefix, "PREFIX_REQUIRED", "정리할 테스트 prefix가 필요합니다.");
  if (prefix.length < 3) {
    throw new AppError("PREFIX_TOO_SHORT", "테스트 prefix는 3자 이상이어야 합니다.", 400);
  }

  const deleted = { products: [], suppliers: [], sales_clients: [] };
  const { rows: products } = await pool.query(
    `
      SELECT DISTINCT p.id
      FROM products p
      INNER JOIN product_options o ON o.product_id = p.id
      WHERE o.product_code LIKE $1
      ORDER BY p.id DESC
    `,
    [`${prefix}%`],
  );
  for (const row of products) {
    const impact = await productImpact(row.id);
    if (impact.can_delete) {
      await productsService.deleteProduct(row.id);
      deleted.products.push(Number(row.id));
    }
  }

  const { rows: suppliers } = await pool.query(
    `SELECT id FROM suppliers WHERE supplier_code LIKE $1 ORDER BY id DESC`,
    [`${prefix}%`],
  );
  for (const row of suppliers) {
    const impact = await supplierImpact(row.id);
    if (impact.can_delete) {
      await suppliersService.deleteSupplier(row.id);
      deleted.suppliers.push(Number(row.id));
    }
  }

  const { rows: clients } = await pool.query(
    `SELECT id FROM sales_clients WHERE client_code LIKE $1 ORDER BY id DESC`,
    [`${prefix}%`],
  );
  for (const row of clients) {
    const impact = await salesClientImpact(row.id);
    if (impact.can_delete) {
      await salesClientsService.deleteSalesClient(row.id);
      deleted.sales_clients.push(Number(row.id));
    }
  }

  return { prefix, deleted };
}

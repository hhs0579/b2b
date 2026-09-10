import { pool } from "../../db/pool.js";

export async function insertAuditLog({ entity_type, entity_id, action, before_data }, db = pool) {
  const { rows } = await db.query(
    `
      INSERT INTO audit_logs (entity_type, entity_id, action, before_data)
      VALUES ($1, $2, $3, $4::jsonb)
      RETURNING id, entity_type, entity_id, action, before_data, created_at
    `,
    [entity_type, entity_id, action, before_data == null ? null : JSON.stringify(before_data)],
  );
  return rows[0];
}

export async function listAuditLogs({ entityType, entityId, limit = 50 }, db = pool) {
  const params = [];
  const where = [];
  if (entityType) {
    params.push(entityType);
    where.push(`entity_type = $${params.length}`);
  }
  if (entityId != null) {
    params.push(entityId);
    where.push(`entity_id = $${params.length}`);
  }
  params.push(limit);
  const { rows } = await db.query(
    `
      SELECT id, entity_type, entity_id, action, before_data, created_at
      FROM audit_logs
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY id DESC
      LIMIT $${params.length}
    `,
    params,
  );
  return rows;
}

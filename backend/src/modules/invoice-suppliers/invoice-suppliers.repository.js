import { pool } from "../../db/pool.js";
import { toPublicId } from "../../utils/validation.js";

export function mapProfile(row) {
  if (!row) {
    return null;
  }
  return {
    id: toPublicId(row.id),
    supplier_code: row.supplier_code,
    supplier_name: row.supplier_name,
    business_registration_number: row.business_registration_number,
    representative_name: row.representative_name,
    business_address: row.business_address,
    business_type: row.business_type,
    business_item: row.business_item,
    phone: row.phone,
    fax: row.fax,
    email: row.email,
    bank_name: row.bank_name,
    bank_account: row.bank_account,
    bank_account_holder: row.bank_account_holder,
    stamp_image_path: row.stamp_image_path,
    template_code: row.template_code,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function profileSnapshot(profile) {
  return {
    supplier_code: profile.supplier_code,
    supplier_name: profile.supplier_name,
    business_registration_number: profile.business_registration_number,
    representative_name: profile.representative_name,
    address: profile.business_address,
    business_type: profile.business_type,
    business_item: profile.business_item,
    phone: profile.phone,
    fax: profile.fax,
    email: profile.email,
    bank_name: profile.bank_name,
    bank_account: profile.bank_account,
    bank_account_holder: profile.bank_account_holder,
    stamp_image_path: profile.stamp_image_path,
    template_code: profile.template_code,
  };
}

export async function listProfiles({ activeOnly = false } = {}, db = pool) {
  const { rows } = await db.query(
    `
      SELECT *
      FROM invoice_supplier_profiles
      WHERE ($1::boolean IS FALSE OR is_active = TRUE)
      ORDER BY id ASC
    `,
    [activeOnly],
  );
  return rows.map(mapProfile);
}

export async function getById(id, db = pool) {
  const { rows } = await db.query(`SELECT * FROM invoice_supplier_profiles WHERE id = $1`, [id]);
  return mapProfile(rows[0]);
}

export async function getByCode(code, db = pool) {
  const { rows } = await db.query(`SELECT * FROM invoice_supplier_profiles WHERE supplier_code = $1`, [code]);
  return mapProfile(rows[0]);
}

export async function updateProfile(id, patch, db = pool) {
  const { rows } = await db.query(
    `
      UPDATE invoice_supplier_profiles
      SET
        supplier_name = COALESCE($2, supplier_name),
        business_registration_number = COALESCE($3, business_registration_number),
        representative_name = COALESCE($4, representative_name),
        business_address = COALESCE($5, business_address),
        business_type = COALESCE($6, business_type),
        business_item = COALESCE($7, business_item),
        phone = COALESCE($8, phone),
        fax = COALESCE($9, fax),
        email = COALESCE($10, email),
        bank_name = COALESCE($11, bank_name),
        bank_account = COALESCE($12, bank_account),
        bank_account_holder = COALESCE($13, bank_account_holder),
        is_active = COALESCE($14, is_active),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      id,
      patch.supplier_name,
      patch.business_registration_number,
      patch.representative_name,
      patch.business_address,
      patch.business_type,
      patch.business_item,
      patch.phone,
      patch.fax,
      patch.email,
      patch.bank_name,
      patch.bank_account,
      patch.bank_account_holder,
      patch.is_active,
    ],
  );
  return mapProfile(rows[0]);
}

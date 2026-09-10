import { AppError } from "./app-error.js";

export function rethrowDatabaseError(err) {
  if (err instanceof AppError) {
    throw err;
  }

  if (err.code === "23505") {
    if (err.constraint === "suppliers_supplier_code_key") {
      throw new AppError("SUPPLIER_CODE_DUPLICATED", "이미 사용 중인 매입처코드입니다.", 409);
    }
    if (
      err.constraint === "products_product_code_key" ||
      err.constraint === "products_product_code_unique" ||
      err.constraint === "product_options_product_code_unique"
    ) {
      throw new AppError("PRODUCT_CODE_DUPLICATED", "이미 사용 중인 상품코드입니다.", 409);
    }
    if (
      err.constraint === "products_barcode_unique" ||
      err.constraint === "product_options_barcode_unique"
    ) {
      throw new AppError("PRODUCT_BARCODE_DUPLICATED", "이미 사용 중인 바코드입니다.", 409);
    }
    if (
      err.constraint === "product_options_named_unique" ||
      err.constraint === "product_options_default_unique"
    ) {
      throw new AppError("PRODUCT_OPTION_DUPLICATED", "같은 상품에 동일한 옵션이 이미 있습니다.", 409);
    }
    if (err.constraint === "sales_clients_client_code_key") {
      throw new AppError("CLIENT_CODE_DUPLICATED", "이미 사용 중인 매출처코드입니다.", 409);
    }
    if (err.constraint === "product_aliases_normalized_key") {
      throw new AppError("ALIAS_DUPLICATED", "같은 외부상품 별칭이 이미 있습니다.", 409);
    }
    throw new AppError("DUPLICATE_VALUE", "이미 사용 중인 값입니다.", 409);
  }

  if (err.code === "23P01" || err.constraint === "client_product_prices_no_overlap") {
    throw new AppError("PRICE_PERIOD_OVERLAP", "같은 매출처·상품의 가격 적용기간이 겹칩니다.", 409);
  }

  if (err.code === "23503") {
    if (err.constraint === "products_supplier_id_fkey") {
      throw new AppError("SUPPLIER_NOT_FOUND", "존재하지 않는 매입처입니다.", 400);
    }
    if (err.constraint === "client_product_prices_client_id_fkey") {
      throw new AppError("CLIENT_NOT_FOUND", "존재하지 않는 매출처입니다.", 400);
    }
    if (
      err.constraint === "client_product_prices_product_id_fkey" ||
      err.constraint === "client_product_prices_product_option_id_fkey"
    ) {
      throw new AppError("PRODUCT_NOT_FOUND", "존재하지 않는 상품입니다.", 400);
    }
    if (err.constraint === "excel_mappings_client_id_fkey") {
      throw new AppError("CLIENT_NOT_FOUND", "존재하지 않는 매출처입니다.", 400);
    }
    if (err.constraint === "product_aliases_client_id_fkey") {
      throw new AppError("CLIENT_NOT_FOUND", "존재하지 않는 매출처입니다.", 400);
    }
    if (
      err.constraint === "product_aliases_product_id_fkey" ||
      err.constraint === "product_aliases_product_option_id_fkey"
    ) {
      throw new AppError("PRODUCT_NOT_FOUND", "존재하지 않는 상품입니다.", 400);
    }
    if (err.constraint === "order_imports_client_id_fkey") {
      throw new AppError("CLIENT_NOT_FOUND", "존재하지 않는 매출처입니다.", 400);
    }
    if (
      err.constraint === "order_import_rows_product_id_fkey" ||
      err.constraint === "order_import_rows_product_option_id_fkey"
    ) {
      throw new AppError("PRODUCT_NOT_FOUND", "존재하지 않는 상품입니다.", 400);
    }
    throw new AppError("RELATED_RECORD_NOT_FOUND", "연결된 데이터를 찾을 수 없습니다.", 400);
  }

  throw err;
}

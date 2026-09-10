export const VAT_LABELS = {
  INCLUDED: "포함",
  EXCLUDED: "별도",
  ZERO: "영세/면세",
};

export const SHIPPING_LABELS = {
  PARCEL: "택배",
  FREE: "무료배송",
  COLLECT: "착불",
  TRUCK: "용차",
  MANUAL: "수동배송비",
};

export const SHIPPING_CALC_LABELS = {
  TOTAL_QUANTITY: "총수량",
  PER_ORDER: "주문번호별",
  PER_ADDRESS: "배송지별",
};

export const SETTLEMENT_LABELS = {
  PREPAID: "선입금",
  POSTPAID: "후정산",
  OTHER: "기타",
};

export const IMPORT_STATUS_LABELS = {
  UPLOADED: "업로드",
  MAPPING_REQUIRED: "매핑 필요",
  PARSED: "분석됨",
  READY: "준비 완료",
  ERROR: "오류",
};

export const MATCH_STATUS_LABELS = {
  MATCHED_ALIAS: "별칭 매칭",
  MATCHED_PRODUCT_CODE: "상품코드 매칭",
  MATCHED_BARCODE: "바코드 매칭",
  MATCHED_EXACT: "상품명 일치",
  UNMATCHED: "미매칭",
  MANUAL: "수동 연결",
  MATCHED_BUT_INACTIVE: "비활성 상품",
};

export const ORDER_STATUS_LABELS = {
  DRAFT: "초안",
  CONFIRMED: "확정",
  CANCELLED: "취소",
};

export const PAYMENT_STATUS_LABELS = {
  UNPAID: "미입금",
  PARTIAL: "부분입금",
  PAID: "완납",
};

export const TAX_INVOICE_LABELS = {
  NOT_ISSUED: "미발행",
  ISSUED: "발행",
};

export const MAPPING_FIELD_LABELS = [
  { key: "external_product_name", label: "상품명 *", required: true },
  { key: "external_product_code", label: "상품코드", required: false },
  { key: "external_option_name", label: "옵션", required: false },
  { key: "quantity", label: "수량 *", required: true },
  { key: "external_order_number", label: "주문번호", required: false },
  { key: "recipient_name", label: "수취인", required: false },
  { key: "phone", label: "연락처", required: false },
  { key: "address", label: "주소", required: false },
  { key: "shipping_memo", label: "배송메모", required: false },
];


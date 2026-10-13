import fs from "node:fs";
import XLSX from "xlsx";
import { AppError } from "../../utils/app-error.js";
import { optionalDate, optionalText, parseId } from "../../utils/validation.js";
import { excelSerialFromIsoDate, parseIsoDateParts } from "../../domain/dates.js";
import { projectInvoiceLines } from "../../domain/invoice-projection.js";
import {
  hydrateSnapshotGroups,
  parseShippingConfig,
  summarizeShipping,
} from "../../domain/shipping-config.js";
import {
  buildInvoiceMemoView,
  formatInvoiceNoteText,
  invoiceMemoSnapshot,
  resolvedInvoiceMemo,
} from "../../domain/invoice-note.js";
import * as salesClientsRepository from "../sales-clients/sales-clients.repository.js";
import { inspectInvoiceWorkbook, sha256 } from "../../domain/invoice-openxml.js";
import { buildInvoiceFillPlan, patchInvoiceWorkbook } from "../../domain/invoice-openxml-patch.js";
import { invoiceDownloadFileName, verifyGeneratedInvoice } from "../../domain/invoice-generate.js";
import { inspectGeneratedWithLibreOffice } from "../../domain/invoice-libreoffice.js";
import {
  readTemplateManifest,
  readTemplateMasterBytes,
} from "../../domain/invoice-master.js";
import { getInvoiceTemplate } from "../../domain/invoice-template-registry.js";
import * as ordersRepository from "../orders/orders.repository.js";
import * as invoicesRepository from "./invoices.repository.js";
import * as invoiceSuppliersRepository from "../invoice-suppliers/invoice-suppliers.repository.js";
import { requireActiveProfile } from "../invoice-suppliers/invoice-suppliers.service.js";
import {
  contentDisposition,
  deleteInvoiceOutput,
  isolateInvalidInvoice,
  newInvoiceStoredName,
  readInvoiceOutput,
  writeInvoiceOutput,
} from "../../utils/invoice-files.js";

export function assertMasterReady(options = {}) {
  const template = options.template || getInvoiceTemplate("ESSER");
  if (options.masterPath && !options.masterBytes && !fs.existsSync(options.masterPath)) {
    throw new AppError(
      "INVOICE_MASTER_NOT_FOUND",
      `${template.displayName} 거래명세서 MASTER 파일이 없습니다.`,
      500,
    );
  }
  const bytes = Buffer.from(
    options.masterBytes ||
      (options.masterPath ? fs.readFileSync(options.masterPath) : readTemplateMasterBytes(template)),
  );
  const actual = sha256(bytes);
  const expected = options.expectedTemplateHash || readTemplateManifest(template)?.sha256;
  if (!expected || actual !== expected) {
    throw new AppError(
      "INVOICE_MASTER_INTEGRITY_FAILED",
      `${template.displayName} 거래명세서 MASTER checksum이 기록값과 다릅니다. MASTER는 자동 수정하지 않습니다.`,
      500,
      { expectedSha256: expected || null, actualSha256: actual, templateCode: template.code },
    );
  }
  return { bytes, hash: actual, path: options.masterPath || null, template };
}

export function reopenGeneratedWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellFormula: true, raw: true });
  if (!workbook.SheetNames.includes("2021-12-28")) {
    throw new AppError("INVOICE_INTEGRITY_FAILED", "생성 파일을 다시 열 수 없거나 Sheet가 없습니다.", 500);
  }
  return workbook;
}

function invoiceClientName(order) {
  const name = String(order.client_name_snapshot || "").trim();
  if (!name) {
    throw new AppError(
      "CLIENT_NAME_SNAPSHOT_MISSING",
      "확정 거래의 매출처명 snapshot이 없습니다. 현재 매출처명을 사용하지 않습니다.",
      500,
    );
  }
  return name;
}

function projectionFromSnapshot(order, items, groups) {
  const shippingGroups = hydrateSnapshotGroups(groups, order.shipping_type);
  const settings = {
    shipping_type: order.shipping_type,
    manual_shipping_charge: order.manual_shipping_charge,
    shipping_config: parseShippingConfig(order.shipping_config),
  };
  const summary = summarizeShipping(shippingGroups, settings);
  return projectInvoiceLines({
    shippingType: order.shipping_type,
    manualCharge: order.manual_shipping_charge,
    items,
    shippingGroups,
    truckGroups: settings.shipping_config.truck_groups,
    truckCharge: summary.truck_shipping_charge,
    manualChargeTotal: summary.manual_shipping_charge,
  });
}

function resolveSupplierProfileId(body = {}, order = {}) {
  const raw = body.supplier_profile_id ?? body.supplierProfileId ?? order.invoice_supplier_profile_id;
  if (raw == null || raw === "") {
    throw new AppError("INVOICE_SUPPLIER_REQUIRED", "거래명세서 공급자를 선택해주세요.", 400);
  }
  return parseId(raw, "INVOICE_SUPPLIER_REQUIRED");
}

export async function generateInvoice(orderIdParam, body = {}, options = {}) {
  const request = { ...body, ...options };
  const orderId = parseId(orderIdParam);
  const order = await ordersRepository.getOrderById(orderId);
  if (!order) {
    throw new AppError("ORDER_NOT_FOUND", "거래를 찾을 수 없습니다.", 404);
  }
  if (order.status !== "CONFIRMED") {
    throw new AppError("ORDER_NOT_CONFIRMED", "확정된 거래만 거래명세서를 생성할 수 있습니다.", 400);
  }

  const profile = await requireActiveProfile(resolveSupplierProfileId(request, order));
  const template = getInvoiceTemplate(profile.template_code);
  if (order.invoice_supplier_profile_id !== profile.id) {
    await ordersRepository.updateInvoiceSupplier(order.id, profile.id);
  }
  const memoFields = {
    shipping_method: optionalText(request.shippingMethod ?? request.shipping_method ?? request.invoice_shipping_method),
    ship_date: optionalDate(
      request.shipDate ?? request.ship_date ?? request.invoice_ship_date,
      "INVALID_INVOICE_SHIP_DATE",
      "출고일 형식이 YYYY-MM-DD 이어야 합니다.",
    ),
    destination: optionalText(request.destination ?? request.invoice_destination),
    manager: optionalText(request.manager ?? request.invoice_manager),
  };
  if (memoFields.shipping_method || memoFields.ship_date || memoFields.destination || memoFields.manager) {
    const current = resolvedInvoiceMemo(order);
    const memo = {
      shipping_method: memoFields.shipping_method ?? current.shipping_method,
      ship_date: memoFields.ship_date ?? current.ship_date,
      destination: memoFields.destination ?? current.destination,
      manager: memoFields.manager ?? current.manager,
    };
    await ordersRepository.updateInvoiceMemo(order.id, {
      invoice_shipping_method: memo.shipping_method,
      invoice_ship_date: memo.ship_date,
      invoice_destination: memo.destination,
      invoice_manager: memo.manager,
      invoice_note: formatInvoiceNoteText(memo),
    });
    Object.assign(order, {
      invoice_shipping_method: memo.shipping_method,
      invoice_ship_date: memo.ship_date,
      invoice_destination: memo.destination,
      invoice_manager: memo.manager,
    });
  }

  const items = await ordersRepository.listOrderItems(orderId);
  const groups = await ordersRepository.listShippingGroups(orderId);
  const projection = projectionFromSnapshot(order, items, groups);
  const memo = resolvedInvoiceMemo(order);
  const note = formatInvoiceNoteText(memo);
  const metadataSnapshot = invoiceMemoSnapshot(memo);

  const master = assertMasterReady({ ...request, template });
  const masterInspect = await inspectInvoiceWorkbook(master.bytes, {
    stampMediaPart: template.stampMediaPart,
    frozenParts: template.frozenParts,
  });
  const fillPlan = buildInvoiceFillPlan({
    orderDateParts: parseIsoDateParts(order.order_date),
    dateSerial: excelSerialFromIsoDate(order.order_date),
    clientName: invoiceClientName(order),
    note,
    lines: projection.invoice_lines,
  });

  let generatedBytes;
  try {
    generatedBytes = await patchInvoiceWorkbook(master.bytes, fillPlan, masterInspect.sharedStrings);
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError("INVOICE_XML_INVALID", "거래명세서 XML 생성에 실패했습니다.", 500, {
      cause: err.message,
    });
  }

  const verification = await verifyGeneratedInvoice(master.bytes, generatedBytes, fillPlan, template);
  const storedFileName = newInvoiceStoredName();

  if (!verification.ok) {
    await isolateInvalidInvoice(storedFileName, generatedBytes);
    throw new AppError(
      "INVOICE_INTEGRITY_FAILED",
      "생성 파일 무결성 검사에 실패하여 제공하지 않습니다.",
      500,
      { errors: verification.errors },
    );
  }

  try {
    reopenGeneratedWorkbook(generatedBytes);
  } catch (err) {
    await isolateInvalidInvoice(storedFileName, generatedBytes);
    throw new AppError("INVOICE_INTEGRITY_FAILED", "생성 파일을 다시 열 수 없습니다.", 500, {
      cause: err.message,
    });
  }

  const libreOffice = inspectGeneratedWithLibreOffice(generatedBytes);
  if (libreOffice.ran && !libreOffice.ok) {
    await isolateInvalidInvoice(storedFileName, generatedBytes);
    throw new AppError("INVOICE_XML_INVALID", "생성 파일을 스프레드시트 프로그램으로 열 수 없습니다.", 500, {
      detail: libreOffice.detail,
    });
  }

  const version = await invoicesRepository.nextVersion(orderId);
  const originalFileName = invoiceDownloadFileName(
    order.order_date,
    invoiceClientName(order),
    version,
    profile.supplier_name,
  );
  await writeInvoiceOutput(storedFileName, generatedBytes);
  try {
    const document = await invoicesRepository.insertGenerated({
      order_id: orderId,
      version,
      original_file_name: originalFileName,
      stored_file_name: storedFileName,
      file_hash: verification.fileSha256,
      file_size: generatedBytes.length,
      template_hash: master.hash,
      invoice_metadata_snapshot: metadataSnapshot,
      supplier_profile_id: profile.id,
      supplier_code_snapshot: profile.supplier_code,
      supplier_name_snapshot: profile.supplier_name,
      supplier_profile_snapshot: invoiceSuppliersRepository.profileSnapshot(profile),
      template_code: template.code,
      stamp_hash: template.stampSha256,
    });
    return {
      document,
      projection,
      invoice_note: note,
      invoice_metadata_snapshot: metadataSnapshot,
      invoice_memo_warnings: buildInvoiceMemoView(order, { items }).invoice_memo_warnings,
      diffs: verification.diffs,
    };
  } catch (err) {
    await deleteInvoiceOutput(storedFileName);
    throw err;
  }
}

export async function listInvoices(orderIdParam) {
  const orderId = parseId(orderIdParam);
  const order = await ordersRepository.getOrderById(orderId);
  if (!order) {
    throw new AppError("ORDER_NOT_FOUND", "거래를 찾을 수 없습니다.", 404);
  }
  const items = await ordersRepository.listOrderItems(orderId);
  const groups = await ordersRepository.listShippingGroups(orderId);
  const client = await salesClientsRepository.getSalesClientById(order.client_id);
  const useSnapshot = order.status === "CONFIRMED" || order.status === "CANCELLED";
  const projection = useSnapshot ? projectionFromSnapshot(order, items, groups) : null;
  const documents = await invoicesRepository.listByOrderId(orderId);
  return {
    order: {
      id: order.id,
      status: order.status,
      client_name: useSnapshot ? invoiceClientName(order) : order.client_name || null,
      client_name_snapshot: order.client_name_snapshot,
      order_date: order.order_date,
      shipping_type: order.shipping_type,
      invoice_supplier_profile_id: order.invoice_supplier_profile_id,
    },
    projection,
    documents,
    ...buildInvoiceMemoView(order, { items, client, shippingGroups: hydrateSnapshotGroups(groups, order.shipping_type) }),
  };
}

export async function downloadInvoice(orderIdParam, documentIdParam) {
  const orderId = parseId(orderIdParam);
  const documentId = parseId(documentIdParam);
  const order = await ordersRepository.getOrderById(orderId);
  if (!order) {
    throw new AppError("ORDER_NOT_FOUND", "거래를 찾을 수 없습니다.", 404);
  }
  const document = await invoicesRepository.getById(documentId);
  if (!document || document.order_id !== orderId || document.status !== "GENERATED") {
    throw new AppError("INVOICE_NOT_FOUND", "거래명세서를 찾을 수 없습니다.", 404);
  }
  const bytes = await readInvoiceOutput(document.stored_file_name);
  if (sha256(bytes) !== document.file_hash) {
    throw new AppError("INVOICE_INTEGRITY_FAILED", "저장된 거래명세서 checksum이 기록과 다릅니다.", 500);
  }
  const clientName = String(order.client_name_snapshot || order.client_name || "").trim() || "매출처";
  const filename = invoiceDownloadFileName(
    order.order_date,
    clientName,
    document.version,
    document.supplier_name_snapshot,
  );
  return {
    bytes,
    filename,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": contentDisposition(filename),
    },
  };
}

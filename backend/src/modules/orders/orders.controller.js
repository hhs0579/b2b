import { sendData } from "../../utils/http.js";
import * as ordersService from "./orders.service.js";

export async function list(req, res) {
  sendData(res, await ordersService.listLedger(req.query));
}

export async function detail(req, res) {
  sendData(res, await ordersService.getLedgerDetail(req.params.id));
}

export async function preview(req, res) {
  sendData(res, await ordersService.getPreview(req.params.id));
}

export async function updateSettings(req, res) {
  sendData(res, await ordersService.updateSettings(req.params.id, req.body));
}

export async function updateInvoiceSupplier(req, res) {
  sendData(res, await ordersService.updateInvoiceSupplier(req.params.id, req.body || {}));
}

export async function updateInvoiceMemo(req, res) {
  sendData(res, await ordersService.updateInvoiceMemo(req.params.id, req.body));
}

export async function confirm(req, res) {
  sendData(res, await ordersService.confirmOrder(req.params.id, req.body));
}

export async function deleteImpact(req, res) {
  sendData(res, await ordersService.getDeleteImpact(req.params.id));
}

export async function remove(req, res) {
  sendData(res, await ordersService.deleteDraftOrder(req.params.id, req.query));
}

export async function cancel(req, res) {
  sendData(res, await ordersService.cancelOrder(req.params.id));
}

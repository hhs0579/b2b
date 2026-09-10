import { sendData } from "../../utils/http.js";
import * as orderImportsService from "./order-imports.service.js";
import * as ordersService from "../orders/orders.service.js";

export async function list(req, res) {
  sendData(res, await orderImportsService.listImports(req.query));
}

export async function getById(req, res) {
  sendData(res, await orderImportsService.getImport(req.params.id));
}

export async function upload(req, res) {
  sendData(res, await orderImportsService.uploadImport({ file: req.file, body: req.body }), 201);
}

export async function rawPreview(req, res) {
  sendData(res, await orderImportsService.rawPreview(req.params.id, req.query));
}

export async function updateConfig(req, res) {
  sendData(res, await orderImportsService.updateConfig(req.params.id, req.body));
}

export async function parse(req, res) {
  sendData(res, await orderImportsService.parseImport(req.params.id));
}

export async function listRows(req, res) {
  sendData(res, await orderImportsService.listRows(req.params.id));
}

export async function matchRow(req, res) {
  sendData(res, await orderImportsService.matchRow(req.params.id, req.params.rowId, req.body));
}

export async function overrideQuantity(req, res) {
  sendData(res, await orderImportsService.overrideRowQuantity(req.params.id, req.params.rowId, req.body));
}

export async function acknowledgeDuplicate(req, res) {
  sendData(res, await orderImportsService.acknowledgeDuplicate(req.params.id));
}

export async function createOrder(req, res) {
  sendData(res, await ordersService.createDraftFromImport(req.params.id), 201);
}

export async function deleteImpact(req, res) {
  sendData(res, await orderImportsService.getDeleteImpact(req.params.id));
}

export async function remove(req, res) {
  sendData(res, await orderImportsService.deleteImport(req.params.id, req.query));
}

import { sendData } from "../../utils/http.js";
import * as invoicesService from "./invoices.service.js";

export async function create(req, res) {
  sendData(res, await invoicesService.generateInvoice(req.params.id, req.body || {}), 201);
}

export async function list(req, res) {
  sendData(res, await invoicesService.listInvoices(req.params.id));
}

export async function download(req, res) {
  const file = await invoicesService.downloadInvoice(req.params.id, req.params.documentId);
  res.set(file.headers);
  res.status(200).send(file.bytes);
}

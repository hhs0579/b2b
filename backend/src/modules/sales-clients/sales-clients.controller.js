import { sendData } from "../../utils/http.js";
import * as salesClientsService from "./sales-clients.service.js";
import * as clientPricesService from "../client-prices/client-prices.service.js";

export async function list(req, res) {
  sendData(res, await salesClientsService.listSalesClients(req.query));
}

export async function getById(req, res) {
  sendData(res, await clientPricesService.getClientDetail(req.params.id));
}

export async function create(req, res) {
  sendData(res, await salesClientsService.createSalesClient(req.body), 201);
}

export async function update(req, res) {
  sendData(res, await salesClientsService.updateSalesClient(req.params.id, req.body));
}

export async function updateStatus(req, res) {
  sendData(res, await salesClientsService.updateSalesClientStatus(req.params.id, req.body));
}

export async function deleteImpact(req, res) {
  sendData(res, await salesClientsService.getDeleteImpact(req.params.id));
}

export async function remove(req, res) {
  sendData(res, await salesClientsService.deleteSalesClient(req.params.id));
}

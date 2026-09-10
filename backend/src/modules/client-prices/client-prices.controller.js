import { sendData } from "../../utils/http.js";
import * as clientPricesService from "./client-prices.service.js";

export async function listHistory(req, res) {
  sendData(res, await clientPricesService.listHistory(req.params.clientId));
}

export async function listCurrent(req, res) {
  sendData(res, await clientPricesService.listEffective(req.params.clientId, {}));
}

export async function listEffective(req, res) {
  sendData(res, await clientPricesService.listEffective(req.params.clientId, req.query));
}

export async function listProducts(req, res) {
  sendData(res, await clientPricesService.listClientProducts(req.params.clientId, req.query));
}

export async function create(req, res) {
  sendData(res, await clientPricesService.createPrice(req.params.clientId, req.body), 201);
}

export async function bulk(req, res) {
  sendData(res, await clientPricesService.bulkSavePrices(req.params.clientId, req.body));
}

export async function deleteImpact(req, res) {
  sendData(res, await clientPricesService.getPriceDeleteImpact(req.params.clientId, req.params.priceId));
}

export async function remove(req, res) {
  sendData(res, await clientPricesService.deletePrice(req.params.clientId, req.params.priceId));
}

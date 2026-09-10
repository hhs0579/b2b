import { sendData } from "../../utils/http.js";
import * as settlementsService from "./settlements.service.js";

export async function update(req, res) {
  sendData(res, await settlementsService.updateSettlement(req.params.id, req.body));
}

export async function addPayment(req, res) {
  sendData(res, await settlementsService.addPayment(req.params.id, req.body), 201);
}

export async function updatePayment(req, res) {
  sendData(res, await settlementsService.updatePayment(req.params.id, req.params.paymentId, req.body));
}

export async function removePayment(req, res) {
  sendData(res, await settlementsService.removePayment(req.params.id, req.params.paymentId));
}

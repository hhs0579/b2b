import { sendData } from "../../utils/http.js";
import * as invoiceSuppliersService from "./invoice-suppliers.service.js";

export async function list(req, res) {
  sendData(res, await invoiceSuppliersService.listProfiles(req.query));
}

export async function getById(req, res) {
  sendData(res, await invoiceSuppliersService.getProfile(req.params.id));
}

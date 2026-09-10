import { sendData } from "../../utils/http.js";
import * as productAliasesService from "./product-aliases.service.js";

export async function list(req, res) {
  sendData(res, await productAliasesService.listAliases(req.params.id));
}

export async function create(req, res) {
  sendData(res, await productAliasesService.createAlias(req.params.id, req.body), 201);
}

export async function update(req, res) {
  sendData(res, await productAliasesService.updateAlias(req.params.id, req.params.aliasId, req.body));
}

export async function remove(req, res) {
  sendData(res, await productAliasesService.removeAlias(req.params.id, req.params.aliasId));
}

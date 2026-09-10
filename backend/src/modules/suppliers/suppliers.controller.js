import { sendData } from "../../utils/http.js";
import * as suppliersService from "./suppliers.service.js";

export async function list(req, res) {
  const data = await suppliersService.listSuppliers(req.query);
  sendData(res, data);
}

export async function getById(req, res) {
  const data = await suppliersService.getSupplier(req.params.id);
  sendData(res, data);
}

export async function create(req, res) {
  const data = await suppliersService.createSupplier(req.body);
  sendData(res, data, 201);
}

export async function update(req, res) {
  const data = await suppliersService.updateSupplier(req.params.id, req.body);
  sendData(res, data);
}

export async function updateStatus(req, res) {
  const data = await suppliersService.updateSupplierStatus(req.params.id, req.body);
  sendData(res, data);
}

export async function deleteImpact(req, res) {
  sendData(res, await suppliersService.getDeleteImpact(req.params.id));
}

export async function remove(req, res) {
  sendData(res, await suppliersService.deleteSupplier(req.params.id));
}

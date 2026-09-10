import { sendData } from "../../utils/http.js";
import * as productsService from "./products.service.js";

export async function list(req, res) {
  const data = await productsService.listProducts(req.query);
  sendData(res, data);
}

export async function getById(req, res) {
  const data = await productsService.getProduct(req.params.id);
  sendData(res, data);
}

export async function create(req, res) {
  const data = await productsService.createProduct(req.body);
  sendData(res, data, 201);
}

export async function update(req, res) {
  const data = await productsService.updateProduct(req.params.id, req.body);
  sendData(res, data);
}

export async function updateStatus(req, res) {
  const data = await productsService.updateProductStatus(req.params.id, req.body);
  sendData(res, data);
}

export async function costHistory(req, res) {
  const data = await productsService.getCostHistory(req.params.id);
  sendData(res, data);
}

export async function deleteImpact(req, res) {
  sendData(res, await productsService.getDeleteImpact(req.params.id));
}

export async function remove(req, res) {
  sendData(res, await productsService.deleteProduct(req.params.id));
}

export async function addOption(req, res) {
  sendData(res, await productsService.addOption(req.params.id, req.body), 201);
}

export async function updateOption(req, res) {
  sendData(res, await productsService.updateOption(req.params.id, req.params.optionId, req.body));
}

export async function updateOptionStatus(req, res) {
  sendData(res, await productsService.updateOptionStatus(req.params.id, req.params.optionId, req.body));
}

export async function optionDeleteImpact(req, res) {
  sendData(res, await productsService.getOptionDeleteImpact(req.params.id, req.params.optionId));
}

export async function removeOption(req, res) {
  sendData(res, await productsService.deleteOption(req.params.id, req.params.optionId));
}

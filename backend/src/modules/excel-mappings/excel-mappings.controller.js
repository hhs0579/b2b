import { sendData } from "../../utils/http.js";
import * as excelMappingsService from "./excel-mappings.service.js";

export async function getMapping(req, res) {
  sendData(res, await excelMappingsService.getMapping(req.params.id));
}

export async function saveMapping(req, res) {
  sendData(res, await excelMappingsService.saveMapping(req.params.id, req.body));
}

export async function remove(req, res) {
  sendData(res, await excelMappingsService.deleteMapping(req.params.id, req.params.mappingId));
}

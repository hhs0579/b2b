export async function listInvoiceSuppliers(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/invoice-suppliers`);
  const json = await response.json();
  return json?.data?.items || [];
}

export async function invoiceSupplierByCode(port, code) {
  const item = (await listInvoiceSuppliers(port)).find((row) => row.supplier_code === code);
  if (!item) {
    throw new Error(`invoice supplier ${code} not found`);
  }
  return item;
}

export async function esserSupplierId(port) {
  return (await invoiceSupplierByCode(port, "ESSER")).id;
}

export async function esserInvoiceBody(port, extra = {}) {
  return {
    supplier_profile_id: extra.supplier_profile_id ?? (await esserSupplierId(port)),
    ...extra,
  };
}

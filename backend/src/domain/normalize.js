export function normalizeAliasText(value) {
  if (value == null) {
    return "";
  }
  return String(value)
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function isBlankCell(value) {
  if (value == null) {
    return true;
  }
  return String(value).trim() === "";
}

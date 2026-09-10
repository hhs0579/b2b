export function formatProductCode(value) {
  if (value == null || String(value).trim() === "") {
    return "-";
  }
  return String(value);
}

export function formatWon(value) {
  if (value == null || value === "") {
    return "";
  }
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return String(value);
  }
  return number.toLocaleString("ko-KR");
}

export function parseWonInput(raw) {
  if (raw == null) {
    return null;
  }
  const compact = String(raw).replace(/,/g, "").trim();
  if (compact === "") {
    return null;
  }
  if (!/^-?\d+$/.test(compact)) {
    return NaN;
  }
  return Number(compact);
}

export function formatDateTimeKst(value) {
  if (!value) {
    return "";
  }
  return new Date(value).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

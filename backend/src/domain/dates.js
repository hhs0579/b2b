export function todayKst() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

export function monthStartKst(isoDate = todayKst()) {
  return `${String(isoDate).slice(0, 7)}-01`;
}

export function parseIsoDateParts(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || "").slice(0, 10));
  if (!match) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export function excelSerialFromIsoDate(isoDate) {
  const { year, month, day } = parseIsoDateParts(isoDate);
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86400000);
}

export function toIsoDate(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

export function addDaysIso(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function rangesOverlap(fromA, toA, fromB, toB) {
  const endA = toA ?? "9999-12-31";
  const endB = toB ?? "9999-12-31";
  return fromA <= endB && fromB <= endA;
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function candidatePaths() {
  return [
    process.env.LIBREOFFICE_PATH,
    "soffice",
    "libreoffice",
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
  ].filter(Boolean);
}

export function findLibreOffice() {
  for (const candidate of candidatePaths()) {
    if (candidate === "soffice" || candidate === "libreoffice") {
      const probe = spawnSync(candidate, ["--version"], { encoding: "utf8", timeout: 8000 });
      if (probe.status === 0) {
        return candidate;
      }
      continue;
    }
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function inspectGeneratedWithLibreOffice(buffer) {
  const exe = findLibreOffice();
  if (!exe) {
    return { ran: false, ok: true, skipped: true };
  }
  const tmp = path.join(os.tmpdir(), `b2b-invoice-open-${Date.now()}-${process.pid}.xlsx`);
  fs.writeFileSync(tmp, buffer);
  try {
    const result = spawnSync(
      exe,
      ["--headless", "--nologo", "--nolockcheck", "--norestore", "--terminate_after_init", tmp],
      { encoding: "utf8", timeout: 60000 },
    );
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    const repaired = /repaired|repaired records|removed records|XML error|parser error/i.test(output);
    if (result.status !== 0 || repaired) {
      return { ran: true, ok: false, skipped: false, detail: output.slice(0, 1000) };
    }
    return { ran: true, ok: true, skipped: false };
  } finally {
    fs.unlink(tmp, () => {});
  }
}

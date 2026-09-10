function getApiBaseUrl() {
  const base = import.meta.env.VITE_API_BASE_URL;
  if (!base) {
    throw new Error("VITE_API_BASE_URL is not set.");
  }
  return base.replace(/\/$/, "");
}

export async function getHealth() {
  const url = `${getApiBaseUrl()}/health`;
  let response;

  try {
    response = await fetch(url);
  } catch (err) {
    const error = new Error("Backend에 연결할 수 없습니다.");
    error.code = "BACKEND_UNREACHABLE";
    error.cause = err;
    throw error;
  }

  let body;
  try {
    body = await response.json();
  } catch {
    const error = new Error("Backend health 응답이 JSON이 아닙니다.");
    error.code = "INVALID_HEALTH_RESPONSE";
    error.status = response.status;
    throw error;
  }

  return {
    httpStatus: response.status,
    ...body,
  };
}

export async function apiRequest(method, path, body) {
  const url = `${getApiBaseUrl()}/${String(path).replace(/^\//, "")}`;
  let response;

  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    const error = new Error("Backend에 연결할 수 없습니다.");
    error.code = "BACKEND_UNREACHABLE";
    throw error;
  }

  let json;
  try {
    json = await response.json();
  } catch {
    const error = new Error("서버 응답을 해석할 수 없습니다.");
    error.status = response.status;
    throw error;
  }

  if (!response.ok || json.ok === false) {
    const error = new Error(json.error?.message || "요청에 실패했습니다.");
    error.code = json.error?.code || "REQUEST_FAILED";
    error.status = response.status;
    throw error;
  }

  return json.data;
}

export async function apiUpload(path, formData) {
  const url = `${getApiBaseUrl()}/${String(path).replace(/^\//, "")}`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      body: formData,
    });
  } catch {
    const error = new Error("Backend에 연결할 수 없습니다.");
    error.code = "BACKEND_UNREACHABLE";
    throw error;
  }

  let json;
  try {
    json = await response.json();
  } catch {
    const error = new Error("서버 응답을 해석할 수 없습니다.");
    error.status = response.status;
    throw error;
  }

  if (!response.ok || json.ok === false) {
    const error = new Error(json.error?.message || "요청에 실패했습니다.");
    error.code = json.error?.code || "REQUEST_FAILED";
    error.status = response.status;
    throw error;
  }

  return json.data;
}

export async function apiDownload(path, { filename: fallbackName } = {}) {
  const url = `${getApiBaseUrl()}/${String(path).replace(/^\//, "")}`;
  let response;
  try {
    response = await fetch(url);
  } catch {
    const error = new Error("Backend에 연결할 수 없습니다.");
    error.code = "BACKEND_UNREACHABLE";
    throw error;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || contentType.includes("application/json")) {
    let json = {};
    try {
      json = await response.json();
    } catch {
      json = {};
    }
    const error = new Error(json.error?.message || "다운로드에 실패했습니다.");
    error.code = json.error?.code || "REQUEST_FAILED";
    error.status = response.status;
    throw error;
  }

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plainMatch = disposition.match(/filename="([^"]+)"/i);
  const filename = utfMatch
    ? decodeURIComponent(utfMatch[1])
    : plainMatch
      ? plainMatch[1]
      : fallbackName || "거래명세서.xlsx";

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
  return { filename, size: blob.size };
}

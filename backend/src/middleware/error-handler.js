import multer from "multer";
import { logger } from "../utils/logger.js";

export function errorHandler(err, _req, res, _next) {
  if (err instanceof multer.MulterError) {
    const tooLarge = err.code === "LIMIT_FILE_SIZE";
    res.status(400).json({
      ok: false,
      error: {
        code: tooLarge ? "FILE_TOO_LARGE" : "UPLOAD_FAILED",
        message: tooLarge ? "파일 크기가 허용 범위를 초과합니다." : "파일 업로드에 실패했습니다.",
      },
    });
    return;
  }

  const status = Number(err.statusCode || err.status || 500);
  const code = err.code || (status === 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_FAILED");
  const message =
    status === 500 ? "An unexpected error occurred." : err.message || "Request failed.";

  if (status >= 500) {
    logger.error("Unhandled request error", err);
  } else if (err.code === "INVALID_EXCEL") {
    logger.error("Excel parse rejected", err.cause || err);
  }

  res.status(status).json({
    ok: false,
    error: {
      code,
      message,
      ...(err.details && typeof err.details === "object" ? err.details : {}),
    },
  });
}

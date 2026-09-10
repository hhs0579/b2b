import multer from "multer";
import { env } from "../config/env.js";
import { AppError } from "../utils/app-error.js";

export const orderFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.UPLOAD_MAX_BYTES,
    files: 1,
  },
  fileFilter(_req, file, cb) {
    const name = String(file.originalname || "").toLowerCase();
    if (!name.endsWith(".xls") && !name.endsWith(".xlsx")) {
      cb(new AppError("INVALID_FILE_TYPE", "xls 또는 xlsx 파일만 업로드할 수 있습니다.", 400));
      return;
    }
    cb(null, true);
  },
}).single("file");

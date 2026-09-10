function timestamp() {
  return new Date().toISOString();
}

function formatError(err) {
  if (!err) {
    return "";
  }
  if (err instanceof Error) {
    return err.stack || err.message;
  }
  return String(err);
}

export const logger = {
  info(message) {
    console.log(`[${timestamp()}] [INFO] ${message}`);
  },
  warn(message) {
    console.warn(`[${timestamp()}] [WARN] ${message}`);
  },
  error(message, err) {
    const detail = formatError(err);
    console.error(`[${timestamp()}] [ERROR] ${message}${detail ? `\n${detail}` : ""}`);
  },
};

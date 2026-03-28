function logInfo(message, data = null) {
  console.log(`[INFO] ${message}`, data || "");
}

function logError(message, error = null) {
  console.error(`[ERROR] ${message}`, error || "");
}

module.exports = { logInfo, logError };
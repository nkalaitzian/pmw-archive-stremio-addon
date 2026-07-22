const path = require("node:path")

function asNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function asNonNegativeNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

const PMW_CONFIG = {
  baseUrl: "https://archive.wubby.tv/vods/public/",
  recentLimit: asNumber(process.env.PMW_RECENT_LIMIT, 20),
  cache: {
    directory: path.join(__dirname, ".cache", "pmw"),
    indexTtlMs: asNumber(process.env.PMW_INDEX_TTL_MS, 6 * 60 * 60 * 1000),
    monthTtlMs: asNumber(process.env.PMW_MONTH_TTL_MS, 24 * 60 * 60 * 1000),
    recentTtlMs: asNumber(process.env.PMW_RECENT_TTL_MS, 15 * 60 * 1000)
  },
  refresh: {
    intervalMs: asNonNegativeNumber(process.env.PMW_REFRESH_INTERVAL_MS, 30 * 60 * 1000),
    recentMonthsToRefresh: asNumber(process.env.PMW_RECENT_MONTHS_TO_REFRESH, 2)
  },
  network: {
    timeoutMs: asNumber(process.env.PMW_HTTP_TIMEOUT_MS, 10000),
    retries: asNumber(process.env.PMW_HTTP_RETRIES, 2),
    retryDelayMs: asNumber(process.env.PMW_HTTP_RETRY_DELAY_MS, 300),
    maxConcurrentRequests: asNumber(process.env.PMW_HTTP_MAX_CONCURRENT_REQUESTS, 1),
    minIntervalMs: asNonNegativeNumber(process.env.PMW_HTTP_MIN_INTERVAL_MS, 500)
  },
  publish: {
    enabled: process.env.PUBLISH_CENTRAL === "true"
  },
  diagnostics: {
    enabled: process.env.DEBUG_PMW === "true",
    port: asNumber(process.env.PMW_DIAGNOSTICS_PORT, 7001)
  }
}

module.exports = {
  PMW_CONFIG
}

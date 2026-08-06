const { addonBuilder } = require("stremio-addon-sdk")
const { fetchYearsIndex, fetchMonthVideos, normalizeMonthVideos } = require('./fetchCatalog.js')
const path = require('node:path')
const { PMW_CONFIG } = require('./config')
const { readJson, writeJson, isExpired, ensureDir } = require('./cacheStore')

const ARCHIVE_URL = "https://archive.wubby.tv/vods/public/"
const REPO_URL = "https://github.com/nkalaitzian/pmw-archive-stremio-addon"
const ISSUES_URL = "https://github.com/nkalaitzian/pmw-archive-stremio-addon/issues"
const DONATE_URL = "https://ko-fi.com/pastouris"

// Docs: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md
const manifest = {
  id: "community.PMW",
  version: "1.1.0",

  name: "PMW Stream Archive",
  description: `A Stremio extension to stream content from archive.wubby.tv<br/><br/>Configure your browsing experience below. Recent Limit affects only PMW Recently Added, Year Order changes catalog sorting, and Clean Titles toggles friendly names vs raw filenames.<br/><br/><details><summary><strong>Cache Mode Guide And Parameters</strong></summary><br/><strong>fresh</strong>: prioritizes freshness with frequent updates. Values: indexTtlMs=30m, monthTtlMs=120m, recentTtlMs=5m, recentMonthsToRefresh=6.<br/><strong>balanced</strong>: default behavior for normal use. Values follow server defaults from environment (index 6h, month 24h, recent 15m, recentMonthsToRefresh 2 unless changed via env).<br/><strong>stable</strong>: minimizes refresh work and network usage. Values: indexTtlMs=12h, monthTtlMs=48h, recentTtlMs=60m, recentMonthsToRefresh=2.<br/><br/><strong>indexTtlMs</strong>: how long the month/year index stays valid before a refresh is triggered.<br/><strong>monthTtlMs</strong>: how long each month payload (episode list for a month) stays valid before refresh.<br/><strong>recentTtlMs</strong>: how long the PMW Recently Added list stays valid before refresh.<br/><strong>recentMonthsToRefresh</strong>: how many newest months are scanned when rebuilding the recent list; larger values improve recency coverage but do more work.</details><br/><br/><a href="${ARCHIVE_URL}" target="_blank" rel="noopener noreferrer">Archive</a> | <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">Repository</a> | <a href="${ISSUES_URL}" target="_blank" rel="noopener noreferrer">Suggest Features / Report Bugs</a> | <a href="${DONATE_URL}" target="_blank" rel="noopener noreferrer">Donate</a>`,

  catalogs: [
    { type: "series", id: "pmwArchive", name: "PMW Archive" },
    { type: "series", id: "pmwRecent", name: "PMW Recently Added" }
  ],
  resources: [
    "catalog",
    "stream",
    { name: "meta", types: ["series"], idPrefixes: ["pmwArchive"] }
  ],
  types: ["series"],
  behaviorHints: {
    configurable: true
  },
  config: [
    {
      key: "recentLimit",
      type: "number",
      title: "Recently Added item count (1-100)",
      default: String(PMW_CONFIG.recentLimit),
      required: false
    },
    {
      key: "yearSort",
      type: "select",
      title: "Year order in PMW Archive",
      default: "desc",
      options: ["desc", "asc"]
    },
    {
      key: "cleanTitles",
      type: "checkbox",
      title: "Use cleaned episode titles (disable for raw filenames)",
      default: "checked"
    },
    {
      key: "cacheMode",
      type: "select",
      title: "Cache behavior preset (see Cache Mode Guide above)",
      default: "balanced",
      options: ["fresh", "balanced", "stable"],
      required: false
    }
  ],
  icon: "https://i.redd.it/gdjrfcewm9o21.jpg",

}
const monthNames = {
  1: "January",
  2: "February",
  3: "March",
  4: "April",
  5: "May",
  6: "June",
  7: "July",
  8: "August",
  9: "September",
  10: "October",
  11: "November",
  12: "December"
}

let dataset = {}
let yearMonthIndex = {}
let seriesVideosIndex = {}
let seasonIndex = {}
let monthVideosCache = {}
let recentEpisodes = []
let indexLoadPromise = null
let monthLoadPromises = {}
let backgroundIndexRefreshPromise = null
let recentLoadPromise = null

const diagnostics = {
  lastIndexLoadAt: null,
  lastIndexRefreshAt: null,
  lastRecentRefreshAt: null,
  lastScheduledRefreshAt: null,
  lastError: null
}

const MINUTE_MS = 60 * 1000

const CACHE_MODES = {
  fresh: {
    indexTtlMs: 30 * MINUTE_MS,
    monthTtlMs: 120 * MINUTE_MS,
    recentTtlMs: 5 * MINUTE_MS,
    recentMonthsToRefresh: 6
  },
  balanced: {
    indexTtlMs: PMW_CONFIG.cache.indexTtlMs,
    monthTtlMs: PMW_CONFIG.cache.monthTtlMs,
    recentTtlMs: PMW_CONFIG.cache.recentTtlMs,
    recentMonthsToRefresh: PMW_CONFIG.refresh.recentMonthsToRefresh
  },
  stable: {
    indexTtlMs: 12 * 60 * MINUTE_MS,
    monthTtlMs: 48 * 60 * MINUTE_MS,
    recentTtlMs: 60 * MINUTE_MS,
    recentMonthsToRefresh: 2
  }
}

const cachePaths = {
  index: path.join(PMW_CONFIG.cache.directory, 'index.json'),
  recent: path.join(PMW_CONFIG.cache.directory, 'recent.json'),
  monthsDir: path.join(PMW_CONFIG.cache.directory, 'months')
}

ensureDir(PMW_CONFIG.cache.directory)
ensureDir(cachePaths.monthsDir)

function debugLog(...args) {
  if (PMW_CONFIG.diagnostics.enabled) {
    console.log('[pmw-debug]', ...args)
  }
}

function getYearTitle(year) {
  return `PMW Archive - ${year}`
}

function normalizeDisplayTitle(entry) {
  if (entry.displayTitle && entry.displayTitle !== "Untitled Stream") {
    return entry.displayTitle
  }

  const datePart = entry.streamDate
    ? entry.streamDate.slice(0, 10)
    : `${entry.year || "unknown"}-${String(entry.monthNumber || 1).padStart(2, "0")}-01`
  return `Stream ${datePart} #${entry.episode || 1}`
}

function normalizeRecentEpisodeTitle(entry) {
  if (!entry || (entry.title && entry.title !== "Untitled Stream")) {
    return entry
  }

  const idMatch = /^pmwArchive:(\d+):(\d+)$/.exec(entry.id || "")
  const episode = idMatch ? Number(idMatch[2]) : 1
  return {
    ...entry,
    title: normalizeDisplayTitle({
      displayTitle: entry.title,
      streamDate: entry.streamDate,
      year: entry.streamDate ? entry.streamDate.slice(0, 4) : undefined,
      monthNumber: entry.streamDate ? Number(entry.streamDate.slice(5, 7)) : undefined,
      episode
    })
  }
}

function parseBoolean(value, defaultValue) {
  if (typeof value === "undefined" || value === null || value === "") {
    return defaultValue
  }

  const normalized = String(value).toLowerCase()
  if (["true", "1", "yes", "on", "checked"].includes(normalized)) {
    return true
  }

  if (["false", "0", "no", "off", "unchecked"].includes(normalized)) {
    return false
  }

  return defaultValue
}

function resolveRuntimeCacheMode(value) {
  const selected = String(value || "balanced").toLowerCase()
  if (CACHE_MODES[selected]) {
    return {
      mode: selected,
      runtime: CACHE_MODES[selected]
    }
  }

  return {
    mode: "balanced",
    runtime: CACHE_MODES.balanced
  }
}

function getUserConfig(config) {
  const recentLimitRaw = Number(config && config.recentLimit)
  const recentLimit = Number.isFinite(recentLimitRaw) && recentLimitRaw > 0
    ? Math.min(100, Math.max(1, Math.floor(recentLimitRaw)))
    : PMW_CONFIG.recentLimit
  const cacheMode = resolveRuntimeCacheMode(config && config.cacheMode)

  return {
    recentLimit,
    yearSort: config && config.yearSort === "asc" ? "asc" : "desc",
    cleanTitles: parseBoolean(config && config.cleanTitles, true),
    cacheMode: cacheMode.mode,
    runtime: {
      indexTtlMs: cacheMode.runtime.indexTtlMs,
      monthTtlMs: cacheMode.runtime.monthTtlMs,
      recentTtlMs: cacheMode.runtime.recentTtlMs,
      recentMonthsToRefresh: cacheMode.runtime.recentMonthsToRefresh
    }
  }
}

function resolveRequestConfig(config, extra) {
  if (config && typeof config === "object") {
    return config
  }

  if (extra && typeof extra === "object" && extra.__config && typeof extra.__config === "object") {
    return extra.__config
  }

  return {}
}

function pickDisplayTitle(entry, cleanTitles) {
  if (!entry) {
    return ""
  }

  return cleanTitles
    ? (entry.displayTitle || normalizeDisplayTitle(entry) || entry.title)
    : (entry.title || entry.displayTitle || normalizeDisplayTitle(entry))
}

function formatEpisodeListMetadata(entry) {
  if (!entry) {
    return ""
  }

  const parts = []
  if (entry.fileSize) {
    parts.push(entry.fileSize)
  }

  const uploaded = entry.modifiedAt || entry.streamDate || null
  if (uploaded) {
    parts.push(String(uploaded).slice(0, 10))
  }

  return parts.join(" | ")
}

function buildEpisodeListTitle(entry, cleanTitles, fallbackTitle) {
  const baseTitle = cleanTitles
    ? (entry.displayTitle || entry.name || normalizeDisplayTitle(entry) || fallbackTitle || "")
    : (entry.rawTitle || entry.title || entry.displayTitle || entry.name || normalizeDisplayTitle(entry) || fallbackTitle || "")

  const metadata = formatEpisodeListMetadata(entry)
  if (!metadata) {
    return baseTitle
  }

  return `${baseTitle}\n(${metadata})`
}

function buildStreamDescription(entry) {
  if (!entry) {
    return ""
  }

  const lines = []

  if (entry.modifiedAt) {
    lines.push(`Uploaded: ${entry.modifiedAt}`)
  }

  if (entry.fileSize) {
    lines.push(`File size: ${entry.fileSize}`)
  }

  return lines.join("\n")
}

function buildStreamSubtitle(entry) {
  if (!entry) {
    return ""
  }

  const parts = []
  if (entry.fileSize) {
    parts.push(`💾 ${entry.fileSize}`)
  }

  const uploaded = entry.modifiedAt || entry.streamDate || null
  if (uploaded) {
    parts.push(`📅 ${String(uploaded).slice(0, 10)}`)
  }

  return parts.join("   ")
}

function buildSeriesIndex(entries) {
  const byYear = {}

  for (const [id, item] of Object.entries(entries)) {
    if (!item.year || !item.monthNumber || !item.episode) {
      continue
    }

    if (!byYear[item.year]) {
      byYear[item.year] = []
    }

    byYear[item.year].push({
      id,
      name: normalizeDisplayTitle(item),
      rawTitle: item.title,
      season: item.monthNumber,
      episode: item.episode,
      streamDate: item.streamDate,
      modifiedAt: item.modifiedAt || null,
      fileSize: item.fileSize || null,
      thumbnail: item.thumbnail || null,
      description: `${monthNames[item.monthNumber] || item.month} ${item.displayTitle || item.title}`
    })
  }

  for (const year of Object.keys(byYear)) {
    byYear[year].sort((a, b) => {
      if (a.season !== b.season) {
        return a.season - b.season
      }

      return a.episode - b.episode
    })
  }

  return byYear
}

function buildSeriesIndexFromCache() {
  seriesVideosIndex = buildSeriesIndex(dataset)
}

function monthCachePath(folder) {
  return path.join(cachePaths.monthsDir, `${folder}.json`)
}

function flattenMonthsNewestFirst() {
  const all = Object.values(yearMonthIndex).flat()
  return all.sort((a, b) => {
    const yearDiff = Number(b.year) - Number(a.year)
    if (yearDiff !== 0) {
      return yearDiff
    }

    return b.monthNumber - a.monthNumber
  })
}

function applyMonthVideos(monthInfo, videos) {
  monthVideosCache[monthInfo.folder] = videos
  for (const video of videos) {
    const normalizedTitle = normalizeDisplayTitle(video)
    dataset[video.id] = {
      title: video.title,
      displayTitle: normalizedTitle,
      url: video.url,
      thumbnail: video.thumbnail || null,
      streamDate: video.streamDate || null,
      modifiedAt: video.modifiedAt || null,
      fileSize: video.fileSize || null,
      fileSizeBytes: Number.isFinite(video.fileSizeBytes) ? video.fileSizeBytes : null,
      month: video.month,
      monthShort: video.monthShort,
      monthNumber: video.monthNumber,
      year: video.year,
      season: video.season,
      episode: video.episode
    }
  }
  buildSeriesIndexFromCache()
}

function loadIndexFromDisk(indexTtlMs = PMW_CONFIG.cache.indexTtlMs) {
  const cached = readJson(cachePaths.index)
  if (!cached || !cached.years || !cached.seasons) {
    return { found: false, stale: true }
  }

  yearMonthIndex = cached.years
  seasonIndex = cached.seasons
  diagnostics.lastIndexLoadAt = cached.updatedAt || null
  return {
    found: true,
    stale: isExpired(cached.updatedAt, indexTtlMs)
  }
}

function saveIndexToDisk() {
  writeJson(cachePaths.index, {
    updatedAt: new Date().toISOString(),
    years: yearMonthIndex,
    seasons: seasonIndex
  })
}

function loadRecentFromDisk(recentTtlMs = PMW_CONFIG.cache.recentTtlMs) {
  const cached = readJson(cachePaths.recent)
  if (!cached || !Array.isArray(cached.episodes)) {
    return { found: false, stale: true }
  }

  recentEpisodes = cached.episodes.map(normalizeRecentEpisodeTitle)
  return {
    found: true,
    stale: isExpired(cached.updatedAt, recentTtlMs)
  }
}

function saveRecentToDisk() {
  writeJson(cachePaths.recent, {
    updatedAt: new Date().toISOString(),
    episodes: recentEpisodes
  })
}

function loadMonthFromDisk(monthInfo, monthTtlMs = PMW_CONFIG.cache.monthTtlMs) {
  const cached = readJson(monthCachePath(monthInfo.folder))
  if (!cached || !Array.isArray(cached.videos)) {
    return { found: false, stale: true }
  }

  const normalizedVideos = normalizeMonthVideos(monthInfo, cached.videos)
  applyMonthVideos(monthInfo, normalizedVideos)
  saveMonthToDisk(monthInfo, normalizedVideos)
  return {
    found: true,
    stale: isExpired(cached.updatedAt, monthTtlMs)
  }
}

function saveMonthToDisk(monthInfo, videos) {
  writeJson(monthCachePath(monthInfo.folder), {
    updatedAt: new Date().toISOString(),
    month: monthInfo,
    videos
  })
}

function toRecentComparable(item) {
  const parsed = new Date(item.streamDate || item.modifiedAt || 0).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function rebuildRecentFromLoadedData(limit = PMW_CONFIG.recentLimit) {
  const episodes = Object.values(dataset)
    .sort((a, b) => toRecentComparable(b) - toRecentComparable(a))
    .slice(0, Math.max(1, limit))
    .map((entry) => ({
      id: `pmwArchive:${entry.season}:${entry.episode}`,
      title: entry.displayTitle || entry.title,
      rawTitle: entry.title,
      overview: `${entry.streamDate ? entry.streamDate.slice(0, 10) : entry.year}-${String(entry.monthNumber).padStart(2, '0')} ${monthNames[entry.monthNumber] || entry.month}`,
      streamDate: entry.streamDate,
      modifiedAt: entry.modifiedAt || null,
      fileSize: entry.fileSize || null,
      thumbnail: entry.thumbnail || null
    }))

  recentEpisodes = episodes
}

async function refreshIndexFromSource() {
  const index = await fetchYearsIndex()
  yearMonthIndex = index.years || {}
  seasonIndex = index.seasons || {}
  diagnostics.lastIndexLoadAt = new Date().toISOString()
  diagnostics.lastIndexRefreshAt = diagnostics.lastIndexLoadAt
  saveIndexToDisk()
  console.log(`PMW index ready: ${Object.keys(yearMonthIndex).length} years, ${Object.keys(seasonIndex).length} months`)
}

async function refreshMonthFromSource(monthInfo) {
  const videos = await fetchMonthVideos(monthInfo)
  applyMonthVideos(monthInfo, videos)
  saveMonthToDisk(monthInfo, videos)
}

function refreshIndexInBackground() {
  if (!backgroundIndexRefreshPromise) {
    backgroundIndexRefreshPromise = refreshIndexFromSource().catch((err) => {
      diagnostics.lastError = `index-refresh: ${err.message}`
      console.error('Failed refreshing PMW index:', err)
    }).finally(() => {
      backgroundIndexRefreshPromise = null
    })
  }
}

async function loadIndex(runtimeConfig) {
  try {
    const indexTtlMs = runtimeConfig && runtimeConfig.indexTtlMs
      ? runtimeConfig.indexTtlMs
      : PMW_CONFIG.cache.indexTtlMs
    const cached = loadIndexFromDisk(indexTtlMs)
    if (!cached.found) {
      await refreshIndexFromSource()
    } else {
      debugLog('Loaded index from disk cache')
      if (cached.stale) {
        debugLog('Index cache is stale; refreshing in background')
        refreshIndexInBackground()
      }
    }
  } catch (err) {
    console.error("Failed to build PMW index:", err)
    diagnostics.lastError = `index-load: ${err.message}`
    dataset = {}
    yearMonthIndex = {}
    seriesVideosIndex = {}
    seasonIndex = {}
    monthVideosCache = {}
  }
}

async function ensureIndexReady(runtimeConfig) {
  if (!indexLoadPromise) {
    indexLoadPromise = loadIndex(runtimeConfig)
  }

  await indexLoadPromise

  if (runtimeConfig && runtimeConfig.indexTtlMs && isExpired(diagnostics.lastIndexLoadAt, runtimeConfig.indexTtlMs)) {
    debugLog("Index marked stale by configured TTL; refreshing in background")
    refreshIndexInBackground()
  }
}

async function ensureMonthLoaded(monthInfo, runtimeConfig) {
  if (!monthInfo || !monthInfo.folder) {
    return
  }

  const monthTtlMs = runtimeConfig && runtimeConfig.monthTtlMs
    ? runtimeConfig.monthTtlMs
    : PMW_CONFIG.cache.monthTtlMs

  if (monthVideosCache[monthInfo.folder]) {
    const monthCached = readJson(monthCachePath(monthInfo.folder))
    if (monthCached && isExpired(monthCached.updatedAt, monthTtlMs)) {
      refreshMonthFromSource(monthInfo).catch((err) => {
        diagnostics.lastError = `month-refresh-${monthInfo.folder}: ${err.message}`
        console.error(`Failed background refresh for ${monthInfo.folder}:`, err)
      })
    }
    return
  }

  if (!monthLoadPromises[monthInfo.folder]) {
    monthLoadPromises[monthInfo.folder] = (async () => {
      try {
        const cached = loadMonthFromDisk(monthInfo, monthTtlMs)
        if (cached.found) {
          debugLog(`Loaded month ${monthInfo.folder} from disk cache`)
          if (cached.stale) {
            refreshMonthFromSource(monthInfo).catch((err) => {
              diagnostics.lastError = `month-refresh-${monthInfo.folder}: ${err.message}`
              console.error(`Failed background refresh for ${monthInfo.folder}:`, err)
            })
          }
          return
        }

        await refreshMonthFromSource(monthInfo)
      } catch (err) {
        console.error(`Failed loading month ${monthInfo.folder}:`, err)
        diagnostics.lastError = `month-load-${monthInfo.folder}: ${err.message}`
        monthVideosCache[monthInfo.folder] = []
      } finally {
        delete monthLoadPromises[monthInfo.folder]
      }
    })()
  }

  await monthLoadPromises[monthInfo.folder]
}

async function ensureYearLoaded(year, runtimeConfig) {
  await ensureIndexReady(runtimeConfig)
  const months = yearMonthIndex[year] || []
  await Promise.all(months.map((monthInfo) => ensureMonthLoaded(monthInfo, runtimeConfig)))
}

async function refreshRecentEpisodes(runtimeConfig, recentLimit = PMW_CONFIG.recentLimit) {
  await ensureIndexReady(runtimeConfig)

  const monthEntries = flattenMonthsNewestFirst()
  const recentMonthsToRefresh = runtimeConfig && runtimeConfig.recentMonthsToRefresh
    ? runtimeConfig.recentMonthsToRefresh
    : PMW_CONFIG.refresh.recentMonthsToRefresh
  const loadTarget = Math.max(recentLimit, recentLimit * 2)
  let collected = 0

  for (const monthInfo of monthEntries.slice(0, recentMonthsToRefresh)) {
    await ensureMonthLoaded(monthInfo, runtimeConfig)
    collected += (monthVideosCache[monthInfo.folder] || []).length
    if (collected >= loadTarget) {
      break
    }
  }

  rebuildRecentFromLoadedData(recentLimit)
  saveRecentToDisk()
  diagnostics.lastRecentRefreshAt = new Date().toISOString()
}

async function ensureRecentReady(userConfig) {
  const runtimeConfig = userConfig && userConfig.runtime ? userConfig.runtime : null
  const recentLimit = userConfig && userConfig.recentLimit ? userConfig.recentLimit : PMW_CONFIG.recentLimit

  const recentCache = readJson(cachePaths.recent)
  if (recentEpisodes.length > 0) {
    if (recentCache && runtimeConfig && isExpired(recentCache.updatedAt, runtimeConfig.recentTtlMs)) {
      refreshRecentEpisodes(runtimeConfig, recentLimit).catch((err) => {
        diagnostics.lastError = `recent-refresh: ${err.message}`
        console.error('Failed refreshing recent episodes:', err)
      })
    }
    return
  }

  const recentTtlMs = runtimeConfig && runtimeConfig.recentTtlMs
    ? runtimeConfig.recentTtlMs
    : PMW_CONFIG.cache.recentTtlMs

  const cached = loadRecentFromDisk(recentTtlMs)
  if (cached.found) {
    if (cached.stale) {
      refreshRecentEpisodes(runtimeConfig, recentLimit).catch((err) => {
        diagnostics.lastError = `recent-refresh: ${err.message}`
        console.error('Failed refreshing recent episodes:', err)
      })
    }
    return
  }

  if (!recentLoadPromise) {
    recentLoadPromise = refreshRecentEpisodes(runtimeConfig, recentLimit).finally(() => {
      recentLoadPromise = null
    })
  }

  await recentLoadPromise
}

function latestMonthsToRefresh(runtimeConfig) {
  const recentMonthsToRefresh = runtimeConfig && runtimeConfig.recentMonthsToRefresh
    ? runtimeConfig.recentMonthsToRefresh
    : PMW_CONFIG.refresh.recentMonthsToRefresh
  return flattenMonthsNewestFirst().slice(0, recentMonthsToRefresh)
}

function scheduleBackgroundRefresh() {
  if (!PMW_CONFIG.refresh.intervalMs) {
    return
  }

  const timer = setInterval(async () => {
    try {
      diagnostics.lastScheduledRefreshAt = new Date().toISOString()
      await refreshIndexFromSource()

      const newestMonths = latestMonthsToRefresh()
      await Promise.all(newestMonths.map((monthInfo) => refreshMonthFromSource(monthInfo)))
      await refreshRecentEpisodes()
      debugLog('Background refresh cycle complete')
    } catch (err) {
      diagnostics.lastError = `scheduled-refresh: ${err.message}`
      console.error('Scheduled refresh failed:', err)
    }
  }, PMW_CONFIG.refresh.intervalMs)

  if (typeof timer.unref === 'function') {
    timer.unref()
  }
}

function getDiagnosticsSnapshot() {
  return {
    generatedAt: new Date().toISOString(),
    config: {
      recentLimit: PMW_CONFIG.recentLimit,
      cache: PMW_CONFIG.cache,
      refresh: PMW_CONFIG.refresh,
      network: PMW_CONFIG.network
    },
    counts: {
      years: Object.keys(yearMonthIndex).length,
      seasons: Object.keys(seasonIndex).length,
      loadedMonths: Object.keys(monthVideosCache).length,
      loadedStreams: Object.keys(dataset).length,
      recentEpisodes: recentEpisodes.length,
      pendingMonthLoads: Object.keys(monthLoadPromises).length
    },
    diagnostics
  }
}

ensureIndexReady()
scheduleBackgroundRefresh()

const builder = new addonBuilder(manifest)

builder.defineCatalogHandler(async ({ type, id, extra, config }) => {
  console.log("request for catalogs: " + type + " " + id + " extra: " + JSON.stringify(extra));
  const userConfig = getUserConfig(resolveRequestConfig(config, extra))
  await ensureIndexReady(userConfig.runtime)

  if (id !== 'pmwArchive' || type !== 'series') {
    if (id === 'pmwRecent' && type === 'series') {
      return Promise.resolve({
        metas: [{
          id: 'pmwArchive:recent',
          type: 'series',
          name: 'PMW Recently Added',
          description: `Latest ${userConfig.recentLimit} episodes by stream date.`,
          poster: 'https://i.redd.it/gdjrfcewm9o21.jpg',
          posterShape: 'square',
          background: 'https://i.redd.it/gdjrfcewm9o21.jpg'
        }]
      })
    }

    return Promise.resolve({ metas: [] })
  }

  const years = Object.keys(yearMonthIndex).sort((a, b) => {
    if (userConfig.yearSort === "asc") {
      return Number(a) - Number(b)
    }

    return Number(b) - Number(a)
  })
  const metas = years.map((year) => ({
    id: `pmwArchive:${year}`,
    type: "series",
    name: getYearTitle(year),
    description: `Archive streams for ${year}. Open to browse monthly seasons and episodes.`,
    releaseInfo: year,
    poster: 'https://i.redd.it/gdjrfcewm9o21.jpg',
    posterShape: 'square',
    background: 'https://i.redd.it/gdjrfcewm9o21.jpg',
  }))

  return Promise.resolve({ metas })
})

builder.defineMetaHandler(async ({ type, id, config, extra }) => {
  console.log("request for metas: " + type + " " + id);
  const userConfig = getUserConfig(resolveRequestConfig(config, extra))
  await ensureIndexReady(userConfig.runtime)

  if (type !== "series") {
    return Promise.resolve({ meta: {} })
  }

  const match = /^pmwArchive:(\d{4})$/.exec(id || "")
  if (id === 'pmwArchive:recent') {
    await ensureRecentReady(userConfig)

    const videos = recentEpisodes.slice(0, userConfig.recentLimit).map((entry, index) => ({
      id: entry.id,
      title: buildEpisodeListTitle(entry, userConfig.cleanTitles, entry.title),
      season: 1,
      episode: index + 1,
      thumbnail: entry.thumbnail || undefined,
      overview: entry.overview
    }))

    return Promise.resolve({
      meta: {
        id: 'pmwArchive:recent',
        type: 'series',
        name: 'PMW Recently Added',
        description: `Latest ${userConfig.recentLimit} episodes by stream date.`,
        poster: 'https://i.redd.it/gdjrfcewm9o21.jpg',
        posterShape: 'square',
        background: 'https://i.redd.it/gdjrfcewm9o21.jpg',
        videos
      }
    })
  }

  if (!match) {
    return Promise.resolve({ meta: {} })
  }

  const year = match[1]
  await ensureYearLoaded(year, userConfig.runtime)

  const videos = (seriesVideosIndex[year] || []).map((entry) => ({
    id: entry.id,
    title: buildEpisodeListTitle(entry, userConfig.cleanTitles, entry.name),
    season: entry.season,
    episode: entry.episode,
    thumbnail: entry.thumbnail || undefined,
    overview: entry.description
  }))

  const meta = {
    id,
    type: "series",
    name: getYearTitle(year),
    description: `Archive streams for ${year}.`,
    releaseInfo: year,
    poster: 'https://i.redd.it/gdjrfcewm9o21.jpg',
    posterShape: 'square',
    background: 'https://i.redd.it/gdjrfcewm9o21.jpg',
    videos
  }
  return Promise.resolve({ meta: meta })
});

builder.defineStreamHandler(async ({ type, id, config, extra }) => {
  console.log("request for streams: " + type + " " + id);
  const userConfig = getUserConfig(resolveRequestConfig(config, extra))
  await ensureIndexReady(userConfig.runtime)

  const streamIdMatch = /^pmwArchive:(\d+):(\d+)$/.exec(id || "")
  if (streamIdMatch && !dataset[id]) {
    const season = Number(streamIdMatch[1])
    const monthInfo = seasonIndex[season]
    if (monthInfo) {
      await ensureMonthLoaded(monthInfo, userConfig.runtime)
    }
  }

  var streams = [];
  if (type === "series" && /\w+:\d+:\d+/.test(id) && dataset[id]) {
    const displayName = pickDisplayTitle(dataset[id], userConfig.cleanTitles)
    const streamSubtitle = buildStreamSubtitle(dataset[id])

    streams.push({
      url: dataset[id].url,
      name: displayName,
      title: streamSubtitle || displayName,
      description: buildStreamDescription(dataset[id])
    })
  }
  return Promise.resolve({ streams: streams })
});

const addonInterface = builder.getInterface()
addonInterface.getDiagnosticsSnapshot = getDiagnosticsSnapshot

module.exports = addonInterface

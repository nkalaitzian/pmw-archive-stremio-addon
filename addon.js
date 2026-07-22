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
  version: "1.0.1",

  name: "PMW Stream Archive",
  description: `Configure your browsing experience below. Recent Limit affects only PMW Recently Added, Year Order changes catalog sorting, and Clean Titles toggles friendly names vs raw filenames. <a href="${ARCHIVE_URL}" target="_blank" rel="noopener noreferrer">Archive</a> | <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">Repository</a> | <a href="${ISSUES_URL}" target="_blank" rel="noopener noreferrer">Suggest Features / Report Bugs</a> | <a href="${DONATE_URL}" target="_blank" rel="noopener noreferrer">Donate</a>`,

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

function getUserConfig(config) {
  const recentLimitRaw = Number(config && config.recentLimit)
  const recentLimit = Number.isFinite(recentLimitRaw) && recentLimitRaw > 0
    ? Math.min(100, Math.max(1, Math.floor(recentLimitRaw)))
    : PMW_CONFIG.recentLimit

  return {
    recentLimit,
    yearSort: config && config.yearSort === "asc" ? "asc" : "desc",
    cleanTitles: parseBoolean(config && config.cleanTitles, true)
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

function loadIndexFromDisk() {
  const cached = readJson(cachePaths.index)
  if (!cached || !cached.years || !cached.seasons) {
    return { found: false, stale: true }
  }

  yearMonthIndex = cached.years
  seasonIndex = cached.seasons
  diagnostics.lastIndexLoadAt = cached.updatedAt || null
  return {
    found: true,
    stale: isExpired(cached.updatedAt, PMW_CONFIG.cache.indexTtlMs)
  }
}

function saveIndexToDisk() {
  writeJson(cachePaths.index, {
    updatedAt: new Date().toISOString(),
    years: yearMonthIndex,
    seasons: seasonIndex
  })
}

function loadRecentFromDisk() {
  const cached = readJson(cachePaths.recent)
  if (!cached || !Array.isArray(cached.episodes)) {
    return { found: false, stale: true }
  }

  recentEpisodes = cached.episodes.map(normalizeRecentEpisodeTitle)
  return {
    found: true,
    stale: isExpired(cached.updatedAt, PMW_CONFIG.cache.recentTtlMs)
  }
}

function saveRecentToDisk() {
  writeJson(cachePaths.recent, {
    updatedAt: new Date().toISOString(),
    episodes: recentEpisodes
  })
}

function loadMonthFromDisk(monthInfo) {
  const cached = readJson(monthCachePath(monthInfo.folder))
  if (!cached || !Array.isArray(cached.videos)) {
    return { found: false, stale: true }
  }

  const normalizedVideos = normalizeMonthVideos(monthInfo, cached.videos)
  applyMonthVideos(monthInfo, normalizedVideos)
  saveMonthToDisk(monthInfo, normalizedVideos)
  return {
    found: true,
    stale: isExpired(cached.updatedAt, PMW_CONFIG.cache.monthTtlMs)
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

function rebuildRecentFromLoadedData() {
  const episodes = Object.values(dataset)
    .sort((a, b) => toRecentComparable(b) - toRecentComparable(a))
    .slice(0, PMW_CONFIG.recentLimit)
    .map((entry) => ({
      id: `pmwArchive:${entry.season}:${entry.episode}`,
      title: entry.displayTitle || entry.title,
      rawTitle: entry.title,
      overview: `${entry.streamDate ? entry.streamDate.slice(0, 10) : entry.year}-${String(entry.monthNumber).padStart(2, '0')} ${monthNames[entry.monthNumber] || entry.month}`,
      streamDate: entry.streamDate,
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

async function loadIndex() {
  try {
    const cached = loadIndexFromDisk()
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

function ensureIndexReady() {
  if (!indexLoadPromise) {
    indexLoadPromise = loadIndex()
  }

  return indexLoadPromise
}

async function ensureMonthLoaded(monthInfo) {
  if (!monthInfo || !monthInfo.folder) {
    return
  }

  if (monthVideosCache[monthInfo.folder]) {
    return
  }

  if (!monthLoadPromises[monthInfo.folder]) {
    monthLoadPromises[monthInfo.folder] = (async () => {
      try {
        const cached = loadMonthFromDisk(monthInfo)
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

async function ensureYearLoaded(year) {
  await ensureIndexReady()
  const months = yearMonthIndex[year] || []
  await Promise.all(months.map((monthInfo) => ensureMonthLoaded(monthInfo)))
}

async function refreshRecentEpisodes() {
  await ensureIndexReady()

  const monthEntries = flattenMonthsNewestFirst()
  const loadTarget = Math.max(PMW_CONFIG.recentLimit, PMW_CONFIG.recentLimit * 2)
  let collected = 0

  for (const monthInfo of monthEntries) {
    await ensureMonthLoaded(monthInfo)
    collected += (monthVideosCache[monthInfo.folder] || []).length
    if (collected >= loadTarget) {
      break
    }
  }

  rebuildRecentFromLoadedData()
  saveRecentToDisk()
  diagnostics.lastRecentRefreshAt = new Date().toISOString()
}

async function ensureRecentReady() {
  if (recentEpisodes.length > 0) {
    return
  }

  const cached = loadRecentFromDisk()
  if (cached.found) {
    if (cached.stale) {
      refreshRecentEpisodes().catch((err) => {
        diagnostics.lastError = `recent-refresh: ${err.message}`
        console.error('Failed refreshing recent episodes:', err)
      })
    }
    return
  }

  if (!recentLoadPromise) {
    recentLoadPromise = refreshRecentEpisodes().finally(() => {
      recentLoadPromise = null
    })
  }

  await recentLoadPromise
}

function latestMonthsToRefresh() {
  return flattenMonthsNewestFirst().slice(0, PMW_CONFIG.refresh.recentMonthsToRefresh)
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
  await ensureIndexReady()
  const userConfig = getUserConfig(resolveRequestConfig(config, extra))

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
  await ensureIndexReady()
  const userConfig = getUserConfig(resolveRequestConfig(config, extra))

  if (type !== "series") {
    return Promise.resolve({ meta: {} })
  }

  const match = /^pmwArchive:(\d{4})$/.exec(id || "")
  if (id === 'pmwArchive:recent') {
    await ensureRecentReady()

    const videos = recentEpisodes.slice(0, userConfig.recentLimit).map((entry, index) => ({
      id: entry.id,
      title: userConfig.cleanTitles ? entry.title : (entry.rawTitle || entry.title),
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
  await ensureYearLoaded(year)

  const videos = (seriesVideosIndex[year] || []).map((entry) => ({
    id: entry.id,
    title: userConfig.cleanTitles ? entry.name : (entry.rawTitle || entry.name),
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
  await ensureIndexReady()
  const userConfig = getUserConfig(resolveRequestConfig(config, extra))

  const streamIdMatch = /^pmwArchive:(\d+):(\d+)$/.exec(id || "")
  if (streamIdMatch && !dataset[id]) {
    const season = Number(streamIdMatch[1])
    const monthInfo = seasonIndex[season]
    if (monthInfo) {
      await ensureMonthLoaded(monthInfo)
    }
  }

  var streams = [];
  if (type === "series" && /\w+:\d+:\d+/.test(id) && dataset[id]) {
    streams.push({
      url: dataset[id].url,
      title: pickDisplayTitle(dataset[id], userConfig.cleanTitles)
    })
  }
  return Promise.resolve({ streams: streams })
});

const addonInterface = builder.getInterface()
addonInterface.getDiagnosticsSnapshot = getDiagnosticsSnapshot

module.exports = addonInterface

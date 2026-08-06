const { fetchLinkTitlesFromPage, fetchVideoUrlsFromPage } = require('./fetchUtil.js')
const { PMW_CONFIG } = require('./config')

const baseUrl = PMW_CONFIG.baseUrl

const monthOrder = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12
}

function parseMonthYearFolder(folder) {
  const match = /^([a-z]{3})_(\d{4})$/i.exec(folder || "")
  if (!match) {
    return null
  }

  const shortMonth = match[1].toLowerCase()
  const year = match[2]
  const monthNumber = monthOrder[shortMonth]
  if (!monthNumber) {
    return null
  }

  return {
    folder,
    year,
    monthShort: shortMonth,
    monthNumber
  }
}

function buildEpisodeId(season, episode) {
  return `pmwArchive:${season}:${episode}`
}

function deriveStreamDate(monthInfo, fileName, modifiedAt) {
  const month = String(monthInfo.monthNumber).padStart(2, "0")
  const dayMatch = /^(\d{1,2})[_-]/.exec(fileName || "")

  if (dayMatch) {
    const day = Number(dayMatch[1])
    if (day >= 1 && day <= 31) {
      const date = new Date(Date.UTC(Number(monthInfo.year), monthInfo.monthNumber - 1, day, 12, 0, 0))
      return date.toISOString()
    }
  }

  if (modifiedAt) {
    const parsed = new Date(modifiedAt)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString()
    }
  }

  return `${monthInfo.year}-${month}-01T12:00:00.000Z`
}

function dateToEpochMs(value) {
  const parsed = new Date(value || "")
  const epoch = parsed.getTime()
  return Number.isNaN(epoch) ? null : epoch
}

function normalizeMonthVideos(monthInfo, videos) {
  const sortedVideos = [...videos].sort((a, b) => {
    const aDate = dateToEpochMs(a.modifiedAt || deriveStreamDate(monthInfo, a.title, a.modifiedAt))
    const bDate = dateToEpochMs(b.modifiedAt || deriveStreamDate(monthInfo, b.title, b.modifiedAt))

    if (aDate !== null && bDate !== null && aDate !== bDate) {
      return aDate - bDate
    }

    if (aDate !== null && bDate === null) {
      return -1
    }

    if (aDate === null && bDate !== null) {
      return 1
    }

    return String(a.title || "").localeCompare(String(b.title || ""))
  })

  let episode = 1
  return sortedVideos.map((video) => {
    const streamDate = deriveStreamDate(monthInfo, video.title, video.modifiedAt)
    const displayTitle = deriveDisplayTitle(video, streamDate, episode)
    const item = {
      id: buildEpisodeId(monthInfo.season, episode),
      title: video.title,
      displayTitle,
      url: video.url,
      thumbnail: video.thumbnail || null,
      streamDate,
      modifiedAt: video.modifiedAt || null,
      fileSize: video.fileSize || null,
      fileSizeBytes: Number.isFinite(video.fileSizeBytes) ? video.fileSizeBytes : null,
      month: monthInfo.folder,
      monthShort: monthInfo.monthShort,
      monthNumber: monthInfo.monthNumber,
      year: monthInfo.year,
      season: monthInfo.season,
      episode
    }
    episode++
    return item
  })
}

function deriveDisplayTitle(video, streamDate, episode) {
  if (video.displayTitle && video.displayTitle !== "Untitled Stream") {
    return video.displayTitle
  }

  const datePart = streamDate ? streamDate.slice(0, 10) : "Unknown Date"
  return `Stream ${datePart} #${episode}`
}

async function fetchCatalog() {
  const catalog = {};

  const monthEntries = await fetchMonthEntries()
  for (const monthInfo of monthEntries) {
    const videos = await fetchMonthVideos(monthInfo)
    for (const video of videos) {
      catalog[video.id] = {
        title: video.title,
        displayTitle: video.displayTitle,
        url: video.url,
        streamDate: video.streamDate,
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
  }

  return catalog;
}

async function fetchMonthEntries() {
  const folders = await fetchMonths()
  const parsedFolders = folders
    .map(parseMonthYearFolder)
    .filter(Boolean)
    .sort((a, b) => {
      const yearDiff = Number(a.year) - Number(b.year)
      if (yearDiff !== 0) {
        return yearDiff
      }

      return a.monthNumber - b.monthNumber
    })

  let season = 1
  return parsedFolders.map((entry) => {
    const withSeason = {
      ...entry,
      season
    }
    season++
    return withSeason
  })
}

async function fetchYearsIndex() {
  const monthEntries = await fetchMonthEntries()
  const years = {}
  const seasons = {}

  for (const entry of monthEntries) {
    if (!years[entry.year]) {
      years[entry.year] = []
    }

    years[entry.year].push(entry)
    seasons[entry.season] = entry
  }

  return {
    years,
    seasons
  }
}

async function fetchMonthVideos(monthInfo) {
  const monthUrl = baseUrl + monthInfo.folder + '/'
  const videoURLs = await fetchVideoUrlsFromPage(monthUrl)
  return normalizeMonthVideos(monthInfo, videoURLs)
}

async function fetchMonths() {
  return await fetchLinkTitlesFromPage(baseUrl);
}

module.exports = {
  buildEpisodeId,
  deriveStreamDate,
  fetchCatalog,
  fetchMonths,
  fetchMonthEntries,
  fetchYearsIndex,
  fetchMonthVideos,
  normalizeMonthVideos,
  parseMonthYearFolder
};
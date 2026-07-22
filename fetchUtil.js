const fetch = require('node-fetch')
const cheerio = require('cheerio')
const { PMW_CONFIG } = require('./config')

let activeRequests = 0
let lastRequestStartedAt = 0
const pendingResolvers = []

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function releaseRequestSlot() {
  activeRequests = Math.max(0, activeRequests - 1)

  if (pendingResolvers.length > 0) {
    const next = pendingResolvers.shift()
    next()
  }
}

async function acquireRequestSlot() {
  while (activeRequests >= PMW_CONFIG.network.maxConcurrentRequests) {
    await new Promise((resolve) => pendingResolvers.push(resolve))
  }

  const now = Date.now()
  const elapsed = now - lastRequestStartedAt
  const waitFor = PMW_CONFIG.network.minIntervalMs - elapsed
  if (waitFor > 0) {
    await sleep(waitFor)
  }

  activeRequests += 1
  lastRequestStartedAt = Date.now()
}

async function fetchWithRetry(url, options = {}) {
  const attempts = PMW_CONFIG.network.retries + 1
  let lastError = null

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await acquireRequestSlot()
      const response = await fetch(url, {
        timeout: PMW_CONFIG.network.timeoutMs,
        ...options
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`)
      }

      return response
    } catch (err) {
      lastError = err
      if (attempt < attempts) {
        await sleep(PMW_CONFIG.network.retryDelayMs * attempt)
      }
    } finally {
      releaseRequestSlot()
    }
  }

  throw lastError
}

function sanitizeDirectoryName(value) {
  if (!value) {
    return ""
  }

  return decodeURIComponent(value)
    .trim()
    .replace(/^\/+|\/+$/g, "")
}

function cleanEpisodeTitle(fileName) {
  const withoutExtension = fileName.replace(/\.(mp4|mkv|webm)$/i, "")
  const withoutTracking = withoutExtension
    .replace(/_\d{9,}_\d{3}$/i, "")
    .replace(/^\d{1,2}[_-]+/i, "")
    .replace(/^no[-_ ]*title[_-]*/i, "")

  const normalized = withoutTracking
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  return normalized || "Untitled Stream"
}

function parseModifiedAt(value) {
  const normalized = (value || "").trim().replace(" ", "T")
  const withTimezone = normalized.endsWith("Z") ? normalized : `${normalized}Z`
  const parsed = new Date(withTimezone)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString()
  }

  return null
}

async function fetchLinkTitlesFromPage(url) {
  try {
    const res = await fetchWithRetry(url)
    const html = await res.text()
    const $ = cheerio.load(html)
    const links = new Set()

    $('a').each((i, el) => {
      const title = sanitizeDirectoryName($(el).attr('title'))
      const href = ($(el).attr('href') || "").trim()
      const text = sanitizeDirectoryName($(el).text())

      if (title && /^[a-z]{3}_\d{4}$/i.test(title)) {
        links.add(title)
        return
      }

      if (href && href !== "../" && !href.startsWith("?")) {
        const hrefNoQuery = href.split("?")[0].split("#")[0]
        const hrefName = sanitizeDirectoryName(hrefNoQuery.split('/').filter(Boolean).pop())
        if (hrefName) {
          links.add(hrefName)
          return
        }
      }

      if (text && /^[a-z]{3}_\d{4}$/i.test(text)) {
        links.add(text)
      }
    })

    return Array.from(links)
  } catch (err) {
    console.error(`Failed fetching month links from ${url}:`, err.message)
    return []
  }
}

async function fetchVideoUrlsFromPage(url) {
  try {
    const res = await fetchWithRetry(url)
    const html = await res.text()
    const $ = cheerio.load(html)
    const videos = []
    const thumbnailByBaseName = {}

    $('tr').each((i, tr) => {
      const anchor = $(tr).find('a').first()
      const href = (anchor.attr('href') || "").trim()
      if (!href) {
        return
      }

      const hrefNoQuery = href.split("?")[0].split("#")[0]
      if (!hrefNoQuery) {
        return
      }

      const fileName = decodeURIComponent(hrefNoQuery.split('/').pop())
      if (/\.(jpg|jpeg|png|webp)$/i.test(fileName)) {
        try {
          const absoluteUrl = new URL(href, url).href
          const baseName = fileName.replace(/\.(jpg|jpeg|png|webp)$/i, "")
          thumbnailByBaseName[baseName] = absoluteUrl
        } catch (err) {
          // Ignore malformed href values and continue scraping.
        }
      }
    })

    $('tr').each((i, tr) => {
      const anchor = $(tr).find('a').first()
      const href = (anchor.attr('href') || "").trim()
      if (!href) {
        return
      }

      const hrefNoQuery = href.split("?")[0].split("#")[0]
      if (!/\.(mp4|mkv|webm)$/i.test(hrefNoQuery)) {
        return
      }

      try {
        const absoluteUrl = new URL(href, url).href
        const fileName = decodeURIComponent(hrefNoQuery.split('/').pop())
        const baseName = fileName.replace(/\.(mp4|mkv|webm)$/i, "")
        const modifiedText = $(tr).find('td').eq(1).text()

        videos.push({
          url: absoluteUrl,
          title: fileName,
          displayTitle: cleanEpisodeTitle(fileName),
          modifiedAt: parseModifiedAt(modifiedText),
          thumbnail: thumbnailByBaseName[baseName] || null
        })
      } catch (err) {
        // Ignore malformed href values and continue scraping.
      }
    })

    return videos
  } catch (err) {
    console.error(`Failed fetching videos from ${url}:`, err.message)
    return []
  }
}

module.exports = {
  cleanEpisodeTitle,
  fetchLinkTitlesFromPage,
  fetchVideoUrlsFromPage,
  fetchWithRetry
};
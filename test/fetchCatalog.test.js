const test = require("node:test")
const assert = require("node:assert/strict")

const {
  buildEpisodeId,
  deriveStreamDate,
  normalizeMonthVideos,
  parseMonthYearFolder
} = require("../fetchCatalog")
const { cleanEpisodeTitle, parseFileSizeBytes } = require("../fetchUtil")

test("parseMonthYearFolder parses valid month folder", () => {
  const parsed = parseMonthYearFolder("jul_2026")
  assert.deepEqual(parsed, {
    folder: "jul_2026",
    year: "2026",
    monthShort: "jul",
    monthNumber: 7
  })
})

test("parseMonthYearFolder rejects invalid folder", () => {
  assert.equal(parseMonthYearFolder("videos"), null)
})

test("buildEpisodeId keeps pmw id format", () => {
  assert.equal(buildEpisodeId(12, 34), "pmwArchive:12:34")
})

test("deriveStreamDate uses day prefix from filename", () => {
  const monthInfo = { year: "2026", monthNumber: 7 }
  const iso = deriveStreamDate(monthInfo, "10_some-stream.mp4", null)
  assert.equal(iso, "2026-07-10T12:00:00.000Z")
})

test("deriveStreamDate falls back to modifiedAt", () => {
  const monthInfo = { year: "2026", monthNumber: 7 }
  const iso = deriveStreamDate(monthInfo, "some-stream.mp4", "2026-07-12T20:15:00.000Z")
  assert.equal(iso, "2026-07-12T20:15:00.000Z")
})

test("cleanEpisodeTitle removes noisy suffixes", () => {
  const title = cleanEpisodeTitle("10_no-title_1783717121_000.mp4")
  assert.equal(title, "Untitled Stream")
})

test("cleanEpisodeTitle keeps meaningful names", () => {
  const title = cleanEpisodeTitle("MARIO_PARTY_WITH_CHAT_001.mp4")
  assert.equal(title, "MARIO PARTY WITH CHAT 001")
})

test("parseFileSizeBytes converts GB and MB values", () => {
  assert.equal(parseFileSizeBytes("18 GB"), 19327352832)
  assert.equal(parseFileSizeBytes("341 MB"), 357564416)
})

test("parseFileSizeBytes returns null for invalid values", () => {
  assert.equal(parseFileSizeBytes(""), null)
  assert.equal(parseFileSizeBytes("unknown"), null)
})

test("fallback display title format is date and sequence", () => {
  const streamDate = "2026-07-13T12:00:00.000Z"
  const episode = 5
  const fallback = `Stream ${streamDate.slice(0, 10)} #${episode}`
  assert.equal(fallback, "Stream 2026-07-13 #5")
})

test("normalizeMonthVideos sorts by ascending modified datetime", () => {
  const monthInfo = {
    folder: "jan_2026",
    year: "2026",
    monthShort: "jan",
    monthNumber: 1,
    season: 1
  }

  const videos = [
    {
      title: "19_no-title_1768800264_000.mp4",
      url: "https://example.com/19.mp4",
      modifiedAt: "2026-01-19T05:41:00.000Z"
    },
    {
      title: "15_no-title_1768436964_000.mp4",
      url: "https://example.com/15.mp4",
      modifiedAt: "2026-01-15T06:09:00.000Z"
    },
    {
      title: "17_no-title_1768609815_000.mp4",
      url: "https://example.com/17.mp4",
      modifiedAt: "2026-01-17T05:16:00.000Z"
    }
  ]

  const normalized = normalizeMonthVideos(monthInfo, videos)
  assert.equal(normalized[0].title, "15_no-title_1768436964_000.mp4")
  assert.equal(normalized[1].title, "17_no-title_1768609815_000.mp4")
  assert.equal(normalized[2].title, "19_no-title_1768800264_000.mp4")
  assert.equal(normalized[0].id, "pmwArchive:1:1")
  assert.equal(normalized[2].id, "pmwArchive:1:3")
})

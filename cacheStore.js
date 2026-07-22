const fs = require("node:fs")
const path = require("node:path")

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null
    }

    const raw = fs.readFileSync(filePath, "utf8")
    return JSON.parse(raw)
  } catch (err) {
    console.error("Failed reading cache file:", filePath, err.message)
    return null
  }
}

function writeJson(filePath, value) {
  try {
    ensureDir(path.dirname(filePath))
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8")
  } catch (err) {
    console.error("Failed writing cache file:", filePath, err.message)
  }
}

function isExpired(updatedAt, ttlMs) {
  if (!updatedAt) {
    return true
  }

  const updatedTime = new Date(updatedAt).getTime()
  if (!Number.isFinite(updatedTime)) {
    return true
  }

  return Date.now() - updatedTime > ttlMs
}

module.exports = {
  ensureDir,
  readJson,
  writeJson,
  isExpired
}

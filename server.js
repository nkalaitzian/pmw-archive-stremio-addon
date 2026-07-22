#!/usr/bin/env node

const http = require("node:http")
const { serveHTTP, publishToCentral } = require("stremio-addon-sdk")
const { PMW_CONFIG } = require("./config")
const addonInterface = require("./addon")
serveHTTP(addonInterface, { port: process.env.PORT || 7000 }).catch((err) => {
  console.error(err)
})

if (PMW_CONFIG.diagnostics.enabled) {
  http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }))
      return
    }

    if (req.url === "/diagnostics") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(addonInterface.getDiagnosticsSnapshot(), null, 2))
      return
    }

    res.writeHead(404, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Not found" }))
  }).listen(PMW_CONFIG.diagnostics.port, () => {
    console.log(`PMW diagnostics available at: http://127.0.0.1:${PMW_CONFIG.diagnostics.port}/diagnostics`)
  })
}

// when you've deployed your addon, un-comment this line
// publishToCentral("https://my-addon.awesome/manifest.json")
// publishToCentral("http://127.0.0.1:5000/manifest.json")
// publishToCentral(`http://127.0.0.1:${process.env.PORT}/manifest.json`)
if (PMW_CONFIG.publish.enabled) {
  publishToCentral("https://d0d76533837f-pmw-archive-stremio-addon.baby-beamup.club/manifest.json").catch((err) => {
    console.error("publishToCentral failed:", err)
  })
}
// for more information on deploying, see: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/deploying/README.md

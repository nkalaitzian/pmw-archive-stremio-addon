#!/usr/bin/env node

const { serveHTTP, publishToCentral } = require("stremio-addon-sdk")
const addonInterface = require("./addon")
serveHTTP(addonInterface, { port: process.env.PORT || 7000 })

// when you've deployed your addon, un-comment this line
// publishToCentral("https://my-addon.awesome/manifest.json")
// publishToCentral("http://127.0.0.1:5000/manifest.json")
// publishToCentral(`http://127.0.0.1:${process.env.PORT}/manifest.json`)
// publishToCentral("https://d0d76533837f-pmw-archive-stremio-addon.baby-beamup.club/manifest.json")
// for more information on deploying, see: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/deploying/README.md

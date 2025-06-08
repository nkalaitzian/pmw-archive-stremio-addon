#!/usr/bin/env node

const { serveHTTP, publishToCentral } = require("stremio-addon-sdk")
const addonInterface = require("./addon")
serveHTTP(addonInterface, { port: process.env.PORT || 7000 })

// when you've deployed your addon, un-comment this line
publishToCentral("http://127.0.0.1:7000/manifest.json")
// for more information on deploying, see: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/deploying/README.md

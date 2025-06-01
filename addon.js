const { addonBuilder } = require("stremio-addon-sdk")

// Docs: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md
const manifest = {
	"id": "community.PMW",
	"version": "0.0.1",
	"catalogs": [],
	"resources": [
		"stream"
	],
	"types": [
		"tv"
	],
	"name": "PMW Stream Archive",
	"description": "A Stremio extension to stream content from archive.wubby.tv"
}
const builder = new addonBuilder(manifest)

builder.defineStreamHandler(({type, id}) => {
	console.log("request for streams: "+type+" "+id)
	// Docs: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineStreamHandler.md
	// return no streams
	return Promise.resolve({ streams: [] })
})

module.exports = builder.getInterface()
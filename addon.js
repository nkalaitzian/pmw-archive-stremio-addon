const { addonBuilder } = require("stremio-addon-sdk")
const { fetchCatalog, fetchMonths } = require('./fetchCatalog.js')
const util = require('util')
const fs = require('node:fs');

// Docs: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md
const years = ['2023', '2024', '2025', '2026'];
const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const months_filter = [];
years.forEach(year => {
	months.forEach(month => {
		months_filter.push(`${month}_${year}`);
	});
});
const manifest = {
	id: "community.PMW",
	version: "0.1.0",

	name: "PMW Stream Archive",
	description: "A Stremio extension to watch PaymoneyWubby's archived streams from archive.wubby.tv",

	catalogs: [{ type: "movie", id: "pmwArchive", name: "PMW Archive", extra: [{name: 'genre', 'options': months_filter}] }],
	resources: [
    "catalog",
    "stream",
		{ name: "meta", types: ["movie"], idPrefixes: ["pmwArchive"] }
	],
	types: ["movie"],
	icon: "https://i.redd.it/gdjrfcewm9o21.jpg",
	
}

// var dataset = {
//   'pmwArchive:1:1': {
//     title: 'almostended.mp4',
//     url: 'https://archive.wubby.tv/vods/public/other/almostended.mp4',
//     month: 'other',
//     season: 1,
//     episode: 2
//   }
// };
Promise.resolve(fetchCatalog()).then((data) => {
	dataset = data
});
const builder = new addonBuilder(manifest)

builder.defineCatalogHandler(async ({type, id, extra}) => {
	console.log("request for catalogs: "+type+" "+id+" extra: " + JSON.stringify(extra));
	// console.log("dataset: " + dataset);
	// console.log(util.inspect(dataset, { depth: 10, colors: true }));
	// Docs: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineCatalogHandler.md
	if (id === 'pmwArchive' && type === 'movie') {
		metas = [];
		Object.entries(dataset)
		.filter(([_, value]) => Object.keys(extra).length === 0 || value.month === extra['genre'])
		.map(([key, value]) => {
			metas.push({
				id: key,
				type: type,
				name: value.title.split(' - ')[0],
				description: value.month + " " + value.title,
				poster: 'https://i.redd.it/gdjrfcewm9o21.jpg',
				posterShape: 'square',
				background: 'https://i.redd.it/gdjrfcewm9o21.jpg',
			})
		})
		// console.log("returning metas: " + metas.length);
		// console.log("returning videos: " + metas[0].videos.length);
		// console.log(util.inspect(metas, { depth: 10, colors: true }))
		return Promise.resolve({ metas: metas })
	} else {
		return Promise.resolve({ metas: [] })
	}
})

builder.defineMetaHandler(({type, id}) => {
	console.log("request for metas: "+type+" "+id);
	// Docs: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineMetaHandler.md
	const meta = {
		id: id,
		type: type,
		name: dataset[id].title.split(' - ')[0],
		description: dataset[id].month + " " + dataset[id].title,
		poster: 'https://i.redd.it/gdjrfcewm9o21.jpg',
		posterShape: 'square',
		background: 'https://i.redd.it/gdjrfcewm9o21.jpg',
	}
	return Promise.resolve({ meta: meta })
});

builder.defineStreamHandler(({type, id}) => {
	console.log("request for streams: "+type+" "+id);
	// writeDatasetToFile()
	var streams = [];
	if (/\w+:\d+:\d+/.test(id)) {
		// console.log(`Found stream: ${dataset[id].url}`)
		streams.push({
			url: dataset[id].url,
			title: dataset[id].title
		})
	}
	return Promise.resolve({ streams: streams })
});

function writeDatasetToFile() {
	console.log("Writing dataset to file...");
	fs.writeFile('./dataset.txt', util.inspect(dataset, { depth: 10, colors: false }), 'utf8', err => {
		if (err) {
			console.error(err);
		} else {
			// file written successfully
		}
	});
}

module.exports = builder.getInterface()

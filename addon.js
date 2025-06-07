const { addonBuilder } = require("stremio-addon-sdk")
const { fetchCatalog, fetchMonths } = require('./fetchCatalog.js')
const util = require('util')
const fs = require('node:fs');

// Docs: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md
const months = ["apr_2023", "sep_2023", "oct_2023", "aug_2023", "nov_2023", "dec_2023", "may_2023", "feb_2023", "mar_2023", "jun_2023", "jan_2023", "jul_2023", "dec_2024", "jan_2024", "jul_2024", "apr_2024", "jun_2024", "oct_2024", "feb_2024", "mar_2024", "nov_2024", "sep_2024", "may_2024", "aug_2024", "mar_2025", "apr_2025", "jun_2025", "jan_2025", "feb_2025", "may_2025", "other"];
const manifest = {
	id: "community.PMW",
	version: "0.0.3",

	name: "PMW Stream Archive",
	description: "A Stremio extension to watch PaymoneyWubby's archived streams from archive.wubby.tv",

	catalogs: [{ type: "movie", id: "pmwArchive", name: "PMW Archive", extra: [{name: 'genre', 'options': months}] }],
	resources: [
    "catalog",
    "stream"
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
	console.log("dataset: " + dataset);
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
				// posterShape: 'square'
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

// builder.defineStreamHandler(async (args) => {
// 	const { type, id } = args
// 	console.log("request for streams: "+type+" "+id)
// 	// Docs: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineStreamHandler.md
// 	// return no streams
// 	// if (type !== 'series') {
// 	// 	return Promise.reject(new Error('Invalid type: ' + type))
// 	// }
// 	const streams = await fetchMonthStreams(id);
// 	return Promise.resolve({ streams: streams })
// })

builder.defineStreamHandler(({type, id}) => {
	console.log("request for streams: "+type+" "+id);
	// writeDatasetToFile()
	var streams = [];
	if (/\w+:\d+:\d+/.test(id)) {
		console.log(`Found stream: ${dataset[id].url}`)
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

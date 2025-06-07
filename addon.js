const { addonBuilder } = require("stremio-addon-sdk");
const magnet = require("magnet-uri");

// Docs: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md
const manifest = {
    "id": "community.PMW",
    "version": "0.0.1",
    
    "name": "PMW Stream Archive",
    "description": "A Stremio extension to stream content from archive.wubby.tv",
    
    "resources": [
        "catalog",
        "stream"
    ],
    "catalogs": [
        {
            id: "pmwepisodes",
            type: "movies"
        }
    ],
    "types": [
        "movies"
    ],

    // prefix of item IDs (ie: "tt0032138")
    "idPrefixes": [ "tt" ]
};

const dataset = {
    "pmw:2025:01:10": {
        name: "THE LAST TIME I WILL GET TO WORK - MORE CLIMBING LESS FALLING - IT SHALL BE DONE - WEALTH AND SUCCESS WILL BRING LATINAS GG",
        type: "movie",
        externalUrl: "https://archive.wubby.tv/vods/public/jan_2025/10_THE%20LAST%20TIME%20I%20WILL%20GET%20TO%20WORK%20-%20MORE%20CLIMBING%20LESS%20FALLING%20-%20IT%20SHALL%20BE%20DONE%20-%20WEALTH%20AND%20SUCCESS%20WILL%20BRING%20LATINAS%20GG_1736558770_000.mp4"
    }
    // "tt0137523": { name: "Fight Club", type: "movie", externalUrl: "https://www.netflix.com/watch/26004747" }, // redirects to Netflix

    // "tt1748166:1:1": { name: "Pioneer One", type: "series", infoHash: "07a9de9750158471c3302e4e95edb1107f980fa6" }, // torrent for season 1, episode 1
};

// const initDataset = function() {
    
// }

// utility function to add from magnet
function fromMagnet(name, type, uri) {
    const parsed = magnet.decode(uri);
    const infoHash = parsed.infoHash.toLowerCase();
    const tags = [];
    if (uri.match(/720p/i)) tags.push("720p");
    if (uri.match(/1080p/i)) tags.push("1080p");
    return {
        name: name,
        type: type,
        infoHash: infoHash,
        sources: (parsed.announce || []).map(function(x) { return "tracker:"+x }).concat(["dht:"+infoHash]),
        tag: tags,
        title: tags[0], // show quality in the UI
    }
}

const builder = new addonBuilder(manifest);

// Streams handler
builder.defineStreamHandler(function(args) {
    const entry = dataset[args.id];
    if (entry && entry.externalUrl) {
        return Promise.resolve({ streams: [{
            name: entry.name,
            url: entry.externalUrl
        }] });
    } else {
        return Promise.resolve({ streams: [] });
    }
})

const METAHUB_URL = "https://images.metahub.space"

const generateMetaPreview = function(value, key) {
    // To provide basic meta for our movies for the catalog
    // we'll fetch the poster from Stremio's MetaHub
    // see https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/meta.md#meta-preview-object
    const imdbId = key.split(":")[0]
    return {
        id: imdbId,
        type: value.type,
        name: value.name,
        poster: "https://i.redd.it/gdjrfcewm9o21.jpg",
    }
}

builder.defineCatalogHandler(function(args, cb) {
    // filter the dataset object and only take the requested type
    // initDataset()
    const metas = Object.entries(dataset)
    .filter(([_, value]) => value.type === args.type)
    .map(([key, value]) => generateMetaPreview(value, key))

    return Promise.resolve({ metas: metas })
})

module.exports = builder.getInterface()
const { fetchLinkTitlesFromPage, fetchVideoUrlsFromPage } = require('./fetchUtil.js')

const baseUrl = "https://archive.wubby.tv/vods/public/"

async function fetchCatalog() {
  const catalog = {};

  var months = await fetchMonths()
  var season = 1;
  months.forEach(async month => {
    // console.log(`Fetching videos for month: ${month}`);
    const monthUrl = baseUrl + month + '/';
    var videoURLs = await fetchVideoUrlsFromPage(monthUrl, month);
    var episode = 1;
    // console.log(`Found ${videoURLs.length} videos for month: ${month}`);
    videoURLs.forEach((obj, title) => {
      catalog[`pmwArchive:${season}:${episode++}`] = {
        title: obj.title,
        url: obj.url,
        month: month
      };
    })
    season++;
  })
  return catalog;
}

async function fetchMonths() {  
  return await fetchLinkTitlesFromPage(baseUrl);
}

module.exports = {fetchCatalog, fetchMonths};
const fetch = require('node-fetch')
const cheerio = require('cheerio')

async function fetchLinkTitlesFromPage(url) {
  const res = await fetch(url);
  const html = await res.text();
  const $ = cheerio.load(html);
  const links = [];
  $('a').each((i, el) => {
    const href = $(el).attr('title');
    if (href) {
      links.push(href);
    }
  });
  return links;
}

async function fetchVideoUrlsFromPage(url) {
  const res = await fetch(url);
  const html = await res.text();
  const $ = cheerio.load(html);
  const videos = [];
  $('a').each((i, el) => {
    const href = $(el).attr('href');
    if (href && href.match(/\.(mp4|mkv|webm)$/i)) {
      videos.push({url: url + href, title: decodeURIComponent(href)});
    }
  });
  return videos;
}

module.exports = {
  fetchLinkTitlesFromPage,
  fetchVideoUrlsFromPage
};
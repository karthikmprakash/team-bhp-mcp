'use strict';

const cheerio = require('cheerio');
const { BASE_URL } = require('../config/constants.js');

function parseCarListing(html) {
  const $ = cheerio.load(html);
  const cars = [];
  const seen = new Set();
  $('a[href*="/new-cars/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    // Model URLs look like /new-cars/{brand}/{model}/
    const m = href.match(/\/new-cars\/([\w-]+)\/([\w-]+)\/?$/);
    if (
      m &&
      !href.includes('search-by') &&
      !href.includes('compare') &&
      text &&
      text.length > 1 &&
      !seen.has(href)
    ) {
      seen.add(href);
      cars.push({
        name: text,
        brand: m[1],
        model: m[2],
        url: href.startsWith('http') ? href : BASE_URL + href,
      });
    }
  });
  return cars;
}

module.exports = {
  parseCarListing,
};

'use strict';

const cheerio = require('cheerio');
const { BASE_URL } = require('../config/constants.js');

function parseSearchUser(html, username) {
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();
  $('[id^="thread_title_"]').each((_, el) => {
    const title = $(el).text().trim();
    const href = $(el).attr('href') || '';
    if (title && !seen.has(href)) {
      seen.add(href);
      results.push({ title, url: href.startsWith('http') ? href : BASE_URL + href });
    }
  });
  return { username, result_count: results.length, threads: results };
}

function parseSearchResults(html, query) {
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  // vBulletin search results
  $('[id^="thread_title_"], .thread_title_link').each((_, el) => {
    const title = $(el).text().trim();
    const href = $(el).attr('href') || '';
    if (title && href && !seen.has(href)) {
      seen.add(href);
      const url = href.startsWith('http') ? href : BASE_URL + href;
      const row = $(el).closest('tr');
      const forum = row.find('a[href*="/forum/"][href$="/"]').first().text().trim();
      const lastPost = row.find('td').eq(2).text().trim();
      results.push({ title, url, forum, last_post: lastPost });
    }
  });

  // Alternative: look for search result links
  if (results.length === 0) {
    $('a[href*="/forum/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim();
      if (
        href.match(/\/forum\/[\w-]+\/\d+/) &&
        text &&
        text.length > 5 &&
        !seen.has(href)
      ) {
        seen.add(href);
        results.push({ title: text, url: href.startsWith('http') ? href : BASE_URL + href });
      }
    });
  }

  return { query, result_count: results.length, results };
}

module.exports = {
  parseSearchUser,
  parseSearchResults,
};

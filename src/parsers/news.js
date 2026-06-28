'use strict';

const cheerio = require('cheerio');
const { BASE_URL } = require('../config/constants.js');

function parseNewsList(html) {
  const $ = cheerio.load(html);
  const articles = [];
  const seen = new Set();

  $('h2 a, h3 a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const title = $(el).text().trim();
    if (href.startsWith('/news/') && title && !seen.has(href)) {
      seen.add(href);
      const url = BASE_URL + href;
      // Try to get excerpt from parent container
      const parent = $(el).closest('article, .views-row, li, div.field');
      const excerpt = parent.find('p, .field--type-text-with-summary').first().text().trim();
      const date = parent.find('time, .datetime').first().text().trim();

      articles.push({
        title,
        url,
        slug: href.replace('/news/', '').replace(/\?.*/, ''),
        date: date || null,
        excerpt: excerpt || null,
      });
    }
  });

  return { article_count: articles.length, articles };
}

function parseNewsArticle(html, articleUrl) {
  const $ = cheerio.load(html);
  const title = $('h1').first().text().trim();

  // ".postDate" holds e.g. "24th June 2026, 17:15 by Utkarsh Chaudhary"
  const postDateRaw = $('.postDate').first().text().replace(/\s+/g, ' ').trim();
  const byMatch = postDateRaw.match(/^(.*?)\s+by\s+(.+)$/i);
  const date = byMatch ? byMatch[1].trim() : postDateRaw || null;
  const author = byMatch ? byMatch[2].trim() : null;

  // Article body lives in ".desc" paragraph blocks
  const paragraphs = [];
  $('.desc').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t && t.length > 1) paragraphs.push(t);
  });
  // Fallback: substantial <p> tags
  if (paragraphs.length === 0) {
    $('p').each((_, el) => {
      const t = $(el).text().trim();
      if (t.length > 60) paragraphs.push(t);
    });
  }
  const content = paragraphs.join('\n\n');

  // Tags
  const tags = [];
  $('[class*="tag"] a, .tags a').each((_, el) => {
    const t = $(el).text().trim();
    if (t && !tags.includes(t)) tags.push(t);
  });

  // First content image (skip logos/UI)
  let imageUrl = null;
  $('.desc img, #content img').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (src && /\/sites\/default\/files\//.test(src)) {
      imageUrl = src.startsWith('http') ? src : BASE_URL + src;
      return false;
    }
  });

  return {
    title,
    url: articleUrl,
    date,
    author,
    tags,
    content,
    image_url: imageUrl,
  };
}

module.exports = {
  parseNewsList,
  parseNewsArticle,
};

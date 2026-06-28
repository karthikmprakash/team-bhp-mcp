'use strict';

const { z } = require('zod');
const { BASE_URL } = require('../config/constants.js');
const { toolResult } = require('../app/tool-result.js');
const { withCache } = require('../infra/cache.js');
const { fetchPage } = require('../infra/fetch.js');
const { parseNewsList, parseNewsArticle } = require('../parsers/news.js');

function registerGetNewsListingTool(server) {
  server.tool(
    'get_news_listing',
    'Get the latest news articles from Team-BHP',
    {
      page: z.number().optional().default(1).describe('Page number (default: 1)'),
    },
    async ({ page }) => {
      let url = `${BASE_URL}/news`;
      if (page > 1) url += `?page=${page - 1}`;
      return toolResult(
        await withCache(`news_listing:${page}`, 120_000, async () =>
          parseNewsList(await fetchPage(url, { waitFor: 'h2 a[href^="/news/"]' }))
        )
      );
    }
  );
}

function registerGetNewsArticleTool(server) {
  server.tool(
    'get_news_article',
    'Get the full content of a Team-BHP news article',
    {
      url: z
        .string()
        .describe(
          'Article URL or slug (e.g. "/news/bmw-launches-x3" or full URL)'
        ),
    },
    async ({ url }) => {
      const articleUrl = url.startsWith('http')
        ? url
        : url.startsWith('/news/')
        ? `${BASE_URL}${url}`
        : `${BASE_URL}/news/${url}`;
      return toolResult(
        await withCache(`news_article:${articleUrl}`, 600_000, async () =>
          parseNewsArticle(await fetchPage(articleUrl, { waitFor: '.desc' }), articleUrl)
        )
      );
    }
  );
}

module.exports = {
  registerGetNewsListingTool,
  registerGetNewsArticleTool,
};

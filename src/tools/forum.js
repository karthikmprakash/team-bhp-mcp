'use strict';

const { z } = require('zod');
const { BASE_URL, FORUM_URL } = require('../config/constants.js');
const { toolResult } = require('../app/tool-result.js');
const { withCache } = require('../infra/cache.js');
const { fetchPage } = require('../infra/fetch.js');
const { parseSearchResults } = require('../parsers/search.js');
const {
  parseForumIndex,
  parseForumCategory,
  parseThread,
  parseHotThreads,
  parseTopThanked,
  parseCarReviews,
} = require('../parsers/forum.js');

function registerGetForumIndexTool(server) {
  server.tool(
    'get_forum_index',
    'Get the Team-BHP forum index with all categories and sections',
    {},
    async () =>
      toolResult(
        await withCache('forum_index', 300_000, async () =>
          parseForumIndex(await fetchPage(`${FORUM_URL}/`, { waitFor: 'td.alt1Active' }))
        )
      )
  );
}

function registerGetForumCategoryTool(server) {
  server.tool(
    'get_forum_category',
    'Get threads in a Team-BHP forum category. Use the category slug (e.g. "road-safety", "indian-car-scene") or full URL.',
    {
      category: z
        .string()
        .describe(
          'Category slug (e.g. "road-safety") or full URL (e.g. "https://www.team-bhp.com/forum/road-safety/")'
        ),
      page: z.number().optional().default(1).describe('Page number (default: 1)'),
      sort: z
        .enum(['dateline', 'lastpost', 'title', 'replycount', 'views'])
        .optional()
        .default('lastpost')
        .describe('Sort order'),
    },
    async ({ category, page, sort }) => {
      let url;
      if (category.startsWith('http')) {
        url = category;
      } else {
        url = `${FORUM_URL}/${category}/`;
      }
      if (page > 1) url += `?page=${page}`;
      if (sort) url += `${url.includes('?') ? '&' : '?'}sort=${sort}&order=desc`;

      return toolResult(
        await withCache(`category:${url}`, 60_000, async () =>
          parseForumCategory(await fetchPage(url, { waitFor: '[id^="thread_title_"]' }), url)
        )
      );
    }
  );
}

function registerGetThreadTool(server) {
  server.tool(
    'get_thread',
    'Get posts from a Team-BHP forum thread. Provide the thread URL or thread ID.',
    {
      url: z
        .string()
        .describe(
          'Thread URL (e.g. "https://www.team-bhp.com/forum/road-safety/123-thread-title.html") or just the thread ID'
        ),
      page: z.number().optional().default(1).describe('Page number (default: 1)'),
    },
    async ({ url, page }) => {
      let threadUrl = url;
      if (!threadUrl.startsWith('http')) {
        // Treat as thread ID
        threadUrl = `${FORUM_URL}/showthread.php?t=${url}`;
      }
      if (page > 1) {
        threadUrl += `${threadUrl.includes('?') ? '&' : '?'}page=${page}`;
      }

      return toolResult(
        await withCache(`thread:${threadUrl}`, 120_000, async () =>
          parseThread(await fetchPage(threadUrl, { waitFor: '[id^="post_message_"]' }), threadUrl)
        )
      );
    }
  );
}

function registerGetHotThreadsTool(server) {
  server.tool(
    'get_hot_threads',
    'Get the current hot/trending threads on Team-BHP',
    {},
    async () =>
      toolResult(
        await withCache('hot_threads', 60_000, async () =>
          parseHotThreads(await fetchPage(`${BASE_URL}/hot-threads`, { waitFor: '.node' }))
        )
      )
  );
}

function registerGetCarReviewsTool(server) {
  server.tool(
    'get_car_reviews',
    'Get Team-BHP official new car reviews (sorted by latest)',
    {
      page: z.number().optional().default(1).describe('Page number (default: 1)'),
    },
    async ({ page }) => {
      let url = `${FORUM_URL}/official-new-car-reviews/?pp=25&sort=dateline&order=desc&daysprune=-1`;
      if (page > 1) url += `&page=${page}`;
      return toolResult(
        await withCache(`car_reviews:${page}`, 120_000, async () =>
          parseCarReviews(await fetchPage(url, { waitFor: '[id^="thread_title_"]' }))
        )
      );
    }
  );
}

function registerGetNewThreadsTool(server) {
  server.tool(
    'get_new_threads',
    'Get the latest new threads posted across all Team-BHP forums (last 3 days)',
    {
      days: z
        .number()
        .optional()
        .default(3)
        .describe('Number of days to look back (default: 3, max: 7)'),
    },
    async ({ days }) => {
      const d = Math.min(days, 7);
      const url = `${FORUM_URL}/search.php?do=getdaily&days=${d}&tim=thread`;
      return toolResult(
        await withCache(`new_threads:${d}`, 60_000, async () =>
          parseSearchResults(await fetchPage(url), `new threads (last ${d} days)`)
        )
      );
    }
  );
}

function registerGetNewPostsTool(server) {
  server.tool(
    'get_new_posts',
    'Get threads with new posts on Team-BHP (last 7 days)',
    {},
    async () => {
      const url = `${FORUM_URL}/search.php?do=getdaily&days=7`;
      return toolResult(
        await withCache('new_posts', 60_000, async () =>
          parseSearchResults(await fetchPage(url), 'threads with new posts (last 7 days)')
        )
      );
    }
  );
}

function registerGetTopThankedTool(server) {
  server.tool(
    'get_top_thanked',
    'Get the most-thanked / most popular posts and threads on Team-BHP (community "best of")',
    {},
    async () =>
      toolResult(
        await withCache('top_thanked', 300_000, async () =>
          parseTopThanked(await fetchPage(`${FORUM_URL}/thanks_analytics.php`))
        )
      )
  );
}

module.exports = {
  registerGetForumIndexTool,
  registerGetForumCategoryTool,
  registerGetThreadTool,
  registerGetHotThreadsTool,
  registerGetCarReviewsTool,
  registerGetNewThreadsTool,
  registerGetNewPostsTool,
  registerGetTopThankedTool,
};

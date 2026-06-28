'use strict';

const { z } = require('zod');
const { FORUM_URL } = require('../config/constants.js');
const { toolResult } = require('../app/tool-result.js');
const { withCache } = require('../infra/cache.js');
const { fetchPage } = require('../infra/fetch.js');
const { parseSearchUser, parseSearchResults } = require('../parsers/search.js');

function registerSearchForumTool(server) {
  server.tool(
    'search_forum',
    'Search Team-BHP forum for threads and posts',
    {
      query: z.string().describe('Search query'),
      type: z
        .enum(['threads', 'posts'])
        .optional()
        .default('threads')
        .describe('Search type: threads or posts'),
      days: z
        .number()
        .optional()
        .describe('Limit results to last N days (e.g. 30)'),
      category: z.string().optional().describe('Limit search to a specific forum category slug'),
    },
    async ({ query, type, days, category }) => {
      let url = `${FORUM_URL}/search.php?do=process&searchuser=&exactname=1&query=${encodeURIComponent(query)}&titlesonly=0&searchthreadid=&forumchoice%5B%5D=0&childforums=1&saveprefs=1&starteronly=0&replyless=0&replylimit=0&searchdate=0&beforeafter=after&sortby=lastpost&order=descending&showposts=${type === 'posts' ? 1 : 0}&search_type=0&submit=Search+Now`;

      if (days) {
        const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
        url += `&searchdate=${cutoff}`;
      }
      if (category) {
        // Try to find the forum ID via the category URL first, fallback to direct URL append
        url += `&forumchoice=${encodeURIComponent(category)}`;
      }

      // Fallback wait (not waitForSelector): a search can legitimately return
      // zero results, and waiting on a never-appearing selector would hang.
      return toolResult(
        await withCache(`search:${query}:${type}:${days || ''}:${category || ''}`, 60_000, async () =>
          parseSearchResults(await fetchPage(url), query)
        )
      );
    }
  );
}

function registerGetUserActivityTool(server) {
  server.tool(
    'get_user_activity',
    'Get a Team-BHP forum member\'s recent threads/posts via public search. (Full member profile pages require login and are not accessible; this is the public alternative.)',
    {
      username: z.string().describe('Forum username, e.g. "GTO"'),
      starter_only: z
        .boolean()
        .optional()
        .default(false)
        .describe('If true, only threads started by the user; otherwise all posts'),
    },
    async ({ username, starter_only }) => {
      const url = `${FORUM_URL}/search.php?do=process&searchuser=${encodeURIComponent(
        username
      )}&starteronly=${starter_only ? 1 : 0}&showposts=0&submit=Search+Now`;
      return toolResult(
        await withCache(`user_activity:${username}:${starter_only}`, 120_000, async () =>
          parseSearchUser(await fetchPage(url), username)
        )
      );
    }
  );
}

module.exports = {
  registerSearchForumTool,
  registerGetUserActivityTool,
};

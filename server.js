#!/usr/bin/env node
'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { chromium } = require('playwright');
const cheerio = require('cheerio');

const BASE_URL = 'https://www.team-bhp.com';
const FORUM_URL = `${BASE_URL}/forum`;

// Browser pool — keep one browser instance alive for performance
let _browser = null;
async function getBrowser() {
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({ headless: true });
  }
  return _browser;
}

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Heavy resource types we never need for parsing the HTML/data.
const BLOCKED_TYPES = new Set(['image', 'media', 'font']);
// Ad / analytics / tracker hosts — pure dead weight. (We keep first-party
// team-bhp.com scripts since Cloudflare and the New Car Finder app need them.)
const BLOCKED_HOSTS = [
  'doubleclick.net', 'googlesyndication.com', 'google-analytics.com',
  'googletagmanager.com', 'googletagservices.com', 'adservice.google',
  'facebook.net', 'facebook.com', 'connect.facebook', 'twitter.com',
  'scorecardresearch.com', 'quantserve.com', 'amazon-adsystem.com',
  'adnxs.com', 'criteo', 'taboola', 'outbrain', 'pubmatic', 'rubiconproject',
  'casalemedia', 'openx', 'cloudflareinsights.com', 'hotjar', 'mixpanel',
];

// Block heavy/irrelevant requests to cut bandwidth ~90% and speed calls up.
async function applyResourceBlocking(context) {
  await context.route('**/*', (route) => {
    const req = route.request();
    const url = req.url();
    if (BLOCKED_TYPES.has(req.resourceType())) return route.abort();
    if (BLOCKED_HOSTS.some((h) => url.includes(h))) return route.abort();
    return route.continue();
  });
}

// Smart-wait fetch: instead of a flat sleep, return as soon as `waitFor`
// (a CSS selector for the content we actually parse) appears in the DOM.
// Falls back to a short fixed wait if no selector is given or it times out.
async function fetchPage(url, { waitFor = null, fallbackMs = 700 } = {}) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    },
  });
  await applyResourceBlocking(context);
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (waitFor) {
      // Resolves the instant the element exists; ceiling guards slow loads.
      await page.waitForSelector(waitFor, { timeout: 8000 }).catch(() => {});
    } else {
      await page.waitForTimeout(fallbackMs);
    }
    return await page.content();
  } finally {
    await context.close();
  }
}

// For JS-rendered pages (the New Car Finder is a client-side app). Returns as
// soon as `waitForFn` (an in-page predicate) is true, instead of a flat sleep.
// Avoids `networkidle` because the ad-heavy pages never reach it.
async function fetchRendered(
  url,
  { waitForFn = null, waitMs = 3500, evaluate = null, timeout = 12000 } = {}
) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });
  await applyResourceBlocking(context);
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (waitForFn) {
      // Polls the predicate; resolves the instant content renders.
      await page.waitForFunction(waitForFn, { timeout }).catch(() => {});
    } else {
      await page.waitForTimeout(waitMs);
    }
    if (evaluate) return await page.evaluate(evaluate);
    return await page.content();
  } finally {
    await context.close();
  }
}

// ─── In-memory TTL cache ──────────────────────────────────────────────────────
// Slow-changing pages (forum index, listings, news, car data) are cached so
// repeat calls skip the browser entirely. Keyed by tool name + args.
const _cache = new Map();
async function withCache(key, ttlMs, producer) {
  const hit = _cache.get(key);
  if (hit && hit.expiry > Date.now()) return hit.value;
  const value = await producer();
  _cache.set(key, { value, expiry: Date.now() + ttlMs });
  return value;
}
function toolResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

// ─── Parsers ────────────────────────────────────────────────────────────────

function parseForumIndex(html) {
  const $ = cheerio.load(html);
  const sections = [];
  let currentSection = null;

  // Walk all rows: td.tcat = section header, td.alt1Active = category row
  $('td.tcat, td.alt1Active').each((_, el) => {
    const cls = $(el).attr('class') || '';

    if (cls.includes('tcat')) {
      const title = $(el).text().trim();
      if (title && title.length < 60) {
        currentSection = { section: title, categories: [] };
        sections.push(currentSection);
      }
      return;
    }

    if (cls.includes('alt1Active')) {
      const link = $(el).find('a').first();
      const href = link.attr('href') || '';
      const title = link.text().trim();
      if (!title || !href.match(/\/forum\/[\w-]+\//)) return;

      const url = href.startsWith('http') ? href : BASE_URL + href;
      const slug = href.replace(/.*\/forum\//, '').replace(/\/$/, '');

      // Viewing count from cell text
      const fullText = $(el).text();
      const viewMatch = fullText.match(/\((\d[\d,]*)\s*Viewing\)/);
      const viewing = viewMatch ? parseInt(viewMatch[1].replace(/,/g, ''), 10) : null;

      // Sub-forums
      const subForums = [];
      $(el).find('a').each((i, subEl) => {
        if (i === 0) return; // skip the main category link
        const subHref = $(subEl).attr('href') || '';
        if (subHref.match(/\/forum\/[\w-]+\//)) {
          subForums.push({
            title: $(subEl).text().trim(),
            url: subHref.startsWith('http') ? subHref : BASE_URL + subHref,
            slug: subHref.replace(/.*\/forum\//, '').replace(/\/$/, ''),
          });
        }
      });

      if (!currentSection) {
        currentSection = { section: 'General', categories: [] };
        sections.push(currentSection);
      }
      currentSection.categories.push({ title, url, slug, viewing, sub_forums: subForums });
    }
  });

  return sections.filter((s) => s.categories.length > 0);
}

function parseForumCategory(html, categoryUrl) {
  const $ = cheerio.load(html);
  const threads = [];

  // Forum category pages use vBulletin-style IDs: #thread_title_{id}
  $('[id^="thread_title_"]').each((_, el) => {
    const threadId = $(el).attr('id').replace('thread_title_', '');
    const title = $(el).text().trim();
    const href = $(el).attr('href') || '';
    const url = href.startsWith('http') ? href : BASE_URL + href;

    const row = $(el).closest('tr');
    const tds = row.find('td');

    // TD 2: last post info, TD 3: replies, TD 4: views
    const lastPostText = tds.eq(2).text().trim();
    const replies = tds.eq(3).text().trim().replace(/,/g, '');
    const views = tds.eq(4).text().trim().replace(/,/g, '');

    // Last post: "23rd June 2026 14:45\n\t\t\tby username"
    const lastPostMatch = lastPostText.match(/^(.+?)\n+\s*by\s+(.+)$/s);
    const lastPostDate = lastPostMatch ? lastPostMatch[1].trim() : lastPostText.split('\n')[0].trim();
    const lastPostBy = lastPostMatch ? lastPostMatch[2].trim() : '';

    // Check if thread is "sticky" / "parked"
    const titleCell = $(`#td_threadtitle_${threadId}`);
    const prefix = titleCell.find('.prefix').text().trim();

    if (title) {
      threads.push({
        id: threadId,
        title,
        url,
        prefix: prefix || null,
        replies: replies ? parseInt(replies, 10) : 0,
        views: views ? parseInt(views, 10) : 0,
        last_post_date: lastPostDate,
        last_post_by: lastPostBy,
      });
    }
  });

  // Pagination
  const nextPage = $('a[rel="next"]').attr('href') || null;
  const prevPage = $('a[rel="prev"]').attr('href') || null;

  return {
    category_url: categoryUrl,
    thread_count: threads.length,
    threads,
    pagination: {
      next: nextPage ? (nextPage.startsWith('http') ? nextPage : BASE_URL + nextPage) : null,
      prev: prevPage ? (prevPage.startsWith('http') ? prevPage : BASE_URL + prevPage) : null,
    },
  };
}

function parseThread(html, threadUrl) {
  const $ = cheerio.load(html);
  const posts = [];

  // Thread title
  const title = $('title').text().replace('- Team-BHP', '').trim();

  // Posts: tables with id="post{number}"
  $('[id^="post_message_"]').each((_, el) => {
    const msgId = $(el).attr('id').replace('post_message_', '');
    const postTable = $(`#post${msgId}`);

    const username = postTable.find('.bigusername, .username').first().text().trim();
    const postDate = postTable.find('.thead').first().text().trim();
    const message = $(el).text().trim();
    const postUrl = `${threadUrl.split('#')[0]}#post${msgId}`;

    // User info
    const userInfo = postTable.find('td.alt2 .smallfont').text().trim();
    const joinDateMatch = userInfo.match(/Join Date: ([^\n]+)/);
    const locationMatch = userInfo.match(/Location: ([^\n]+)/);
    const postsMatch = userInfo.match(/Posts: ([\d,]+)/);

    posts.push({
      id: msgId,
      url: postUrl,
      author: username,
      date: postDate,
      content: message,
      author_info: {
        join_date: joinDateMatch ? joinDateMatch[1].trim() : null,
        location: locationMatch ? locationMatch[1].trim() : null,
        post_count: postsMatch ? postsMatch[1].replace(/,/g, '') : null,
      },
    });
  });

  // Pagination
  const nextPage = $('a[rel="next"]').attr('href') || null;
  const prevPage = $('a[rel="prev"]').attr('href') || null;

  return {
    title,
    url: threadUrl,
    post_count: posts.length,
    posts,
    pagination: {
      next: nextPage ? (nextPage.startsWith('http') ? nextPage : BASE_URL + nextPage) : null,
      prev: prevPage ? (prevPage.startsWith('http') ? prevPage : BASE_URL + prevPage) : null,
    },
  };
}

function parseHotThreads(html) {
  const $ = cheerio.load(html);
  const threads = [];

  // Hot threads are in .hotTrends.latestNews section
  const seen = new Set();
  $('a[href*="team-bhp.com/forum/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    // Only thread URLs (contain category/thread-num pattern)
    if (text && href.match(/\/forum\/[\w-]+\/\d+/) && !seen.has(href)) {
      seen.add(href);
      // Extract category from URL
      const match = href.match(/\/forum\/([\w-]+)\/(\d+)/);
      threads.push({
        title: text,
        url: href,
        category: match ? match[1] : null,
        thread_id: match ? match[2] : null,
      });
    }
  });

  return { thread_count: threads.length, threads };
}

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

function parseTopThanked(html) {
  const $ = cheerio.load(html);
  const items = [];
  // Real thread URLs look like /forum/{cat}/{digits}-{slug}.html.
  // (Member links like /forum/members/400notout.html must be excluded —
  // numeric-prefixed usernames would otherwise false-match a thread regex.)
  const threadRe = /\/forum\/[\w-]+\/\d+-[\w-]+\.html/;
  $('tr').each((_, el) => {
    const link = $(el)
      .find('a')
      .filter((i, a) => {
        const h = $(a).attr('href') || '';
        return threadRe.test(h) && !h.includes('/members/');
      })
      .first();
    if (!link.length) return;

    const title = link.text().trim();
    const href = link.attr('href') || '';
    if (!title || title.length < 5) return;

    // TD layout: [icon] | thanker | count | title | page | forum
    const tds = $(el)
      .find('td')
      .map((i, td) => $(td).text().replace(/\s+/g, ' ').trim())
      .get();
    const countIdx = tds.findIndex((t) => /^\d+$/.test(t));
    const count = countIdx >= 0 ? parseInt(tds[countIdx], 10) : null;
    const thanker = countIdx > 0 ? tds[countIdx - 1] : null;
    const pageText = tds.find((t) => /^Page\s+\d+/.test(t)) || null;
    const forum = tds.length ? tds[tds.length - 1] : null;

    items.push({
      title,
      url: href.startsWith('http') ? href : BASE_URL + href,
      thanks: count,
      thanked_member: thanker || null,
      page: pageText,
      forum: forum && !/^Page\s+\d+/.test(forum) ? forum : null,
    });
  });
  return { count: items.length, threads: items };
}

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

function parseCarReviews(html) {
  const $ = cheerio.load(html);
  const threads = [];
  const seen = new Set();

  $('[id^="thread_title_"]').each((_, el) => {
    const threadId = $(el).attr('id').replace('thread_title_', '');
    const title = $(el).text().trim();
    const href = $(el).attr('href') || '';
    if (title && !seen.has(threadId)) {
      seen.add(threadId);
      const url = href.startsWith('http') ? href : BASE_URL + href;
      const row = $(el).closest('tr');
      const tds = row.find('td');
      const replies = tds.eq(3).text().trim().replace(/,/g, '');
      const views = tds.eq(4).text().trim().replace(/,/g, '');
      threads.push({
        id: threadId,
        title,
        url,
        replies: replies ? parseInt(replies, 10) : 0,
        views: views ? parseInt(views, 10) : 0,
      });
    }
  });

  return { review_count: threads.length, reviews: threads };
}

// ─── MCP Server Setup ────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'team-bhp',
  version: '1.0.0',
});

// ── get_forum_index ──────────────────────────────────────────────────────────
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

// ── get_forum_category ───────────────────────────────────────────────────────
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

// ── get_thread ────────────────────────────────────────────────────────────────
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

// ── get_hot_threads ───────────────────────────────────────────────────────────
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

// ── get_news_listing ──────────────────────────────────────────────────────────
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

// ── get_news_article ──────────────────────────────────────────────────────────
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

// ── search_forum ──────────────────────────────────────────────────────────────
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

// ── get_car_reviews ───────────────────────────────────────────────────────────
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

// ── get_new_threads ───────────────────────────────────────────────────────────
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

// ── get_new_posts ─────────────────────────────────────────────────────────────
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

// ── get_top_thanked ───────────────────────────────────────────────────────────
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

// ── get_new_cars ──────────────────────────────────────────────────────────────
server.tool(
  'get_new_cars',
  'Browse the Team-BHP New Car Finder catalog — all current new cars in India, or upcoming launches.',
  {
    type: z
      .enum(['all', 'upcoming'])
      .optional()
      .default('all')
      .describe('"all" for current cars on sale, "upcoming" for upcoming launches'),
  },
  async ({ type }) => {
    const url =
      type === 'upcoming'
        ? `${BASE_URL}/new-cars/search-by/upcoming-cars/`
        : `${BASE_URL}/new-cars/search-by/all-cars/`;
    return toolResult(
      await withCache(`new_cars:${type}`, 1_800_000, async () => {
        const cars = parseCarListing(await fetchPage(url));
        return { type, car_count: cars.length, cars };
      })
    );
  }
);

// ── get_cars_by_brand ───────────────────────────────────────────────────────────
server.tool(
  'get_cars_by_brand',
  'List all car models for a given brand from the Team-BHP New Car Finder (e.g. "tata", "hyundai", "maruti-suzuki", "mahindra", "toyota", "kia").',
  {
    brand: z
      .string()
      .describe('Brand slug, e.g. "tata", "hyundai", "maruti-suzuki", "mahindra", "toyota"'),
  },
  async ({ brand }) => {
    const slug = brand.toLowerCase().replace(/\s+/g, '-');
    const url = `${BASE_URL}/new-cars/${slug}/`;
    return toolResult(
      await withCache(`cars_by_brand:${slug}`, 1_800_000, async () => {
        const cars = parseCarListing(await fetchPage(url)).filter((c) => c.brand === slug);
        return { brand: slug, model_count: cars.length, models: cars };
      })
    );
  }
);

// ── get_car_details ─────────────────────────────────────────────────────────────
server.tool(
  'get_car_details',
  'Get details for a specific new car — price range, overview, and variant-wise ex-showroom prices. Provide brand + model slugs or the full New Car Finder URL.',
  {
    brand: z.string().optional().describe('Brand slug, e.g. "tata" (omit if passing url)'),
    model: z.string().optional().describe('Model slug, e.g. "nexon" (omit if passing url)'),
    url: z.string().optional().describe('Full car URL (alternative to brand+model)'),
  },
  async ({ brand, model, url }) => {
    let carUrl = url;
    if (!carUrl) {
      if (!brand || !model) {
        throw new Error('Provide either a full url, or both brand and model slugs.');
      }
      carUrl = `${BASE_URL}/new-cars/${brand.toLowerCase()}/${model.toLowerCase()}/`;
    }
    // Client-side rendered — extract from the live DOM. Returns the instant the
    // price range text renders (instead of a flat 3.8s wait).
    const data = await withCache(`car_details:${carUrl}`, 1_800_000, async () =>
      fetchRendered(carUrl, {
      waitForFn: () => /₹[\d.]+\s*L?\s*-\s*[\d.]+/.test(document.body.innerText),
      evaluate: () => {
        const lines = document.body.innerText
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        const priceRange = lines.find((l) => /₹[\d.]+\s*L?\s*-\s*[\d.]+\s*L?/.test(l)) || null;
        const overview = lines.find((l) => l.length > 120) || null;
        // ex-showroom variant prices (de-duped, comparison "Pay ₹X more" excluded)
        const variantPrices = [];
        lines.forEach((l) => {
          const m = l.match(/^₹([\d.]+)\s*Lakh$/);
          if (m) variantPrices.push('₹' + m[1] + ' Lakh');
        });
        return {
          name: (document.querySelector('h1') || {}).innerText?.replace(/\n/g, ' ').trim() || null,
          price_range: priceRange,
          overview: overview ? overview.slice(0, 600) : null,
          variant_prices: variantPrices,
        };
      },
      }).then((d) => ({ url: carUrl, ...d }))
    );
    return toolResult(data);
  }
);

// ── get_user_activity ──────────────────────────────────────────────────────────
// Note: full member profiles require login on Team-BHP. This uses the public
// forum search to surface a member's recent threads/posts instead.
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

// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Graceful shutdown
  process.on('SIGINT', async () => {
    if (_browser) await _browser.close();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    if (_browser) await _browser.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Server error:', err);
  process.exit(1);
});

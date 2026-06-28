'use strict';

const cheerio = require('cheerio');
const { BASE_URL } = require('../config/constants.js');

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

module.exports = {
  parseForumIndex,
  parseForumCategory,
  parseThread,
  parseHotThreads,
  parseTopThanked,
  parseCarReviews,
};

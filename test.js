'use strict';
// Quick smoke-test for each tool's parser logic
const { chromium } = require('playwright');
const cheerio = require('cheerio');

const BASE_URL = 'https://www.team-bhp.com';
const FORUM_URL = `${BASE_URL}/forum`;

let _browser = null;
async function getBrowser() {
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({ headless: true });
  }
  return _browser;
}

async function fetchPage(url) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);
    return await page.content();
  } finally {
    await context.close();
  }
}

// ─── Copy parsers inline for test ─────────────────────────────────────────

function parseForumIndex(html) {
  const $ = cheerio.load(html);
  const cats = [];
  $('td.alt1Active').each((_, el) => {
    const link = $(el).find('a').first();
    const href = link.attr('href') || '';
    const title = link.text().trim();
    if (title && href.match(/\/forum\/[\w-]+\//)) {
      cats.push({ title, url: href.startsWith('http') ? href : BASE_URL + href });
    }
  });
  return cats;
}

function parseForumCategory(html) {
  const $ = cheerio.load(html);
  const threads = [];
  $('[id^="thread_title_"]').each((_, el) => {
    const threadId = $(el).attr('id').replace('thread_title_', '');
    const title = $(el).text().trim();
    const href = $(el).attr('href') || '';
    const row = $(el).closest('tr');
    const tds = row.find('td');
    const replies = tds.eq(3).text().trim().replace(/,/g, '');
    const views = tds.eq(4).text().trim().replace(/,/g, '');
    if (title) threads.push({ id: threadId, title, url: href, replies: parseInt(replies)||0, views: parseInt(views)||0 });
  });
  return threads;
}

function parseThread(html) {
  const $ = cheerio.load(html);
  const title = $('title').text().replace('- Team-BHP','').trim();
  const posts = [];
  $('[id^="post_message_"]').each((_, el) => {
    const msgId = $(el).attr('id').replace('post_message_', '');
    const postTable = $(`#post${msgId}`);
    const username = postTable.find('.bigusername, .username').first().text().trim();
    const date = postTable.find('.thead').first().text().trim();
    posts.push({ id: msgId, author: username, date, preview: $(el).text().trim().slice(0, 100) });
  });
  return { title, post_count: posts.length, posts };
}

function parseHotThreads(html) {
  const $ = cheerio.load(html);
  const threads = [];
  const seen = new Set();
  $('a[href*="team-bhp.com/forum/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    if (text && href.match(/\/forum\/[\w-]+\/\d+/) && !seen.has(href)) {
      seen.add(href);
      threads.push({ title: text, url: href });
    }
  });
  return threads;
}

function parseNews(html) {
  const $ = cheerio.load(html);
  const articles = [];
  const seen = new Set();
  $('h2 a, h3 a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const title = $(el).text().trim();
    if (href.startsWith('/news/') && title && !seen.has(href)) {
      seen.add(href);
      articles.push({ title, url: BASE_URL + href });
    }
  });
  return articles;
}

// ─── Test runner ─────────────────────────────────────────────────────────────

function pass(label, count, items) {
  const preview = items.slice(0,2).map(i => JSON.stringify(i)).join('\n    ');
  console.log(`✅ ${label}: ${count} items\n    ${preview}`);
}
function fail(label, err) {
  console.error(`❌ ${label}: ${err.message}`);
}

async function main() {
  console.log('Team-BHP MCP Server — Smoke Tests\n');

  // 1. Forum Index
  try {
    const html = await fetchPage(`${FORUM_URL}/`);
    const cats = parseForumIndex(html);
    if (!cats.length) throw new Error('No categories found');
    pass('get_forum_index', cats.length, cats);
  } catch (e) { fail('get_forum_index', e); }

  // 2. Forum Category
  try {
    const html = await fetchPage(`${FORUM_URL}/road-safety/`);
    const threads = parseForumCategory(html);
    if (!threads.length) throw new Error('No threads found');
    pass('get_forum_category (road-safety)', threads.length, threads);
  } catch (e) { fail('get_forum_category', e); }

  // 3. Hot Threads
  try {
    const html = await fetchPage(`${BASE_URL}/hot-threads`);
    const threads = parseHotThreads(html);
    if (!threads.length) throw new Error('No hot threads found');
    pass('get_hot_threads', threads.length, threads);
  } catch (e) { fail('get_hot_threads', e); }

  // 4. News Listing
  try {
    const html = await fetchPage(`${BASE_URL}/news`);
    const articles = parseNews(html);
    if (!articles.length) throw new Error('No articles found');
    pass('get_news_listing', articles.length, articles);
  } catch (e) { fail('get_news_listing', e); }

  // 5. Thread
  try {
    const url = 'https://www.team-bhp.com/forum/road-safety/109249-accidents-india-pics-videos.html';
    const html = await fetchPage(url);
    const thread = parseThread(html);
    if (!thread.posts.length) throw new Error('No posts found');
    pass('get_thread', thread.posts.length, thread.posts);
    console.log(`   Title: "${thread.title}"`);
  } catch (e) { fail('get_thread', e); }

  // 6. Search
  try {
    const url = `${FORUM_URL}/search.php?do=process&query=${encodeURIComponent('Tata Nexon EV')}&titlesonly=0&childforums=1&sortby=lastpost&order=descending&showposts=0&submit=Search+Now`;
    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const results = [];
    $('[id^="thread_title_"]').each((_, el) => {
      const title = $(el).text().trim();
      const href = $(el).attr('href') || '';
      if (title) results.push({ title: title.slice(0, 60), url: href });
    });
    if (!results.length) throw new Error('No search results found');
    pass('search_forum (Tata Nexon EV)', results.length, results);
  } catch (e) { fail('search_forum', e); }

  // 7. Car Reviews
  try {
    const html = await fetchPage(`${FORUM_URL}/official-new-car-reviews/?pp=25&sort=dateline&order=desc&daysprune=-1`);
    const threads = parseForumCategory(html);
    if (!threads.length) throw new Error('No reviews found');
    pass('get_car_reviews', threads.length, threads);
  } catch (e) { fail('get_car_reviews', e); }

  // 8. News Article (FIXED parser)
  try {
    const url = 'https://www.team-bhp.com/news/why-i-had-scrap-my-bmw-530d-gave-me-so-many-joyful-moments?tab=1';
    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const title = $('h1').first().text().trim();
    const paras = [];
    $('.desc').each((_, el) => { const t = $(el).text().replace(/\s+/g,' ').trim(); if (t) paras.push(t); });
    const postDate = $('.postDate').first().text().replace(/\s+/g,' ').trim();
    if (!title || !paras.length) throw new Error('No article content found');
    console.log(`✅ get_news_article: title + ${paras.length} paragraphs (${paras.join(' ').length} chars)\n    title: "${title.slice(0,60)}"\n    byline: "${postDate.slice(0,50)}"`);
  } catch (e) { fail('get_news_article', e); }

  // 9. Top Thanked
  try {
    const html = await fetchPage(`${FORUM_URL}/thanks_analytics.php`);
    const $ = cheerio.load(html);
    const items = [];
    const threadRe = /\/forum\/[\w-]+\/\d+-[\w-]+\.html/;
    $('tr').each((_, el) => {
      const link = $(el).find('a').filter((i,a)=>{const h=$(a).attr('href')||'';return threadRe.test(h)&&!h.includes('/members/');}).first();
      if (!link.length) return;
      const title = link.text().trim();
      if (title.length > 5) {
        const tds = $(el).find('td').map((i,td)=>$(td).text().replace(/\s+/g,' ').trim()).get();
        const countIdx = tds.findIndex(t=>/^\d+$/.test(t));
        items.push({ title: title.slice(0,45), thanks: countIdx>=0?parseInt(tds[countIdx]):null });
      }
    });
    if (!items.length) throw new Error('No top-thanked items found');
    pass('get_top_thanked', items.length, items);
  } catch (e) { fail('get_top_thanked', e); }

  // 10. New Cars (all)
  try {
    const html = await fetchPage(`${BASE_URL}/new-cars/search-by/all-cars/`);
    const cars = parseCarListing(html);
    if (!cars.length) throw new Error('No cars found');
    pass('get_new_cars (all)', cars.length, cars);
  } catch (e) { fail('get_new_cars', e); }

  // 11. Cars by brand
  try {
    const html = await fetchPage(`${BASE_URL}/new-cars/tata/`);
    const cars = parseCarListing(html).filter(c => c.brand === 'tata');
    if (!cars.length) throw new Error('No Tata models found');
    pass('get_cars_by_brand (tata)', cars.length, cars);
  } catch (e) { fail('get_cars_by_brand', e); }

  // 12. Car details (JS-rendered)
  try {
    const ctx = await _browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
    const page = await ctx.newPage();
    await page.goto('https://www.team-bhp.com/new-cars/tata/nexon/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3800);
    const data = await page.evaluate(() => {
      const lines = document.body.innerText.split('\n').map(s=>s.trim()).filter(Boolean);
      return {
        name: document.querySelector('h1')?.innerText?.replace(/\n/g,' ').trim(),
        price_range: lines.find(l=>/₹[\d.]+\s*L?\s*-\s*[\d.]+\s*L?/.test(l))||null,
        variant_prices: lines.filter(l=>/^₹[\d.]+\s*Lakh$/.test(l)).length,
      };
    });
    await ctx.close();
    if (!data.price_range) throw new Error('No price range extracted');
    console.log(`✅ get_car_details: "${data.name}" ${data.price_range}, ${data.variant_prices} variant prices`);
  } catch (e) { fail('get_car_details', e); }

  // 13. User activity (public search)
  try {
    const html = await fetchPage(`${FORUM_URL}/search.php?do=process&searchuser=GTO&starteronly=0&showposts=0&submit=Search+Now`);
    const $ = cheerio.load(html);
    const results = [];
    $('[id^="thread_title_"]').each((_, el) => { const t = $(el).text().trim(); if (t) results.push({ title: t.slice(0,50) }); });
    if (!results.length) throw new Error('No user activity found');
    pass('get_user_activity (GTO)', results.length, results);
  } catch (e) { fail('get_user_activity', e); }

  await _browser.close();
  console.log('\nAll tests completed.');
}

function parseCarListing(html) {
  const $ = cheerio.load(html);
  const cars = [];
  const seen = new Set();
  $('a[href*="/new-cars/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    const m = href.match(/\/new-cars\/([\w-]+)\/([\w-]+)\/?$/);
    if (m && !href.includes('search-by') && !href.includes('compare') && text && text.length > 1 && !seen.has(href)) {
      seen.add(href);
      cars.push({ name: text, brand: m[1], model: m[2] });
    }
  });
  return cars;
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });

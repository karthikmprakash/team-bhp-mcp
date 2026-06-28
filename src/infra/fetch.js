'use strict';

const { getBrowser } = require('./browser.js');
const { USER_AGENT, BLOCKED_TYPES, BLOCKED_HOSTS } = require('../config/constants.js');

async function applyResourceBlocking(context) {
  await context.route('**/*', (route) => {
    const req = route.request();
    const url = req.url();
    if (BLOCKED_TYPES.has(req.resourceType())) return route.abort();
    if (BLOCKED_HOSTS.some((h) => url.includes(h))) return route.abort();
    return route.continue();
  });
}

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

module.exports = {
  fetchPage,
  fetchRendered,
};

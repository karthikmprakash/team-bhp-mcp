'use strict';

const BASE_URL = 'https://www.team-bhp.com';
const FORUM_URL = `${BASE_URL}/forum`;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const BLOCKED_TYPES = new Set(['image', 'media', 'font']);
const BLOCKED_HOSTS = [
  'doubleclick.net', 'googlesyndication.com', 'google-analytics.com',
  'googletagmanager.com', 'googletagservices.com', 'adservice.google',
  'facebook.net', 'facebook.com', 'connect.facebook', 'twitter.com',
  'scorecardresearch.com', 'quantserve.com', 'amazon-adsystem.com',
  'adnxs.com', 'criteo', 'taboola', 'outbrain', 'pubmatic', 'rubiconproject',
  'casalemedia', 'openx', 'cloudflareinsights.com', 'hotjar', 'mixpanel',
];

module.exports = {
  BASE_URL,
  FORUM_URL,
  USER_AGENT,
  BLOCKED_TYPES,
  BLOCKED_HOSTS,
};

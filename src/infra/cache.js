'use strict';

const _cache = new Map();

async function withCache(key, ttlMs, producer) {
  const hit = _cache.get(key);
  if (hit && hit.expiry > Date.now()) return hit.value;
  const value = await producer();
  _cache.set(key, { value, expiry: Date.now() + ttlMs });
  return value;
}

module.exports = { withCache };

'use strict';
// End-to-end test: drives the actual server.js over the MCP stdio protocol.
// Measures cold-call latency (smart waits) and cached-call latency (TTL cache).
const { spawn } = require('child_process');

const proc = spawn('node', ['server.js'], { cwd: __dirname, stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '';
const pending = new Map();
proc.stdout.on('data', (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});

let _id = 0;
function rpc(method, params) {
  const id = ++_id;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
async function call(name, args = {}) {
  const t0 = Date.now();
  const res = await rpc('tools/call', { name, arguments: args });
  const ms = Date.now() - t0;
  const data = JSON.parse(res.result.content[0].text);
  return { ms, data };
}

async function main() {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  console.log('Tool                cold     cached   speedup   result');
  console.log('─'.repeat(70));

  const checks = [
    ['get_forum_index', {}, (d) => `${d.reduce((n, s) => n + s.categories.length, 0)} cats`],
    ['get_thread', { url: 'https://www.team-bhp.com/forum/road-safety/109249-accidents-india-pics-videos.html' }, (d) => `${d.post_count} posts`],
    ['get_hot_threads', {}, (d) => `${d.thread_count} threads`],
    ['get_news_listing', {}, (d) => `${d.article_count} articles`],
    ['get_top_thanked', {}, (d) => `${d.count} threads`],
    ['get_car_details', { brand: 'tata', model: 'nexon' }, (d) => `${d.price_range}`],
    ['get_new_cars', {}, (d) => `${d.car_count} cars`],
    ['search_forum', { query: 'Tata Nexon EV' }, (d) => `${d.result_count} results`],
  ];

  let ok = 0;
  for (const [name, args, summarize] of checks) {
    try {
      const cold = await call(name, args);
      const cached = await call(name, args);
      const summary = summarize(cold.data);
      const valid = summary && !summary.startsWith('0') && summary !== 'undefined';
      const speedup = (cold.ms / Math.max(cached.ms, 1)).toFixed(0);
      console.log(`${name.padEnd(19)} ${(cold.ms + 'ms').padEnd(8)} ${(cached.ms + 'ms').padEnd(8)} ${(speedup + 'x').padEnd(9)} ${valid ? '✅' : '❌'} ${summary}`);
      if (valid) ok++;
    } catch (e) {
      console.log(`${name.padEnd(19)} ❌ ERROR: ${e.message}`);
    }
  }

  console.log('─'.repeat(70));
  console.log(`${ok}/${checks.length} tools returned valid data`);
  proc.kill('SIGTERM');
  process.exit(ok === checks.length ? 0 : 1);
}

main().catch((e) => { console.error('Fatal:', e); proc.kill(); process.exit(1); });

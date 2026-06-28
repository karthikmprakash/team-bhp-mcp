'use strict';

const { spawn } = require('child_process');

const PORT = 32123;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function waitForServer(proc) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('HTTP server did not start in time')), 10000);

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Team-BHP MCP HTTP server listening')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    proc.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`HTTP server exited early with code ${code}`));
    });
  });
}

async function main() {
  const proc = spawn('node', ['server-http.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(PORT),
      MCP_AUTH_TOKEN: 'test-token',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer(proc);

    const health = await fetch(`${BASE_URL}/healthz`);
    if (health.status !== 200) {
      throw new Error(`Expected /healthz 200, got ${health.status}`);
    }

    const unauthenticated = await fetch(`${BASE_URL}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    if (unauthenticated.status !== 401) {
      throw new Error(`Expected unauthenticated /mcp 401, got ${unauthenticated.status}`);
    }

    console.log('HTTP smoke test passed');
  } finally {
    proc.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

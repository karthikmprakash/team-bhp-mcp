'use strict';

const { spawn } = require('child_process');

const PORT = 32123;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TOKEN = 'test-token';

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
      MCP_AUTH_TOKEN: TOKEN,
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

    const initialized = await mcpPost({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    if (initialized.status >= 500) {
      throw new Error(`Expected initialized notification below 500, got ${initialized.status}`);
    }

    const tools = await mcpPost({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });
    if (tools.status !== 200) {
      throw new Error(`Expected authorized tools/list 200, got ${tools.status}`);
    }

    const payload = parseMcpResponse(tools.text);
    const toolCount = payload?.result?.tools?.length || 0;
    if (toolCount === 0) {
      throw new Error('Expected tools/list to return registered tools');
    }

    console.log('HTTP smoke test passed');
  } finally {
    proc.kill('SIGTERM');
  }
}

async function mcpPost(body) {
  const response = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  return { status: response.status, text: await response.text() };
}

function parseMcpResponse(text) {
  if (text.startsWith('event:')) {
    const data = text
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    return data ? JSON.parse(data) : null;
  }

  return text ? JSON.parse(text) : null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

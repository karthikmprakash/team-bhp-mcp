#!/usr/bin/env node
'use strict';

const express = require('express');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createTeamBhpServer, closeBrowser } = require('./src/team-bhp-server.js');
const { getHttpConfig } = require('./src/config/http.js');

const { host: HOST, port: PORT, mcpPath: MCP_PATH, authToken: AUTH_TOKEN } = getHttpConfig();

if (!AUTH_TOKEN) {
  console.error('MCP_AUTH_TOKEN is required for HTTP mode.');
  process.exit(1);
}

function requireBearerToken(req, res, next) {
  const header = req.get('authorization') || '';
  const expected = `Bearer ${AUTH_TOKEN}`;

  if (header !== expected) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

async function main() {
  const app = express();

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use(MCP_PATH, requireBearerToken);
  app.use(MCP_PATH, express.json({ limit: '1mb' }));

  app.all(MCP_PATH, async (req, res) => {
    const mcpServer = createTeamBhpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('MCP HTTP request failed:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'MCP request failed' });
      }
    }
  });

  const httpServer = app.listen(PORT, HOST, () => {
    console.error(`Team-BHP MCP HTTP server listening on http://${HOST}:${PORT}${MCP_PATH}`);
  });

  async function shutdown() {
    httpServer.close(async () => {
      await closeBrowser();
      process.exit(0);
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('HTTP server error:', err);
  process.exit(1);
});

#!/usr/bin/env node
'use strict';

const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { createTeamBhpServer, closeBrowser } = require('./src/team-bhp-server.js');

async function shutdown() {
  await closeBrowser();
  process.exit(0);
}

async function main() {
  const server = createTeamBhpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Server error:', err);
  process.exit(1);
});

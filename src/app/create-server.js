'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { registerTools } = require('../tools/index.js');

function createTeamBhpServer() {
  const server = new McpServer({
    name: 'team-bhp',
    version: '1.0.0',
  });

  registerTools(server);

  return server;
}

module.exports = { createTeamBhpServer };

'use strict';

const DEFAULT_PORT = 3000;
const MCP_PATH = '/mcp';

function getHttpConfig(env = process.env) {
  return {
    host: env.HOST || '0.0.0.0',
    port: Number(env.PORT || DEFAULT_PORT),
    mcpPath: MCP_PATH,
    authToken: env.MCP_AUTH_TOKEN,
  };
}

module.exports = {
  DEFAULT_PORT,
  MCP_PATH,
  getHttpConfig,
};

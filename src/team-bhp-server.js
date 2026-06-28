'use strict';

const { createTeamBhpServer } = require('./app/create-server.js');
const { closeBrowser } = require('./infra/browser.js');

module.exports = {
  createTeamBhpServer,
  closeBrowser,
};

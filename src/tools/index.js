'use strict';

const {
  registerGetForumIndexTool,
  registerGetForumCategoryTool,
  registerGetThreadTool,
  registerGetHotThreadsTool,
  registerGetCarReviewsTool,
  registerGetNewThreadsTool,
  registerGetNewPostsTool,
  registerGetTopThankedTool,
} = require('./forum.js');
const { registerGetNewsListingTool, registerGetNewsArticleTool } = require('./news.js');
const { registerSearchForumTool, registerGetUserActivityTool } = require('./search.js');
const { registerGetNewCarsTool, registerGetCarsByBrandTool, registerGetCarDetailsTool } = require('./cars.js');

function registerTools(server) {
  registerGetForumIndexTool(server);
  registerGetForumCategoryTool(server);
  registerGetThreadTool(server);
  registerGetHotThreadsTool(server);
  registerGetNewsListingTool(server);
  registerGetNewsArticleTool(server);
  registerSearchForumTool(server);
  registerGetCarReviewsTool(server);
  registerGetNewThreadsTool(server);
  registerGetNewPostsTool(server);
  registerGetTopThankedTool(server);
  registerGetNewCarsTool(server);
  registerGetCarsByBrandTool(server);
  registerGetCarDetailsTool(server);
  registerGetUserActivityTool(server);
}

module.exports = { registerTools };

FROM mcr.microsoft.com/playwright:v1.61.1-noble

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev \
  && npm cache clean --force

COPY server.js mcp.json README.md LICENSE ./

RUN chown -R pwuser:pwuser /app /ms-playwright

USER pwuser

ENTRYPOINT ["node", "server.js"]

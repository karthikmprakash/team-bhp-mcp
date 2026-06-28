FROM mcr.microsoft.com/playwright:v1.61.1-noble

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PORT=3000

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev \
  && npm cache clean --force

COPY server.js server-http.js mcp.json README.md LICENSE ./
COPY src ./src

RUN chown -R pwuser:pwuser /app /ms-playwright

USER pwuser

EXPOSE 3000

ENTRYPOINT ["node", "server-http.js"]

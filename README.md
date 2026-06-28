# Team-BHP MCP Server

Team-BHP MCP Server exposes public Team-BHP forum, news, and new-car finder data through the Model Context Protocol (MCP). It supports local stdio mode for desktop MCP clients and a bearer-protected Streamable HTTP mode for internet-reachable deployments.

## Features

- Browse Team-BHP forum categories, threads, hot threads, new threads, and new posts.
- Read public thread and news article content.
- Search public Team-BHP forum pages.
- Browse Team-BHP official car reviews and New Car Finder data.
- Uses Playwright and Cheerio to parse public pages, with lightweight in-memory caching for repeat calls.

## Requirements

- Node.js 20 or newer
- npm
- Playwright Chromium browser binaries

## Setup

```bash
npm install
npx playwright install chromium
```

Run the local stdio server:

```bash
npm start
```

Run the HTTP server:

```bash
MCP_AUTH_TOKEN=change-me npm run start:http
```

The stdio server is normally started by an MCP client rather than run directly in a terminal. The HTTP server listens on `PORT`, defaulting to `3000`, and exposes MCP at `/mcp`.

## MCP Client Configuration

For a local clone, use an absolute path to `server.js`:

```json
{
  "mcpServers": {
    "team-bhp": {
      "command": "node",
      "args": ["/absolute/path/to/team-bhp/server.js"],
      "description": "Team-BHP forum, news, and car data MCP server"
    }
  }
}
```

For an installed package or release tarball, use the executable exposed by the package:

```json
{
  "mcpServers": {
    "team-bhp": {
      "command": "team-bhp-mcp",
      "args": [],
      "description": "Team-BHP forum, news, and car data MCP server"
    }
  }
}
```

Install a GitHub release tarball globally:

```bash
npm install -g ./team-bhp-1.0.0.tgz
npx playwright install chromium
```

## Docker

Build the image locally:

```bash
docker build -t team-bhp-mcp .
```

Run it as an internet-reachable Streamable HTTP MCP server:

```bash
docker run --rm --init --ipc=host -p 3000:3000 -e MCP_AUTH_TOKEN=change-me team-bhp-mcp
```

Released images are published to GitHub Container Registry:

```bash
docker pull ghcr.io/karthikmprakash/team-bhp-mcp:latest
docker run --rm --init --ipc=host -p 3000:3000 -e MCP_AUTH_TOKEN=change-me ghcr.io/karthikmprakash/team-bhp-mcp:latest
```

Your remote MCP URL is:

```bash
http://localhost:3000/mcp
```

For an internet deployment behind TLS, use:

```bash
https://your-domain.example/mcp
```

Configure your remote MCP client to send:

```http
Authorization: Bearer change-me
```

## Docker Compose

Build and run the HTTP server with Compose:

```bash
MCP_AUTH_TOKEN=change-me docker compose up --build
```

Use the published GHCR image instead of building locally:

```bash
MCP_AUTH_TOKEN=change-me TEAM_BHP_MCP_IMAGE=ghcr.io/karthikmprakash/team-bhp-mcp:latest docker compose up --no-build
```

Compose publishes the HTTP server on `http://localhost:3000/mcp` by default. Override the host port with `TEAM_BHP_MCP_PORT`.

## Testing

Run the default deterministic checks:

```bash
npm test
```

Run the HTTP health/auth smoke test:

```bash
npm run test:http
```

Run the networked parser smoke test:

```bash
npm run test:smoke
```

Run the MCP stdio protocol e2e test:

```bash
npm run test:e2e
```

The smoke and e2e tests fetch public Team-BHP pages, so they can fail if the site changes, blocks automation, or is temporarily unavailable.

## Releases

This repository uses GitHub Releases and GHCR images. The release workflow runs tests, builds an npm tarball with `npm pack`, publishes a Docker image to `ghcr.io/karthikmprakash/team-bhp-mcp`, creates a GitHub Release, and uploads the tarball.

To cut a release:

```bash
npm version patch
git push
git push origin vX.Y.Z
```

Use `minor` or `major` instead of `patch` when appropriate.

## License

ISC

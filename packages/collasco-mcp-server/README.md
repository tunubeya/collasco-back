# @collasco/mcp-server

Private npm package for running the Collasco MCP server.

## Install

```bash
npm install -g @collasco/mcp-server
```

From a tarball:

```bash
npm install -g ./collasco-mcp-server-0.1.0.tgz
```

For one-off use without a global install:

```bash
npx --package @collasco/mcp-server collasco-mcp-login
```

## Start

The easiest local startup path is:

```bash
collasco-mcp-login
```

The command prompts for a Collasco email and password, calls the Collasco API login endpoint, keeps the returned tokens in memory, and starts the local HTTP MCP server.

By default the server listens at:

```text
http://127.0.0.1:3333/mcp
```

Register it in Codex:

```bash
codex mcp add collasco --url http://127.0.0.1:3333/mcp
```

Register it in Claude Code:

```bash
claude mcp add-json collasco '{"type":"http","url":"http://127.0.0.1:3333/mcp"}'
claude mcp get collasco
```

Claude Desktop remote connectors are reached from Anthropic's cloud infrastructure, so `localhost` is not a valid remote connector target. For Claude Desktop local distribution, package this server as a Desktop Extension (`.dxt`) or use a local development MCP configuration that starts the server on the user's machine.

## Configuration

Optional environment variables:

```bash
COLLASCO_API_BASE_URL=https://api.collasco.com/v1
COLLASCO_MCP_HTTP_PORT=3333
COLLASCO_MCP_HTTP_HOST=127.0.0.1
COLLASCO_EMAIL=you@example.com
COLLASCO_PASSWORD=...
```

The login command sets `COLLASCO_MCP_ALLOW_REFRESH_TOKEN_AUTH=true` for local convenience. Do not use that mode for hosted deployments.

## Publish

Build and inspect the package contents:

```bash
npm run build
npm run pack:dry
```

Publish as a restricted scoped package:

```bash
npm publish
```

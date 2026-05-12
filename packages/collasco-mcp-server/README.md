# @collasco/mcp-server

Private npm package for running the Collasco MCP server from local and hosted MCP clients.

## Requirements

- Node.js 20 or newer
- A Collasco account or Collasco access token

## Installation

```bash
npm install -g @collasco/mcp-server
```

From a tarball:

```bash
npm install -g ./collasco-mcp-server-0.1.6.tgz
```

For one-off use without a global install:

```bash
npx --package @collasco/mcp-server collasco-mcp-login
```

## Local HTTP server

For local MCP clients, start the HTTP server through the login helper:

```bash
collasco-mcp-login
```

The command prompts for a Collasco email and password, logs into the Collasco API, keeps the returned tokens in the server process environment, and starts the HTTP MCP server.

By default it listens at:

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

## Stdio server

`collasco-mcp` starts a stdio MCP server by default:

```bash
COLLASCO_ACCESS_TOKEN=... collasco-mcp
```

Password login is disabled unless explicitly enabled:

```bash
COLLASCO_MCP_ENABLE_PASSWORD_LOGIN=true collasco-mcp
```

When password login is enabled, the `collasco_login` MCP tool is exposed. Otherwise clients authenticate with `COLLASCO_ACCESS_TOKEN` or, for HTTP, an `Authorization: Bearer <access_token>` header.

## HTTP server

Start the HTTP transport directly when you already have tokens:

```bash
COLLASCO_ACCESS_TOKEN=... collasco-mcp --http
```

Equivalent environment-based startup:

```bash
COLLASCO_ACCESS_TOKEN=... COLLASCO_MCP_TRANSPORT=http collasco-mcp
```

The HTTP endpoint accepts JSON-RPC requests at `POST /mcp`. It also exposes:

- `GET /` and `GET /mcp` for transport discovery
- `GET /health` for health checks
- `GET /.well-known/oauth-protected-resource` for OAuth protected resource metadata

HTTP requests normally need an `Authorization: Bearer <access_token>` header. The local `collasco-mcp-login` helper starts the server with `COLLASCO_MCP_ALLOW_REFRESH_TOKEN_AUTH=true` and a refresh token so local clients can connect without adding a bearer token manually.

## MCP capabilities

The server exposes tools for:

- Reading the shared Collasco general instructions and standard documentation catalog
- Listing and searching projects
- Reading project, module, and feature documentation
- Creating, updating, and deleting modules and features
- Updating project, module, and feature documentation labels

It also exposes these MCP resources:

- `collasco://instructions/general`
- `collasco://documentation/standard-label-catalog`

## Configuration

Optional environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `COLLASCO_API_BASE_URL` | `https://api.collasco.com/v1` | Collasco API base URL. |
| `COLLASCO_WEB_BASE_URL` | `https://collasco.com` | Base URL used for public manual links returned by shared resources. |
| `COLLASCO_ACCESS_TOKEN` | none | Access token for stdio requests or direct HTTP startup. |
| `COLLASCO_REFRESH_TOKEN` | none | Refresh token used to rotate access tokens. |
| `COLLASCO_EMAIL` | none | Email used by `collasco-mcp-login` or by the password login tool when enabled. |
| `COLLASCO_PASSWORD` | none | Password used by `collasco-mcp-login` or by the password login tool when enabled. |
| `COLLASCO_MCP_TRANSPORT` | none | Set to `http` to start HTTP transport without passing `--http`. |
| `COLLASCO_MCP_HTTP_HOST` | `127.0.0.1` | HTTP bind host. |
| `COLLASCO_MCP_HTTP_PORT` | `3333` | HTTP bind port. |
| `COLLASCO_MCP_PUBLIC_BASE_URL` | `http://localhost:<port>` | Public base URL used in discovery metadata. |
| `COLLASCO_MCP_PUBLIC_URL` | `<public-base-url>/mcp` | Public MCP endpoint URL used in discovery metadata. |
| `COLLASCO_MCP_CORS_ORIGIN` | `*` | CORS origin for HTTP responses. |
| `COLLASCO_MCP_ENABLE_PASSWORD_LOGIN` | `false` | Enables the `collasco_login` tool. |
| `COLLASCO_MCP_ALLOW_REFRESH_TOKEN_AUTH` | `false` | Allows local HTTP requests without bearer auth when `COLLASCO_REFRESH_TOKEN` is available. Intended for local development only. |
| `COLLASCO_AUTHORIZATION_SERVER_URL` | API origin | Authorization server URL advertised in OAuth metadata. |
| `COLLASCO_GENERAL_INSTRUCTIONS_SHARED_LINK_ID` | built-in shared link id | Overrides the shared manual used by `collasco://instructions/general`. |
| `COLLASCO_DOCUMENTATION_CATALOG_SHARED_LINK_ID` | built-in shared link id | Overrides the shared manual used by `collasco://documentation/standard-label-catalog`. |

## Publish

Build and inspect the package contents before publishing:

```bash
npm run build
npm run pack:dry
```

Publish as a restricted scoped package:

```bash
npm publish
```

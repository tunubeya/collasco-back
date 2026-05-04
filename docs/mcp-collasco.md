# Collasco MCP PoC

This proof of concept adds a small MCP server on top of the existing Collasco API. This allows an AI client to log in and retrieve projects through tools, without direct access to the codebase.

The preferred transport is now HTTP with OAuth-style bearer access tokens:

```http
Authorization: Bearer <access_token>
```

For local development the MCP server can run on localhost. Later the same HTTP transport can be hosted remotely.

## What This PoC Does

- exposes a local HTTP MCP endpoint at `/mcp`
- supports `Authorization: Bearer <access_token>` for HTTP MCP requests
- supports a local-only refresh-token bridge when started with `npm run mcp:collasco:http:login`
- forwards the bearer access token to the Collasco API
- retrieves projects through `GET /v1/projects/mine` when filtered, with a profile-based fallback for unfiltered listings
- creates modules and features through the existing Collasco REST API
- exposes OAuth protected-resource metadata for future hosted use

## Available Tools

- `collasco_list_projects`
- `collasco_search_projects`
- `collasco_get_project`
- `collasco_get_general_instructions`
- `collasco_get_standard_documentation_catalog`
- `collasco_get_project_labels`
- `collasco_get_project_documentation`
- `collasco_get_module_documentation`
- `collasco_get_feature_documentation`
- `collasco_create_module`
- `collasco_create_feature`
- `collasco_update_module`
- `collasco_update_feature`
- `collasco_delete_module`
- `collasco_delete_feature`
- `collasco_update_documentation`

`collasco_list_projects` accepts optional `q`. When `q` is omitted, the MCP server falls back to `GET /users/me/profile` and builds the project list from owned and member projects, avoiding the unstable unfiltered `/projects/mine` path.

## Tool Intent

- `collasco_get_project`: retrieves the project record, such as name, status, visibility, description, and other project metadata.
- `collasco_get_general_instructions`: retrieves the shared Collasco `Instructions` manual used as the canonical operating guide for agents.
- `collasco_get_standard_documentation_catalog`: retrieves the shared Collasco standard documentation label catalog manual used by agents to choose or suggest labels when project labels do not fit well.
- `collasco_get_project_labels`: retrieves the full project label definitions, including instructions, visibility roles, read-only roles, and ordering.
- `collasco_get_project_documentation`: retrieves project-level documentation entries from the documentation API.
- `collasco_get_module_documentation`: retrieves module-level documentation entries from the documentation API.
- `collasco_get_feature_documentation`: retrieves feature-level documentation entries from the documentation API.
- `collasco_create_module`: creates a module in a project using the authenticated user's `module.write` permission.
- `collasco_create_feature`: creates a feature in a module using the authenticated user's `feature.write` permission.
- `collasco_update_module`: updates a module using the authenticated user's `module.write` permission.
- `collasco_update_feature`: updates a feature using the authenticated user's `feature.write` permission.
- `collasco_delete_module`: soft-deletes a module using the authenticated user's `module.write` permission.
- `collasco_delete_feature`: soft-deletes a feature using the authenticated user's `feature.write` permission.
- `collasco_update_documentation`: upserts project, module, or feature documentation content for a project label using the authenticated user's QA write permission.

## Available Resources

- `collasco://instructions/general`: the shared Collasco project-root manual filtered to the `Instructions` label, returned as JSON. This resource is backed by the shared manual link for the Collasco project, so agents can read the general Collasco instructions through MCP without requiring direct access to the private Collasco project.
- `collasco://documentation/standard-label-catalog`: the shared Collasco standard documentation label catalog manual, returned as JSON. This resource helps agents choose or suggest documentation labels when the current project labels do not fit well.

By default the MCP server reads shared manual `06045779-2a7a-4415-a9f4-3df75b95ac6e`. Override this with `COLLASCO_GENERAL_INSTRUCTIONS_SHARED_LINK_ID` when a different shared instructions manual should be exposed.

By default the MCP server reads documentation catalog shared manual `4fd19cab-cfee-4aba-81a8-828904c44104`. Override this with `COLLASCO_DOCUMENTATION_CATALOG_SHARED_LINK_ID` when a different shared catalog manual should be exposed.

## Build And Start

```bash
npm run prisma:generate
npm run build
npm run mcp:collasco:http:login
```

After switching to a branch with Prisma schema changes, run `npm run prisma:generate` first. Otherwise `npm run build` can fail because of a stale Prisma client, even if the schema file itself is correct.

The HTTP server listens on:

```text
http://localhost:3333/mcp
```

Opening `http://localhost:3333/` or `http://localhost:3333/mcp` with a browser or `curl` returns a small discovery response. MCP clients should still connect to `/mcp` and send JSON-RPC requests with `POST`.

Register it with Codex as streamable HTTP MCP:

```bash
codex mcp add collasco --url http://127.0.0.1:3333/mcp --bearer-token-env-var COLLASCO_ACCESS_TOKEN
```

This stores only the environment variable name, not the token value. With the login startup script below, the MCP server can also authenticate requests through its local refresh-token bridge, so Codex does not need to store a token in its config.

For local development, the easiest startup path is:

```bash
npm run mcp:collasco:http:login
```

The script prompts for your Collasco email and password, calls `POST /auth/login`, keeps the returned access and refresh tokens in the MCP server process environment, and starts the HTTP MCP server. It does not write tokens to disk.

You can also provide credentials through the process environment when you need a non-interactive startup:

```bash
COLLASCO_EMAIL=you@example.com COLLASCO_PASSWORD=... npm run mcp:collasco:http:login
```

You can change the port with:

```bash
COLLASCO_MCP_HTTP_PORT=3334 npm run mcp:collasco:http
```

## Private npm package

The distributable MCP server package lives in:

```text
packages/collasco-mcp-server
```

It publishes as the restricted scoped package:

```text
@collasco/mcp-server
```

Build and inspect the package contents from the back-end root:

```bash
npm run mcp:collasco:package:build
npm run mcp:collasco:package:pack
```

Publish it from the package directory:

```bash
cd packages/collasco-mcp-server
npm publish
```

Colleagues can install and start it with:

```bash
npm install -g @collasco/mcp-server
collasco-mcp-login
```

Or run it without a global install:

```bash
npx --package @collasco/mcp-server collasco-mcp-login
```

Then register the local HTTP MCP endpoint in Codex:

```bash
codex mcp add collasco --url http://127.0.0.1:3333/mcp
```

## Authentication

Hosted HTTP MCP requests must include a Collasco access token on every request:

```http
Authorization: Bearer <access_token>
```

The MCP server forwards that token to the Collasco API. It does not read `COLLASCO_EMAIL` or `COLLASCO_PASSWORD` by default in normal server mode. The `mcp:collasco:http:login` startup script is the local convenience path that prompts for credentials, retrieves tokens, and starts the server with those tokens in memory.

You can also provide a refresh token to the local MCP server:

```bash
COLLASCO_ACCESS_TOKEN=<access_token>
COLLASCO_REFRESH_TOKEN=<refresh_token>
npm run mcp:collasco:http
```

When the Collasco API rejects the access token with `401`, the MCP server calls `POST /auth/refresh` with `Authorization: Bearer <refresh_token>`, caches the rotated tokens in memory, and retries the original API request.

For local development only, you can let the MCP server obtain the access token from the refresh token without requiring the MCP client to send an `Authorization` header:

```bash
COLLASCO_REFRESH_TOKEN=<refresh_token>
COLLASCO_MCP_ALLOW_REFRESH_TOKEN_AUTH=true
npm run mcp:collasco:http
```

Do not use `COLLASCO_MCP_ALLOW_REFRESH_TOKEN_AUTH=true` for hosted deployments. Hosted MCP should require the client to send `Authorization: Bearer <access_token>` and should let the OAuth client handle refresh-token rotation.

The HTTP server exposes OAuth protected-resource metadata at:

```text
http://localhost:3333/.well-known/oauth-protected-resource
```

The Collasco API exposes authorization-server metadata at:

```text
https://api.collasco.com/v1/.well-known/oauth-authorization-server
```

Set these variables when hosting:

```bash
COLLASCO_MCP_PUBLIC_BASE_URL=https://mcp.collasco.com
COLLASCO_AUTHORIZATION_SERVER_URL=https://api.collasco.com
```

## MCP test suite

A live MCP integration test suite is available in:

`test/mcp.e2e-spec.ts`

These tests call the running HTTP MCP server through JSON-RPC. The assistant cannot start an authenticated test server by itself because the login flow needs user credentials/tokens. Before asking the assistant to run the live MCP tests, start or restart the server yourself with:

```bash
npm run mcp:collasco:http:login
```

When the MCP server is not already running, the assistant cannot run the MCP tests and must ask the user to run the server first.

Restart the MCP server after changing MCP code so it loads the latest `dist/mcp/collasco-mcp.js`. The tests default to `http://127.0.0.1:3333/mcp`; override this with `COLLASCO_MCP_URL` when the server listens somewhere else. If the running server requires bearer authentication from the test process, set `COLLASCO_MCP_ACCESS_TOKEN` or `COLLASCO_ACCESS_TOKEN`.

## MCP Data Safety

MCP tests and assistant-driven MCP tool calls must not alter live Collasco project contents unless the target project is exactly `Collasco Automated E2E Testsuite`. Treat every other project as read-only unless the user explicitly names that project and asks for a mutation.

## Running The MCP Tests

```bash
npm run prisma:generate
npm run mcp:collasco:http:login
npm run test:mcp:e2e
```

## Current MCP Tests

- MCP initialize: verifies the running MCP server identity
- `tools/list`: verifies the expected Collasco MCP tools are exposed
- `collasco_list_projects`: finds the `Collasco Automated E2E Testsuite` project through the project listing flow
- `collasco_search_projects`: finds the `Collasco Automated E2E Testsuite` project when searching by name
- `collasco_get_project_labels`: returns the `Overview` label and verifies that its instructions contain `why` and `what`
- `collasco_get_project_documentation`: returns project-level documentation entries for the `Collasco Automated E2E Testsuite` project
- module/feature CRUD and documentation update: creates, updates, documents, and deletes E2E module/feature records in the `Collasco Automated E2E Testsuite` project
- `collasco_get_feature_documentation`: returns feature-level documentation entries for the `Manual` feature

## Examples In MCP Clients

These prompts work in MCP clients that surface the Collasco tools natively. In Codex sessions where HTTP MCP tools are not surfaced directly, use the HTTP JSON-RPC endpoint instead.

```text
Show my Collasco projects.
```

```text
Search my Collasco projects for "orderflow".
```

```text
Get project 7b54eb89-6607-453f-9f62-fc23f535a476.
```

```text
Show the documentation of project 7b54eb89-6607-453f-9f62-fc23f535a476.
```

```text
Show the documentation of module d59b5cf1-bc95-438a-af48-9f38544bdb27.
```

```text
Show the documentation of feature a3585dad-1bd7-4b44-a357-ba287beef18e.
```

```text
Show the project labels of project 8d1a8d99-987b-4bd0-8a19-ea93fccd95bd.
```

```text
Create a module named "Billing" in project 8d1a8d99-987b-4bd0-8a19-ea93fccd95bd.
```

```text
Create a feature named "Invoice export" in module d59b5cf1-bc95-438a-af48-9f38544bdb27 with priority HIGH.
```

```text
Update the Overview documentation for module d59b5cf1-bc95-438a-af48-9f38544bdb27.
```

```text
Delete feature a3585dad-1bd7-4b44-a357-ba287beef18e.
```

## Notes

- HTTP mode treats the MCP server as an OAuth protected resource.
- Access tokens are supplied by the MCP client and must be sent in the `Authorization` header.
- Before public hosting, issue access tokens specifically for the MCP resource/audience and validate scopes.

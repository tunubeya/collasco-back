# Collasco MCP PoC

This proof of concept adds a small MCP server on top of the existing Collasco API. This allows an AI client to log in and retrieve projects through tools, without direct access to the codebase.

## What This PoC Does

- logs in through `POST /v1/auth/login`
- stores the access and refresh token inside the MCP process
- retrieves projects through `GET /v1/projects/mine`
- refreshes automatically when an access token expires

## Available Tools

- `collasco_login`
- `collasco_list_projects`
- `collasco_search_projects`
- `collasco_get_project`
- `collasco_get_project_structure`
- `collasco_get_project_labels`
- `collasco_get_module_or_feature_path`

## Tool Intent

- `collasco_get_project`: retrieves the project record, such as name, status, visibility, description, and other project metadata.
- `collasco_get_project_structure`: retrieves the structural project view, including modules, features, documentation labels, and linked features.
- `collasco_get_project_labels`: retrieves the full project label definitions, including instructions, visibility roles, read-only roles, and ordering.
- `collasco_get_module_or_feature_path`: derives a human-readable hierarchical module or feature path from the existing project structure response. 

## Build And Start

```bash
npm run prisma:generate
npm run build
npm run mcp:collasco
```

After switching to a branch with Prisma schema changes, run `npm run prisma:generate` first. Otherwise `npm run build` can fail because of a stale Prisma client, even if the schema file itself is correct.

## MCP test suite

A live MCP integration test suite is available in:

`test/mcp.e2e-spec.ts`

These tests use the same login flow as the MCP server and call the live Collasco API. Because of that, you need valid `COLLASCO_*` credentials and network access to the API.

## Running The MCP Tests

```bash
npm run prisma:generate
npx jest --config ./test/jest-e2e.json --runInBand test/mcp.e2e-spec.ts
```

## Current MCP Tests

- `collasco_login`: logs into Collasco successfully
- `collasco_list_projects`: finds the Collasco Test Suite project through the project listing flow
- `collasco_search_projects`: finds the Collasco Test Suite project when searching for `Test Suite`
- `collasco_get_project_labels`: returns the `Overview` label and verifies that its instructions contain `why` and `what`
- `collasco_get_module_or_feature_path`: returns the hierarchical path for `Feature 1` in the `Collasco Test Suite` project
- `collasco_get_module_or_feature_path`: returns the hierarchical path for `Submodule 1` in the `Collasco Test Suite` project

## Recommended Configuration

Use environment variables in your AI client's MCP configuration:

```bash
COLLASCO_API_BASE_URL=https://api.collasco.com/v1
COLLASCO_EMAIL=you@example.com
COLLASCO_PASSWORD=your-password
```

Then the AI can call `collasco_list_projects` without needing an explicit login step first.

## Examples In Codex

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
Show the structure of project 7b54eb89-6607-453f-9f62-fc23f535a476.
```

```text
Show the project labels of project 8d1a8d99-987b-4bd0-8a19-ea93fccd95bd.
```

```text
Show the path of feature a3585dad-1bd7-4b44-a357-ba287beef18e in project 8d1a8d99-987b-4bd0-8a19-ea93fccd95bd.
```

```text
Show the path of module d59b5cf1-bc95-438a-af48-9f38544bdb27 in project 8d1a8d99-987b-4bd0-8a19-ea93fccd95bd.
```

## Example MCP Config

The example below works as a reference for clients that support stdio MCP:

```json
{
  "mcpServers": {
    "collasco": {
      "command": "node",
      "args": ["/absolute/path/to/Collasco Back-End/dist/mcp/collasco-mcp.js"],
      "env": {
        "COLLASCO_API_BASE_URL": "https://api.collasco.com/v1",
        "COLLASCO_EMAIL": "you@example.com",
        "COLLASCO_PASSWORD": "your-password"
      }
    }
  }
}
```

## Notes

- This PoC uses the existing user login flow, not API keys or service accounts.
- The session lives only inside the running MCP process.
- For broader external use, a good next step is personal access tokens or integration-specific credentials.

# Agent Instructions

This file is the instruction index for the `ums-api` repository.

Before making changes, read the relevant instruction files below:

- For NestJS backend patterns, modules, controllers, services, DTOs, guards, and filters, read [Backend instructions](docs/agent-instructions/backend.md).
- For Prisma schema changes, migrations, generated clients, and seed data, read [Prisma instructions](docs/agent-instructions/prisma.md).
- For tests, linting, builds, and verification commands, read [Testing instructions](docs/agent-instructions/testing.md).
- For Collasco MCP behavior, server packaging, and Collasco project rules, read [Collasco MCP instructions](docs/agent-instructions/mcp-collasco.md).
- For creating or editing GitHub issues for Collasco, read [GitHub issue instructions](docs/agent-instructions/github-issues.md).

Rules in this `agents.md` always apply. Rules in the linked files apply when working in their area.

## General Rules

- Prefer existing NestJS and Prisma patterns already present in this repository.
- Keep changes scoped to the requested behavior. Do not introduce new frameworks, architectural layers, or broad refactors without explicit approval.
- Do not mutate live Collasco project contents unless the user explicitly names the target project and asks for a mutation.
- Protect secrets and credentials. Do not print `.env` values, tokens, or private keys in responses, logs, tests, or examples.
- Preserve public API behavior unless the user explicitly asks for a breaking change.
- When changing behavior, update or add focused tests when the repository has a nearby test pattern.
- Before finalizing code changes, run the most relevant verification command from `docs/agent-instructions/testing.md` when feasible.

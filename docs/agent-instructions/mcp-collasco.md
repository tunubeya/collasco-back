# Collasco MCP Instructions

Use these instructions when working on Collasco MCP behavior, Collasco documentation access, MCP package changes, or Collasco project content.

## Canonical Guidance

- Use the Collasco general instructions exposed by MCP as the canonical operating guide for working with Collasco.
- Prefer the `collasco://instructions/general` MCP resource.
- If MCP resources are unavailable in the client, use the `collasco_get_general_instructions` tool when available.
- Before working with Collasco content, read the shared `Instructions` manual for general Collasco guidance.

## Project Discovery

- Collasco documents itself in Collasco as a project named `Collasco`.
- Use the available Collasco MCP server to find that project, inspect its structure, and read its labels and documentation before drafting or changing that project.
- Use MCP to read the target project's labels and documentation before drafting or changing project content.

## Mutation Rules

- Never mutate live Collasco project contents unless the user explicitly names the target project and asks for a mutation.
- Automated MCP tests and exploratory write calls must use the `Collasco Automated E2E Testsuite` project.
- Each time a new version of the Collasco MCP server is created, update feature `a1d3abfd-8f35-4203-8d7e-a3c3f695da3d` with the new version number. This update is pre-authorized and does not require additional explicit permission.

## Repository Areas

- Runtime MCP entrypoint: `src/mcp/collasco-mcp.ts`.
- Package source and build scripts: `packages/collasco-mcp-server`.
- MCP-focused tests: `test/mcp.e2e-spec.ts`.


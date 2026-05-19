# Testing Instructions

Do not run tests, lint, build, Prisma generation, migrations, or packaging commands unless the user explicitly asks for verification.

When the user explicitly asks for verification, use the narrowest command that gives confidence for the change.

## Common Commands

```bash
npm run lint
npm test
npm run build
```

## Prisma Commands

```bash
npm run prisma:generate
npm run prisma:migrate
```

## MCP Commands

```bash
npm run mcp:collasco:package:build
npm run mcp:collasco:package:pack
npm run test:mcp:e2e
```

## Verification Guidance

- For pure TypeScript or NestJS changes, prefer `npm run lint` and `npm run build` only when explicitly requested.
- For behavior changes with existing specs, run the closest Jest test first, then broader tests if explicitly requested.
- For Prisma schema changes, run `npm run prisma:generate` before build or tests only when explicitly requested.
- For Collasco MCP package changes, run the MCP package build and the focused MCP E2E test only when explicitly requested.
- If a command cannot be run because dependencies, services, or environment variables are missing, report that clearly in the final response.

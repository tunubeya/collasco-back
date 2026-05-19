# Prisma Instructions

Use these instructions when changing `prisma/schema.prisma`, migrations, seed data, or code that depends on generated Prisma types.

## Schema and Migrations

- Do not edit existing migration files unless the user explicitly asks to repair migration history.
- Never run `npx prisma migrate dev`, `npm run prisma:migrate`, `npx prisma db push`, or equivalent database mutation commands without explicit user approval.
- Before modifying `prisma/schema.prisma`, check whether existing tables/data are affected and explain the impact when it matters.
- If a schema becomes inconsistent after introspection or branch changes, do not try to repair it with additional database changes without asking the user.
- For schema changes, prepare a new migration only when the user explicitly asks and a database is available.
- Regenerate the Prisma client with `npm run prisma:generate` only when explicitly requested.
- After switching branches or applying changes that include Prisma schema updates, recommend these commands only when verification is requested:

```bash
npm run prisma:generate
npm run build
```

## Data Safety

- Avoid destructive schema changes unless the user explicitly approves the data impact.
- When a required column is added to a table with existing rows, include a safe default, backfill, or staged migration approach.
- Be careful with cascade deletes. Verify the expected domain behavior before adding or changing cascading relations.

## Queries

- Prefer Prisma queries that make authorization and project ownership boundaries explicit.
- Select only fields needed by the response when returning user-facing data.
- Keep pagination compatible with the existing `PaginationDto` and `common/utils/pagination.ts` patterns.

## Seed Data

- Keep seed data idempotent when possible.
- Do not put real credentials, tokens, or customer data in seed files.

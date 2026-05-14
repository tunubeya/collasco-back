# Backend Instructions

This repository is a NestJS API. Follow the structure already used under `src/`.

## Structure

- Put request handlers in controllers.
- Put business logic in services.
- Put request validation shapes in DTO classes.
- Put authorization and authentication behavior in guards, decorators, or helpers that match the existing `auth` and `qa` patterns.
- Keep module boundaries clear. Add providers and controllers to the owning NestJS module.

## Controllers

- Keep controllers thin: validate route shape, extract request data, and delegate to services.
- Use existing route naming and REST conventions from nearby controllers.
- Do not put Prisma queries or complex business rules directly in controllers.
- Preserve existing authentication requirements unless the requested change explicitly changes access.

## Services

- Keep Prisma access in services unless there is already a more specific local abstraction.
- Prefer explicit authorization checks near the service method that reads or mutates protected data.
- Keep transactional behavior intentional. Use Prisma transactions when multiple writes must succeed or fail together.
- Avoid broad catch blocks. Let existing exception filters and NestJS exceptions handle errors unless there is a clear domain-specific response.

## DTOs and Validation

- Use `class-validator` and `class-transformer` consistently with existing DTOs.
- Keep DTO fields explicit. Do not accept arbitrary payloads unless the endpoint already does so intentionally.
- For partial updates, follow the existing update DTO style in the same domain.

## Public APIs

- Treat controllers, DTOs, and response shapes as public API.
- If a response shape changes, check the relevant frontend or API consumer expectations before finalizing.
- When adding endpoints, update README endpoint notes only if the change is part of the requested work or directly useful for the user.


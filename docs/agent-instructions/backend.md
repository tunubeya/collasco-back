# Backend Instructions

This repository is a NestJS API. Follow the structure already used under `src/`.

## Repository Notes

- The application uses NestJS with Prisma, JWT access/refresh authentication, Google Cloud Storage for uploaded assets, and Mailgun for email.
- Core domains include users, projects, modules, features, tickets, ticket sections, ticket notification preferences, share links, notifications, test runs, and test cases.
- Do not copy `.env` contents into responses or documentation. Refer to environment variable names only.
- Do not make indentation-only changes.

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
- Main ticket routes include `POST /projects/:projectId/tickets`, `GET /tickets`, `GET /tickets/:id`, `PATCH /tickets/:id`, `POST /tickets/:id/sections`, and `PATCH /tickets/:id/sections/:sectionId`.
- Project routes include `POST /projects`, `GET /projects/mine`, `GET /projects/:id`, `PATCH /projects/:id`, and `DELETE /projects/:id`.

## Services

- Keep Prisma access in services unless there is already a more specific local abstraction.
- Prefer explicit authorization checks near the service method that reads or mutates protected data.
- Keep transactional behavior intentional. Use Prisma transactions when multiple writes must succeed or fail together.
- Avoid broad catch blocks. Let existing exception filters and NestJS exceptions handle errors unless there is a clear domain-specific response.
- Existing ticket services are `TicketsService`, `TicketNotificationService`, `PublicTicketsService`, and `TicketShareLinksService`.
- Existing project, auth, token, and email behavior lives in `ProjectsService`, `AuthService`, `TokensService`, and `EmailService`.
- Use `console.log` for temporary debugging when the user asks for debug logs. Do not leave unrelated debug logs in finalized changes unless requested.
- When changing email or notification behavior, add logs only if they help diagnose the requested issue.

## DTOs and Validation

- Use `class-validator` and `class-transformer` consistently with existing DTOs.
- Keep DTO fields explicit. Do not accept arbitrary payloads unless the endpoint already does so intentionally.
- For partial updates, follow the existing update DTO style in the same domain.

## Public APIs

- Treat controllers, DTOs, and response shapes as public API.
- If a response shape changes, check the relevant frontend or API consumer expectations before finalizing.
- When adding endpoints, update README endpoint notes only if the change is part of the requested work or directly useful for the user.

## Tickets

- Ticket statuses are `OPEN`, `PENDING`, and `RESOLVED`.
- Ticket section types are `DESCRIPTION`, `RESPONSE`, and `COMMENT`.
- Public ticket follow-up uses `followUpToken`.
- External ticket scope should mean tickets with a non-null `publicReporterEmail`.
- Ticket list and count endpoints must always preserve project membership and ticket read permissions. Users must not see tickets from projects where they are not members.

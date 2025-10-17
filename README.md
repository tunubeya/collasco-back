## Commitment convenies

build, chore, ci, docs, feat, fix, perf, refactor, revert, style, test

## Migrations and visualization

```bash
$npx prisma generate
$npx prisma migrate dev -n init
```

Para ver datos:

```bash
$npx prisma studio.
```

## AUTHENTICATION

POST /auth/register — Crea usuario developer + devuelve tokens. · Public · Body: RegisterDto { email, password, name? }

POST /auth/login — Login (estrategia local) + tokens. · Public · Body: { email, password }

GET /auth/me — Perfil mínimo del token. · JWT requerido

# POST /auth/refresh — Rota refresh y devuelve access+refresh. · JWT refresh requerido · Header: Authorization: Bearer <refresh>

POST /auth/logout — Revoca todos los refresh del usuario. · JWT requerido

POST /auth/register-client — (si lo mantienes) Crea user cliente + tokens. · Public · Body: RegisterClientDto

## USERS

GET /users/:id — Perfil por id (incluye githubIdentity si lo tienes así). · JWT

GET /users/me/profile — Perfil completo del usuario actual. · JWT

PATCH /users/me — Actualiza datos básicos (nombre). · JWT · Body: UpdateUserDto

## PROJECTS

POST /projects — Crea proyecto (owner = usuario) y lo agrega como OWNER. · JWT · Body: CreateProjectDto { name, description?, status?, visibility?, repositoryUrl? }

GET /projects/mine — Lista proyectos donde soy owner o miembro. · JWT · Query: PaginationDto { page?, limit?, sort?, q? }

GET /projects/:id — Detalle (owner/miembro o público). · JWT

PATCH /projects/:id — Actualiza (solo owner). · JWT · Body: UpdateProjectDto

DELETE /projects/:id — Elimina (solo owner). · JWT

POST /projects/:id/members — Agrega/actualiza miembro (solo owner). · JWT · Body: AddMemberDto { userId, role? }

# PATCH /projects/:id/members/:userId — Cambia rol de miembro (solo owner). · JWT · Body: { role }

DELETE /projects/:id/members/:userId — Quita miembro (solo owner). · JWT

GET /projects/:id/members — Lista de miembros (convenience). · JWT

GET /projects/:id/github/issues — Issues del repo vinculado. · JWT · Query: ListIssuesDto { state, labels?, since?, assignee?, per_page?, page? }

GET /projects/:id/github/pulls — Pull Requests del repo vinculado. · JWT · Query: ListPullsDto { state, sort?, direction?, per_page?, page? }

# POST /projects/:id/github/credential — Sube/actualiza credencial GitHub del proyecto. · JWT · Body: { accessToken, refreshToken?, tokenType?, scopes?, expiresAt? }

# DELETE /projects/:id/github/credential — Borra credencial de proyecto. · JWT

GitHub (cuenta del usuario)

GET /github/whoami — Whoami usando token global (o ninguno). · Public

POST /github/me/token — Conecta/actualiza token GitHub del usuario. · JWT · Body: { token }

DELETE /github/me/token — Desconecta token del usuario. · JWT

GET /github/me/whoami — Estado de conexión GitHub del usuario actual. · JWT

# POST /projects/:id/token - Guarda/actualiza token del proyecto (requiere ser owner del proyecto)

# DELETE /projects/:id/token - Elimina el token del proyecto (owner-only)

## Modules

POST /projects/:projectId/modules — Crea módulo (OWNER/MAINTAINER). · JWT · Body: CreateModuleDto { name, description?, parentModuleId?, isRoot? }

GET /projects/:projectId/modules — Lista módulos (paginado) del proyecto. · JWT · Query: PaginationDto + parent (uuid | null | omitido)

GET /modules/:moduleId — Detalle de módulo (hijos, features, versiones resumidas). · JWT

PATCH /modules/:moduleId — Actualiza módulo (OWNER/MAINTAINER). · JWT · Body: UpdateModuleDto

DELETE /modules/:moduleId - cascade (opcional, boolean) → Elimina también submódulos y features. force(opcional, boolean) → Permite borrar aunque haya publicaciones.

GET /modules/:moduleId/versions — Lista versiones del módulo (desc). · JWT

POST /modules/:moduleId/snapshot — Crea snapshot (dedupe por contentHash). · JWT · Body: SnapshotModuleDto { changelog? }

POST /modules/:moduleId/rollback/:versionNumber — Restaura estado y crea snapshot marcado rollback. · JWT

POST /modules/:moduleId/publish — Publica una versión del módulo. · JWT Body: PublishDto {versionNumber}

GET /modules/:moduleId/published-tree — Devuelve el árbol publicado resolviendo childrenPins/featurePins. · JWT

# PATCH /modules/:moduleId/move — Mover/reordenar módulo (cambia parentModuleId y/o sortOrder). · JWT · Body: { parentModuleId?: uuid|null, sortOrder?: number }

## Features

POST /modules/:moduleId/features — Crea feature dentro del módulo. · JWT · Body: CreateFeatureDto { name, description?, priority?, status? }

GET /modules/:moduleId/features — Lista features del módulo (paginado). · JWT · Query: PaginationDto

GET /features/:featureId — Detalle de feature (versions, issue, publicada). · JWT

PATCH /features/:featureId — Actualiza feature. · JWT · Body: UpdateFeatureDto

DELETE /features/:featureId -Query params: force (opcional, boolean) → Si está publicada, obliga a eliminar.

GET /features/:featureId/versions — Lista versiones de la feature. · JWT

POST /features/:featureId/snapshot — Snapshot (dedupe por contentHash). · JWT · Body: SnapshotFeatureDto { changelog? }

POST /features/:featureId/rollback/:versionNumber — Restaura y registra snapshot rollback. · JWT

POST /features/:featureId/publish/:versionNumber — Publica versión de la feature. · JWT

Features ↔ Issue (GitHub)

POST /features/:featureId/issue — Linkea/crea IssueElement con issue/PR/commits. · JWT · Body: LinkIssueElementDto { githubIssueUrl?, pullRequestUrl?, commitHashes?, reviewStatus? }

PATCH /issue/:issueId — Actualiza issue (URLs, commits, estado). · JWT · Body: LinkIssueElementDto

DELETE /issue/:issueId — Desvincula issue. · JWT

POST /issue/:issueId/sync — Sincroniza estado desde GitHub (PR merged ⇒ APPROVED; agrega commits del PR). · JWT · Throttle

POST /issue/:issueId/sync-commits — Sincroniza solo commits del PR. · JWT · Body: SyncCommitsDto { append?=true, limit? } · Throttle

Mini tabla express
Acción Crea una versión Cambia lo visible Dedupe por hash Usa pins (módulos)
Snapshot ✅ ❌ ✅ ✅
Publicar ❌ ✅ (publishedVersionId) ❌ (n/a)

# Backend - Información y Guías

## Reglas Importantes

### ⚠️ Migraciones de Base de Datos

- **NUNCA** ejecutar `npx prisma migrate dev` sin permiso explícito del usuario
- **NUNCA** ejecutar `npx prisma db push` sin permiso explícito
- Antes de hacer cualquier cambio en la base de datos, informar al usuario y esperar confirmación

### ⚠️ Cambios en Schema

- Antes de modificar `prisma/schema.prisma`, verificar si hay tablas existentes afectadas
- Si el schema se rompe tras un `db pull`, no intentar "arreglarlo" con más cambios sin consultar

### ⚠️ Debugging

- Usar `console.log` en lugar de Logger de NestJS para debugging
- Agregar logs al enviar emails o notificaciones

---

## Base de Datos

### Credenciales

- **URL**: `postgresql://ums:ums@localhost:5433/umsdb`
- **Host**: localhost:5433
- **Usuario**: ums
- **Contraseña**: ums
- **Nombre BD**: umsdb

### Tablas Principales

- `User` - Usuarios del sistema
- `Project` - Proyectos
- `Feature` - Features dentro de módulos
- `Module` - Módulos
- `Ticket` - Tickets
- `TicketSection` - Secciones de tickets
- `TicketNotifyUser` - Usuarios a notificar in-app por ticket
- `TicketEmailUser` - Usuarios a enviar email por ticket
- `TicketShareLink` - Links públicos para compartir tickets
- `Notification` - Notificaciones in-app
- `TestRun` - Ejecuciones de tests
- `TestCase` - Casos de test

### Enums Principales

- `UserRole`: ADMIN, DEVELOPER, TESTER
- `ProjectStatus`: ACTIVE, ON_HOLD, FINISHED
- `TicketStatus`: OPEN, PENDING, RESOLVED
- `TicketSectionType`: DESCRIPTION, RESPONSE, COMMENT

---

## Servicios Existentes

### Tickets

- `TicketsService` - CRUD de tickets
- `TicketNotificationService` - Notificaciones de tickets (in-app y email)
- `PublicTicketsService` - Tickets públicos (vía followUpToken)
- `TicketShareLinksService` - Gestión de links para compartir tickets

### Proyectos

- `ProjectsService` - Gestión de proyectos

### Email

- `EmailService` - Envío de emails via Mailgun

### Autenticación

- `AuthService` - Login, register, password reset
- `TokensService` - Gestión de tokens JWT

---

## Endpoints Principales

### Tickets

- `POST /projects/:projectId/tickets` - Crear ticket
- `GET /tickets` - Listar tickets (soporta scope: ALL, ACCESSIBLE, ASSIGNED, EXTERNAL, NONE)
- `GET /tickets/:id` - Obtener ticket
- `PATCH /tickets/:id` - Actualizar ticket
- `POST /tickets/:id/sections` - Añadir sección
- `PATCH /tickets/:id/sections/:sectionId` - Actualizar sección

### Notificaciones de Tickets

- `GET /tickets/:id/notify-users` - Listar usuarios a notificar
- `POST /tickets/:id/notify-users` - Agregar usuario a notificaciones
- `DELETE /tickets/:id/notify-users/:userId` - Quitar usuario de notificaciones
- `GET /tickets/:id/email-users` - Listar usuarios que reciben email
- `POST /tickets/:id/email-users` - Agregar usuario a lista de emails
- `DELETE /tickets/:id/email-users/:userId` - Quitar usuario de lista de emails

### Share Links de Tickets

- `POST /projects/:projectId/tickets/:ticketId/share` - Crear link de compartir
- `GET /tickets/share/:token` - Ver ticket via share link

### Tickets Públicos (seguimiento externo)

- `GET /public/tickets/follow/:token` - Ver ticket público
- `GET /public/tickets/follow/:token/sections` - Ver secciones del ticket público

### Proyectos

- `POST /projects` - Crear proyecto
- `GET /projects/mine` - Listar mis proyectos (incluye `hasAccess` por proyecto)
- `GET /projects/:id` - Obtener proyecto
- `PATCH /projects/:id` - Actualizar proyecto
- `DELETE /projects/:id` - Eliminar proyecto

### Preferencias de Notificaciones

- `PATCH /users/me/ticket-notification-prefs` - Preferencias globales
- `POST /users/me/ticket-notification-prefs/:ticketId` - Pref por ticket
- `DELETE /users/me/ticket-notification-prefs/:ticketId` - Eliminar pref
- `GET /users/me/ticket-notification-prefs/:ticketId` - Ver pref

---

## Variables de Entorno (.env)

```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://ums:ums@localhost:5433/umsdb

JWT_SECRET=...
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

GOOGLE_CLOUD_PROJECT_ID=...
GOOGLE_CLOUD_KEY_JSON_B64=...
GOOGLE_CLOUD_BUCKET_NAME=qms-system

MAILGUN_API_KEY=your-mailgun-api-key
MAILGUN_DOMAIN=your-mailgun-domain
MAILGUN_FROM_EMAIL=noreply@yourdomain.com
FRONTEND_URL=http://localhost:3001
```

---

## Comandos Útiles

### Desarrollo

```bash
npm run start:dev        # Iniciar en modo desarrollo
npm run build           # Compilar
npm run lint            # Linter
```

### Base de Datos

```bash
npx prisma generate     # Regenerar cliente Prisma
npx prisma studio       # Abrir GUI de Prisma
psql ...                # Cliente PostgreSQL
```

---

## Notas

- El proyecto usa NestJS con Prisma
- Autenticación con JWT (access + refresh tokens)
- Storage en Google Cloud Storage
- Emails via Mailgun
- Tickets pueden tener links públicos de seguimiento (followUpToken)
- Share links permiten compartir tickets externamente
- Scope EXTERNAL en tickets filtra solo tickets con publicReporterEmail no nulo

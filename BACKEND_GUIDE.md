# Backend - Información y Guías

## Reglas Importantes

### ⚠️ Migraciones de Base de Datos

- **NUNCA** ejecutar `npx prisma migrate dev` sin permiso explícito del usuario
- **NUNCA** ejecutar `npx prisma db push` sin permiso explícito
- Antes de hacer cualquier cambio en la base de datos, informar al usuario y esperar confirmación

### ⚠️ Cambios en Schema

- Antes de modificar `prisma/schema.prisma`, verificar si hay tablas existentes afectadas
- Si el schema se rompe tras un `db pull`, no intentar "arreglarlo" con más cambios sin consultar

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
- `Notification` - Notificaciones in-app
- `TestRun` - Ejecuciones de tests
- `TestCase` - Casos de test

### Enums Principales

- `UserRole`: ADMIN, DEVELOPER, TESTER
- `ProjectStatus`: ACTIVE, ON_HOLD, FINISHED
- `TicketStatus`: OPEN, PENDING, CLOSED, RESOLVED
- `TicketNotificationScope`: ALL, ACCESSIBLE, ASSIGNED, NONE

---

## Servicios Existentes

### Tickets

- `TicketsService` - CRUD de tickets
- `TicketNotificationService` - Notificaciones de tickets
- `PublicTicketsService` - Tickets públicos (vía followUpToken)

### Proyectos

- `ProjectsService` - Gestión de proyectos

### Autenticación

- `AuthService` - Login, register, password reset
- `TokensService` - Gestión de tokens JWT

---

## Endpoints Principales

### Tickets

- `POST /projects/:projectId/tickets` - Crear ticket
- `GET /tickets` - Listar tickets
- `GET /tickets/:id` - Obtener ticket
- `PATCH /tickets/:id` - Actualizar ticket
- `POST /tickets/:id/sections` - Añadir sección
- `PATCH /tickets/:id/sections/:sectionId` - Actualizar sección

### Preferencias de Notificaciones (nuevos)

- `PATCH /users/me/ticket-notification-prefs` - Preferencias globales
- `POST /users/me/ticket-notification-prefs/:ticketId` - Pref por ticket
- `DELETE /users/me/ticket-notification-prefs/:ticketId` - Eliminar pref
- `GET /users/me/ticket-notification-prefs/:ticketId` - Ver pref

### Tickets Públicos

- `GET /public/tickets/follow/:followUpToken` - Ver ticket público

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

# Mailgun (pendiente de configurar)
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

## Pendiente por Configurar

- **Mailgun**: Esperando credenciales del usuario para terminar integración de emails

---

## Notas

- El proyecto usa NestJS con Prisma
- Autenticación con JWT (access + refresh tokens)
- storage en Google Cloud Storage

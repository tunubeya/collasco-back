# Collasco MCP PoC

Deze proof of concept voegt een kleine MCP-server toe bovenop de bestaande Collasco API. Daardoor kan een AI-client via tools inloggen en projecten ophalen zonder directe toegang tot de codebase.

## Wat deze PoC doet

- logt in via `POST /v1/auth/login`
- bewaart access en refresh token in het MCP-proces
- haalt projecten op via `GET /v1/projects/mine`
- refresht automatisch wanneer een access token vervalt

## Beschikbare tools

- `collasco_login`
- `collasco_list_projects`
- `collasco_search_projects`
- `collasco_get_project`
- `collasco_get_project_structure`

## Om te bouwen en starten

```bash
npm run prisma:generate
npm run build
npm run mcp:collasco
```

Na een branchwissel met Prisma schema-wijzigingen moet je eerst `npm run prisma:generate` uitvoeren. Anders kan `npm run build` falen door een verouderde Prisma client, ook als de schemafile zelf correct is.

## MCP test suite

Er is een live MCP integratietest aanwezig in:

`test/mcp.e2e-spec.ts`

Deze test gebruikt dezelfde loginflow als de MCP-server en spreekt de live Collasco API aan. Daardoor heb je geldige `COLLASCO_*` credentials nodig en netwerktoegang naar de API.

## MCP tests uitvoeren

```bash
npm run prisma:generate
npx jest --config ./test/jest-e2e.json --runInBand test/mcp.e2e-spec.ts
```

## Huidige MCP tests

- `logs into Collasco successfully`
- `finds the Collasco Test Suite project through the project listing flow`

## Aanbevolen configuratie

Gebruik environment variables in de MCP-config van je AI-client:

```bash
COLLASCO_API_BASE_URL=https://api.collasco.com/v1
COLLASCO_EMAIL=you@example.com
COLLASCO_PASSWORD=your-password
```

Dan kan de AI gewoon `collasco_list_projects` oproepen zonder eerst expliciet te loggen.

## Voorbeelden in Codex

```text
Toon mijn Collasco-projecten.
```

```text
Zoek in mijn Collasco-projecten naar "orderflow".
```

```text
Haal project 7b54eb89-6607-453f-9f62-fc23f535a476 op.
```

```text
Toon de structuur van project 7b54eb89-6607-453f-9f62-fc23f535a476.
```

## Voorbeeld MCP-config

Onderstaande vorm werkt als referentie voor clients die stdio-MCP ondersteunen:

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

## Opmerkingen

- Deze PoC gebruikt bestaande user login, niet API keys of service accounts.
- De sessie leeft alleen in het draaiende MCP-proces.
- Voor breder extern gebruik is een volgende stap: personal access tokens of integratie-specifieke credentials.

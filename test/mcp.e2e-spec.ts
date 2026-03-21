import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CollascoApiClient } from '../src/mcp/collasco-mcp';

type McpTestConfig = {
  apiBaseUrl: string;
  email: string;
  password: string;
};

type ProjectListResult = {
  items?: Array<{
    id: string;
    name: string;
  }>;
};

function loadConfigFromCodex(): Partial<McpTestConfig> {
  const configPath = join(homedir(), '.codex', 'config.toml');
  if (!existsSync(configPath)) return {};

  const config = readFileSync(configPath, 'utf8');
  const values: Partial<McpTestConfig> = {};

  for (const line of config.split(/\r?\n/)) {
    const match = line.match(/^(COLLASCO_[A-Z_]+)\s*=\s*"([^"]*)"$/);
    if (!match) continue;

    const [, key, value] = match;
    if (key === 'COLLASCO_API_BASE_URL') values.apiBaseUrl = value;
    if (key === 'COLLASCO_EMAIL') values.email = value;
    if (key === 'COLLASCO_PASSWORD') values.password = value;
  }

  return values;
}

function resolveTestConfig(): McpTestConfig | null {
  const fallback = loadConfigFromCodex();
  const apiBaseUrl = process.env.COLLASCO_API_BASE_URL ?? fallback.apiBaseUrl;
  const email = process.env.COLLASCO_EMAIL ?? fallback.email;
  const password = process.env.COLLASCO_PASSWORD ?? fallback.password;

  if (!apiBaseUrl || !email || !password) return null;

  return { apiBaseUrl, email, password };
}

const config = resolveTestConfig();
const maybeIt = config ? it : it.skip;

describe('Collasco MCP (e2e)', () => {
  maybeIt('tool: collasco_login - logs into Collasco successfully', async () => {
    const client = new CollascoApiClient(config!.apiBaseUrl);

    const auth = await client.login(config!.email, config!.password);

    expect(auth.user.email).toBe(config!.email);
    expect(auth.accessToken).toBeTruthy();
    expect(auth.refreshToken).toBeTruthy();
  });

  maybeIt(
    'tool: collasco_list_projects - finds the Collasco Test Suite project through the project listing flow',
    async () => {
    const client = new CollascoApiClient(config!.apiBaseUrl);

    await client.login(config!.email, config!.password);

    const result = (await client.listProjects({})) as ProjectListResult;
    const names = (result.items ?? []).map((project) => project.name);

    expect(names).toContain('Collasco Test Suite');
    },
  );

  maybeIt(
    'tool: collasco_search_projects - finds the Collasco Test Suite project when searching for Test Suite',
    async () => {
    const client = new CollascoApiClient(config!.apiBaseUrl);

    await client.login(config!.email, config!.password);

    const result = (await client.listProjects({ q: 'Test Suite' })) as ProjectListResult;
    const names = (result.items ?? []).map((project) => project.name);

    expect(names).toContain('Collasco Test Suite');
    },
  );
});

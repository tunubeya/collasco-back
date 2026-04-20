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

type ProjectLabelResult = Array<{
  id: string;
  name: string;
  instructions: string | null;
}>;

type StructureNode = {
  type: 'module' | 'feature';
  id: string;
  name: string;
  items?: StructureNode[];
};

type ProjectStructureResult = {
  modules?: StructureNode[];
};

type ModuleOrFeaturePathResult = {
  id: string;
  name: string;
  type: 'module' | 'feature';
  path: string[];
  pathText: string;
};

function findModuleByName(items: StructureNode[] | undefined, name: string): StructureNode | null {
  for (const item of items ?? []) {
    if (item.type === 'module' && item.name === name) return item;

    const child = findModuleByName(item.items, name);
    if (child) return child;
  }

  return null;
}

function findFeatureByName(items: StructureNode[] | undefined, name: string): StructureNode | null {
  for (const item of items ?? []) {
    if (item.type === 'feature' && item.name === name) return item;

    const child = findFeatureByName(item.items, name);
    if (child) return child;
  }

  return null;
}

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

  maybeIt(
    'tool: collasco_get_project_labels - returns the Overview label with instructions containing why and what',
    async () => {
      const client = new CollascoApiClient(config!.apiBaseUrl);

      await client.login(config!.email, config!.password);

      const projectList = (await client.listProjects({ q: 'Collasco Test Suite' })) as ProjectListResult;
      const project = (projectList.items ?? []).find((entry) => entry.name === 'Collasco Test Suite');

      expect(project).toBeDefined();

      const labels = (await client.getProjectLabels(project?.id)) as ProjectLabelResult;
      const overview = labels.find((label) => label.name === 'Overview');

      expect(overview).toBeDefined();
      expect(overview?.instructions?.toLowerCase()).toContain('why');
      expect(overview?.instructions?.toLowerCase()).toContain('what');
    },
  );

  maybeIt(
    'tool: collasco_get_module_or_feature_path - returns the hierarchical path for Feature 1 in Collasco Test Suite',
    async () => {
      const client = new CollascoApiClient(config!.apiBaseUrl);

      await client.login(config!.email, config!.password);

      const projectList = (await client.listProjects({ q: 'Collasco Test Suite' })) as ProjectListResult;
      const project = (projectList.items ?? []).find((entry) => entry.name === 'Collasco Test Suite');

      expect(project).toBeDefined();

      const structure = (await client.getProjectStructure(project?.id)) as ProjectStructureResult;
      const feature = findFeatureByName(structure.modules, 'Feature 1');

      expect(feature).toBeDefined();

      const path = (await client.getModuleOrFeaturePath(
        project?.id,
        feature?.id,
        'Collasco Test Suite',
      )) as ModuleOrFeaturePathResult;

      expect(path).toMatchObject({
        id: feature?.id,
        name: 'Feature 1',
        type: 'feature',
        path: ['Collasco Test Suite', 'Module structure', 'Submodule 1', 'Feature 1'],
        pathText: 'Collasco Test Suite -> Module structure -> Submodule 1 -> Feature 1',
      });
    },
  );

  maybeIt(
    'tool: collasco_get_module_or_feature_path - returns the hierarchical path for Submodule 1 in Collasco Test Suite',
    async () => {
      const client = new CollascoApiClient(config!.apiBaseUrl);

      await client.login(config!.email, config!.password);

      const projectList = (await client.listProjects({ q: 'Collasco Test Suite' })) as ProjectListResult;
      const project = (projectList.items ?? []).find((entry) => entry.name === 'Collasco Test Suite');

      expect(project).toBeDefined();

      const structure = (await client.getProjectStructure(project?.id)) as ProjectStructureResult;
      const module = findModuleByName(structure.modules, 'Submodule 1');

      expect(module).toBeDefined();

      const path = (await client.getModuleOrFeaturePath(
        project?.id,
        module?.id,
        'Collasco Test Suite',
      )) as ModuleOrFeaturePathResult;

      expect(path).toMatchObject({
        id: module?.id,
        name: 'Submodule 1',
        type: 'module',
        path: ['Collasco Test Suite', 'Module structure', 'Submodule 1'],
        pathText: 'Collasco Test Suite -> Module structure -> Submodule 1',
      });
    },
  );
});

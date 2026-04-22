import http from 'node:http';
import https from 'node:https';

type JsonRpcId = number | string | null;

type JsonRpcResponse<T = unknown> = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type ToolTextResult = {
  content?: Array<{
    type: string;
    text?: string;
  }>;
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

const DEFAULT_MCP_URL = 'http://127.0.0.1:3333/mcp';
const mcpUrl = process.env.COLLASCO_MCP_URL ?? DEFAULT_MCP_URL;
const bearerToken = process.env.COLLASCO_MCP_ACCESS_TOKEN ?? process.env.COLLASCO_ACCESS_TOKEN;

let nextId = 1;

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

function postJsonRpc<T>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<JsonRpcResponse<T>> {
  const url = new URL(mcpUrl);
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: nextId++,
    method,
    params,
  });
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
        },
        timeout: 30_000,
      },
      (response) => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () => {
          if (!responseBody) {
            reject(new Error(`Empty MCP response with HTTP status ${response.statusCode}`));
            return;
          }

          try {
            const parsed = JSON.parse(responseBody) as JsonRpcResponse<T>;
            if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
              reject(
                new Error(
                  `MCP request failed with HTTP status ${response.statusCode}: ${responseBody}`,
                ),
              );
              return;
            }

            resolve(parsed);
          } catch (error) {
            reject(
              new Error(
                `Invalid MCP JSON response with HTTP status ${response.statusCode}: ${responseBody}`,
              ),
            );
          }
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error(`Timed out connecting to running MCP server at ${mcpUrl}`));
    });
    request.on('error', (error) => {
      reject(
        new Error(
          `Could not call running MCP server at ${mcpUrl}. Start it with npm run mcp:collasco:http:login before running these tests. ${error.message}`,
        ),
      );
    });
    request.end(body);
  });
}

async function rpcResult<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const response = await postJsonRpc<T>(method, params);

  if (response.error) {
    throw new Error(`MCP ${method} failed: ${response.error.message}`);
  }

  return response.result as T;
}

async function callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await rpcResult<ToolTextResult>('tools/call', {
    name,
    arguments: args,
  });
  const text = result.content?.find((entry) => entry.type === 'text')?.text;

  if (!text) {
    throw new Error(`MCP tool ${name} returned no text content.`);
  }

  return JSON.parse(text) as T;
}

describe('Collasco MCP HTTP server (e2e)', () => {
  it('responds to initialize through the running MCP server', async () => {
    const result = await rpcResult<{
      serverInfo?: {
        name?: string;
        version?: string;
      };
    }>('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'collasco-mcp-e2e',
        version: '0.0.0',
      },
    });

    expect(result.serverInfo?.name).toBe('collasco-mcp');
  });

  it('lists the expected Collasco MCP tools', async () => {
    const result = await rpcResult<{
      tools?: Array<{
        name: string;
      }>;
    }>('tools/list');
    const toolNames = (result.tools ?? []).map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        'collasco_list_projects',
        'collasco_search_projects',
        'collasco_get_project',
        'collasco_get_project_structure',
        'collasco_get_project_labels',
        'collasco_get_module_or_feature_path',
      ]),
    );
  });

  it('tool: collasco_list_projects - finds the Collasco Test Suite project through the project listing flow', async () => {
    const result = await callTool<ProjectListResult>('collasco_list_projects');
    const names = (result.items ?? []).map((project) => project.name);

    expect(names).toContain('Collasco Test Suite');
  });

  it('tool: collasco_search_projects - finds the Collasco Test Suite project when searching for Test Suite', async () => {
    const result = await callTool<ProjectListResult>('collasco_search_projects', { q: 'Test Suite' });
    const names = (result.items ?? []).map((project) => project.name);

    expect(names).toContain('Collasco Test Suite');
  });

  it('tool: collasco_get_project_labels - returns the Overview label with instructions containing why and what', async () => {
    const projectList = await callTool<ProjectListResult>('collasco_search_projects', {
      q: 'Collasco Test Suite',
    });
    const project = (projectList.items ?? []).find((entry) => entry.name === 'Collasco Test Suite');

    expect(project).toBeDefined();

    const labels = await callTool<ProjectLabelResult>('collasco_get_project_labels', {
      projectId: project?.id,
    });
    const overview = labels.find((label) => label.name === 'Overview');

    expect(overview).toBeDefined();
    expect(overview?.instructions?.toLowerCase()).toContain('why');
    expect(overview?.instructions?.toLowerCase()).toContain('what');
  });

  it('tool: collasco_get_module_or_feature_path - returns the hierarchical path for Feature 1 in Collasco Test Suite', async () => {
    const projectList = await callTool<ProjectListResult>('collasco_search_projects', {
      q: 'Collasco Test Suite',
    });
    const project = (projectList.items ?? []).find((entry) => entry.name === 'Collasco Test Suite');

    expect(project).toBeDefined();

    const structure = await callTool<ProjectStructureResult>('collasco_get_project_structure', {
      projectId: project?.id,
    });
    const feature = findFeatureByName(structure.modules, 'Feature 1');

    expect(feature).toBeDefined();

    const path = await callTool<ModuleOrFeaturePathResult>('collasco_get_module_or_feature_path', {
      projectId: project?.id,
      moduleOrFeatureId: feature?.id,
      projectName: 'Collasco Test Suite',
    });

    expect(path).toMatchObject({
      id: feature?.id,
      name: 'Feature 1',
      type: 'feature',
      path: ['Collasco Test Suite', 'Module structure', 'Submodule 1', 'Feature 1'],
      pathText: 'Collasco Test Suite -> Module structure -> Submodule 1 -> Feature 1',
    });
  });

  it('tool: collasco_get_module_or_feature_path - returns the hierarchical path for Submodule 1 in Collasco Test Suite', async () => {
    const projectList = await callTool<ProjectListResult>('collasco_search_projects', {
      q: 'Collasco Test Suite',
    });
    const project = (projectList.items ?? []).find((entry) => entry.name === 'Collasco Test Suite');

    expect(project).toBeDefined();

    const structure = await callTool<ProjectStructureResult>('collasco_get_project_structure', {
      projectId: project?.id,
    });
    const module = findModuleByName(structure.modules, 'Submodule 1');

    expect(module).toBeDefined();

    const path = await callTool<ModuleOrFeaturePathResult>('collasco_get_module_or_feature_path', {
      projectId: project?.id,
      moduleOrFeatureId: module?.id,
      projectName: 'Collasco Test Suite',
    });

    expect(path).toMatchObject({
      id: module?.id,
      name: 'Submodule 1',
      type: 'module',
      path: ['Collasco Test Suite', 'Module structure', 'Submodule 1'],
      pathText: 'Collasco Test Suite -> Module structure -> Submodule 1',
    });
  });
});

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

type ProjectDocumentationResult = Array<{
  label: {
    id: string;
    name: string;
  };
  field: {
    id: string;
    content: string | null;
    isNotApplicable: boolean;
  } | null;
}>;

type CreatedModuleResult = {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
};

type CreatedFeatureResult = {
  id: string;
  moduleId: string;
  name: string;
  description: string | null;
  priority: string | null;
  status: string | null;
};

type DeleteModuleResult = {
  ok: boolean;
  deletedModuleIds: string[];
};

type DeleteFeatureResult = {
  ok: boolean;
  deletedFeatureId: string;
};

const DEFAULT_MCP_URL = 'http://127.0.0.1:3333/mcp';
const E2E_PROJECT_NAME = 'Collasco Automated E2E Testsuite';
const mcpUrl = process.env.COLLASCO_MCP_URL ?? DEFAULT_MCP_URL;
const bearerToken = process.env.COLLASCO_MCP_ACCESS_TOKEN ?? process.env.COLLASCO_ACCESS_TOKEN;

let nextId = 1;

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
        'collasco_get_project_labels',
        'collasco_get_project_documentation',
        'collasco_get_module_documentation',
        'collasco_get_feature_documentation',
        'collasco_create_module',
        'collasco_create_feature',
        'collasco_update_module',
        'collasco_update_feature',
        'collasco_delete_module',
        'collasco_delete_feature',
        'collasco_update_documentation',
      ]),
    );
  });

  it('tool: collasco_list_projects - finds the automated E2E project through the project listing flow', async () => {
    const result = await callTool<ProjectListResult>('collasco_list_projects');
    const names = (result.items ?? []).map((project) => project.name);

    expect(names).toContain(E2E_PROJECT_NAME);
  });

  it('tool: collasco_search_projects - finds the automated E2E project when searching by name', async () => {
    const result = await callTool<ProjectListResult>('collasco_search_projects', {
      q: E2E_PROJECT_NAME,
    });
    const names = (result.items ?? []).map((project) => project.name);

    expect(names).toContain(E2E_PROJECT_NAME);
  });

  it('tool: collasco_get_project_labels - returns the Overview label with instructions containing why and what', async () => {
    const projectList = await callTool<ProjectListResult>('collasco_search_projects', {
      q: E2E_PROJECT_NAME,
    });
    const project = (projectList.items ?? []).find((entry) => entry.name === E2E_PROJECT_NAME);

    expect(project).toBeDefined();

    const labels = await callTool<ProjectLabelResult>('collasco_get_project_labels', {
      projectId: project?.id,
    });
    const overview = labels.find((label) => label.name === 'Overview');

    expect(overview).toBeDefined();
    expect(overview?.instructions?.toLowerCase()).toContain('why');
    expect(overview?.instructions?.toLowerCase()).toContain('what');
  });

  it('tool: collasco_get_project_documentation - returns documentation entries for the automated E2E project', async () => {
    const projectList = await callTool<ProjectListResult>('collasco_search_projects', {
      q: E2E_PROJECT_NAME,
    });
    const project = (projectList.items ?? []).find((entry) => entry.name === E2E_PROJECT_NAME);

    expect(project).toBeDefined();

    const documentation = await callTool<ProjectDocumentationResult>(
      'collasco_get_project_documentation',
      {
        projectId: project?.id,
      },
    );

    expect(Array.isArray(documentation)).toBe(true);
    expect(documentation.length).toBeGreaterThan(0);
    expect(documentation[0]?.label?.id).toBeDefined();
    expect(documentation[0]?.label?.name).toBeDefined();
  });

  it('tool: module/feature CRUD and documentation update - creates, updates, documents, and deletes E2E records', async () => {
    const projectList = await callTool<ProjectListResult>('collasco_search_projects', {
      q: E2E_PROJECT_NAME,
    });
    const project = (projectList.items ?? []).find((entry) => entry.name === E2E_PROJECT_NAME);

    expect(project).toBeDefined();

    const labels = await callTool<ProjectLabelResult>('collasco_get_project_labels', {
      projectId: project?.id,
    });
    const overview = labels.find((label) => label.name === 'Overview');

    expect(overview).toBeDefined();

    const suffix = `${Date.now()}`;
    let module: CreatedModuleResult | undefined;
    let feature: CreatedFeatureResult | undefined;

    try {
      module = await callTool<CreatedModuleResult>('collasco_create_module', {
        projectId: project?.id,
        name: `MCP E2E Module ${suffix}`,
        description: 'Created by the Collasco MCP automated E2E suite.',
      });

      expect(module.id).toBeDefined();
      expect(module.projectId).toBe(project?.id);
      expect(module.name).toBe(`MCP E2E Module ${suffix}`);

      const updatedModule = await callTool<CreatedModuleResult>('collasco_update_module', {
        moduleId: module.id,
        name: `MCP E2E Module ${suffix} Updated`,
        description: 'Updated by the Collasco MCP automated E2E suite.',
      });

      expect(updatedModule.name).toBe(`MCP E2E Module ${suffix} Updated`);

      feature = await callTool<CreatedFeatureResult>('collasco_create_feature', {
        moduleId: module.id,
        name: `MCP E2E Feature ${suffix}`,
        description: 'Created by the Collasco MCP automated E2E suite.',
        priority: 'MEDIUM',
        status: 'PENDING',
      });

      expect(feature.id).toBeDefined();
      expect(feature.moduleId).toBe(module.id);
      expect(feature.name).toBe(`MCP E2E Feature ${suffix}`);
      expect(feature.priority).toBe('MEDIUM');
      expect(feature.status).toBe('PENDING');

      const updatedFeature = await callTool<CreatedFeatureResult>('collasco_update_feature', {
        featureId: feature.id,
        name: `MCP E2E Feature ${suffix} Updated`,
        description: 'Updated by the Collasco MCP automated E2E suite.',
        priority: 'HIGH',
        status: 'IN_PROGRESS',
      });

      expect(updatedFeature.name).toBe(`MCP E2E Feature ${suffix} Updated`);
      expect(updatedFeature.priority).toBe('HIGH');
      expect(updatedFeature.status).toBe('IN_PROGRESS');

      const moduleDocumentation = await callTool<ProjectDocumentationResult>(
        'collasco_update_documentation',
        {
          entityType: 'module',
          entityId: module.id,
          labelId: overview?.id,
          content: `MCP module documentation ${suffix}`,
          isNotApplicable: false,
        },
      );
      const updatedModuleOverview = moduleDocumentation.find(
        (entry) => entry.label.name === 'Overview',
      );

      expect(updatedModuleOverview?.field?.content).toBe(`MCP module documentation ${suffix}`);
      expect(updatedModuleOverview?.field?.isNotApplicable).toBe(false);

      const featureDocumentation = await callTool<ProjectDocumentationResult>(
        'collasco_update_documentation',
        {
          entityType: 'feature',
          entityId: feature.id,
          labelId: overview?.id,
          content: `MCP feature documentation ${suffix}`,
          isNotApplicable: false,
        },
      );
      const updatedFeatureOverview = featureDocumentation.find(
        (entry) => entry.label.name === 'Overview',
      );

      expect(updatedFeatureOverview?.field?.content).toBe(`MCP feature documentation ${suffix}`);
      expect(updatedFeatureOverview?.field?.isNotApplicable).toBe(false);
    } finally {
      if (feature?.id) {
        const deletedFeature = await callTool<DeleteFeatureResult>('collasco_delete_feature', {
          featureId: feature.id,
        });
        expect(deletedFeature.ok).toBe(true);
        expect(deletedFeature.deletedFeatureId).toBe(feature.id);
      }

      if (module?.id) {
        const deletedModule = await callTool<DeleteModuleResult>('collasco_delete_module', {
          moduleId: module.id,
        });
        expect(deletedModule.ok).toBe(true);
        expect(deletedModule.deletedModuleIds).toContain(module.id);
      }
    }
  });

  it('tool: collasco_get_feature_documentation - returns documentation entries for the Manual feature', async () => {
    const documentation = await callTool<ProjectDocumentationResult>(
      'collasco_get_feature_documentation',
      {
        featureId: '0a229c8d-1db5-4a1d-8730-961bdbca9193',
      },
    );

    expect(Array.isArray(documentation)).toBe(true);
    expect(documentation.length).toBeGreaterThan(0);
    expect(documentation[0]?.label?.id).toBeDefined();
    expect(documentation[0]?.label?.name).toBeDefined();
  });
});

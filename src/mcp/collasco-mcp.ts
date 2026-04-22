import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type AuthState = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpirationDate: string | null;
  refreshTokenExpirationDate: string | null;
  user: {
    id: string;
    email: string;
    role: string;
  };
};

type TokenSet = Pick<
  AuthState,
  'accessToken' | 'refreshToken' | 'accessTokenExpirationDate' | 'refreshTokenExpirationDate'
>;

type ToolCallArgs = Record<string, unknown> | undefined;

type ToolCallContext = {
  accessToken?: string;
  includePasswordLoginTool: boolean;
};

type CollascoApiClientOptions = {
  allowPasswordLogin?: boolean;
};

type ProjectStructure = {
  projectId: string;
  modules?: StructureNode[];
};

type StructureNode = {
  type: 'module' | 'feature';
  id: string;
  name: string;
  items?: StructureNode[];
};

type ModuleOrFeaturePathResult = {
  id: string;
  name: string;
  type: 'module' | 'feature';
  path: string[];
  pathText: string;
};

const JSON_RPC_VERSION = '2.0';
const DEFAULT_API_BASE_URL = 'https://api.collasco.com/v1';
const MCP_PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_HTTP_PORT = 3333;

class McpError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

export class CollascoApiClient {
  private auth: AuthState | null = null;
  private refreshedTokens: TokenSet | null = null;
  private readonly allowPasswordLogin: boolean;

  constructor(
    private readonly apiBaseUrl: string,
    options: CollascoApiClientOptions = {},
  ) {
    this.allowPasswordLogin = options.allowPasswordLogin ?? true;
  }

  async login(email?: string, password?: string): Promise<AuthState> {
    if (!this.allowPasswordLogin) {
      throw new McpError(
        -32001,
        'Password login is disabled. Use COLLASCO_ACCESS_TOKEN for local stdio or HTTP Authorization: Bearer <access_token>.',
      );
    }

    const resolvedEmail = asOptionalString(email) ?? process.env.COLLASCO_EMAIL;
    const resolvedPassword = asOptionalString(password) ?? process.env.COLLASCO_PASSWORD;

    if (!resolvedEmail || !resolvedPassword) {
      throw new McpError(
        -32001,
        'Missing credentials. Provide email/password to the login tool or set COLLASCO_EMAIL and COLLASCO_PASSWORD.',
      );
    }

    const response = await this.request('/auth/login', {
      method: 'POST',
      body: {
        email: resolvedEmail,
        password: resolvedPassword,
      },
    });

    this.auth = parseAuthState(response);
    return this.auth;
  }

  async listProjects(args: ToolCallArgs, accessToken?: string): Promise<unknown> {
    const params = new URLSearchParams();
    const q = asOptionalString(args?.q);
    const page = asOptionalNumber(args?.page);
    const limit = asOptionalNumber(args?.limit);

    if (q) params.set('q', q);
    if (page !== undefined) params.set('page', String(page));
    if (limit !== undefined) params.set('limit', String(limit));

    const query = params.size > 0 ? `?${params.toString()}` : '';

    return this.authenticatedRequest(`/projects/mine${query}`, accessToken);
  }

  async getProject(projectId?: string, accessToken?: string): Promise<unknown> {
    const resolvedProjectId = requiredString(projectId, 'projectId');
    return this.authenticatedRequest(`/projects/${resolvedProjectId}`, accessToken);
  }

  async getProjectStructure(projectId?: string, accessToken?: string): Promise<unknown> {
    const resolvedProjectId = requiredString(projectId, 'projectId');
    return this.authenticatedRequest(`/projects/${resolvedProjectId}/structure`, accessToken);
  }

  async getProjectLabels(projectId?: string, accessToken?: string): Promise<unknown> {
    const resolvedProjectId = requiredString(projectId, 'projectId');
    return this.authenticatedRequest(`/qa/projects/${resolvedProjectId}/labels`, accessToken);
  }

  async getModuleOrFeaturePath(
    projectId?: string,
    moduleOrFeatureId?: string,
    projectName?: string,
    accessToken?: string,
  ): Promise<ModuleOrFeaturePathResult> {
    const resolvedProjectId = requiredString(projectId, 'projectId');
    const resolvedModuleOrFeatureId = requiredString(moduleOrFeatureId, 'moduleOrFeatureId');
    const structure = (await this.getProjectStructure(resolvedProjectId, accessToken)) as ProjectStructure;
    const rootName =
      asOptionalString(projectName) ?? (await this.resolveProjectName(structure.projectId, accessToken));
    return findModuleOrFeaturePath(structure.modules ?? [], resolvedModuleOrFeatureId, [rootName]);
  }

  private async ensureAuthenticated(): Promise<void> {
    if (this.auth) return;
    await this.login();
  }

  private async refreshAccessToken(refreshToken?: string): Promise<TokenSet> {
    const resolvedRefreshToken =
      refreshToken ?? this.refreshedTokens?.refreshToken ?? this.auth?.refreshToken ?? process.env.COLLASCO_REFRESH_TOKEN;

    if (!resolvedRefreshToken) {
      throw new McpError(-32001, 'No refresh token available.');
    }

    const response = await this.request('/auth/refresh', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolvedRefreshToken}`,
      },
    });

    const tokens = response as Partial<AuthState>;
    const tokenSet = {
      accessToken: requiredString(tokens.accessToken, 'refresh response accessToken'),
      refreshToken: requiredString(tokens.refreshToken, 'refresh response refreshToken'),
      accessTokenExpirationDate: asOptionalString(tokens.accessTokenExpirationDate) ?? null,
      refreshTokenExpirationDate: asOptionalString(tokens.refreshTokenExpirationDate) ?? null,
    };

    if (this.auth) {
      this.auth = {
        ...this.auth,
        ...tokenSet,
      };
    }

    this.refreshedTokens = tokenSet;
    return tokenSet;
  }

  private async resolveProjectName(projectId: string, accessToken?: string): Promise<string> {
    const project = await this.getProject(projectId, accessToken);
    if (isRecord(project)) {
      return asOptionalString(project.name) ?? projectId;
    }

    return projectId;
  }

  private async authenticatedRequest(path: string, accessToken?: string): Promise<unknown> {
    let resolvedAccessToken = this.refreshedTokens?.accessToken ?? accessToken ?? process.env.COLLASCO_ACCESS_TOKEN;
    if (!resolvedAccessToken && process.env.COLLASCO_REFRESH_TOKEN) {
      resolvedAccessToken = (await this.refreshAccessToken()).accessToken;
    }

    if (!resolvedAccessToken) {
      await this.ensureAuthenticated();
    }

    try {
      return await this.request(path, {
        method: 'GET',
        headers: this.accessHeaders(resolvedAccessToken),
      });
    } catch (error) {
      if (!(error instanceof McpError) || error.code !== 401 || !this.canRefreshAccessToken()) {
        throw error;
      }

      const refreshedTokens = await this.refreshAccessToken();
      return this.request(path, {
        method: 'GET',
        headers: this.accessHeaders(refreshedTokens.accessToken),
      });
    }
  }

  private canRefreshAccessToken(): boolean {
    return Boolean(this.auth?.refreshToken || this.refreshedTokens?.refreshToken || process.env.COLLASCO_REFRESH_TOKEN);
  }

  private accessHeaders(accessToken?: string): Record<string, string> {
    const resolvedAccessToken = accessToken ?? this.auth?.accessToken;
    if (!resolvedAccessToken) {
      throw new McpError(-32001, 'Not authenticated. Call login first.');
    }

    return {
      Authorization: `Bearer ${resolvedAccessToken}`,
    };
  }

  private async request(
    path: string,
    init: {
      method: 'GET' | 'POST';
      body?: unknown;
      headers?: Record<string, string>;
    },
  ): Promise<unknown> {
    const response = await fetch(new URL(stripLeadingSlashes(path), withTrailingSlash(this.apiBaseUrl)), {
      method: init.method,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

    const text = await response.text();
    const payload = text ? safeJsonParse(text) : null;

    if (!response.ok) {
      const message =
        extractErrorMessage(payload) ??
        response.statusText ??
        `Collasco API request failed with status ${response.status}`;
      throw new McpError(response.status, message, payload ?? text);
    }

    return payload;
  }
}

export class CollascoMcpServer {
  private readonly apiClient = new CollascoApiClient(
    process.env.COLLASCO_API_BASE_URL || DEFAULT_API_BASE_URL,
    {
      allowPasswordLogin: process.env.COLLASCO_MCP_ENABLE_PASSWORD_LOGIN === 'true',
    },
  );
  private readonly stdin = process.stdin;
  private readonly stdout = process.stdout;
  private buffer = Buffer.alloc(0);
  private readonly includePasswordLoginTool = process.env.COLLASCO_MCP_ENABLE_PASSWORD_LOGIN === 'true';

  start(): void {
    this.stdin.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.flushBuffer().catch((error) => this.writeError(null, error));
    });

    this.stdin.on('end', () => {
      process.exit(0);
    });
  }

  private async flushBuffer(): Promise<void> {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const headerText = this.buffer.subarray(0, headerEnd).toString('utf8');
      const contentLength = parseContentLength(headerText);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;

      if (this.buffer.length < messageEnd) return;

      const rawMessage = this.buffer.subarray(messageStart, messageEnd).toString('utf8');
      this.buffer = this.buffer.subarray(messageEnd);

      const request = safeJsonParse(rawMessage) as JsonRpcRequest;
      await this.handleMessage(request);
    }
  }

  private async handleMessage(request: JsonRpcRequest): Promise<void> {
    if (!request || request.jsonrpc !== JSON_RPC_VERSION || !request.method) {
      throw new McpError(-32600, 'Invalid JSON-RPC request.');
    }

    if (request.method === 'notifications/initialized') {
      return;
    }

    const id = request.id ?? null;

    try {
      switch (request.method) {
        case 'initialize':
          this.writeResult(id, {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'collasco-mcp',
              version: '0.1.0',
            },
          });
          return;
        case 'tools/list':
          this.writeResult(id, {
            tools: toolDefinitions(this.includePasswordLoginTool),
          });
          return;
        case 'tools/call':
          this.writeResult(
            id,
            await this.handleToolCall(request.params, {
              includePasswordLoginTool: this.includePasswordLoginTool,
            }),
          );
          return;
        default:
          throw new McpError(-32601, `Method not found: ${request.method}`);
      }
    } catch (error) {
      this.writeError(id, error);
    }
  }

  async handleToolCall(params: Record<string, unknown> | undefined, context: ToolCallContext): Promise<unknown> {
    const name = requiredString(params?.name, 'tool name');
    const args = isRecord(params?.arguments) ? params?.arguments : undefined;

    switch (name) {
      case 'collasco_login': {
        if (!context.includePasswordLoginTool) {
          throw new McpError(
            -32601,
            'Password login is disabled for this MCP server. Use OAuth Bearer token authentication.',
          );
        }

        const auth = await this.apiClient.login(
          asOptionalString(args?.email),
          asOptionalString(args?.password),
        );
        return toolTextResult(
          JSON.stringify(
            {
              ok: true,
              user: auth.user,
              accessTokenExpirationDate: auth.accessTokenExpirationDate,
              refreshTokenExpirationDate: auth.refreshTokenExpirationDate,
              apiBaseUrl: process.env.COLLASCO_API_BASE_URL || DEFAULT_API_BASE_URL,
            },
            null,
            2,
          ),
        );
      }
      case 'collasco_list_projects': {
        const projects = await this.apiClient.listProjects(args, context.accessToken);
        return toolTextResult(JSON.stringify(projects, null, 2));
      }
      case 'collasco_search_projects': {
        const q = requiredString(args?.q, 'q');
        const projects = await this.apiClient.listProjects({ ...args, q }, context.accessToken);
        return toolTextResult(JSON.stringify(projects, null, 2));
      }
      case 'collasco_get_project': {
        const project = await this.apiClient.getProject(asOptionalString(args?.projectId), context.accessToken);
        return toolTextResult(JSON.stringify(project, null, 2));
      }
      case 'collasco_get_project_structure': {
        const structure = await this.apiClient.getProjectStructure(
          asOptionalString(args?.projectId),
          context.accessToken,
        );
        return toolTextResult(JSON.stringify(structure, null, 2));
      }
      case 'collasco_get_project_labels': {
        const labels = await this.apiClient.getProjectLabels(asOptionalString(args?.projectId), context.accessToken);
        return toolTextResult(JSON.stringify(labels, null, 2));
      }
      case 'collasco_get_module_or_feature_path': {
        const path = await this.apiClient.getModuleOrFeaturePath(
          asOptionalString(args?.projectId),
          asOptionalString(args?.moduleOrFeatureId),
          asOptionalString(args?.projectName),
          context.accessToken,
        );
        return toolTextResult(JSON.stringify(path, null, 2));
      }
      default:
        throw new McpError(-32601, `Unknown tool: ${name}`);
    }
  }

  async handleHttpMessage(request: JsonRpcRequest, accessToken: string): Promise<JsonRpcResponse | null> {
    if (!request || request.jsonrpc !== JSON_RPC_VERSION || !request.method) {
      return jsonRpcError(null, new McpError(-32600, 'Invalid JSON-RPC request.'));
    }

    if (request.method === 'notifications/initialized') {
      return null;
    }

    const id = request.id ?? null;

    try {
      switch (request.method) {
        case 'initialize':
          return jsonRpcResult(id, initializeResult());
        case 'tools/list':
          return jsonRpcResult(id, {
            tools: toolDefinitions(false),
          });
        case 'tools/call':
          return jsonRpcResult(
            id,
            await this.handleToolCall(request.params, {
              accessToken,
              includePasswordLoginTool: false,
            }),
          );
        default:
          throw new McpError(-32601, `Method not found: ${request.method}`);
      }
    } catch (error) {
      return jsonRpcError(id, error);
    }
  }

  private writeResult(id: JsonRpcId, result: unknown): void {
    this.writeMessage(jsonRpcResult(id, result));
  }

  private writeError(id: JsonRpcId, error: unknown): void {
    this.writeMessage(jsonRpcError(id, error));
  }

  private writeMessage(message: JsonRpcResponse): void {
    const body = JSON.stringify(message);
    this.stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
  }
}

export class CollascoHttpMcpServer {
  private readonly mcpServer = new CollascoMcpServer();
  private readonly port = asOptionalNumber(process.env.COLLASCO_MCP_HTTP_PORT) ?? DEFAULT_HTTP_PORT;
  private readonly host = process.env.COLLASCO_MCP_HTTP_HOST || '127.0.0.1';

  start(): void {
    const server = createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        sendJson(res, 500, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    });

    server.listen(this.port, this.host, () => {
      process.stderr.write(`Collasco MCP HTTP server listening on http://${this.host}:${this.port}/mcp\n`);
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'OPTIONS') {
      sendEmpty(res, 204, corsHeaders());
      return;
    }

    const requestUrl = new URL(req.url ?? '/', this.publicBaseUrl());

    if (req.method === 'GET' && requestUrl.pathname === '/.well-known/oauth-protected-resource') {
      sendJson(res, 200, protectedResourceMetadata(this.publicMcpUrl()), corsHeaders());
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/health') {
      sendJson(res, 200, { ok: true }, corsHeaders());
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/mcp' && acceptsEventStream(req.headers.accept)) {
      sendJson(
        res,
        405,
        {
          error: 'Method not allowed',
          message: 'This MCP endpoint accepts JSON-RPC requests with POST /mcp.',
        },
        corsHeaders(),
      );
      return;
    }

    if (req.method === 'GET' && (requestUrl.pathname === '/' || requestUrl.pathname === '/mcp')) {
      sendJson(res, 200, mcpDiscovery(this.publicMcpUrl()), corsHeaders());
      return;
    }

    if (req.method !== 'POST' || requestUrl.pathname !== '/mcp') {
      sendJson(res, 404, { error: 'Not found' }, corsHeaders());
      return;
    }

    const accessToken = parseBearerToken(req.headers.authorization);
    if (!accessToken && !this.allowsRefreshTokenAuth()) {
      sendUnauthorized(res, this.publicMcpUrl());
      return;
    }

    const rawBody = await readRequestBody(req);
    const payload = safeJsonParse(rawBody);
    if (!isRecord(payload)) {
      sendJson(res, 400, jsonRpcError(null, new McpError(-32700, 'Invalid JSON body.')), corsHeaders());
      return;
    }

    const response = await this.mcpServer.handleHttpMessage(payload as JsonRpcRequest, accessToken ?? '');
    if (!response) {
      sendEmpty(res, 202, corsHeaders());
      return;
    }

    if (response.error?.code === 401) {
      sendUnauthorized(res, this.publicMcpUrl(), response.error.message);
      return;
    }

    if (response.error?.code === 403) {
      sendJson(res, 403, response, corsHeaders());
      return;
    }

    sendJson(res, 200, response, corsHeaders());
  }

  private publicBaseUrl(): string {
    return process.env.COLLASCO_MCP_PUBLIC_BASE_URL || `http://localhost:${this.port}`;
  }

  private publicMcpUrl(): string {
    return process.env.COLLASCO_MCP_PUBLIC_URL || new URL('/mcp', withTrailingSlash(this.publicBaseUrl())).toString();
  }

  private allowsRefreshTokenAuth(): boolean {
    return process.env.COLLASCO_MCP_ALLOW_REFRESH_TOKEN_AUTH === 'true' && Boolean(process.env.COLLASCO_REFRESH_TOKEN);
  }
}

function initializeResult() {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: 'collasco-mcp',
      version: '0.1.0',
    },
  };
}

function toolDefinitions(includePasswordLoginTool: boolean) {
  const tools = [
    {
      name: 'collasco_list_projects',
      description: 'List the projects that belong to the authenticated user.',
      inputSchema: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Optional free-text search.' },
          page: { type: 'number', description: 'Page number.' },
          limit: { type: 'number', description: 'Page size.' },
        },
      },
    },
    {
      name: 'collasco_search_projects',
      description: 'Search the authenticated user projects by free text.',
      inputSchema: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Search text.' },
          page: { type: 'number', description: 'Page number.' },
          limit: { type: 'number', description: 'Page size.' },
        },
        required: ['q'],
      },
    },
    {
      name: 'collasco_get_project',
      description: 'Get one Collasco project by its id.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project UUID.' },
        },
        required: ['projectId'],
      },
    },
    {
      name: 'collasco_get_project_structure',
      description: 'Get the full module and feature structure for a project.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project UUID.' },
        },
        required: ['projectId'],
      },
    },
    {
      name: 'collasco_get_project_labels',
      description: 'Get the full project label definitions, including instructions and role visibility.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project UUID.' },
        },
        required: ['projectId'],
      },
    },
    {
      name: 'collasco_get_module_or_feature_path',
      description:
        'Get the hierarchical path for a module or feature inside a project, derived from the project structure.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project UUID.' },
          moduleOrFeatureId: { type: 'string', description: 'Module or feature UUID.' },
          projectName: {
            type: 'string',
            description: 'Optional project name to use as the root path label.',
          },
        },
        required: ['projectId', 'moduleOrFeatureId'],
      },
    },
  ];

  if (!includePasswordLoginTool) return tools;

  return [
    {
      name: 'collasco_login',
      description: 'Log into the Collasco API with email/password or configured environment variables.',
      inputSchema: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Collasco account email.' },
          password: { type: 'string', description: 'Collasco account password.' },
        },
      },
    },
    ...tools,
  ];
}

function jsonRpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    result,
  };
}

function jsonRpcError(id: JsonRpcId, error: unknown): JsonRpcResponse {
  const rpcError =
    error instanceof McpError
      ? { code: error.code, message: error.message, data: error.data }
      : { code: -32603, message: error instanceof Error ? error.message : 'Unknown error' };

  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    error: rpcError,
  };
}

function toolTextResult(text: string) {
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
}

function findModuleOrFeaturePath(
  items: StructureNode[],
  moduleOrFeatureId: string,
  parentPath: string[],
): ModuleOrFeaturePathResult {
  const result = findModuleOrFeaturePathOrNull(items, moduleOrFeatureId, parentPath);
  if (!result) {
    throw new McpError(404, `Module or feature not found in project structure: ${moduleOrFeatureId}`);
  }

  return result;
}

function findModuleOrFeaturePathOrNull(
  items: StructureNode[],
  moduleOrFeatureId: string,
  parentPath: string[],
): ModuleOrFeaturePathResult | null {
  for (const item of items) {
    const path = [...parentPath, item.name];
    if (item.id === moduleOrFeatureId) {
      return {
        id: item.id,
        name: item.name,
        type: item.type,
        path,
        pathText: path.join(' -> '),
      };
    }

    const childResult = findModuleOrFeaturePathOrNull(item.items ?? [], moduleOrFeatureId, path);
    if (childResult) return childResult;
  }

  return null;
}

function parseContentLength(headerText: string): number {
  const match = headerText.match(/Content-Length:\s*(\d+)/i);
  if (!match) {
    throw new McpError(-32700, 'Missing Content-Length header.');
  }
  return Number(match[1]);
}

function parseBearerToken(authorization: string | string[] | undefined): string | null {
  const header = Array.isArray(authorization) ? authorization[0] : authorization;
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function acceptsEventStream(accept: string | string[] | undefined): boolean {
  const values = Array.isArray(accept) ? accept : [accept];
  return values.some((value) => value?.toLowerCase().includes('text/event-stream'));
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body, 'utf8'),
    ...headers,
  });
  res.end(body);
}

function sendEmpty(res: ServerResponse, statusCode: number, headers: Record<string, string> = {}): void {
  res.writeHead(statusCode, headers);
  res.end();
}

function sendUnauthorized(res: ServerResponse, resourceUrl: string, description = 'Authorization required.'): void {
  sendJson(
    res,
    401,
    { error: 'unauthorized', error_description: description },
    {
      ...corsHeaders(),
      'WWW-Authenticate': `Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource', resourceUrl).toString()}"`,
    },
  );
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': process.env.COLLASCO_MCP_CORS_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function protectedResourceMetadata(resourceUrl: string): Record<string, unknown> {
  return {
    resource: resourceUrl,
    authorization_servers: [authorizationServerUrl()],
    bearer_methods_supported: ['header'],
    scopes_supported: [
      'collasco:projects:read',
      'collasco:project-structure:read',
      'collasco:project-labels:read',
    ],
  };
}

function mcpDiscovery(resourceUrl: string): Record<string, unknown> {
  return {
    name: 'collasco-mcp',
    transport: 'streamable-http',
    endpoint: resourceUrl,
    methods: {
      initialize: {
        method: 'POST',
        path: new URL(resourceUrl).pathname,
        contentType: 'application/json',
      },
      health: {
        method: 'GET',
        path: '/health',
      },
      oauthProtectedResource: {
        method: 'GET',
        path: '/.well-known/oauth-protected-resource',
      },
    },
  };
}

function authorizationServerUrl(): string {
  if (process.env.COLLASCO_AUTHORIZATION_SERVER_URL) {
    return process.env.COLLASCO_AUTHORIZATION_SERVER_URL;
  }

  return new URL(process.env.COLLASCO_API_BASE_URL || DEFAULT_API_BASE_URL).origin;
}

function parseAuthState(payload: unknown): AuthState {
  if (!isRecord(payload)) {
    throw new McpError(-32002, 'Unexpected login response.', payload);
  }

  const user = payload.user;
  if (!isRecord(user)) {
    throw new McpError(-32002, 'Login response is missing user details.', payload);
  }

  return {
    accessToken: requiredString(payload.accessToken, 'login response accessToken'),
    refreshToken: requiredString(payload.refreshToken, 'login response refreshToken'),
    accessTokenExpirationDate: asOptionalString(payload.accessTokenExpirationDate) ?? null,
    refreshTokenExpirationDate: asOptionalString(payload.refreshTokenExpirationDate) ?? null,
    user: {
      id: requiredString(user.id, 'login response user.id'),
      email: requiredString(user.email, 'login response user.email'),
      role: requiredString(user.role, 'login response user.role'),
    },
  };
}

function extractErrorMessage(payload: unknown): string | null {
  if (typeof payload === 'string' && payload.trim()) return payload;
  if (!isRecord(payload)) return null;
  if (typeof payload.message === 'string') return payload.message;
  if (Array.isArray(payload.message) && payload.message.every((item) => typeof item === 'string')) {
    return payload.message.join(', ');
  }
  if (typeof payload.error === 'string') return payload.error;
  return null;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new McpError(-32602, `Missing or invalid ${label}.`);
  }
  return value;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function withTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function stripLeadingSlashes(value: string): string {
  return value.replace(/^\/+/, '');
}

if (shouldStartMcpServer()) {
  if (shouldStartHttpMcpServer()) {
    new CollascoHttpMcpServer().start();
  } else {
    new CollascoMcpServer().start();
  }
}

function shouldStartMcpServer(): boolean {
  const entry = process.argv[1] ?? '';
  return /collasco-mcp\.(js|ts)$/.test(entry);
}

function shouldStartHttpMcpServer(): boolean {
  return process.argv.includes('--http') || process.env.COLLASCO_MCP_TRANSPORT === 'http';
}

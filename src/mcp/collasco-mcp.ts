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

type ToolCallArgs = Record<string, unknown> | undefined;

const JSON_RPC_VERSION = '2.0';
const DEFAULT_API_BASE_URL = 'https://api.collasco.com/v1';
const MCP_PROTOCOL_VERSION = '2024-11-05';

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

  constructor(private readonly apiBaseUrl: string) {}

  async login(email?: string, password?: string): Promise<AuthState> {
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

  async listProjects(args: ToolCallArgs): Promise<unknown> {
    const params = new URLSearchParams();
    const q = asOptionalString(args?.q);
    const page = asOptionalNumber(args?.page);
    const limit = asOptionalNumber(args?.limit);

    if (q) params.set('q', q);
    if (page !== undefined) params.set('page', String(page));
    if (limit !== undefined) params.set('limit', String(limit));

    const query = params.size > 0 ? `?${params.toString()}` : '';

    return this.authenticatedRequest(`/projects/mine${query}`);
  }

  async getProject(projectId?: string): Promise<unknown> {
    const resolvedProjectId = requiredString(projectId, 'projectId');
    return this.authenticatedRequest(`/projects/${resolvedProjectId}`);
  }

  async getProjectStructure(projectId?: string): Promise<unknown> {
    const resolvedProjectId = requiredString(projectId, 'projectId');
    return this.authenticatedRequest(`/projects/${resolvedProjectId}/structure`);
  }

  async getProjectLabels(projectId?: string): Promise<unknown> {
    const resolvedProjectId = requiredString(projectId, 'projectId');
    return this.authenticatedRequest(`/qa/projects/${resolvedProjectId}/labels`);
  }

  private async ensureAuthenticated(): Promise<void> {
    if (this.auth) return;
    await this.login();
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.auth?.refreshToken) {
      throw new McpError(-32001, 'No refresh token available. Call login again.');
    }

    const response = await this.request('/auth/refresh', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.auth.refreshToken}`,
      },
    });

    const tokens = response as Partial<AuthState>;
    this.auth = {
      ...this.auth,
      accessToken: requiredString(tokens.accessToken, 'refresh response accessToken'),
      refreshToken: requiredString(tokens.refreshToken, 'refresh response refreshToken'),
      accessTokenExpirationDate: asOptionalString(tokens.accessTokenExpirationDate) ?? null,
      refreshTokenExpirationDate: asOptionalString(tokens.refreshTokenExpirationDate) ?? null,
    };
  }

  private async authenticatedRequest(path: string): Promise<unknown> {
    await this.ensureAuthenticated();

    try {
      return await this.request(path, {
        method: 'GET',
        headers: this.accessHeaders(),
      });
    } catch (error) {
      if (!(error instanceof McpError) || error.code !== 401) {
        throw error;
      }

      await this.refreshAccessToken();
      return this.request(path, {
        method: 'GET',
        headers: this.accessHeaders(),
      });
    }
  }

  private accessHeaders(): Record<string, string> {
    if (!this.auth) {
      throw new McpError(-32001, 'Not authenticated. Call login first.');
    }

    return {
      Authorization: `Bearer ${this.auth.accessToken}`,
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
  );
  private readonly stdin = process.stdin;
  private readonly stdout = process.stdout;
  private buffer = Buffer.alloc(0);

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
            tools: [
              {
                name: 'collasco_login',
                description:
                  'Log into the Collasco API with email/password or configured environment variables.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    email: { type: 'string', description: 'Collasco account email.' },
                    password: { type: 'string', description: 'Collasco account password.' },
                  },
                },
              },
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
                description:
                  'Get the full project label definitions, including instructions and role visibility.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    projectId: { type: 'string', description: 'Project UUID.' },
                  },
                  required: ['projectId'],
                },
              },
            ],
          });
          return;
        case 'tools/call':
          this.writeResult(id, await this.handleToolCall(request.params));
          return;
        default:
          throw new McpError(-32601, `Method not found: ${request.method}`);
      }
    } catch (error) {
      this.writeError(id, error);
    }
  }

  private async handleToolCall(params?: Record<string, unknown>): Promise<unknown> {
    const name = requiredString(params?.name, 'tool name');
    const args = isRecord(params?.arguments) ? params?.arguments : undefined;

    switch (name) {
      case 'collasco_login': {
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
        const projects = await this.apiClient.listProjects(args);
        return toolTextResult(JSON.stringify(projects, null, 2));
      }
      case 'collasco_search_projects': {
        const q = requiredString(args?.q, 'q');
        const projects = await this.apiClient.listProjects({ ...args, q });
        return toolTextResult(JSON.stringify(projects, null, 2));
      }
      case 'collasco_get_project': {
        const project = await this.apiClient.getProject(asOptionalString(args?.projectId));
        return toolTextResult(JSON.stringify(project, null, 2));
      }
      case 'collasco_get_project_structure': {
        const structure = await this.apiClient.getProjectStructure(asOptionalString(args?.projectId));
        return toolTextResult(JSON.stringify(structure, null, 2));
      }
      case 'collasco_get_project_labels': {
        const labels = await this.apiClient.getProjectLabels(asOptionalString(args?.projectId));
        return toolTextResult(JSON.stringify(labels, null, 2));
      }
      default:
        throw new McpError(-32601, `Unknown tool: ${name}`);
    }
  }

  private writeResult(id: JsonRpcId, result: unknown): void {
    this.writeMessage({
      jsonrpc: JSON_RPC_VERSION,
      id,
      result,
    });
  }

  private writeError(id: JsonRpcId, error: unknown): void {
    const rpcError =
      error instanceof McpError
        ? { code: error.code, message: error.message, data: error.data }
        : { code: -32603, message: error instanceof Error ? error.message : 'Unknown error' };

    this.writeMessage({
      jsonrpc: JSON_RPC_VERSION,
      id,
      error: rpcError,
    });
  }

  private writeMessage(message: JsonRpcResponse): void {
    const body = JSON.stringify(message);
    this.stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
  }
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

function parseContentLength(headerText: string): number {
  const match = headerText.match(/Content-Length:\s*(\d+)/i);
  if (!match) {
    throw new McpError(-32700, 'Missing Content-Length header.');
  }
  return Number(match[1]);
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
  new CollascoMcpServer().start();
}

function shouldStartMcpServer(): boolean {
  const entry = process.argv[1] ?? '';
  return /collasco-mcp\.(js|ts)$/.test(entry);
}

#!/usr/bin/env node

const { spawn } = require('node:child_process');
const readline = require('node:readline');

const DEFAULT_API_BASE_URL = 'https://api.collasco.com/v1';

async function main() {
  const apiBaseUrl = withoutTrailingSlash(process.env.COLLASCO_API_BASE_URL || DEFAULT_API_BASE_URL);
  const email = process.env.COLLASCO_EMAIL || (await prompt('Collasco email: '));
  const password = process.env.COLLASCO_PASSWORD || (await promptHidden('Collasco password: '));

  if (!email.trim() || !password) {
    throw new Error('Email and password are required.');
  }

  process.stderr.write(`Logging into ${apiBaseUrl}...\n`);
  const tokens = await login(apiBaseUrl, email.trim(), password);

  process.stderr.write('Login succeeded. Starting Collasco MCP HTTP server...\n');
  const child = spawn(process.execPath, ['dist/mcp/collasco-mcp.js', '--http'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      COLLASCO_API_BASE_URL: apiBaseUrl,
      COLLASCO_ACCESS_TOKEN: tokens.accessToken,
      COLLASCO_REFRESH_TOKEN: tokens.refreshToken,
      COLLASCO_MCP_ALLOW_REFRESH_TOKEN_AUTH:
        process.env.COLLASCO_MCP_ALLOW_REFRESH_TOKEN_AUTH || 'true',
    },
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

async function login(apiBaseUrl, email, password) {
  const response = await fetch(`${apiBaseUrl}/auth/login`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  const text = await response.text();
  const payload = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    throw new Error(errorMessage(payload) || response.statusText || `Login failed with ${response.status}`);
  }

  if (!payload || typeof payload.accessToken !== 'string' || typeof payload.refreshToken !== 'string') {
    throw new Error('Login response did not include accessToken and refreshToken.');
  }

  return {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
  };
}

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const input = process.stdin;
    const output = process.stderr;
    const rl = readline.createInterface({ input, output });

    output.write(question);
    const originalWrite = output.write.bind(output);
    output.write = function maskedWrite(chunk, encoding, callback) {
      if (typeof chunk === 'string' && chunk.includes(question)) {
        return originalWrite(chunk, encoding, callback);
      }
      return true;
    };

    rl.question('', (answer) => {
      output.write = originalWrite;
      output.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

function errorMessage(payload) {
  if (typeof payload === 'string' && payload.trim()) return payload;
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.message === 'string') return payload.message;
  if (Array.isArray(payload.message)) return payload.message.join(', ');
  if (typeof payload.error === 'string') return payload.error;
  return null;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function withoutTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

/**
 * MCP server registry + health checks (HELIX-81). Holds the set of configured MCP
 * servers, lets them be enabled/disabled, and probes their liveness by connecting
 * (via the HELIX-80 client) and listing their tools.
 *
 * The actual "connect to a server" step is an injected {@link McpServerConnector},
 * so the registry's logic is unit-testable without spawning real servers; a
 * {@link createDefaultConnector default connector} builds real stdio/HTTP
 * transports for production use.
 */
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { SecretsManager } from '@helix/secrets';
import { HelixMcpClient } from './client';
import { resolveTransportCredentials } from './credentials';
import type { ResolvedTransportSecrets, TransportCredentials } from './credentials';
import { McpClientInfo } from './types';

/**
 * How to reach an MCP server. `env`/`headers` are literal (non-secret) values;
 * secret-backed env vars and headers go in `credentials` as vault *references*
 * and are resolved just-in-time at connect (see {@link createCredentialInjectingConnector}).
 */
export type McpTransportConfig =
  | {
      type: 'stdio';
      command: string;
      args?: string[];
      env?: Record<string, string>;
      credentials?: TransportCredentials;
    }
  | {
      type: 'http';
      url: string;
      headers?: Record<string, string>;
      credentials?: TransportCredentials;
    };

/** Input to {@link McpServerRegistry.register}. */
export interface McpServerConfig {
  id: string;
  name?: string;
  transport: McpTransportConfig;
  /** Start enabled (default true). */
  enabled?: boolean;
}

export type ServerHealthStatus = 'unknown' | 'healthy' | 'unhealthy' | 'disabled';

/** Result of a liveness probe. */
export interface ServerHealth {
  status: ServerHealthStatus;
  /** Number of tools discovered (when healthy). */
  toolCount?: number;
  /** Failure detail (when unhealthy). */
  error?: string;
  /** ISO-8601 time of the last check. */
  checkedAt?: string;
}

export interface RegisteredServer {
  id: string;
  name?: string;
  transport: McpTransportConfig;
  enabled: boolean;
  health: ServerHealth;
}

/** Connects to a server and returns a ready client. Injected so the registry is testable. */
export type McpServerConnector = (server: RegisteredServer) => Promise<HelixMcpClient>;

export class McpServerNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`MCP server "${id}" is not registered`);
    this.name = 'McpServerNotFoundError';
  }
}

export class DuplicateMcpServerError extends Error {
  constructor(public readonly id: string) {
    super(`MCP server "${id}" is already registered`);
    this.name = 'DuplicateMcpServerError';
  }
}

/** In-memory registry of MCP servers with enable/disable + liveness health checks. */
export class McpServerRegistry {
  private readonly servers = new Map<string, RegisteredServer>();

  constructor(private readonly connector: McpServerConnector) {}

  /** Register a server (enabled by default). @throws DuplicateMcpServerError */
  register(config: McpServerConfig): RegisteredServer {
    if (this.servers.has(config.id)) throw new DuplicateMcpServerError(config.id);
    const enabled = config.enabled ?? true;
    const server: RegisteredServer = {
      id: config.id,
      name: config.name,
      transport: config.transport,
      enabled,
      health: { status: enabled ? 'unknown' : 'disabled' },
    };
    this.servers.set(config.id, server);
    return clone(server);
  }

  list(): RegisteredServer[] {
    return [...this.servers.values()].map(clone);
  }

  get(id: string): RegisteredServer {
    return clone(this.require(id));
  }

  enable(id: string): RegisteredServer {
    const s = this.require(id);
    if (!s.enabled) {
      s.enabled = true;
      s.health = { status: 'unknown' };
    }
    return clone(s);
  }

  disable(id: string): RegisteredServer {
    const s = this.require(id);
    s.enabled = false;
    s.health = { status: 'disabled' };
    return clone(s);
  }

  remove(id: string): void {
    if (!this.servers.delete(id)) throw new McpServerNotFoundError(id);
  }

  /** Probe a server's liveness by connecting and listing its tools. Disabled servers are skipped. */
  async healthCheck(id: string): Promise<ServerHealth> {
    const server = this.require(id);
    if (!server.enabled) {
      server.health = { status: 'disabled', checkedAt: nowIso() };
      return { ...server.health };
    }
    let client: HelixMcpClient | undefined;
    try {
      client = await this.connector(clone(server));
      const tools = await client.listTools();
      server.health = { status: 'healthy', toolCount: tools.length, checkedAt: nowIso() };
    } catch (err) {
      server.health = {
        status: 'unhealthy',
        error: err instanceof Error ? err.message : String(err),
        checkedAt: nowIso(),
      };
    } finally {
      await client?.close().catch(() => undefined);
    }
    return { ...server.health };
  }

  /** Health-check every registered server. */
  async healthCheckAll(): Promise<Record<string, ServerHealth>> {
    const results: Record<string, ServerHealth> = {};
    for (const id of this.servers.keys()) results[id] = await this.healthCheck(id);
    return results;
  }

  private require(id: string): RegisteredServer {
    const server = this.servers.get(id);
    if (!server) throw new McpServerNotFoundError(id);
    return server;
  }
}

/**
 * Default connector: builds a real transport from the server's config and connects
 * a {@link HelixMcpClient}. Transports are imported lazily so unused ones (and their
 * deps) aren't loaded. Does **not** resolve `credentials` — use
 * {@link createCredentialInjectingConnector} for servers that need vault secrets.
 */
export function createDefaultConnector(info?: McpClientInfo): McpServerConnector {
  return async (server) => {
    const transport = await buildTransport(server.transport);
    const client = new HelixMcpClient(info);
    await client.connect(transport);
    return client;
  };
}

/**
 * Connector that performs just-in-time credential injection (HELIX-91): at connect
 * time it resolves the server's `credentials` refs from the vault and merges the
 * plaintext into the transport's env/headers. The registry keeps only the refs;
 * the resolved secrets live only for the duration of this connect.
 */
export function createCredentialInjectingConnector(
  secrets: SecretsManager,
  info?: McpClientInfo,
): McpServerConnector {
  return async (server) => {
    const resolved = await resolveTransportCredentials(server.transport.credentials, secrets);
    const transport = await buildTransport(injectResolvedSecrets(server.transport, resolved));
    const client = new HelixMcpClient(info);
    await client.connect(transport);
    return client;
  };
}

/**
 * Merge resolved secrets into a transport config, returning a **new** config with
 * the plaintext applied to env/headers and `credentials` stripped. Pure (does not
 * mutate the input), so the registry's stored config keeps only references.
 */
export function injectResolvedSecrets(
  config: McpTransportConfig,
  resolved: ResolvedTransportSecrets,
): McpTransportConfig {
  if (config.type === 'stdio') {
    return {
      type: 'stdio',
      command: config.command,
      args: config.args,
      env: { ...config.env, ...resolved.env },
      credentials: undefined,
    };
  }
  return {
    type: 'http',
    url: config.url,
    headers: { ...config.headers, ...resolved.headers },
    credentials: undefined,
  };
}

async function buildTransport(config: McpTransportConfig): Promise<Transport> {
  if (config.type === 'stdio') {
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    const env = { ...config.env };
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: Object.keys(env).length > 0 ? env : undefined,
    });
  }
  const { StreamableHTTPClientTransport } = await import(
    '@modelcontextprotocol/sdk/client/streamableHttp.js'
  );
  const headers = { ...config.headers };
  return new StreamableHTTPClientTransport(
    new URL(config.url),
    Object.keys(headers).length > 0 ? { requestInit: { headers } } : undefined,
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function clone(server: RegisteredServer): RegisteredServer {
  return structuredClone(server);
}

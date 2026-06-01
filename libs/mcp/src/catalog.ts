/**
 * Tool catalog sync (HELIX-82). Aggregates the tools advertised across all enabled
 * MCP servers in the {@link McpServerRegistry} into one flat catalog the agent
 * runtime can read — each entry carries its `serverId` (and a collision-safe
 * `qualifiedName`) so a tool call can be routed back to the right server.
 */
import { HelixMcpClient } from './client';
import { McpServerConnector, McpServerRegistry } from './registry';
import { McpToolDescriptor } from './types';

/** A discovered tool, tagged with the server it came from. */
export interface CatalogTool extends McpToolDescriptor {
  serverId: string;
  /** Collision-safe routing key across servers: `${serverId}:${name}`. */
  qualifiedName: string;
}

/** Per-server outcome of a {@link McpToolCatalog.sync}. */
export type CatalogServerResult = { toolCount: number } | { error: string };

export interface CatalogSyncResult {
  tools: CatalogTool[];
  /** Keyed by server id: how many tools synced, or why it was skipped. */
  servers: Record<string, CatalogServerResult>;
}

/**
 * Builds and holds the aggregated tool catalog. `sync` connects to each enabled
 * server (via the injected connector — the same one the registry uses), lists its
 * tools, and merges them; a server that fails is recorded and skipped without
 * aborting the rest.
 */
export class McpToolCatalog {
  private tools: CatalogTool[] = [];

  constructor(
    private readonly registry: McpServerRegistry,
    private readonly connector: McpServerConnector,
  ) {}

  /** Re-discover tools from all enabled servers and rebuild the catalog. */
  async sync(): Promise<CatalogSyncResult> {
    const tools: CatalogTool[] = [];
    const servers: Record<string, CatalogServerResult> = {};

    for (const server of this.registry.list()) {
      if (!server.enabled) continue;
      let client: HelixMcpClient | undefined;
      try {
        client = await this.connector(server);
        const discovered = await client.listTools();
        for (const tool of discovered) {
          tools.push({ ...tool, serverId: server.id, qualifiedName: `${server.id}:${tool.name}` });
        }
        servers[server.id] = { toolCount: discovered.length };
      } catch (err) {
        servers[server.id] = { error: err instanceof Error ? err.message : String(err) };
      } finally {
        await client?.close().catch(() => undefined);
      }
    }

    this.tools = tools;
    return { tools: [...tools], servers };
  }

  /** All catalog tools from the last {@link sync}. */
  list(): CatalogTool[] {
    return [...this.tools];
  }

  /** Tools contributed by a specific server. */
  byServer(serverId: string): CatalogTool[] {
    return this.tools.filter((t) => t.serverId === serverId);
  }

  /** Look up a tool by its `${serverId}:${name}` qualified name. */
  find(qualifiedName: string): CatalogTool | undefined {
    return this.tools.find((t) => t.qualifiedName === qualifiedName);
  }
}

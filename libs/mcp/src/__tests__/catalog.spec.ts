import { HelixMcpClient } from '../client';
import { McpToolCatalog } from '../catalog';
import { McpServerConnector, McpServerRegistry, RegisteredServer } from '../registry';

const stdio = { type: 'stdio', command: 'x' } as const;

/** Connector that serves each server its configured tool names (or fails). */
function catalogConnector(spec: Record<string, string[] | 'fail'>): McpServerConnector {
  return async (server: RegisteredServer): Promise<HelixMcpClient> => {
    const tools = spec[server.id];
    if (tools === undefined || tools === 'fail') {
      throw new Error(`cannot connect to ${server.id}`);
    }
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const srv = new McpServer({ name: server.id, version: '1.0.0' });
    for (const name of tools) {
      srv.registerTool(name, { description: `${name} on ${server.id}`, inputSchema: {} }, async () => ({
        content: [],
      }));
    }
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await srv.connect(serverTransport);
    const client = new HelixMcpClient();
    await client.connect(clientTransport);
    return client;
  };
}

describe('McpToolCatalog', () => {
  it('aggregates tools across servers with server-qualified names', async () => {
    const connector = catalogConnector({ gh: ['create_pr', 'list_issues'], fs: ['read_file'] });
    const registry = new McpServerRegistry(connector);
    registry.register({ id: 'gh', transport: stdio });
    registry.register({ id: 'fs', transport: stdio });
    const catalog = new McpToolCatalog(registry, connector);

    const result = await catalog.sync();

    expect(result.tools.map((t) => t.qualifiedName).sort()).toEqual([
      'fs:read_file',
      'gh:create_pr',
      'gh:list_issues',
    ]);
    expect(result.servers).toEqual({ gh: { toolCount: 2 }, fs: { toolCount: 1 } });
    expect(catalog.byServer('gh').map((t) => t.name).sort()).toEqual(['create_pr', 'list_issues']);
    const tool = catalog.find('fs:read_file');
    expect(tool?.serverId).toBe('fs');
    expect(tool?.inputSchema['type']).toBe('object');
  });

  it('keeps same-named tools from different servers distinct', async () => {
    const connector = catalogConnector({ a: ['search'], b: ['search'] });
    const registry = new McpServerRegistry(connector);
    registry.register({ id: 'a', transport: stdio });
    registry.register({ id: 'b', transport: stdio });
    const catalog = new McpToolCatalog(registry, connector);

    await catalog.sync();

    expect(catalog.list().map((t) => t.qualifiedName).sort()).toEqual(['a:search', 'b:search']);
  });

  it('skips a failing server but still catalogs the others', async () => {
    const connector = catalogConnector({ ok: ['t1'], broken: 'fail' });
    const registry = new McpServerRegistry(connector);
    registry.register({ id: 'ok', transport: stdio });
    registry.register({ id: 'broken', transport: stdio });
    const catalog = new McpToolCatalog(registry, connector);

    const result = await catalog.sync();

    expect(result.tools.map((t) => t.qualifiedName)).toEqual(['ok:t1']);
    expect(result.servers['ok']).toEqual({ toolCount: 1 });
    expect(result.servers['broken']).toEqual({ error: 'cannot connect to broken' });
  });

  it('excludes disabled servers', async () => {
    const connector = catalogConnector({ on: ['t1'], off: ['t2'] });
    const registry = new McpServerRegistry(connector);
    registry.register({ id: 'on', transport: stdio });
    registry.register({ id: 'off', transport: stdio });
    registry.disable('off');
    const catalog = new McpToolCatalog(registry, connector);

    const result = await catalog.sync();

    expect(result.tools.map((t) => t.qualifiedName)).toEqual(['on:t1']);
    expect(result.servers['off']).toBeUndefined(); // not even attempted
  });

  it('re-sync replaces the previous catalog', async () => {
    const registry = new McpServerRegistry(catalogConnector({ gh: ['a'] }));
    registry.register({ id: 'gh', transport: stdio });
    const catalog = new McpToolCatalog(registry, catalogConnector({ gh: ['a', 'b'] }));

    await catalog.sync();
    expect(catalog.list()).toHaveLength(2); // connector for catalog returns a,b
  });
});

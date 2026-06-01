import { HelixMcpClient } from '../client';
import {
  DuplicateMcpServerError,
  McpServerConfig,
  McpServerNotFoundError,
  McpServerRegistry,
} from '../registry';

const cfg = (over: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: 'gh',
  name: 'GitHub',
  transport: { type: 'stdio', command: 'github-mcp-server' },
  ...over,
});

/** A connector backed by a real in-memory MCP server exposing `toolNames`. */
function inMemoryConnector(toolNames: string[]) {
  return async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const server = new McpServer({ name: 'srv', version: '1.0.0' });
    for (const name of toolNames) {
      server.registerTool(name, { description: name, inputSchema: {} }, async () => ({ content: [] }));
    }
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new HelixMcpClient();
    await client.connect(clientTransport);
    return client;
  };
}

const failingConnector = async (): Promise<HelixMcpClient> => {
  throw new Error('connect refused');
};

describe('McpServerRegistry — registration', () => {
  it('registers, lists, and gets servers (enabled, unknown health)', () => {
    const reg = new McpServerRegistry(failingConnector);
    reg.register(cfg());
    expect(reg.list().map((s) => s.id)).toEqual(['gh']);
    expect(reg.get('gh')).toMatchObject({ id: 'gh', enabled: true, health: { status: 'unknown' } });
  });

  it('rejects a duplicate id', () => {
    const reg = new McpServerRegistry(failingConnector);
    reg.register(cfg());
    expect(() => reg.register(cfg())).toThrow(DuplicateMcpServerError);
  });

  it('throws on unknown id for get/enable/disable/remove', () => {
    const reg = new McpServerRegistry(failingConnector);
    expect(() => reg.get('nope')).toThrow(McpServerNotFoundError);
    expect(() => reg.enable('nope')).toThrow(McpServerNotFoundError);
    expect(() => reg.disable('nope')).toThrow(McpServerNotFoundError);
    expect(() => reg.remove('nope')).toThrow(McpServerNotFoundError);
  });

  it('registers disabled when enabled:false', () => {
    const reg = new McpServerRegistry(failingConnector);
    reg.register(cfg({ enabled: false }));
    expect(reg.get('gh')).toMatchObject({ enabled: false, health: { status: 'disabled' } });
  });
});

describe('McpServerRegistry — health checks', () => {
  it('reports healthy with the tool count when the server responds', async () => {
    const reg = new McpServerRegistry(inMemoryConnector(['a', 'b', 'c']));
    reg.register(cfg());
    const health = await reg.healthCheck('gh');
    expect(health.status).toBe('healthy');
    expect(health.toolCount).toBe(3);
    expect(typeof health.checkedAt).toBe('string');
    expect(reg.get('gh').health.status).toBe('healthy'); // persisted on the server
  });

  it('reports unhealthy with the error when connecting fails', async () => {
    const reg = new McpServerRegistry(failingConnector);
    reg.register(cfg());
    const health = await reg.healthCheck('gh');
    expect(health.status).toBe('unhealthy');
    expect(health.error).toContain('connect refused');
  });

  it('skips connecting for a disabled server', async () => {
    let connectorCalled = false;
    const reg = new McpServerRegistry(async () => {
      connectorCalled = true;
      throw new Error('should not be called');
    });
    reg.register(cfg());
    reg.disable('gh');
    const health = await reg.healthCheck('gh');
    expect(health.status).toBe('disabled');
    expect(connectorCalled).toBe(false);
  });

  it('enable after disable resets health to unknown', () => {
    const reg = new McpServerRegistry(failingConnector);
    reg.register(cfg());
    reg.disable('gh');
    expect(reg.get('gh').health.status).toBe('disabled');
    const back = reg.enable('gh');
    expect(back.enabled).toBe(true);
    expect(back.health.status).toBe('unknown');
  });

  it('healthCheckAll probes every server', async () => {
    const reg = new McpServerRegistry(inMemoryConnector(['x']));
    reg.register(cfg({ id: 'a' }));
    reg.register(cfg({ id: 'b' }));
    reg.register(cfg({ id: 'c', enabled: false }));
    const all = await reg.healthCheckAll();
    expect(all['a'].status).toBe('healthy');
    expect(all['b'].status).toBe('healthy');
    expect(all['c'].status).toBe('disabled');
  });
});

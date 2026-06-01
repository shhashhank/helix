import { z } from 'zod';
import { HelixMcpClient } from '../client';
import { McpNotConnectedError } from '../types';

/** Spin up a tiny in-memory MCP server with two tools and a client wired to it. */
async function connectedClient() {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');

  const server = new McpServer({ name: 'test-server', version: '1.0.0' });
  server.registerTool(
    'echo',
    { description: 'Echoes a message back', inputSchema: { message: z.string() } },
    async ({ message }) => ({ content: [{ type: 'text', text: `echo: ${message}` }] }),
  );
  server.registerTool(
    'boom',
    { description: 'Always fails', inputSchema: {} },
    async () => ({ content: [{ type: 'text', text: 'kaboom' }], isError: true }),
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new HelixMcpClient({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return { client, server };
}

describe('HelixMcpClient', () => {
  it('handshakes on connect and reports connected', async () => {
    const { client } = await connectedClient();
    expect(client.connected).toBe(true);
    await client.close();
    expect(client.connected).toBe(false);
  });

  it('discovers the server tools with their schemas', async () => {
    const { client } = await connectedClient();
    const tools = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual(['boom', 'echo']);
    const echo = tools.find((t) => t.name === 'echo');
    expect(echo?.description).toContain('Echoes');
    expect(echo?.inputSchema['type']).toBe('object'); // zod shape → JSON Schema
    await client.close();
  });

  it('invokes a tool and returns its result', async () => {
    const { client } = await connectedClient();
    const res = await client.callTool('echo', { message: 'hi' });

    expect(res.isError).toBe(false);
    expect(JSON.stringify(res.content)).toContain('echo: hi');
    await client.close();
  });

  it('surfaces a tool-reported failure via isError (does not throw)', async () => {
    const { client } = await connectedClient();
    const res = await client.callTool('boom');

    expect(res.isError).toBe(true);
    await client.close();
  });

  it('throws McpNotConnectedError before connect', async () => {
    const client = new HelixMcpClient();
    await expect(client.listTools()).rejects.toBeInstanceOf(McpNotConnectedError);
    await expect(client.callTool('echo')).rejects.toBeInstanceOf(McpNotConnectedError);
  });
});

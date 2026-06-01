/**
 * MCP client (HELIX-80) — handshake, tool discovery, and invocation against an MCP
 * server, wrapping the official `@modelcontextprotocol/sdk` `Client`.
 *
 * The SDK is ESM-first; this lib type-checks with `moduleResolution: bundler`
 * (so its `exports` map resolves) and is emitted to CommonJS (so the SDK loads
 * via its `require`/CJS build at runtime). The client is **transport-agnostic**:
 * pass any SDK transport (in-memory for tests, stdio for a real server, …).
 */
import { Client } from '@modelcontextprotocol/sdk/client';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  McpClientInfo,
  McpNotConnectedError,
  McpToolDescriptor,
  McpToolResult,
} from './types';

const DEFAULT_INFO: McpClientInfo = { name: 'helix', version: '0.1.0' };

export class HelixMcpClient {
  private client?: Client;

  constructor(private readonly info: McpClientInfo = DEFAULT_INFO) {}

  /** True once {@link connect} has completed the handshake. */
  get connected(): boolean {
    return this.client !== undefined;
  }

  /** Connect over the given transport and perform the MCP initialize handshake. */
  async connect(transport: Transport): Promise<void> {
    const client = new Client(this.info);
    await client.connect(transport);
    this.client = client;
  }

  /** Discover the tools the connected server advertises. */
  async listTools(): Promise<McpToolDescriptor[]> {
    const { tools } = await this.requireClient().listTools();
    return tools.map((t: Tool) => ({
      name: t.name,
      description: t.description,
      inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
    }));
  }

  /**
   * Invoke a tool by name. A tool that reports failure comes back with
   * `isError: true` (not thrown); only transport/protocol errors throw.
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
    const result = (await this.requireClient().callTool({
      name,
      arguments: args,
    })) as CallToolResult;
    return {
      content: (result.content ?? []) as unknown[],
      isError: result.isError === true,
    };
  }

  /** Close the connection (idempotent). */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = undefined;
    }
  }

  private requireClient(): Client {
    if (!this.client) throw new McpNotConnectedError();
    return this.client;
  }
}

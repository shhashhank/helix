/**
 * Helix-facing MCP types (HELIX-80). These are our own surface over the official
 * `@modelcontextprotocol/sdk`, so the rest of the platform (agent loop, server
 * registry) depends on a small, stable shape rather than the SDK's types directly.
 */

/** A tool advertised by an MCP server, as surfaced to the agent runtime. */
export interface McpToolDescriptor {
  name: string;
  description?: string;
  /** JSON Schema for the tool's arguments (object schema). */
  inputSchema: Record<string, unknown>;
}

/** The result of invoking a tool. */
export interface McpToolResult {
  /** MCP content blocks (text/image/resource/…), passed through as-is. */
  content: unknown[];
  /** True if the tool reported a failure (vs. a transport/protocol error, which throws). */
  isError: boolean;
}

/** Identifies this client to the MCP server during the handshake. */
export interface McpClientInfo {
  name: string;
  version: string;
}

/** Thrown when an operation needs a live connection but {@link HelixMcpClient.connect} hasn't run. */
export class McpNotConnectedError extends Error {
  constructor() {
    super('MCP client is not connected — call connect() first');
    this.name = 'McpNotConnectedError';
  }
}

import type { LlmCompletion, LlmUsage } from '@helix/llm';
import type { AgentStopReason, GuardrailBreach, ToolCall, ToolResult } from './types';

/**
 * `agent.*` lifecycle events emitted as a run progresses (HELIX-61). A handler
 * (or {@link InMemoryEventBus}) receives them in order, giving observers a live
 * view of the loop for tracing, dashboards, or streaming to a UI.
 */
export type AgentEvent =
  | { type: 'agent.run.start'; at: Date }
  | { type: 'agent.step.start'; index: number; at: Date }
  | {
      type: 'agent.model.response';
      index: number;
      model: string;
      usage: LlmUsage;
      stopReason: LlmCompletion['stopReason'];
      at: Date;
    }
  | { type: 'agent.tool.start'; index: number; call: ToolCall; at: Date }
  | { type: 'agent.tool.result'; index: number; call: ToolCall; result: ToolResult; at: Date }
  | { type: 'agent.step.end'; index: number; toolCalls: ToolCall[]; at: Date }
  | {
      type: 'agent.run.end';
      stopReason: AgentStopReason;
      iterations: number;
      totals: { tokens: number; costUsd: number };
      breach?: GuardrailBreach;
      at: Date;
    };

export type AgentEventType = AgentEvent['type'];
export type AgentEventHandler = (event: AgentEvent) => void;

/**
 * Minimal in-process event bus: records every event and fans out to subscribers.
 * Pass `bus.emit` as `runAgent`'s `onEvent`. A durable/external bus can implement
 * the same `(event) => void` shape.
 */
export class InMemoryEventBus {
  readonly events: AgentEvent[] = [];
  private handlers: AgentEventHandler[] = [];

  emit = (event: AgentEvent): void => {
    this.events.push(event);
    for (const handler of this.handlers) handler(event);
  };

  subscribe(handler: AgentEventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  /** Events of a given type, narrowed. */
  ofType<T extends AgentEventType>(type: T): Extract<AgentEvent, { type: T }>[] {
    return this.events.filter((e) => e.type === type) as Extract<AgentEvent, { type: T }>[];
  }
}

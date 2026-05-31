/**
 * Temporal integration barrel (HELIX-71). Intentionally NOT re-exported from the
 * package root (`src/index.ts`) so that pure consumers of `@helix/workflow` (the
 * DSL, validator, compiler, in-process runner, registry) don't transitively load
 * the heavyweight `@temporalio/worker` native runtime. Import this barrel — or its
 * individual modules — only where durable execution is actually wired up.
 */
export * from './shared';
export * from './activities';
export * from './worker';
export * from './client';
export * from './idempotency-key';
export * from './approval';
export * from './approval-activities';
export { executeWorkflow, approvalGateWorkflow, requestApprovalWorkflow } from './workflows';

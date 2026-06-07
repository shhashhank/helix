/**
 * Client-side Temporal entrypoint (`@helix/workflow/temporal-client`). Exposes
 * only the pieces a *dispatcher* needs — starting/inspecting/cancelling/retrying
 * runs and the shared queue/type constants — WITHOUT pulling in the heavyweight
 * `@temporalio/worker` native runtime. Safe to import from an API service (e.g.
 * the orchestrator) that talks to Temporal but does not host workflow execution.
 */
export * from './lib/temporal/shared';
export * from './lib/temporal/client';
export * from './lib/temporal/decision';

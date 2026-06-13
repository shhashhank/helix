import type { WorkflowDefinition } from '@helix/workflow';

/**
 * Build the workflow for a request (HELIX-145). For now this is the **standard
 * delivery pipeline** — plan → code → review → test → deploy — named after the
 * request. Turning the request's free-text `prompt` into a *custom* DAG via the
 * Planning Agent (`@helix/planning`) is the deferred binding (it needs the LLM,
 * which CI can't call) — see DEFERRED.md. A caller may also pass an explicit
 * workflow to override this default.
 */
export function requestToWorkflow(request: { id: string }): WorkflowDefinition {
  return {
    name: `request-${request.id}`,
    steps: [
      { id: 'plan', agentRole: 'planning' },
      { id: 'code', agentRole: 'coding' },
      { id: 'review', agentRole: 'code_review' },
      { id: 'test', agentRole: 'testing' },
      { id: 'deploy', agentRole: 'deployment' },
    ],
    edges: [
      { from: 'plan', to: 'code', when: 'success' },
      { from: 'code', to: 'review', when: 'success' },
      { from: 'review', to: 'test', when: 'success' },
      { from: 'test', to: 'deploy', when: 'success' },
    ],
  };
}

import type { WorkflowDefinition } from '@helix/workflow';

/** Where a request's run should open its PR (threaded into the delivery step, HELIX-186). */
export interface DeliveryRepo {
  owner: string;
  repo: string;
  base?: string;
  /** The org's GitHub App installation to act as. */
  installationId: string;
}

/**
 * Build the workflow for a request (HELIX-145). The **standard delivery pipeline** —
 * plan → code → review → test → deploy — named after the request. When the request names
 * a target `repo` (HELIX-186), a **deliver** step is inserted after testing to open a PR
 * with the run's changes. Turning the request's free-text `prompt` into a *custom* DAG via
 * the Planning Agent (`@helix/planning`) is the deferred binding (it needs the LLM, which
 * CI can't call) — see DEFERRED.md. A caller may also pass an explicit workflow to override.
 */
export function requestToWorkflow(request: { id: string; repo?: DeliveryRepo }): WorkflowDefinition {
  const steps: WorkflowDefinition['steps'] = [
    { id: 'plan', agentRole: 'planning' },
    { id: 'code', agentRole: 'coding' },
    { id: 'review', agentRole: 'code_review' },
    { id: 'test', agentRole: 'testing' },
  ];
  const edges: WorkflowDefinition['edges'] = [
    { from: 'plan', to: 'code', when: 'success' },
    { from: 'code', to: 'review', when: 'success' },
    { from: 'review', to: 'test', when: 'success' },
  ];

  if (request.repo) {
    steps.push({ id: 'deliver', agentRole: 'delivery', config: { delivery: request.repo } });
    edges.push({ from: 'test', to: 'deliver', when: 'success' });
    steps.push({ id: 'deploy', agentRole: 'deployment' });
    edges.push({ from: 'deliver', to: 'deploy', when: 'success' });
  } else {
    steps.push({ id: 'deploy', agentRole: 'deployment' });
    edges.push({ from: 'test', to: 'deploy', when: 'success' });
  }

  return { name: `request-${request.id}`, steps, edges };
}

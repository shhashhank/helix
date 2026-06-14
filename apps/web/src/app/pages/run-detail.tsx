/**
 * Run detail (HELIX-177): a request's run, watched **live**. Loads the run status +
 * artifacts, then streams per-step progress over SSE (via the auth-aware fetch stream),
 * updating the step list as the agents work, and refreshes status + artifacts when the
 * stream ends.
 */
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/auth-context';
import type { RunArtifacts, RunStatus, WorkflowProgress } from '../../api/types';
import { StatusBadge } from '../components/status-badge';

interface StepView {
  id: string;
  state: 'pending' | 'running' | 'success' | 'failure' | 'skipped';
  error?: string;
}

/** Flatten the run's topological levels into an ordered step list with each step's state. */
function deriveSteps(progress?: WorkflowProgress): StepView[] {
  if (!progress) return [];
  return progress.levels.flat().map((id) => {
    const outcome = progress.steps[id];
    let state: StepView['state'] = 'pending';
    if (outcome) state = outcome.ran ? (outcome.status ?? 'running') : 'skipped';
    return { id, state, error: outcome?.error };
  });
}

export function RunDetail(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const { api } = useAuth();
  const [run, setRun] = useState<RunStatus | undefined>();
  const [progress, setProgress] = useState<WorkflowProgress | undefined>();
  const [artifacts, setArtifacts] = useState<RunArtifacts | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!id) return;
    let active = true;
    const controller = new AbortController();

    const refresh = async (): Promise<void> => {
      try {
        const [status, arts] = await Promise.all([
          api.get<RunStatus>(`/api/requests/${id}/run`),
          api.get<RunArtifacts>(`/api/requests/${id}/artifacts`),
        ]);
        if (active) {
          setRun(status);
          setArtifacts(arts);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load the run');
      }
    };

    void refresh();
    // Live per-step progress; when the stream closes, refresh the final status + artifacts.
    api
      .streamEvents<WorkflowProgress>(
        `/api/requests/${id}/stream`,
        (p) => {
          if (active) setProgress(p);
        },
        controller.signal,
      )
      .then(() => {
        if (active) void refresh();
      })
      .catch(() => undefined); // stream aborted / ended

    return () => {
      active = false;
      controller.abort();
    };
  }, [id, api]);

  const steps = useMemo(() => deriveSteps(progress), [progress]);

  return (
    <section className="helix-run">
      <p>
        <Link to="/">← Dashboard</Link>
      </p>
      <h1>Run {run ? <StatusBadge status={run.status} /> : <span className="helix-muted">loading…</span>}</h1>
      {error && <p role="alert" className="helix-error">{error}</p>}

      <h2>Steps</h2>
      {steps.length === 0 ? (
        <p className="helix-muted">Waiting for the run to start…</p>
      ) : (
        <ol className="helix-steps">
          {steps.map((step) => (
            <li key={step.id}>
              <StatusBadge status={step.state} /> <span className="helix-step-id">{step.id}</span>
              {step.error && <span className="helix-error"> — {step.error}</span>}
            </li>
          ))}
        </ol>
      )}

      <h2>Artifacts</h2>
      <ul className="helix-artifacts">
        <li>
          <strong>Pull request:</strong>{' '}
          {artifacts?.pullRequest ? (
            <a href={artifacts.pullRequest.url} target="_blank" rel="noreferrer">
              {artifacts.pullRequest.title ?? artifacts.pullRequest.url}
            </a>
          ) : (
            <span className="helix-muted">—</span>
          )}
        </li>
        <li>
          <strong>Tests:</strong>{' '}
          {artifacts?.tests ? (
            <span>
              {artifacts.tests.passed} passed, {artifacts.tests.failed} failed
              {artifacts.tests.coverage !== undefined ? ` · ${artifacts.tests.coverage}% coverage` : ''}
            </span>
          ) : (
            <span className="helix-muted">—</span>
          )}
        </li>
        <li>
          <strong>Deployment:</strong>{' '}
          {artifacts?.deployment ? (
            <a href={artifacts.deployment.url} target="_blank" rel="noreferrer">
              {artifacts.deployment.url}
            </a>
          ) : (
            <span className="helix-muted">—</span>
          )}
        </li>
      </ul>
    </section>
  );
}

export default RunDetail;

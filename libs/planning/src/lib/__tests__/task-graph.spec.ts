import { ImplementationTask } from '../task-plan';
import {
  findCycles,
  orderTaskGraph,
  TaskGraphError,
  validateTaskGraph,
} from '../task-graph';

/** Compact task builder — only id + deps matter for graph tests. */
function task(id: string, dependsOn: string[] = []): ImplementationTask {
  return {
    id,
    title: id,
    description: id,
    category: 'backend',
    dependsOn,
    requirementIds: [],
  };
}

describe('validateTaskGraph', () => {
  it('returns no issues for a clean graph', () => {
    expect(validateTaskGraph([task('T-1'), task('T-2', ['T-1'])])).toEqual([]);
  });

  it('flags duplicate ids', () => {
    const issues = validateTaskGraph([task('T-1'), task('T-1')]);
    expect(issues).toEqual([expect.objectContaining({ type: 'duplicate-id', taskId: 'T-1' })]);
  });

  it('flags dependencies on tasks that do not exist', () => {
    const issues = validateTaskGraph([task('T-1', ['T-9'])]);
    expect(issues).toEqual([expect.objectContaining({ type: 'unknown-dependency', taskId: 'T-1' })]);
  });

  it('flags self-dependencies', () => {
    const issues = validateTaskGraph([task('T-1', ['T-1'])]);
    expect(issues).toEqual([expect.objectContaining({ type: 'self-dependency', taskId: 'T-1' })]);
  });
});

describe('findCycles', () => {
  it('returns no cycles for a DAG', () => {
    expect(findCycles([task('T-1'), task('T-2', ['T-1']), task('T-3', ['T-1', 'T-2'])])).toEqual([]);
  });

  it('detects a two-node cycle', () => {
    const cycles = findCycles([task('T-1', ['T-2']), task('T-2', ['T-1'])]);
    expect(cycles).toHaveLength(1);
    expect(new Set(cycles[0])).toEqual(new Set(['T-1', 'T-2']));
  });

  it('detects a longer cycle and dedupes it to one', () => {
    const cycles = findCycles([
      task('T-1', ['T-3']),
      task('T-2', ['T-1']),
      task('T-3', ['T-2']),
    ]);
    expect(cycles).toHaveLength(1);
    expect(new Set(cycles[0])).toEqual(new Set(['T-1', 'T-2', 'T-3']));
  });
});

describe('orderTaskGraph', () => {
  it('produces a topological order and parallelizable waves', () => {
    const tasks = [
      task('T-1'),
      task('T-2', ['T-1']),
      task('T-3', ['T-1']),
      task('T-4', ['T-2', 'T-3']),
    ];
    const { order, waves } = orderTaskGraph(tasks);

    expect(waves.map((w) => w.map((t) => t.id))).toEqual([['T-1'], ['T-2', 'T-3'], ['T-4']]);
    expect(order.map((t) => t.id)).toEqual(['T-1', 'T-2', 'T-3', 'T-4']);
    // every task appears after all of its dependencies
    const pos = new Map(order.map((t, i) => [t.id, i]));
    for (const t of tasks) for (const d of t.dependsOn) expect(pos.get(d)!).toBeLessThan(pos.get(t.id)!);
  });

  it('puts fully independent tasks in a single wave', () => {
    const { waves } = orderTaskGraph([task('A'), task('B'), task('C')]);
    expect(waves).toHaveLength(1);
    expect(waves[0].map((t) => t.id)).toEqual(['A', 'B', 'C']);
  });

  it('throws TaskGraphError with a cycle issue', () => {
    try {
      orderTaskGraph([task('T-1', ['T-2']), task('T-2', ['T-1'])]);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TaskGraphError);
      expect((err as TaskGraphError).issues.map((i) => i.type)).toContain('cycle');
    }
  });

  it('throws on unknown and self dependencies', () => {
    expect(() => orderTaskGraph([task('T-1', ['T-9'])])).toThrow(TaskGraphError);
    expect(() => orderTaskGraph([task('T-1', ['T-1'])])).toThrow(TaskGraphError);
  });
});

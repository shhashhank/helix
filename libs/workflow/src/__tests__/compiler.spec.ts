import { compileWorkflow } from '../lib/compiler';
import { WorkflowDefinition } from '../lib/types';
import { WorkflowValidationFailed } from '../lib/validator';

const def = (steps: string[], edges: [string, string][]): WorkflowDefinition => ({
  name: 'w',
  steps: steps.map((id) => ({ id, agentRole: 'x' })),
  edges: edges.map(([from, to]) => ({ from, to })),
});

describe('compileWorkflow', () => {
  it('layers a linear chain one step per level', () => {
    const plan = compileWorkflow(def(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]));
    expect(plan.levels).toEqual([['a'], ['b'], ['c']]);
  });

  it('puts independent entry steps in the same first level', () => {
    const plan = compileWorkflow(def(['a', 'b', 'c'], [['a', 'c'], ['b', 'c']]));
    expect(plan.levels).toEqual([['a', 'b'], ['c']]);
  });

  it('layers a diamond by longest path (join waits for both branches)', () => {
    // a → b, a → c, b → d, c → d
    const plan = compileWorkflow(def(['a', 'b', 'c', 'd'], [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']]));
    expect(plan.levels).toEqual([['a'], ['b', 'c'], ['d']]);
  });

  it('places a join after the deeper of its parents', () => {
    // a→b→review, a→fix, fix→review  ⇒ review waits for fix's level
    const plan = compileWorkflow(
      def(['a', 'b', 'fix', 'review'], [['a', 'b'], ['a', 'fix'], ['b', 'review'], ['fix', 'review']]),
    );
    expect(plan.levels).toEqual([['a'], ['b', 'fix'], ['review']]);
  });

  it('throws on an invalid/cyclic definition', () => {
    expect(() => compileWorkflow(def(['a', 'b'], [['a', 'b'], ['b', 'a']]))).toThrow(WorkflowValidationFailed);
  });
});

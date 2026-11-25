/**
 * 6 軸と公理の側をまとめた差分(`lib/diff/with-axioms.ts`)のテスト。
 *
 * 公理の側の源が壊れている(ファイルはあるが読めない)版が、`spec:diff` の「判定できなかった生成物」として
 * 結果の問題に載り(赤になる)、反対側が丸ごと「増えた」「消えた」に化けないことを見る。
 */

import { describe, expect, it } from 'vitest';
import { generatedStatementsPath } from '../../../lib/diff/axiom-sources.js';
import { renderDiff } from '../../../lib/diff/render.js';
import { semanticDiffWithAxioms } from '../../../lib/diff/with-axioms.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';
import { snapshot } from './fixtures.js';

const STATEMENTS = `export const invariantStatements = {\n  'INV-X-001': '数は上限を超えない',\n  'INV-X-002': '名前は重複しない',\n} as const;\n`;
const path = generatedStatementsPath(TEST_ROOTS);

describe('semanticDiffWithAxioms(6 軸と公理の側を 1 つの結果にまとめる)', () => {
  it('両方読めて同じなら、差分も問題も無い', () => {
    const { outcome, axiom } = semanticDiffWithAxioms(snapshot({ [path]: STATEMENTS }), snapshot({ [path]: STATEMENTS }), TEST_ROOTS);

    expect(axiom).toEqual([]);
    expect(outcome.problems).toEqual([]);
  });

  it('比較先の言明が壊れていたら、「消えた」ではなく「判定できなかった生成物」として問題に載せる(赤の根拠)', () => {
    const { outcome, axiom } = semanticDiffWithAxioms(
      snapshot({ [path]: STATEMENTS }),
      snapshot({ [path]: 'export const invariantStatements = {' }),
      TEST_ROOTS,
    );

    expect(axiom).toEqual([]);
    expect(outcome.problems.some((problem) => problem.kind === 'unreadable' && problem.side === 'head' && problem.path === path)).toBe(true);
    const markdown = renderDiff(outcome, 'HEAD~1', [], axiom);
    expect(markdown).toContain('判定できなかった生成物');
    expect(markdown).toContain(path);
    expect(markdown).not.toContain('が消えた');
    expect(markdown).toContain('判定できた範囲に意味の差分はありません');
  });

  it('基点の言明が壊れていたら、比較先の言明は「増えた」にならない', () => {
    const { outcome, axiom } = semanticDiffWithAxioms(
      snapshot({ [path]: "export const invariantStatements = 'oops';\n" }),
      snapshot({ [path]: STATEMENTS }),
      TEST_ROOTS,
    );

    expect(axiom).toEqual([]);
    expect(outcome.problems.map((problem) => [problem.kind, problem.side])).toEqual([['unreadable', 'base']]);
  });

  it('壊れていない側の差分は、そのまま公理の側に出る', () => {
    const { axiom } = semanticDiffWithAxioms(snapshot({ [path]: STATEMENTS }), snapshot({ [path]: STATEMENTS.replace('名前は重複しない', '名前は一意') }), TEST_ROOTS);

    expect(axiom.map((change) => [change.element, change.kind, change.key])).toEqual([['invariant.statement', 'changed', 'INV-X-002']]);
  });
});

import { describe, expect, it } from 'vitest';
import { semanticDiff } from '../../../lib/diff/collect.js';
import { diffSources, ignoredSources, labelSources, stemOf } from '../../../lib/diff/sources.js';
import { GENERATED, implicationsFile, labelsFile, RESULTS, rlsFile, screensFile, snapshot } from './fixtures.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';

describe('diffSources(TEST_ROOTS) — 差分の元の宣言', () => {
  it('どの元にも「なぜ意味を持つか」の 1 行がある', () => {
    for (const source of [...diffSources(TEST_ROOTS), ...labelSources(TEST_ROOTS)]) {
      expect(source.why.length).toBeGreaterThan(0);
    }
  });

  it('6 軸すべてに元がある(軸だけあって材料が無い、を作らない)', () => {
    const covered = new Set(diffSources(TEST_ROOTS).flatMap((source) => source.axes));
    expect([...covered].sort()).toEqual(['columns', 'notifications', 'operations', 'permission', 'rows', 'screens']);
  });

  it('仕様(docs/specs)は元に入れない(書き方の差が混ざるため)', () => {
    expect(diffSources(TEST_ROOTS).some((source) => source.path.startsWith('docs/specs'))).toBe(false);
  });

  it('走査の元には接尾辞がある', () => {
    for (const source of [...diffSources(TEST_ROOTS), ...labelSources(TEST_ROOTS)]) {
      if (source.kind === 'glob') expect(source.suffix).toBeTruthy();
    }
  });

  it('**読まない生成物にも理由がある**(「まだ考えていない」と「落とした」を分ける)', () => {
    expect(ignoredSources(TEST_ROOTS).length).toBeGreaterThan(0);
    for (const ignored of ignoredSources(TEST_ROOTS)) {
      expect(ignored.path.length).toBeGreaterThan(0);
      expect(ignored.why.length).toBeGreaterThan(0);
    }
  });

  it('読む元と読まない元が同じパスを宣言しない', () => {
    const read = new Set(diffSources(TEST_ROOTS).filter((source) => source.kind === 'file').map((source) => source.path));
    for (const ignored of ignoredSources(TEST_ROOTS)) expect(read.has(ignored.path)).toBe(false);
  });
});

describe('stemOf — パスから機械・集約の綴りを取る', () => {
  it('最初のドットまでを名前にする', () => {
    expect(stemOf(`${GENERATED}/unit.transitions.ts`)).toBe('unit');
    expect(stemOf(`${RESULTS}/unit.json`)).toBe('unit');
  });
});

describe('semanticDiff — 全体', () => {
  it('中身が同じなら 0 件(比べた本数は数える)', () => {
    const files = {
      [`${GENERATED}/roles.ts`]: implicationsFile({ chief: '責任者' }, {}),
      [`${GENERATED}/rls-expectations.ts`]: rlsFile({ units: ['units_select_chief_all'] }),
    };
    const outcome = semanticDiff(snapshot(files), snapshot(files), TEST_ROOTS);
    expect(outcome.changes).toEqual([]);
    expect(outcome.problems).toEqual([]);
    expect(outcome.comparedFiles).toBe(2);
  });

  it('**表示名だけが動いた版は 1 行も出さない**(表示名は判定に使わない)', () => {
    const base = snapshot({
      [`${GENERATED}/unit.labels.ts`]: labelsFile('unit', { idle: '待機中' }, { open: 'ひらく' }),
      [`${GENERATED}/rls-expectations.ts`]: rlsFile({ units: ['units_select_chief_all'] }),
    });
    const head = snapshot({
      [`${GENERATED}/unit.labels.ts`]: labelsFile('unit', { idle: '手すき' }, { open: '開始する' }),
      [`${GENERATED}/rls-expectations.ts`]: rlsFile({ units: ['units_select_chief_all'] }),
    });
    expect(semanticDiff(base, head, TEST_ROOTS).changes).toEqual([]);
  });

  it('両側に無いファイルは比べた本数に数えない', () => {
    const outcome = semanticDiff(snapshot({ [`${GENERATED}/screens.ts`]: null }), snapshot({ [`${GENERATED}/screens.ts`]: null }), TEST_ROOTS);
    expect(outcome.comparedFiles).toBe(0);
    expect(outcome.changes).toEqual([]);
  });

  it('**片側だけ壊れているとき、その軸は 1 行も出さない**(偽の 🔓 を作らない)', () => {
    const intact = screensFile({
      unit_admin: {
        id: 'screen-unit-admin',
        name: 'unit_admin',
        actions: ['unit.open'],
        navigations: [{ on: 'back_link', to: 'screen-unit-list' }],
        requiresAuth: false,
        forRoles: [],
      },
    });
    const broken = 'export const screenRoutes = { unit_admin: {';
    const outcome = semanticDiff(snapshot({ [`${GENERATED}/screens.ts`]: broken }), snapshot({ [`${GENERATED}/screens.ts`]: intact }), TEST_ROOTS);
    expect(outcome.changes).toEqual([]);
    expect(outcome.changes.filter((change) => change.direction === 'widened')).toHaveLength(0);
    expect(outcome.problems.map((problem) => [problem.kind, problem.side])).toEqual([['unreadable', 'base']]);
  });

  it('**結果表が片側だけ壊れていても権限の軸は 1 行も出さない**(消えたに化けない)', () => {
    const intact = JSON.stringify({
      aggregate: 'unit',
      ops: ['unit.open'],
      problems: [],
      caseFields: ['state', 'actor', 'array', 'field', 'axis', 'refusal'],
      actors: [{ key: 'chief', role: 'chief', basis: 'binding', arrays: [] }],
      operations: [
        { op: 'unit.open', refusals: [], cases: [['idle', 'chief', 'from_session', null, [], 0]] },
      ],
    });
    const outcome = semanticDiff(snapshot({ [`${RESULTS}/unit.json`]: intact }), snapshot({ [`${RESULTS}/unit.json`]: intact.slice(0, 80) }), TEST_ROOTS);
    expect(outcome.changes).toEqual([]);
    expect(outcome.problems.some((problem) => problem.kind === 'unreadable')).toBe(true);
  });

  it('壊れているのが基点側でも「読めなかった」として運ぶ(比較先と対称)', () => {
    const broken = 'export const apiViews = { units: {';
    const intact = 'export const apiViews = { units: { columns: [], masked: [] } };';
    const baseBroken = semanticDiff(snapshot({ [`${GENERATED}/api-expectations.ts`]: broken }), snapshot({ [`${GENERATED}/api-expectations.ts`]: intact }), TEST_ROOTS);
    const headBroken = semanticDiff(snapshot({ [`${GENERATED}/api-expectations.ts`]: intact }), snapshot({ [`${GENERATED}/api-expectations.ts`]: broken }), TEST_ROOTS);
    expect(baseBroken.problems.some((problem) => problem.kind === 'unreadable')).toBe(true);
    expect(headBroken.problems.some((problem) => problem.kind === 'unreadable')).toBe(true);
    expect(baseBroken.changes).toEqual([]);
    expect(headBroken.changes).toEqual([]);
  });
});

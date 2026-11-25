/**
 * 検査の登録の語(`lib/kernel/check-entry.ts`)の純関数のテスト。
 * 群の中で同じ ID の段は畳み、群をまたぐ重複は拾う。同じ ID の段が `part` で区別されていなければ拾う。
 */

import { describe, expect, it } from 'vitest';
import {
  distinctChecks,
  duplicateCheckIds,
  flattenCheckGroups,
  repeatedCheckProblems,
  type CheckGroup,
} from '../../../lib/kernel/check-entry.js';

const GROUPS: readonly CheckGroup[] = [
  {
    group: 'a',
    checks: [
      { id: 'T1', part: '前半', title: '一' },
      { id: 'T2', title: '二' },
      { id: 'T1', part: '後半', title: '一の続き' },
    ],
  },
  { group: 'b', checks: [{ id: 'K1', title: 'ケー' }] },
];

describe('distinctChecks', () => {
  it('同じ ID を 1 本に畳み、最初の題を残す(初出の順)', () => {
    expect(distinctChecks(GROUPS[0]?.checks ?? [])).toEqual([
      { id: 'T1', title: '一' },
      { id: 'T2', title: '二' },
    ]);
  });

  it('ID と題以外の欄(実行の関数など)は表に持ち込まない', () => {
    const withRun = [{ id: 'T1', title: '一', run: () => [] }];

    expect(Object.keys(distinctChecks(withRun)[0] ?? {})).toEqual(['id', 'title']);
  });
});

describe('flattenCheckGroups', () => {
  it('群の順・群の中の順を保ち、どの群の検査かを添える', () => {
    expect(flattenCheckGroups(GROUPS).map((row) => `${row.group}:${row.id}`)).toEqual(['a:T1', 'a:T2', 'b:K1']);
  });
});

describe('duplicateCheckIds', () => {
  it('群の中の重複は数えない', () => {
    expect(duplicateCheckIds(GROUPS)).toEqual([]);
  });

  it('同じ ID を 2 つの群が登録していれば、その ID と群を返す', () => {
    const clash: readonly CheckGroup[] = [...GROUPS, { group: 'c', checks: [{ id: 'T2', title: '二の横取り' }] }];

    expect(duplicateCheckIds(clash)).toEqual([{ id: 'T2', groups: ['a', 'c'] }]);
  });
});

describe('repeatedCheckProblems', () => {
  it('同じ ID の段が全部 part を持ち、互いに違えば問題なし(ID が 1 回だけの段は part が要らない)', () => {
    expect(repeatedCheckProblems(GROUPS)).toEqual([]);
  });

  it('part の無い段が混じっていれば、コピーして ID を直し忘れた形として拾う', () => {
    const forgot: readonly CheckGroup[] = [
      { group: 'a', checks: [{ id: 'T1', part: '前半', title: '一' }, { id: 'T1', title: '一のコピー' }] },
    ];

    expect(repeatedCheckProblems(forgot)).toEqual([{ group: 'a', id: 'T1', problem: 'missing_part', parts: ['前半', ''] }]);
  });

  it('part が全部無い 2 段も拾う', () => {
    const bare: readonly CheckGroup[] = [{ group: 'a', checks: [{ id: 'T1', title: '一' }, { id: 'T1', title: '一の続き' }] }];

    expect(repeatedCheckProblems(bare).map((problem) => problem.problem)).toEqual(['missing_part']);
  });

  it('part が同じ 2 段は区別になっていないので拾う', () => {
    const same: readonly CheckGroup[] = [
      { group: 'a', checks: [{ id: 'T1', part: '接地', title: '一' }, { id: 'T1', part: '接地', title: '一の続き' }] },
    ];

    expect(repeatedCheckProblems(same)).toEqual([{ group: 'a', id: 'T1', problem: 'same_part', parts: ['接地', '接地'] }]);
  });

  it('別々の群が同じ ID を 1 回ずつ持つのは、ここでは問題にしない(群をまたぐ重複は duplicateCheckIds が見る)', () => {
    const across: readonly CheckGroup[] = [
      { group: 'a', checks: [{ id: 'T1', title: '一' }] },
      { group: 'b', checks: [{ id: 'T1', title: '一' }] },
    ];

    expect(repeatedCheckProblems(across)).toEqual([]);
  });
});

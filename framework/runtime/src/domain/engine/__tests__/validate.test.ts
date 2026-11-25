/**
 * 遷移テーブルの整合チェックのテスト。
 *
 * 各検査について「違反を検出するケース」と「違反がなく通るケース」を持つ。
 */

import { describe, expect, it } from 'vitest';
import { assertValidTable } from '../validate';
import type { MachineTable, TransitionDef } from '@kaninabe/runtime/engine/types';

/** 整合の取れた最小の表。各テストはここから1点だけ壊す。 */
const validTable: MachineTable = {
  machine: 'entry',
  states: ['draft', 'submitted', 'withdrawn'],
  initial: 'draft',
  final: ['withdrawn'],
  transitions: [
    { event: 'submit', from: ['draft'], to: 'submitted', by: ['borrower'], effects: [] },
    { event: 'withdraw', from: ['submitted'], to: 'withdrawn', by: ['borrower'], effects: [] },
  ],
};

/** 表を1点だけ差し替える。 */
function withTable(patch: Partial<MachineTable>): MachineTable {
  return { ...validTable, ...patch };
}

/** 遷移を1本足した表を作る。 */
function withTransition(transition: TransitionDef): MachineTable {
  return withTable({ transitions: [...validTable.transitions, transition] });
}

describe('assertValidTable — 通るケース', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-SANITY-001
  it('整合の取れた表では問題を報告しない', () => {
    expect(assertValidTable(validTable)).toEqual([]);
  });
});

describe('assertValidTable — 状態集合', () => {
  it('machine が空なら報告する', () => {
    expect(assertValidTable(withTable({ machine: '' }))).toContain(
      'machine が空です。状態機械の名前を書いてください',
    );
  });

  it('states が空なら報告する', () => {
    const problems = assertValidTable({
      machine: 'empty',
      states: [],
      initial: 'draft',
      final: [],
      transitions: [],
    });
    expect(problems).toContain('states が空です。少なくとも1つの状態を定義してください');
  });

  it('states に重複があれば報告する', () => {
    const problems = assertValidTable(withTable({ states: ['draft', 'draft', 'submitted', 'withdrawn'] }));
    expect(problems).toContain('states に状態 draft が重複しています。1回だけ書いてください');
  });

  it('initial が states に無ければ報告する', () => {
    const problems = assertValidTable(withTable({ initial: 'nonexistent' }));
    expect(problems.some((problem) => problem.includes('initial の nonexistent'))).toBe(true);
  });

  it('final が states に無ければ報告する', () => {
    const problems = assertValidTable(withTable({ final: ['nonexistent'] }));
    expect(problems.some((problem) => problem.includes('final の nonexistent'))).toBe(true);
  });
});

describe('assertValidTable — 遷移1本の形', () => {
  it('to が states に無ければ報告する', () => {
    const problems = assertValidTable(
      withTransition({ event: 'reject', from: ['submitted'], to: 'rejected', by: ['librarian'], effects: [] }),
    );
    expect(problems.some((problem) => problem.includes('to の rejected が states にありません'))).toBe(true);
  });

  it('from が states に無ければ報告する', () => {
    const problems = assertValidTable(
      withTransition({ event: 'reject', from: ['pending'], to: 'withdrawn', by: ['librarian'], effects: [] }),
    );
    expect(problems.some((problem) => problem.includes('from の pending が states にありません'))).toBe(
      true,
    );
  });

  it('from が空なら報告する', () => {
    const problems = assertValidTable(
      withTransition({ event: 'reject', from: [], to: 'withdrawn', by: ['librarian'], effects: [] }),
    );
    expect(problems.some((problem) => problem.includes('from が空です'))).toBe(true);
  });

  it('by が空なら報告する（誰も起こせない遷移は書けない）', () => {
    const problems = assertValidTable(
      withTransition({ event: 'reject', from: ['submitted'], to: 'withdrawn', by: [], effects: [] }),
    );
    expect(problems.some((problem) => problem.includes('by が空です'))).toBe(true);
  });

  it('event が空なら報告する', () => {
    const problems = assertValidTable(
      withTransition({ event: '', from: ['submitted'], to: 'withdrawn', by: ['librarian'], effects: [] }),
    );
    expect(problems).toContain('event が空の遷移があります。ドメインイベントIDを書いてください');
  });

  it('final 状態から出る遷移があれば報告する', () => {
    const problems = assertValidTable(
      withTransition({ event: 'reopen', from: ['withdrawn'], to: 'draft', by: ['librarian'], effects: [] }),
    );
    expect(
      problems.some((problem) => problem.includes('final 状態 withdrawn が from にあります')),
    ).toBe(true);
  });
});

describe('assertValidTable — 決定性', () => {
  it('同一イベントが同じ状態に複数定義されていれば報告する', () => {
    const problems = assertValidTable(
      withTransition({ event: 'submit', from: ['draft'], to: 'withdrawn', by: ['librarian'], effects: [] }),
    );
    expect(problems).toContain(
      'イベント submit が状態 draft に対して複数定義されています。from を排他にするか、イベントを分けてください',
    );
  });

  it('同一イベントでも from が排他なら報告しない', () => {
    const problems = assertValidTable(
      withTransition({ event: 'submit', from: ['submitted'], to: 'withdrawn', by: ['librarian'], effects: [] }),
    );
    expect(problems).toEqual([]);
  });

  it('重複は同じ組み合わせにつき1回だけ報告する', () => {
    const duplicated: TransitionDef = {
      event: 'submit',
      from: ['draft'],
      to: 'withdrawn',
      by: ['librarian'],
      effects: [],
    };
    const problems = assertValidTable(
      withTable({ transitions: [...validTable.transitions, duplicated, duplicated] }),
    );
    expect(problems).toHaveLength(1);
  });
});

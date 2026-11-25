/**
 * 宣言された例外(`lib/mutation/exemptions.ts`)の単体テスト。
 *
 * ここで固定したいのは **`composite` の `enforces` が根拠になる条件と、ならない条件**である
 * (ADR-0014 の「変異テストの受け皿としての `enforces`」)。例外は宣言を読むだけで、
 * 変異を黙らせるために書き足せる台帳ではない —— 規則を名指さない宣言・見張りテストの無い宣言は例外にならない。
 */

import { describe, expect, it } from 'vitest';
import type { DataFunctionDecl, DataFunctionEnforces } from '../../../lib/model/data/types.js';
import { exemptionOf } from '../../../lib/mutation/exemptions.js';
import { exemptionText } from '../../../lib/kernel/mutation-report.js';
import type { MutationSite, MutationSubject } from '../../../lib/mutation/types.js';
import { dataTable, dataTableModel, dataTestCase } from '../../helpers/data-builder.js';

/** 関数 1 本の宣言(例外の判定が見るのは kind / shape / enforces だけ)。 */
function fn(init: Partial<DataFunctionDecl> & { name: string }): DataFunctionDecl {
  return { args: [], params: [], kind: 'rpc', alsoWrites: [], ...init };
}

/** `enforces` の 1 要素。 */
function enforcing(by: string, testCase: string, writes = 'doc'): DataFunctionEnforces {
  return { writes, by, testCase };
}

/** 表 1 つ(見張りテスト TC-1 / TC-2 を持つ)を持つ題材。例外の判定が見るのは `dataTables` だけ。 */
function subjectOf(functions: readonly DataFunctionDecl[]): MutationSubject {
  const table = dataTable('docs', {
    entity: 'doc',
    functions,
    testCases: [dataTestCase('TC-1', 'docs'), dataTestCase('TC-2', 'docs')],
  });
  return { dataTables: dataTableModel([table]), actions: undefined } as unknown as MutationSubject;
}

/** `doc` の編集規則(`by` つき)を壊したときの所在。 */
function updateSite(by?: string): MutationSite {
  return { entity: 'doc', shape: 'update', ...(by === undefined ? {} : { by }) };
}

describe('exemptionOf(composite の enforces)', () => {
  it('enforces が無ければ例外にならない(composite を宣言しただけでは穴のまま)', () => {
    const subject = subjectOf([fn({ name: 'reorder_docs', shape: 'composite' })]);

    expect(exemptionOf(updateSite('organizer'), subject)).toBeUndefined();
  });

  it('壊した規則(writes + by)を名指す enforces があれば、その見張りテストが canaries に入る', () => {
    const subject = subjectOf([
      fn({
        name: 'reorder_docs',
        shape: 'composite',
        enforces: [enforcing('organizer', 'TC-1'), enforcing('staff', 'TC-2')],
      }),
    ]);

    const organizer = exemptionOf(updateSite('organizer'), subject);
    const staff = exemptionOf(updateSite('staff'), subject);

    expect(organizer).toMatchObject({ kind: 'enforces', canaries: ['TC-1'] });
    expect(staff).toMatchObject({ kind: 'enforces', canaries: ['TC-2'] });
    expect(exemptionText(organizer ?? { kind: 'enforces', label: '', canaries: [] })).toContain('reorder_docs');
    expect(exemptionText(organizer ?? { kind: 'enforces', label: '', canaries: [] })).toContain('TC-1');
  });

  it('名指していない by の規則を壊しても例外にならない', () => {
    const subject = subjectOf([
      fn({ name: 'reorder_docs', shape: 'composite', enforces: [enforcing('organizer', 'TC-1')] }),
    ]);

    expect(exemptionOf(updateSite('staff'), subject)).toBeUndefined();
  });

  it('by を持たない所在は、そのエンティティを名指す宣言のどれでも例外にする', () => {
    const subject = subjectOf([
      fn({
        name: 'reorder_docs',
        shape: 'composite',
        enforces: [enforcing('organizer', 'TC-1'), enforcing('staff', 'TC-2')],
      }),
    ]);

    expect(exemptionOf(updateSite(), subject)).toMatchObject({ kind: 'enforces', canaries: ['TC-1', 'TC-2'] });
  });

  it('別のエンティティの規則を名指す enforces は根拠にならない', () => {
    const subject = subjectOf([
      fn({ name: 'reorder_docs', shape: 'composite', enforces: [enforcing('organizer', 'TC-1', 'other')] }),
    ]);

    expect(exemptionOf(updateSite('organizer'), subject)).toBeUndefined();
  });

  it('表の test_cases に無い見張りテストは数えない(実在しなければ例外にならない)', () => {
    const subject = subjectOf([
      fn({ name: 'reorder_docs', shape: 'composite', enforces: [enforcing('organizer', 'TC-MISSING')] }),
    ]);

    expect(exemptionOf(updateSite('organizer'), subject)).toBeUndefined();
  });

  it('編集以外の形(create / delete / transition)の変異は根拠にしない', () => {
    const subject = subjectOf([
      fn({ name: 'reorder_docs', shape: 'composite', enforces: [enforcing('organizer', 'TC-1')] }),
    ]);

    expect(exemptionOf({ entity: 'doc', shape: 'create', by: 'organizer' }, subject)).toBeUndefined();
    expect(exemptionOf({ entity: 'doc', shape: 'delete', by: 'organizer' }, subject)).toBeUndefined();
  });

  it('composite でない関数や rpc でない関数の enforces は読まない', () => {
    const subject = subjectOf([
      fn({ name: 'update_doc', shape: 'update', enforces: [enforcing('organizer', 'TC-1')] }),
      fn({ name: 'trg', kind: 'trigger', shape: 'composite', enforces: [enforcing('organizer', 'TC-1')] }),
    ]);

    expect(exemptionOf(updateSite('organizer'), subject)).toBeUndefined();
  });
});

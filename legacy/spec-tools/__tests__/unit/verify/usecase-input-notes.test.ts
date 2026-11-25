/**
 * ユースケース群(Y8・Y10・Y12)が読むテーブル仕様が使えなかったことの報告(部品化 ②-j)。
 *
 * 判定の母集合は保存点(usecase_spec)で、テーブル仕様は裏づけを見る先なので、**未選択も阻害も**行を出す(未選択を
 * 「事実として無い」と読まない)。ただし保存点が 1 件も無ければ見ていないものが無いので出さない。出すときは対象の保存点を名指す。
 * 実ローダー・実パイプラインでの 3 反例は `optional-readers-pipeline.test.ts` が見る。
 */

import { describe, expect, it } from 'vitest';
import type { DataTableSpecModel } from '../../../lib/model/data/types.js';
import type { CatalogInput } from '../../../lib/kernel/input-state.js';
import type { UsecaseSpecModel } from '../../../lib/model/usecase/types.js';
import { logUsecaseInputGaps, USECASE_DATA_TABLE_DEPENDENTS, usecaseInputGapNotes } from '../../../lib/verify/usecase-input-notes.js';
import { runUsecases } from '../../../lib/verify/usecase-group.js';
import { isSkipNote } from '../../../lib/verify/skip-notes.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../helpers/usecase-builder.js';
import { stubGuards } from '../../helpers/model-builder.js';
import { blockedInput, loadedInput, UNSELECTED } from '../../helpers/verify-inputs.js';
import { rpcActions, rpcDomain } from '../../helpers/usecase-rpc-fixture.js';
import { testGates, testScreens } from '../usecase/_fixtures.js';

const LOADED_TABLES: CatalogInput<DataTableSpecModel> = loadedInput({ available: true, tables: [] });
const UNSELECTED_TABLES: CatalogInput<DataTableSpecModel> = UNSELECTED;
const MISSING_TABLES: CatalogInput<DataTableSpecModel> = blockedInput('missing');

const ONE_SAVE: UsecaseSpecModel = {
  available: true,
  usecases: [usecaseSpec({ name: 'demo', saves: [usecaseSave('register', [usecaseStep('container.create')], { name: 'demo' })] })],
};
const NO_SAVES: UsecaseSpecModel = { available: true, usecases: [] };

const lines = (usecases: UsecaseSpecModel, dataTables: CatalogInput<DataTableSpecModel>): string[] => {
  const out: string[] = [];
  logUsecaseInputGaps(usecases, dataTables, (line: string) => out.push(line));
  return out;
};

describe('usecaseInputGapNotes', () => {
  it('読込済み(0 件も)なら記録は空', () => {
    expect(usecaseInputGapNotes(ONE_SAVE, LOADED_TABLES)).toEqual([]);
  });

  it('保存点が 1 件も無ければ、使えない入力でも記録は空(見ていないものが無い)', () => {
    expect(usecaseInputGapNotes(NO_SAVES, UNSELECTED_TABLES)).toEqual([]);
    expect(usecaseInputGapNotes(NO_SAVES, blockedInput('invalid'))).toEqual([]);
  });

  it('未選択も阻害も、Y8 → Y10 → Y12 の順に 1 本ずつ、保存点の鍵({ユースケース名}.{保存点 ID})を並べて返す', () => {
    for (const [state, gap] of [
      [UNSELECTED_TABLES, { input: 'data_tables', state: 'unselected' }],
      [MISSING_TABLES, { input: 'data_tables', state: 'blocked', reason: 'missing' }],
    ] as const) {
      const notes = usecaseInputGapNotes(ONE_SAVE, state);

      expect(notes.map((entry) => entry.id)).toEqual(['Y8', 'Y10', 'Y12']);
      for (const entry of notes) {
        expect(entry.note.gap).toEqual(gap);
        expect(entry.note.subjects).toEqual(['demo.register']);
      }
    }
    expect(USECASE_DATA_TABLE_DEPENDENTS.map((dependent) => dependent.id)).toEqual(['Y8', 'Y10', 'Y12']);
  });

  it('保存点は全ユースケースの全数(宣言順)で数える', () => {
    const usecases: UsecaseSpecModel = {
      available: true,
      usecases: [
        usecaseSpec({ name: 'a', saves: [usecaseSave('one', [usecaseStep('x.y')], { name: 'a' }), usecaseSave('two', [usecaseStep('x.y')], { name: 'a' })] }),
        usecaseSpec({ name: 'b', saves: [usecaseSave('three', [usecaseStep('x.y')], { name: 'b' })] }),
      ],
    };

    expect(usecaseInputGapNotes(usecases, UNSELECTED)[0]?.note.subjects).toEqual(['a.one', 'a.two', 'b.three']);
  });
});

describe('logUsecaseInputGaps(行の書き方は describeInputGapNote の 1 本)', () => {
  it('読込済みなら何も言わない', () => {
    expect(lines(ONE_SAVE, LOADED_TABLES)).toEqual([]);
  });

  it('未選択: 未実施の行(対象つき)。範囲が縮んだ報告として数えられる', () => {
    const out = lines(ONE_SAVE, UNSELECTED);

    expect(out).toHaveLength(3);
    expect(out[0]).toBe(
      'Y8: 未実施 — 製品が data_tables を採っていない(product.md の uses に無い)ため、' +
        '保存点の手順が呼ぶ RPC の実在と、その全引数が規約で解決できるかは見ていません(対象 1 件: demo.register)。',
    );
    expect(out.every(isSkipNote)).toBe(true);
  });

  it('阻害: 阻害の行(理由つき)', () => {
    const out = lines(ONE_SAVE, blockedInput('invalid'));

    expect(out).toHaveLength(3);
    for (const line of out) expect(line).toContain(': 阻害 — data_tables を採っているが検査へ渡せない(読めなかった仕様があってモデルが欠けている、または欠けていないと言えない');
  });
});

describe('runUsecases(群の要約行の後に言う)', () => {
  const input = (usecases: UsecaseSpecModel) => ({
    domain: rpcDomain(),
    usecases,
    actions: rpcActions(),
    screens: testScreens(),
    gates: testGates(),
    catalogs: {},
  });

  it('ユースケース仕様が読めていれば、群の要約行の直後に Y8 / Y10 / Y12 の行が出る(判定は出さない)', () => {
    const out: string[] = [];

    const findings = runUsecases(input(ONE_SAVE), { guards: stubGuards(), dataTables: UNSELECTED, actions: UNSELECTED, reachabilityGaps: [] }, (line) => out.push(line));

    expect(out[0]).toContain('Y 群(ユースケース仕様): usecase_spec 1 件に対し');
    expect(out.slice(1).map((line) => line.slice(0, line.indexOf(':')))).toEqual(['Y8', 'Y10', 'Y12']);
    expect(findings.filter((finding) => ['Y8', 'Y10', 'Y12'].includes(finding.verifier))).toEqual([]);
  });

  it('ユースケース仕様が読めていなければ、群ごと飛んだ行だけ(テーブル仕様の行は言わない)', () => {
    const out: string[] = [];

    runUsecases(input({ available: false, usecases: [] }), { guards: stubGuards(), dataTables: UNSELECTED, actions: UNSELECTED, reachabilityGaps: [] }, (line) => out.push(line));

    expect(out).toEqual(['Y 群(ユースケース仕様): specs/frontend/usecases が無いためスキップしました。']);
  });
});

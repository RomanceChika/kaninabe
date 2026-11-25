/**
 * V 群(V16・V17・V18・V19)が読む他の種類の入力が使えなかったことの報告(部品化 ②-i)。
 *
 * 区別が要である。action_spec が**未選択**なら、入力に現れる欄も計算値も事実として無い(行を出さない)。**阻害**なら分からない
 * (依る判定を出さず行を出す)。data_table は**どちらも**裏づけを見られない(行を出す)。
 * 実ローダー・実パイプラインでの 3 反例は `input-gaps-pipeline.test.ts` が見る。
 */

import { describe, expect, it } from 'vitest';
import type { CatalogInput } from '../../../lib/kernel/input-state.js';
import type { ActionSpecModel } from '../../../lib/model/trace/types.js';
import type { DataTableSpecModel } from '../../../lib/model/data/types.js';
import { describeDomainInputNotes, DOMAIN_INPUT_DEPENDENTS, domainInputGapsOf, logDomainInputGaps } from '../../../lib/verify/domain-input-notes.js';
import { isSkipNote } from '../../../lib/verify/skip-notes.js';
import { blockedInput, loadedInput, UNSELECTED } from '../../helpers/verify-inputs.js';

const LOADED_ACTIONS: CatalogInput<ActionSpecModel> = loadedInput({ actions: [], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] });
const LOADED_TABLES: CatalogInput<DataTableSpecModel> = loadedInput({ available: true, tables: [] });
const ids = (rows: readonly string[]) => rows.map((row) => row.slice(0, row.indexOf(':')));

describe('domainInputGapsOf', () => {
  it('読込済みなら空(0 件も)', () => {
    expect(domainInputGapsOf({ actions: LOADED_ACTIONS, dataTables: LOADED_TABLES })).toEqual([]);
  });

  it('使えなかった入力を、名前と状態つきで並べる(action_spec → data_table の順)', () => {
    expect(domainInputGapsOf({ actions: blockedInput('missing'), dataTables: UNSELECTED })).toEqual([
      { input: 'actions', state: 'blocked', reason: 'missing' },
      { input: 'data_tables', state: 'unselected' },
    ]);
  });
});

describe('describeDomainInputNotes', () => {
  it('読込済みなら行は出ない', () => {
    expect(describeDomainInputNotes({ actions: LOADED_ACTIONS, dataTables: LOADED_TABLES })).toEqual([]);
  });

  it('action_spec が未選択: 事実として無いので行を出さない(母集合が空のまま判定している)', () => {
    expect(describeDomainInputNotes({ actions: UNSELECTED, dataTables: LOADED_TABLES })).toEqual([]);
  });

  it('action_spec が阻害: 依る V16 / V17 / V18 が阻害の行で出る(理由つき・範囲が縮んだ報告として数える)', () => {
    const rows = describeDomainInputNotes({ actions: blockedInput('load-failed'), dataTables: LOADED_TABLES });

    expect(ids(rows)).toEqual(['V16', 'V17', 'V18']);
    for (const row of rows) {
      expect(row).toContain(': 阻害 — actions を採っているが検査へ渡せない(読めない・壊れている');
      expect(isSkipNote(row)).toBe(true);
    }
  });

  it('data_table が未選択: 裏づけを見る先が無いので、依る V17 / V19 が未実施の行で出る', () => {
    const rows = describeDomainInputNotes({ actions: LOADED_ACTIONS, dataTables: UNSELECTED });

    expect(ids(rows)).toEqual(['V17', 'V19']);
    for (const row of rows) expect(row).toContain(': 未実施 — 製品が data_tables を採っていない(product.md の uses に無い)ため、');
  });

  it('data_table が阻害: 同じ V17 / V19 が阻害の行で出る', () => {
    const rows = describeDomainInputNotes({ actions: LOADED_ACTIONS, dataTables: blockedInput('invalid') });

    expect(ids(rows)).toEqual(['V17', 'V19']);
    for (const row of rows) expect(row).toContain(': 阻害 — data_tables を採っているが検査へ渡せない(読めなかった仕様があってモデルが欠けている、または欠けていないと言えない');
  });

  it('両方使えなければ、検査の順に並ぶ(V17 は入力ごとに 1 行)', () => {
    const rows = describeDomainInputNotes({ actions: blockedInput('missing'), dataTables: UNSELECTED });

    expect(ids(rows)).toEqual(['V16', 'V17', 'V17', 'V18', 'V19']);
  });
});

describe('logDomainInputGaps / 依存の表', () => {
  it('行を 1 行ずつ実行ログへ流す(使えるなら何も言わない)', () => {
    const lines: string[] = [];

    logDomainInputGaps({ actions: LOADED_ACTIONS, dataTables: LOADED_TABLES }, (line) => lines.push(line));
    expect(lines).toEqual([]);
    logDomainInputGaps({ actions: LOADED_ACTIONS, dataTables: UNSELECTED }, (line) => lines.push(line));
    expect(lines).toHaveLength(2);
  });

  it('依存の表: 未選択を事実とするのは action_spec だけ(data_table は見られないので行を出す)', () => {
    expect(DOMAIN_INPUT_DEPENDENTS.filter((entry) => entry.onUnselected === 'fact').map((entry) => entry.input)).toEqual(['actions', 'actions', 'actions']);
    expect(DOMAIN_INPUT_DEPENDENTS.filter((entry) => entry.input === 'data_tables').every((entry) => entry.onUnselected === 'report')).toBe(true);
  });
});

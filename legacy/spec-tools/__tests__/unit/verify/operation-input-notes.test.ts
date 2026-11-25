/**
 * 他の種類から引く材料(action_spec・テーブル仕様・通知・ジョブ・画面)が使えなかったことの報告(入力の状態-g)。
 *
 * 未選択は黙る(事実として無い)/ 阻害は検査ごとに名指す / 読込済みは黙る。検査を持つ群が動いていなければ、その群の行は出さない。
 */

import { describe, expect, it } from 'vitest';
import { availableLoad, catalogInput } from '../../../lib/kernel/input-state.js';
import type { DataTableSpecModel } from '../../../lib/model/data/types.js';
import { isCheckRunNote } from '../../../lib/verify/check-run-report.js';
import {
  logOperationInputGaps,
  OPERATION_INPUT_DEPENDENTS,
  operationInputGapNotes,
  type OperationGroupsRan,
  type OperationInputStates,
} from '../../../lib/verify/operation-input-notes.js';
import { blockedInput, loadedInput, UNSELECTED } from '../../helpers/verify-inputs.js';

const CLEAN_TABLES: DataTableSpecModel = { available: true, tables: [] };

/** 全部読込済みの材料(個別の欄を上書きして使う)。 */
function states(overrides: Partial<OperationInputStates> = {}): OperationInputStates {
  return {
    actions: loadedInput({}),
    dataTables: loadedInput(CLEAN_TABLES),
    notifications: loadedInput({}),
    jobs: loadedInput({}),
    screens: loadedInput({}),
    queries: loadedInput({}),
    usecases: loadedInput({}),
    config: loadedInput({}),
    ...overrides,
  };
}

const ALL_RAN: OperationGroupsRan = { screens: true, usecases: true, jobs: true, jobEntries: true, notifications: true, auth: true, generality: true };
const NONE_RAN: OperationGroupsRan = { screens: false, usecases: false, jobs: false, jobEntries: false, notifications: false, auth: false, generality: false };

/** 実行ログの行にする。 */
function linesOf(input: OperationInputStates, ran: OperationGroupsRan = ALL_RAN): string[] {
  const lines: string[] = [];
  logOperationInputGaps(input, ran, (line) => lines.push(line));
  return lines;
}

/** 行の頭の検査 ID。 */
const idsOf = (lines: readonly string[]): string[] => lines.map((line) => line.slice(0, line.indexOf(':')));

describe('材料が全部使える・採っていないときは何も言わない', () => {
  it('全部読込済み(0 件の空のカタログも)なら空', () => {
    expect(linesOf(states())).toEqual([]);
  });

  it('未選択は事実として無い。黙る(阻害だけを言う)', () => {
    const none = states({ actions: UNSELECTED, dataTables: UNSELECTED, notifications: UNSELECTED, jobs: UNSELECTED, screens: UNSELECTED, queries: UNSELECTED, usecases: UNSELECTED, config: UNSELECTED });

    expect(linesOf(none)).toEqual([]);
  });
});

describe('action_spec が阻害のとき', () => {
  it('画面・UX・ユースケース・ジョブ・認証フローの検査ごとに 1 行ずつ、範囲が縮んだ報告の形(阻害)で言う', () => {
    const lines = linesOf(states({ actions: blockedInput('invalid') }));

    expect(idsOf(lines)).toEqual(['H6', 'J2', 'S17', 'S18', 'S19', 'U1', 'Y2', 'Y5', 'Y8', 'Y10', 'Y12']);
    for (const line of lines) {
      expect(line).toContain('阻害 — actions を採っているが検査へ渡せない(');
      expect(isCheckRunNote(line)).toBe(true);
    }
  });

  it('検査を持つ群が動いていなければ、その群の行は出さない(群自体の「スキップしました」の行が言う)', () => {
    const blocked = states({ actions: blockedInput('missing') });

    expect(idsOf(linesOf(blocked, { ...NONE_RAN, screens: true }))).toEqual(['S17', 'S18', 'S19', 'U1']);
    expect(idsOf(linesOf(blocked, { ...NONE_RAN, usecases: true }))).toEqual(['Y2', 'Y5', 'Y8', 'Y10', 'Y12']);
    expect(idsOf(linesOf(blocked, { ...NONE_RAN, jobs: true }))).toEqual(['J2']);
    expect(idsOf(linesOf(blocked, { ...NONE_RAN, auth: true }))).toEqual(['H6']);
    expect(linesOf(blocked, NONE_RAN)).toEqual([]);
  });
});

describe('確認の要否の導出が読むカタログが阻害のとき', () => {
  it('テーブル仕様・通知・ジョブのどれが阻害でも、S19 / U1 / Y5 の行を材料の名前つきで言う(読めた分で回すので、見ていない分だけ)', () => {
    for (const [kind, name] of [['dataTables', 'data_tables'], ['notifications', 'notifications'], ['jobs', 'jobs']] as const) {
      // 確認の要否の導出の行だけを見る(ジョブは通知の検査 N1 / N2 の材料でもある — 下の describe)
      const lines = linesOf(states({ [kind]: blockedInput('load-failed') })).filter((line) => !/^[NW]\d/.test(line));

      expect(idsOf(lines)).toEqual(['S19', 'U1', 'Y5']);
      for (const line of lines) expect(line).toContain(`阻害 — ${name} を採っているが検査へ渡せない(`);
    }
  });

  it('テーブル仕様の落とした表は、表の名前を対象に挙げ、複合 RPC を「落とした表の」と限る', () => {
    const dropped: DataTableSpecModel = { available: true, tables: [], droppedTables: ['shelves.md', 'sub/stock_moves.md'] };
    const lines = linesOf(states({ dataTables: catalogInput('selected', availableLoad(dropped, [], 2)) }));

    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line).toContain('落とした表の複合 RPC(');
      expect(line).toContain('(対象 2 件: shelves・stock_moves)');
    }
  });

  it('落とした表の名前が無い阻害(置き場が無い等)は、複合 RPC を限らず、対象も挙げない', () => {
    const lines = linesOf(states({ dataTables: blockedInput('missing') }));

    for (const line of lines) {
      expect(line).not.toContain('落とした表の');
      expect(line).not.toContain('(対象 ');
    }
  });

  it('S 群・U 群が動いていないなら S19 / U1 は出さず、Y 群が動いていないなら Y5 は出さない', () => {
    const blocked = states({ notifications: blockedInput('invalid') });

    expect(idsOf(linesOf(blocked, { ...NONE_RAN, screens: true }))).toEqual(['S19', 'U1']);
    expect(idsOf(linesOf(blocked, { ...NONE_RAN, usecases: true }))).toEqual(['Y5']);
  });
});

describe('画面が阻害のとき(ジョブの入口の衝突・認証フローの着地と関門)', () => {
  it('J2・H2・H4 の行を言う(それぞれの群が動いているときだけ)', () => {
    const blocked = states({ screens: blockedInput('invalid') });

    expect(idsOf(linesOf(blocked))).toEqual(['H2', 'H4', 'J2']);
    for (const line of linesOf(blocked)) expect(line).toContain('阻害 — screens を採っているが検査へ渡せない(');
    expect(idsOf(linesOf(blocked, { ...NONE_RAN, screens: true, usecases: true }))).toEqual([]);
    expect(idsOf(linesOf(blocked, { ...NONE_RAN, auth: true }))).toEqual(['H2', 'H4']);
  });

  it('J2 の画面の行は、ジョブのカタログが無くても実装の木があれば(入口の衝突が回るので)言う。どちらも無ければ言わない', () => {
    const blocked = states({ screens: blockedInput('missing') });

    expect(idsOf(linesOf(blocked, { ...NONE_RAN, jobEntries: true }))).toEqual(['J2']);
    expect(idsOf(linesOf(blocked, { ...NONE_RAN, jobs: true }))).toEqual([]);
    expect(linesOf(blocked, NONE_RAN)).toEqual([]);
  });
});

describe('ジョブが阻害のとき(通知の検査 N1・N2 が走査の emits を読む)', () => {
  it('N1・N2 の行を言う(通知カタログが読めて N 群が動いているときだけ)。確認の要否の導出の行も同じ材料から言う', () => {
    const blocked = states({ jobs: blockedInput('invalid') });

    expect(idsOf(linesOf(blocked))).toEqual(['N1', 'N2', 'S19', 'U1', 'W1', 'W2', 'Y5']);
    expect(idsOf(linesOf(blocked, { ...NONE_RAN, notifications: true }))).toEqual(['N1', 'N2']);
    expect(idsOf(linesOf(blocked, { ...NONE_RAN, jobs: true, screens: true }))).toEqual(['S19', 'U1']);
  });
});

describe('通知・ジョブ・設定カタログが阻害のとき(語彙漏れ検査 W1・W2 が語彙を禁じる語に入れる)', () => {
  it('W1・W2 の行を材料の名前つきで言う(読めた分で回すので、見ていない漏れだけ。W 群は常に動く)', () => {
    for (const [kind, name] of [['notifications', 'notifications'], ['jobs', 'jobs'], ['config', 'config']] as const) {
      const lines = linesOf(states({ [kind]: blockedInput('invalid') }), { ...NONE_RAN, generality: true });

      expect(idsOf(lines)).toEqual(['W1', 'W2']);
      for (const line of lines) expect(line).toContain(`阻害 — ${name} を採っているが検査へ渡せない(`);
    }
  });

  it('未選択は黙る(事実として語彙は無い)', () => {
    expect(linesOf(states({ notifications: UNSELECTED, jobs: UNSELECTED, config: UNSELECTED }), { ...NONE_RAN, generality: true })).toEqual([]);
  });
});

describe('読み取りクエリが阻害のとき(画面の検査が reads の指す読みを引く)', () => {
  it('置き場ごと無い・読めない阻害(not-loaded / missing / load-failed)は、S12 を含む 7 本の行を言う(S 群が動いているときだけ)', () => {
    for (const reason of ['not-loaded', 'missing', 'load-failed'] as const) {
      const blocked = states({ queries: blockedInput(reason) });

      expect(idsOf(linesOf(blocked)), reason).toEqual(['S2', 'S4', 'S8', 'S12', 'S14', 'S18', 'S19']);
      for (const line of linesOf(blocked)) expect(line).toContain('阻害 — queries を採っているが検査へ渡せない(');
      expect(linesOf(blocked, { ...NONE_RAN, usecases: true, jobs: true }), reason).toEqual([]);
    }
  });

  it('読めずに仕様を落としただけの阻害(invalid)は、S12 の行を出さない(S12 は欠けた読みを否定できない側に倒して実行済み)', () => {
    const blocked = states({ queries: blockedInput('invalid') });

    expect(idsOf(linesOf(blocked))).toEqual(['S2', 'S4', 'S8', 'S14', 'S18', 'S19']);
  });

  it('未選択は黙る(事実として読み取りクエリは無い)', () => {
    expect(linesOf(states({ queries: UNSELECTED }))).toEqual([]);
  });
});

describe('ユースケースが阻害のとき(S16 が保存点を引く)', () => {
  it('S16 の行だけを言う(S 群が動いているときだけ)', () => {
    const blocked = states({ usecases: blockedInput('missing') });

    expect(idsOf(linesOf(blocked))).toEqual(['S16']);
    expect(linesOf(blocked, { ...NONE_RAN, usecases: true })).toEqual([]);
  });
});

describe('表の整合', () => {
  it('依る検査の ID は重複せず、どの検査も材料を 1 つ以上引く', () => {
    const ids = OPERATION_INPUT_DEPENDENTS.map((dependent) => dependent.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const dependent of OPERATION_INPUT_DEPENDENTS) expect(dependent.needs.length).toBeGreaterThan(0);
  });

  it('operationInputGapNotes は材料が使えなければ空・阻害の材料ごとに検査の行を返す(件数 = 阻害の材料に依る検査の数)', () => {
    expect(operationInputGapNotes(states(), ALL_RAN)).toEqual([]);
    const both = operationInputGapNotes(states({ actions: blockedInput(), jobs: blockedInput() }), ALL_RAN);

    expect(both.map((entry) => `${entry.id}/${entry.note.gap.input}`)).toEqual([
      'H6/actions',
      'J2/actions',
      'N1/jobs',
      'N2/jobs',
      'S17/actions',
      'S18/actions',
      'S19/actions',
      'S19/jobs',
      'U1/actions',
      'U1/jobs',
      'W1/jobs',
      'W2/jobs',
      'Y2/actions',
      'Y5/actions',
      'Y5/jobs',
      'Y8/actions',
      'Y10/actions',
      'Y12/actions',
    ]);
  });
});

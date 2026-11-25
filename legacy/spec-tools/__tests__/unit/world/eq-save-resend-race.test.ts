/**
 * 保存点の作成の**1 回目がコミットする前に届いた同じ鍵の押し直し**の性質(点検 22 回目 A22-1)と、**錨の行を消す txn と重なった押し直し**
 * の性質(点検 23 回目 A23-1)の判定のテスト。
 *
 * 交錯そのもの(1 本目の txn を開いたまま 2 本目を送り、2 本目が待つのを確かめてからコミットする)は実 DB の生成テスト
 * (`expectSaveResendRace`。製品と題材の複合の作成の全部)が回す。ここは結末の読み方(`raceProblems`。純関数)を表で固定する。
 */

import { describe, expect, it } from 'vitest';
import { deleteRaceProblems, raceProblems, type DeleteRaced, type Raced } from '../../../../../framework/runtime/testing/save/resend-race.mjs';

const FIRST = { 'a.create': { id: 'A' }, lines: [{ id: 'L1' }] };
const MISMATCH = { code: 'UC412', message: 'usecase_guard:a.create', details: 'resend_input_mismatch' };

/** 交錯の結末を組む。 */
function raced(second: Raced['second'], options: { readonly waited?: boolean; readonly first?: Raced['first'] } = {}): Raced {
  return { first: options.first ?? { ok: true, data: FIRST }, second, waited: options.waited ?? true };
}

describe('raceProblems', () => {
  it.each([
    ['同じ入力: 2 本目が 1 本目と同じ行を返す', raced({ data: FIRST, error: null }), true, []],
    ['同じ入力: 子の手順の行をもう 1 組作った(A22-1 の反例)', raced({ data: { 'a.create': { id: 'A' }, lines: [{ id: 'L2' }] }, error: null }), true, ['同じ入力の 2 本目が 1 本目と違う行を返した']],
    ['同じ入力: 2 本目が断られた(最後の遷移で落ちる形)', raced({ data: null, error: { code: 'UC409', message: 'usecase_conflict:b.create' } }), true, ['同じ入力の 2 本目が断られた']],
    ['変えた入力: resend_input_mismatch で断る', raced({ data: null, error: MISMATCH }), false, []],
    ['変えた入力: 成功として返った', raced({ data: FIRST, error: null }), false, ['入力を変えた 2 本目が成功として返った']],
    ['変えた入力: 別の拒否', raced({ data: null, error: { code: 'UC409', message: 'x', details: null } }), false, ['UC412 resend_input_mismatch でない']],
    ['2 本目が待たなかった(交錯を作れていない)', raced({ data: FIRST, error: null }, { waited: false }), true, ['2 本目が 1 本目のコミットを待たなかった']],
    ['1 本目が書けていない', raced({ data: null, error: null }, { first: { ok: false, error: 'boom' } }), true, ['1 本目が書けていない(boom)']],
  ] as const)('%s', (_title, outcome, same, expected) => {
    const problems = raceProblems('点', outcome, same);
    expect(problems).toHaveLength(expected.length);
    expected.forEach((fragment, index) => expect(problems[index]).toContain(fragment));
  });
});

const DELETED = { code: 'UC412', message: 'usecase_guard:a.create', details: 'resend_target_deleted' };

/** 錨の行を消す txn との交錯の結末を組む。 */
function deleted(second: DeleteRaced['second'], options: { readonly waited?: boolean; readonly removed?: number } = {}): DeleteRaced {
  return { removed: options.removed ?? 1, second, waited: options.waited ?? true };
}

describe('deleteRaceProblems', () => {
  it.each([
    ['resend_target_deleted で断る', deleted({ data: null, error: DELETED }), []],
    ['成功として返った(A23-1 の反例: 錨を作り直し、子の手順を実行しない)', deleted({ data: FIRST, error: null }), ['錨が消えた後の押し直しが成功として返った']],
    ['別の拒否(入力の違いの語)', deleted({ data: null, error: MISMATCH }), ['UC412 resend_target_deleted でない']],
    ['別の拒否(競合)', deleted({ data: null, error: { code: 'UC409', message: 'x', details: null } }), ['UC412 resend_target_deleted でない']],
    ['2 本目が待たなかった', deleted({ data: null, error: DELETED }, { waited: false }), ['2 本目が消す側のコミットを待たなかった']],
    ['消す側が錨の行を消せていない', deleted({ data: FIRST, error: null }, { removed: 0 }), ['消す側が錨の行を消せていない(0 行)']],
  ] as const)('%s', (_title, outcome, expected) => {
    const problems = deleteRaceProblems('点', outcome);
    expect(problems).toHaveLength(expected.length);
    expected.forEach((fragment, index) => expect(problems[index]).toContain(fragment));
  });
});

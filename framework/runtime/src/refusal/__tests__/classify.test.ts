/**
 * DB が返した失敗の分類(`classifyDbFailure` ほか)のテスト。
 *
 * 確かめるのは 3 つ —— ①拒否の SQLSTATE が本文の接頭辞から**落ちた操作の ID** を引いて業務の拒否になること
 * ②拒否の SQLSTATE でなければ、本文が制約名に引けるときだけ不変条件違反になること(順序は①が先)
 * ③どちらでもないものは分類しないこと(通信の失敗と想定外の失敗を決めるのは adapter)。
 * 入力は接続の方式を持たない最小の形({@link DbFailure})だけである。
 */

import { describe, expect, it } from 'vitest';
import { classifyDbFailure, commitOfDbError, refusalKindOfSqlstate, sqlstateOrNull } from '../classify';
import type { DbFailure } from '../classify';
import { REFUSALS, refusalCodeOfReason } from '../refusal-codes';

/** 制約名を引けない解決器(製品の宣言が無い状態)。 */
const NO_INVARIANT = (): undefined => undefined;

/** 本文に `CONSTRAINT_X` があれば不変条件 ID を返す解決器。 */
const BY_CONSTRAINT = (haystack: string): string | undefined => (haystack.includes('CONSTRAINT_X') ? 'INV-X-001' : undefined);

/** 失敗を組む(省いた欄は `null`)。 */
function failure(sqlstate: string, message: string, extra: Partial<Pick<DbFailure, 'detail' | 'hint'>> = {}): DbFailure {
  return { sqlstate, message, detail: extra.detail ?? null, hint: extra.hint ?? null };
}

describe('classifyDbFailure(DB が返した失敗の分類)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-RUNPLAN-007
  it('拒否の SQLSTATE は分類の語に写り、本文の接頭辞の後ろから落ちた操作の ID を取る(message / details / hint のどこでもよい)', () => {
    const places: readonly ((prefix: string) => DbFailure)[] = [
      (prefix) => failure('', `${prefix}widget.send extra`),
      (prefix) => failure('', 'x', { detail: `${prefix}widget.send` }),
      (prefix) => failure('', 'x', { hint: `${prefix}widget.send` }),
    ];
    const actual = REFUSALS.flatMap((refusal) =>
      places.map((place) => classifyDbFailure({ ...place(refusal.prefix), sqlstate: refusal.code }, NO_INVARIANT)),
    );
    const expected = REFUSALS.flatMap((refusal) => places.map(() => ({ kind: refusal.kind, op: 'widget.send' })));
    // 母集合が空でない(3 分類 × 3 つの置き場)ことも同時に固定する。
    expect(expected).toHaveLength(REFUSALS.length * places.length);
    expect(REFUSALS.length).toBeGreaterThan(0);
    expect(actual).toEqual(expected);
  });

  it('接頭辞が読めない拒否は、分類は保ち、操作の ID を空にする', () => {
    expect(classifyDbFailure(failure('UC403', 'forbidden'), NO_INVARIANT)).toEqual({ kind: 'forbidden', op: '' });
    expect(classifyDbFailure(failure('UC412', 'usecase_guard:'), NO_INVARIANT)).toEqual({ kind: 'guard_unsatisfied', op: '' });
  });

  it('ガードの拒否は detail の拒否の語を運び、語の形でない detail と、ガード以外の拒否の detail は運ばない(点検 19 回目 A19-4 の付記)', () => {
    expect(classifyDbFailure(failure('UC412', 'usecase_guard:participant_link.link', { detail: 'link_target_erased' }), NO_INVARIANT)).toEqual({
      kind: 'guard_unsatisfied',
      op: 'participant_link.link',
      word: 'link_target_erased',
    });
    for (const detail of ['two words', 'Link_Target', 'usecase_guard:widget.send', '', '1st_word']) {
      expect(classifyDbFailure(failure('UC412', 'usecase_guard:widget.send', { detail }), NO_INVARIANT), detail).not.toHaveProperty('word');
    }
    expect(classifyDbFailure(failure('UC409', 'usecase_conflict:widget.send', { detail: 'some_word' }), NO_INVARIANT)).toEqual({ kind: 'conflict', op: 'widget.send' });
    // 競合が運ぶ語は同じ鍵の押し直しの語だけ(再送で既存の行を返さない表。)。
    expect(classifyDbFailure(failure('UC409', 'usecase_conflict:widget.create', { detail: 'resend_already_saved' }), NO_INVARIANT)).toEqual({
      kind: 'conflict',
      op: 'widget.create',
      word: 'resend_already_saved',
    });
    expect(classifyDbFailure(failure('UC403', 'usecase_forbidden:widget.send', { detail: 'some_word' }), NO_INVARIANT)).toEqual({ kind: 'forbidden', op: 'widget.send' });
  });

  it('相手の端の detail(`{トリガ名}: {不変条件 ID}: {件数}`)だけを、断った端と件数として運ぶ(DB の自由な文言は運ばない)', () => {
    expect(classifyDbFailure(failure('23514', 'CONSTRAINT_X を変えられません', { detail: 'constraint_x: INV-X-001: 3' }), BY_CONSTRAINT)).toEqual({
      kind: 'invariant_violated',
      invariant: 'INV-X-001',
      edge: { trigger: 'constraint_x', count: 3 },
    });
    // 形が違う・不変条件 ID が引いたものと違う detail は運ばない。
    for (const detail of ['constraint_x: INV-X-001: 3 件', 'constraint_x: INV-Y-001: 3', 'Key (id)=(1) already exists. CONSTRAINT_X']) {
      expect(classifyDbFailure(failure('23514', 'CONSTRAINT_X', { detail }), BY_CONSTRAINT)).toEqual({ kind: 'invariant_violated', invariant: 'INV-X-001' });
    }
  });

  it('拒否でなくても、本文が制約名に引ければ不変条件違反になる', () => {
    expect(classifyDbFailure(failure('23505', 'duplicate key CONSTRAINT_X'), BY_CONSTRAINT)).toEqual({
      kind: 'invariant_violated',
      invariant: 'INV-X-001',
    });
    expect(classifyDbFailure(failure('', 'x', { detail: 'CONSTRAINT_X' }), BY_CONSTRAINT)).toEqual({
      kind: 'invariant_violated',
      invariant: 'INV-X-001',
    });
  });

  it('拒否の SQLSTATE は不変条件より先に決まる(本文に制約名があっても拒否のまま)', () => {
    expect(classifyDbFailure(failure('UC409', 'usecase_conflict:widget.send CONSTRAINT_X'), BY_CONSTRAINT)).toEqual({
      kind: 'conflict',
      op: 'widget.send',
    });
  });

  it('どちらでもない失敗は分類しない(通信の失敗と想定外の失敗は adapter が決める)', () => {
    expect(classifyDbFailure(failure('42501', 'permission denied'), BY_CONSTRAINT)).toBeUndefined();
    expect(classifyDbFailure(failure('', 'fetch failed'), BY_CONSTRAINT)).toBeUndefined();
  });
});

describe('refusalKindOfSqlstate / sqlstateOrNull', () => {
  it('拒否の SQLSTATE だけが分類の語を返す', () => {
    expect(refusalKindOfSqlstate('UC403')).toBe('forbidden');
    expect(refusalKindOfSqlstate('UC412')).toBe('guard_unsatisfied');
    expect(refusalKindOfSqlstate('UC409')).toBe('conflict');
    expect(refusalKindOfSqlstate('23505')).toBeUndefined();
    expect(refusalKindOfSqlstate('')).toBeUndefined();
  });

  it('SQLSTATE の形(5 桁の英数大文字)だけをそのまま返し、それ以外は null にする', () => {
    expect(sqlstateOrNull('23505')).toBe('23505');
    expect(sqlstateOrNull('UC409')).toBe('UC409');
    expect(sqlstateOrNull('PGRST301')).toBeNull();
    expect(sqlstateOrNull('2350')).toBeNull();
    expect(sqlstateOrNull('uc409')).toBeNull();
    expect(sqlstateOrNull('')).toBeNull();
  });
});

describe('refusalCodeOfReason(エンジンの拒否理由 → errcode)', () => {
  it('表にある理由は対応する errcode を返し、無い理由は undefined(それ自体が反例)', () => {
    expect(refusalCodeOfReason('role_forbidden')).toBe('UC403');
    expect(refusalCodeOfReason('guard_unknown')).toBe('UC412');
    expect(refusalCodeOfReason('invalid_from')).toBe('UC409');
    expect(refusalCodeOfReason('no_such_reason')).toBeUndefined();
  });
});

describe('commitOfDbError(DB が答えた想定外の失敗のコミットの状態。点検 25 回目 O25-1)', () => {
  // 閉じた表: 文の失敗で txn ごと戻る類(22 / 23 / 42 の class と P0001)だけが not_committed。接続・資源・取り消し・内部の失敗
  // (08 / 53 / 57 / 58 / XX)・完了したか分からない 40003・plpgsql の P0001 以外・SQLSTATE の形でないコードは unknown(安全側)。
  it.each([
    ['23514', 'not_committed'],
    ['23505', 'not_committed'],
    ['23P01', 'not_committed'],
    ['22003', 'not_committed'],
    ['22P02', 'not_committed'],
    ['42501', 'not_committed'],
    ['42883', 'not_committed'],
    ['P0001', 'not_committed'],
    // 業務の拒否(raise exception = txn ごと戻る。点検 27 回目 B27-1)。
    ['UC403', 'not_committed'],
    ['UC409', 'not_committed'],
    ['UC412', 'not_committed'],
    ['P0002', 'unknown'],
    ['40001', 'unknown'],
    ['40003', 'unknown'],
    ['57014', 'unknown'],
    ['57P01', 'unknown'],
    ['08006', 'unknown'],
    ['53300', 'unknown'],
    ['58030', 'unknown'],
    ['XX000', 'unknown'],
    ['PGRST202', 'unknown'],
    ['2351', 'unknown'],
    ['', 'unknown'],
  ] as const)('%s → %s', (sqlstate, commit) => {
    expect(commitOfDbError(sqlstate)).toBe(commit);
  });
});

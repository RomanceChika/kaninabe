/**
 * 実装の範囲による仕分け(`partitionByScope`)。`runAllVerifications` の最後に 1 回だけ行い、ビルドの関所(build-gate)も同じ関数を呼ぶ。
 *
 * 守るのは 5 つ(どれも「範囲が本物の誤りを消さない」向きの性質)。
 *   ① 宣言が無ければ入力と同じものが返り、報告も無い(既存の製品は何も変わらない)
 *   ② 範囲の外の持ち主に印(`absentFor`)が付いた **error だけ**が報告へ移る。印の無い指摘は、種類を問わず絶対に移らない
 *   ③ 範囲の中の持ち主の error は残る
 *   ④ 印が **warning** に付いていたら throw する(印は「不在の error」専用。付け間違いを黙って通さない)
 *   ⑤ 印の持ち主が持ち主の一覧(`scopeOwners` の結果)に無ければ、範囲の外とは扱わず残す(一覧と印が食い違った形を、免除に倒さない)
 *
 * 計画: step 3b の section 0 / 2 / 6。
 */

import { describe, expect, it } from 'vitest';
import { makeFinding, type Finding } from '../../../lib/kernel/finding.js';
import { absentFor, type ScopeOwner } from '../../../lib/kernel/scope-owner.js';
import type { ProductImplemented } from '../../../lib/model/product/implemented.js';
import { partitionByScope } from '../../../lib/scope/partition.js';

const ROOM_CREATE: ScopeOwner = { kind: 'action', id: 'room-create-action' };
const ROOM_DELETE: ScopeOwner = { kind: 'action', id: 'room-delete-action' };
const BOOKING_CREATE: ScopeOwner = { kind: 'action', id: 'booking-create-action' };
const BOOKING_LIST: ScopeOwner = { kind: 'screen', id: 'screen-booking-list' };

/** 持ち主の全体(`scopeOwners` の結果の代わり)。 */
const UNIVERSE: readonly ScopeOwner[] = [ROOM_CREATE, ROOM_DELETE, BOOKING_CREATE, BOOKING_LIST];

const NOT_DECLARED: ProductImplemented = { declared: false };
const NOTHING: ProductImplemented = { declared: true, ids: [] };

/** 印つきの error(「テストが無い」)。 */
function tagged(owner: ScopeOwner, tcId: string): Finding {
  return absentFor(
    owner,
    makeFinding('A6', {
      message: `${tcId} の implementation が指すテストファイルがありません`,
      location: { file: 'docs/specs/backend/actions/x.md' },
      suggestion: 'テストを書く',
    }),
  );
}

/** 印の無い error(仕様の中の指摘・食い違いなど。範囲では絶対に消えない)。 */
function untagged(verifier: string, message: string): Finding {
  return makeFinding(verifier, { message, location: { file: 'docs/specs/backend/actions/x.md' }, suggestion: '直す' });
}

describe('宣言が無い: 何も変わらない', () => {
  it('入力と同じ内容が返り、報告は無い(印つきの error も残る)', () => {
    const findings = [tagged(ROOM_CREATE, 'TC-1'), untagged('V3', '食い違い'), tagged(BOOKING_CREATE, 'TC-2')];

    const result = partitionByScope(findings, NOT_DECLARED, UNIVERSE);

    expect(result.kept).toEqual(findings);
    expect(result.relieved).toEqual([]);
    expect(result.report).toBeNull();
  });
});

describe('implemented: [] — 何も範囲に入れない', () => {
  it('印つきの error は報告へ移り、印の無い指摘は全部残る', () => {
    const kept1 = untagged('V3', '食い違い');
    const kept2 = untagged('A6', 'どの仕様にも無い @tc');
    const kept3 = untagged('J2', '枠の設定が無い');
    const moved1 = tagged(ROOM_CREATE, 'TC-1');
    const moved2 = tagged(ROOM_CREATE, 'TC-2');
    const moved3 = tagged(BOOKING_LIST, 'TC-3');

    const result = partitionByScope([kept1, moved1, kept2, moved2, moved3, kept3], NOTHING, UNIVERSE);

    expect(result.kept).toEqual([kept1, kept2, kept3]);
    expect(result.relieved).toEqual([moved1, moved2, moved3]);
  });

  it('報告は、範囲の外の仕様の数を種類ごとに数え(指摘が無い仕様も含める)、外した指摘の件数を持つ', () => {
    const result = partitionByScope([tagged(ROOM_CREATE, 'TC-1'), tagged(ROOM_CREATE, 'TC-2'), tagged(BOOKING_LIST, 'TC-3')], NOTHING, UNIVERSE);

    expect(result.report).not.toBeNull();
    expect(result.report?.declared).toBe(0);
    expect(result.report?.kinds).toEqual({ action: 3, screen: 1 });
    expect(result.report?.relieved).toBe(3);
    expect(result.report?.owners).toEqual(expect.arrayContaining(UNIVERSE));
    expect(result.report?.owners).toHaveLength(UNIVERSE.length);
  });

  it('外す指摘が 0 件でも、宣言があれば報告は出る(範囲の外にある仕様を毎回見せる)', () => {
    const result = partitionByScope([untagged('V3', '食い違い')], NOTHING, UNIVERSE);

    expect(result.relieved).toEqual([]);
    expect(result.report?.relieved).toBe(0);
    expect(result.report?.kinds).toEqual({ action: 3, screen: 1 });
  });
});

describe('範囲の中の持ち主の error は残る', () => {
  it('列挙した id の印つきの error は残り、列挙しない id のだけが移る', () => {
    const inScope = tagged(ROOM_CREATE, 'TC-1');
    const outOfScope = tagged(BOOKING_CREATE, 'TC-2');

    const result = partitionByScope([inScope, outOfScope], { declared: true, ids: ['room-create-action'] }, UNIVERSE);

    expect(result.kept).toEqual([inScope]);
    expect(result.relieved).toEqual([outOfScope]);
    expect(result.report?.declared).toBe(1);
    expect(result.report?.kinds).toEqual({ action: 2, screen: 1 });
  });

  it('全部の id を列挙すれば、何も移らない(宣言なしと同じ指摘の並びになる)', () => {
    const findings = [tagged(ROOM_CREATE, 'TC-1'), untagged('V3', '食い違い'), tagged(BOOKING_LIST, 'TC-3')];

    const result = partitionByScope(findings, { declared: true, ids: UNIVERSE.map((owner) => owner.id) }, UNIVERSE);

    expect(result.kept).toEqual(findings);
    expect(result.relieved).toEqual([]);
    expect(result.report?.kinds).toEqual({});
  });
});

describe('印の付け間違いと、一覧に無い持ち主は、免除に倒さない', () => {
  it('warning に印が付いていたら throw する(範囲の外でも・中でも)', () => {
    const warning: Finding = { ...makeFinding('A6', { severity: 'warning', message: '警告', location: { file: 'x.md' }, suggestion: '直す' }), absentFor: ROOM_CREATE };

    expect(() => partitionByScope([warning], NOTHING, UNIVERSE)).toThrow();
    expect(() => partitionByScope([warning], { declared: true, ids: ['room-create-action'] }, UNIVERSE)).toThrow();
  });

  it('印の持ち主が持ち主の一覧に無ければ、範囲の外とは扱わず残す', () => {
    const stray = tagged({ kind: 'action', id: 'ghost-action' }, 'TC-404');

    const result = partitionByScope([stray], NOTHING, UNIVERSE);

    expect(result.kept).toEqual([stray]);
    expect(result.relieved).toEqual([]);
  });
});

/**
 * T16 の警告の理由の区分(`lib/data/check-reasons.ts`)の判定のユニットテスト。
 *
 * 見るのは、執行点がトリガで形式定義が DSL の写像の外(数の上限・状態依存・形式定義なし)のときだけ
 * 「仕組みが組めない側」になり、それ以外は「製品が直せる側」になること。
 */

import { describe, expect, it } from 'vitest';
import { T16_REASONS, groundingReasonOf, referencesOtherAggregate } from '../../../lib/data/check-reasons.js';

describe('groundingReasonOf(実在しない執行点の理由)', () => {
  it('トリガで形式定義が写像の外(数の上限・状態依存・形式定義なし)なら、仕組みが組めない側', () => {
    for (const formal of ['cardinality', 'state_dependency', '']) {
      expect(groundingReasonOf('trigger', formal, false, formal === ''), formal).toBe(T16_REASONS.triggerFormalInexpressible);
    }
  });

  it('形式定義が写せる(行内比較・一意・排他)なら、トリガでも製品が直せる側', () => {
    for (const formal of ['check', 'uniqueness', 'exclusion']) {
      expect(groundingReasonOf('trigger', formal, false, formal === ''), formal).toBe(T16_REASONS.enforcementUndeclared);
    }
  });

  it('執行点がトリガでなければ、形式定義が写像の外でも製品が直せる側', () => {
    expect(groundingReasonOf('db_constraint', 'cardinality', false, false)).toBe(T16_REASONS.enforcementUndeclared);
  });
});

describe('groundingReasonOf(形式定義なしの受け入れは不変条件ごと。点検 22 回目 C22-3)', () => {
  it('形式定義が無いのに DSL の外である理由(formal_outside)を宣言していなければ、書けるのに書いていないと区別できないので製品が直せる側', () => {
    expect(groundingReasonOf('trigger', '', false, false)).toBe(T16_REASONS.enforcementUndeclared);
    expect(groundingReasonOf('trigger', '', false, true)).toBe(T16_REASONS.triggerFormalInexpressible);
  });

  it('形式定義を書いた写像の外(数の上限・状態依存)は、理由の宣言によらず仕組みが組めない側', () => {
    expect(groundingReasonOf('trigger', 'cardinality', false, false)).toBe(T16_REASONS.triggerFormalInexpressible);
    expect(groundingReasonOf('trigger', 'state_dependency', false, false)).toBe(T16_REASONS.triggerFormalInexpressible);
  });
});

describe('groundingReasonOf(別の集約の欄を見る check)', () => {
  it('トリガで形式定義が check・式が別の集約の欄を見るなら、別の集約の欄との一致の側', () => {
    expect(groundingReasonOf('trigger', 'check', true, false)).toBe(T16_REASONS.crossAggregateCheck);
  });

  it('check でも式が自集約だけを見るなら、製品が直せる側(別集約の理由にならない)', () => {
    expect(groundingReasonOf('trigger', 'check', false, false)).toBe(T16_REASONS.enforcementUndeclared);
  });

  it('別の集約を見るのが check 以外の形式定義・トリガ以外の執行点なら、この理由にならない', () => {
    expect(groundingReasonOf('trigger', 'cardinality', true, false)).toBe(T16_REASONS.triggerFormalInexpressible);
    expect(groundingReasonOf('db_constraint', 'check', true, false)).toBe(T16_REASONS.enforcementUndeclared);
  });
});

describe('referencesOtherAggregate(式が自集約の外の欄を見るか)', () => {
  const own = new Set(['store', 'stores']);

  it('欄の根が自集約の名前(ディレクトリ名・エンティティ名)だけなら false', () => {
    expect(referencesOtherAggregate('store.opened_on < store.closed_on', own)).toBe(false);
    expect(referencesOtherAggregate('stores.opened_on < store.closed_on', own)).toBe(false);
  });

  it('1 つでも別の集約の欄があれば true', () => {
    expect(referencesOtherAggregate('store.company_id == staff_member.company_id', own)).toBe(true);
  });

  it('now は欄ではないので数えない', () => {
    expect(referencesOtherAggregate('store.closed_on < now', own)).toBe(false);
  });

  it('欄の根が集約名でない式(集約名の付かない裸の欄)は別の集約の欄ではない = false', () => {
    expect(referencesOtherAggregate('closed_on > opened_on', own)).toBe(false);
    expect(referencesOtherAggregate('store.closed_on > opened_on', own)).toBe(false);
  });

  it('パースできない式は false(読めない式は別の検査が止める)', () => {
    expect(referencesOtherAggregate('store.a ==== ', own)).toBe(false);
  });
});

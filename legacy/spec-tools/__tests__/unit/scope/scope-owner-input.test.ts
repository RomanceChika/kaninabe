/**
 * 配線側(`lib/compose/scope-owner-input.ts`)が、読み込んだモデルから**持ち主の id と読めたかどうかだけ**を取り出して `lib/scope` へ渡す。
 * `lib/scope` はモデルを見ない(入力は id と真偽値だけ)ので、取り出しの正しさはここで直に見る。
 * (以前は `universe.test.ts` が、モデルの形を渡して同じ取り出しを見ていた。取り出しだけをここへ移し、`universe.test.ts` は id の入力で同じ断言を持つ。)
 */

import { describe, expect, it } from 'vitest';
import { scopeOwnerInputOf } from '../../../lib/compose/scope-owner-input.js';
import { SPEC_KINDS, type ProductUses } from '../../../lib/model/product/uses.js';

const EMPTY = { available: true, queries: [], screens: [], tables: [], usecases: [], catalog: null, flow: null } as never;

/** 呼び出しの既定(全部空。引数の位置は `scopeOwnerInputOf` の宣言どおり)。 */
function call(overrides: { readonly actions?: never; readonly queries?: never; readonly jobs?: never; readonly domain?: never; readonly designTokensLoaded?: boolean } = {}) {
  return scopeOwnerInputOf(
    SPEC_KINDS as ProductUses,
    overrides.domain ?? ({ aggregates: new Map() } as never),
    overrides.actions ?? null,
    overrides.queries ?? EMPTY,
    EMPTY,
    EMPTY,
    EMPTY,
    overrides.jobs ?? EMPTY,
    EMPTY,
    EMPTY,
    EMPTY,
    EMPTY,
    overrides.designTokensLoaded ?? true,
  );
}

describe('scopeOwnerInputOf', () => {
  it('操作・走査・読み取り・不変条件の id と、カタログの有無を取り出す', () => {
    const input = call({
      actions: { actions: [{ id: 'room-create-action' }], scans: [{ event: 'booking.expire' }] } as never,
      queries: { available: true, queries: [{ id: 'query-room-list' }] } as never,
      jobs: { available: true, catalog: {} } as never,
      domain: { aggregates: new Map([['booking', { invariants: { invariants: [{ id: 'INV-BOOKING-001' }] } }], ['room', {}]]) } as never,
    });

    expect(input.actionIds).toEqual(['room-create-action']);
    expect(input.scanEvents).toEqual(['booking.expire']);
    expect(input.queryIds).toEqual(['query-room-list']);
    expect(input.invariantIds).toEqual(['INV-BOOKING-001']);
    expect(input.catalogs).toEqual({ jobs: true, auth: false, guarantees: false, external: false, config: false, designTokens: true });
  });

  it('action_spec を読めていなければ(null)、操作と走査の id は空', () => {
    const input = call();

    expect(input.actionIds).toEqual([]);
    expect(input.scanEvents).toEqual([]);
  });

  it('デザイントークンを読めていなければ designTokens は false', () => {
    expect(call({ designTokensLoaded: false }).catalogs.designTokens).toBe(false);
  });
});

/**
 * P13: `implemented` に書いた id が、実装の範囲に入れられる仕様の id であること。
 *
 * 入れられる id は、印(`absentFor`)の持ち主の id と**同じ 1 つの一覧**(`scopeOwners` の結果)である。印の付く id と書ける id が
 * 別の表だと、「書いたのに何にも当たらない id」が黙って通る(範囲に入れたつもりで、実は何も入っていない)。
 *   - 一覧にある id で、その種類が `uses` にあるもの → 受理
 *   - 知らない id・`uses` に無い種類の id・何も持たない id(access の id や `surface` など。一覧に居ない)→ P13(error)
 * 宣言なし(`declared: false`)は何も言わない。
 *
 * 計画: step 3b の section 2(P13)。
 */

import { describe, expect, it } from 'vitest';
import type { ScopeOwner } from '../../../lib/kernel/scope-owner.js';
import { SPEC_KINDS } from '../../../lib/model/product/uses.js';
import { verifyImplementedIds } from '../../../lib/scope/verifiers/p13-implemented-ids.js';

/** 持ち主の種類ごとに 1 つずつ(印が付く全部の種類。カタログは 6 つとも)。 */
const ONE_PER_KIND: readonly ScopeOwner[] = [
  { kind: 'action', id: 'room-create-action' },
  { kind: 'query', id: 'query-room-list' },
  { kind: 'screen', id: 'screen-room-admin' },
  { kind: 'table', id: 'table-rooms' },
  { kind: 'usecase', id: 'usecase-book-room' },
  { kind: 'scan', id: 'booking-expire' },
  { kind: 'invariant', id: 'INV-BOOKING-001' },
  { kind: 'catalog', id: 'job-catalog' },
  { kind: 'catalog', id: 'auth-flow' },
  { kind: 'catalog', id: 'guarantee-catalog' },
  { kind: 'catalog', id: 'external-catalog' },
  { kind: 'catalog', id: 'config-catalog' },
  { kind: 'catalog', id: 'design-tokens' },
];

describe('P13 implemented の id の実在', () => {
  it('宣言なしは何も言わない', () => {
    expect(verifyImplementedIds({ scope: { declared: false }, owners: ONE_PER_KIND, uses: SPEC_KINDS })).toEqual([]);
  });

  it('`implemented: []` は何も言わない', () => {
    expect(verifyImplementedIds({ scope: { declared: true, ids: [] }, owners: ONE_PER_KIND, uses: SPEC_KINDS })).toEqual([]);
  });

  it('持ち主の種類ごとに 1 つずつの id は全部受理される(種類を全部採っている製品)', () => {
    const scope = { declared: true, ids: ONE_PER_KIND.map((owner) => owner.id) } as const;

    expect(verifyImplementedIds({ scope, owners: ONE_PER_KIND, uses: SPEC_KINDS })).toEqual([]);
  });

  it.each(ONE_PER_KIND.map((owner) => [`${owner.kind}:${owner.id}`, owner] as const))('%s は単独でも受理される', (_label, owner) => {
    expect(verifyImplementedIds({ scope: { declared: true, ids: [owner.id] }, owners: ONE_PER_KIND, uses: SPEC_KINDS })).toEqual([]);
  });

  it('知らない id は P13(error)。文言は id を名指し、位置は implemented[i]', () => {
    const findings = verifyImplementedIds({ scope: { declared: true, ids: ['room-create-action', 'room-typo-action'] }, owners: ONE_PER_KIND, uses: SPEC_KINDS });

    expect(findings.map((finding) => [finding.verifier, finding.severity])).toEqual([['P13', 'error']]);
    expect(findings[0]?.message).toBe('implemented の room-typo-action は実装の範囲に入れられる仕様の id ではありません');
    expect(findings[0]?.location.pointer).toBe('implemented[1]');
    expect(findings[0]?.suggestion).not.toBe('');
  });

  it('`uses` に無い種類の id は P13(その種類は読み込まれないので、書いても何にも当たらない)', () => {
    const uses = SPEC_KINDS.filter((kind) => kind !== 'actions');

    const findings = verifyImplementedIds({ scope: { declared: true, ids: ['room-create-action', 'screen-room-admin'] }, owners: ONE_PER_KIND, uses });

    expect(findings.map((finding) => finding.message)).toEqual(['implemented の room-create-action は実装の範囲に入れられる仕様の id ではありません']);
  });

  it('カタログの id も、そのカタログの種類を採っていなければ P13', () => {
    const uses = SPEC_KINDS.filter((kind) => kind !== 'jobs');

    const findings = verifyImplementedIds({ scope: { declared: true, ids: ['job-catalog', 'auth-flow'] }, owners: ONE_PER_KIND, uses });

    expect(findings.map((finding) => finding.message)).toEqual(['implemented の job-catalog は実装の範囲に入れられる仕様の id ではありません']);
  });

  it.each([['surface'], ['room-access'], ['domain-roles'], ['screen-room-admin ']])('何も持たない id(%s)は P13 — 持ち主の一覧に居ない', (id) => {
    const findings = verifyImplementedIds({ scope: { declared: true, ids: [id] }, owners: ONE_PER_KIND, uses: SPEC_KINDS });

    expect(findings.map((finding) => finding.verifier)).toEqual(['P13']);
  });

  it('壊れた id が複数あれば 1 件ずつ指す(打ち切らない)', () => {
    const findings = verifyImplementedIds({ scope: { declared: true, ids: ['nope-1', 'room-create-action', 'nope-2'] }, owners: ONE_PER_KIND, uses: SPEC_KINDS });

    expect(findings.map((finding) => finding.location.pointer)).toEqual(['implemented[0]', 'implemented[2]']);
  });

  it('持ち主の一覧が空なら、列挙した id は全部 P13(一覧が読めない形を「受理」に倒さない)', () => {
    const findings = verifyImplementedIds({ scope: { declared: true, ids: ['room-create-action'] }, owners: [], uses: SPEC_KINDS });

    expect(findings.map((finding) => finding.verifier)).toEqual(['P13']);
  });
});

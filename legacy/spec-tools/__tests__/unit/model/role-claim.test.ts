/**
 * role_spec の `claim` の文法と分解(lib/model/role-claim.ts)。ADR-0018 の E1。
 */

import { describe, expect, it } from 'vitest';
import { claimPartsOf, claimText, parseClaimText } from '../../../lib/model/role-claim.js';
import type { RoleDef } from '../../../lib/model/types.js';
import { loc } from '../../helpers/model-builder.js';

/** claim だけを持つロール。 */
function claimRole(claim: string, claimValues?: readonly string[]): RoleDef {
  return {
    id: 'r',
    claim,
    ...(claimValues === undefined ? {} : { claimValues }),
    location: loc('docs/specs/domain/roles.md', 'roles.r'),
  };
}

describe('parseClaimText', () => {
  it('boolean の形は値を持たない', () => {
    expect(parseClaimText('member.is_staff')).toEqual({ ok: true, path: 'member.is_staff', values: null });
  });

  it('== は値 1 つの集合になる', () => {
    expect(parseClaimText('member.state == active')).toEqual({ ok: true, path: 'member.state', values: ['active'] });
  });

  it('in は宣言順に値を並べる', () => {
    expect(parseClaimText(' member.card in [valid,expired] ')).toEqual({
      ok: true,
      path: 'member.card',
      values: ['valid', 'expired'],
    });
  });

  it.each([
    ['', 'どれでもありません'],
    ['member', 'どれでもありません'],
    ['member.state != active', 'どれでもありません'],
    ['member.state in active', 'どれでもありません'],
    ['state == active', '"{entity}.{field}" の形式ではありません'],
    ['member.state == a-b', '綴り'],
    ['member.state in [a, ]', '綴り'],
    ['member.state in [a, a]', '重複'],
  ])('%j は読めない', (text, reason) => {
    const parsed = parseClaimText(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain(reason);
  });
});

describe('claimPartsOf / claimText', () => {
  it('claim を持たないロールは null / 空文字', () => {
    const plain: RoleDef = { id: 'p', location: loc() };
    expect(claimPartsOf(plain)).toBeNull();
    expect(claimText(plain)).toBe('');
  });

  it('壊れたパス(ドットが無い)は分解しない', () => {
    expect(claimPartsOf(claimRole('nodot'))).toBeNull();
  });

  it('boolean の claim は値を持たない', () => {
    expect(claimPartsOf(claimRole('member.is_staff'))).toEqual({ entity: 'member', field: 'is_staff', values: null });
    expect(claimText(claimRole('member.is_staff'))).toBe('member.is_staff');
  });

  it('値の集合を持つ claim は宣言の綴りに戻る(1 つなら ==、複数なら in)', () => {
    const one = claimRole('member.state', ['active']);
    const many = claimRole('member.state', ['active', 'suspended']);
    expect(claimPartsOf(one)).toEqual({ entity: 'member', field: 'state', values: ['active'] });
    expect(claimText(one)).toBe('member.state == active');
    expect(claimText(many)).toBe('member.state in [active, suspended]');
  });
});

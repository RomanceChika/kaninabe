/**
 * role_spec の `claim`(実行者自身の行の欄が根拠のロール)の形式検査。
 *
 * 対象の要求(domain-spec-writing.md §role_spec): `claim` は `{entity}.{field}`(boolean)・
 * `{entity}.{field} == {値}`・`{entity}.{field} in [{値}, ...]`(state / enum。ADR-0018)の形で書き、
 * `binding` とは同時に持てず、`kind` とは `authenticated_default` だけ併記できる。指す欄が実在し
 * `session: true` で型と値が合っていることは V11 が見る(パーサーは 1 ファイルの中で閉じた形式しか見ない)。
 */

import { describe, expect, it } from 'vitest';
import { parseRoleSpec } from '../../../lib/model/parse-role.js';

/** roles.md のフロントマター相当(グローバルロール 3 つ + 追加の 1 つ)。 */
function frontmatter(extra: Readonly<Record<string, unknown>>): unknown {
  return {
    doc_type: 'role_spec',
    roles: [
      { id: 'anonymous', kind: 'anonymous' },
      { id: 'member', kind: 'authenticated_default' },
      { id: 'system', kind: 'system' },
      extra,
    ],
  };
}

/** そのポインタを名指しするエラーの文面(無ければ空文字)。 */
function errorAt(findings: readonly { location: { pointer?: string }; message: string }[], pointer: string): string {
  return findings.find((finding) => finding.location.pointer === pointer)?.message ?? '';
}

describe('role_spec の claim', () => {
  it('`{entity}.{field}` 形式なら読める', () => {
    const result = parseRoleSpec(frontmatter({ id: 'staff', claim: 'member.is_staff' }), 'roles.md');

    expect(result.findings).toEqual([]);
    expect(result.value?.roles.find((role) => role.id === 'staff')?.claim).toBe('member.is_staff');
  });

  it('claim を書かないロールは claim を持たない', () => {
    const result = parseRoleSpec(frontmatter({ id: 'staff' }), 'roles.md');

    expect(result.value?.roles.find((role) => role.id === 'staff')?.claim).toBeUndefined();
  });

  it('2 セグメントでない claim は落とす', () => {
    const result = parseRoleSpec(frontmatter({ id: 'staff', claim: 'is_staff' }), 'roles.md');

    expect(errorAt(result.findings, 'roles.staff.claim')).toContain('どれでもありません');
  });

  it('binding と同時には持てない(根拠が 2 つになる)', () => {
    const result = parseRoleSpec(
      frontmatter({ id: 'staff', claim: 'member.is_staff', binding: 'entry.owner_id == actor.id' }),
      'roles.md',
    );

    expect(errorAt(result.findings, 'roles[3].claim')).toContain('binding を両方持っています');
  });

  it('kind と同時には持てない(セッションの有無で立つロールではない)', () => {
    const result = parseRoleSpec(
      frontmatter({ id: 'guest', claim: 'member.is_staff', kind: 'anonymous' }),
      'roles.md',
    );

    expect(errorAt(result.findings, 'roles[3].claim')).toContain('kind を両方持っています');
  });

  it('kind: authenticated_default とは併記できる(行の実在に条件を足す形)', () => {
    const result = parseRoleSpec(
      {
        doc_type: 'role_spec',
        roles: [
          { id: 'anonymous', kind: 'anonymous' },
          { id: 'member', kind: 'authenticated_default', claim: 'member.state == active' },
          { id: 'system', kind: 'system' },
        ],
      },
      'roles.md',
    );

    expect(result.findings).toEqual([]);
    expect(result.value?.roles.find((role) => role.id === 'member')).toMatchObject({
      kind: 'authenticated_default',
      claim: 'member.state',
      claimValues: ['active'],
    });
  });

  it('kind: anonymous / system との併記は断る(実行者の行を根拠にしない)', () => {
    const result = parseRoleSpec(
      frontmatter({ id: 'guest', claim: 'member.state == active', kind: 'system' }),
      'roles.md',
    );

    expect(result.findings.map((finding) => finding.location.pointer)).toContain('roles[3].claim');
    expect(errorAt(result.findings, 'roles[3].claim')).toContain('kind を両方持っています');
  });
});

describe('role_spec の claim — state / enum の値', () => {
  /** claim を持つロールを読み、その RoleDef を返す。 */
  function read(claim: string) {
    const result = parseRoleSpec(frontmatter({ id: 'active_member', claim }), 'roles.md');
    return { result, def: result.value?.roles.find((role) => role.id === 'active_member') };
  }

  it('== で値 1 つを書ける。欄のパスは claim に、値は claimValues に分かれる', () => {
    const { result, def } = read('member.state == active');

    expect(result.findings).toEqual([]);
    expect(def?.claim).toBe('member.state');
    expect(def?.claimValues).toEqual(['active']);
  });

  it('in [...] で値の集合を書ける(宣言順・空白は問わない)', () => {
    const { result, def } = read('member.state in [active,  suspended]');

    expect(result.findings).toEqual([]);
    expect(def?.claim).toBe('member.state');
    expect(def?.claimValues).toEqual(['active', 'suspended']);
  });

  it('== の前後に空白が無くても読める', () => {
    expect(read('member.state==active').def?.claimValues).toEqual(['active']);
  });

  it('boolean の形(値なし)は claimValues を持たない', () => {
    const { def } = read('member.is_staff');

    expect(def?.claim).toBe('member.is_staff');
    expect(def).not.toHaveProperty('claimValues');
  });

  it.each([
    ['空の集合', 'member.state in []'],
    ['値の綴りが読めない', 'member.state == "a b"'],
    ['値の重複', 'member.state in [active, active]'],
    ['右辺が無い', 'member.state =='],
    ['欄のパスが 2 セグメントでない', 'state == active'],
    ['未対応の比較', 'member.state != active'],
  ])('%s は落とす', (_name, claim) => {
    const { result, def } = read(claim);

    expect(errorAt(result.findings, 'roles.active_member.claim')).toContain('claim を読めません');
    expect(def).not.toHaveProperty('claim');
    expect(def).not.toHaveProperty('claimValues');
  });
});

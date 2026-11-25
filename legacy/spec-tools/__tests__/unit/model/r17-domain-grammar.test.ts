/**
 * ドメイン仕様の名前の文法(R17 の読み込みの拒否)と、R 群の受け入れの欄(`unbounded` / `self_assign`)の読み込みの単体テスト。
 *
 * 名前は生成 SQL(ロール ID → ポリシー名・補助関数名 / エンティティ名 → `p_{entity}_id`)と生成 TS の識別子にそのまま
 * 置かれるので、識別子の文法(`^[a-z][a-z0-9_]*$`)に合わない値は読み込みで落ちる(生成は読み込みの error で止まる)。
 */

import { describe, expect, it } from 'vitest';
import { parseRoleSpec } from '../../../lib/model/parse-role.js';
import { parseEntitySpec } from '../../../lib/model/parse-entity.js';
import { parseStateSpecs } from '../../../lib/model/parse-state.js';
import { parseAccessSpec } from '../../../lib/model/parse-access.js';
import type { Finding } from '../../../lib/kernel/finding.js';

const HOSTILE = 'x on public.t; drop table y; --';

/** error の message を集める。 */
function errors(findings: readonly Finding[]): string {
  return findings
    .filter((finding) => finding.severity === 'error')
    .map((finding) => finding.message)
    .join('\n');
}

/** 状態機械 1 つの宣言。 */
function machineDoc(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    doc_type: 'state_spec',
    state_machine: 'entry',
    states: [{ id: 'draft' }, { id: 'submitted' }],
    initial: 'draft',
    final: ['submitted'],
    events: [{ id: 'submit', from: ['draft'], to: 'submitted', by: ['member'] }],
    ...overrides,
  };
}

describe('識別子の文法(ロール・エンティティ・状態機械・状態・イベント・access_spec)', () => {
  it('ロール ID の SQL 断片は落ちる', () => {
    const result = parseRoleSpec({ doc_type: 'role_spec', roles: [{ id: HOSTILE, kind: 'anonymous' }] }, 'roles.md');

    expect(errors(result.findings)).toContain('id が書ける形ではありません');
    expect(result.value?.roles ?? []).toEqual([]);
  });

  it('エンティティ名と table の SQL 断片は落ちる', () => {
    const fields = [{ name: 'id', type: 'uuid', auto: true, personal: false }];

    expect(errors(parseEntitySpec({ doc_type: 'entity_spec', entity: 'a$$b', fields }, 'e.md').findings)).toContain('entity が書ける形ではありません');
    expect(errors(parseEntitySpec({ doc_type: 'entity_spec', entity: 'ok', table: 'oks; drop', fields }, 'e.md').findings)).toContain('table が書ける形ではありません');
  });

  it('状態機械名・状態 ID・イベント ID の断片は落ちる', () => {
    expect(errors(parseStateSpecs(machineDoc({ state_machine: "e'); x" }), 's.md').findings)).toContain('state_machine が書ける形ではありません');
    expect(errors(parseStateSpecs(machineDoc({ states: [{ id: 'draft' }, { id: 'sub mitted' }] }), 's.md').findings)).toContain('id が書ける形ではありません');
    const events = [{ id: 'sub;mit', from: ['draft'], to: 'submitted', by: ['member'] }];
    expect(errors(parseStateSpecs(machineDoc({ events }), 's.md').findings)).toContain('id が書ける形ではありません');
  });

  it('access_spec の entity と filters の列名の断片は落ちる', () => {
    const reads = [{ by: 'member', scope: 'all' }];

    expect(errors(parseAccessSpec({ doc_type: 'access_spec', entity: 'e x', reads }, 'a.md').findings)).toContain('entity が書ける形ではありません');
    const filtered = [{ by: 'member', scope: 'all', filters: { 'company_id) or (true': 'actor.company_id' } }];
    expect(errors(parseAccessSpec({ doc_type: 'access_spec', entity: 'e', reads: filtered }, 'a.md').findings)).toContain('識別子の形ではありません');
  });

  it('現行の書き方は通る', () => {
    expect(errors(parseStateSpecs(machineDoc(), 's.md').findings)).toBe('');
    const roles = [
      { id: 'anonymous', kind: 'anonymous' },
      { id: 'member', kind: 'authenticated_default' },
      { id: 'system', kind: 'system' },
      { id: 'entry_owner', binding: 'entry.owner_id == actor.id', implies: ['member'] },
    ];
    expect(errors(parseRoleSpec({ doc_type: 'role_spec', roles }, 'r.md').findings)).toBe('');
  });
});

describe('受け入れの欄の読み込み', () => {
  it('イベントの self_assign を欄 × 役 × 書き手で読み、知らないキー(綴り違い)は落とす', () => {
    const decl = [{ field: 'member.state', role: 'member', by: ['member'], reason: '理由' }];
    const accepted = parseStateSpecs(machineDoc({ events: [{ id: 'submit', from: ['draft'], to: 'submitted', by: ['member'], self_assign: decl }] }), 's.md');
    const typo = parseStateSpecs(machineDoc({ events: [{ id: 'submit', from: ['draft'], to: 'submitted', by: ['member'], self_asign: decl }] }), 's.md');

    expect(accepted.value?.[0]?.events[0]?.selfAssign).toEqual([expect.objectContaining({ entity: 'member', field: 'state', role: 'member', by: ['member'], reason: '理由' })]);
    expect(errors(accepted.findings)).toBe('');
    expect(errors(typo.findings)).toContain('self_asign');
  });

  describe('self_assign の形(点検 9 回目 A9-2 で欄 × 役・10 回目 A10-1 で書き手。受け入れは名指した欄 × 役 × 書き手にだけ効く)', () => {
    /** creates[0] の self_assign を読んだ結果と違反。 */
    function read(selfAssign: unknown) {
      const result = parseAccessSpec({ doc_type: 'access_spec', entity: 'e', reads: [{ by: 'member', scope: 'all' }], creates: [{ by: 'member', self_assign: selfAssign }] }, 'a.md');
      return { decls: result.value?.creates[0]?.selfAssign, errors: errors(result.findings) };
    }
    const by = ['member'];

    it.each([
      { name: '欄 × 役 × 書き手 × 理由', value: [{ field: 'e.owner_id', role: 'owner', by, reason: '理由' }], decls: [{ entity: 'e', field: 'owner_id', role: 'owner', by, reason: '理由' }], error: '' },
      { name: '役の無い根拠(実行者の属性の欄)は role を書かない', value: [{ field: 'e.tenant_id', by, reason: '理由' }], decls: [{ entity: 'e', field: 'tenant_id', by, reason: '理由' }], error: '' },
      {
        name: '複数の要素は宣言順・書き手は複数書ける(前後の空白は落とす)',
        value: [{ field: 'e.a_id', role: 'a', by: [' member ', 'staff'], reason: 'x' }, { field: 'e.b_id', role: 'b', by, reason: 'y' }],
        decls: [{ entity: 'e', field: 'a_id', role: 'a', by: ['member', 'staff'], reason: 'x' }, { entity: 'e', field: 'b_id', role: 'b', by, reason: 'y' }],
        error: '',
      },
      { name: '規則単位の 1 文字列(旧い形)は読まずに止める', value: '作った人が持ち主', decls: undefined, error: 'self_assign を 1 つの文字列では書けません' },
      { name: 'field が {集約}.{欄} の形でない', value: [{ field: 'owner_id', role: 'owner', by, reason: '理由' }], decls: undefined, error: '"{集約}.{欄}" の形ではありません' },
      { name: 'reason が無い要素は載せない', value: [{ field: 'e.owner_id', role: 'owner', by }], decls: undefined, error: 'reason' },
      { name: 'by が無い要素は載せない(書き手を名指さない受け入れは書けない。A10-1)', value: [{ field: 'e.owner_id', role: 'owner', reason: '理由' }], decls: undefined, error: 'by がありません' },
      { name: 'by が空の要素は載せない', value: [{ field: 'e.owner_id', role: 'owner', by: [], reason: '理由' }], decls: undefined, error: 'by が空です' },
      { name: 'by が 1 つの文字列(リストでない)の要素は載せない', value: [{ field: 'e.owner_id', role: 'owner', by: 'member', reason: '理由' }], decls: undefined, error: 'by はリストで書きます' },
      { name: 'by に空の書き手がある要素は載せない', value: [{ field: 'e.owner_id', role: 'owner', by: ['member', ' '], reason: '理由' }], decls: undefined, error: 'self_assign[0].by[1] が空です' },
      { name: 'by に同じ書き手が 2 回ある要素は載せない', value: [{ field: 'e.owner_id', role: 'owner', by: ['member', 'member'], reason: '理由' }], decls: undefined, error: 'member が 2 回あります' },
      { name: 'by に文字列でない書き手がある要素は書き手を落とす', value: [{ field: 'e.owner_id', role: 'owner', by: ['member', 3], reason: '理由' }], decls: [{ entity: 'e', field: 'owner_id', role: 'owner', by, reason: '理由' }], error: 'by[1] は文字列で書きます' },
      { name: '知らないキーは止める', value: [{ field: 'e.owner_id', role: 'owner', by, reason: '理由', roles: ['x'] }], decls: [{ entity: 'e', field: 'owner_id', role: 'owner', by, reason: '理由' }], error: 'roles' },
    ])('$name', ({ value, decls, error }) => {
      const actual = read(value);
      expect(actual.decls?.map(({ location: _location, ...rest }) => rest)).toEqual(decls);
      if (error === '') expect(actual.errors).toBe('');
      else expect(actual.errors).toContain(error);
    });
  });

  it('writes と creates の self_assign を読み、deletes には書けない', () => {
    const reads = [{ by: 'member', scope: 'all' }];
    const result = parseAccessSpec(
      {
        doc_type: 'access_spec',
        entity: 'e',
        reads,
        creates: [{ by: 'member', self_assign: [{ field: 'e.owner_id', role: 'owner', by: ['member'], reason: '作った人が持ち主' }] }],
        writes: [{ by: 'member', fields: ['owner_id'], self_assign: [{ field: 'e.owner_id', role: 'owner', by: ['member'], reason: '譲れる' }] }],
        deletes: [{ by: 'member', self_assign: '書けない' }],
      },
      'a.md',
    );

    expect(result.value?.creates[0]?.selfAssign?.[0]?.reason).toBe('作った人が持ち主');
    expect(result.value?.writes[0]?.selfAssign?.[0]?.reason).toBe('譲れる');
    expect(errors(result.findings)).toContain('self_assign');
  });

  it('欄の unbounded を読む', () => {
    const fields = [{ name: 'body', type: 'text', unbounded: '外部の文書をそのまま写す', personal: false }];

    expect(parseEntitySpec({ doc_type: 'entity_spec', entity: 'doc', fields }, 'e.md').value?.fields[0]?.unbounded).toBe('外部の文書をそのまま写す');
  });
});

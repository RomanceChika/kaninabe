import { describe, expect, it } from 'vitest';
import { parseRoleSpec } from '../../../lib/model/parse-role.js';
import { expectWellFormed, findByMessage, pointers } from './_helpers.js';

const FILE = 'docs/specs/domain/roles.md';

describe('parseRoleSpec', () => {
  it('グローバルロールと文脈依存ロールを読み分け、label を載せる', () => {
    const result = parseRoleSpec(
      {
        doc_type: 'role_spec',
        roles: [
          { id: 'anonymous', kind: 'anonymous' },
          { id: 'member', kind: 'authenticated_default' },
          { id: 'system', kind: 'system' },
          { id: 'performer', label: '発表者', binding: 'entry.performer_id == actor.id' },
        ],
      },
      FILE,
    );

    expect(result.findings).toHaveLength(0);
    expect(result.value?.roles).toEqual([
      { id: 'anonymous', kind: 'anonymous', location: { file: FILE, pointer: 'roles.anonymous' } },
      { id: 'member', kind: 'authenticated_default', location: { file: FILE, pointer: 'roles.member' } },
      { id: 'system', kind: 'system', location: { file: FILE, pointer: 'roles.system' } },
      {
        id: 'performer',
        label: '発表者',
        binding: 'entry.performer_id == actor.id',
        location: { file: FILE, pointer: 'roles.performer' },
      },
    ]);
    expect(result.value?.location).toEqual({ file: FILE });
  });

  it('label は任意。文字列でなければ V1 エラーにしてラベルだけ落とす', () => {
    const result = parseRoleSpec({ doc_type: 'role_spec', roles: [{ id: 'member', label: 1 }] }, FILE);

    expect(result.value?.roles[0]).toEqual({
      id: 'member',
      location: { file: FILE, pointer: 'roles.member' },
    });
    expect(findByMessage(result.findings, 'label は文字列で書きます').location.pointer).toBe(
      'roles[0].label',
    );
  });

  it('roles が無ければ RoleSpec を構築できない', () => {
    const result = parseRoleSpec({ doc_type: 'role_spec' }, FILE);

    expect(result.value).toBeNull();
    expectWellFormed(result.findings);
    expect(pointers(result.findings)).toContain('roles');
  });

  it('roles がリストでなければ V1 違反として弾く', () => {
    const result = parseRoleSpec({ doc_type: 'role_spec', roles: { id: 'member' } }, FILE);

    expect(result.value).toBeNull();
    expect(findByMessage(result.findings, 'roles はリストで書きます')).toBeDefined();
  });

  it('id の無いロールだけを読み飛ばし、残りのロールは読む', () => {
    const result = parseRoleSpec(
      { doc_type: 'role_spec', roles: [{ binding: 'x == actor.id' }, { id: 'organizer' }] },
      FILE,
    );

    expect(result.value?.roles.map((role) => role.id)).toEqual(['organizer']);
    expect(findByMessage(result.findings, 'id がありません').location.pointer).toBe('roles[0].id');
  });

  it('要素がマッピングでない場合も位置付きで指摘する', () => {
    const result = parseRoleSpec({ doc_type: 'role_spec', roles: ['member'] }, FILE);

    expect(result.value?.roles).toEqual([]);
    expect(findByMessage(result.findings, 'マッピングで書きます').counterexample).toEqual({
      value: 'member',
    });
  });

  it('binding が文字列でなければ型不正として指摘する', () => {
    const result = parseRoleSpec(
      { doc_type: 'role_spec', roles: [{ id: 'performer', binding: 42 }] },
      FILE,
    );

    expect(result.value?.roles[0]?.binding).toBeUndefined();
    expect(findByMessage(result.findings, 'binding は文字列で書きます')).toBeDefined();
  });

  it('doc_type の不一致を指摘しつつロールは読む', () => {
    const result = parseRoleSpec({ doc_type: 'entity_spec', roles: [{ id: 'member' }] }, FILE);

    expect(result.value?.roles).toHaveLength(1);
    expect(findByMessage(result.findings, 'doc_type が role_spec ではありません')).toBeDefined();
  });

  it('implies を読み、ロール階層として載せる', () => {
    const result = parseRoleSpec(
      {
        doc_type: 'role_spec',
        roles: [
          { id: 'member', kind: 'authenticated_default' },
          { id: 'organizer', implies: ['member'] },
          { id: 'anonymous', kind: 'anonymous' },
          { id: 'system', kind: 'system' },
        ],
      },
      FILE,
    );

    expect(result.findings).toHaveLength(0);
    expect(result.value?.roles[1]).toEqual({
      id: 'organizer',
      implies: ['member'],
      location: { file: FILE, pointer: 'roles.organizer' },
    });
  });

  it('implies が存在しないロールを指したら V1 違反にする', () => {
    const result = parseRoleSpec(
      { doc_type: 'role_spec', roles: [{ id: 'organizer', implies: ['member'] }] },
      FILE,
    );

    const finding = findByMessage(
      result.findings,
      'organizer の implies が指すロール member が定義されていません',
    );
    expect(finding.location.pointer).toBe('roles.organizer.implies');
  });

  it('implies が自分自身を指したら V1 違反にする', () => {
    const result = parseRoleSpec(
      { doc_type: 'role_spec', roles: [{ id: 'member', implies: ['member'] }] },
      FILE,
    );

    expect(findByMessage(result.findings, 'member の implies が自分自身を指しています')).toBeDefined();
  });

  it('implies の循環を経路付きで指摘する', () => {
    const result = parseRoleSpec(
      {
        doc_type: 'role_spec',
        roles: [
          { id: 'a', implies: ['b'] },
          { id: 'b', implies: ['a'] },
        ],
      },
      FILE,
    );

    const finding = findByMessage(result.findings, 'implies が循環しています: a → b → a');
    expect(finding.suggestion.length).toBeGreaterThan(0);
  });

  it('フロントマターがマッピングでなければ構築できない', () => {
    const result = parseRoleSpec([{ id: 'member' }], FILE);

    expect(result.value).toBeNull();
    expect(result.findings).toHaveLength(1);
  });

  it('kind: anonymous / authenticated_default / system がそれぞれちょうど 1 つ無ければエラー', () => {
    const result = parseRoleSpec(
      { doc_type: 'role_spec', roles: [{ id: 'member', kind: 'authenticated_default' }] },
      FILE,
    );

    expect(findByMessage(result.findings, 'kind: anonymous を持つロールがありません')).toBeDefined();
    expect(findByMessage(result.findings, 'kind: system を持つロールがありません')).toBeDefined();
    expect(
      result.findings.some((finding) => finding.message.includes('kind: authenticated_default を持つロールがありません')),
    ).toBe(false);
  });

  it('同じ kind を 2 つのロールが持てばエラー', () => {
    const result = parseRoleSpec(
      {
        doc_type: 'role_spec',
        roles: [
          { id: 'anonymous', kind: 'anonymous' },
          { id: 'member', kind: 'authenticated_default' },
          { id: 'system', kind: 'system' },
          { id: 'bot', kind: 'system' },
        ],
      },
      FILE,
    );

    const finding = findByMessage(result.findings, 'kind: system を持つロールが 2 個あります(system, bot)');
    expect(finding.location.pointer).toBe('roles');
  });

  it('値域に無い kind は V1 違反にして kind を落とす', () => {
    const result = parseRoleSpec(
      { doc_type: 'role_spec', roles: [{ id: 'member', kind: 'super_admin' }] },
      FILE,
    );

    expect(result.value?.roles[0]?.kind).toBeUndefined();
    expect(findByMessage(result.findings, 'kind super_admin は値域')).toBeDefined();
  });

  it('kind と binding を両方持てば V1 違反にする(グローバルロールだけが kind を持てる)', () => {
    const result = parseRoleSpec(
      {
        doc_type: 'role_spec',
        roles: [{ id: 'organizer', kind: 'system', binding: 'workshop.organizer_id == actor.id' }],
      },
      FILE,
    );

    expect(
      findByMessage(result.findings, 'organizer は kind と binding を両方持っています'),
    ).toBeDefined();
  });
});

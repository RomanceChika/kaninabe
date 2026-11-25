/**
 * 期待 RLS ポリシー表の生成器のテスト。
 *
 * 対象の要求: 「access_spec の reads から、テーブルごとに存在すべき select ポリシー名の
 * 完全集合を生成する」。名前の規約 `{table}_select_{role}_{scope}`、scope: none の除外、
 * system の除外、エンティティ名 → テーブル名の対応が守られているかを見る。
 */

import { describe, expect, it } from 'vitest';
import {
  pluralizeEntity,
  rlsExpectationsGenerator,
} from '../../../../lib/generate/render/code-rls-expectations.js';
import type { RoleDef } from '../../../../lib/model/types.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  field,
  loc,
  read,
  role,
  roleSpec,
  specModel,
} from '../../../helpers/model-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';

/** access_spec だけを持つ集約を作る(このジェネレーターは reads しか見ない)。 */
function withReads(entity: string, reads: readonly [string, string][]) {
  return aggregate(entity, {
    entity: entitySpec(entity, { fields: [field('id', { kind: 'uuid' })] }),
    access: accessSpec(entity, { reads: reads.map(([by, scope]) => read(by, scope)) }),
  });
}

/** implies を持つロールを作る。 */
function roleWithImplies(id: string, implies: readonly string[]): RoleDef {
  return { id, implies, location: loc('docs/specs/domain/roles.md', `roles.${id}`) };
}

/** 生成された 1 ファイル分の本文を取り出す。 */
function generate(model: Parameters<typeof rlsExpectationsGenerator.generate>[0]) {
  return rlsExpectationsGenerator.generate(model, GEN_CTX);
}

describe('期待 RLS ポリシー表の生成', () => {
  it('reads からテーブルごとのポリシー名を作る', () => {
    const model = specModel([
      withReads('entry', [
        ['performer', 'own'],
        ['organizer', 'context(workshop)'],
        ['member', 'none'],
        ['system', 'all'],
      ]),
    ]);

    const [section] = generate(model);

    expect(section?.file).toBe('app/src/domain/generated/rls-expectations.ts');
    expect(section?.wholeFile).toBe(true);
    expect(section?.content).toContain(
      "entries: ['entries_select_performer_own', 'entries_select_organizer_context', 'entries_session_alive']",
    );
  });

  it('scope: none のロールと system は名前を作らない', () => {
    const model = specModel([
      withReads('entry', [
        ['member', 'none'],
        ['anonymous', 'none'],
        ['system', 'all'],
      ]),
    ]);

    const content = generate(model)[0]?.content ?? '';

    expect(content).toContain("entries: ['entries_session_alive']");
    expect(content).not.toContain('entries_select_system_all');
    expect(content).not.toContain('_none');
  });

  it('全ての表に、ログインセッションの生死を要求する制限ポリシー({table}_session_alive)が 1 本ずつ載る(許可ポリシーが 0 本の表にも)', () => {
    const model = specModel([
      withReads('member', [['member', 'all']]),
      withReads('ticket', [['member', 'none']]),
    ]);

    const content = generate(model)[0]?.content ?? '';

    expect(content).toContain("members: ['members_select_member_all', 'members_session_alive']");
    expect(content).toContain("tickets: ['tickets_session_alive']");
  });

  it('エンティティ名を複数形化の規則でテーブル名にする', () => {
    const model = specModel([
      withReads('member', [['member', 'all']]),
      withReads('workshop', [['member', 'all']]),
      withReads('entry', [['member', 'all']]),
      withReads('program_item', [['member', 'all']]),
    ]);

    const content = generate(model)[0]?.content ?? '';

    expect(content).toContain('members:');
    expect(content).toContain('workshops:');
    expect(content).toContain('entries:');
    expect(content).toContain('program_items:');
  });

  it('複数形化の規則(語尾ごと)', () => {
    expect(pluralizeEntity('member')).toBe('members');
    expect(pluralizeEntity('workshop')).toBe('workshops');
    expect(pluralizeEntity('entry')).toBe('entries');
    expect(pluralizeEntity('program_item')).toBe('program_items');
    expect(pluralizeEntity('address')).toBe('addresses');
    expect(pluralizeEntity('match')).toBe('matches');
    expect(pluralizeEntity('day')).toBe('days');
  });

  it('entity_spec の table 宣言があれば規則より優先する', () => {
    const model = specModel([
      aggregate('person', {
        entity: {
          ...entitySpec('person', { fields: [field('id', { kind: 'uuid' })] }),
          table: 'people',
        },
        access: accessSpec('person', { reads: [read('member', 'all')] }),
      }),
    ]);

    const content = generate(model)[0]?.content ?? '';

    expect(content).toContain("people: ['people_select_member_all', 'people_session_alive']");
    expect(content).not.toContain('persons');
  });

  it('凍結インターフェース(定数名・as const)を維持する', () => {
    const model = specModel([withReads('entry', [['performer', 'own']])]);

    const content = generate(model)[0]?.content ?? '';

    expect(content).toContain('export const rlsSelectExpectations = deepFreeze({');
    expect(content).toContain('} as const);');
    expect(content).toContain('AUTO-GENERATED');
    expect(content).toContain('docs/specs/domain/entry/access.md');
  });

  it('テーブル名で引くための型付きの別名も出す(呼び出し側にキャストを書かせない)', () => {
    const model = specModel([withReads('entry', [['performer', 'own']])]);

    const content = generate(model)[0]?.content ?? '';

    expect(content).toContain(
      'export const rlsSelectExpectationsByTable: Readonly<Record<string, readonly string[]>> =',
    );
    expect(content).toContain('rlsSelectExpectations;');
  });

  it('scope: all のロールを implies で含意するロールは刈り込む', () => {
    const model = specModel(
      [
        withReads('workshop', [
          ['member', 'all'],
          ['organizer', 'own'],
        ]),
      ],
      roleSpec([role('member'), roleWithImplies('organizer', ['member'])]),
    );

    const content = generate(model)[0]?.content ?? '';

    expect(content).toContain("workshops: ['workshops_select_member_all', 'workshops_session_alive']");
    expect(content).not.toContain('workshops_select_organizer_own');
  });

  it('implies が無ければ刈り込まない(別々のポリシーが要る)', () => {
    const model = specModel(
      [
        withReads('workshop', [
          ['member', 'all'],
          ['organizer', 'own'],
        ]),
      ],
      roleSpec([role('member'), role('organizer')]),
    );

    const content = generate(model)[0]?.content ?? '';

    expect(content).toContain('workshops_select_organizer_own');
  });

  it('推移的な含意でも刈り込む', () => {
    const model = specModel(
      [
        withReads('workshop', [
          ['member', 'all'],
          ['organizer', 'context(workshop)'],
        ]),
      ],
      roleSpec([
        role('member'),
        roleWithImplies('staff', ['member']),
        roleWithImplies('organizer', ['staff']),
      ]),
    );

    expect(generate(model)[0]?.content ?? '').toContain("workshops: ['workshops_select_member_all', 'workshops_session_alive']");
  });

  it('own と context の間では刈り込まない', () => {
    const model = specModel(
      [
        withReads('entry', [
          ['performer', 'own'],
          ['organizer', 'context(workshop)'],
        ]),
      ],
      roleSpec([role('performer'), role('organizer')]),
    );

    const content = generate(model)[0]?.content ?? '';

    expect(content).toContain('entries_select_performer_own');
    expect(content).toContain('entries_select_organizer_context');
  });

  it('未知のエンティティでも規則で導ける(生成器はドメインを知らない)', () => {
    const model = specModel([withReads('ticket', [['member', 'all']])]);

    expect(generate(model)[0]?.content ?? '').toContain("tickets: ['tickets_select_member_all', 'tickets_session_alive']");
  });

  it('access_spec が 1 つも無ければ何も生成しない', () => {
    expect(generate(specModel([]))).toEqual([]);
  });
});

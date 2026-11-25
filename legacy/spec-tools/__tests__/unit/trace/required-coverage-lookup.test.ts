/**
 * `deniedHumanRoles` の規約網羅テスト。
 * 対象の要求: action-spec-writing.md §A7 —
 * 「拒否される人間ロールが 1 つ以上存在するときだけ forbidden を要求する」の判定基準そのもの
 * （ロール階層 `implies` による閉包を含む）。
 */

import { describe, expect, it } from 'vitest';
import { deniedHumanRoles, invariantsInvolving } from '../../../lib/trace/required-coverage-lookup.js';
import { aggregate, invariant, invariantSpec, role, specModel } from '../../helpers/model-builder-v8plus.js';

describe('deniedHumanRoles', () => {
  it('全人間ロールが許可されていれば空(forbidden は要らない)', () => {
    const domain = specModel({ roles: [role('anonymous'), role('member'), role('system')] });

    expect(deniedHumanRoles(domain, ['anonymous', 'member'])).toEqual([]);
  });

  it('1 ロールでも許可されていなければ、そのロールを返す', () => {
    const domain = specModel({ roles: [role('anonymous'), role('member'), role('system')] });

    expect(deniedHumanRoles(domain, ['member'])).toEqual(['anonymous']);
  });

  it('implies で覆われる場合は拒否されない(staff implies member)', () => {
    // staff implies member なので、by: [member] は staff も暗黙に許す
    // (staff を持つ主体は必ず member でもあるため)。
    const domain = specModel({
      roles: [role('member'), role('staff', undefined, ['member']), role('system')],
    });

    expect(deniedHumanRoles(domain, ['member'])).toEqual([]);
  });

  it('境界: implies が推移的でも閉包する', () => {
    const domain = specModel({
      roles: [
        role('member'),
        role('staff', undefined, ['member']),
        role('admin', undefined, ['staff']),
      ],
    });

    expect(deniedHumanRoles(domain, ['member'])).toEqual([]);
  });

  it('implies があっても、閉包が覆いきれないロールは拒否されたまま残る', () => {
    // entry_owner implies member だが、anonymous は誰の implies にも含まれない。
    const domain = specModel({
      roles: [
        role('anonymous'),
        role('member'),
        role('entry_owner', undefined, ['member']),
      ],
    });

    expect(deniedHumanRoles(domain, ['member'])).toEqual(['anonymous']);
  });

  it('system だけ許可されていれば、全人間ロールが拒否される(system は人間ロールではないので、implies があっても人間側には効かない)', () => {
    const domain = specModel({
      roles: [role('anonymous'), role('member'), role('staff', undefined, ['member']), role('system')],
    });

    expect(deniedHumanRoles(domain, ['system'])).toEqual(['anonymous', 'member', 'staff']);
  });

  it('anonymous も人間ロールとして数える(特別扱いしない)', () => {
    const domain = specModel({ roles: [role('anonymous'), role('member')] });

    expect(deniedHumanRoles(domain, ['member'])).toEqual(['anonymous']);
  });

  it('許可ロール側を implies で下流に広げない(member を許しても、member が implies するロールまでは広げない)', () => {
    // 逆方向は閉包しない: 「member を許す」は member を必ず持つ全員(= member を implies する側)を
    // 許すのであって、member 自身が implies するロール固有の権限まで広げる宣言ではない。
    const domain = specModel({
      roles: [role('member'), role('account_owner', 'member.id == actor.id', ['member'])],
    });

    expect(deniedHumanRoles(domain, ['account_owner'])).toEqual(['member']);
  });
});

describe('invariantsInvolving', () => {
  it('involves にそのエンティティを挙げる不変条件の ID を返す(集約をまたいで横断)', () => {
    const domain = specModel({
      roles: [role('member')],
      aggregates: [
        aggregate({
          name: 'entry',
          invariants: invariantSpec([
            invariant({ id: 'INV-ENTRY-008', entities: ['entry', 'piece'], involves: ['piece', 'entry_participant'] }),
          ]),
        }),
      ],
    });

    expect(invariantsInvolving(domain, 'piece')).toEqual(['INV-ENTRY-008']);
    expect(invariantsInvolving(domain, 'entry_participant')).toEqual(['INV-ENTRY-008']);
  });

  it('境界: involves を書いていなければ何も返さない(entities に載っているだけでは足りない)', () => {
    const domain = specModel({
      roles: [role('member')],
      aggregates: [
        aggregate({
          name: 'entry',
          invariants: invariantSpec([invariant({ id: 'INV-ENTRY-008', entities: ['entry', 'piece'] })]),
        }),
      ],
    });

    expect(invariantsInvolving(domain, 'piece')).toEqual([]);
  });

  it('境界: involves に挙がっていないエンティティには配らない', () => {
    const domain = specModel({
      roles: [role('member')],
      aggregates: [
        aggregate({
          name: 'entry',
          invariants: invariantSpec([
            invariant({ id: 'INV-ENTRY-008', entities: ['entry', 'piece'], involves: ['piece'] }),
          ]),
        }),
      ],
    });

    expect(invariantsInvolving(domain, 'workshop')).toEqual([]);
  });
});

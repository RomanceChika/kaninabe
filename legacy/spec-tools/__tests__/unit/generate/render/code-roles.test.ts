/**
 * グローバルロール対応表(app/src/domain/generated/roles.ts)の生成器のテスト。
 *
 * 対象の要求: 「role_spec の kind 宣言から GLOBAL_ROLES(anonymous/authenticated/system)と
 * ROLE_IDS(全ロールの恒等表)を作る。仕組み側のコードはロール名を文字列リテラルとして
 * 持たず、この生成物を経由する」(dsl-extension-triage.md §軸と語)。
 */

import { describe, expect, it } from 'vitest';
import { globalRolesGenerator } from '../../../../lib/generate/render/code-roles.js';
import { runtimeBindingsGenerator } from '../../../../lib/generate/render/code-runtime-bindings.js';
import type { RoleDef } from '../../../../lib/model/types.js';
import { aggregate, role, roleSpec, specModel } from '../../../helpers/model-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';

function generate(roles: ReturnType<typeof roleSpec>): string {
  const model = specModel([aggregate('entry')], roles);
  const section = globalRolesGenerator.generate(model, GEN_CTX)[0];
  if (section === undefined) throw new Error('セクションが生成されませんでした');
  return section.content;
}

describe('globalRolesGenerator', () => {
  it('ファイル全体モードで app/src/domain/generated/roles.ts を出力する', () => {
    const model = specModel([aggregate('entry')], roleSpec(['anonymous', 'member', 'system']));
    const sections = globalRolesGenerator.generate(model, GEN_CTX);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('app/src/domain/generated/roles.ts');
    expect(sections[0]?.wholeFile).toBe(true);
  });

  it('kind ごとの id を GLOBAL_ROLES に写す(kind: authenticated_default → authenticated キー)', () => {
    const content = generate(roleSpec(['anonymous', 'member', 'system']));

    expect(content).toContain('export const GLOBAL_ROLES = deepFreeze({');
    expect(content).toContain("  anonymous: 'anonymous',");
    expect(content).toContain("  authenticated: 'member',");
    expect(content).toContain("  system: 'system',");
  });

  it('このアプリが別の綴りを選んでも、kind だけを見て正しく写す', () => {
    const content = generate(
      roleSpec([role('guest', undefined, undefined, 'anonymous'), role('registered', undefined, undefined, 'authenticated_default'), role('bot', undefined, undefined, 'system')]),
    );

    expect(content).toContain("  anonymous: 'guest',");
    expect(content).toContain("  authenticated: 'registered',");
    expect(content).toContain("  system: 'bot',");
  });

  it('全ロール ID(文脈依存ロールも含む)を ROLE_IDS の恒等表にする', () => {
    const content = generate(
      roleSpec([
        'anonymous',
        'member',
        'system',
        role('organizer', 'workshop.organizer_id == actor.id', ['member']),
      ]),
    );

    expect(content).toContain('export const ROLE_IDS = deepFreeze({');
    expect(content).toContain("  organizer: 'organizer',");
  });

  it('label を持つロールだけを ROLE_LABELS に写す(⑯d: forbidden を人の言葉にする材料)', () => {
    const content = generate(
      roleSpec([
        'anonymous',
        'member',
        'system',
        role('organizer', 'workshop.organizer_id == actor.id', ['member'], undefined, '世話役'),
      ]),
    );

    expect(content).toContain('export const ROLE_LABELS = deepFreeze({');
    expect(content).toContain("  organizer: '世話役',");
    // label を宣言していないロール(anonymous 等)は ROLE_LABELS の中にキーを持たない。
    const roleLabelsBlock = content.slice(content.indexOf('export const ROLE_LABELS'));
    expect(roleLabelsBlock).not.toContain('anonymous:');
  });

  it('同じモデルからは同じ出力になる(生成物の決定性 — ADR-0006)', () => {
    const roles = roleSpec(['anonymous', 'member', 'system']);
    expect(generate(roles)).toBe(generate(roles));
  });

  it('行の条件を宣言していなければ AUTHENTICATED_WHEN / ROLE_GATES は出ない(宣言しなければ生成物は変わらない)', () => {
    const content = generate(
      roleSpec(['anonymous', 'member', 'system', role('organizer', 'project.manager_id == actor.id', ['member'])]),
    );

    expect(content).not.toContain('AUTHENTICATED_WHEN');
    expect(content).not.toContain('ROLE_GATES');
    expect(content).not.toContain('RunRowCondition');
  });

  describe('行の条件(ADR-0018)', () => {
    const member: RoleDef = {
      ...role('member', undefined, undefined, 'authenticated_default'),
      claim: 'member.state',
      claimValues: ['active', 'trial'],
    };
    const staff: RoleDef = { ...role('staff', undefined, ['member']), claim: 'member.is_staff' };
    const roles = roleSpec([
      role('anonymous', undefined, undefined, 'anonymous'),
      member,
      staff,
      role('system', undefined, undefined, 'system'),
      role('organizer', 'project.manager_id == actor.id', ['member']),
    ]);

    it('既定のログインロールの条件を AUTHENTICATED_WHEN に出す(値の集合は宣言順)', () => {
      const content = generate(roles);

      expect(content).toContain("import type { RunRowCondition } from '@kaninabe/runtime/plan';");
      expect(content).toContain(
        "export const AUTHENTICATED_WHEN: RunRowCondition = deepFreeze({\n  field: 'state',\n  values: ['active', 'trial'],\n});",
      );
    });

    it('含意の先の条件を ROLE_GATES に出す(条件を持つロールだけがキー・boolean の条件は values を持たない)', () => {
      const content = generate(roles);

      expect(content).toContain('export const ROLE_GATES: Readonly<Record<string, readonly RunRowCondition[]>> = deepFreeze({');
      expect(content).toContain("  staff: [\n    {\n      field: 'state',\n      values: ['active', 'trial'],\n    },\n  ],");
      expect(content).toContain("  organizer: [\n    {\n      field: 'state',");
      const gates = content.slice(content.indexOf('export const ROLE_GATES'));
      expect(gates).not.toContain("  member: [");
    });

    it('ログインロールが条件を持たず boolean の claim だけでも、ROLE_GATES には出ない(含意の先に条件が無い)', () => {
      const content = generate(roleSpec(['anonymous', 'member', 'system', staff]));

      expect(content).not.toContain('ROLE_GATES');
    });

    it('束は条件があるときだけ authenticatedWhen / gates を渡す', () => {
      const bind = (spec: ReturnType<typeof roleSpec>): string => {
        const section = runtimeBindingsGenerator.generate(specModel([aggregate('entry')], spec), GEN_CTX)[0];
        if (section === undefined) throw new Error('セクションが生成されませんでした');
        return section.content;
      };

      const conditioned = bind(roles);
      expect(conditioned).toContain("import { GLOBAL_ROLES, ROLE_IMPLICATIONS, AUTHENTICATED_WHEN, ROLE_GATES } from './roles';");
      expect(conditioned).toContain('    authenticatedWhen: AUTHENTICATED_WHEN,\n    gates: ROLE_GATES,\n  },');
      expect(conditioned).toContain('export const runtimeBindings: RuntimeBindings = deepFreeze({\n');
      expect(conditioned).toContain('function deepFreeze<T>(value: T): T {');

      const plain = bind(roleSpec(['anonymous', 'member', 'system', role('organizer', 'project.manager_id == actor.id', ['member'])]));
      expect(plain).toContain("import { GLOBAL_ROLES, ROLE_IMPLICATIONS } from './roles';");
      expect(plain).not.toContain('authenticatedWhen');
      expect(plain).not.toContain('gates:');
    });
  });
});

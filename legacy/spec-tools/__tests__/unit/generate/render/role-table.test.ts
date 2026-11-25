import { describe, expect, it } from 'vitest';

import { roleTableGenerator } from '../../../../lib/generate/render/role-table.js';
import type { RoleDef } from '../../../../lib/model/types.js';
import { loc, role, roleSpec, specModel } from '../../../helpers/model-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';

/** role() ヘルパーは label を持たないため、必要な分だけここで組み立てる。 */
function roleWithLabel(id: string, label: string, binding?: string): RoleDef {
  const base = { id, label, location: loc('docs/specs/domain/roles.md', `roles.${id}`) };
  return binding === undefined ? base : { ...base, binding };
}

/** implies(ロール階層)を持つロールを組み立てる。 */
function roleWithImplies(id: string, implies: readonly string[]): RoleDef {
  return { id, implies, location: loc('docs/specs/domain/roles.md', `roles.${id}`) };
}

describe('roleTableGenerator', () => {
  it('グローバルロールと文脈依存ロールを 1 表にまとめ、binding をコード表記する(label 無しは「—」)', () => {
    const model = specModel(
      [],
      roleSpec(['anonymous', 'member', role('performer', 'entry.performer_id == actor.id')]),
    );

    const sections = roleTableGenerator.generate(model, GEN_CTX);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.marker).toBe('role-table');
    expect(sections[0]?.file).toBe('docs/specs/domain/roles.md');

    const content = sections[0]?.content ?? '';
    const lines = content.split('\n');
    // ヘッダー + 区切り + 3 行
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('| ロールID | 名前 | 種別 | binding | 含意するロール |');
    expect(content).toContain('| anonymous | — | グローバル | — | — |');
    expect(content).toContain('| member | — | グローバル | — | — |');
    expect(content).toContain('| performer | — | 文脈依存 | `entry.performer_id == actor.id` | — |');
  });

  it('implies を「含意するロール」列に並べる', () => {
    const model = specModel([], roleSpec(['member', roleWithImplies('organizer', ['member'])]));

    const content = roleTableGenerator.generate(model, GEN_CTX)[0]?.content ?? '';

    expect(content).toContain('| organizer | — | グローバル | — | member |');
  });

  it('label を持つロールは「名前」列に日本語名を表示する', () => {
    const model = specModel(
      [],
      roleSpec([
        roleWithLabel('member', 'メンバー'),
        roleWithLabel('performer', '発表者', 'entry.performer_id == actor.id'),
      ]),
    );

    const sections = roleTableGenerator.generate(model, GEN_CTX);

    const content = sections[0]?.content ?? '';
    expect(content).toContain('| member | メンバー | グローバル | — | — |');
    expect(content).toContain(
      '| performer | 発表者 | 文脈依存 | `entry.performer_id == actor.id` | — |',
    );
  });

  it('ロールが 1 つも無ければヘッダーだけの表になる', () => {
    const model = specModel([], roleSpec([]));

    const sections = roleTableGenerator.generate(model, GEN_CTX);

    expect(sections).toHaveLength(1);
    const lines = (sections[0]?.content ?? '').split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('| ロールID | 名前 | 種別 | binding | 含意するロール |');
    expect(lines[1]).toBe('| --- | --- | --- | --- | --- |');
  });
});

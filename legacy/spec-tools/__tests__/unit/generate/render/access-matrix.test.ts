import { describe, expect, it } from 'vitest';

import { accessMatrixGenerator } from '../../../../lib/generate/render/access-matrix.js';
import type { FieldHiddenRule, RoleDef } from '../../../../lib/model/types.js';
import {
  accessSpec,
  aggregate,
  create,
  del,
  loc,
  read,
  roleSpec,
  specModel,
  write,
} from '../../../helpers/model-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';

/** fieldsHidden 用のヘルパー(model-builder.ts に無いためここで組み立てる)。 */
function hidden(field: string, from: readonly string[]): FieldHiddenRule {
  return { field, from, location: loc('docs/specs/domain/entry/access.md', `fields_hidden.${field}`) };
}

/** role() ヘルパーは label を持たないため、必要な分だけここで組み立てる。 */
function roleWithLabel(id: string, label: string): RoleDef {
  return { id, label, location: loc('docs/specs/domain/roles.md', `roles.${id}`) };
}

describe('accessMatrixGenerator', () => {
  it('reads / writes / fields_hidden をすべて持つ場合、3 つの見出しと表を生成する', () => {
    const access = accessSpec('entry', {
      reads: [read('performer', 'own'), read('organizer', 'context(workshop)'), read('member', 'none')],
      writes: [write('performer', ['title', 'composer', 'note'], 'state == draft')],
      fieldsHidden: [hidden('note', ['member'])],
    });
    const model = specModel([aggregate('entry', { access })]);

    const sections = accessMatrixGenerator.generate(model, GEN_CTX);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.marker).toBe('access-matrix');
    expect(sections[0]?.file).toBe('docs/specs/domain/entry/access.md');

    const content = sections[0]?.content ?? '';
    expect(content).toContain('### 読み取り');
    expect(content).toContain('| performer | own |');
    expect(content).toContain('| organizer | context(workshop) |');
    expect(content).toContain('| member | none |');

    expect(content).toContain('### 編集');
    expect(content).toContain('| performer | title, composer, note | `state == draft` |');

    expect(content).toContain('### 隠しフィールド');
    expect(content).toContain('| note | member |');
  });

  it('writes と fields_hidden が無ければ読み取り表だけを生成する(when 省略時は「—」)', () => {
    const access = accessSpec('member', {
      reads: [read('member', 'all')],
      writes: [write('member', ['display_name'])],
    });
    const model = specModel([aggregate('member', { access })]);

    const sections = accessMatrixGenerator.generate(model, GEN_CTX);
    const content = sections[0]?.content ?? '';

    expect(content).toContain('### 読み取り');
    expect(content).toContain('| member | all |');
    expect(content).toContain('### 編集');
    expect(content).toContain('| member | display_name | — |');
    expect(content).not.toContain('### 隠しフィールド');
  });

  it('creates があれば「### 作成」表を読み取りと編集の間に生成する(when 省略時は「—」)', () => {
    const access = accessSpec('entry', {
      reads: [read('member', 'none')],
      creates: [create('member', 'workshop.state == accepting'), create('system')],
      writes: [write('performer', ['title'], 'state == draft')],
    });
    const model = specModel([aggregate('entry', { access })]);

    const content = accessMatrixGenerator.generate(model, GEN_CTX)[0]?.content ?? '';

    expect(content).toContain('### 作成');
    expect(content).toContain('| member | `workshop.state == accepting` |');
    expect(content).toContain('| system | — |');
    expect(content.indexOf('### 読み取り')).toBeLessThan(content.indexOf('### 作成'));
    expect(content.indexOf('### 作成')).toBeLessThan(content.indexOf('### 編集'));
  });

  it('deletes があれば「### 削除」表を編集の後に生成する(when 省略時は「—」)', () => {
    const access = accessSpec('entry', {
      reads: [read('member', 'none')],
      writes: [write('performer', ['title'], 'state == draft')],
      deletes: [del('performer', 'state == draft'), del('system')],
    });
    const model = specModel([aggregate('entry', { access })]);

    const content = accessMatrixGenerator.generate(model, GEN_CTX)[0]?.content ?? '';

    expect(content).toContain('### 削除');
    expect(content).toContain('| performer | `state == draft` |');
    expect(content).toContain('| system | — |');
    expect(content.indexOf('### 編集')).toBeLessThan(content.indexOf('### 削除'));
  });

  it('deletes が無ければ削除表を出さない', () => {
    const access = accessSpec('member', { reads: [read('member', 'all')] });
    const model = specModel([aggregate('member', { access })]);

    const content = accessMatrixGenerator.generate(model, GEN_CTX)[0]?.content ?? '';

    expect(content).not.toContain('### 削除');
  });

  it('creates が無ければ作成表を出さない', () => {
    const access = accessSpec('member', { reads: [read('member', 'all')] });
    const model = specModel([aggregate('member', { access })]);

    const content = accessMatrixGenerator.generate(model, GEN_CTX)[0]?.content ?? '';

    expect(content).not.toContain('### 作成');
  });

  it('編集規則の effects を「副作用」列に並べる。無ければ「—」', () => {
    const access = accessSpec('member', {
      reads: [read('member', 'all')],
      writes: [
        write('account_owner', ['display_name'], 'state == active', ['refresh_session_profile']),
        write('staff', ['is_staff']),
      ],
    });
    const model = specModel([aggregate('member', { access })]);

    const content = accessMatrixGenerator.generate(model, GEN_CTX)[0]?.content ?? '';

    expect(content).toContain('| ロール | 編集可能フィールド | 条件 | 副作用 |');
    expect(content).toContain(
      '| account_owner | display_name | `state == active` | refresh_session_profile |',
    );
    expect(content).toContain('| staff | is_staff | — | — |');
  });

  it('access.md を持たない集約はスキップする', () => {
    const model = specModel([aggregate('entry', {})]);

    expect(accessMatrixGenerator.generate(model, GEN_CTX)).toEqual([]);
  });

  it('roles.md で label を持つロールは「id(label)」で表示する(読み取り・編集の両方)', () => {
    const access = accessSpec('entry', {
      reads: [read('performer', 'own')],
      writes: [write('performer', ['title'], 'state == draft')],
    });
    const roles = roleSpec([roleWithLabel('performer', '発表者')]);
    const model = specModel([aggregate('entry', { access })], roles);

    const content = accessMatrixGenerator.generate(model, GEN_CTX)[0]?.content ?? '';

    expect(content).toContain('| performer(発表者) | own |');
    expect(content).toContain('| performer(発表者) | title | `state == draft` |');
  });

  it('roles.md にロールが定義されていても label が無ければ ID のみ表示する', () => {
    const access = accessSpec('member', { reads: [read('member', 'all')] });
    const roles = roleSpec(['member']);
    const model = specModel([aggregate('member', { access })], roles);

    const content = accessMatrixGenerator.generate(model, GEN_CTX)[0]?.content ?? '';

    expect(content).toContain('| member | all |');
    expect(content).not.toContain('member(');
  });
});

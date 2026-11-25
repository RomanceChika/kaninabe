/**
 * V25(写しの集約は写像 = システム以外で書かれない)のテスト。
 *
 * 写しの表への delete は破壊的な書き込みに数えない。その免除は、写しの行を写像の遷移だけが作り・消すときにしか成り立たない。
 */

import { describe, expect, it } from 'vitest';
import { mirrorAccessVerifier } from '../../../../lib/verify/verifiers/v25-mirror-access.js';
import type { AccessSpec } from '../../../../lib/model/types.js';
import { accessSpec, aggregate, create, del, entitySpec, role, roleSpec, specModel, write } from '../../../helpers/model-builder.js';
import { stubContext } from '../../../helpers/model-builder-v8plus.js';

const ROLES = roleSpec([role('member', undefined, undefined, 'authenticated_default'), role('staff'), role('system', undefined, undefined, 'system')]);

/** 写し(または写しでない)集約 1 つ。 */
function model(access: AccessSpec, mirror = true, roles = ROLES) {
  const entity = { ...entitySpec('public_note', { fields: [] }), ...(mirror ? { mirror: true as const } : {}) };
  return specModel([aggregate('public_note', { entity, access })], roles);
}

function messages(access: AccessSpec, mirror = true, roles = ROLES): readonly string[] {
  return mirrorAccessVerifier.verify(model(access, mirror, roles), stubContext().ctx).map((finding) => finding.message);
}

describe('V25 写しの集約の書き込み', () => {
  it('creates / deletes / writes が system の規則だけなら指摘は無い', () => {
    expect(messages(accessSpec('public_note', { creates: [create('system')], deletes: [del('system')] }))).toEqual([]);
  });

  it('system 以外の規則は名指しで error(人が作れる・消せる・書き換えられる行は写しではない)', () => {
    const result = messages(accessSpec('public_note', { creates: [create('system'), create('staff')], writes: [write('member', ['body'])], deletes: [del('staff')] }));
    expect(result).toEqual([
      expect.stringContaining('creates にシステム(system)以外の規則 by: staff'),
      expect.stringContaining('writes にシステム(system)以外の規則 by: member'),
      expect.stringContaining('deletes にシステム(system)以外の規則 by: staff'),
    ]);
  });

  it('システムのロールが無い role_spec では、どの規則も写像の書き込みと認めない', () => {
    const noSystem = roleSpec([role('member', undefined, undefined, 'authenticated_default')]);
    expect(messages(accessSpec('public_note', { creates: [create('system')] }), true, noSystem)).toEqual([
      expect.stringContaining('システムのロール(kind: system)が無い'),
    ]);
  });

  it('写しでない集約は見ない', () => {
    expect(messages(accessSpec('public_note', { creates: [create('staff')] }), false)).toEqual([]);
  });
});

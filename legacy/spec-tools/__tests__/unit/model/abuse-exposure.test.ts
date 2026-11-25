/**
 * 濫用の口の導出(未ログインに開いた作成・有料の口)。R5 が見る対象と同じ導出であること、
 * 何も無ければ空であることを表で固定する。
 */

import { describe, expect, it } from 'vitest';
import { abuseExposureOf, hasAbuseExposure, NO_ABUSE_EXPOSURE } from '../../../lib/model/external/abuse-exposure.js';
import { accessSpec, aggregate, create, entitySpec, field, role, roleSpec, specModel } from '../../helpers/model-builder.js';
import { externalCatalog, integration } from '../../helpers/external-builder.js';

const FIELDS = [field('id', { kind: 'uuid' }, { auto: true }), field('created_at', { kind: 'datetime' }, { auto: true })];

/** 1 集約のモデル(既定のロールは anonymous / member / system)。 */
function modelOf(by: readonly string[], roles?: ReturnType<typeof roleSpec>) {
  const specs = aggregate('inquiry', {
    entity: entitySpec('inquiry', { fields: FIELDS }),
    access: accessSpec('inquiry', { creates: by.map((who) => create(who)), writes: [], deletes: [] }),
  });
  return roles === undefined ? specModel([specs]) : specModel([specs], roles);
}

describe('abuseExposureOf: 未ログインに開いた作成', () => {
  const CASES: readonly { readonly title: string; readonly by: readonly string[]; readonly expected: readonly string[] }[] = [
    { title: '未ログインの作成がある', by: ['anonymous'], expected: ['inquiry'] },
    { title: '未ログインと member の両方があっても集約は 1 度', by: ['anonymous', 'member'], expected: ['inquiry'] },
    { title: 'member / system だけなら無い', by: ['member', 'system'], expected: [] },
    { title: '作成の規則が無ければ無い', by: [], expected: [] },
  ];
  for (const { title, by, expected } of CASES) {
    it(title, () => {
      expect(abuseExposureOf(modelOf(by), undefined).anonymousCreates).toEqual(expected);
    });
  }

  it('未ログインのロールが無い仕様では、作成があっても無い', () => {
    const roles = roleSpec([role('member'), role('system')]);
    expect(abuseExposureOf(modelOf(['member'], roles), undefined).anonymousCreates).toEqual([]);
  });
});

describe('abuseExposureOf: 有料の口', () => {
  const model = modelOf([]);
  const CASES: readonly { readonly title: string; readonly opts: Parameters<typeof integration>[1]; readonly expected: readonly string[] }[] = [
    { title: 'spend: paid かつ endpoints がある送信の連携', opts: { spend: 'paid', endpoints: ['/api/ai/x'] }, expected: ['chat'] },
    { title: 'spend があっても endpoints が無ければ無い(ブラウザから叩けない)', opts: { spend: 'paid' }, expected: [] },
    { title: 'endpoints があっても spend が無ければ無い(有料ではない)', opts: { endpoints: ['/api/ai/x'] }, expected: [] },
    { title: '受信の連携は有料の口ではない', opts: { direction: 'inbound', spend: 'paid' }, expected: [] },
  ];
  for (const { title, opts, expected } of CASES) {
    it(title, () => {
      expect(abuseExposureOf(model, externalCatalog([integration('chat', opts)])).paidEndpoints).toEqual(expected);
    });
  }

  it('外部連携が読めていなければ有料の口は無いものとして数える', () => {
    expect(abuseExposureOf(model, undefined).paidEndpoints).toEqual([]);
  });
});

describe('hasAbuseExposure', () => {
  it('どちらかがあれば true・どちらも無ければ false', () => {
    expect(hasAbuseExposure(NO_ABUSE_EXPOSURE)).toBe(false);
    expect(hasAbuseExposure({ anonymousCreates: ['a'], paidEndpoints: [] })).toBe(true);
    expect(hasAbuseExposure({ anonymousCreates: [], paidEndpoints: ['c'] })).toBe(true);
  });
});

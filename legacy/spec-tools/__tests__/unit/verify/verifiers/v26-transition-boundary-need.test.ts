/**
 * V26 の遷移の側で、ロールごとに何を求めるか(`boundaryNeed`)の表(点検 5 回目 A5-2)。
 *
 * binding のロールも、編集(`writes` の `when`)と同じく guard で境界を結ぶことを求める(以前は binding を丸ごと外していた。
 * 人の側の境界の属性が変わる製品で、異動した起案者が元の部署の文書を遷移させ続けられた)。システム起点・未定義のロールは外し、
 * 未ログインは warning(`actorless`)のまま。
 */

import { describe, expect, it } from 'vitest';
import { boundaryNeed } from '../../../../lib/verify/verifiers/v26-transition-boundary.js';
import { role } from '../../../helpers/model-builder-v8plus.js';

describe('boundaryNeed', () => {
  it.each([
    ['既定のログインロール → 結ぶ', role('member', undefined, undefined, 'authenticated_default'), 'bind'],
    ['claim のロール(既定のログインロールの派生)→ 結ぶ', role('company_admin', undefined, undefined, 'authenticated_default'), 'bind'],
    ['種別の無いロール → 結ぶ', role('reviewer'), 'bind'],
    ['binding のロール → 結ぶ(A5-2。編集の when と揃える)', role('document_author', 'document.author_id == actor.id'), 'bind'],
    ['未ログイン → 名指すだけ(warning)', role('anonymous', undefined, undefined, 'anonymous'), 'actorless'],
    ['システム起点 → 見ない', role('system', undefined, undefined, 'system'), 'none'],
    ['未定義のロール → 見ない', undefined, 'none'],
  ] as const)('%s', (_title, target, expected) => {
    expect(boundaryNeed(target, 'anonymous')).toBe(expected);
  });

  it('未ログインの種別でも、台帳の未ログインのロールでなければ見ない(境界)', () => {
    expect(boundaryNeed(role('guest', undefined, undefined, 'anonymous'), 'anonymous')).toBe('none');
  });
});

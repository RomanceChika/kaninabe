/**
 * screen_spec ローダーのうち `platform_ops`(画面の第 3 の露出口)と README の免除 `unexposed_platform_ops` の読み取りのテスト。
 *
 * 画面側の宣言: 画面と重ね表示の `platform_ops`・部品 `kind: platform_read` / `platform_actions`・`row_actions`・
 * `platform_op.{id}.success` の遷移(自由語彙でないドット付きのきっかけとして読み、実在は S20 が見る)。
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadScreenSpecModel } from '../../../../lib/model/screen/loader.js';
import { declaredPlatformOpRefs } from '../../../../lib/model/screen/declared-actions.js';
import { TEST_LAYOUT } from '../../../helpers/platform.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

const FIXTURES = path.resolve(import.meta.dirname, '../../../fixtures');
const REPO_ROOT = path.resolve(FIXTURES, '..');

function load() {
  return loadScreenSpecModel(path.join(FIXTURES, 'screens-platform-ops'), { repoRoot: REPO_ROOT, roots: TEST_ROOTS, layout: TEST_LAYOUT });
}

describe('loadScreenSpecModel の platform_ops', () => {
  it('画面の platform_ops・重ね表示の platform_ops・部品の op / ops / row_actions・遷移を読む(違反なし)', () => {
    const { model, findings } = load();
    const screen = model.screens.find((candidate) => candidate.name === 'sessions');

    expect(findings).toEqual([]);
    expect(screen?.platformOps.map((ref) => ref.id)).toEqual(['session.list_mine', 'session.end_mine', 'session.end_others']);
    expect(screen?.overlays[0]?.platformOps.map((ref) => ref.id)).toEqual(['session.end_others']);
    expect(screen?.navigations.map((navigation) => navigation.on)).toEqual(['platform_op.session.end_mine.success']);
    const components = screen?.layout.slots.flatMap((slot) => slot.components) ?? [];
    expect(components[0]).toMatchObject({ name: 'session_table', kind: 'platform_read', platformOpRef: { id: 'session.list_mine' } });
    expect(components[0]?.showRefs?.map((ref) => ref.id)).toEqual(['created_at', 'user_agent']);
    expect(components[0]?.rowActionRefs?.map((ref) => ref.id)).toEqual(['session.end_mine']);
    expect(components[1]).toMatchObject({ name: 'end_others_bar', kind: 'platform_actions' });
    expect(components[1]?.platformOpRefs?.map((ref) => ref.id)).toEqual(['session.end_others']);
  });

  it('declaredPlatformOpRefs は画面 → 重ね表示の順に、重複を畳まずに返す', () => {
    const screen = load().model.screens.find((candidate) => candidate.name === 'sessions');

    expect(screen && declaredPlatformOpRefs(screen).map((ref) => ref.id)).toEqual(['session.list_mine', 'session.end_mine', 'session.end_others', 'session.end_others']);
  });

  it('README の unexposed_platform_ops を読む(任意。無ければ空)', () => {
    expect(load().model.unexposedPlatformOps).toEqual([expect.objectContaining({ op: 'session.end_every', reason: '管理画面が未着手のため' })]);
    const none = loadScreenSpecModel(path.join(FIXTURES, 'screens-valid'), { repoRoot: REPO_ROOT, roots: TEST_ROOTS, layout: TEST_LAYOUT });
    expect(none.model.unexposedPlatformOps).toEqual([]);
  });
});

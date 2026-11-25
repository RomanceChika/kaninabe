/**
 * 画面 id → 入場条件(app/src/domain/generated/navigation-visibility.ts)の生成器のテスト。
 *
 * 対象の要求(builder-report-14a.md の設計): 「行き先の画面の入場条件(requires_auth /
 * for が auth_spec の role_gate に含まれるか / precondition)を画面 id 引きの表に写す」。
 * 判断の規則(`requiredGuardsOf`)は H4 と同じものを再利用しているだけで、ここで新しく
 * 決めてはいない。
 */

import { describe, expect, it } from 'vitest';
import { navigationVisibilityGenerator } from '../../../../lib/generate/render/code-navigation-visibility.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import { createGuardServices } from '../../../../lib/guard/services.js';
import { specModel } from '../../../helpers/model-builder.js';
import { screenSpec } from '../../../helpers/screen-builder.js';
import { authGate, authModel } from '../../../helpers/auth-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';
import type { AuthGateDecl } from '../../../../lib/model/auth/types.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** screen_spec と auth_spec を載せた GenerateContext を作る(chrome 展開は使わないので素通し)。 */
function ctxWith(
  screens: readonly ReturnType<typeof screenSpec>[],
  gates: readonly AuthGateDecl[] = [],
): GenerateContext {
  return {
    guards: createGuardServices(),
    roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
    screens: { available: true, screens, chromes: [], unexposed: [], unreachableStates: [], unseenStates: [] },
    auth: authModel({ gates }),
  };
}

/** 生成された本文を返す。 */
function generate(ctx: GenerateContext): string {
  return navigationVisibilityGenerator.generate(specModel([]), ctx)[0]?.content ?? '';
}

describe('画面 id → 入場条件の生成', () => {
  it('screen_spec / auth_spec を読み込めていなければ何も出さない', () => {
    expect(navigationVisibilityGenerator.generate(specModel([]), GEN_CTX)).toEqual([]);
  });

  it('画面が 0 件でも型の付いた空表を出す(閉世界)', () => {
    const content = generate(ctxWith([]));

    expect(content).toContain(
      'export const NAVIGATION_VISIBILITY = deepFreeze({} as const satisfies Readonly<Record<string, NavigationEntryCondition>>);',
    );
  });

  it('requires_auth だけの画面は gate を持たない', () => {
    const content = generate(ctxWith([screenSpec({ name: 'workshop_list', requiresAuth: true })]));

    expect(content).toContain("'screen-workshop-list': {");
    expect(content).toContain('requiresAuth: true,');
    expect(content).not.toContain('gate:');
  });

  it('for が role_gate の role を含む画面には gate.role が付く(ヘッダの運営スタッフ用リンクの根拠)', () => {
    const content = generate(
      ctxWith(
        [screenSpec({ name: 'member_admin', requiresAuth: true, for: ['staff'] })],
        [authGate('staff', { guards: 'role_gate', role: 'staff', onFail: 'not_found' })],
      ),
    );

    expect(content).toContain("'screen-member-admin': {");
    expect(content).toContain('requiresAuth: true,');
    expect(content).toContain("role: 'staff',");
  });

  it('for に role_gate の role を含まない画面には gate が付かない(同じ role_gate 宣言があっても)', () => {
    const content = generate(
      ctxWith(
        [screenSpec({ name: 'workshop_list', requiresAuth: true, for: ['member'] })],
        [authGate('staff', { guards: 'role_gate', role: 'staff', onFail: 'not_found' })],
      ),
    );

    expect(content).toContain("'screen-workshop-list': {");
    expect(content).not.toContain('gate:');
  });
});

import { describe, expect, it } from 'vitest';
import { LAYOUT_MODULE_ROLES, layoutModule, layoutPath } from '../../../../lib/model/product/layout.js';
import { layoutClassify } from '../../../../lib/model/product/layout-classify.js';
import type { LayoutRole } from '../../../../lib/model/product/layout.js';
import { layoutDefinitionProblems } from '../../../../lib/model/product/layout-definition.js';
import { NEXTJS_LAYOUT } from '../../../../lib/targets/nextjs/layout.js';

/**
 * 生成物の本文が import する手書きの接続点の 8 役割(部品化 ③-e1。8 本目はリクエスト前段のセッションの更新)。
 *
 * 製品が手で書き、生成器は import の指定を引くだけ。別名の綴りは配置の値(`SOURCE_MODULE`)1 か所で、指定は置き場(拡張子なし)から導く。
 */

/** 役割 → [キー, 置き場, import の指定]。 */
const EXPECTED: readonly (readonly [LayoutRole, string | undefined, string, string])[] = [
  ['operation-hooks', 'workshop.confirm', 'src/operation/workshop/hooks/confirm.ts', '@/operation/workshop/hooks/confirm'],
  ['computes-module', 'fee_calc', 'src/domain/computes/fee_calc.ts', '@/domain/computes/fee_calc'],
  ['preflight-module', undefined, 'src/domain/preflight.ts', '@/domain/preflight'],
  ['shared-component', 'form-row', 'src/components/form-row.tsx', '@/components/form-row'],
  ['auth-composition', undefined, 'src/composition/auth.ts', '@/composition/auth'],
  ['system-clock', undefined, 'src/infrastructure/system-clock.ts', '@/infrastructure/system-clock'],
  ['db-ports', undefined, 'src/infrastructure/supabase/db-ports.ts', '@/infrastructure/supabase/db-ports'],
  ['session-refresh', undefined, 'src/infrastructure/supabase/proxy-session.ts', '@/infrastructure/supabase/proxy-session'],
];

describe('手書きの接続点の役割', () => {
  it('置き場と import の指定が、従来の生成物の綴りと一致する(拡張子を除いた置き場に別名を接いだ形)', () => {
    for (const [role, key, place, module] of EXPECTED) {
      expect(layoutPath(NEXTJS_LAYOUT, '', role, key), role).toBe(place);
      expect(layoutModule(NEXTJS_LAYOUT, role, key), role).toBe(module);
    }
  });

  it('全部が import される役割(module が必須)で、製品が手で書く・読み手が宣言されている', () => {
    for (const [role] of EXPECTED) {
      const decl = NEXTJS_LAYOUT[role];
      expect(LAYOUT_MODULE_ROLES, role).toContain(role);
      expect(decl?.origin, role).toBe('handwritten');
      expect(decl?.owners, role).toEqual([{ kind: 'product' }]);
      expect(decl?.access.writers, role).toEqual([]);
      expect(decl?.access.readers.length, role).toBeGreaterThan(0);
    }
  });

  it('配置の定義の検査が通る(置き場は別の役割の逆引きに自分の実体と読まれない)', () => {
    expect(layoutDefinitionProblems(NEXTJS_LAYOUT)).toEqual([]);
  });

  it('単発の操作の hooks は、operation-hooks だけが自分の実体と読む(操作の本体 operation-logic の逆引きには読まれない。同じファイルを 2 つの役割が取り合わない)', () => {
    const hooks = layoutPath(NEXTJS_LAYOUT, '', 'operation-hooks', 'workshop.confirm') ?? '';

    expect(layoutClassify(NEXTJS_LAYOUT, '', hooks)).toEqual([{ role: 'operation-hooks', key: 'workshop.confirm' }]);
    expect(layoutClassify(NEXTJS_LAYOUT, '', 'src/operation/workshop/confirm.ts').map((claim) => claim.role)).toEqual(['operation-logic']);
  });
});

/**
 * 置き場の入れ子の検査(`lib/model/product/layout-nesting.ts`)— ある役割の置き場が、別の役割の逆引きの走査の根の下に入り、その役割の逆引きに自分の実体と読まれないこと。
 *
 * 固定するのは ①Next.js の値と架空の別の配置は入れ子で取り違えない(実物で 0 件。操作の生成テストが集約名 `computes` を取って例の表の走査の根の下に入っても、
 * 例の表の逆引きは綴りが違うので自分の実体と読まない) ②取り違えが起きる置き場(綴りまで逆引きに読まれる)は理由つきで止まる
 * ③同じ走査の根を共有する役割(画面の器と HTTP の入口)は設計上の共有で指さない。
 */

import { describe, expect, it } from 'vitest';
import { layoutDefinitionProblems } from '../../../../lib/model/product/layout-definition.js';
import type { ProductLayout, RoleDecl } from '../../../../lib/model/product/layout.js';
import { NEXTJS_LAYOUT } from '../../../../lib/targets/nextjs/layout.js';
import { FOREIGN_BODY_COMPATIBLE_LAYOUT, FOREIGN_LAYOUT } from '../../../helpers/platform.js';

/** 入れ子の違反だけ。 */
function nestingProblems(layout: ProductLayout): string[] {
  return layoutDefinitionProblems(layout).filter((problem) => problem.includes('逆引きに自分の実体として読まれます'));
}

/** 役割の宣言を取り出す(無ければテストの書き間違い)。 */
function decl(layout: ProductLayout, role: string): RoleDecl {
  const found = layout[role];
  if (found === undefined) throw new Error(`${role} が配置に無い`);
  return found;
}

describe('置き場の入れ子', () => {
  it('実物: Next.js の値・架空の別の配置は、入れ子で別の役割の逆引きに取り違えられない', () => {
    for (const layout of [NEXTJS_LAYOUT, FOREIGN_LAYOUT, FOREIGN_BODY_COMPATIBLE_LAYOUT]) expect(nestingProblems(layout)).toEqual([]);
  });

  it('実物の入れ子(操作の生成テストを集約名 computes で置くと、例の表の走査の根の下に入る)は、綴りが違うので取り違えない', () => {
    const operation = decl(NEXTJS_LAYOUT, 'operation-test').place;
    expect(operation?.('computes.send')).toBe('operation/__tests__/generated/computes/send.test.ts');
    expect(nestingProblems(NEXTJS_LAYOUT)).toEqual([]);
  });

  it('反例: 操作の生成テストの綴りが例の表の綴りと同じになる置き場は、集約名 computes のとき例の表の逆引きに自分の実体と読まれて止まる', () => {
    const clashing: ProductLayout = {
      ...NEXTJS_LAYOUT,
      'operation-test': { ...decl(NEXTJS_LAYOUT, 'operation-test'), place: (op) => `operation/__tests__/generated/${op.replace('.', '/')}.examples.test.ts` },
    };

    const problems = nestingProblems(clashing);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('役割 operation-test: キー computes.probe の置き場 src/operation/__tests__/generated/computes/probe.examples.test.ts');
    expect(problems[0]).toContain('役割 compute-example-test の走査の根 src/operation/__tests__/generated/computes の下に入り');
  });

  it('同じ走査の根を共有する役割(画面の器と HTTP の入口)は設計上の共有で、入れ子とは数えない', () => {
    expect(decl(NEXTJS_LAYOUT, 'screen-shell').classify?.dir).toBe(decl(NEXTJS_LAYOUT, 'http-entry').classify?.dir);
    expect(nestingProblems(NEXTJS_LAYOUT)).toEqual([]);
  });
});

/**
 * 全役割への逆引きの口(`lib/model/product/layout-classify.ts` の `layoutClassify`。§20-2 の `classify(path) → (役割, キー)`。部品化 ③-c4b)のテスト。
 *
 * 固定するのは 3 点 —— ①パスを自分の実体と読む役割とキーを全部返す(読まれなければ空・実装の木が無ければ空・製品の根の違い)②**同じパスを 2 つの役割が自分のものと読む配置は、
 * 配置の定義の検査が止める**(逆引きの衝突の反例。同じ走査の根を共有する役割が同じファイルを読む・別の役割の置き場が走査の根の下に入って読まれる)③別の配置(架空の値)でも同じ口が動く。
 */

import { describe, expect, it } from 'vitest';
import { layoutClassify } from '../../../../lib/model/product/layout-classify.js';
import { layoutDefinitionProblems } from '../../../../lib/model/product/layout-definition.js';
import { EMPTY_LAYOUT } from '../../../../lib/model/product/layout.js';
import type { ProductLayout, RoleDecl } from '../../../../lib/model/product/layout.js';
import { NEXTJS_LAYOUT, routeFromPageFile, urlFromRouteFile } from '../../../../lib/targets/nextjs/layout.js';
import { FOREIGN_LAYOUT } from '../../../helpers/platform.js';

/** 役割の宣言を取り出す(無ければテストの書き間違い)。 */
function decl(layout: ProductLayout, role: string): RoleDecl {
  const found = layout[role];
  if (found === undefined) throw new Error(`${role} が配置に無い`);
  return found;
}

/** 逆引きの衝突だけ。 */
function clashes(layout: ProductLayout): string[] {
  return layoutDefinitionProblems(layout).filter((problem) => problem.includes('自分の実体として読まれます'));
}

describe('layoutClassify', () => {
  it('パスを自分の実体と読む役割とキーを返す(製品の根を接いだパスで引く。逆引きを持たない役割・手書きの置き場は読まれない)', () => {
    expect(layoutClassify(NEXTJS_LAYOUT, 'app', 'app/src/operation/entry/submit.ts')).toEqual([{ role: 'operation-logic', key: 'entry.submit' }]);
    expect(layoutClassify(NEXTJS_LAYOUT, 'app', 'app/src/app/workshops/[id]/page.tsx')).toEqual([{ role: 'screen-shell', key: '/workshops/:id' }]);
    expect(layoutClassify(NEXTJS_LAYOUT, 'app', 'app/src/composition/inbound/hook.ts')).toEqual([]);
    expect(layoutClassify(NEXTJS_LAYOUT, 'app', 'README.md')).toEqual([]);
  });

  it('製品の根の違い: 製品の根からの相対(`\'\'`)でも引ける。実装の木が無い(null)・空の配置は、何にも読まれない', () => {
    expect(layoutClassify(NEXTJS_LAYOUT, '', 'src/operation/entry/submit.ts')).toEqual([{ role: 'operation-logic', key: 'entry.submit' }]);
    expect(layoutClassify(NEXTJS_LAYOUT, 'app', 'src/operation/entry/submit.ts')).toEqual([]);
    expect(layoutClassify(NEXTJS_LAYOUT, null, 'app/src/operation/entry/submit.ts')).toEqual([]);
    expect(layoutClassify(EMPTY_LAYOUT, 'app', 'app/src/operation/entry/submit.ts')).toEqual([]);
  });

  it('別の配置(架空の値)でも、その配置の走査の根でパスを引く(Next.js の綴りの木は読まれない)', () => {
    expect(layoutClassify(FOREIGN_LAYOUT, 'app', 'app/server_code/rules/entry__submit.rule.ts')).toEqual([{ role: 'operation-logic', key: 'entry.submit' }]);
    expect(layoutClassify(FOREIGN_LAYOUT, 'app', 'app/server_code/handlers/ops/entry__submit.action.ts')).toEqual([{ role: 'operation-entry', key: 'entry.submit' }]);
    expect(layoutClassify(FOREIGN_LAYOUT, 'app', 'app/src/operation/entry/submit.ts')).toEqual([]);
  });
});

describe('逆引きの衝突(配置の定義の検査)', () => {
  it('実物: Next.js の値・架空の値は、衝突しない', () => {
    expect(clashes(NEXTJS_LAYOUT)).toEqual([]);
    expect(clashes(FOREIGN_LAYOUT)).toEqual([]);
  });

  it('反例: 同じ走査の根を共有する役割(画面の器と HTTP の入口)の逆引きが同じファイルを読む配置は、取り違えとして止まる', () => {
    const shell = decl(NEXTJS_LAYOUT, 'screen-shell');
    const overlapping: ProductLayout = {
      ...NEXTJS_LAYOUT,
      // 画面の器が `route.ts` も自分の実体として読む配置(page と route の両方を読んでしまう)。
      'screen-shell': { ...shell, classify: { dir: 'app', keyOf: (relative) => routeFromPageFile(relative) ?? urlFromRouteFile(relative) } },
    };

    const problems = clashes(overlapping);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('役割 http-entry: キー /sample/path の置き場 src/app/sample/path/route.ts が、役割 screen-shell の走査の根 src/app の下に入り');
  });

  it('反例: 別の役割の逆引きが、保存点の置き場まで自分の実体と読む配置(操作の入口が 3 段も読む)は止まる', () => {
    const entry = decl(NEXTJS_LAYOUT, 'operation-entry');
    const greedy: ProductLayout = { ...NEXTJS_LAYOUT, 'operation-entry': { ...entry, classify: { dir: 'app/_actions', keyOf: (relative) => relative } } };

    const problems = clashes(greedy);

    expect(problems.some((problem) => problem.includes('役割 save-entry:') && problem.includes('役割 operation-entry の走査の根 src/app/_actions の下に入り'))).toBe(true);
    // 1 つの役割の置き場につき、読んだ役割ごとに 1 件で言う(同じ組を重ねない)。
    expect(new Set(problems).size).toBe(problems.length);
  });

  it('語彙に無い役割は数えない(語彙に無いと別の検査が先に止める。逆引きの口も語彙の役割だけを読む)', () => {
    const shell = decl(NEXTJS_LAYOUT, 'screen-shell');
    const problems = layoutDefinitionProblems({ ...NEXTJS_LAYOUT, 'made-up-role': shell });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('made-up-role: コアの語彙');
  });
});

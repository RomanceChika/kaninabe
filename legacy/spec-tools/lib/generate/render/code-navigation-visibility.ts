/**
 * 画面 id → 入場条件の述語データ(`app/src/domain/generated/navigation-visibility.ts`)の生成器。
 *
 * 発端: ヘッダの運営スタッフ用リンク 6 本が全員に見えていた(押すと `requireStaff` で
 * not found になるので安全上の穴ではないが、「画面に出る操作(ボタン)は宣言 ∩ 遷移表から
 * 導いて権限の無い人には出さない」原則が**遷移(リンク)には効いていなかった**)。
 *
 * 「この遷移(リンク)を表示してよいか」の正は、新しい宣言ではなく**行き先の画面の入場条件**
 * (screen_spec の `requires_auth` / `for` / `precondition`)である。この生成物はそれを
 * 画面 id 引きの表へ写すだけで、判断そのものは screen_spec ⇔ auth_spec の既存の対応
 * (意味解析の層 `semantics/required-guards.ts` の `requiredGuardsOf`。auth-spec-writing.md §画面の関門は宣言から導く)を再利用する
 * ——「行き先が掛かる関門」を求める規則を 2 か所に書かない。
 *
 * `screens.ts`(code-screens.ts)が画面**名**引きの配線表(部品・遷移・テスト突合の母集合)
 * であるのに対し、こちらは画面**id**引きの薄い表である。呼び出し側(`NavLink`)は
 * `to="screen-…"` という画面 id だけを受け取るため、id 引きの表を別に持つ
 * (`screens.ts` を id で線形探索させないための分離。screen-spec-writing.md §navigations)。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { AuthFlowSpec } from '../../model/auth/types.js';
import { requiredGuardsOf } from '../../semantics/required-guards.js';
import type { GuardServices } from '../../guard/ast.js';
import type { ScreenSpec, ScreenSpecModel } from '../../model/screen/types.js';
import { preconditionLiteral } from '../../screen/precondition-data.js';
import { DEEP_FREEZE_HELPER, generatedFile, docComment, generatedHeader, renderLiteral } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import type { LiteralValue } from '../../gen-kit/code-emit.js';
import type { ProductRoots } from '../../model/product/types.js';
import { specPath } from '../../model/product/paths.js';
import { RUNTIME_ENGINE_MODULE } from './runtime-modules.js';
import { bodyModulesOf } from '../body-modules.js';

/** 出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'navigation-visibility.ts');


/**
 * screen_spec / auth_spec から画面 id 引きの入場条件表を生成するジェネレーター。
 * 出力は `app/src/domain/generated/navigation-visibility.ts`(ファイル全体)。
 */
export const navigationVisibilityGenerator: DocGenerator = {
  id: 'code-navigation-visibility',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const screens = ctx.screens;
    const flow = ctx.auth?.flow;
    if (screens === undefined || !screens.available) return [];
    if (flow === undefined || flow === null) return [];
    // 部品の置き場は説明文に載るだけ。実装の木を持たない製品(置き場が無い)は指定を載せない。
    const linkModule =
      ctx.roots.app === null ? null : bodyModulesOf(ctx, { what: '入場条件の表の説明文', location: flow.location }).component('nav-link');
    return [{ file: outputFile(ctx.roots), content: renderFile(screens, flow, ctx.guards, ctx.roots, linkModule), wholeFile: true }];
  },
};

/** ファイル全体を組み立てる。 */
function renderFile(model: ScreenSpecModel, flow: AuthFlowSpec, guards: GuardServices, roots: ProductRoots, linkModule: string | null): string {
  const specFiles = [
    ...model.screens.map((screen) => specPath(roots, `frontend/screens/${screen.relPath}`)),
    flow.location.file,
  ];
  return [
    generatedHeader(specFiles),
    '',
    `import type { GuardExprData } from '${RUNTIME_ENGINE_MODULE}';`,
    '',
    docComment([
      '画面 1 枚の入場条件(表示の可否を決めるのに要る部分だけ)。',
      '',
      '`requiredGuardsOf`(auth-spec-writing.md §画面の関門は宣言から導く)と同じ規則で',
      'screen_spec(`requires_auth` / `for`)から導いた結果であり、新しい宣言ではない。',
    ]),
    'export interface NavigationEntryCondition {',
    '  /** セッションが要るか(screen_spec の `requires_auth`)。 */',
    '  readonly requiresAuth: boolean;',
    '  /** ロールの関門(`for` が auth_spec の `gates[].role` を含むとき)。無ければ掛からない。 */',
    '  readonly gate?: { readonly role: string };',
    '  /** 入場条件(`precondition`)の AST。宣言していなければ `undefined`。 */',
    '  readonly precondition?: GuardExprData;',
    '}',
    '',
    // 入場条件の表は遷移の表示の可否の正なので、値ごと深く凍結する(実行時の書き換えで関門の表示を外させない。9 回目 B9-7)。
    ...DEEP_FREEZE_HELPER,
    '',
    docComment([
      '画面 id → 入場条件(閉世界。screen_spec の全画面が 1 件ずつ載る)。',
      '',
      `\`NavLink\`${linkModule === null ? '' : `(\`${linkModule}\`)`}がこの表と券(\`SessionProfile\`)を掛け合わせて`,
      '遷移(リンク)の表示可否を決める——**見た目だけの出し分け**であり、サーバー側の関門',
      '(`requireSession` / `requireStaff`)は別に効いたまま残る(券は最大 1 時間古い)。',
    ]),
    renderTable(model, flow, guards),
    '',
  ].join('\n');
}

/** 画面 id をキーにした表。0 件でも型の付いた空表を出す(利用側の分岐を増やさないため)。 */
function renderTable(model: ScreenSpecModel, flow: AuthFlowSpec, guards: GuardServices): string {
  const suffix = ' as const satisfies Readonly<Record<string, NavigationEntryCondition>>';
  if (model.screens.length === 0) return `export const NAVIGATION_VISIBILITY = ${frozen(`{}${suffix}`)};`;
  const table: Record<string, LiteralValue> = {};
  for (const screen of model.screens) table[screen.id] = toLiteral(screen, flow, guards);
  return `export const NAVIGATION_VISIBILITY = ${frozen(`${renderLiteral(table)}${suffix}`)};`;
}

/** 画面 1 枚の入場条件をリテラル値にする。 */
function toLiteral(screen: ScreenSpec, flow: AuthFlowSpec, guards: GuardServices): LiteralValue {
  const required = requiredGuardsOf(screen, flow.gates);
  const role = flow.gates.find((gate) => gate.guards === 'role_gate')?.role;
  const gate = required.includes('role_gate') && role !== undefined ? { gate: { role } } : {};
  return {
    requiresAuth: screen.requiresAuth,
    ...gate,
    ...preconditionLiteral(screen, guards),
  };
}

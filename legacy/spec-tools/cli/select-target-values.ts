/**
 * CLI の入口が**後段の「値」(プラットフォームの設定と置き場の配置)だけ**を選ぶ共通の口(ハンドブックだけを出す入口 `generate-book.ts` と、
 * 約束事のモデルの CLI `check-formal.ts` が通る。後段そのもの = 検査と生成器を含む登録を選ぶ口は `select-targets.ts`)。
 *
 * ハンドブックの入口の実行時の閉包には、後段の登録の契約(`lib/target-api/`)も後段の生成器・検査(`lib/targets/<後段>/` の
 * 設定の値以外)も入らない(`CLOSURE_BANS`)。後段を選ぶ口 `select-targets.ts` は全後段(ホストの生成器・検査を含む)を読むので、
 * この入口はそれを通さず、設定と配置の値だけをここから受け取る(後段の値のファイル 2 本 = `supabase/platform-profile.ts` と
 * `nextjs/layout.ts` だけを読む。`CLOSURE_BANS`)。**選ぶ名前は `default-targets.ts` が 1 か所で持ち**、`select-targets.ts` の
 * 既定の後段と同じ名前を引く(値が食い違わないことは `select-target-values.test.ts` が固定する)。SQL を書かない入口なので、設定の契約
 * (`platformProfileProblems`。SQL の層にある)は通さない。
 */

import process from 'node:process';
import { EMPTY_LAYOUT } from '../lib/model/product/layout.js';
import type { ProductLayout } from '../lib/model/product/layout.js';
import { layoutSelectionProblems } from '../lib/model/product/layout-definition.js';
import type { ProductRoots } from '../lib/model/product/types.js';
import type { PlatformProfile } from '../lib/model/product/platform-profile.js';
import { NEXTJS_LAYOUT } from '../lib/targets/nextjs/layout.js';
import { SUPABASE_PLATFORM_PROFILE } from '../lib/targets/supabase/platform-profile.js';
import { DEFAULT_TARGET_NAMES } from './default-targets.js';

/** 名前からプラットフォームの設定を引く表。 */
const PLATFORM_PROFILES = { supabase: SUPABASE_PLATFORM_PROFILE } as const;

/** 名前から置き場の配置を引く表。 */
const LAYOUTS = { nextjs: NEXTJS_LAYOUT } as const;

/**
 * このリポジトリが選ぶプラットフォームの設定(`default-targets.ts` が選ぶ名前の後段)。**値を選べるのは組み立ての根(この CLI)だけ**。
 *
 * @returns プラットフォームの設定
 */
export function selectPlatformProfile(): PlatformProfile {
  return PLATFORM_PROFILES[DEFAULT_TARGET_NAMES.platform];
}

/**
 * 後段を選ばずに引く配置の既定(`default-targets.ts` が選ぶ名前のアプリの枠の後段の値)。**実装の木を宣言していない製品は空の配置**
 * (`select-targets.ts` の選択の契約と同じ線: 実装の木が無ければアプリの枠の後段を選ばない)。
 *
 * @param roots 製品が宣言した根(実装の木の有無だけ見る)
 * @returns 置き場の配置(役割 → パス)
 */
export function defaultLayoutFor(roots: Pick<ProductRoots, 'app'>): ProductLayout {
  return roots.app === null ? EMPTY_LAYOUT : LAYOUTS[DEFAULT_TARGET_NAMES.app_frame];
}

/**
 * このリポジトリが選ぶ置き場の配置を、**選択の契約を確かめたうえで**返す(後段を選ぶ口 `select-targets.ts` の `selectTargetSet` が配置に対して見る 3 つのうち 2 つ:
 * 配置そのものの契約 = `layoutDefinitionProblems`・製品の `roots.generated` が配置の `source-root` の中にあること。この入口は後段の登録を通らないので、ここで通す)。
 * **3 つ目 = 配置が持ち主として名指す生成器が、組み立てた生成器の一覧に実在すること**は、この入口では見ない(一覧を作るには生成器の層・後段の登録の契約を読む必要があり、
 * ハンドブックの入口の閉包に入れない = 部分利用の約束)。限界: 配置の持ち主の宣言が宙に浮いても、この入口は緑のままで、全部入りの選択(`select-targets.ts` → `selectTargetSet`)だけが止める。
 * 違反は使い方の誤り(後段の選び間違い)なので、理由を出して終了コード 1 で終える(`select-targets.ts` と同じ。この CLI の口だけが `process.exit` を呼ぶ)。
 * 実装の木を宣言していない製品は配置を持たない(空の配置)ので、検査は要らない。
 *
 * @param command どの CLI の名前か(メッセージの先頭に出す)
 * @param roots 製品が宣言した根(実装の木の有無・生成物の置き場)
 * @param layout 選ぶ配置(既定はこのリポジトリが選ぶ配置を、製品に合わせたもの)
 * @returns 契約を満たす置き場の配置
 */
export function selectLayout(command: string, roots: Pick<ProductRoots, 'app' | 'generated'>, layout: ProductLayout = defaultLayoutFor(roots)): ProductLayout {
  if (roots.app === null) return layout;
  const problems = layoutSelectionProblems(layout, roots);
  if (problems.length === 0) return layout;
  console.error(`${command}: 選んだ置き場の配置が契約を満たしていません:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

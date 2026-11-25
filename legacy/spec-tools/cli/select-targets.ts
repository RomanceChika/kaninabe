/**
 * CLI の入口が**後段(差し替えうる具体のスタック)を選ぶ**共通の口(値を選ぶのは組み立ての根の CLI だけ)。
 *
 * 選んだ後段の一覧は契約(`lib/target-api/contract.ts` の `selectTargetSet`)を満たすことを確かめてから配る(製品が宣言した根も渡す:
 * 実装の木を宣言していればアプリの枠の後段がちょうど 1 つ・宣言していなければ 0・生成物の置き場が配置の `source-root` の中)。契約の違反は
 * 使い方の誤り(後段の選び間違い)なので、理由を出して終了コード 1 で終える(この CLI だけが `process.exit` を呼ぶ)。
 * この口は SQL の層を読まない(ハンドブックだけを出す入口 `generate-book.ts` も通る)。プラットフォームの設定の
 * 契約(`roles` が互いに異なる)の検査は SQL の層にあるので、SQL を書く入口は `select-platform.ts` を通す。
 */

import process from 'node:process';
import { CORE_GENERATORS } from '../lib/compose/all-generators.js';
import { selectTargetSet } from '../lib/target-api/contract.js';
import type { SelectionRoots, Target, TargetSelection } from '../lib/target-api/contract.js';
import { NEXTJS_TARGET } from '../lib/targets/nextjs/target.js';
import { SUPABASE_TARGET } from '../lib/targets/supabase/target.js';
import { VERCEL_TARGET } from '../lib/targets/vercel/target.js';
import { DEFAULT_TARGET_NAMES } from './default-targets.js';

/** コアの生成器の ID(後段の配置が持ち主として名指す生成器の実在を、選択の契約が確かめる材料。選んだ後段の生成器は契約が足す)。 */
const CORE_GENERATOR_IDS: ReadonlySet<string> = new Set(CORE_GENERATORS.map((generator) => generator.id));

/** 名前から後段の値を引く表(選べる後段の全部。名前は `default-targets.ts` が選ぶ)。 */
const TARGETS_BY_NAME = { supabase: SUPABASE_TARGET, vercel: VERCEL_TARGET, nextjs: NEXTJS_TARGET } as const;

/**
 * このリポジトリが選ぶ後段(プラットフォーム = Supabase・ホスト = Vercel・アプリの枠 = Next.js)。**後段を選べるのは組み立ての根(この CLI)だけ**で、
 * どの名前を選ぶかは `default-targets.ts` が 1 か所で持ち(ハンドブックの入口の口と共有)、別のスタックへ差し替える日はそこを書き換える
 * (コアは後段の名前を知らない)。
 */
export const DEFAULT_TARGETS: readonly Target[] = [
  TARGETS_BY_NAME[DEFAULT_TARGET_NAMES.platform],
  TARGETS_BY_NAME[DEFAULT_TARGET_NAMES.host],
  TARGETS_BY_NAME[DEFAULT_TARGET_NAMES.app_frame],
];

/**
 * 製品に合わせた既定の後段。**実装の木(`roots.app`)を宣言していない製品はアプリの枠の後段を選ばない**
 * (選択の契約: 宣言しているなら 1 つ・していないなら 0)。ほかの役割は製品に依らない。
 *
 * @param roots 製品が宣言した根(実装の木の有無だけ見る)
 * @returns その製品が選ぶ後段
 */
export function defaultTargetsFor(roots: Pick<SelectionRoots, 'app'>): readonly Target[] {
  return roots.app === null ? DEFAULT_TARGETS.filter((target) => target.role !== 'app_frame') : DEFAULT_TARGETS;
}

/**
 * 契約を確かめたうえで後段の選択を返す。違反があれば理由を標準エラーへ出して終了する。
 *
 * @param command どの CLI の名前か(メッセージの先頭に出す)
 * @param roots 製品が宣言した根(実装の木の有無・生成物の置き場。選択の契約が見る)
 * @param targets 選ぶ後段(既定はこのリポジトリが選ぶ後段を、製品に合わせたもの)
 * @returns 契約を満たす選択
 */
export function selectTargets(command: string, roots: SelectionRoots, targets: readonly Target[] = defaultTargetsFor(roots)): TargetSelection {
  const result = selectTargetSet(targets, roots, CORE_GENERATOR_IDS);
  if (result.ok) return result.selection;
  console.error(`${command}: 選んだ後段が契約を満たしていません:`);
  for (const problem of result.problems) console.error(`  - ${problem}`);
  process.exit(1);
}

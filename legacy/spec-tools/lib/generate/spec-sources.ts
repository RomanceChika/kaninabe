/**
 * 仕様の木の Markdown の生テキストを読む(標識の引用と置き場の検査の入力)。
 *
 * ハンドブック(docs/book/)が標識(生成ブロック外の手書き本文)を章に引用・集計するため、
 * 仕様の木にある Markdown の生テキストを文脈(`GenerateContext.specSources`)に載せる。
 * 生成器は I/O を直接しない規約のため、ファイルは `lib/io` の小道具(`walkFiles` / `isFile` / `readText`)
 * を通して読む。呼ぶのは CLI と通し実行のハーネスで(`generate-context.ts` 経由の同じ 1 本)、
 * **母集合の定め方はここ 1 本**である(2 か所に持つと、片方だけ標識の置き場の検査から漏れる)。
 *
 * 母集合は判断ポイントの台帳に載るファイルと、台帳に載らないが標識を持つファイル(テーブル仕様・
 * ロール・外から届く surface・ユースケース)の和で、どのブロックにも属さないものは
 * 標識の置き場の検査(`render/book/block-check.ts`)が止める。
 *
 * **読まない置き場を呼び手が渡せる**(`excludedPlaces`)。ハンドブックだけを出す入口は、製品が採っていない種類の置き場を渡す —— 置き場に
 * 有効な仕様が残っていても、その生テキストは標識の集計(章ごと・手引きの「受け入れ」)の材料に混ぜない(採っていない種類は事実として無い)。
 * 全部入りの `generate` は渡さない(母集合は従来のまま)。
 */

import path from 'node:path';
import { isFile, toRelative, walkFiles } from '../io/paths.js';
import { readText } from '../io/read-text.js';
import type { SpecModel } from '../model/types.js';
import { specPath } from '../model/product/paths.js';
import type { ProductRoots } from '../model/product/types.js';
import type { GenerateContext } from '../gen-kit/generator.js';
import { ledgerFiles } from './render/semantic-review-counts.js';

/**
 * ファイルが、置き場の候補のどれかの下(置き場そのものを含む)にあるか。
 *
 * @param file リポジトリルート相対のファイルパス
 * @param places リポジトリルート相対の置き場(ファイルまたはディレクトリ)
 */
export function isUnderPlace(file: string, places: readonly string[]): boolean {
  return places.some((place) => file === place || file.startsWith(`${place}/`));
}

/**
 * 仕様の木の Markdown を全部(リポジトリルート相対 → 生テキスト)読む。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param roots 製品が宣言した根(仕様の木の位置)
 * @param model ドメイン仕様全体
 * @param baseCtx 台帳の母集合を数えるための生成コンテキスト(`specSources` はまだ要らない)
 * @param excludedPlaces 読まない置き場(リポジトリルート相対。ファイルまたはディレクトリ)。下のファイルは台帳の母集合にあっても読まない。既定は空(全部読む)
 */
export function readSpecSources(
  repoRoot: string,
  roots: ProductRoots,
  model: SpecModel,
  baseCtx: GenerateContext,
  excludedPlaces: readonly string[] = [],
): Map<string, string> {
  const tree = walkFiles(path.join(repoRoot, specPath(roots)), (name) => name.endsWith('.md')).map((absolute) =>
    toRelative(repoRoot, absolute),
  );
  const sources = new Map<string, string>();
  for (const file of [...ledgerFiles(model, baseCtx), ...tree]) {
    const absolute = path.join(repoRoot, file);
    if (!sources.has(file) && !isUnderPlace(file, excludedPlaces) && isFile(absolute)) sources.set(file, readText(absolute));
  }
  return sources;
}

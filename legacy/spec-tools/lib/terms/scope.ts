/**
 * 用語の台帳の M8 / M9 が読む範囲の宣言(どの木・どのファイルを読み、何を読まないか)。
 *
 * **範囲を 1 か所で宣言する**のは、範囲が狭いと「M9 が 0 件」が「旧綴りが無い」の意味にならないからである
 * (ブック ①の独立レビューの実測: 範囲外に 1,100 か所の旧綴りが残っていた)。読む範囲は次の 4 種類で、
 * **読まないものは `TERM_OUT_OF_SCOPE` が理由つきで名指す**(黙って外れるものを作らない)。
 *
 *   - Markdown の本文 … 規約・スキル・ブック(全行)/ 仕様の本文(生成ブロックを除く)/ 製品が宣言した木とファイル
 *   - コードのコメントと、日本語を含む文字列リテラル … 検証器・生成器・CLI とそのテスト(テストは題だけ)/
 *     仕組み側パッケージ / アプリの実装
 *   - シェルと YAML の `#` コメント … 製品が宣言した木(git フックや CI の設定など)
 *   - 読まない … `TERM_OUT_OF_SCOPE`
 *
 * 綴りは仕組み自身の住所(`lib/io/paths.ts`)と製品の宣言(`product.md` の `roots` と `term_scan`)から組む(W3)。
 * **開発用リポジトリだけにある置き場**(設計メモ・引き継ぎ文書・案内・フック・CI・歴史の記録)は仕組みが綴りを持たず、
 * 製品が `term_scan` で宣言する。宣言の無い製品(配布の木の製品)ではその分は走査されない。
 */

import {
  FRAMEWORK_LIB_DIR,
  FRAMEWORK_PACKAGES_DIR,
  FRAMEWORK_SPEC_TOOLS_DIR,
  FRAMEWORK_RULES_DIR,
  FRAMEWORK_SKILLS_DIR,
} from '../io/paths.js';
import { specPath } from '../model/product/paths.js';
import type { ProductRoots } from '../model/product/types.js';
import type { TermScanScope } from '../model/terms/types.js';

/** 範囲外の宣言 1 件。 */
export interface TermOutOfScope {
  /** 読まないもの(人が読む名前)。 */
  readonly what: string;
  /** 読まない理由。 */
  readonly reason: string;
}

/**
 * 文字列リテラルを読まないファイル(migration の SQL に出る文言を持つ生成器)。
 *
 * ここの文言を変えると、次の generate が出す SQL が適用済みの migration と食い違う(適用済みは 1 バイトも
 * 動かさない。C23)。綴りを直せるのは、次に出す migration の文言からである。**コメントは読む**。
 */
export const LITERAL_OUT_OF_SCOPE_FILES: readonly string[] = [
  `${FRAMEWORK_LIB_DIR}/messages/messages-api.ts`,
  `${FRAMEWORK_LIB_DIR}/messages/messages-ddl.ts`,
];

/**
 * 読まないものと、その理由。
 *
 * どれも「旧綴りが無い」ではなく**「ここは別の道で守られている / 書き換えない」**である。
 * 生成物の綴りは生成器(コードのコメントと出力文言)と仕様が正で、`generate:check` が鮮度を見る。
 */
export const TERM_OUT_OF_SCOPE: readonly TermOutOfScope[] = [
  {
    what: '生成物(先頭に生成の目印を持つコードと、仕様の本文の生成ブロック)',
    reason: '綴りの正は生成器と仕様にあり、手で直しても次の generate で消える。鮮度は generate:check が見る',
  },
  {
    what: 'ブックの生成物(docs/book/ の、先頭に「全体が生成物である」の宣言を持つ文書)',
    reason: '綴りの正は仕様と生成器にあり、どちらも別に見ている。読むと、仕様の 1 つの違反が生成物の側で 2 件目になり、'
      + '手引きに載って生成物が変わる(generate が 1 回で落ち着かない)。鮮度は generate:check が見る',
  },
  {
    what: '適用済みの migration と supabase の設定',
    reason: '適用済みの SQL は 1 バイトも動かさない(C23)。綴りを直せるのは次に出す migration だけ',
  },
  {
    what: '歴史の記録(製品が term_scan の history で名指したファイルと、末尾が / の木)',
    reason: '当時の言葉のまま残す記録であり、書き換えない。旧綴りを挙げて経緯を説明する側でもある。'
      + '名指しは**ファイルごと**に数える —— 引き継ぎ文書の木ごと外すと、入口として案内している生きた読み物まで範囲から落ちる',
  },
  {
    what: 'migration の SQL に出る文言を持つ生成器の文字列リテラル(lib/messages/messages-api.ts・messages-ddl.ts)',
    reason: '変えると次の generate が出す SQL が適用済みの migration と食い違う(C23)。直せるのは次に出す migration から。コメントは読む',
  },
  {
    what: 'テストのファイルの文字列リテラルのうち、describe / it / test の題以外(入力のフィクスチャと期待値)',
    reason: '旧い綴りを検査するために旧い綴りを本文として渡すテストがあり(M9 自身のテストなど)、それは誤りではない。人が読む題は読む',
  },
  {
    what: '日本語を含まない文字列リテラル(識別子・パス・キー・英語のラベル)',
    reason: '人が読む文ではない。ひらがな・カタカナ・漢字を 1 文字でも含むリテラルは範囲に入る',
  },
  {
    what: '仕様の frontmatter(YAML の値)と台帳そのものの欄',
    reason: '値は宣言であって散文ではない。台帳の avoid は旧綴りを挙げる側である',
  },
];

/**
 * M8 / M9 の走査範囲を組む。
 *
 * @param roots 製品が宣言した根(仕様・ブック・実装の木の位置)と、追加の走査範囲(`termScan`)
 * @returns 読む木とファイル
 */
export function termScanScope(roots: ProductRoots): TermScanScope {
  const { termScan } = roots;
  return {
    // 規約・スキル・ブックは配布物にも居る。製品が宣言した木(設計メモや引き継ぎ文書など)はその後ろに続ける。
    proseTrees: [FRAMEWORK_RULES_DIR, roots.book, FRAMEWORK_SKILLS_DIR, ...termScan.proseTrees],
    proseOutOfScope: termScan.history,
    specTrees: [roots.specs],
    proseFiles: termScan.proseFiles,
    // 仕組みの木は `framework` と `legacy/spec-tools` の 2 本(根を重ねると二重に歩くので、重ならない 2 本にする)。
    codeTrees: [FRAMEWORK_PACKAGES_DIR, FRAMEWORK_SPEC_TOOLS_DIR, ...(roots.app === null ? [] : [roots.app])],
    appRoot: roots.app,
    literalOutOfScope: LITERAL_OUT_OF_SCOPE_FILES,
    hashCommentTrees: termScan.scriptTrees,
    summaryTrees: [specPath(roots, 'domain')],
  };
}

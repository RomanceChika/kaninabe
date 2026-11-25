/**
 * R15 **書式つきの本文として描いている欄が `format: markdown` で宣言されていない**(危ない形の群。規則の正は enforcement-matrix の C32)。
 *
 * 画面が欄の値を Markdown として解いて HTML にするなら、その欄は `format: markdown`(`text`)で宣言する。宣言があれば、生成する画面の部品は
 * 許可リストで無害化する描画の口(`MarkdownView`)だけで描き、`format: markdown` でない欄を書式つきで描く手書きの画面は、この検査が止める
 * (「ふつうの文のつもりの欄」が、ある日 Markdown として描かれ、宣言にも検査にも現れないまま入力が HTML の入口になるのを防ぐ。ASVS V1.3.1・V1.3.5)。
 *
 * 見る形は 2 つである(**構造**。意図の宣言は要らない)。
 *
 * | 止める形 | 直し方 |
 * |---|---|
 * | 描く口(`MarkdownView` の `value` / `renderMarkdown` / `plainTextOf` の第 1 引数)に渡す式が、欄の参照(`識別子(.識別子)*`)でない | 欄の参照を直接渡す(加工した値や呼び出しの結果を渡さない) |
 * | 渡す欄の名前(末尾の識別子を camelCase にした名前)が、どの集約の `format: markdown` の欄とも一致しない | その欄を `format: markdown`(type: text)で宣言する。書式つきで描かないなら、描く口を使わない |
 *
 * 突き合わせは**欄の名前**で行う(別の集約に同じ名前の欄があれば、`format: markdown` を持つ側に一致する —— 名前の衝突は区別できないという下限が残る)。
 * 読むのは欄の宣言と、実装の木の描く口への渡し方だけで、**アプリの語彙は 1 語も持たない**。テストの木は見ない(敵対的な値を渡して描かせる)。
 * 走査(I/O)は実行口が済ませ、ここは純粋なデータだけを見る。純関数であり throw しない。
 */

import { makeFinding, type Finding } from '../../kernel/finding.js';
import { toCamelCase } from '../../gen-kit/code-emit.js';
import type { SpecModel } from '../../model/types.js';
import type { RichTextScan } from '../rich-text-scan.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'R15';

/** テストの置き場とテストファイル(出荷物に載らない)。 */
const TEST_FILE = /(^|\/)__tests__\/|\.(test|spec)\.[cm]?[jt]sx?$/u;

/** 欄の参照(`識別子(.識別子)*`。`?.` も可)。 */
const FIELD_REFERENCE = /^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*$/u;

/** R15 の入力。 */
export interface RichTextInput {
  /** ドメイン仕様全体。 */
  readonly model: SpecModel;
  /** 描く口への渡し方の走査(走査できなかったら `available: false` で見ない)。 */
  readonly richText: RichTextScan;
}

/** `format: markdown` の欄の名前(camelCase)の集合。 */
function markdownFieldNames(model: SpecModel): ReadonlySet<string> {
  const names = new Set<string>();
  for (const specs of model.aggregates.values()) {
    for (const field of specs.entity?.fields ?? []) {
      if (field.format === 'markdown') names.add(toCamelCase(field.name));
    }
  }
  return names;
}

/**
 * R15: 描く口に渡している欄が、どれも `format: markdown` で宣言されているかを見る。
 *
 * @param input 仕様モデルと描く口への渡し方
 * @returns 違反(無ければ空)
 */
export function verifyRichText(input: RichTextInput): Finding[] {
  if (!input.richText.available) return [];
  const declared = markdownFieldNames(input.model);
  const findings: Finding[] = [];
  for (const site of input.richText.sites) {
    if (TEST_FILE.test(site.file)) continue;
    const location = { file: site.file };
    if (!FIELD_REFERENCE.test(site.argument)) {
      findings.push(
        makeFinding(VERIFIER_ID, {
          message: `${site.file} が書式つきの本文の描画(${site.sink})に、欄の参照でない式(${site.argument === '' ? '空' : site.argument})を渡しています`,
          location,
          suggestion:
            '`format: markdown` の欄の参照(例: row.body)をそのまま渡す(加工した値・呼び出しの結果を渡すと、どの欄を書式つきで描いているか宣言と突き合わせられない)',
          counterexample: { file: site.file, sink: site.sink, argument: site.argument },
        }),
      );
      continue;
    }
    const name = site.argument.split(/\??\./u).at(-1) ?? '';
    if (declared.has(name)) continue;
    findings.push(
      makeFinding(VERIFIER_ID, {
        message: `${site.file} が ${name} を書式つきの本文として描いていますが、format: markdown で宣言された欄ではありません`,
        location,
        suggestion:
          'その欄を entity_spec で `type: text` + `format: markdown`(+ max_length)に宣言する。書式つきで描かないなら ' +
          `${site.sink} に渡さず、文字のまま描く(JSX のテキスト)`,
        counterexample: { file: site.file, sink: site.sink, field: name },
      }),
    );
  }
  return findings;
}

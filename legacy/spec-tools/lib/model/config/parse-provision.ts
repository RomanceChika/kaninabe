/**
 * config_spec の `provision`(調達のしかた)を読む。
 *
 * `kind` / `requirement` と違い行ごとの必須ではない —— 省略していれば `vocabulary.provision`
 * の**先頭に宣言された語**になる。既定の語そのもの(例: 「人が値を貼る」)はこのアプリの
 * 選択であり、体系側のコードに特定の語をリテラルで持たない(W1「軸は仕組み、語はアプリ」)。
 * 「先頭が既定」という位置づけの規約だけを体系が持ち、カタログはその規約に合わせて
 * 既定にしたい語を先頭に書く。
 */

import type { SpecReporter } from '../parse-common.js';
import type { YamlReader } from '../yaml-reader.js';
import type { ConfigTermDecl, ConfigVocabularyAxis } from './types.js';
import { knows, reportUnknownTerm } from './vocabulary-lookup.js';

/**
 * 1 行分の `provision` を読む。
 *
 * @param item 行のマッピング
 * @param vocabulary カタログが宣言した語彙(軸ごと)
 * @param reporter 違反の記録先
 * @returns 調達のしかた(語)。読めなければ null(行ごと落とす)
 */
export function parseProvision(
  item: YamlReader,
  vocabulary: Readonly<Record<ConfigVocabularyAxis, readonly ConfigTermDecl[]>>,
  reporter: SpecReporter,
): string | null {
  const value = item.optionalString(
    'provision',
    'provision を vocabulary.provision の語から選ぶ(省略すると vocabulary.provision の先頭の語になる)',
  );
  if (value === undefined) return defaultProvision(item, vocabulary, reporter);
  if (!knows(vocabulary, 'provision', value)) {
    reportUnknownTerm(item.pointer('provision'), 'provision', value, vocabulary, reporter);
    return null;
  }
  return value;
}

/** `provision` を省略した行の既定(`vocabulary.provision` の先頭の語)を返す。 */
function defaultProvision(
  item: YamlReader,
  vocabulary: Readonly<Record<ConfigVocabularyAxis, readonly ConfigTermDecl[]>>,
  reporter: SpecReporter,
): string | null {
  const fallback = vocabulary.provision[0];
  if (fallback === undefined) {
    reporter.error(
      item.pointer('provision'),
      'provision を省略していますが vocabulary.provision が空で既定の語を決められません',
      'vocabulary.provision に既定にしたい語を先頭にして 1 つ以上宣言する',
    );
    return null;
  }
  return fallback.id;
}

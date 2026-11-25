/**
 * 設定カタログの語彙(vocabulary)に対する共通の照会ヘルパー。
 *
 * `parse-config.ts`(単一値の軸・used_by)と `parse-provision.ts`(provision)の両方が
 * 「この軸にこの語は宣言されているか」を同じ形で確かめるため、ここに 1 か所だけ持つ。
 */

import type { SpecReporter } from '../parse-common.js';
import type { ConfigTermDecl, ConfigVocabularyAxis } from './types.js';

/** 軸の語が宣言済みか。 */
export function knows(
  vocabulary: Readonly<Record<ConfigVocabularyAxis, readonly ConfigTermDecl[]>>,
  axis: ConfigVocabularyAxis,
  value: string,
): boolean {
  return vocabulary[axis].some((term) => term.id === value);
}

/** 宣言されていない語の指摘(語彙の側に足すか、宣言済みの語から選ぶか)。 */
export function reportUnknownTerm(
  pointer: string,
  axis: ConfigVocabularyAxis,
  value: string,
  vocabulary: Readonly<Record<ConfigVocabularyAxis, readonly ConfigTermDecl[]>>,
  reporter: SpecReporter,
): void {
  const known = vocabulary[axis].map((term) => term.id);
  reporter.error(
    pointer,
    `${axis} ${value} は vocabulary.${axis} に宣言されていません`,
    `vocabulary.${axis} の語(${known.join(' / ') || '未宣言'})から選ぶか、語彙の側に足す`,
    { [axis]: value },
  );
}

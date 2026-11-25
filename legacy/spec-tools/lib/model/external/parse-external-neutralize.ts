/**
 * external_spec の `sends.neutralize`(送る自由文の無害化の宣言)の読み取り。
 *
 * 読み込みが閉じるのは**形**だけである: `outbound` の行はちょうど 1 通りを宣言する(`neutralize: [語…]` か `neutralize_none: 理由`)・語は語彙の中・
 * `length:N` の N は 1 以上の整数・重複しない・受信の行には書けない。宣言した部品をアダプタが呼んでいるか、送る欄に `none` が書けるかは X7 が見る。
 */

import { NEUTRALIZE_LENGTH_CEILING, PLAIN_NEUTRALIZERS, neutralizerWord, parseNeutralizer, type NeutralizerDecl } from '../../kernel/neutralize.js';
import type { SpecReporter } from '../parse-common.js';
import type { YamlReader } from '../yaml-reader.js';
import type { ExternalDirection, ExternalNeutralizeDecl } from './types.js';

/** 書き方の案内。 */
const SUGGESTION =
  `外へ送る連携は sends に "neutralize: [${PLAIN_NEUTRALIZERS.join(' / ')} / length:{n}]"(送る自由文を通す無害化の部品。n は 1〜${String(NEUTRALIZE_LENGTH_CEILING)} の整数)を書く。` +
  '無害化する自由文を送らない連携だけ、"neutralize_none: 理由" を書く(利用者が書ける欄を送るなら none は書けない)';

/** 語の並びを宣言にする(語彙の外・重複は違反)。 */
function partsOf(sends: YamlReader, words: readonly string[], id: string, reporter: SpecReporter): readonly NeutralizerDecl[] | null {
  const parts: NeutralizerDecl[] = [];
  const seen = new Set<string>();
  for (const word of words) {
    const part = parseNeutralizer(word);
    if (part === null) {
      reporter.error(sends.pointer('neutralize'), `連携 ${id} の sends.neutralize の ${word} は語彙の外です`, SUGGESTION, { integration: id, word });
      return null;
    }
    const spelled = neutralizerWord(part);
    const key = part.kind === 'length' ? 'length' : spelled;
    if (seen.has(key)) {
      reporter.error(sends.pointer('neutralize'), `連携 ${id} の sends.neutralize に ${key} が重複しています`, '同じ種類の部品は 1 つだけ宣言する', { integration: id, word });
      return null;
    }
    seen.add(key);
    parts.push(part);
  }
  return parts;
}

/**
 * `sends` の無害化の宣言を読む。
 *
 * @param sends `sends` のマッピング
 * @param id 連携 ID
 * @param direction 連携の向き(読めなかったら null)
 * @param reporter 違反の記録先
 * @returns 宣言。書かれていなければ undefined。読めなければ `'invalid'`
 */
export function parseNeutralize(
  sends: YamlReader,
  id: string,
  direction: ExternalDirection | null,
  reporter: SpecReporter,
): ExternalNeutralizeDecl | undefined | 'invalid' {
  const hasList = sends.has('neutralize');
  const hasNone = sends.has('neutralize_none');
  if (direction === 'inbound') {
    if (!hasList && !hasNone) return undefined;
    reporter.error(sends.pointer(hasList ? 'neutralize' : 'neutralize_none'), `連携 ${id} は受信の行です。neutralize は外へ送る行にだけ書けます`, SUGGESTION, { integration: id });
    return 'invalid';
  }
  if (hasList && hasNone) {
    reporter.error(sends.pointer('neutralize'), `連携 ${id} の sends は neutralize と neutralize_none を併記しています(無害化するのか、しないのか、宣言から 1 つに決まりません)`, SUGGESTION, { integration: id });
    return 'invalid';
  }
  if (hasNone) {
    const reason = sends.requiredString('neutralize_none', SUGGESTION);
    if (reason === null) return 'invalid';
    if (reason.trim() === '') {
      reporter.error(sends.pointer('neutralize_none'), `連携 ${id} の neutralize_none の理由が空です(理由の無い免除は、宣言しないことと同じです)`, SUGGESTION, { integration: id });
      return 'invalid';
    }
    return { kind: 'none', reason };
  }
  if (!hasList) {
    if (direction === null) return undefined;
    reporter.error(sends.pointer('neutralize'), `連携 ${id} の sends に neutralize がありません(外へ送る自由文の無害化を宣言します)`, SUGGESTION, { integration: id });
    return 'invalid';
  }
  const words = sends.requiredStringList('neutralize', SUGGESTION, false);
  if (words === null) return 'invalid';
  const parts = partsOf(sends, words, id, reporter);
  return parts === null ? 'invalid' : { kind: 'apply', parts };
}

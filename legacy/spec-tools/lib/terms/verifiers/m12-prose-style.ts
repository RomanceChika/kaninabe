/**
 * M12: 人が書く文(仕様の `summary:`)が、文体の規則を守っていること。
 *
 * 設計メモ §7-6 の規則を**文字の側で**見る warning である。**当てるのは人が書く列だけ**で、
 * 機械が出す部分(ラベル行・箇条・表)は見ない —— あちらは語がテンプレートで決まっており、
 * 文章ではないからである(§7-7)。見る規則は 4 つ:
 *
 * - **長い文** … 1 文が 50 字を超える(作動記憶に載る量。切って 2 文にする)
 * - **括弧** … 括弧の補足(文を 2 本同時に読ませる。次の文か行に分ける)
 * - **記号** … 文中の記号接続(`=` `→` `/` `・`。接続は言葉で書く)
 * - **常体** … 常体の文(敬体で書く。敬体と混ざるのも常体のまま書くのも同じ)。だ・である・のだに加え、
 *   **辞書形**(「締める。」「できる。」「使う。」のように、動詞の言い切りで終わる文。「ある。」も常体)を見る。
 *   敬体(です・ます・でした・ました・ません・でしょう・ください)で終わる文は常体ではない
 *
 * 等幅(`` `…` ``)の中は仕様の識別子・式なので数えない。**1 つの summary につき warning 1 件**にまとめる
 * (直すときは 1 つの summary を見直すのであって、問題ごとに直すものではない)。
 * 規則そのものはユニットテストが固定する。語の接地(仕様に無い語・数字・識別子)は M10 が見る。
 */

import { makeFinding, type Finding } from '../../kernel/finding.js';
import type { HumanSentence } from '../../model/terms/types.js';

export const VERIFIER_ID = 'M12';

/** 1 文の長さの上限(これを超えたら切る)。 */
const MAX_SENTENCE_LENGTH = 50;

/** 文中で接続に使わない記号。 */
const CONNECTORS = ['=', '＝', '→', '/', '／', '・'] as const;

/** 常体の文末(である・のだ・だ)。 */
const PLAIN_ENDING = /(?:である|のだ|だ)$/;

/** 辞書形の文末(動詞の言い切り。「る」「う」のほか、う行の仮名で終わるもの)。 */
const DICTIONARY_ENDING = /[うくぐすつぬぶむる]$/;

/** 敬体の文末(辞書形の判定から外す。「ます」「です」は「す」で終わるため)。 */
const POLITE_ENDING = /(?:です|ます|でした|ました|ません|でしょう|ください)$/;

/** 規則の破れの種類。 */
export type StyleIssueKind = 'long' | 'paren' | 'symbol' | 'plain';

/** 破れ 1 件。 */
export interface StyleIssue {
  readonly kind: StyleIssueKind;
  /** 該当の文の頭(人が探せるように 20 字まで)。 */
  readonly sentence: string;
}

/** 破れの種類の日本語。 */
const KIND_WORDS: Readonly<Record<StyleIssueKind, string>> = {
  long: '長い文',
  paren: '括弧',
  symbol: '記号',
  plain: '常体',
};

/** 等幅の中身を空白で潰す(識別子・式の中の括弧や記号を数えないため)。 */
function withoutCode(text: string): string {
  return text.replace(/`[^`]*`/g, (match) => ' '.repeat(match.length));
}

/** 文体の判定の強さ。 */
export interface StyleOptions {
  /**
   * 辞書形(「締める。」「ある。」)も常体として数える。人が書く文(`summary:`)は数える。
   * 機械が出す箇条(短い値・体言止め・言い切り)は数えない(だ・である・のだ だけを見る)。
   */
  readonly dictionaryForm?: boolean;
}

/** 常体の文末か(括弧の補足は除いて見る)。 */
function isPlain(masked: string, options: StyleOptions): boolean {
  const body = masked.replace(/[（(][^）)]*[）)]/g, '').trim();
  if (PLAIN_ENDING.test(body)) return true;
  return options.dictionaryForm === true && !POLITE_ENDING.test(body) && DICTIONARY_ENDING.test(body);
}

/**
 * 1 つの summary の文体の破れを数える(順序は文の並び → 長い・括弧・記号・常体)。
 *
 * @param text summary の文
 * @param options 判定の強さ(既定は だ・である・のだ だけを常体とする)
 * @returns 破れ(守っていれば空)
 */
export function proseStyleIssues(text: string, options: StyleOptions = {}): StyleIssue[] {
  const sentences = text
    .split('。')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const issues: StyleIssue[] = [];
  for (const sentence of sentences) {
    const masked = withoutCode(sentence);
    const head = sentence.slice(0, 20);
    if ([...sentence].length > MAX_SENTENCE_LENGTH) issues.push({ kind: 'long', sentence: head });
    if (/[（(）)]/.test(masked)) issues.push({ kind: 'paren', sentence: head });
    if (CONNECTORS.some((connector) => masked.includes(connector))) issues.push({ kind: 'symbol', sentence: head });
    // 文末は括弧の補足を除いて見る(「…である(戻せる)」の文末は「である」)。
    if (isPlain(masked, options)) issues.push({ kind: 'plain', sentence: head });
  }
  return issues;
}

/** 1 つの summary の warning。 */
function findingFor(item: HumanSentence, issues: readonly StyleIssue[]): Finding {
  const kinds = [...new Set(issues.map((issue) => KIND_WORDS[issue.kind]))];
  return makeFinding(VERIFIER_ID, {
    severity: 'warning',
    message: `${item.file} の ${item.pointer} が文体の規則に合っていません(${kinds.join('・')} ${issues.length} 件)`,
    location: { file: item.file, pointer: item.pointer },
    suggestion:
      '1 文は 50 字以内に切り、括弧の補足は次の文に分け、文中の記号接続(= → / ・)は言葉で書き、敬体(です・ます)で書く' +
      '(設計メモ book-human-face.md §7-6)。識別子・式は等幅(`…`)にすれば数えない',
    counterexample: {
      issues: kinds.join(' / '),
      at: issues.map((issue) => `${KIND_WORDS[issue.kind]}「${issue.sentence}」`).join(', '),
    },
  });
}

/**
 * 人が書く文の文体を検査する。
 *
 * @param sentences 人が書く文(仕様の `summary:` ひとつずつ)
 * @returns M12 の違反(warning。summary 1 つにつき 1 件)
 */
export function verifyProseStyle(sentences: readonly HumanSentence[]): Finding[] {
  return sentences.flatMap((item) => {
    const issues = proseStyleIssues(item.text, { dictionaryForm: true });
    return issues.length === 0 ? [] : [findingFor(item, issues)];
  });
}

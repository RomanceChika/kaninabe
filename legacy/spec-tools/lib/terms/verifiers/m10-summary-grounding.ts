/**
 * M10: 人が書く文(仕様の `summary:`)が、**仕様に書かれた語だけ**で書かれていること。
 *
 * `summary` は仕様の欄だが、文は人が自由に書ける。自由なぶん、仕様に無い事実(新しい業務の判断)が
 * 文から入り込む余地がある —— ブックは仕様の写しなので、文が仕様の外を言ってはならない。
 * 機械に見られるのは語の側だけなので、次の 4 つを warning にする(文体は M12 が見る。ここでは見ない):
 *
 * - **仕様に無い語** … 2 字以上の漢字・カタカナの連なりが、ドメイン仕様の frontmatter の値にも台帳の語にも
 *   無い。連なりは、2 字以上の仕様の語に割れれば通る(「料金確定」は 料金 + 確定)。
 *   送り仮名で割れた語(「華やか」の「華」)は 1 字の連なりになるので見えない —— 見える範囲の検査であって、
 *   仕様の外の語がすべて拾えるわけではない
 * - **数字** … 件数・欄数・本数は生成が入れる(文に書くと仕様を直しても古いまま残る)
 * - **識別子** … 英字の語で台帳の語でないもの(仕様 ID を書かない。読者は持たない)
 * - **等幅** … `…` で書いた語(識別子・パス。読者は持たない)
 *
 * **1 つの summary につき warning 1 件**にまとめる。仕様の語は `summary` 自身を除いて集める
 * (自分で自分の語を接地させない)。
 */

import { makeFinding, type Finding } from '../../kernel/finding.js';
import type { HumanSentence } from '../../model/terms/types.js';

export const VERIFIER_ID = 'M10';

/** 語の接地に使う語彙。 */
export interface SummaryVocabulary {
  /** ドメイン仕様の frontmatter の値(`summary` を除く)をつなげた本文。 */
  readonly specText: string;
  /** 台帳の語(綴りと id)。 */
  readonly ledgerWords: readonly string[];
}

/** 破れの種類。 */
export type GroundingKind = 'unknown' | 'digit' | 'ascii' | 'code';

/** 破れ 1 件。 */
export interface GroundingIssue {
  readonly kind: GroundingKind;
  /** 該当の語。 */
  readonly token: string;
}

/** 破れの種類の日本語。 */
const KIND_WORDS: Readonly<Record<GroundingKind, string>> = {
  unknown: '仕様に無い語',
  digit: '数字',
  ascii: '識別子',
  code: '等幅',
};

/** 日本語の語の連なり(漢字・カタカナ。長音と々を含む)。 */
const WORD_RUN = /[\p{Script=Han}\p{Script=Katakana}ー々]+/gu;

/** 英字の語。 */
const ASCII_WORD = /[A-Za-z][A-Za-z0-9_]*/g;

/** 数字(半角・全角)。 */
const DIGITS = /[0-9０-９]+/g;

/** 等幅の中身(`…`)。 */
const CODE_SPAN = /`([^`]*)`/g;

/** 連なりが、語彙にある 2 字以上の断片に割れるか。 */
function isGrounded(run: string, haystack: string): boolean {
  const chars = [...run];
  const reachable: boolean[] = Array.from({ length: chars.length + 1 }, () => false);
  reachable[0] = true;
  for (let end = 2; end <= chars.length; end += 1) {
    for (let start = 0; start <= end - 2; start += 1) {
      if (reachable[start] === true && haystack.includes(chars.slice(start, end).join(''))) {
        reachable[end] = true;
        break;
      }
    }
  }
  return reachable[chars.length] === true;
}

/**
 * 1 つの summary の接地の破れを数える(順序は 等幅 → 数字 → 識別子 → 仕様に無い語)。
 *
 * @param text summary の文
 * @param vocabulary 仕様の語と台帳の語
 * @returns 破れ(接地していれば空)
 */
export function groundingIssues(text: string, vocabulary: SummaryVocabulary): GroundingIssue[] {
  const issues: GroundingIssue[] = [];
  for (const match of text.matchAll(CODE_SPAN)) issues.push({ kind: 'code', token: match[1] ?? '' });
  const plain = text.replace(CODE_SPAN, ' ');
  for (const match of plain.matchAll(DIGITS)) issues.push({ kind: 'digit', token: match[0] });
  const ledger = new Set(vocabulary.ledgerWords.map((word) => word.toLowerCase()));
  for (const match of plain.matchAll(ASCII_WORD)) {
    if (!ledger.has(match[0].toLowerCase())) issues.push({ kind: 'ascii', token: match[0] });
  }
  const haystack = `${vocabulary.specText}\n${vocabulary.ledgerWords.join('\n')}`;
  for (const match of plain.matchAll(WORD_RUN)) {
    const run = match[0];
    if ([...run].length >= 2 && !isGrounded(run, haystack)) issues.push({ kind: 'unknown', token: run });
  }
  return issues;
}

/** 1 つの summary の warning。 */
function findingFor(item: HumanSentence, issues: readonly GroundingIssue[]): Finding {
  const kinds = [...new Set(issues.map((issue) => KIND_WORDS[issue.kind]))];
  return makeFinding(VERIFIER_ID, {
    severity: 'warning',
    message: `${item.file} の ${item.pointer} に、仕様に無い語か書いてはいけない語があります(${kinds.join('・')} ${issues.length} 件)`,
    location: { file: item.file, pointer: item.pointer },
    suggestion:
      '仕様に書かれた語(状態・イベント・欄・ロールの表示名と、不変条件の文の語)で言い直す。数字は生成が入れるので書かない。' +
      '識別子とパスは書かない(設計メモ book-human-face.md §2。新しい業務の判断を文に入れない)',
    counterexample: {
      issues: kinds.join(' / '),
      at: issues.map((issue) => `${KIND_WORDS[issue.kind]}「${issue.token}」`).join(', '),
    },
  });
}

/**
 * 人が書く文の語の接地を検査する。
 *
 * @param sentences 人が書く文(仕様の `summary:` ひとつずつ)
 * @param vocabulary 仕様の語と台帳の語
 * @returns M10 の違反(warning。summary 1 つにつき 1 件)
 */
export function verifySummaryGrounding(
  sentences: readonly HumanSentence[],
  vocabulary: SummaryVocabulary,
): Finding[] {
  return sentences.flatMap((item) => {
    const issues = groundingIssues(item.text, vocabulary);
    return issues.length === 0 ? [] : [findingFor(item, issues)];
  });
}

/**
 * UX 検証器(UxVerifier)の共有インターフェース。
 *
 * 性質は他の群と同じ:「構築済みモデルを受け取り指摘を返す純粋関数」であり、
 * ファイル I/O・console 出力・例外による違反報告をしてはならない
 * (規約: docs/rules/process/common/tooling/standards/scripts-code-quality.md)。
 *
 * チェック内容の正: ux-lint.md の U1〜U5。
 * 新しい検査の追加は、この UxVerifier を実装したモジュールを
 * verifiers/index.ts の ALL_UX_VERIFIERS に登録するだけで完了する(CLI の変更不要)。
 */

import { makeFinding, type FindingArgs } from '../kernel/finding.js';
import type { UxInput, UxIssue } from '../model/ux/types.js';
import type { UxContext } from './context.js';

export type { Finding } from '../kernel/finding.js';

/** 全 UX 検証器が実装するインターフェース。 */
export interface UxVerifier {
  /** "U1" 〜 "U5"。ux-lint.md の番号と一致させる。 */
  readonly id: string;
  /** 人間向けの短い説明(CLI のヘッダーに出す)。 */
  readonly title: string;
  /** 入力全体を検査し、経験則から外れているものを返す。外れが無ければ空配列。 */
  verify(input: UxInput, ctx: UxContext): UxIssue[];
}

/**
 * UX の指摘を組み立てる小さなヘルパー。
 *
 * **severity は常に warning に固定する**(U 群の指摘は仕様の誤りではない)。
 * `subject` は受け入れの突合キーであると同時に counterexample にも入れる —
 * 受け入れを書く人が指摘の出力から書き写せることが、この方式が回るための条件だからである。
 *
 * @param check 検査 ID(例: "U1")
 * @param screens 受け入れられる画面(画面をまたぐ指摘は複数)
 * @param subject `screen-{name}/` の接頭辞を除いた subject(画面そのものへの指摘は空文字)
 * @param args message / location / suggestion / counterexample(severity は受け取らない)
 * @returns 組み立てた UxIssue
 */
export function uxIssue(
  check: string,
  screens: readonly string[],
  subject: string,
  args: Omit<FindingArgs, 'severity'>,
): UxIssue {
  return {
    check,
    screens,
    subject,
    finding: makeFinding(check, {
      message: args.message,
      location: args.location,
      suggestion: args.suggestion,
      severity: 'warning',
      counterexample: { ...(subject === '' ? {} : { subject }), ...args.counterexample },
    }),
  };
}

/**
 * 受け入れの書き方の案内(各検証器の suggestion に入れる共通の 1 文)。
 *
 * @param check 検査 ID
 * @param subject 受け入れの subject(画面そのものへの指摘は空文字)
 */
export function acceptHint(check: string, subject: string): string {
  const subjectLine = subject === '' ? '' : ` / subject: ${subject}`;
  return `この画面だけ受け入れるなら、その screen_spec のフロントマターに "ux: - principle: ${check}${subjectLine} / reason: {理由}" を書く`;
}

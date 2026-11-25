/**
 * 文書整合検証器(DocVerifier)の共有インターフェース。
 *
 * 入力が `DocsModel`(docs/rules + docs/specs 全体)である点だけが V 群・A 群と異なり、
 * 出力の `Finding` は共通なので CLI は同じ整形器で出力できる。
 *
 * 検証器の性質は V 群・A 群と同じ:「構築済みモデルを受け取り Finding を返す純粋関数」であり、
 * ファイル I/O・console 出力・例外による違反報告をしてはならない
 * (規約: docs/rules/process/common/tooling/standards/scripts-code-quality.md)。
 *
 * チェック内容の正: docs/rules/meta/standards/ の各ポリシー
 * (frontmatter_policy = M1 / id_policy = M2 / reference_policy = M3・M6 /
 *  markdown_conventions = M4 / template_policy = M5)。
 * 新しい検証器の追加は、この DocVerifier を実装したモジュールを
 * verifiers/index.ts の ALL_DOC_VERIFIERS に登録するだけで完了する(CLI の変更不要)。
 */

import type { Finding } from '../kernel/finding.js';
import type { DocsModel } from '../model/docs/types.js';

export type { Finding } from '../kernel/finding.js';

/** 全文書整合検証器が実装するインターフェース。 */
export interface DocVerifier {
  /** "M1"〜"M6"。 */
  readonly id: string;
  /** 人間向けの短い説明(CLI のヘッダーに出す)。 */
  readonly title: string;
  /** モデル全体を検証し、違反を返す。違反ゼロなら空配列。 */
  verify(model: DocsModel): Finding[];
}

/**
 * Finding を組み立てる小さなヘルパー。
 *
 * 3 点セット(何が = message / どこで = location / どう直すか = suggestion)を
 * 必ず埋めさせるため、すべて必須引数にしている。
 *
 * @param verifier 検証器 ID(例: "M1")
 * @param args message / location / suggestion / counterexample / severity
 * @returns 組み立てた Finding(severity 既定は error)
 */
export function docFinding(
  verifier: string,
  args: {
    readonly message: string;
    readonly location: Finding['location'];
    readonly suggestion: string;
    readonly counterexample?: Readonly<Record<string, string>>;
    readonly severity?: Finding['severity'];
  },
): Finding {
  const base = {
    verifier,
    severity: args.severity ?? 'error',
    message: args.message,
    location: args.location,
    suggestion: args.suggestion,
  } as const;
  return args.counterexample === undefined ? base : { ...base, counterexample: args.counterexample };
}

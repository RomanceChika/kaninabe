/**
 * Finding(検証結果 1 件)の型と組み立てヘルパー(kernel 層 — 全層が読む共通語)。
 *
 * 3 点セット(何が = message / どこで = location / どう直すか = suggestion)を
 * 必ず埋めさせるため、組み立ての引数はすべて必須にしている。
 * V 群・A 群・M 群・Q 群のいずれも同じ形の Finding を返す規約(scripts-code-quality.md)なので、
 * 型と組み立てはここ 1 箇所に置き、各群のヘルパー(traceFinding / queryFinding など)は
 * 検証器 ID を添えてこれを呼ぶだけにする。
 *
 * 使う側は**ここ**から読む(検証器の契約 `lib/check-api/contract.ts` は `Finding` を再輸出しない)。
 * 下の層が検証器の契約(check)を読むと向きが逆になる。
 */

import type { ScopeOwner } from './scope-owner.js';
import type { SourceLocation } from './source-location.js';

/** 検証結果の 1 件。「何が・どこで・どう直すか」を必ず揃える。 */
export interface Finding {
  /** 検証器 ID(例: "V3")。 */
  readonly verifier: string;
  /** error = 仕様として受理できない / warning = 受理するが人間の確認を促す。 */
  readonly severity: 'error' | 'warning';
  /** 何が問題か(1 文、日本語)。 */
  readonly message: string;
  /** どこで(ファイル + YAML パス)。 */
  readonly location: SourceLocation;
  /** どう直すか(具体的な修正候補を 1 文以上)。 */
  readonly suggestion: string;
  /**
   * 反例・違反の具体値(あれば)。例: { state: "accepted", event: "submit", role: "performer" }
   * CLI がそのまま表形式で表示する。
   */
  readonly counterexample?: Readonly<Record<string, string>>;
  /**
   * 警告が出た**理由の区分**(あれば。検査ごとに閉じた語を持つ。例: T16 は `lib/data/check-reasons.ts`)。
   * 同じ検査が理由の混ざる警告を出すとき、それを読む側(拡張候補の絞り `lib/extension/scope.ts`)が
   * 反例の欄から推定せずに済むよう、検査が**明示の欄**で載せる。人向けの文は `message` / `suggestion` の側にある。
   */
  readonly reason?: string;
  /**
   * この指摘が**実装の木との突合**から出たもの(あれば `implementation`)。
   * 仕様を足した直後は、突合先(生成されるテスト・手で書く実装)がまだ無いので必ず赤い。`generate` はこの指摘では止まらない
   * (`lib/verify/pre-generate.ts`)。仕様だけで決まる指摘には付けない。同じ検査 ID が両方を出すとき、突合の側にだけ付ける。
   */
  readonly grounding?: 'implementation';
  /**
   * この警告が**受け入れた危険**であること(あれば)。仕様の側が理由つきで「外す」と宣言した結果の警告にだけ付ける
   * (例: 多要素認証の `mfa: { exempt: 理由 }`)。区分は「受け入れた危険」になり、未分類の門(`--fail-on-unclassified`)を閉じない。
   * 付けてよいのは宣言から導いた警告だけで、宣言の実在と理由が空でないことは W5 が見る(検査が勝手に付けて門を抜けないように)。
   */
  readonly acceptance?: AcceptedRiskDecl;
  /**
   * この指摘が「仕様 X が名指す Y が無い」という**純粋な不在の error**であり、X の持ち主が `owner` であること(あれば)。
   * `kernel/scope-owner.ts` の関数 `absentFor` だけが書く。実装の範囲(`implemented`)の外の持ち主の印つき error だけが、最後の仕分けで報告へ移る。
   */
  readonly absentFor?: ScopeOwner;
}

/**
 * 受け入れた危険の宣言 1 件(仕様の側が理由つきで書いた「外す」の宣言)。
 *
 * 理由は**宣言の側**が持つ(汎用の免除の一覧を作らない)。検査はこの宣言を見て警告を出し、警告の `acceptance` に同じものを載せる。
 * 組み立ての根は読めた仕様から宣言を集めて W5 へ渡し、W5 が警告の `acceptance` と突き合わせる。
 */
export interface AcceptedRiskDecl {
  /** 外す理由(空でない)。 */
  readonly reason: string;
  /** 宣言の位置。 */
  readonly location: SourceLocation;
}

/** Finding の組み立て引数(verifier ID 以外)。 */
export interface FindingArgs {
  /** 何が問題か(1 文、日本語)。 */
  readonly message: string;
  /** どこで(ファイル + YAML パス)。 */
  readonly location: Finding['location'];
  /** どう直すか(具体的な修正候補)。 */
  readonly suggestion: string;
  /** 違反の具体値(あれば)。 */
  readonly counterexample?: Readonly<Record<string, string>>;
  /** 省略時は error。 */
  readonly severity?: Finding['severity'];
  /** 実装の木との突合から出た指摘なら `implementation`(`Finding.grounding`)。 */
  readonly grounding?: Finding['grounding'];
}

/**
 * Finding を組み立てる。
 *
 * @param verifier 検証器 ID(例: "A1" / "Q2")
 * @param args message / location / suggestion / counterexample / severity
 * @returns 組み立てた Finding(severity 既定は error)
 */
export function makeFinding(verifier: string, args: FindingArgs): Finding {
  const base = {
    verifier,
    severity: args.severity ?? 'error',
    message: args.message,
    location: args.location,
    suggestion: args.suggestion,
  } as const;
  const withCounterexample = args.counterexample === undefined ? base : { ...base, counterexample: args.counterexample };
  return args.grounding === undefined ? withCounterexample : { ...withCounterexample, grounding: args.grounding };
}

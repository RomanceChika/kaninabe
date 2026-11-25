/**
 * 仕様ファイル上の位置(kernel 層 — 全層が読む共通語)。
 *
 * `Finding` の `location` に使う。仕様モデルの共有語彙(`lib/model/types-common.ts`)からは
 * 再輸出される —— 位置の型を model に置くと、kernel の `Finding` が model を読む向きの逆転になる。
 */

/** 仕様ファイル上の位置。Finding の location に使う。 */
export interface SourceLocation {
  /** リポジトリルートからの相対パス(例: docs/specs/domain/entry/states.md) */
  readonly file: string;
  /** ファイル内の論理位置(例: "events.submit", "invariants.INV-ENTRY-001")。行番号ではなく YAML パスで指す。 */
  readonly pointer?: string;
}

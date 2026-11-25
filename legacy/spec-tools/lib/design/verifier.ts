/**
 * 視覚層の検証器(G 群)の共有インターフェース。
 *
 * 検証器は「構築済みの DesignInput を受け取り Finding を返す純粋関数」であり、
 * ファイル I/O をしない(規約: scripts-code-quality.md)。読み込みは loader.ts が済ませる。
 *
 * チェック内容の正:
 * `docs/rules/process/frontend/system/standards/conventions/styling.md`。
 */

import type { Finding } from '../kernel/finding.js';
import type { DesignInput } from '../model/design/types.js';

/** 全 G 群検証器が実装するインターフェース。 */
export interface DesignVerifier {
  /** "G1"〜"G3"。styling.md の番号と一致させる。 */
  readonly id: string;
  /** 人間向けの短い説明。 */
  readonly title: string;
  /** 違反を返す。違反ゼロなら空配列。 */
  verify(input: DesignInput): Finding[];
}

/** Finding の材料(「何が・どこで・どう直すか」を必ず揃えさせるため個別引数にしない)。 */
export interface DesignFindingInput {
  /** 何が問題か(1 文)。 */
  readonly message: string;
  /** どこで(ファイル。行が分かるなら pointer に入れる)。 */
  readonly file: string;
  /** ファイル内の位置(行番号や YAML パス)。 */
  readonly pointer?: string;
  /** どう直すか。 */
  readonly suggestion: string;
  /** 違反の具体値。 */
  readonly counterexample?: Readonly<Record<string, string>>;
}

/**
 * G 群の Finding を作る。
 *
 * @param verifier 検証器 ID(例: "G1")
 * @param input 何が・どこで・どう直すか
 * @param severity 既定は error。人間の確認に留めるものだけ warning
 * @returns 検証結果 1 件
 */
export function designFinding(
  verifier: string,
  input: DesignFindingInput,
  severity: Finding['severity'] = 'error',
): Finding {
  const location =
    input.pointer === undefined ? { file: input.file } : { file: input.file, pointer: input.pointer };
  const base = { verifier, severity, message: input.message, location, suggestion: input.suggestion };
  return input.counterexample === undefined ? base : { ...base, counterexample: input.counterexample };
}

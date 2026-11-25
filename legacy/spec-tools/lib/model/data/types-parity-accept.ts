/**
 * data_table の `parity_accepts`(構造の突合の照らしの、理由と試験の ID つきの受け入れ)のモデル型。読み取りは `parse-parity-accept.ts`、
 * 生成物への写しは `generate/render/code-data-table-registries.ts`。
 */

/** 受け入れる照らしの種類(閉じた値域)。 */
export const PARITY_ACCEPT_CHECKS = ['invariant_edge', 'trigger_advisory', 'isolation_gate'] as const;

/**
 * 照らしの種類。
 *
 * - `invariant_edge`: 不変条件の書き込みの端のうち、どの DB の執行点も発火しないもの(`ddl-ref-check-edges.ts` の母集合)
 * - `trigger_advisory`: トリガの本文が advisory lock を取ること
 * - `isolation_gate`: 生成物でないトリガ関数が隔離の水準の拒否の門を持たないこと
 */
export type DataParityAcceptCheck = (typeof PARITY_ACCEPT_CHECKS)[number];

/** 受け入れ 1 行(表はこの宣言を持つファイルの表)。 */
export type DataParityAccept =
  | {
      readonly check: 'invariant_edge';
      readonly invariant: string;
      /** 端(`insert` / `update of {列}` / `update` / `unreadable …`。`InvariantEdgeGap.edge` と同じ字面)。 */
      readonly edge: string;
      readonly reason: string;
      readonly test: string;
    }
  | {
      readonly check: 'trigger_advisory' | 'isolation_gate';
      readonly invariant: string;
      /** 受け入れるトリガ関数の名前。 */
      readonly function: string;
      readonly reason: string;
      readonly test: string;
    };

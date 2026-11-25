/**
 * ガード式まわりの基礎型。
 *
 * 状態機械の遷移テーブル（`./types.ts`）と access_spec 由来の規則表（`./access-types.ts`）の
 * 両方が使うため、どちらにも属さない土台としてここに置く。
 * 呼び出し側は `./types` の再エクスポート経由でも直接でも参照してよい。
 */

/** ガード評価時に環境から取り出せる値。集合・オブジェクトは持てない（スカラーのみ）。 */
export type GuardValue = string | number | boolean | null;
/** パス文字列(例: "workshop.state"、"now"、"actor.id")→ 実行時の値 */
export type GuardEnv = Readonly<Record<string, GuardValue>>;

/**
 * ガード式のAST（仕様YAMLのガード式をパースした結果のデータ表現）。
 *
 * 文法の正: docs/rules/process/common/specification/standards/domain-spec-writing.md
 * `not in [...]` は `{ kind: 'not', operand: { kind: 'in', ... } }` に正規化される。
 */
export type GuardExprData =
  | { readonly kind: 'and'; readonly left: GuardExprData; readonly right: GuardExprData }
  | { readonly kind: 'or'; readonly left: GuardExprData; readonly right: GuardExprData }
  | { readonly kind: 'not'; readonly operand: GuardExprData }
  | {
      readonly kind: 'compare';
      readonly path: string;
      readonly op: '==' | '!=' | '<' | '<=' | '>' | '>=';
      readonly rhs:
        | { readonly kind: 'literal'; readonly value: string | number }
        | { readonly kind: 'path'; readonly path: string };
    }
  | { readonly kind: 'in'; readonly path: string; readonly values: readonly (string | number)[] }
  | { readonly kind: 'contains'; readonly path: string; readonly ref: string };

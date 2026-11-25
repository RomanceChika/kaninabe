/**
 * role_spec(docs/specs/domain/roles.md)の型。
 *
 * 入口は types.ts(ファサード)。スキーマの正:
 * docs/rules/process/common/specification/standards/domain-spec-writing.md
 */

import type { SourceLocation } from './types-common.js';

/**
 * グローバルロールの種別の値域(フレームワーク固定)。
 *
 * - `anonymous` … 未ログインの実行者に対応するロール。
 * - `authenticated_default` … ログイン済みの実行者が常に持つ既定のロール
 *   (かつては `member` という語で仕組み側のコードに固定されていた)。
 * - `system` … Webhook / Cron からの内部実行に対応するロール。
 *
 * どの語をこの種別に当てるかはこのアプリの事情であり、`roles[].id` の値そのものが
 * `member` である必要はない —— 仕組み側のコードはこの `kind` だけを見て、対応する
 * ロール ID は生成物(`GLOBAL_ROLES`)経由で引く(dsl-extension-triage.md §軸と語)。
 */
export const ROLE_KINDS = ['anonymous', 'authenticated_default', 'system'] as const;

/** グローバルロールの種別。 */
export type RoleKind = (typeof ROLE_KINDS)[number];

/** ロール定義。binding が無ければグローバルロール、あれば文脈依存ロール。 */
export interface RoleDef {
  readonly id: string;
  /** 人間向けの日本語名(例: "発表者")。生成ドキュメントの可読性のためのフィールドで、検証には使わない。 */
  readonly label?: string;
  /**
   * グローバルロールの種別(`kind: anonymous` / `authenticated_default` / `system`)。
   * 文脈依存ロール(`binding` を持つロール)は持たない。3 種はそれぞれちょうど 1 つの
   * ロールが持たなければならない(パーサーが検査する)。
   */
  readonly kind?: RoleKind;
  /** 文脈依存ロールの条件式(ガード式と同じ文法の生文字列)。例: "workshop.organizer_ids contains actor.id" */
  readonly binding?: string;
  /**
   * **実行者自身の行の欄**が根拠のグローバルロール(`claim: {entity}.{field}`)。
   *
   * `binding` を持つ文脈依存ロールは「対象の行の欄が実行者と一致するか」で立つので、対象が
   * 変わればロールも変わる。一方、運営スタッフのようなロールは**対象に依らず**、実行者自身の
   * 行の 1 ビットだけで立つ —— これを宣言する欄が無かったあいだ、根拠は各 operation の
   * 手書き(実行者の行を DB から読む口)にだけ住んでいた(ADR-0012 ④・束 ⑰ 設計 §4)。
   *
   * 指せるのは `session: true` を宣言した欄だけである(V11)。セッション(`app_metadata.profile`)
   * に載っている値でしか「DB を読まずに解決できる」が成り立たず、載らない欄を許すと実行器が
   * 書き込みの前にもう 1 本クエリを持つことになる。型は boolean / enum / state に限る —— ロールは
   * 立つ / 立たないの 2 値であり、boolean は欄の真偽、enum / state は**値の集合に含まれるか**
   * (`claimValues`)で立つ。他の型から真偽を作る規則は仕様のどこにも無い。
   *
   * `kind: authenticated_default` とだけ併記できる(「行がある」に加えて「この条件を満たす」)。
   * 書き方は `{entity}.{field}`(boolean)・`{entity}.{field} == {値}`・`{entity}.{field} in [{値}, ...]`。
   * このフィールドには**欄のパス**(`{entity}.{field}`)だけを持ち、値の集合は `claimValues` に分ける
   * (欄を引く側がパスだけを見れば足りるように)。
   */
  readonly claim?: string;
  /**
   * `claim` が指す欄の**値の集合**(`claim: {entity}.{field} == {値}` / `in [{値}, ...]` と書いたとき)。
   *
   * 無ければ boolean の欄(従来の `claim: {entity}.{field}`)。あるときは欄が state / enum で、
   * 実行者の行のその欄がこの集合のどれかのときに**そのロールの行の条件**が成り立つ
   * (`claim` を持つロールは「行の条件を持つロール」であり、それを `implies` している側も
   * この条件を満たさなければ立たない —— ADR-0018)。`claim` が無いロールには付かない。
   * 集合の中身が欄の値域にあることは V11 が見る。
   */
  readonly claimValues?: readonly string[];
  /**
   * ロール階層(RBAC の role hierarchy)。このロールを持つ主体が**必ず**併せて持つロール。
   * 例: organizer は必ず member でもある → `implies: [member]`。
   * 「持ち得る」ではなく「必ず持つ」の宣言であり、権限の包含関係の推論に使う
   * (期待 RLS ポリシー表の刈り込みなど)。
   */
  readonly implies?: readonly string[];
  readonly location: SourceLocation;
}

/** roles.md 全体。ドメインに 1 つ。 */
export interface RoleSpec {
  readonly roles: readonly RoleDef[];
  readonly location: SourceLocation;
}

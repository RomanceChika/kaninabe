/**
 * 一致の証明の **world の型と、型に付く定数**(束 ⑳-5a)。
 *
 * 実行者の並びと控えの行を組む側(`eq-world-actors.ts`)と、world 全体を組む側(`eq-world.ts`)の
 * **両方が読む葉**である。型と定数は組み立ての関数を 1 つも import せず、どちらの側も
 * 互いを読まずにここを読む —— 型の置き場が組み立ての側にあると、組み立てが型を借り、型が組み立てを
 * 借りる値の循環になる。利用者は型をここから直接 import する(`eq-world.ts` は再輸出しない)。
 *
 * 純粋な宣言であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../model/types.js';
import type { DataTableSpec } from '../model/data/types.js';
import type { RlsWorldProblem } from './rls-world-derivable.js';
import type { RlsWorldRow } from './rls-world-rows.js';
import type { EqRecorded } from './eq-recorded.js';

/** 「実行者の集約に行が無い人」の名前に足す接尾。 */
export const NO_ROW_SUFFIX = '_without_row';

/** 「根拠は成立しているが行の条件を満たさない人」の名前に足す接尾(続けて条件を持つロールの ID が付く)。 */
export const UNMET_SUFFIX = '_unmet_';

/** 「行の条件を満たさず、古いロール一覧を渡す人」(保存点の world)の名前に足す接尾。 */
export const STALE_SUFFIX = '_stale_';

/**
 * 実行者が渡すロールの配列(`p_actor_roles`)の 3 通り。
 *
 * 名前は**仕組みの語**である(ロール ID ではない)—— `from_session` は実行器がセッションから
 * 解決して渡すもの、`from_runtime` は呼び出し経路が渡す内部実行のもの、`empty` は
 * 渡し忘れ・未ログインの側である。ロールそのものの綴りは仕様(`roles.md`)から来る。
 */
export const ROLE_ARRAY_NAMES = ['from_session', 'from_runtime', 'empty'] as const;

/**
 * 古いロール一覧(ADR-0018)。**行の条件を満たさなくなった実行者**に、条件を満たしていた頃に解決された
 * 配列(既定のログインロールと `claim` のロールを含む)をそのまま渡す —— セッションの写しは遅れうるので、
 * 取り消しの直後は先読みがこの配列を作りうる。DB は配列を信じず、実行者の行の条件を直に読んで落とさなければならない。
 * 条件を満たさない人だけが持つ(通常の実行者に渡す意味が無い)ので、`ROLE_ARRAY_NAMES`(全員が持つ 3 通り)には入れない。
 */
export const STALE_ARRAY_NAME = 'from_stale';

/** ロール配列の種類。 */
export type EqRoleArrayName = (typeof ROLE_ARRAY_NAMES)[number] | typeof STALE_ARRAY_NAME;

/** ロール配列 1 通り。 */
export interface EqRoleArray {
  readonly name: EqRoleArrayName;
  /** `p_actor_roles` にそのまま渡す配列。 */
  readonly roles: readonly string[];
}

/** 実行者 1 人。 */
export interface EqActor {
  /** world の中でこの人を指す名前。 */
  readonly key: string;
  /** その人が代表する役(テスト名に出る)。 */
  readonly role: string;
  /** 何を根拠に立つ人か。 */
  readonly basis: 'binding' | 'claim' | 'default' | 'no_row';
  /** 実行者自身の行の名前(行が無い人なら `null`)。 */
  readonly row: string | null;
  /** その系統の対象の行の名前(行が無い人なら `null`)。 */
  readonly target: string | null;
  readonly arrays: readonly EqRoleArray[];
  /**
   * この人が条件を満たさないロール(ADR-0018)。根拠(束縛・claim)は成立しているが、既定のログインロールの条件・
   * 含意の先の行の条件だけを満たさない(行の欄には条件の外の値が置かれ、ロール配列は未ログインと同じ側になる)。
   * 通常の実行者は持たない。
   */
  readonly unmet?: string;
}

/** 集約 1 つぶんの world。 */
export interface EqWorld {
  readonly aggregate: string;
  readonly table: string;
  /** 実行者の集約の物理テーブル名。 */
  readonly actorTable: string;
  readonly actors: readonly EqActor[];
  /** 挿入順の行(参照先が先)。 */
  readonly rows: readonly RlsWorldRow[];
  /**
   * 状態ごとの「遷移が書き留めた欄」の姿(`eq-recorded.ts`)。
   *
   * 置き直しが**状態の欄を動かすとき**に、その状態が要求する欄を一緒に置くための材料である
   * —— 状態だけを動かすと「状態 ⇔ 欄の有無」の不変条件が破れた行を作ってしまう。
   * 書き留める欄を 1 つも持たない集約では空である。
   */
  readonly records: readonly EqRecorded[];
}

/** world の組み立ての結果。 */
export type EqWorldResult =
  | { readonly ok: true; readonly world: EqWorld }
  | { readonly ok: false; readonly problems: readonly RlsWorldProblem[] };

/** world を組み立てるのに要る入力。 */
export interface EqWorldInput {
  readonly domain: SpecModel;
  readonly tables: readonly DataTableSpec[];
  /** その集約の操作が根拠にする束縛の役(役 → `{集約}.{列}`)。 */
  readonly bindingRoles: ReadonlyMap<string, string>;
  /** その集約の操作が根拠にする `claim` の役。 */
  readonly claimRoles: readonly string[];
}

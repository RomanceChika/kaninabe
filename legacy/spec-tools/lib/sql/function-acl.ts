/**
 * **関数の実行権限の閉世界**の計画(誰が `execute` できるか)。
 *
 * ## なぜ要るのか
 *
 * Postgres の関数は作った瞬間に `PUBLIC` へ実行権限が開く。`revoke all … from public` はその
 * 擬似ロールを閉じるだけで、**ロールを名指しした付与には触れない**。プラットフォームが新しい関数に
 * 既定の権限として一般利用者のロールを名指しで与える構成(Supabase の `public` スキーマがそうである)では、
 * `revoke … from public` を書いても面のロール(未ログイン・ログイン済み)から呼べるまま残る。
 * 書き込みの RPC は実行者を**引数で信じる**(`p_actor_id`)ので、面のロールから呼べることは
 * そのまま「偽の実行者で何でもできる」ことを意味する。
 *
 * ## 何を宣言とするか
 *
 * 面のロールから呼ばれてよい関数は**全部が仕様から導ける**——
 *
 * | 関数 | 呼ぶ人 | 正 |
 * |---|---|---|
 * | 土台の 3 本(実行者の解決 2 本 + セッションの生死 1 本) | ビューとポリシーの中で、読む本人 | `api-base.ts` |
 * | 隠し列の述語 `can_see_{表}_{列}` | ビューの中で、読む本人 | access_spec の `fields_hidden` |
 * | RLS 補助関数 | ポリシーの中で、読む本人 | data_table の `functions[]`(`kind: helper`) |
 *
 * ほかの関数(書き込みの RPC・トリガ関数・仕組みの関数)は、**面のロールから呼べてはいけない**。
 * だから閉世界の向きは「呼べる側を宣言し、それ以外は剥奪する」であり、RPC を 1 本足しても
 * この計画は変わらない(足した RPC は宣言の外にいるので、自動的に剥奪の対象になる)。
 *
 * ## 識別は署名まで含める
 *
 * 許可は `{スキーマ}.{名前}({引数の型})` で持つ。名前だけで許すと、同じ名前の別の overload が許可に
 * 紛れる(引数の型が違えば別の関数であり、宣言が指しているのはそのうちの 1 本である)。
 *
 * ## 新しい関数の既定の付与は作成主体ごとに閉じる
 *
 * 既存の関数を剥奪しても、**これから作る関数**には作った役の既定の実行権限が付く
 * (全体の既定と、プラットフォームがスキーマごとにロールを名指しで足す既定)。既定は役ごとの別の行で、
 * 全体とスキーマごとの両方が加算で効くので、関数を作りうる役(設定 `functionCreators`)ごとに、
 * 全体からもスキーマごとからも `PUBLIC` と面のロールの両方を外す。
 *
 * 役の扱いは 2 つある。migration が閉じる責務を持つ役(`migration`)は、実在するのに書き換えられなければ
 * migration を止める。プラットフォームが持つ役(`external`)は migration からは触れないので、
 * 閉じられないことを理由つきで名指しし、保証は流す時点の一覧の剥奪と閉世界の突合が持つ。
 *
 * 対象の関数は**種別を問わない**(通常の関数・手続き・集約・ウィンドウ関数)。既定の権限の文の
 * `functions` が手続きも含むのと、剥奪の対象を揃える。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { DataTableSpec } from '../model/data/types.js';
import type { PlatformProfile } from '../model/product/platform-profile.js';
import { pluralizeEntity } from '../model/table-name.js';
import type { SpecModel } from '../model/types.js';
import { apiBaseFunctions, apiBaseGrantees } from './api-base.js';
import { maskFunctionName, surfacedAggregates } from './api-views.js';
import { callerRoles, endUserRoles, surfaceUnsupportedReason } from './platform-sql.js';

/** 表と補助関数を置くスキーマ(土台以外の関数はここにある)。 */
const BASE_SCHEMA = 'public';

/**
 * 面のロールから呼ばれてよい関数 1 本。
 *
 * **識別は署名まで含める**(`{スキーマ}.{名前}({引数の型})`)。名前だけで許すと、同じ名前の別の
 * overload(引数の型が違う関数)まで除外に紛れ、面のロールから呼べるまま残る。
 */
export interface ExecutableFunction {
  /** `{スキーマ}.{名前}({引数の型の並び})`(`to_regprocedure` が読める字面)。 */
  readonly identity: string;
  /** `grant execute` の宛先(閉世界。これ以外のロールは実行できない)。 */
  readonly grantees: readonly string[];
}

/** migration から既定を閉じられない作成主体 1 つ(プラットフォームが持つ役)。 */
export interface ExternalCreator {
  /** DB ロール名。 */
  readonly role: string;
  /** 閉じられない理由(生成物のコメントと文書に出る)。 */
  readonly reason: string;
}

/** 関数の実行権限の計画。 */
export interface FunctionAclPlan {
  /** 剥奪の対象にするスキーマ(関数を置くスキーマの全部。基のスキーマ → 外に出すスキーマ)。 */
  readonly schemas: readonly string[];
  /** 宣言の外の関数から実行権限を外すロール(面のロール)。 */
  readonly revokeFrom: readonly string[];
  /** 面のロールから呼ばれてよい関数の全数(署名順)。 */
  readonly callable: readonly ExecutableFunction[];
  /**
   * 関数を作る DB ロールのうち、**migration が既定の実行権限を閉じる責務を持つ役**(流した接続の役も別に閉じる)。
   * 実在するのに書き換えられなければ migration は止まる。
   */
  readonly requiredCreators: readonly string[];
  /**
   * 関数を作る DB ロールのうち、**プラットフォームが持ち migration からは触れない役**と、その理由。
   * 閉じられないことを生成物のコメントに名指しで出し、保証は流す時点の一覧の剥奪と閉世界の突合が持つ。
   */
  readonly externalCreators: readonly ExternalCreator[];
}

/** 計画の材料。 */
export interface FunctionAclInput {
  readonly model: SpecModel;
  readonly tables: readonly DataTableSpec[];
  readonly platform: PlatformProfile;
}

/**
 * 関数の実行権限の計画を組み立てる。
 *
 * @param input ドメイン仕様・全 data_table・プラットフォームの設定
 * @returns 計画(宣言の外の関数は剥奪の対象)
 */
export function functionAclPlan(input: FunctionAclInput): FunctionAclPlan {
  const { model, tables, platform } = input;
  const exposed = platform.exposedSchema;
  const grantees = apiBaseGrantees(platform);
  const callable = new Map<string, readonly string[]>();
  // 公開面に依る部品(土台の関数・隠し列の述語)は、後段が公開面を外へ出す構成でだけ作られる。作られない構成で
  // 呼べる側に載せると、同じ署名の手書きの関数が閉世界の外から呼べる口になるので載せない。
  const surfaced = surfaceUnsupportedReason(platform) === null;
  for (const fn of surfaced ? apiBaseFunctions(platform) : []) callable.set(`${exposed}.${fn.name}()`, grantees);
  for (const { access, entity } of surfaced ? surfacedAggregates(model) : []) {
    const table = entity.table ?? pluralizeEntity(entity.entity);
    for (const field of access.fieldsHidden) {
      // 述語の引数は対象の行(表の行型)である。
      callable.set(`${exposed}.${maskFunctionName(table, field.field)}(${BASE_SCHEMA}.${table})`, callerRoles(platform));
    }
  }
  for (const table of tables) {
    for (const fn of table.functions) {
      if (fn.kind === 'helper') callable.set(`${BASE_SCHEMA}.${fn.name}(${fn.args.join(', ')})`, callerRoles(platform));
    }
  }
  return {
    schemas: [...new Set([BASE_SCHEMA, exposed])],
    revokeFrom: endUserRoles(platform),
    callable: [...callable.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([identity, to]) => ({ identity, grantees: to })),
    requiredCreators: platform.functionCreators.flatMap((creator) => (creator.handling === 'migration' ? [creator.role] : [])),
    externalCreators: platform.functionCreators.flatMap((creator) =>
      creator.handling === 'external' ? [{ role: creator.role, reason: creator.reason }] : [],
    ),
  };
}

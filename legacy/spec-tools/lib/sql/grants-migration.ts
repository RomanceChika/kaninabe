/**
 * **特権ロールの権限**の migration 1 枚(`{14 桁}_grants.sql`)の計画と字面。
 *
 * ## なぜ系に 1 本なのか
 *
 * 与える権限は**どの表でも同じ 1 組**である(`ddl-guards.ts` の `PRIVILEGED_PRIVILEGES`)。
 * それを表ごとの DDL に複製していたあいだ、仕組みの 1 行を変える日のコストは**表数に比例**
 * した —— 実測で 16 本の migration が動き、表ごとの差分は 4 行だった(2,893 行を書き直して
 * 意味は 2 行)。表の数が増えるほど高くなるこの形は、2 つ目のプロダクトでそのまま効く。
 *
 * だから権限は系に 1 本へ寄せる(`docs/design/ddl-reissue-free-changes.md` §4 の C′、決定 2)。
 * 引き換えは「表を 1 枚足す日に 1 本増える」ことと、宣言が 1 つ増えることである。
 *
 * ## タダで閉じる穴 —— 形の正が無い表にも、権限の正はある
 *
 * `ddl_migration` を宣言できるのは形の正がある表だけである(entity_spec か仕組みの設計図)。
 * ところが**権限の正は全部の表にある**(仕組みの 1 組である)。表ごとの DDL に権限を置く形では、
 * 形を導けない内部テーブルだけが**特権ロールから `truncate` できるまま閉世界の外**にいた。
 * 系に 1 本にすると、その表も一覧に載るだけで権限の閉世界に入る。
 *
 * ## surface のロールはどうなるか
 *
 * 執行者は分かれたままである(`table-acl.ts`)—— ポリシーを持つ表の surface のロールの権限は
 * ポリシーの migration が出す(正は `reads`)。ポリシーを **1 本も持たない表**(仕組みが持つ表と
 * 内部テーブル)だけ、surface のロールの既定権限の剥奪もここが出す。
 *
 * ## 冪等である
 *
 * `revoke` / `grant` は同じ状態への再宣言であり、何度流しても結果は同じで、既に宣言どおりの
 * DB に当てれば何も変わらない。
 *
 * ## 連番の前後に寄りかからない(存在ガード)
 *
 * 表ごとの 2 行は**その表が在るときだけ**流す(`tableGrant`)。番号で「表の DDL より後」を
 * 保証する形だと、表を 1 枚再発行するたびに権限も採番し直すことになる —— 引き換えと執行者は
 * `tableGrant` の docstring にある。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { DataTableSpec } from '../model/data/types.js';
import { DDL_WORDS, GRANTS_WORDS } from '../messages/messages-ddl.js';
import { RPC_BODY_WORDS } from '../messages/messages.js';
import { PRIVILEGED_PRIVILEGES, grantStatements, whenTablesPresent, type DdlGrant } from './ddl-guards.js';
import type { PlatformProfile } from '../model/product/platform-profile.js';
import { endUserRoles, privilegedRole } from './platform-sql.js';
import type { FunctionAclPlan } from './function-acl.js';
import { functionExecuteSection } from './function-acl-migration.js';
import { sequenceSection } from './sequence-acl-migration.js';

/** 表を置くスキーマ(権限を触る表は全部ここ)。 */
const SCHEMA = 'public';

/** 表 1 枚ぶんの権限の計画(どの表の権限をどう宣言するか)。 */
export interface TableGrant {
  /** 対象の表。 */
  readonly table: string;
  /** その表の権限の 1 組。 */
  readonly grant: DdlGrant;
}

/**
 * 全 data_table の権限の計画(**表の名前順**)。
 *
 * 母集合は**全部の表**である —— `ddl_migration` を宣言できない表(形の正がどこにも無い内部
 * テーブル)にも権限の正はあるので、ここから外す理由が無い(外すと、その表だけが
 * 「与えていない」を宣言できないまま閉世界の外に残る)。
 *
 * surface のロールを剥奪するかどうかは **ポリシーの migration があるか**で決まる —— あちらが
 * `revoke all … from anon, authenticated` → `grant select` まで出すので、二重に出すと同じ文が
 * 2 つの生成物に現れる。無い表(ポリシーを 1 本も持たない表)は誰も剥奪しないので、ここが出す。
 *
 * @param tables 全 data_table
 * @param profile プラットフォームの設定(ロール名の写像)
 * @returns 表ごとの権限の計画(表の名前順で安定)
 */
export function grantPlans(tables: readonly DataTableSpec[], profile: PlatformProfile): readonly TableGrant[] {
  return [...tables]
    .sort((a, b) => a.table.localeCompare(b.table))
    .map((table) => ({
      table: table.table,
      grant: {
        revokeFrom: table.policiesMigration === undefined ? endUserRoles(profile) : [],
        privileges: PRIVILEGED_PRIVILEGES,
        to: privilegedRole(profile),
      },
    }));
}

/**
 * 特権ロールの権限の migration を組み立てる。
 *
 * 節は 2 つある —— surface のロールに触らない表(ポリシーがそれを持つ)と、surface のロールの剥奪まで
 * 出す表(ポリシーを 1 本も持たない)である。節の見出しは表の DDL が出していたものと同じ
 * 文言を使う(同じ意味の節に 2 つの文言を持たない)。
 *
 * 関数の計画を渡すと、末尾に**関数の実行権限の閉世界**の節(`functionExecuteSection`)と、同じ計画のスキーマ・面のロール・作成主体で
 * **sequence の権限の閉世界**の節(`sequenceSection`。点検 3 回目 A3-6)が付く。
 *
 * @param plans 表ごとの権限の計画
 * @param functions 関数の実行権限の計画(無ければ関数の節は出ない)
 * @returns SQL 1 枚(末尾に改行を含む)
 */
export function buildGrantsMigration(plans: readonly TableGrant[], functions?: FunctionAclPlan): string {
  const privileged = plans.filter((plan) => plan.grant.revokeFrom.length === 0);
  const withEndUsers = plans.filter((plan) => plan.grant.revokeFrom.length > 0);
  return [
    ...header(),
    ...section(DDL_WORDS.privilegedGrants, privileged),
    ...section(DDL_WORDS.grants, withEndUsers),
    ...(functions === undefined ? [] : functionExecuteSection(functions)),
    ...(functions === undefined ? [] : sequenceSection(functions)),
    '',
  ].join('\n');
}

/** 見出しつきの 1 節(中身が無ければ節ごと出さない)。 */
function section(title: string, plans: readonly TableGrant[]): readonly string[] {
  if (plans.length === 0) return [];
  return ['', `-- ${title}`, ...plans.flatMap((plan) => tableGrant(plan))];
}

/**
 * 表 1 枚ぶんの権限(**その表が在るときだけ**流す)。
 *
 * 存在ガードを付ける理由は「連番の前後に寄りかからない」ためである —— `grant … on public.{表}` は
 * 表が在ってはじめて通るので、それを**番号で**保証していると、表の DDL を再発行するたびに
 * 権限の連番もやり直すことになり、**バイト同一の migration が 1 本増える**(§13 の「権限は系に
 * 1 本」の趣旨に反する。実測: 同じ束で 2 回起きた)。ガードにすれば前後関係が要らなくなる ——
 * **外部キーを両側のファイルに出すときと同じ道具**である(`whenTablesPresent`)。
 *
 * 引き換えは「権限の migration より後ろの番号で**新しく**作られた表の権限が静かに欠ける」経路で、
 * それは ACL の閉世界(`ddl-parity` の `acl-expectations.ts`)と、空の DB に全部当てる
 * `samples:db` が名指す —— 外部キーの「参照先が現れなければ静かに欠ける」と同じ形の引き換えで
 * ある。そして**表を 1 枚足す日はこのファイルの中身が変わる**ので、`generate:check` が
 * 「採番し直していない」を落とす(= 新しい表は必ず次の採番で拾われる)。
 *
 * @param plan その表の権限の計画
 * @returns SQL の行
 */
function tableGrant(plan: TableGrant): readonly string[] {
  const target = `${SCHEMA}.${plan.table}`;
  return whenTablesPresent([target], grantStatements(plan.grant, target));
}

/** 先頭の AUTO-GENERATED ヘッダ(SQL コメント)。 */
function header(): readonly string[] {
  return [
    `-- ${RPC_BODY_WORDS.generatedHeader}`,
    '--',
    ...GRANTS_WORDS.generatedNote.map((line) => `-- ${line}`),
    '--',
    ...GRANTS_WORDS.migrationNote.map((line) => `-- ${line}`),
  ];
}

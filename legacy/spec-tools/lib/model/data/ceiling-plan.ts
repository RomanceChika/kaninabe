/**
 * 未ログインの作成の**全体の天井**(`creates[].abuse`)を DB の制約トリガにする計画と、その**判定の 1 本**。
 *
 * 設計: docs/design/security-audit-2026-10-18/r5-abuse-freeze.md §4-A(B4-1b の裁定を含む)。
 *
 * ## 判定がここにある理由
 *
 * 「この宣言から天井を出せるか」を、検査(R5-4)と生成器(`sql/ddl-ceiling-triggers.ts`)が**同じこの関数**に聞く。
 * 書き写すと、検査が通したのに生成器が出さない(宣言が嘘になる)宣言が作れてしまう。時刻の欄の選び方も
 * `model/abuse-clock.ts` の 1 本を呼ぶ。
 *
 * ## 計画が運ぶ事実
 *
 * - トリガ名・関数名は `check_{entity}_rate_limit`(手書きだったころと同じ名前。呼び出し側の写像と見張りテストが無改変で続く)。
 * - 数える時刻の欄(`at` または省略時の `auto` の日時の欄)・全体の天井・鍵ごとの天井。
 * - ロックの鍵は**表ごとに 1 本**(`{表}:ceiling`)。全体の天井があるので鍵ごとの数えもこの 1 本の下で行え、順序の食い違いによる
 *   デッドロックが無い。
 * - 索引の要求: 全体 = `[at]`、鍵ごと = `[column, at]`(T2 が前方一致で畳んで既存の索引と突き合わせる)。
 *
 * 宣言が無い表には `none` を返す。純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { AbusePerKey, AbuseWindow, AggregateSpecs, InvariantDef, SpecModel } from '../types.js';
import type { DataFunctionDecl, DataTableSpec, DataTriggerDecl } from './types.js';
import { clockOf, windowProblems, writtenProblems } from '../abuse-clock.js';
import { SQL_IDENTIFIER } from '../sql-fragment.js';
import { anonymousRoleId, impliedRoles } from '../role-hierarchy.js';

/** 天井の執行点の発火(コミット時評価の制約トリガ。`after insert`)。 */
export const CEILING_FIRES = 'after insert';

/** 天井を生成できる宣言から決まる計画。 */
export interface CeilingPlan {
  /** 物理テーブル名。 */
  readonly table: string;
  /** トリガ名 = 関数名(`check_{entity}_rate_limit`)。 */
  readonly name: string;
  /** 数える時刻の欄。 */
  readonly at: string;
  /** 全体の天井。 */
  readonly global: AbuseWindow;
  /** 鍵ごとの天井(任意)。 */
  readonly perKey?: AbusePerKey;
  /** `pg_advisory_xact_lock(hashtext(…))` の引数(表ごと 1 本)。 */
  readonly lockKey: string;
  /** この執行点を `enforced_by` で名指す不変条件(あれば。拒否の文面の先頭に載せる)。 */
  readonly invariant?: InvariantDef;
}

/** 判定の結果(宣言が無い / 出せる / 出せない理由つき)。 */
export type CeilingJudgement =
  | { readonly kind: 'none' }
  | { readonly kind: 'ok'; readonly plan: CeilingPlan }
  | { readonly kind: 'refused'; readonly reason: string };

/** トリガ名・関数名(`check_{entity}_rate_limit`)。 */
export function ceilingNameOf(entity: string): string {
  return `check_${entity}_rate_limit`;
}

/** 表の entity を持つ集約(集約ディレクトリ名とエンティティ名のどちらでも引く)。 */
export function aggregateOfTable(table: DataTableSpec, domain: SpecModel): AggregateSpecs | null {
  if (table.entity === undefined) return null;
  for (const [aggregate, specs] of domain.aggregates) {
    if (specs.entity?.entity === table.entity || aggregate === table.entity) return specs;
  }
  return null;
}

/** この執行点を `enforced_by` で名指す不変条件を引く(無ければ undefined)。 */
function invariantNaming(name: string, domain: SpecModel): InvariantDef | undefined {
  for (const specs of domain.aggregates.values()) {
    const found = specs.invariants?.invariants.find((invariant) =>
      invariant.enforcedBy.some((enforcement) => enforcement.kind === 'trigger' && enforcement.ref === name),
    );
    if (found !== undefined) return found;
  }
  return undefined;
}

/** 引用符なしの識別子として置けない PostgreSQL の予約語(予約語を欄名・表名に使った宣言は、引用符を付けない生成 SQL が壊れる)。 */
const RESERVED_WORDS: ReadonlySet<string> = new Set(
  `all analyse analyze and any array as asc asymmetric both case cast check collate column constraint create current_catalog current_date
  current_role current_time current_timestamp current_user default deferrable desc distinct do else end except false fetch for foreign from
  grant group having in initially intersect into lateral leading limit localtime localtimestamp not null offset on only or order placing
  primary references returning select session_user some symmetric system_user table then to trailing true union unique user using variadic
  when where window with`
    .split(/\s+/)
    .filter((word) => word !== ''),
);

/** PostgreSQL の識別子の長さの上限(これを超えると黙って切り詰められ、名前が衝突しうる)。 */
const MAX_IDENTIFIER = 63;

/** 引用符なしで安全に置ける識別子でない名前の指摘(無ければ null)。 */
function unsafeName(what: string, name: string): string | null {
  if (!SQL_IDENTIFIER.test(name)) return `${what} "${name}" は小文字の英数字と _ だけの名前ではありません(引用符なしで SQL に置けません)`;
  if (name.length > MAX_IDENTIFIER) return `${what} "${name}" は ${MAX_IDENTIFIER} 文字を超えます`;
  return RESERVED_WORDS.has(name) ? `${what} "${name}" は PostgreSQL の予約語です(引用符なしで SQL に置けません)` : null;
}

/** 手で宣言された名前との衝突(あれば理由)。 */
function collision(name: string, table: DataTableSpec): string | null {
  const taken =
    table.triggers.some((trigger) => trigger.name === name || trigger.functionName === name) ||
    table.functions.some((fn) => fn.name === name);
  if (taken) return `data_table に ${name} という名前のトリガ・関数が宣言されています(天井の執行点は abuse から生成されるので、手で宣言すると二重になります。宣言を消してください)`;
  // 天井の鍵の受け入れも宣言から導く(ceilingAdvisoryAcceptOf)。手で書いた行は二重になる(点検 26 回目の後の判断待ち 1)。
  const accepted = (table.parityAccepts ?? []).some((accept) => accept.check === 'trigger_advisory' && accept.function === name);
  return accepted
    ? `data_table の parity_accepts に ${name} の trigger_advisory の行があります(天井の鍵の受け入れは abuse と天井の不変条件から導かれるので、手で書くと二重になります。行を消してください)`
    : null;
}

/**
 * 表 1 枚について、未ログインの作成の天井を生成できるかを判定する。
 *
 * @param table テーブル仕様
 * @param domain ドメイン仕様
 * @returns 宣言が無い(`none`)・生成できる(`ok`)・生成できない理由(`refused`)
 */
export function judgeCeiling(table: DataTableSpec, domain: SpecModel): CeilingJudgement {
  const specs = aggregateOfTable(table, domain);
  const entity = specs?.entity;
  if (specs === null || entity === undefined) return { kind: 'none' };
  const carriers = (specs.access?.creates ?? []).filter((rule) => rule.abuse !== undefined);
  const abuse = carriers[0]?.abuse;
  if (abuse === undefined || abuse.globalCeiling === undefined) return { kind: 'none' };
  if (carriers.length > 1) return { kind: 'refused', reason: 'abuse が同じ access_spec の 2 規則以上にあります(制約トリガは表に 1 本です)' };
  if (table.ddlMigration === undefined) {
    return { kind: 'refused', reason: `表 ${table.table} の DDL が生成物ではありません(data_table に ddl_migration の宣言が無いので、天井のトリガを出す先がありません)` };
  }
  // 生成器が安全に出せない形(本文が `where id = new.id` と書くこと・名前を引用符なしで置くこと・天井の値を SQL の整数と interval に置くこと)。
  if (!entity.fields.some((field) => field.name === 'id')) return { kind: 'refused', reason: `集約 ${entity.entity} に主キーの欄 id がありません(生成する本文は id で行を読み直します)` };
  const window = [...windowProblems('global_ceiling', abuse.globalCeiling), ...(abuse.perKey === undefined ? [] : windowProblems('per_key', abuse.perKey))];
  if (window.length > 0) return { kind: 'refused', reason: window.join(' / ') };
  const clock = clockOf(abuse.at, specs);
  if (!clock.ok) return { kind: 'refused', reason: clock.problems.join(' / ') };
  const keyField = abuse.perKey === undefined ? undefined : entity.fields.find((field) => field.name === abuse.perKey?.column);
  if (abuse.perKey !== undefined) {
    if (keyField === undefined) return { kind: 'refused', reason: `per_key.column="${abuse.perKey.column}" は集約の欄にありません` };
    if (!keyField.required && !keyField.auto) return { kind: 'refused', reason: `per_key.column="${abuse.perKey.column}" は空にできる欄です(空の鍵どうしは等しくならず、鍵を省けば鍵ごとの天井をすり抜けられます)` };
    const keyWritten = writtenProblems(abuse.perKey.column, specs, '鍵の欄(per_key)');
    if (keyWritten.length > 0) return { kind: 'refused', reason: keyWritten.join(' / ') };
  }
  const unsafe = [
    unsafeName('表', table.table),
    unsafeName('時刻の欄', clock.column),
    abuse.perKey === undefined ? null : unsafeName('per_key の欄', abuse.perKey.column),
    unsafeName('トリガ名', ceilingNameOf(entity.entity)),
  ].find((problem) => problem !== null);
  if (unsafe !== undefined && unsafe !== null) return { kind: 'refused', reason: unsafe };
  const name = ceilingNameOf(entity.entity);
  const clash = collision(name, table);
  if (clash !== null) return { kind: 'refused', reason: clash };
  const invariant = invariantNaming(name, domain);
  return {
    kind: 'ok',
    plan: {
      table: table.table,
      name,
      at: clock.column,
      global: abuse.globalCeiling,
      ...(abuse.perKey === undefined ? {} : { perKey: abuse.perKey }),
      lockKey: `${table.table}:ceiling`,
      ...(invariant === undefined ? {} : { invariant }),
    },
  };
}

/** 天井の鍵の受け入れ 1 行の事実(理由の文は生成器が文言表から付ける。生成物 `dataTableParityAccepts.triggerAdvisory` の行になる)。 */
export interface CeilingAdvisoryAccept {
  readonly function: string;
  readonly table: string;
  readonly invariant: string;
  readonly test: string;
  /** 取る鍵(理由の文に載る)。 */
  readonly lockKey: string;
}

/**
 * 天井のトリガが取る鍵の受け入れを、**宣言から導く**(点検 26 回目の後の判断待ち 1。手で書かない)。
 *
 * 生成した天井(`sql/ddl-ceiling-triggers.ts`)は数える前に表ごとの鍵 1 つを取るので、トリガの中の advisory lock の照らし
 * (製品の trigger-advisory-parity)に受け入れの行が要る。行の中身は全部宣言で決まる —— 関数と鍵は計画、不変条件は天井を
 * `enforced_by` で名指す不変条件、試験はその表の test_cases でその不変条件を `spec_ids` に持つもの(登録簿の先頭)。
 * 受け入れの条件(鍵を持った取引はその後に新しい行も別の鍵も待たない)は理由の文ではなく、同じ照らしの `acceptedKeyProblems` が
 * api の関数の全部の閉包で確かめる。天井を名指す不変条件が無い・その試験が無いときは導かない(照らしが鍵を名指して止める)。
 *
 * @param table テーブル仕様
 * @param domain ドメイン仕様
 * @param tests 表 → 不変条件 → 試験の ID の登録簿
 * @returns 受け入れの事実(導けなければ null)
 */
export function ceilingAdvisoryAcceptOf(
  table: DataTableSpec,
  domain: SpecModel,
  tests: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>,
): CeilingAdvisoryAccept | null {
  const plan = ceilingPlanOf(table, domain);
  if (plan === null || plan.invariant === undefined) return null;
  const test = tests[table.table]?.[plan.invariant.id]?.[0];
  if (test === undefined) return null;
  return { function: plan.name, table: table.table, invariant: plan.invariant.id, test, lockKey: plan.lockKey };
}

/** 判定が通ったときの計画(通らなければ null)。 */
export function ceilingPlanOf(table: DataTableSpec, domain: SpecModel): CeilingPlan | null {
  const judged = judgeCeiling(table, domain);
  return judged.kind === 'ok' ? judged.plan : null;
}

/** 本文が引く列(鍵 → 時刻の順。索引の要求の `lookup` と同じ並び)。 */
export function ceilingLookupOf(plan: CeilingPlan): readonly string[] {
  return plan.perKey === undefined ? [plan.at] : [plan.perKey.column, plan.at];
}

/**
 * 計画を **data_table の宣言の形**に写す(突合・ハンドブック・執行点の実在の検査が、宣言されたものと同じ形で読む)。
 *
 * 「生成物が持つ」ことは正の置き場の違いであって、実 DB に在るべき実体としては宣言されたものと同じである
 * (`world/framework-triggers.ts` の追記専用トリガと同じ扱い)。
 *
 * @param table テーブル仕様
 * @param domain ドメイン仕様
 * @returns トリガと関数の宣言(生成できなければ空)
 */
export function ceilingDeclsOf(
  table: DataTableSpec,
  domain: SpecModel,
): { readonly triggers: readonly DataTriggerDecl[]; readonly functions: readonly DataFunctionDecl[] } {
  const plan = ceilingPlanOf(table, domain);
  if (plan === null) return { triggers: [], functions: [] };
  return {
    triggers: [
      {
        name: plan.name,
        functionName: plan.name,
        fires: CEILING_FIRES,
        deferred: true,
        supplies: [],
        params: {},
        ...(plan.invariant === undefined ? {} : { invariant: plan.invariant.id }),
      },
    ],
    functions: [
      { name: plan.name, args: [], params: [], kind: 'trigger', alsoWrites: [], security: 'definer', lookup: [...ceilingLookupOf(plan)] },
    ],
  };
}

/**
 * 未ログインが持つロール(未ログインのロールと、それが含意するロール)。
 *
 * 含意で開く規則も未ログインに開いている。R5(検査)とハンドブックの「未ログインに開いた書き込み」が同じこの 1 本を読む。
 *
 * @param model ドメイン仕様
 * @returns ロール ID の集合(未ログインのロールが無い仕様では空)
 */
export function anonymousReach(model: SpecModel): ReadonlySet<string> {
  const anonymous = anonymousRoleId(model.roles.roles);
  return new Set(anonymous === undefined ? [] : [anonymous, ...impliedRoles(model.roles.roles, anonymous)]);
}

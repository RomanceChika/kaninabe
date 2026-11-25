/**
 * RLS の migration 1 枚(ポリシー / 補助関数)の組み立て。
 *
 * ## なぜポリシーの本文が生成物になるのか
 *
 * 「誰にどの行が見えるか」は `access_spec` の `reads` が全部決めている —— ロールの根拠は
 * role_spec、原理の行集合は `scope`、実行者の側の境界は `filters` である。決まっているものを
 * 手で書き写すと、写し間違いを見張る機械が別に要る。束 ⑳-4a までは**名前だけ**を突き合わせて
 * いたので、`..._within_company_id` という名前のポリシーに `using (true)` と書いても全部緑に
 * なった(T4 の見張りテストの宣言が唯一の防波堤だった)。
 *
 * migration が追記専用の歴史であることとの両立は、定型 RPC の本文と同じ手で取る ——
 * **書き出す先のファイル名を仕様に宣言させ**(data_table の `policies_migration` /
 * `functions[].migration`)、SQL が変わる変更では名前を新しくする(T7 が形式と一意性を見る)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { sqlCommentText } from '../kernel/safe-text.js';
import { RPC_BODY_WORDS } from '../messages/messages.js';
import { RLS_WORDS } from '../messages/messages-rls.js';
import type { RoleDef, SpecModel } from '../model/types.js';
import { findField } from '../semantics/domain-index.js';
import { actorEntity } from '../usecase/param-source-facts.js';
import { sqlLiteral } from './guard-to-sql.js';
import { columnType } from './sql-types.js';
import { claimCondition } from './roles-to-sql.js';
import { claimPartsOf, claimText } from '../model/role-claim.js';
import { policyGranteeRoles } from '../model/role-hierarchy.js';
import { type PolicyPlan, boundaryHelperName, helperName } from '../world/index.js';
import type { PlatformProfile } from '../model/product/platform-profile.js';
import { actorIdSql, callerRoles, endUserRoles } from './platform-sql.js';
import { sessionAliveStatement } from './rls-session-alive.js';
import type { PolicyPredicateInput, PolicyProblem } from './rls-predicate.js';
import { policyPredicate } from './rls-predicate.js';
import { identifierProblems } from './identifier-length.js';

/** 実行者の行を引くときの別名。 */
const ACTOR_ALIAS = 'a';

/** 全テーブルが持つ主キー列(表の規約)。 */
const KEY_COLUMN = 'id';

/** 組み立ての結果(SQL 1 枚、または理由つきの失敗)。 */
export type RlsSqlResult =
  | { readonly ok: true; readonly sql: string }
  | { readonly ok: false; readonly problems: readonly PolicyProblem[] };

/** ポリシーの migration の組み立てに要る入力。 */
export interface PolicyMigrationInput extends PolicyPredicateInput {
  /** そのテーブルのポリシーの計画(宣言順)。 */
  readonly plans: readonly PolicyPlan[];
  /** この SQL の正になる仕様ファイル(リポジトリルート相対)。 */
  readonly specFiles: readonly string[];
}

/**
 * 1 テーブル分の RLS(権限・RLS 有効化・select ポリシー全数)の migration を組み立てる。
 *
 * @param input 対象の表・ポリシーの計画・ドメイン仕様
 * @returns SQL 1 枚、または理由つきの失敗
 */
export function buildPolicyMigration(input: PolicyMigrationInput): RlsSqlResult {
  const problems: PolicyProblem[] = [];
  const statements: string[] = [];
  for (const plan of input.plans) {
    const predicate = policyPredicate(plan, input);
    if (!predicate.ok) {
      problems.push(...predicate.problems);
      continue;
    }
    statements.push(...policyStatement(plan, input.table, predicate.sql, input.platform));
  }
  if (problems.length > 0) return { ok: false, problems };
  statements.push(...sessionAliveStatement(input.table, input.platform));
  const target = `public.${input.table}`;
  const grantees = [...new Set(input.plans.flatMap((plan) => granteeNames(plan, input.platform)))].sort().join(', ');
  return identifierChecked(
    [
      ...header(input.specFiles, RLS_WORDS.policiesMigrationNote),
      '',
      ...RLS_WORDS.revokeFirst.map((line) => `-- ${line}`),
      `revoke all on ${target} from ${endUserRoles(input.platform).join(', ')};`,
      ...(grantees === '' ? [] : [`grant select on ${target} to ${grantees};`]),
      '',
      `-- ${RLS_WORDS.enableRls}`,
      `alter table ${target} enable row level security;`,
      ...statements,
      '',
    ].join('\n'),
  );
}

/**
 * 組み立てた SQL の識別子が PostgreSQL の上限(63 バイト)に収まることを見て、収まらなければ失敗にする。
 *
 * ポリシー名・補助関数名は仕様の名前(表・ロール・欄)から組み立てる。超えた分は黙って切り詰められ、
 * 別のポリシー・関数と同じ名前になりうる(`identifier-length.ts`)。
 */
function identifierChecked(sql: string): RlsSqlResult {
  const problems = identifierProblems(sql);
  return problems.length === 0 ? { ok: true, sql } : { ok: false, problems };
}

/** ポリシー 1 本が与える DB のロール名(未ログインのポリシーはログイン中の人にも効く。並びは名前順)。 */
function granteeNames(plan: PolicyPlan, platform: PlatformProfile): readonly string[] {
  return policyGranteeRoles(plan.to)
    .map((grantee) => platform.roles[grantee])
    .sort();
}

/** ポリシー 1 本の文(由来のコメント + 置き換え + 作成)。 */
function policyStatement(
  plan: PolicyPlan,
  table: string,
  predicate: string,
  platform: PlatformProfile,
): readonly string[] {
  const target = `public.${table}`;
  const scope = plan.scope.kind === 'context' ? `context(${plan.scope.entity})` : plan.scope.kind;
  return [
    '',
    `-- ${RLS_WORDS.policyOrigin(plan.by, scope)}`,
    ...(plan.filters.length === 0
      ? []
      : [`-- ${RLS_WORDS.policyBoundary(plan.filters.map((filter) => filter.field).join(', '))}`]),
    ...(plan.when === null ? [] : [`-- ${sqlCommentText(RLS_WORDS.policyCondition(plan.when))}`]),
    `-- ${RLS_WORDS.replacePolicy}`,
    `drop policy if exists ${plan.name} on ${target};`,
    `create policy ${plan.name} on ${target}`,
    `    for select to ${granteeNames(plan, platform).join(', ')}`,
    `    using (${predicate});`,
  ];
}

/** 補助関数の migration の組み立てに要る入力。 */
export interface HelperMigrationInput {
  /** 補助関数にするロール。 */
  readonly role: RoleDef;
  readonly domain: SpecModel;
  /** 集約名 → 物理テーブル名。 */
  readonly tableOf: (entity: string) => string | null;
  /** この SQL の正になる仕様ファイル(リポジトリルート相対)。 */
  readonly specFiles: readonly string[];
  /** プラットフォームの設定(現在の実行者の式・ロール名の写像)。 */
  readonly platform: PlatformProfile;
}

/**
 * グローバルに立つロール 1 つ分の RLS 補助関数の migration を組み立てる。
 *
 * 根拠は 2 通りある —— 実行者の集約に行があること(`kind: authenticated_default`)と、
 * その行の欄の条件(`claim`。boolean の欄は真、state / enum の欄は値の集合に含まれること)である。
 * 両方を書いたロールは「行がある AND 条件を満たす」になる。どれも「実行者自身の行を 1 本読む」形に落ちる。
 *
 * @param input ロール・ドメイン仕様・表名の引き当て
 * @returns SQL 1 枚、または理由つきの失敗
 */
export function buildHelperMigration(input: HelperMigrationInput): RlsSqlResult {
  const grounded = groundOf(input);
  if (grounded === null) return { ok: false, problems: [ungroundedHelper(input.role)] };
  const name = `public.${helperName(input.role.id)}()`;
  return identifierChecked(
    [
      ...header(input.specFiles, RLS_WORDS.helperMigrationNote),
      '',
      ...RLS_WORDS.helperDefiner.map((line) => `-- ${line}`),
      `create or replace function ${name} returns boolean`,
      'language sql',
      'stable',
      'security definer',
      'set search_path = public',
      'as $$',
      `    select exists (select 1 from public.${grounded.table} ${ACTOR_ALIAS}`,
      `        where ${ACTOR_ALIAS}.${KEY_COLUMN} = ${actorIdSql(input.platform)}${grounded.condition});`,
      '$$;',
      '',
      `comment on function ${name} is`,
      `    ${sqlLiteral(RLS_WORDS.helperComment(input.role.label ?? input.role.id, input.role.id))};`,
      '',
      `revoke all on function ${name} from public;`,
      // 補助関数を実行できるロール(判定そのものは誰から呼んでも同じなので、呼べる全ロール)。
      `grant execute on function ${name} to ${callerRoles(input.platform).join(', ')};`,
      '',
    ].join('\n'),
  );
}

/** 境界の補助関数の migration の組み立てに要る入力。 */
export interface BoundaryHelperMigrationInput {
  /** 実行者の欄(`actor.{欄}` の `{欄}`)。 */
  readonly field: string;
  readonly domain: SpecModel;
  /** 集約名 → 物理テーブル名。 */
  readonly tableOf: (entity: string) => string | null;
  /** この SQL の正になる仕様ファイル(リポジトリルート相対)。 */
  readonly specFiles: readonly string[];
  /** プラットフォームの設定(現在の実行者の式・ロール名の写像)。 */
  readonly platform: PlatformProfile;
}

/**
 * 境界(`reads[].filters`)の右辺 1 欄ぶんの補助関数 `public.actor_{欄}()` の migration を組み立てる。
 *
 * 役の補助関数(`is_{role}()`)と同じ作法である —— `stable`・`security definer`・`search_path` の固定・
 * PUBLIC から剥いで呼ぶ全ロールに付け直す。本文は**現在の実行者の行を 1 本だけ読む**ので、引数を
 * 持たない(他人の行の値を引ける口を作らない)。行が無い・未ログインなら NULL を返し、境界の比較は
 * 不成立になる(述語の側が式全体を 2 値に閉じる)。
 *
 * @param input 実行者の欄・ドメイン仕様・表名の引き当て
 * @returns SQL 1 枚、または理由つきの失敗
 */
export function buildBoundaryHelperMigration(input: BoundaryHelperMigrationInput): RlsSqlResult {
  const entity = actorEntity(input.domain);
  const table = entity === null ? null : input.tableOf(entity);
  const field = entity === null ? null : findField(input.domain, entity, input.field);
  if (entity === null || table === null || field === null) {
    return { ok: false, problems: [ungroundedBoundaryHelper(input.field)] };
  }
  const name = `public.${boundaryHelperName(input.field)}()`;
  return identifierChecked(
    [
      ...header(input.specFiles, RLS_WORDS.helperMigrationNote),
      '',
      ...RLS_WORDS.boundaryHelperSource.map((line) => `-- ${line}`),
      ...RLS_WORDS.helperDefiner.map((line) => `-- ${line}`),
      `create or replace function ${name} returns ${columnType(field.type)}`,
      'language sql',
      'stable',
      'security definer',
      'set search_path = public',
      'as $$',
      `    select ${ACTOR_ALIAS}.${input.field} from public.${table} ${ACTOR_ALIAS}`,
      `        where ${ACTOR_ALIAS}.${KEY_COLUMN} = ${actorIdSql(input.platform)};`,
      '$$;',
      '',
      `comment on function ${name} is`,
      `    ${sqlLiteral(RLS_WORDS.boundaryHelperComment(entity, input.field))};`,
      '',
      `revoke all on function ${name} from public;`,
      `grant execute on function ${name} to ${callerRoles(input.platform).join(', ')};`,
      '',
    ].join('\n'),
  );
}

/** 境界の補助関数の本文が引けないときの指摘。 */
function ungroundedBoundaryHelper(field: string): PolicyProblem {
  return {
    message: `境界の補助関数 ${boundaryHelperName(field)} の本文を組み立てられません`,
    suggestion:
      `session: true を宣言した集約(実行者の集約)に欄 ${field} があり、その集約に data_table があることを確かめる` +
      '(境界の右辺は実行者自身の行から読む)',
    counterexample: { field, expected_function: boundaryHelperName(field) },
  };
}

/** 補助関数が読む表と、行があることのほかに課す条件。 */
interface HelperGround {
  readonly table: string;
  /** `claim` の欄の条件(` and a.{欄}…`。無ければ空文字)。 */
  readonly condition: string;
}

/** そのロールの根拠が読む実行者の行(`claim` はその欄の条件も課す。boolean の欄は真、state / enum の欄は値の集合)。 */
function groundOf(input: HelperMigrationInput): HelperGround | null {
  const claim = claimPartsOf(input.role);
  const entity = claim === null ? actorEntity(input.domain) : claim.entity;
  const table = entity === null ? null : input.tableOf(entity);
  if (entity === null || table === null) return null;
  if (claim === null) return { table, condition: '' };
  if (findField(input.domain, entity, claim.field) === null) return null;
  return { table, condition: ` and ${claimCondition(ACTOR_ALIAS, claim.field, claim.values)}` };
}

/** 根拠の行が引けないときの指摘。 */
function ungroundedHelper(role: RoleDef): PolicyProblem {
  return {
    message: `ロール ${role.id} の RLS 補助関数の本文を組み立てられません`,
    suggestion:
      'claim の参照先(実行者の集約とその欄)が実在し、その集約に data_table があることを確かめる' +
      '(claim を持たないグローバルロールは session: true を宣言した集約の行を見る)',
    counterexample: { role: role.id, claim: claimText(role) },
  };
}

/** 先頭の AUTO-GENERATED ヘッダ(SQL コメント)。 */
function header(specFiles: readonly string[], note: readonly string[]): readonly string[] {
  return [
    `-- ${RPC_BODY_WORDS.generatedHeader}`,
    '--',
    ...RPC_BODY_WORDS.generatedNote.map((line) => `-- ${line}`),
    ...specFiles.map((file) => `--   - ${sqlCommentText(file)}`),
    '--',
    ...note.map((line) => `-- ${line}`),
  ];
}

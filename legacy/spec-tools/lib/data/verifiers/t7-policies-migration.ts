/**
 * T7 **RLS のポリシー本文の出どころ**(`policies_migration` と RLS 補助関数)の検査。
 *
 * 束 ⑳-4a で「ポリシーの `USING` 句も生成物」になった。生成物である以上、**どこへ書き出すか**を
 * 仕様が宣言していなければならない(migration は追記専用の歴史なので、名前が宣言にあることが
 * 「SQL が変わったら名前を新しくする」という 1 手を成立させる。migrations.md §生成 migration)。
 *
 * 見るのは 5 つである。
 *   1. **`reads` を持つ表は `policies_migration` が必須**(= `access_spec` がある表は全部)。
 *      内部テーブル(`internal: true`)は持てない —— ポリシー 0 本が期待だからである。
 *   2. 名前が `{14 桁}_policies_{テーブル名}.sql` の形で、**全 data_table を通して一意**
 *      (`functions[].migration` とも衝突しない。生成器は同じファイルを 2 度書けない)。
 *   3. ポリシーが要求する **RLS 補助関数と宣言が過不足なく対応する** —— グローバルに立つロール
 *      (セッションから立つ `kind` と実行者自身の行の欄で立つ `claim`)の根拠は補助関数に逃がすので、
 *      その関数が実行者の集約の data_table に `kind: helper` + `role:` + `migration:` で宣言されて
 *      いること。関数名は `is_{ロール}` に固定である(生成器が名前を導くので、宣言がずれたら参照が
 *      外れる)。逆に、**要求されていないロールを書いた宣言**も落ちる(判定と理由は
 *      `t7-rls-helpers.ts` §宣言と生成物は両方向で一致しなければならない)。
 *      テナント境界(`reads[].filters`)の右辺の値も、実行者の行を読む補助関数 `actor_{欄}` に逃がす
 *      (`kind: helper` + `actor_field:` + `migration:`。両方向の一致は `t7-boundary-helpers.ts`)。
 *   4. **補助関数の migration の連番 < 全 policies の連番** —— ポリシーが関数を参照するので、
 *      新しい DB を作り直すときに関数が先に存在していなければならない。
 *   5. **本文が実際に組み立てられる**(生成器が報告する前提そのもの)。判定を書き写さず
 *      `buildPolicyMigration` / `buildHelperMigration` を呼ぶので、ここが緑なら生成器は
 *      `preconditionFailure` に落ちない(T6 と同じ流儀)。
 *   6. **状態の条件(`reads[].when`)が、ポリシーが出ない規則に書かれていない**(束 §14)。
 *      刈り込まれる規則や `scope: none` の規則に書いた `when` は 1 文字も効かないのに、
 *      期待表にも `spec:diff` にも出ない —— `when` を買った目的(「書いたのに効いていない宣言」を
 *      無くすこと)に正面から反するので error にする。判定は刈り込みと同じ 1 つの定義から出る
 *      (`lib/world/rls-plan.ts` の `deadConditions`)。
 *
 * このファイルの責務は**ポリシー側**の判定(1・2・4・5・6)である。補助関数側の判定(3。宣言と生成物の
 * 両方向の一致)は `t7-rls-helpers.ts` が持ち、ここはそれを 1 方向に読むだけである(補助関数側は
 * ポリシー側を読まない)。
 */

import type { Finding } from '../../kernel/finding.js';
import type { AccessSpec, SpecModel } from '../../model/types.js';
import { findAccessSpec } from '../../semantics/domain-lookup.js';
import { boundaryHelperFields, deadConditions, helperRoles, policyPlans, readPlans, type PolicyPlan } from '../../world/index.js';
import { buildPolicyMigration } from '../../sql/rls-migration.js';
import type { PlatformProfile } from '../../model/product/platform-profile.js';
import { privilegedRole } from '../../sql/platform-sql.js';
import { checkDeclaredHelpers, checkHelper, sequenceOf, t7Finding } from './t7-rls-helpers.js';
import { checkBoundaryHelper, checkDeclaredBoundaryHelpers } from './t7-boundary-helpers.js';
import type { DataTableSpec, DataTableSpecModel } from '../../model/data/types.js';
import { MIGRATION_SEQUENCE } from './migration-sequence.js';

/** ポリシーの生成 migration の名前の中ほど。 */
const INFIX = '_policies_';

/**
 * 全 data_table の RLS(ポリシーの生成先と補助関数)を検証する。
 *
 * @param domain 構築済みのドメイン仕様モデル(`reads` とロール定義の出どころ)
 * @param dataTables 読み込み済みの data_table
 * @param platform プラットフォームの設定(ポリシーと補助関数の本文を組み立てるのに使う)
 * @returns 違反のリスト
 */
export function verifyPoliciesMigration(
  domain: SpecModel,
  dataTables: DataTableSpecModel,
  platform: PlatformProfile,
): Finding[] {
  if (!dataTables.available) return [];
  const findings: Finding[] = [];
  const seen = new Map<string, string>(declaredFunctionMigrations(dataTables));
  const policySequences: number[] = [];
  // ポリシーが実際に要求したロール(宣言の側から見た過不足を最後に見るための母集合)。
  const required = new Set<string>();
  // 境界(`filters`)が要求した実行者の欄(刈り込む前の計画から。隠し列のマスクも同じ述語を呼ぶ)。
  const requiredFields = new Set<string>();
  for (const table of dataTables.tables) {
    const declared = table.policiesMigration;
    const access = table.entity === undefined ? null : findAccessSpec(domain, table.entity);
    if (access === null) {
      if (declared !== undefined) findings.push(unexpectedDeclaration(table));
      continue;
    }
    const plans = policyPlans(access, table.table, domain.roles.roles);
    // 何を要求するかは宣言の有無に依らない(宣言が無い表の要求も母集合に入れる。
    // 入れないと「宣言が 1 つ足りない」ときに「要求されない補助関数」が連鎖して鳴る)。
    for (const role of helperRoles(plans, domain.roles.roles)) required.add(role);
    const fields = boundaryHelperFields(readPlans(access, table.table, domain.roles.roles));
    for (const field of fields) requiredFields.add(field);
    if (declared === undefined) {
      findings.push(missingDeclaration(table));
      continue;
    }
    findings.push(...checkName(declared, table));
    const first = seen.get(declared);
    if (first !== undefined) findings.push(duplicated(declared, first, table));
    seen.set(declared, `table ${table.table}`);
    policySequences.push(sequenceOf(declared));
    findings.push(...checkTable(domain, dataTables, { table, access, plans, fields }, platform));
    findings.push(...checkDeadConditions(domain, table, access, platform));
  }
  findings.push(...checkDeclaredHelpers(dataTables, policySequences, required));
  findings.push(...checkDeclaredBoundaryHelpers(dataTables, requiredFields));
  return findings;
}

/** 全 data_table の `functions[].migration`(名前の衝突を見るための母集合)。 */
function declaredFunctionMigrations(dataTables: DataTableSpecModel): readonly [string, string][] {
  return dataTables.tables.flatMap((table) =>
    table.functions
      .filter((fn) => fn.migration !== undefined)
      .map((fn) => [fn.migration ?? '', `function ${fn.name}`] as [string, string]),
  );
}

/** `reads` を持つ表に宣言が無い。 */
function missingDeclaration(table: DataTableSpec): Finding {
  return t7Finding({
    message: `${table.table} は access_spec を持つ表ですが policies_migration の宣言がありません`,
    location: { ...table.location, pointer: 'policies_migration' },
    suggestion:
      `policies_migration: {14 桁の連番}${INFIX}${table.table}.sql を宣言する` +
      '(RLS のポリシーは reads から生成されるので、書き出す先が宣言に無いと生成できない)',
    counterexample: { table: table.table, expected: `{14 桁}${INFIX}${table.table}.sql` },
  });
}

/** ポリシーを持たない表(内部テーブル)が宣言している。 */
function unexpectedDeclaration(table: DataTableSpec): Finding {
  return t7Finding({
    message: `${table.table} は access_spec を持たない表なので policies_migration を宣言できません`,
    location: { ...table.location, pointer: 'policies_migration' },
    suggestion:
      '内部テーブルは読み取りポリシー 0 本が期待である(誰にも読ませない)。行を削除するか、' +
      'ドメイン仕様に載せて access_spec の reads を書く',
    counterexample: { table: table.table, policies_migration: table.policiesMigration ?? '' },
  });
}

/** 名前が `{14 桁}_policies_{テーブル名}.sql` の形かを見る。 */
function checkName(migration: string, table: DataTableSpec): Finding[] {
  const expected = `${INFIX}${table.table}.sql`;
  const index = migration.indexOf('_');
  const sequence = index === -1 ? '' : migration.slice(0, index);
  if (MIGRATION_SEQUENCE.test(sequence) && migration.slice(index) === expected) return [];
  return [
    t7Finding({
      message: `policies_migration ${migration} が表 ${table.table} から導かれる名前になっていません`,
      location: { ...table.location, pointer: 'policies_migration' },
      suggestion:
        `"{14 桁の連番}${expected}" の形に直す` +
        '(名前から「どの表のポリシーか」が一意に読めることが、生成先の唯一の手がかり)',
      counterexample: { table: table.table, migration, expected: `{14 桁}${expected}` },
    }),
  ];
}

/** 同じ migration 名を 2 つの宣言が使っている。 */
function duplicated(migration: string, first: string, table: DataTableSpec): Finding {
  return t7Finding({
    message: `policies_migration ${migration} が ${first} と重複しています`,
    location: { ...table.location, pointer: 'policies_migration' },
    suggestion: '生成物 1 つにつき migration 1 本にする(生成器は同じファイルを 2 度書けない)',
    counterexample: { table: table.table, migration, first },
  });
}

/**
 * 状態の条件が**効く場所に書かれている**かを見る(束 §14)。
 *
 * @param domain ドメイン仕様(ロール階層を引く)
 * @param table 対象の表
 * @param access その集約のアクセス宣言
 * @returns 違反のリスト(効かない条件 1 件につき 1 つ)
 */
function checkDeadConditions(
  domain: SpecModel,
  table: DataTableSpec,
  access: AccessSpec,
  platform: PlatformProfile,
): Finding[] {
  return deadConditions(access, table.table, domain.roles.roles).map((dead) =>
    t7Finding({
      message:
        `${access.entity} の reads(by: ${dead.by})の when "${dead.when}" は効きません` +
        `(${DEAD_REASON[dead.reason](dead.coveredBy ?? '')})`,
      location: { ...access.location, pointer: 'reads' },
      suggestion: DEAD_REMEDY[dead.reason](dead.coveredBy ?? '', privilegedRole(platform)),
      counterexample: {
        entity: access.entity,
        by: dead.by,
        when: dead.when,
        reason: dead.reason,
        covered_by: dead.coveredBy ?? '',
      },
    }),
  );
}

/** なぜその条件が効かないか(理由ごとの 1 文)。 */
const DEAD_REASON: Readonly<Record<'pruned' | 'invisible' | 'bypass', (covered: string) => string>> = {
  pruned: (covered) => `ロール ${covered} が無条件で同じ行を見せています`,
  invisible: () => 'scope: none なのでそのロールのポリシーがそもそもありません',
  bypass: () => 'RLS をバイパスする内部実行ロールなのでポリシーを持ちません',
};

/** どう直すか(理由ごとの 1 文。第 2 引数は内部実行にあたる DB のロール名 = プラットフォームの設定が決める)。 */
const DEAD_REMEDY: Readonly<Record<'pruned' | 'invisible' | 'bypass', (covered: string, privileged: string) => string>> = {
  pruned: (covered) =>
    `条件は**上界の規則**(by: ${covered})に書く —— その規則が無条件でその行を見せている限り、` +
    '狭い規則に条件を足してもポリシーは 1 本も出ない' +
    '(RLS のポリシーは論理和で合成されるので、行集合として冗長な規則は刈り込まれる)',
  invisible: () =>
    'scope: none の規則は「1 行も見えない」の宣言である。条件で見せ分けたいならスコープを開いてから when を書く',
  bypass: (_covered, privileged) =>
    `内部実行ロールは RLS の対象外である(${privileged} がバイパスする)。読み取りを絞りたいなら` +
    '人のロールの規則に書く',
};

/** 1 表分の検査の対象(表の宣言・その access_spec・組み立てた計画)。 */
interface PolicyTarget {
  readonly table: DataTableSpec;
  readonly access: AccessSpec;
  readonly plans: readonly PolicyPlan[];
  /** 境界が要求する実行者の欄(補助関数が要るもの)。 */
  readonly fields: readonly string[];
}

/**
 * その表のポリシーが**実際に組み立てられる**ことと、要求する補助関数が宣言されていることを見る。
 *
 * @param domain ドメイン仕様
 * @param dataTables 全 data_table
 * @param target 対象の表・その access_spec・計画
 * @param platform プラットフォームの設定
 * @returns 違反のリスト
 */
function checkTable(
  domain: SpecModel,
  dataTables: DataTableSpecModel,
  target: PolicyTarget,
  platform: PlatformProfile,
): Finding[] {
  const { table, access, plans } = target;
  const tableOf = (entity: string): string | null =>
    dataTables.tables.find((candidate) => candidate.entity === entity)?.table ?? null;
  const built = buildPolicyMigration({
    plans,
    entity: access.entity,
    table: table.table,
    domain,
    tableOf,
    roles: domain.roles.roles,
    platform,
    specFiles: [],
  });
  const findings: Finding[] = built.ok
    ? []
    : built.problems.map((problem) =>
        t7Finding({
          message: problem.message,
          location: { ...access.location, pointer: 'reads' },
          suggestion: problem.suggestion,
          counterexample: problem.counterexample,
        }),
      );
  for (const role of helperRoles(plans, domain.roles.roles)) {
    findings.push(...checkHelper(domain, dataTables, tableOf, role, table, platform));
  }
  for (const field of target.fields) {
    findings.push(...checkBoundaryHelper(domain, dataTables, tableOf, field, table, platform));
  }
  return findings;
}

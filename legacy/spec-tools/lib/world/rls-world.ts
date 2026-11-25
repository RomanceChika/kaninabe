/**
 * 表 1 枚ぶんの**world の設計図**(束 ⑳-4b)。
 *
 * ⑳-4a の突合が言えるのは「生成物どおりのポリシーが当たっている」までである —— 述語の翻訳
 * そのものが間違っていれば、生成物と実 DB は仲良く同じ間違いをする。そこで「宣言どおりの行集合が
 * 返るか」を実 DB で確かめる。そのために要るのが**world**である: 実行者を何人作り、どの行を
 * 誰に束縛して置くか。
 *
 * ## world の形(1 表につき 1 つ)
 *
 * - 実行者は「その表のポリシーに現れるロール」ごとに 1 人 + **束縛を持たない既定のログイン
 *   実行者(他人)** + 未ログイン + **ログインしているが実行者の集約に行が無い人**。ロールごとに
 *   分けるのは、`claim` の欄を真にする実行者とそうでない実行者を同じ人にできないからである。
 *   境界(`filters`)を宣言した表にはもう 1 人足す(`rls-world-roles.ts` の `actorsOf`)。
 * - 行は**実行者ごとに 1 系統**。その系統のすべての参照は同じ系統の行を指し、実行者の集約への
 *   参照はその系統の実行者自身の行になる —— したがって「A に束縛される行」と「S に束縛される行」が
 *   同時に存在し、`own` / `context(X)` のポリシーは前者だけを通さなければならない。**例外は
 *   束縛が名指しする列で、その系統の実行者の束縛でなければ別の行(別人)を指す** ——
 *   同じ相手を指す参照 2 本を 1 行に畳むと、2 つの束縛が必ず同時に立つ world になる。
 * - 境界(`filters`)を宣言した列には、その系統の実行者の行の欄の値を写す(親の列なら、その系統の
 *   親の行に写す)。系統が違えば値も違うので、「他のテナントの行が返らない」がそのまま検査になる。
 * - **行の条件(`claim`。ADR-0018)を宣言していれば、実行者を満たす人と満たさない人に分ける。** 満たす人の行の
 *   欄は条件を満たす値(boolean は真・state / enum は値の集合の先頭。state / enum の欄に `true` は置かない)、
 *   満たさない人(`unmet`)は根拠(束縛・claim)が成立したまま、既定のログインロールの条件・含意の先の条件だけを
 *   満たさない値を置く。ポリシーが含意の先の条件を落とすと、満たさない人に行が見えてしまう。
 *
 * ## オラクルは別の写像である
 *
 * 期待(見えるべき id)を計算するのは実行する側の TS(`@kaninabe/runtime/testing/rls/oracle`)であり、SQL の述語を
 * 組み立てる `rls-predicate.ts` を呼ばない。設計図が渡すのは**ロールの根拠と読み取り規則**
 * (どの集約のどの列を実行者と比べるか)だけで、そこから行集合を出すのはオラクルの仕事である。
 *
 * **したがって設計図はポリシーの計画(`policyPlans`)を 1 つも運ばない。** 「未ログインに
 * `grant select` が出るか」をここから渡していたあいだ、期待と生成 SQL は刈り込みの規則を
 * 共有していた —— 翻訳器がポリシーを誤って刈り込めば、migration も期待も同じように消えて
 * 検査は緑のままになる。権限の有無もオラクルが `reads` とロールの `kind` から自分で導く。
 * 計画を使うのは**実行者を何人作るか**(world の広さ)だけで、これは期待の側ではない。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { AccessSpec, SpecModel } from '../model/types.js';
import type { DataTableSpec } from '../model/data/types.js';
import { actorEntity } from '../usecase/param-source-facts.js';
import { policyPlans } from './rls-plan.js';
import type { RlsWorldProblem } from './rls-world-derivable.js';
import {
  missingBasis,
  rowProblems,
  undecidableWhen,
  unplaceableWhenRow,
  unreachable,
} from './rls-world-derivable.js';
import type { RlsWorldActor, RlsWorldBinding } from './rls-world-roles.js';
import { actorsOf, bindingPlaces, boundFields, rlsWorldRoles } from './rls-world-roles.js';
import type { RlsWorldRow } from './rls-world-rows.js';
import { buildBranch } from './rls-world-rows.js';
import { decorateRow } from './rls-world-decorate.js';
import { fieldOrder } from './rls-world-values.js';
import { whenCounterexamples, whenRowOf } from './rls-world-when.js';
import type { RlsWorldRead } from './rls-world-reads.js';
import { readOf, unresolvedFilterEntity } from './rls-world-reads.js';

export type { RlsWorldRead } from './rls-world-reads.js';
export type { RlsWorldActor } from './rls-world-roles.js';

/** 表 1 枚ぶんの world。 */
export interface RlsWorld {
  readonly table: string;
  readonly entity: string;
  /** 実行者の集約の物理テーブル名。 */
  readonly actorTable: string;
  readonly actors: readonly RlsWorldActor[];
  /** 挿入順の行。 */
  readonly rows: readonly RlsWorldRow[];
  /** 検査の的になる行(実行者ごとに 1 つ)。 */
  readonly targets: readonly string[];
  readonly reads: readonly RlsWorldRead[];
}

/** world の組み立ての結果。 */
export type RlsWorldResult =
  | { readonly ok: true; readonly world: RlsWorld }
  | { readonly ok: false; readonly problems: readonly RlsWorldProblem[] };

/** world を組み立てるのに要る入力。 */
export interface RlsWorldInput {
  readonly domain: SpecModel;
  /** 全 data_table(参照先の表名と執行点を引く)。 */
  readonly tables: readonly DataTableSpec[];
}

/**
 * 表 1 枚ぶんの world を組み立てる。
 *
 * @param table 対象の data_table(`entity` と `policies_migration` を持つもの)
 * @param input ドメイン仕様と全 data_table
 * @returns world、または作れない理由
 */
export function buildRlsWorld(table: DataTableSpec, input: RlsWorldInput): RlsWorldResult {
  const entity = table.entity;
  const access = entity === undefined ? undefined : accessOf(input.domain, entity);
  const actor = actorEntity(input.domain);
  const actorTable = actor === null ? null : tableOf(input.tables, actor);
  if (entity === undefined || access === undefined || actor === null || actorTable === null) {
    return { ok: false, problems: [missingBasis(table, actor)] };
  }
  const plans = policyPlans(access, table.table, input.domain.roles.roles);
  const actors = actorsOf(input.domain, access, plans.map((plan) => plan.by));
  const unresolved = unresolvedFilterEntity(input.domain, access);
  if (unresolved !== null) return { ok: false, problems: [unreachable(table, unresolved)] };
  const build = branches(table, access, input, { actorEntity: actor, actors });
  if (!build.ok) return build;
  const spine = [...new Set(build.rows.map((row) => row.entity))];
  const problems = spine.flatMap((name) => spineProblems(input, name, table, entity));
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    world: {
      table: table.table,
      entity,
      actorTable,
      actors,
      rows: build.rows,
      targets: build.targets,
      reads: access.reads.map((rule) => readOf(input.domain, access.entity, rule)),
    },
  };
}

/** その集約の access_spec。 */
function accessOf(domain: SpecModel, entity: string): AccessSpec | undefined {
  for (const specs of domain.aggregates.values()) {
    if (specs.access?.entity === entity) return specs.access;
  }
  return undefined;
}

/** 集約 → 物理テーブル名。 */
function tableOf(tables: readonly DataTableSpec[], entity: string): string | null {
  return tables.find((candidate) => candidate.entity === entity)?.table ?? null;
}

/** 系統ごとの行を組み立てた結果。 */
type BranchesResult =
  | { readonly ok: true; readonly rows: readonly RlsWorldRow[]; readonly targets: readonly string[] }
  | { readonly ok: false; readonly problems: readonly RlsWorldProblem[] };

/** 実行者ごとの系統を組み立て、境界の列と `claim` の欄を差し込む。 */
function branches(
  table: DataTableSpec,
  access: AccessSpec,
  input: RlsWorldInput,
  world: { readonly actorEntity: string; readonly actors: readonly RlsWorldActor[] },
): BranchesResult {
  let seq = 0;
  const next = (): number => {
    seq += 1;
    return seq;
  };
  const needed = boundFields(input.domain, access);
  const places = bindingPlaces(input.domain);
  const roles = rlsWorldRoles(input.domain);
  // 状態の条件(`reads[].when`)を偽にする行を、系統ごとにもう 1 つ置く(束 §14)。
  // 決められなければ world そのものを作らない —— 反例の無い world では条件を落としても緑になる。
  const counterexamples = whenCounterexamples(input.domain, access);
  if (!counterexamples.ok) return { ok: false, problems: [undecidableWhen(table, counterexamples.reasons)] };
  const order = fieldOrder(input.domain, access.entity) ?? new Map<string, number>();
  const rows: RlsWorldRow[] = [];
  const targets: string[] = [];
  for (const actor of world.actors) {
    // 未ログインと「行が無い人」は系統を持たない(系統の行はすべて実行者の行から遡って作る)。
    if (actor.row === null) continue;
    const built = buildBranch(
      {
        domain: input.domain,
        tableOf: (name) => tableOf(input.tables, name),
        defaultsOf: (name) => input.tables.find((candidate) => candidate.entity === name)?.defaults ?? {},
        actorEntity: world.actorEntity,
        requiredFields: (name) => needed.get(name) ?? [],
        boundColumns: (name) => places.filter((place) => place.entity === name).map((place) => place.column),
        ownBinding: ownBindingOf(roles, actor.role),
        next,
      },
      actor.key,
      access.entity,
    );
    if (!built.ok) return { ok: false, problems: built.unreachable.map((name) => unreachable(table, name)) };
    const target = built.branch.byEntity.get(access.entity);
    if (target === undefined) return { ok: false, problems: [unreachable(table, access.entity)] };
    targets.push(target);
    const actorRow = built.branch.rows.find((row) => row.actor === actor.key);
    const decorated = built.branch.rows.map((row) =>
      decorateRow({ row, actor, domain: input.domain, access, tables: input.tables, actorRow }),
    );
    rows.push(...decorated);
    const targetRow = decorated.find((row) => row.key === target);
    if (targetRow === undefined) return { ok: false, problems: [unreachable(table, access.entity)] };
    for (const counterexample of counterexamples.rows) {
      const made = whenRowOf(targetRow, counterexample, {
        domain: input.domain,
        entity: access.entity,
        next,
        order,
      });
      if (!made.ok) return { ok: false, problems: [unplaceableWhenRow(table, made.unplaceable)] };
      rows.push(made.row);
      targets.push(made.row.key);
    }
  }
  return { ok: true, rows, targets };
}

/** その実行者の役が束縛する場所(束縛を持たない役なら `null`)。 */
function ownBindingOf(
  roles: readonly { readonly id: string; readonly binding: RlsWorldBinding | null }[],
  role: string,
): RlsWorldBinding | null {
  return roles.find((candidate) => candidate.id === role)?.binding ?? null;
}

/**
 * その集約の行が置けるか(執行点の条件が宣言から読めるか)。
 *
 * **対象の表の理由は全部並べ、参照先の表の理由は 1 行に畳む。** 1 枚の表が置けないと、その表を
 * 参照する表ぜんぶが同じ理由で止まる —— 全部に全理由を並べると、直す場所は 1 つなのに報告が
 * 表の数だけ増える(読む人は「何か所直すのか」を数え違える)。
 */
function spineProblems(
  input: RlsWorldInput,
  entity: string,
  target: DataTableSpec,
  targetEntity: string,
): readonly RlsWorldProblem[] {
  const table = input.tables.find((candidate) => candidate.entity === entity);
  if (table === undefined) return [];
  const problems = rowProblems(table, input.domain, input.tables);
  if (entity === targetEntity || problems.length === 0) return problems;
  const first = problems[0];
  return [
    {
      message: `${target.table} の world に要る ${table.table} の行を置けません(${first?.message ?? ''})`,
      fact: `${table.table} の側を直せばこの表も実行できるようになる。${first?.fact ?? ''}`,
      suggestion: `${table.table} の側を直せばこの表も実行できるようになる。${first?.suggestion ?? ''}`,
      counterexample: { table: target.table, blocked_by: table.table, ...first?.counterexample },
    },
  ];
}

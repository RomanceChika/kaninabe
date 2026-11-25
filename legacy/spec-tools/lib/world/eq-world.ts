/**
 * 操作 1 つを実 DB で実行するための**world の設計図**(束 ⑳-5a)。
 *
 * ⑳-4b の world(`rls-world.ts`)は「誰にどの行が**見えるか**」を実行するためのものだった。ここは
 * 「誰がその行を**動かせるか**」を実行するための world である。違いは 2 つだけで、どちらも実行者の
 * 出どころから来る:
 *
 * - RLS の実行者は**ログインした人**(JWT)だったが、RPC の実行者は**引数**である
 *   (`p_actor_id` + `p_actor_roles`)。したがって world に要るのは認証ユーザではなく、
 *   実行者の集約の行と、その行との関係が立つように置かれた対象の行である。
 * - 対象の行は**動く**(状態が変わる・消える・生まれる)ので、world は「1 度置いて全部実行する」
 *   ではなく「実行する直前に置き直す」形で使う。設計図はそのための素材(行の値と参照)を運ぶ。
 *
 * ## 実行者の並び(1 集約につき 1 通り)
 *
 * その集約の操作が根拠にするロールごとに 1 人ずつ置く —— 束縛(`binding`)の役は、その役が
 * 名指しする列がその人を指す系統を 1 本持ち、`claim` の役は実行者自身の行の欄を真にする。
 * それに「どの役も立たない既定のログイン実行者」と「実行者の集約に行が無い人」を足す。行の条件(`claim`。
 * ADR-0018)を宣言していれば、**根拠は成立しているが条件を満たさない人**(`unmet`。未ログインと同じ側のロール配列だけを渡す)も足す。
 * **役ごとに人を分けるのは必須である** —— 1 人に 2 つの根拠を持たせると、片方だけが立つ場合を
 * world が表現できない(⑳-4b の `rls-world-rows.ts` が束縛の列を分ける理由と同じ)。
 *
 * ## 期待はここから来ない
 *
 * 設計図が運ぶのは**world の形**だけである。「その実行者がその操作を実行できるか」を決めるのは
 * 実行する側が呼ぶ engine(`canFire` / `canCreate` / `canWrite` / `canDelete`)であり、
 * その入力(規則の表・ガードの変数・ロールの根拠)は実行計画(`operation-plans.ts`)が既に
 * 運んでいる。設計図がもう一度それを写すと、**期待と執行が同じ写し間違いを共有する**。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../model/types.js';
import type { DataTableSpec } from '../model/data/types.js';
import { actorEntity } from '../usecase/param-source-facts.js';
import type { RlsWorldProblem } from './rls-world-derivable.js';
import { missingBasis, rowProblems, unreachable } from './rls-world-derivable.js';
import { bindingPlaces } from './rls-world-roles.js';
import type { RlsWorldRow } from './rls-world-rows.js';
import { buildBranch, withValues } from './rls-world-rows.js';
import { holdingValues, unmetValues } from './rls-world-claims.js';
import { actorsOf, spareRows } from './eq-world-actors.js';
import type { EqActor, EqWorldInput, EqWorldResult } from './eq-world-types.js';
import { recordedStatesOf } from './eq-recorded.js';

/**
 * 集約 1 つぶんの world を組み立てる。
 *
 * @param aggregate 対象の集約
 * @param input ドメイン仕様・全 data_table・その集約の操作が使う役
 * @returns world、または作れない理由
 */
export function buildEqWorld(aggregate: string, input: EqWorldInput): EqWorldResult {
  const table = input.tables.find((candidate) => candidate.entity === aggregate);
  const actor = actorEntity(input.domain);
  const actorTable = actor === null ? null : tableOf(input.tables, actor);
  if (table === undefined || actor === null || actorTable === null) {
    return { ok: false, problems: [missingBasis(table ?? placeholderTable(aggregate), actor)] };
  }
  const actors = actorsOf(input, aggregate);
  const built = branches(table, aggregate, input, { actorEntity: actor, actors });
  if (!built.ok) return built;
  const spine = [...new Set(built.rows.map((row) => row.entity))];
  const problems = spine.flatMap((name) => spineProblems(input, name, table, aggregate));
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    world: {
      aggregate,
      table: table.table,
      actorTable,
      actors: built.actors,
      rows: built.rows,
      records: recordedStatesOf(input.domain, aggregate),
    },
  };
}

/** 集約 → 物理テーブル名。 */
function tableOf(tables: readonly DataTableSpec[], entity: string): string | null {
  return tables.find((candidate) => candidate.entity === entity)?.table ?? null;
}

/** data_table が無い集約の理由を報告するための最小の器(`missingBasis` が読む欄だけ)。 */
function placeholderTable(aggregate: string): Pick<DataTableSpec, 'table' | 'entity'> {
  return { table: aggregate, entity: aggregate };
}

/** 系統ごとの行を組み立てた結果。 */
type BranchesResult =
  | { readonly ok: true; readonly rows: readonly RlsWorldRow[]; readonly actors: readonly EqActor[] }
  | { readonly ok: false; readonly problems: readonly RlsWorldProblem[] };

/** 実行者ごとの系統を組み立て、`claim` の欄を差し込む。 */
function branches(
  table: DataTableSpec,
  aggregate: string,
  input: EqWorldInput,
  world: { readonly actorEntity: string; readonly actors: readonly EqActor[] },
): BranchesResult {
  let seq = 0;
  const next = (): number => {
    seq += 1;
    return seq;
  };
  const places = bindingPlaces(input.domain);
  const needed = new Map<string, string[]>();
  for (const place of places) {
    const list = needed.get(place.entity) ?? [];
    if (!list.includes(place.column)) list.push(place.column);
    needed.set(place.entity, list);
  }
  const rows: RlsWorldRow[] = [];
  const actors: EqActor[] = [];
  for (const actor of world.actors) {
    if (actor.row === null) {
      actors.push(actor);
      continue;
    }
    const own = ownBindingOf(input, actor);
    const built = buildBranch(
      {
        domain: input.domain,
        tableOf: (name) => tableOf(input.tables, name),
        defaultsOf: (name) => input.tables.find((candidate) => candidate.entity === name)?.defaults ?? {},
        actorEntity: world.actorEntity,
        requiredFields: (name) => needed.get(name) ?? [],
        boundColumns: (name) => places.filter((place) => place.entity === name).map((place) => place.column),
        ownBinding: own,
        next,
      },
      actor.key,
      aggregate,
      // 本人ロール(束縛が的の `id` 自身)のときだけ的を自分の行のままにする。
      { separateTarget: own === null || own.column !== 'id' },
    );
    if (!built.ok) return { ok: false, problems: built.unreachable.map((name) => unreachable(table, name)) };
    rows.push(...built.branch.rows.map((row) => decorate(row, actor, input.domain)));
    actors.push({ ...actor, target: built.branch.targetKey ?? actor.target });
  }
  const spares = spareRows(input, world.actorEntity, {
    next,
    places,
    table,
    tableOf: (name) => tableOf(input.tables, name),
  });
  if (!spares.ok) return { ok: false, problems: spares.problems };
  return { ok: true, rows: [...rows, ...spares.rows], actors };
}

/** その人の役が束縛する場所(束縛の役でなければ `null`)。 */
function ownBindingOf(
  input: EqWorldInput,
  actor: EqActor,
): { readonly entity: string; readonly column: string } | null {
  if (actor.basis !== 'binding') return null;
  const [entity, column] = (input.bindingRoles.get(actor.role) ?? '').split('.');
  return entity === undefined || column === undefined ? null : { entity, column };
}

/**
 * 実行者自身の行に、その人のロールの条件を満たす値(満たさない人なら条件の外の値)を差し込む。
 *
 * 満たす人: boolean の `claim` の欄は真・state / enum の欄は値の集合の先頭・既定のログインロールの条件も満たす値。
 * 満たさない人(`unmet`): その条件を持つロールの欄だけが外の値。state / enum の欄に `true` は置かない(ADR-0018)。
 */
function decorate(row: RlsWorldRow, actor: EqActor, domain: SpecModel): RlsWorldRow {
  if (row.actor !== actor.key || row.entity !== actorEntity(domain)) return row;
  const values =
    actor.unmet === undefined ? holdingValues(domain, actor.role) : unmetValues(domain, actor.role, actor.unmet);
  return Object.keys(values).length === 0 ? row : withValues(row, values);
}

/**
 * その集約の行が置けるか(執行点の条件が宣言から読めるか)。
 *
 * 判定は ⑳-4b とまったく同じ関数から出る —— 「行を置けるか」は RLS を実行するときも操作を実行する
 * ときも同じ問いであり、2 か所で別々に決めると片方だけが直る。
 */
function spineProblems(
  input: EqWorldInput,
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
      fact: `${table.table} の側を直せばこの集約の操作も実行できるようになる。${first?.fact ?? ''}`,
      suggestion: `${table.table} の側を直せばこの集約の操作も実行できるようになる。${first?.suggestion ?? ''}`,
      counterexample: { table: target.table, blocked_by: table.table, ...first?.counterexample },
    },
  ];
}

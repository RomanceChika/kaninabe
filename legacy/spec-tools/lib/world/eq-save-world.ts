/**
 * 保存点(複合 RPC)1 つを実 DB で呼び出すための**world の設計図**(束 ⑳-5a2)。
 *
 * 単発の操作の world(`eq-world.ts`)との違いは 1 つだけで、**的が複数ある**ことである。
 * 保存点は「判断材料として読む集約」と「作る行が参照する集約」と「動かす既存の行の集約」を
 * 同時に要求するので、その全部が**同じ 1 本の系統**に載っていなければならない —— 系統を
 * 分けると集約をまたぐ行内比較(「この枠の催しは、その演目の催しと同じ」)が必ず落ちる
 * (`rls-world-rows.ts` の冒頭と同じ理由)。`buildBranch` の的を配列で取る口はそのために開けた。
 *
 * **保存点が作る集約の行は置かない。** その行は保存点自身が作るので、world に要るのは
 * 「作るときに指す相手」だけである。したがって「行を宣言から置けない集約」(T8 / T11 が
 * 報告する形)を**作る**保存点は、それでも world を作れる —— ⑳-5a の時点の見込み
 * (`entry_self.register` は `entry_participant` と `piece` を触るので止まる)は外れている。
 *
 * 期待はここから来ない —— 判定を下すのは実行器の `decideStep`(engine)であり、その入力
 * (規則の表・ガードの変数・ロールの根拠)は実行計画(`usecase-plans.ts`)が運んでいる。
 *
 * **実行者の並びと系統の組み立ても同じファイルにある**(`saveActorsOf` ・`branches`)。ここが決める
 * のは 2 つ —— 誰を何人置くかと、その人の系統にどの的を載せるかである。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 *
 * @oversize 超える理由: 保存点の world の設計図は「実行者の並び → 系統ごとの行 → world」という 1 本の
 *   組み立てで、入力の型と結果の型を共有する。上から順に追えば、誰がどの的を持つ world ができるかが
 *   1 か所で読める。
 * @split-review 割る案と結果: 設計図の本体(`buildEqSaveWorld`)と、実行者・系統の組み立て(`saveActorsOf` ・`branches` ほか。以前の
 *   `eq-save-actors.ts`)に割る案を検討した(以前はそう割っていた)。組み立ての側が設計図の入力と結果の型
 *   (`EqSaveWorldInput` ・`EqSaveActor`)を読み、設計図の本体が組み立ての値(`branches`)を読む往復の形で、
 *   型の辺と値の辺が逆向きに張られていた。`saveActorsOf` などを使うのは設計図 1 本だけである。単発の操作の
 *   world(`eq-world.ts`)は的が 1 つの別の責務で、既に別のファイルである。
 */

import type { SpecModel } from '../model/types.js';
import type { DataTableSpec } from '../model/data/types.js';
import { findEntitySpec } from '../semantics/domain-lookup.js';
import { actorEntity } from '../usecase/param-source-facts.js';
import type { BuiltSave } from '../usecase/plan-build.js';
import { missingBasis, rowProblems, unreachable } from './rls-world-derivable.js';
import type { RlsWorldProblem } from './rls-world-derivable.js';
import { buildBranch, withValues } from './rls-world-rows.js';
import type { RlsWorldRow } from './rls-world-rows.js';
import { anonymousRoleId, globalRoleId } from '../model/role-hierarchy.js';
import { bindingPlaces } from './rls-world-roles.js';
import { holdingValues, unmetGateRoles, unmetValues } from './rls-world-claims.js';
import { NO_ROW_SUFFIX, STALE_SUFFIX, UNMET_SUFFIX } from './eq-world-types.js';
import { spareRows, staleRolesOf } from './eq-world-actors.js';

/** 保存点の world の実行者 1 人。 */
export interface EqSaveActor {
  /** world の中でこの人を指す名前。 */
  readonly key: string;
  /** その人が代表する役(テスト名に出る)。 */
  readonly role: string;
  readonly basis: 'binding' | 'claim' | 'default' | 'no_row';
  /** 実行者自身の行の名前(行が無い人なら `null`)。 */
  readonly row: string | null;
  /** 集約 → その系統の行の名前(行が無い人は空)。 */
  readonly targets: Readonly<Record<string, string>>;
  /**
   * この人が条件を満たさないロール(ADR-0018)。根拠(束縛・claim)は成立しているが、既定のログインロールの条件・
   * 含意の先の行の条件だけを満たさない(行の欄には条件の外の値が置かれる)。通常の実行者は持たない。
   */
  readonly unmet?: string;
  /**
   * 古いロール一覧(ADR-0018)。持つ人は、実行器が解決した配列ではなく**これを `p_actor_roles` に渡す**
   * —— 条件を満たしていた頃に解決された配列(既定のログインロールと `claim` のロール)。実行器の判定は
   * 行の写しで決まる(拒否)ので、DB が配列を信じず行の条件で落とすことを実 DB で見張る。
   */
  readonly staleRoles?: readonly string[];
}

/** 保存点 1 つぶんの world。 */
export interface EqSaveWorld {
  readonly usecase: string;
  readonly save: string;
  /** 実行者の集約の物理テーブル名。 */
  readonly actorTable: string;
  /** 集約 → 物理テーブル名(world に置く集約と、保存点が作る集約の全部)。 */
  readonly tables: Readonly<Record<string, string>>;
  readonly actors: readonly EqSaveActor[];
  /** 挿入順の行(参照先が先)。 */
  readonly rows: readonly RlsWorldRow[];
}

/** world の組み立ての結果。 */
export type EqSaveWorldResult =
  | { readonly ok: true; readonly world: EqSaveWorld }
  | { readonly ok: false; readonly problems: readonly RlsWorldProblem[] };

/** world を組み立てるのに要る入力。 */
export interface EqSaveWorldInput {
  readonly domain: SpecModel;
  readonly tables: readonly DataTableSpec[];
  readonly built: BuiltSave;
}

/**
 * 保存点 1 つぶんの world を組み立てる。
 *
 * @param input ドメイン仕様・全 data_table・組み立て済みの保存点
 * @returns world、または作れない理由
 */
export function buildEqSaveWorld(input: EqSaveWorldInput): EqSaveWorldResult {
  const actor = actorEntity(input.domain);
  const actorTable = actor === null ? null : tableOf(input.tables, actor);
  const anchorTable = input.tables.find((candidate) => candidate.entity === input.built.plan.steps[0]?.entity);
  if (actor === null || actorTable === null || anchorTable === undefined) {
    return { ok: false, problems: [missingBasis(anchorTable ?? placeholder(input.built), actor)] };
  }
  const targets = targetsOf(input);
  const actors = saveActorsOf(input, targets);
  const built = branches(input, { actorEntity: actor, actors, targets, table: anchorTable });
  if (!built.ok) return built;
  const spine = [...new Set(built.rows.map((row) => row.entity))];
  const problems = spine.flatMap((name) => spineProblems(input, name, anchorTable));
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    world: {
      usecase: input.built.plan.usecase.name,
      save: input.built.plan.save.id,
      actorTable,
      tables: tableMap(input, spine),
      actors: built.actors,
      rows: built.rows,
    },
  };
}

/**
 * world に**行を置く**集約(= 的)の並び。
 *
 * 3 つの出どころがあり、どれも実行計画の宣言そのものである。
 *   - 判断材料として読む集約(`reads[].entity`)
 *   - 手順の入力の参照欄が指す集約(作る行が「誰の下に」入るか)
 *   - 先行手順が作らない、動かすだけの集約(遷移の的)
 *
 * **作る集約そのものは入らない**(保存点が作るので、置いてはならない)。
 */
function targetsOf(input: EqSaveWorldInput): readonly string[] {
  const found: string[] = [];
  const add = (entity: string): void => {
    if (!found.includes(entity)) found.push(entity);
  };
  for (const read of input.built.facts.reads) add(read.entity);
  const created = new Set<string>();
  for (const [index, step] of input.built.plan.steps.entries()) {
    for (const key of input.built.facts.steps[index]?.inputKeys ?? []) {
      const entity = refEntityOf(input.domain, step.entity, key);
      if (entity !== null) add(entity);
    }
    if (step.kind === 'create') created.add(step.entity);
    else if (!created.has(step.entity)) add(step.entity);
  }
  return found;
}

/**
 * その入力の欄が参照する集約(参照でなければ `null`)。
 *
 * 対象そのものの識別子(`id`)はその集約を指す —— 動かすだけの手順は、その行が world に要る。
 */
function refEntityOf(domain: SpecModel, entity: string, key: string): string | null {
  if (key === 'id') return entity;
  const field = findEntitySpec(domain, entity)?.fields.find((candidate) => candidate.name === key);
  return field?.type.kind === 'ref' ? field.type.entity : null;
}

/** 集約 → 物理テーブル名。 */
function tableOf(tables: readonly DataTableSpec[], entity: string): string | null {
  return tables.find((candidate) => candidate.entity === entity)?.table ?? null;
}

/** world に置く集約 + 保存点が作る集約の表名(後片付けが要る)。 */
function tableMap(input: EqSaveWorldInput, spine: readonly string[]): Readonly<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const entity of [...spine, ...input.built.plan.steps.map((step) => step.entity)]) {
    const table = tableOf(input.tables, entity);
    if (table !== null) map[entity] = table;
  }
  return map;
}

/** data_table が無い保存点の理由を報告するための最小の器(`missingBasis` が読む欄だけ)。 */
function placeholder(built: BuiltSave): Pick<DataTableSpec, 'table' | 'entity'> {
  const name = built.plan.steps[0]?.entity ?? built.plan.usecase.name;
  return { table: name, entity: name };
}

/**
 * その集約の行が置けるか(執行点の条件が宣言から読めるか)。
 *
 * 判定は T8 / T11 とまったく同じ関数(`rowProblems`)から出る。**見ているのは world に置く行だけ**
 * であり、保存点が作る行は見ない —— 作る行の執行点は「実行した結果」として結末に出る。
 */
function spineProblems(
  input: EqSaveWorldInput,
  entity: string,
  anchor: DataTableSpec,
): readonly RlsWorldProblem[] {
  const table = input.tables.find((candidate) => candidate.entity === entity);
  if (table === undefined) return [];
  const problems = rowProblems(table, input.domain, input.tables);
  if (problems.length === 0) return [];
  const first = problems[0];
  return [
    {
      message: `${anchor.table} の world に要る ${table.table} の行を置けません(${first?.message ?? ''})`,
      fact: `${table.table} の側を直せばこの保存点も実行できるようになる。${first?.fact ?? ''}`,
      suggestion: `${table.table} の側を直せばこの保存点も実行できるようになる。${first?.suggestion ?? ''}`,
      counterexample: { table: anchor.table, blocked_by: table.table, ...first?.counterexample },
    },
  ];
}

/** 系統ごとの行を組み立てた結果。 */
export type EqSaveBranchesResult =
  | { readonly ok: true; readonly rows: readonly RlsWorldRow[]; readonly actors: readonly EqSaveActor[] }
  | { readonly ok: false; readonly problems: readonly RlsWorldProblem[] };

/**
 * 実行者の並び(役ごとに 1 人 + どの役も立たない既定の実行者 + 実行者の集約に行が無い人)。
 *
 * 役は**全手順の和**から採る —— 手順ごとに違う役を認める保存点でも、実行する人は 1 人だからである。
 */
function saveActorsOf(input: EqSaveWorldInput, targets: readonly string[]): readonly EqSaveActor[] {
  const roles = input.domain.roles.roles;
  const authenticated = globalRoleId(roles, 'authenticated_default');
  const actorEntityName = actorEntity(input.domain) ?? '';
  const actors: EqSaveActor[] = [];
  const add = (role: string, basis: EqSaveActor['basis']): void => {
    actors.push({
      key: role,
      role,
      basis,
      row: `${role}:${actorEntityName}`,
      targets: Object.fromEntries(targets.map((entity) => [entity, `${role}:${entity}`])),
    });
  };
  for (const role of [...bindingRolesOf(input).keys()].sort()) add(role, 'binding');
  for (const role of claimRolesOf(input)) add(role, 'claim');
  if (authenticated !== undefined && !actors.some((candidate) => candidate.key === authenticated)) {
    add(authenticated, 'default');
  }
  if (authenticated === undefined || anonymousRoleId(roles) === undefined) return actors;
  return [
    ...actors,
    ...actors.flatMap((actor) => unmetActorsOf(input.domain, actor, targets)),
    {
      key: `${authenticated}${NO_ROW_SUFFIX}`,
      role: authenticated,
      basis: 'no_row',
      row: null,
      targets: {},
    },
  ];
}

/**
 * 根拠は成立しているが、行の条件(既定のログインロールの条件・含意の先の条件。ADR-0018)を満たさない人。
 * 条件を持つロールごとに 2 人 —— 実行器が解決した配列を渡す人(実際の経路)と、**古いロール一覧**
 * (`staleRoles`。条件を満たしていた頃の配列)を渡す人(DB が配列を信じず行の条件で落とすことの見張り)。
 * 条件を宣言していなければ空(world は従来と同じ)。
 */
function unmetActorsOf(
  domain: SpecModel,
  actor: EqSaveActor,
  targets: readonly string[],
): readonly EqSaveActor[] {
  if (actor.row === null) return [];
  return unmetGateRoles(domain, actor.role).flatMap((gate) =>
    [UNMET_SUFFIX, STALE_SUFFIX].map((suffix) => {
      const key = `${actor.key}${suffix}${gate}`;
      return {
        ...actor,
        key,
        row: `${key}:${actorEntity(domain) ?? ''}`,
        targets: Object.fromEntries(targets.map((entity) => [entity, `${key}:${entity}`])),
        unmet: gate,
        ...(suffix === STALE_SUFFIX
          ? { staleRoles: staleRolesOf(domain, actor.basis === 'claim' ? [actor.role] : []) }
          : {}),
      };
    }),
  );
}

/** 役 → その役の束縛が載っている場所(`{集約}.{列}`)。全手順の和。 */
function bindingRolesOf(input: EqSaveWorldInput): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const step of input.built.facts.steps) {
    for (const fact of step.roleFacts) {
      if (fact.source.kind === 'external') found.set(fact.role, fact.source.ref);
    }
  }
  return found;
}

/** `claim` の役(全手順の和。宣言順・重複なし)。 */
export function claimRolesOf(input: EqSaveWorldInput): readonly string[] {
  const found: string[] = [];
  for (const step of input.built.facts.steps) {
    for (const claim of step.claimFacts) {
      if (!found.includes(claim.role)) found.push(claim.role);
    }
  }
  return found;
}

/** 実行者ごとの系統を組み立て、`claim` の欄を差し込む。 */
function branches(
  input: EqSaveWorldInput,
  world: {
    readonly actorEntity: string;
    readonly actors: readonly EqSaveActor[];
    readonly targets: readonly string[];
    readonly table: DataTableSpec;
  },
): EqSaveBranchesResult {
  let seq = 0;
  const next = (): number => {
    seq += 1;
    return seq;
  };
  const places = bindingPlaces(input.domain);
  const needed = neededFields(input, places);
  const rows: RlsWorldRow[] = [];
  const actors: EqSaveActor[] = [];
  for (const actor of world.actors) {
    if (actor.row === null) {
      actors.push(actor);
      continue;
    }
    const built = buildBranch(
      {
        domain: input.domain,
        tableOf: (name) => tableOf(input.tables, name),
        defaultsOf: (name) => input.tables.find((candidate) => candidate.entity === name)?.defaults ?? {},
        actorEntity: world.actorEntity,
        requiredFields: (name) => needed.get(name) ?? [],
        boundColumns: (name) => places.filter((place) => place.entity === name).map((place) => place.column),
        ownBinding: ownBindingOf(input, actor),
        next,
      },
      actor.key,
      world.targets,
    );
    if (!built.ok) {
      return { ok: false, problems: built.unreachable.map((name) => unreachable(world.table, name)) };
    }
    rows.push(...built.branch.rows.map((row) => decorate(row, actor, input.domain)));
    actors.push({ ...actor, targets: Object.fromEntries(built.branch.targetKeys) });
  }
  const spares = spareRows(
    { domain: input.domain, tables: input.tables, bindingRoles: new Map(), claimRoles: claimRolesOf(input) },
    world.actorEntity,
    { next, places, table: world.table, tableOf: (name) => tableOf(input.tables, name) },
  );
  if (!spares.ok) return { ok: false, problems: spares.problems };
  const others = refSpareRows(input, [...rows, ...spares.rows], {
    actorEntity: world.actorEntity,
    next,
    places,
    table: world.table,
  });
  if (!others.ok) return { ok: false, problems: others.problems };
  return { ok: true, rows: [...rows, ...spares.rows, ...others.rows], actors };
}

/**
 * 手順の入力の参照欄が指す集約に、**実行者の系統の行のほかにもう 1 行**を置く(誰の実行者でもない控えの系統。点検 21 回目の後の samples:db の赤)。
 *
 * 設計図は参照の欄を実行者の系統のその集約の行へ向けるので、同じ集約を指す参照が 2 つある作成(申請者と承認者)は同じ行を指し、
 * 「2 つは違う行」を言う不変条件(`a != b` の CHECK)に必ず当たる。押し直しの性質(`testing/save/resend.mts`)は 1 回目を書ける入力を
 * 参照の置き換えで探すが、置き換える先の行が world に無ければ探せない。控えの行は実行する相手にも実行者にもならないので、判定には効かない。
 */
function refSpareRows(
  input: EqSaveWorldInput,
  placed: readonly RlsWorldRow[],
  at: {
    readonly actorEntity: string;
    readonly next: () => number;
    readonly places: readonly { readonly entity: string; readonly column: string }[];
    readonly table: DataTableSpec;
  },
): { readonly ok: true; readonly rows: readonly RlsWorldRow[] } | { readonly ok: false; readonly problems: readonly RlsWorldProblem[] } {
  const rows: RlsWorldRow[] = [];
  for (const entity of refEntitiesOf(input)) {
    if ([...placed, ...rows].filter((row) => row.entity === entity).length >= 2) continue;
    const built = buildBranch(
      {
        domain: input.domain,
        tableOf: (name) => tableOf(input.tables, name),
        defaultsOf: (name) => input.tables.find((candidate) => candidate.entity === name)?.defaults ?? {},
        actorEntity: at.actorEntity,
        requiredFields: () => [],
        boundColumns: (name) => at.places.filter((place) => place.entity === name).map((place) => place.column),
        ownBinding: null,
        next: at.next,
      },
      `${entity}_ref_spare`,
      [entity],
    );
    if (!built.ok) return { ok: false, problems: built.unreachable.map((name) => unreachable(at.table, name)) };
    rows.push(...built.branch.rows.map((row) => ({ ...row, actor: null })));
  }
  return { ok: true, rows };
}

/** 手順の入力の参照欄が指す集約(対象そのものの識別子 `id` は除く。宣言順・重複なし)。 */
function refEntitiesOf(input: EqSaveWorldInput): readonly string[] {
  const found: string[] = [];
  for (const [index, step] of input.built.plan.steps.entries()) {
    for (const key of input.built.facts.steps[index]?.inputKeys ?? []) {
      if (key === 'id') continue;
      const entity = refEntityOf(input.domain, step.entity, key);
      if (entity !== null && !found.includes(entity)) found.push(entity);
    }
  }
  return found;
}

/**
 * 任意の欄でも値が要るもの(集約 → 欄名)。
 *
 * 束縛の列(役の根拠)に加えて、**判断材料として読む欄**も置く —— 読んだ値が空のままでは、
 * 軸がその欄を動かさない組み合わせで「空を条件にした判定」を実行することになる。
 */
function neededFields(
  input: EqSaveWorldInput,
  places: readonly { readonly entity: string; readonly column: string }[],
): ReadonlyMap<string, readonly string[]> {
  const needed = new Map<string, string[]>();
  const add = (entity: string, column: string): void => {
    const list = needed.get(entity) ?? [];
    if (!list.includes(column)) list.push(column);
    needed.set(entity, list);
  };
  for (const place of places) add(place.entity, place.column);
  for (const read of input.built.facts.reads) {
    for (const field of read.fields) add(read.entity, field);
  }
  return needed;
}

/** その人の役が束縛する場所(束縛の役でなければ `null`)。 */
function ownBindingOf(
  input: EqSaveWorldInput,
  actor: EqSaveActor,
): { readonly entity: string; readonly column: string } | null {
  if (actor.basis !== 'binding') return null;
  const [entity, column] = (bindingRolesOf(input).get(actor.role) ?? '').split('.');
  return entity === undefined || column === undefined ? null : { entity, column };
}

/**
 * 実行者自身の行に、その人のロールの条件を満たす値(満たさない人なら条件の外の値)を差し込む。
 * state / enum の欄に `true` は置かない(ADR-0018)。
 */
function decorate(row: RlsWorldRow, actor: EqSaveActor, domain: SpecModel): RlsWorldRow {
  if (row.actor !== actor.key || row.entity !== actorEntity(domain)) return row;
  const values =
    actor.unmet === undefined ? holdingValues(domain, actor.role) : unmetValues(domain, actor.role, actor.unmet);
  return Object.keys(values).length === 0 ? row : withValues(row, values);
}

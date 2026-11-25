/**
 * 軸「権限」—— 誰が・どの状態で・その操作を実行できるかの差(**第 1 の元 = 結果表**)。
 *
 * 結果表の json は「操作 × 実行者(ロール × ロール配列)× 状態 × ガード境界 → ✅ / ❌(理由)」の
 * **全列挙**であり、engine と RPC の一致の証明と同じ列挙から出ている —— 権限の意味はそこに
 * 畳まれている(設計メモ §0)。
 *
 * ただし**結果表が答えを出していない操作がある**(world を宣言から作れない集約は
 * `operations: []` になる)。その分は `results-read.ts` が `unanswered` として運び、
 * ここは `decidedOps`(答えている操作)を示し、第 2 の元(`rules.ts`)が残りを見る。
 *
 * 粒度は case まで。同じ (操作, 実行者, 付帯) で**状態だけ違う変化は 1 行に畳む**(§3-1)。
 * 操作ごと・実行者ごと片側にしか無いときは、case を並べても読めないので **1 行に畳む**。
 *
 * 純粋関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { diffFacts, factKey, keyParts } from './facts.js';
import type { FactDelta } from './facts.js';
import type { LabelBook } from './labels.js';
import { changeText, COUNTS, DECISION_ALLOWED, named } from './messages.js';
import type { ResultsSide } from './results-read.js';
import { QUALIFIER_JOIN, resultsSide } from './results-read.js';
import type { AxisInput, AxisResult, DiffDirection, SemanticChange } from './types.js';

/** 権限の軸の結果(第 2 の元へ渡す「結果表が答えている操作」つき)。 */
export interface PermissionResult extends AxisResult {
  /**
   * 結果表が判定を出している操作 ID。
   *
   * 第 2 の元(`rules.ts`)は**これ以外**だけを見る —— 同じ操作を 2 つの元で二重に数えず、
   * かつ結果表の穴(`operations: []` の集約・そもそも結果表が無い版)を必ず塞ぐための境目である。
   */
  readonly decidedOps: readonly string[];
}

/** 判定の向き(通った側に動いたか、落ちる側に動いたか)。 */
function directionOf(delta: FactDelta): DiffDirection {
  if (delta.kind !== 'changed') return delta.kind;
  const wasAllowed = delta.before === DECISION_ALLOWED;
  const isAllowed = delta.after === DECISION_ALLOWED;
  if (!wasAllowed && isAllowed) return 'widened';
  if (wasAllowed && !isAllowed) return 'narrowed';
  return 'changed';
}

/** 畳んだ 1 行(状態だけが違う変化をまとめたもの)。 */
interface FoldedRow {
  readonly actor: string;
  readonly qualifiers: readonly string[];
  readonly direction: DiffDirection;
  readonly before: string | null;
  readonly after: string | null;
  readonly states: string[];
}

/** 状態だけが違う変化を 1 行に畳む(鍵は 状態 / 実行者 / 付帯 の 3 つ)。 */
function fold(unit: string, deltas: readonly FactDelta[], labels: LabelBook): readonly FoldedRow[] {
  const machine = unit.slice(0, unit.lastIndexOf('.'));
  const rows = new Map<string, FoldedRow>();
  for (const delta of deltas) {
    const [state, actor, qualifiers] = keyParts(delta.key);
    const direction = directionOf(delta);
    const group = factKey(actor ?? '', qualifiers ?? '', direction, delta.before, delta.after);
    const shown = state === undefined || state === '' ? '' : named(state, labels.state(machine, state));
    const existing = rows.get(group);
    if (existing !== undefined) {
      if (shown !== '') existing.states.push(shown);
      continue;
    }
    rows.set(group, {
      actor: actor ?? '',
      qualifiers: qualifiers === undefined || qualifiers === '' ? [] : qualifiers.split(QUALIFIER_JOIN),
      direction,
      before: delta.before,
      after: delta.after,
      states: shown === '' ? [] : [shown],
    });
  }
  return [...rows.values()];
}

/** ロールの表示名(実行者の名前 → ロール ID → label)。 */
function actorLabelOf(actor: string, labels: LabelBook, roles: ReadonlyMap<string, string>): string | undefined {
  const role = roles.get(actor);
  return role === undefined ? undefined : labels.role(role);
}

/** 畳んだ行を差分の行にする。 */
function toChange(unit: string, row: FoldedRow, labels: LabelBook, roles: ReadonlyMap<string, string>): SemanticChange {
  const actorLabel = actorLabelOf(row.actor, labels, roles);
  const opLabel = labels.operation(unit);
  return {
    axis: 'permission',
    direction: row.direction,
    subject: unit,
    before: row.before,
    after: row.after,
    text: changeText('permission_case', row.direction, {
      subject: unit,
      ...(opLabel === undefined ? {} : { subjectLabel: opLabel }),
      actor: row.actor,
      ...(actorLabel === undefined ? {} : { actorLabel }),
      states: row.states,
      qualifiers: row.qualifiers,
      before: row.before,
      after: row.after,
    }),
  };
}

/** 操作そのものが片側に無いときの 1 行。 */
function unitChange(unit: string, count: number, direction: 'added' | 'removed', labels: LabelBook): SemanticChange {
  const label = labels.operation(unit);
  const size = `${count} 通り`;
  const before = direction === 'removed' ? size : null;
  const after = direction === 'added' ? size : null;
  return {
    axis: 'permission',
    direction,
    subject: unit,
    before,
    after,
    text: changeText('permission_op', direction, {
      subject: unit,
      ...(label === undefined ? {} : { subjectLabel: label }),
      before,
      after,
    }),
  };
}

/** 実行者 1 人ぶんの畳み(操作の本数・✅ の件数・❌ の件数)。 */
interface ActorTally {
  readonly units: Set<string>;
  allowed: number;
  refused: number;
}

/** 実行者が片側にしか居ないときの 1 行(操作ごとに並べると 1 集約で数百行になる)。 */
function actorChange(
  actor: string,
  tally: ActorTally,
  direction: 'added' | 'removed',
  labels: LabelBook,
  roles: ReadonlyMap<string, string>,
): SemanticChange {
  const actorLabel = actorLabelOf(actor, labels, roles);
  const counts = [COUNTS.operations(tally.units.size), COUNTS.allowed(tally.allowed), COUNTS.refused(tally.refused)];
  return {
    axis: 'permission',
    direction,
    subject: actor,
    before: direction === 'removed' ? counts.join('・') : null,
    after: direction === 'added' ? counts.join('・') : null,
    text: changeText('permission_actor', direction, {
      subject: actor,
      actor,
      ...(actorLabel === undefined ? {} : { actorLabel }),
      counts,
    }),
  };
}

/** 片側にしか居ない実行者(その人ぶんの ❌ の行は畳み、✅ の行だけ残す)。 */
function loneActors(base: ResultsSide, head: ResultsSide): { added: ReadonlySet<string>; removed: ReadonlySet<string> } {
  const inBase = new Set(base.actorRoles.keys());
  const inHead = new Set(head.actorRoles.keys());
  return {
    added: new Set([...inHead].filter((actor) => !inBase.has(actor))),
    removed: new Set([...inBase].filter((actor) => !inHead.has(actor))),
  };
}

/** 行が「片側にしか居ない実行者」のものなら数えて落とす(✅ は残す)。 */
function tallyLoneActor(
  row: FoldedRow,
  lone: { added: ReadonlySet<string>; removed: ReadonlySet<string> },
  unit: string,
  tallies: Map<string, ActorTally>,
): boolean {
  const isLone =
    (row.direction === 'added' && lone.added.has(row.actor)) ||
    (row.direction === 'removed' && lone.removed.has(row.actor));
  if (!isLone) return false;
  const tally = tallies.get(row.actor) ?? { units: new Set<string>(), allowed: 0, refused: 0 };
  tally.units.add(unit);
  const decision = row.direction === 'added' ? row.after : row.before;
  const many = Math.max(row.states.length, 1);
  if (decision === DECISION_ALLOWED) tally.allowed += many;
  else tally.refused += many;
  tallies.set(row.actor, tally);
  return decision !== DECISION_ALLOWED;
}

/**
 * 軸「権限」の差分(第 1 の元 = 結果表)。
 *
 * @param input 2 版の写しと表示名の帳面
 * @returns 行・読めなかったもの・**結果表が答えている操作**
 */
export function permissionChanges(input: AxisInput): PermissionResult {
  const base = resultsSide(input.base, input.head, 'base', input.roots);
  const head = resultsSide(input.base, input.head, 'head', input.roots);
  const problems = [...base.problems, ...head.problems];
  const decidedOps = [...new Set([...base.byUnit.keys(), ...head.byUnit.keys()])].sort();
  // **片側の結果表が読めないなら 1 行も出さない。** 空の表と比べるとその集約の操作が
  // まるごと「消えた」に化ける(独立レビューの止め 2 と同じ理由)。
  if (base.blind || head.blind) return { changes: [], problems, decidedOps };
  const roles = new Map([...base.actorRoles, ...head.actorRoles]);
  const lone = loneActors(base, head);
  const tallies = new Map<string, ActorTally>();
  const changes: SemanticChange[] = [];
  for (const unit of [...new Set([...base.byUnit.keys(), ...head.byUnit.keys()])].sort()) {
    const before = base.byUnit.get(unit);
    const after = head.byUnit.get(unit);
    if (before === undefined) {
      changes.push(unitChange(unit, after?.size ?? 0, 'added', input.labels));
      continue;
    }
    if (after === undefined) {
      changes.push(unitChange(unit, before.size, 'removed', input.labels));
      continue;
    }
    for (const row of fold(unit, diffFacts(before, after), input.labels)) {
      if (tallyLoneActor(row, lone, unit, tallies)) continue;
      changes.push(toChange(unit, row, input.labels, roles));
    }
  }
  for (const [actor, tally] of [...tallies].sort((left, right) => left[0].localeCompare(right[0]))) {
    changes.push(actorChange(actor, tally, lone.added.has(actor) ? 'added' : 'removed', input.labels, roles));
  }
  return { changes, problems, decidedOps };
}

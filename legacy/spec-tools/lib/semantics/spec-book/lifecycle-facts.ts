/**
 * ハンドブック(製品の仕様書)の「流れ」の節の事実 — 状態機械 1 本の状態と遷移を、表示から独立した型つきの値にする。
 *
 * 設計メモ `docs/design/book-as-spec/plan-generator.md` §2(中間表現)と `book-as-spec.md` §1-7-7(状態の区分)。
 * 本文の要点・詳細の表・図・図の読み上げ用の説明は、どれもこの事実だけを読む(試作は表示ごとに仕様を読み直していた)。
 *
 * - **状態の区分**は仕様の欄だけで決める: `tone: negative` → 否定的 / `final` → 終わり / `initial` → 始まり / それ以外 → 進行中。
 *   否定的が先(終点でも途中でも)。終わりかどうかは `final` の真偽で別に持つ(区分の色と終点の枠を混ぜない)。
 * - **遷移**は自動の判定(`event-origins.ts`)を 1 度だけ持つ。「どこからでも」の遷移(元の状態の集合が、終点を除く
 *   全状態を覆い、2 つ以上の状態から出るもの。例: 中止する)は、全体像の図で線にせず 1 行の文に添える印として持つ。
 * - **自動と言えない system の遷移**(`system-unwired`)には、action_spec の `unscanned` に書かれた理由を添える
 *   (例: 別の遷移の RPC が一括で起こす・まだ自動にしていない)。理由は人が書いた文で、機械の判定ではない。
 *
 * 並びは仕様の宣言順(状態・遷移とも)。純粋関数だけ。**アプリの語彙は 1 語も持たない。**
 */

import type { SourceLocation } from '../../kernel/source-location.js';
import type { StateMachineSpec } from '../../model/types-state.js';
import type { SpecModel } from '../../model/types.js';
import { eventKey, judgeAutonomy, type Autonomy, type EventKey, type EventOrigin, type EventOrigins } from './event-origins.js';

/** 状態の区分(色の区分と同じ。表示の語は words の側が持つ)。 */
export type StateCategory = 'start' | 'progress' | 'done' | 'negative';

/** 状態 1 つの事実。 */
export interface StateFact {
  readonly id: string;
  /** 表示名(無ければ id)。 */
  readonly label: string;
  readonly category: StateCategory;
  /** 終点か(`final`)。区分とは別に持つ。 */
  readonly final: boolean;
  /** この状態に入ると確定するもの(`settles` の語彙の表示名。宣言順)。 */
  readonly settles: readonly string[];
  /** 人が書いた段の場面(`stateSummaries`)。書かれていなければ無い。 */
  readonly summary?: string;
  /** 本筋の段の番号(1 から。`LifecycleFacts.steps` 段のうち何段目か)。本筋に無い状態には無い。 */
  readonly step?: number;
}

/** 遷移 1 本の事実。 */
export interface TransitionFact {
  /** `{状態機械}.{イベント}`。 */
  readonly key: string;
  readonly id: string;
  readonly label: string;
  readonly from: readonly string[];
  readonly to: string;
  readonly by: readonly string[];
  /** ガード式(生文字列)。無ければ無い。 */
  readonly guard?: string;
  readonly autonomy: Autonomy;
  readonly origins: readonly EventOrigin[];
  /**
   * 終点以外のどの状態からでも出られる遷移か。`from` の集合だけを見る構造の指標で、ガードと役は見ない
   * (外部レビュー の Q1: 表示で「無条件でどこからでもできる」とは言わない)。
   */
  readonly fromAnywhere: boolean;
  /** `system-unwired` の遷移に、action_spec の `unscanned` が書いた理由(無ければ無い)。 */
  readonly unwiredReason?: string;
  readonly source: SourceLocation;
}

/** 状態機械 1 本の流れの事実。 */
export interface LifecycleFacts {
  readonly aggregate: string;
  readonly machine: string;
  readonly summary?: string;
  readonly initial: string;
  /** 本筋の段の数(`StateFact.step` の最大)。 */
  readonly steps: number;
  readonly states: readonly StateFact[];
  readonly transitions: readonly TransitionFact[];
  readonly source: SourceLocation;
}

function categoryOf(machine: StateMachineSpec, state: string): StateCategory {
  if (machine.stateTone[state] === 'negative') return 'negative';
  if (machine.final.includes(state)) return 'done';
  return state === machine.initial ? 'start' : 'progress';
}

function stateFact(machine: StateMachineSpec, id: string, steps: ReadonlyMap<string, number>): StateFact {
  const summary = machine.stateSummaries[id];
  const step = steps.get(id);
  return {
    id,
    label: machine.stateLabels[id] ?? id,
    category: categoryOf(machine, id),
    final: machine.final.includes(id),
    settles: (machine.stateSettles[id] ?? []).map((term) => machine.settlesVocabulary[term] ?? term),
    ...(summary === undefined ? {} : { summary }),
    ...(step === undefined ? {} : { step }),
  };
}

/**
 * 本筋の段の番号: 否定的な状態を通らずに始まりから届く状態を、最短の手数 → 宣言順に並べて 1 から数える
 * (設計メモ §1-7-8。途中の状態は区分の色が同じなので、何段目かを番号で添える)。否定的な状態と届かない状態には付けない。
 * 枝分かれした段にも続き番号を振るので、番号は「必ず通る順」ではない。
 */
function mainSteps(machine: StateMachineSpec): ReadonlyMap<string, number> {
  const negative = (state: string): boolean => machine.stateTone[state] === 'negative';
  // 始まりが否定的な状態なら本筋は無い(番号を 1 つも付けない。否定的な状態には付けない規則の例外を作らない。外部レビュー の Q3)
  if (negative(machine.initial)) return new Map();
  const distance = new Map<string, number>([[machine.initial, 0]]);
  const queue = [machine.initial];
  for (let head = 0; head < queue.length; head++) {
    const here = queue[head] as string;
    for (const event of machine.events) {
      if (!event.from.includes(here) || distance.has(event.to) || negative(event.to)) continue;
      distance.set(event.to, (distance.get(here) ?? 0) + 1);
      queue.push(event.to);
    }
  }
  const order = machine.states;
  const main = [...distance.keys()].sort((a, b) => (distance.get(a) ?? 0) - (distance.get(b) ?? 0) || order.indexOf(a) - order.indexOf(b));
  return new Map(main.map((state, index) => [state, index + 1]));
}

/** 終点以外の全状態を覆い、2 つ以上の状態から出る遷移か。 */
function coversAllOpen(machine: StateMachineSpec, from: readonly string[]): boolean {
  const open = machine.states.filter((state) => !machine.final.includes(state));
  return open.length >= 2 && open.every((state) => from.includes(state));
}

/**
 * 状態機械 1 本の流れの事実を組む。`origins` は製品全体で 1 度集めたもの(`collectEventOrigins`)、
 * `unscanned` は遷移のキー → action_spec の `unscanned` の理由。
 */
export function lifecycleFacts(
  model: SpecModel,
  aggregate: string,
  machine: StateMachineSpec,
  origins: EventOrigins,
  unscanned: ReadonlyMap<EventKey, string> = new Map(),
): LifecycleFacts {
  const transitions = machine.events.map((event): TransitionFact => {
    const key = eventKey(machine.machine, event.id);
    const declared = origins.byEvent.get(key) ?? [];
    const autonomy = judgeAutonomy(model, event.by, declared, origins.unread);
    const reason = autonomy === 'system-unwired' ? unscanned.get(key) : undefined;
    return {
      key,
      id: event.id,
      label: event.label ?? event.id,
      from: event.from,
      to: event.to,
      by: event.by,
      ...(event.guard === undefined ? {} : { guard: event.guard }),
      autonomy,
      origins: declared,
      fromAnywhere: coversAllOpen(machine, event.from),
      ...(reason === undefined ? {} : { unwiredReason: reason }),
      source: event.location,
    };
  });
  const steps = mainSteps(machine);
  return {
    aggregate,
    machine: machine.machine,
    ...(machine.summary === undefined ? {} : { summary: machine.summary }),
    initial: machine.initial,
    steps: steps.size,
    states: machine.states.map((state) => stateFact(machine, state, steps)),
    transitions,
    source: machine.location,
  };
}

/** 製品の全状態機械の流れの事実(集約の宣言順 → 状態機械の宣言順)。 */
export function allLifecycleFacts(
  model: SpecModel,
  origins: EventOrigins,
  unscanned: ReadonlyMap<EventKey, string> = new Map(),
): readonly LifecycleFacts[] {
  return [...model.aggregates.values()].flatMap((specs) =>
    specs.stateMachines.map((machine) => lifecycleFacts(model, specs.name, machine, origins, unscanned)),
  );
}

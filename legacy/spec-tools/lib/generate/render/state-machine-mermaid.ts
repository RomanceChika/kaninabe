/**
 * 状態機械の mermaid 図(stateDiagram-v2)レンダラー。
 *
 * 図は「状態と遷移の骨格」だけを見せる。ガード条件・禁止理由は図に入れると
 * ラベルが崩れて読めなくなるため、遷移表と state × event マトリクスに委ねる
 * (domain-spec-writing.md §state_spec の生成物の分担)。
 */

import { trustSnippet } from '../../kernel/trusted-html.js';
import type { EventDef, StateMachineSpec } from '../../model/types.js';
import { escapeMermaid } from './screen-nav-graph.js';

/** mermaid のインデント(mermaid は字下げ幅を問わないが、生成物の見た目を揃えるため固定する)。 */
const INDENT = '    ';

/**
 * 1 つの状態機械を mermaid の stateDiagram-v2 にする。
 *
 * 生成する行は次の 4 種:
 * - `[*] --> {initial}`(初期状態)
 * - 状態の宣言(label があれば `{id}: {label} ({id})`、無い場合は孤立状態だけ `{id}`)
 * - `{from} --> {to}: {イベント名} ({ロール列挙})`(from ごとに 1 本。ロールは ID か、`roleLabels` を渡せば日本語名)
 * - `{final} --> [*]`(終了状態)
 *
 * @param machine 対象の状態機械
 * @returns ```mermaid フェンスで囲んだ Markdown 断片(末尾に改行を含まない)
 */
export function renderStateDiagram(machine: StateMachineSpec, options: DiagramOptions = {}): string {
  const lines: string[] = ['```mermaid', 'stateDiagram-v2', `${INDENT}[*] --> ${machine.initial}`];
  const crossing = new Set(options.omitCrossingLabels === true ? crossingEvents(machine) : []);

  const isolated = new Set(isolatedStates(machine));
  for (const state of machine.states) {
    const label = machine.stateLabels[state];
    if (label !== undefined && label.trim().length > 0) {
      lines.push(`${INDENT}${state}: ${escapeMermaid(label.trim())} (${state})`);
    } else if (isolated.has(state)) {
      lines.push(`${INDENT}${state}`);
    }
  }
  for (const event of machine.events) {
    for (const from of event.from) {
      lines.push(`${INDENT}${from} --> ${event.to}${crossing.has(event) ? '' : `: ${transitionLabel(event, options.roleLabels)}`}`);
    }
  }
  for (const final of machine.final) {
    lines.push(`${INDENT}${final} --> [*]`);
  }

  lines.push('```');
  return trustSnippet(lines.join('\n'));
}

/** 図の出し方の指定(省略時は従来の図)。 */
export interface DiagramOptions {
  /** 横断する遷移(`crossingEvents`)の矢印からラベルを外す。ラベルは遷移表が持つ。 */
  readonly omitCrossingLabels?: boolean;
  /** ロール ID → 日本語名。渡すと矢印のロールを日本語名で出す(無いロールは ID のまま)。省略時は ID。 */
  readonly roleLabels?: ReadonlyMap<string, string>;
}

/**
 * 横断する遷移 — どの段からでも起こせる動き(中止・失効・消去など)。
 *
 * 規則は 1 つで、**3 状態以上から出る、かつ、最終でない状態の過半から出る**ものを横断とみなす。
 * 以前は「3 状態以上」または「半分以上」だったが、小さな状態機械(メンバーの 4 状態)で「半分以上」が
 * 広すぎ、2 状態から出る遷移まで横断に入って、図の矢印の大半がラベルを失った。2 状態から出る遷移は、
 * 機械の大きさによらず横断ではない(名前つきの矢印で読める)。横断の矢印は状態の数だけ生えて図を埋めるので、
 * 図ではラベルを外して遷移表に任せる。
 *
 * @param machine 対象の状態機械
 * @returns 横断する遷移(宣言順)
 */
export function crossingEvents(machine: StateMachineSpec): EventDef[] {
  const nonFinal = machine.states.filter((state) => !machine.final.includes(state)).length;
  return machine.events.filter((event) => event.from.length >= 3 && event.from.length * 2 > nonFinal);
}

/**
 * ラベルの無い矢印の注。横断する遷移が無ければ null。
 * 矢印の本数は状態ごとに数える(横断する遷移 1 つが `from` の数だけ矢印になる)。
 */
export function crossingNote(machine: StateMachineSpec): string | null {
  const crossing = crossingEvents(machine);
  if (crossing.length === 0) return null;
  const arrows = crossing.reduce((sum, event) => sum + event.from.length, 0);
  const names = crossing.map((event) => event.label?.trim() || event.id).join('、');
  return (
    `ラベルの無い矢印 ${arrows} 本は、横断する遷移「${names}」を表す。` +
    'どの矢印がどのイベントかは、補足枠の「横断する遷移」を見る。誰が、どの状態から、どんな条件で動かせるかも、補足枠と遷移表にある。'
  );
}

/**
 * ざっくりの図(段と、誰が進めるかだけ)。
 *
 * 節点は日本語名だけで、矢印のラベルはロールの日本語名だけにする。横断する遷移の矢印は
 * ラベルを外す(`crossingNote` の注とセットで出す)。同じ 2 つの状態を同じ人が結ぶ矢印は 1 本にまとめる。
 *
 * @param machine 対象の状態機械
 * @param roleLabels ロール ID → 日本語名(無いロールは ID のまま出す)
 * @returns ```mermaid フェンスで囲んだ Markdown 断片(末尾に改行を含まない)
 */
export function renderStateDiagramBrief(
  machine: StateMachineSpec,
  roleLabels: ReadonlyMap<string, string>,
): string {
  const lines: string[] = ['```mermaid', 'stateDiagram-v2', `${INDENT}[*] --> ${machine.initial}`];
  const isolated = new Set(isolatedStates(machine));
  for (const state of machine.states) {
    const label = machine.stateLabels[state]?.trim() ?? '';
    if (label.length > 0) lines.push(`${INDENT}${state}: ${escapeMermaid(label)}`);
    else if (isolated.has(state)) lines.push(`${INDENT}${state}`);
  }
  const crossing = new Set(crossingEvents(machine));
  const arrows = new Set<string>();
  for (const event of machine.events) {
    const who = escapeMermaid(event.by.map((role) => roleLabels.get(role) ?? role).join('、'));
    for (const from of event.from) {
      arrows.add(`${INDENT}${from} --> ${event.to}${crossing.has(event) ? '' : `: ${who}`}`);
    }
  }
  lines.push(...arrows);
  for (const final of machine.final) lines.push(`${INDENT}${final} --> [*]`);
  lines.push('```');
  return trustSnippet(lines.join('\n'));
}

/**
 * 遷移ラベル。`{イベント名} ({ロール, ...})` の形にする。
 * イベント名は label があれば日本語名、無ければイベント ID。
 * ガードは付けない(ラベルが長くなり図が破綻するため。条件は遷移表を見る)。
 * ロールは ID を `, ` でつなぐ。`roleLabels` を渡すと日本語名を `、` でつなぐ。
 */
export function transitionLabel(event: EventDef, roleLabels?: ReadonlyMap<string, string>): string {
  const name = event.label?.trim();
  const head = name === undefined || name.length === 0 ? event.id : escapeMermaid(name);
  if (event.by.length === 0) return head;
  const who =
    roleLabels === undefined
      ? event.by.join(', ')
      : escapeMermaid(event.by.map((role) => roleLabels.get(role) ?? role).join('、'));
  return `${head} (${who})`;
}

/**
 * どの遷移にも現れない状態(初期・終了状態を除く)を返す。
 * mermaid はエッジからノードを起こすため、宣言しないと図から消えてしまう。
 * 「到達できない状態がある」ことこそ図で見えるべきなので、明示的に宣言する。
 */
function isolatedStates(machine: StateMachineSpec): string[] {
  const touched = new Set<string>([machine.initial, ...machine.final]);
  for (const event of machine.events) {
    touched.add(event.to);
    for (const from of event.from) touched.add(from);
  }
  return machine.states.filter((state) => !touched.has(state));
}

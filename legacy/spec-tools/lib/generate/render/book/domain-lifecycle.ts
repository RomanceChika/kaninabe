/**
 * 集約の章のライフサイクルの節(状態機械)と、本線の外に置くもの(補足枠・隣の章)。
 *
 * 本線は**最初の状態機械の段の流れ**で、図は 2 枚を同じ宣言から出す(ざっくり = 段と誰が / くわしく =
 * 状態の英字 id・イベント名・誰が。どちらも `state-machine-mermaid.ts`)。本線から外すものは 2 種類で、
 * どちらも宣言から導く(人が選ばない):
 *
 * - **補足枠** — 第 2 以降の状態機械と、横断する遷移(どの段からでも起こせる動き)
 * - **隣の章** — この集約を参照していて作成の操作を持つ別の集約。この章には無く、原本は隣の章にある
 */

import type { AggregateSpecs, EventDef, SpecModel, StateMachineSpec } from '../../../model/types.js';
import { collectSigns } from '../../prose.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import {
  crossingEvents,
  crossingNote,
  renderStateDiagram,
  renderStateDiagramBrief,
} from '../state-machine-mermaid.js';
import { renderStateEventMatrix } from '../state-machine-matrix.js';
import { renderTransitionTable } from '../../../gen-kit/state-machine-table.js';
import { bookLayout } from './face-scope.js';
import { roleLabels } from './access-view.js';
import { guardTranslator } from './domain-sections.js';

/** マトリクスの読み方(このマスの ✓/✗ こそ人間のレビュー対象、という位置づけの明示)。 */
const MATRIX_NOTE =
  'マトリクスは全状態 × 全イベントのマスである。機械は「全マスに ✓ か ✗(理由つき)があること」までを保証する — ' +
  '**形式的には合法でも業務として変なマスは人間にしか見えない**ので、✓/✗ が意図と合っているかをここで確認する。';

/** くわしい図の読み方(ガードと禁止の理由を図に入れない理由)。 */
const FULL_NOTE = 'ガード条件・禁止の理由は図に入れない(崩れるため)。次の遷移表とマトリクスが持つ。';

/** ズーム・パンできる枠で包む(画面の章と同じ部品。くわしい図は節点が多い)。 */
function zoomable(diagram: string): string[] {
  return ['<PanZoom>', diagram, '</PanZoom>'];
}

/** 状態機械 1 つ分(ざっくりの図 → くわしい図 → 遷移表 → マトリクス)。 */
function machineBlocks(machine: StateMachineSpec, labels: ReadonlyMap<string, string>): string[] {
  const note = crossingNote(machine);
  return [
    '**ざっくり** — 段と、誰が進めるか',
    renderStateDiagramBrief(machine, labels),
    ...(note === null ? [] : [note]),
    '**くわしく** — 状態の英字 id と、イベント名・誰が(ロールは日本語名)',
    ...zoomable(renderStateDiagram(machine, { omitCrossingLabels: true, roleLabels: labels })),
    FULL_NOTE,
    renderTransitionTable(machine),
    MATRIX_NOTE,
    renderStateEventMatrix(machine),
  ];
}

/** 横断する遷移の通知と入力する欄(人向けの表示の章も同じ値を使う)。 */
export interface CrossingExtras {
  /** その遷移の `effects` のうち、通知カタログにある通知(id と 1 行の説明)。 */
  readonly notices: readonly { readonly id: string; readonly summary: string }[];
  /** 操作仕様の `input` から id を除いた欄。操作の仕様が無ければ null。 */
  readonly inputs: readonly string[] | null;
}

/** 横断する遷移の通知と入力する欄を引く。 */
export function crossingExtras(event: EventDef, machine: StateMachineSpec, ctx: GenerateContext): CrossingExtras {
  const catalog = new Map((ctx.notifications?.catalog?.notifications ?? []).map((n) => [n.id, n.summary]));
  const notices = machine.effects
    .filter((effect) => effect.on === event.id)
    .flatMap((effect) => effect.do)
    .filter((id) => catalog.has(id))
    .map((id) => ({ id, summary: catalog.get(id) ?? '' }));
  const action = (ctx.actions?.actions ?? []).find(
    (candidate) => candidate.handles.machine === machine.machine && candidate.handles.event === event.id,
  );
  return { notices, inputs: action === undefined ? null : action.input.filter((ref) => ref.field !== 'id').map((ref) => ref.field) };
}

/** 横断する遷移 1 つ分の箇条(ラベル行。値は仕様の宣言の写し)。 */
function crossingItem(
  event: EventDef,
  machine: StateMachineSpec,
  model: SpecModel,
  ctx: GenerateContext,
  ja: (expression: string | undefined, selfEntity?: string) => string,
): string {
  const labels = roleLabels(model);
  const state = (id: string): string => machine.stateLabels[id] ?? id;
  const extras = crossingExtras(event, machine, ctx);
  const notices = extras.notices.map((notice) => `\`${notice.id}\` — ${notice.summary}`);
  const inputs = (extras.inputs ?? []).map((field) => `\`${field}\``);
  return [
    `- **${event.label ?? event.id}**(\`${machine.machine}.${event.id}\`)`,
    `  - 誰が: ${event.by.map((role) => labels.get(role) ?? role).join('、')}`,
    `  - いつ: 状態 ${event.from.length} つから — ${event.from.map(state).join('、')}`,
    `  - どこへ: ${state(event.to)}`,
    `  - 条件: ${ja(event.guard)}`,
    `  - 通知: ${notices.length === 0 ? 'なし' : notices.join(' / ')}`,
    `  - 入力する欄: ${extras.inputs === null ? '(操作の仕様なし)' : inputs.length === 0 ? 'なし(対象の id だけ)' : inputs.join('、')}`,
  ].join('\n');
}

/**
 * 補足枠 — 本線から外した動き。第 2 以降の状態機械(図・表・マトリクスはここで読む)と、
 * 横断する遷移(図ではラベルを外し、ここと遷移表が持つ)。どちらも無ければ出さない。
 */
export function sideboxSection(model: SpecModel, specs: AggregateSpecs, ctx: GenerateContext): string[] {
  const [main, ...rest] = specs.stateMachines;
  if (main === undefined) return [];
  const ja = guardTranslator(model, ctx);
  const items = specs.stateMachines.flatMap((machine) =>
    crossingEvents(machine).map((event) => crossingItem(event, machine, model, ctx, ja)),
  );
  if (items.length === 0 && rest.length === 0) return [];
  const labels = roleLabels(model);
  return [
    '## 補足枠 — 本線の外の動き',
    `本線は ${main.machine} の段の流れである。ここには、本線から外した動きを置く。`,
    ...(items.length === 0 ? [] : ['### 横断する遷移', items.join('\n')]),
    ...rest.flatMap((machine) => [`### ${machine.machine}(もう 1 つの状態機械)`, ...machineBlocks(machine, labels)]),
  ];
}

/** 隣の章の項目 1 つ(Markdown の箇条と HTML の箇条が同じ事実を使う)。 */
export type NeighborItem =
  | { readonly kind: 'aggregate'; readonly other: AggregateSpecs }
  | { readonly kind: 'table'; readonly table: string };

/**
 * 隣の章の項目。この集約を参照していて作成の操作を持つ別の集約(同じ章に畳んだものは除く)と、標識を持つテーブル仕様。
 */
export function neighborItems(
  model: SpecModel,
  specs: AggregateSpecs,
  ctx: GenerateContext,
  chapterRoot: AggregateSpecs = specs,
): NeighborItem[] {
  const entity = specs.entity?.entity;
  if (entity === undefined) return [];
  const layout = bookLayout(model, ctx);
  const here = layout.chapterOf(chapterRoot.name);
  const items: NeighborItem[] = [];
  for (const other of model.aggregates.values()) {
    const target = other.entity;
    if (other === specs || target === undefined || (other.access?.creates.length ?? 0) === 0) continue;
    if (!target.fields.some((field) => field.type.kind === 'ref' && field.type.entity === entity)) continue;
    // 同じ章に畳んだ集約は「隣」ではない(この章の節として読む)。
    const there = layout.chapterOf(other.name);
    if (there === here) continue;
    items.push({ kind: 'aggregate', other });
  }
  items.push(...tableItems(model, entity, ctx));
  return items;
}

/** この集約のテーブル仕様のうち標識を持つもの(データの置き場の章の節へ繋ぐ)。 */
function tableItems(model: SpecModel, entity: string, ctx: GenerateContext): NeighborItem[] {
  const tables = ctx.dataTables;
  if (tables === undefined || !tables.available) return [];
  // 集約の表の標識は、章を畳むとき(全章に展開しているとき)その集約の章の受け入れに置く。データの置き場には無い。
  if (bookLayout(model, ctx).nested) return [];
  return tables.tables
    .filter((table) => table.entity === entity)
    .filter((table) => collectSigns(ctx.specSources?.get(table.location.file) ?? '').length > 0)
    .map((table) => ({ kind: 'table' as const, table: table.table }));
}

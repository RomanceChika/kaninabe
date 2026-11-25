/**
 * 章の下段 = **導出**(機械が上段から出したもの)の**材料**。HTML の下段(`html/aggregate-lower.ts`)が、
 * 並び・見出し・行を引く部品。
 *
 * 折りたたみ 1 つに表は 1 枚まで(一度に見せる要素を絞る。book-human-face.md §7-4)。表の行は、これまでの章と同じ
 * レンダラー(遷移表・マトリクス・操作表・見え方の表)の行をそのまま使い、二重に実装しない。
 */

import type { AggregateSpecs, InvariantDef, SpecModel, StateMachineSpec } from '../../../model/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { fieldTableRows } from '../field-table.js';
import { matrixView, type MatrixView } from '../state-machine-matrix.js';
import { transitionTableRows } from '../../../gen-kit/state-machine-table.js';
import { neighborItems, type NeighborItem } from './domain-lifecycle.js';
import { OPERATION_HEADERS, operationsRows, queryItems, type QueryItem } from './domain-sections.js';
import { aggregateLabel, type FaceFacts } from './face-facts.js';
import { computesRows, distributionRows, enforcementRows, resultTable, testsRows } from './face-lower-rows.js';
import { testTotal } from './face-totals.js';
import { visibilityEntries } from './face-visibility.js';
import type { FoldProps } from './face-html.js';
import type { FoldedTable } from './lower-table.js';

/** 表 1 枚の折りたたみ(行があるときだけ)。 */
function tableEntry(props: FoldProps, headers: readonly string[], rows: readonly (readonly string[])[] | null, notes: readonly string[] = []): FoldedTable | null {
  return rows === null ? null : { fold: props, before: [], headers, rows, after: [], ...(notes.length === 0 ? {} : { notes }) };
}

/** 下段の部品 1 つ。Markdown と HTML が同じ並び・同じ見出し・同じ行を使う。 */
export type LowerPart =
  | { readonly kind: 'table'; readonly entry: FoldedTable }
  | { readonly kind: 'matrix'; readonly fold: FoldProps; readonly machine: StateMachineSpec; readonly view: MatrixView }
  | { readonly kind: 'diagram'; readonly machine: StateMachineSpec }
  | { readonly kind: 'queries'; readonly fold: FoldProps; readonly items: readonly QueryItem[] }
  | { readonly kind: 'neighbors'; readonly fold: FoldProps; readonly items: readonly NeighborItem[] };

/** 表の部品(材料が無ければ出さない)。 */
function tablePart(entry: FoldedTable | null): LowerPart[] {
  return entry === null ? [] : [{ kind: 'table', entry }];
}

/** 折りたたみの見出しの末尾(畳んだ従属の分は、集約の名前で見分ける)。 */
function titled(base: string, member: AggregateSpecs, root: AggregateSpecs): string {
  return member === root ? base : `${base} — ${aggregateLabel(member)}`;
}

/** 範囲の集約 1 つのデータの欄の折りたたみ。 */
function dataParts(member: AggregateSpecs, root: AggregateSpecs): LowerPart[] {
  const table = member.entity === undefined ? null : fieldTableRows(member.entity.fields);
  return tablePart(
    table === null
      ? null
      : tableEntry(
          { kind: 'table', title: titled('データ(フィールド)', member, root), count: `${member.entity?.fields.length ?? 0} 欄`, hint: '欄の説明は仕様の欄そのまま' },
          table.headers,
          table.rows,
        ),
  );
}

/** 範囲の集約 1 つの状態機械の図と表(全遷移の図・遷移表・マトリクス)。 */
function machineParts(member: AggregateSpecs): LowerPart[] {
  return member.stateMachines.flatMap((machine): LowerPart[] => {
    const transitions = transitionTableRows(machine);
    return [
      { kind: 'diagram', machine },
      ...tablePart(
        tableEntry(
          { kind: 'table', title: `遷移表 — ${machine.machine}`, count: `${machine.events.length} 手`, hint: '誰が・どこから・どこへ・条件' },
          transitions.headers,
          transitions.rows,
        ),
      ),
      {
        kind: 'matrix',
        fold: {
          kind: 'table',
          title: `マトリクス — ${machine.machine}`,
          count: `${machine.states.length * machine.events.length} マス`,
          hint: '全状態 × 全イベント。通らないマスには理由がある',
        },
        machine,
        view: matrixView(machine),
      },
    ];
  });
}

/** 範囲の集約 1 つの操作と見え方の折りたたみ。見出しに集約の名前を付ける(親の分は章の見出しのまま別に出す)。 */
function accessParts(model: SpecModel, ctx: GenerateContext, member: AggregateSpecs, root: AggregateSpecs): LowerPart[] {
  return [
    ...tablePart(
      tableEntry(
        { kind: 'table', title: titled('操作(誰が・いつ・何を)', member, root), hint: 'いつできるか(条件)が業務として正しいかは、人が判断する' },
        OPERATION_HEADERS,
        operationsRows(model, member, ctx),
      ),
    ),
    ...visibilityEntries(model, member, ctx, member === root ? '' : ` — ${aggregateLabel(member)}`).flatMap(tablePart),
  ];
}

/**
 * 下段の折りたたみ(導出)の材料を、並びのまま返す。
 *
 * 並びは「機械の並びで出した遷移 → 見え方 → 公理の執行 → テスト・配布物 → この章に無いもの」。
 * 親の次に、節に畳んだ従属する集約の分を同じ形で並べる(見出しに集約の名前が付く)。
 */
export function lowerParts(model: SpecModel, facts: FaceFacts, ctx: GenerateContext): LowerPart[] {
  const { specs } = facts;
  const [main] = specs.stateMachines;
  const result = main === undefined ? null : resultTable(specs, main, model);
  const operations = operationsRows(model, specs, ctx);
  const own = facts.own.flatMap((group) => group.invariants);
  const others = facts.scope.filter((member) => member !== specs);
  const enforcement = (title: string, count: number, hint: string, invariants: readonly InvariantDef[]): LowerPart[] =>
    tablePart(tableEntry({ kind: 'table', title, count, hint }, ['公理', '執行', '置き場'], invariants.length === 0 ? null : enforcementRows(invariants)));
  const queries = facts.scope.flatMap((member) => queryItems(member, ctx));
  const neighbors = facts.scope.flatMap((member) => neighborItems(model, member, ctx, specs));
  return [
    ...dataParts(specs, specs),
    ...machineParts(specs),
    ...tablePart(
      result === null
        ? null
        : tableEntry(
            { kind: 'table', title: '結果表', count: `${main?.states.length ?? 0} 段`, hint: 'この段で誰が何をできるか' },
            result.headers,
            result.rows,
            result.note === null ? [] : [result.note],
          ),
    ),
    ...tablePart(
      tableEntry(
        {
          kind: 'table',
          title: '操作(誰が・いつ・何を)',
          count: operations === null ? undefined : `${facts.actions.length} 本の操作仕様`,
          hint: 'いつできるか(条件)が業務として正しいかは、人が判断する',
        },
        OPERATION_HEADERS,
        operations,
      ),
    ),
    ...visibilityEntries(model, specs, ctx, '').flatMap(tablePart),
    ...tablePart(
      tableEntry(
        { kind: 'table', title: '計算される欄 — 欄から純関数', count: `${facts.computes.length} 本`, hint: '式は宣言に無い。式は DSL の外の純関数の中' },
        ['欄', '決める純関数', '操作'],
        facts.computes.length === 0 ? null : computesRows(facts),
      ),
    ),
    ...others.flatMap((member) => [...dataParts(member, specs), ...machineParts(member), ...accessParts(model, ctx, member, specs)]),
    ...enforcement('執行点 — この章の公理', facts.enforcementOwn, '公理がどこで機械に落ちているか', own),
    ...enforcement(
      '執行点 — 写した公理',
      facts.enforcementCarried,
      '原本の宣言にある',
      facts.carried.map((entry) => entry.invariant),
    ),
    ...tablePart(
      tableEntry(
        { kind: 'table', title: 'テスト', count: `${testTotal(facts.tests)} 件`, hint: '仕様の test_cases の行数' },
        ['出どころ', '件数', '内訳'],
        facts.tests.length === 0 ? null : testsRows(facts),
      ),
    ),
    ...tablePart(tableEntry({ kind: 'table', title: '表・可視性・外から届く surface', hint: 'この章から出る配布物' }, ['もの', '実数'], distributionRows(facts, ctx, model))),
    ...(queries.length === 0
      ? []
      : [{ kind: 'queries' as const, fold: { kind: 'detail' as const, title: 'このデータを読む経路(query)', hint: '一覧に無い読み方は存在しない' }, items: queries }]),
    ...(neighbors.length === 0
      ? []
      : [{ kind: 'neighbors' as const, fold: { kind: 'detail' as const, title: '隣の章 — この章に無いもの', hint: '原本は各章にある' }, items: neighbors }]),
  ];
}

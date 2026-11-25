/**
 * 章の下段(導出)の表の行。公理の執行点・結果表(段 × 役)・配布物・計算される欄・テスト件数。
 *
 * Markdown の表と HTML の表が同じ行を使う(`face-lower-parts.ts` が折りたたみの材料に組む)。
 */

import { globalRoleId, impliedRoles, systemRoleId } from '../../../model/role-hierarchy.js';
import type { AggregateSpecs, InvariantDef, SpecModel, StateMachineSpec } from '../../../model/types.js';
import { abilitiesByState, type StateAbility } from '../../../semantics/state-abilities.js';
import { ceilingDeclsOf } from '../../../model/data/ceiling-plan.js';
import { refCounterpartDeclsOf } from '../../../model/data/ref-check-shape.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { cell, withLabel } from '../../../gen-kit/state-machine-table.js';
import { bypassRole, roleLabels } from './access-view.js';
import type { FaceFacts } from './face-facts.js';

/** 執行の種類の日本語。 */
const ENFORCEMENT_WORDS: Readonly<Record<string, string>> = {
  db_constraint: 'DB 制約',
  trigger: 'トリガ',
  guard: 'ガード',
  application: 'アプリ',
};

/** 公理 1 本の執行の要約(`トリガ 1 + アプリ 1`)。 */
function enforcementSummary(invariant: InvariantDef): string {
  const kinds = new Map<string, number>();
  for (const point of invariant.enforcedBy) kinds.set(point.kind, (kinds.get(point.kind) ?? 0) + 1);
  return kinds.size === 0 ? '宣言なし' : [...kinds].map(([kind, count]) => `${ENFORCEMENT_WORDS[kind] ?? kind} ${count}`).join(' + ');
}

/** 執行点の表の行(公理 | 執行 | 置き場)。 */
export function enforcementRows(invariants: readonly InvariantDef[]): string[][] {
  return invariants.map((invariant) => [cell(invariant.id), cell(enforcementSummary(invariant)), invariant.enforcedBy.map((point) => `\`${cell(point.ref)}\``).join('、')]);
}

/**
 * できることの言い方(読む・遷移・作る・書く・消す)。
 * 結果表を出す章の集約の外の遷移には、集約の名前を付ける(「取り消す」だけでは、どの集約の遷移か分からない)。
 */
function abilityWords(ability: StateAbility, model: SpecModel, owner: AggregateSpecs): string {
  if (ability.kind === 'read') return '閲覧';
  const label = model.aggregates.get(ability.aggregate)?.entity?.label ?? ability.aggregate;
  if (ability.kind === 'event') return ability.aggregate === owner.name ? ability.label : `${label}: ${ability.label}`;
  return `${label}を${{ create: '作る', write: '書く', delete: '消す' }[ability.kind]}`;
}

/** 結果表の足す列 1 つ(ロール 1 つが各状態でできること)。 */
interface AbilityColumn {
  readonly header: string;
  readonly cells: ReadonlyMap<string, string>;
}

/**
 * 結果表の、遷移の `by` に現れないロールの列。メンバーと、メンバーを含意するロール(内部実行を除く)を**ロールごとに**列にし、
 * 各状態でできることを、アクセスの宣言と別の集約の遷移の条件から導く(`semantics/state-abilities.ts`)。
 * ロールを束ねない: メンバーを含意するロールの宣言は、自分の行に限る権限(自分の枠・自分の申告欄など)なので、
 * メンバーの列に混ぜると「メンバーなら誰でもできる」と読めてしまう。できることが 1 つも無いロールは列を作らない。
 */
function abilityColumns(model: SpecModel, owner: AggregateSpecs, machine: StateMachineSpec, acting: ReadonlySet<string>): AbilityColumn[] {
  const member = globalRoleId(model.roles.roles, 'authenticated_default');
  const system = systemRoleId(model.roles.roles);
  if (member === undefined || acting.has(member)) return [];
  const labels = roleLabels(model);
  const roles = model.roles.roles.map((role) => role.id).filter((id) => id !== system && !acting.has(id) && (id === member || impliedRoles(model.roles.roles, id).has(member)));
  return roles.flatMap((role) => {
    const abilities = abilitiesByState(model, owner, machine, new Set([role]));
    const cells = new Map(
      machine.states.map((state) => {
        const words = [...new Set((abilities.get(state) ?? []).map((ability) => abilityWords(ability, model, owner)))];
        return [state, words.length === 0 ? '—' : cell(words.join('、'))] as const;
      }),
    );
    return [...cells.values()].every((value) => value === '—') ? [] : [{ header: labels.get(role) ?? role, cells }];
  });
}

/** 結果表の下の注(ロールの列を出したとき)。メンバーを含意するロールの列が加わったときは、その読み方を足す。 */
function abilityNote(columns: readonly AbilityColumn[]): string {
  const base = 'ロールの列は、アクセスの宣言と操作から導いた帰結。';
  return columns.length > 1 ? `${base}メンバーを含意するロールの列は、メンバーの列に足してできること。自分の行に限る分を含む。` : base;
}

/** 結果表(段 × 役)。同じ手を持つロールは 1 列にまとめ、遷移を持たないロールの列を足す。 */
export function resultTable(
  owner: AggregateSpecs,
  machine: StateMachineSpec,
  model: SpecModel,
): { readonly headers: string[]; readonly rows: string[][]; readonly note: string | null } {
  const labels = roleLabels(model);
  const byRole = new Map<string, Set<string>>();
  for (const event of machine.events) for (const role of event.by) byRole.set(role, (byRole.get(role) ?? new Set<string>()).add(event.id));
  const groups = new Map<string, string[]>();
  for (const [role, events] of byRole) {
    const key = [...events].sort().join(',');
    groups.set(key, [...(groups.get(key) ?? []), role]);
  }
  const columns = [...groups.values()];
  const name = (role: string): string => labels.get(role) ?? role;
  const extra = abilityColumns(model, owner, machine, new Set(byRole.keys()));
  const rows = machine.states.map((state) => [
    cell(withLabel(state, machine.stateLabels[state])),
    ...columns.map((roles) => {
      const hands = machine.events.filter((event) => event.from.includes(state) && event.by.some((role) => roles.includes(role)));
      return hands.length === 0 ? '—' : cell(hands.map((event) => event.label ?? event.id).join('、'));
    }),
    ...extra.map((column) => column.cells.get(state) ?? '—'),
  ]);
  const header = ['段', ...columns.map((roles) => roles.map(name).join('、')), ...extra.map((column) => column.header)];
  return { headers: header, rows, note: extra.length === 0 ? null : abilityNote(extra) };
}

/** 配布物の表(もの | 実数)。数えられるものだけを数える。範囲の集約(親 + 畳んだ従属)を足す。 */
export function distributionRows(facts: FaceFacts, ctx: GenerateContext, model: SpecModel): string[][] {
  const rows: string[][] = [];
  const members = facts.scope;
  const allTables = ctx.dataTables?.available === true ? ctx.dataTables.tables : facts.tables;
  for (const table of facts.tables) {
    const specs = members.find((member) => member.entity?.entity === table.entity);
    // 天井と相手の端(別の表の執行点から生成されるトリガ。`model/data/ref-check-shape.ts`)も数える(data_table の md の表と同じ数)。
    const generated = [ceilingDeclsOf(table, model), refCounterpartDeclsOf(table, model, allTables)];
    rows.push([`表 \`${table.table}\` の列`, String(specs?.entity?.fields.length ?? 0)]);
    rows.push([
      '索引(主キー以外)・外部キー・トリガ',
      `${table.indexes.length}・${table.foreignKeys.length}・${table.triggers.length + generated.reduce((sum, decls) => sum + decls.triggers.length, 0)}`,
    ]);
    rows.push(['この表を持ち場とする関数', String(table.functions.length + generated.reduce((sum, decls) => sum + decls.functions.length, 0))]);
  }
  const bypass = bypassRole(model);
  const reads = members.flatMap((member) => (member.access?.reads ?? []).filter((rule) => rule.by !== bypass && rule.scope.kind !== 'none'));
  if (members.some((member) => member.access !== undefined)) {
    rows.push(['読み取りの宣言(system と見えないものを除く)', String(reads.length)]);
    rows.push(['外から届く surface で隠す列', String(members.reduce((sum, member) => sum + (member.access?.fieldsHidden.length ?? 0), 0))]);
  }
  const entities = new Set(members.map((member) => member.entity?.entity));
  const queries = (ctx.queries?.queries ?? []).filter((query) => entities.has(query.source));
  rows.push(['読み取り経路(query。この章の集約が source のもの)', String(queries.length)]);
  const notices = new Set(
    (ctx.notifications?.catalog?.notifications ?? [])
      .map((notice) => notice.id)
      .filter((id) => members.some((member) => member.stateMachines.some((machine) => machine.effects.some((effect) => effect.do.includes(id))))),
  );
  rows.push(['この章の遷移から飛ぶ通知', String(notices.size)]);
  rows.push(['この章の遷移が積むジョブ', String(facts.jobs)]);
  return rows;
}

/**
 * 計算される欄の表(欄 | 決める純関数 | 操作)。`computes` の宣言は欄と純関数の名前だけで、式は宣言に無い
 * (DSL の外の純関数の中にある)ので、必読には数えず、導出としてここに出す。
 */
export function computesRows(facts: FaceFacts): string[][] {
  return facts.computes.map((item) => [`\`${cell(item.target)}\``, `\`${cell(item.ref)}\``, `\`${cell(item.operation)}\``]);
}

/** テスト件数の表(出どころ | 件数 | 内訳)。 */
export function testsRows(facts: FaceFacts): string[][] {
  return facts.tests.map((row) => [cell(row.source), String(row.unit + row.integration), `ユニット ${row.unit}・統合 ${row.integration}`]);
}

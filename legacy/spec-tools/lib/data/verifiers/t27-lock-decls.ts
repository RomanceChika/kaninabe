/**
 * T27 **掴みの宣言の接地**(`triggers[].locks` / `copies_from` / `advisory`・`foreign_keys[].refuse_erased`。点検 19 回目 A19-1 / A19-3 / A19-4 / O19-2)。
 *
 * 宣言の中だけで決まる形はパーサー(`parse-lock-decls.ts`)が見る。ここは宣言の外の事実と突き合わせる。
 *
 *   - `locks` の表は、トリガを持つ表が**直の外部キー**で指す表である(生成器はその外部キーの行を先に掴む。指さない表は引き当てられない)
 *   - `copies_from` の `column` は同じトリガの `supplies` にあり、写し元の表は data_table にあり、写し元の列・`match` の列は
 *     両方の表の entity_spec の欄か `id` である
 *   - トリガが供給する**個人列**(entity_spec の `personal`)は、`copies_from` で写し元を宣言する(導出 `derives` を除く)——
 *     写し元が宣言に無いと、生成器も検査も「写しの作成と写し元の消去を 1 本ずつに並べる」ことを知らない
 *   - `refuse_erased` の参照先は data_table にあり、印の列はその集約の欄で、参照先の集約は個人列を持つ(消去の対象である)
 *   - 自表の集約が個人列を持つなら `refuse_erased.freezes_personal` を書く(点検 20 回目 A20-1。消去は紐づけを外さずに個人列を
 *     置き換えるので、指したままの行に後から書いた実名は以後消す道が無い。既定を置かない —— 書き忘れを黙って「凍らせない」にしない)。
 *     自表が個人列を持たないなら書けない(凍らせる列が無い)
 *   - 同じ表の BEFORE トリガを名前の順に実行したとき、同じ親を共有で掴んだ後に排他で掴み直す組が無い(点検 D25s-2。同じ親への
 *     2 本の挿入が共有を持ったまま互いの排他を待つ。判定の本体は `model/data/check-trigger-locks.ts` の `beforeUpgradesOf`。本文が
 *     生成物の条件のトリガは最初から強い方で掴むので、残るのは手書きの本文・宣言の `locks` どうしの格上げだけ)
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import type { DataTableSpec, DataTableSpecModel, DataTriggerDecl } from '../../model/data/types.js';
import { findEntityFields } from '../../semantics/domain-index.js';
import { beforeUpgradesOf } from '../../model/data/check-trigger-locks.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T27';

/** 指摘を組み立てる。 */
function t27(table: DataTableSpec, pointer: string, message: string, suggestion: string, counterexample: Readonly<Record<string, string>> = {}): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', message, location: { ...table.location, pointer }, suggestion, counterexample: { table: table.table, ...counterexample } };
}

/** スキーマ修飾を落とした表名。 */
function bare(reference: string): string {
  return reference.startsWith('public.') ? reference.slice('public.'.length) : reference;
}

/**
 * 個人列の凍結(`freezes_personal`)の要否。自表の個人列の有無と、書いたかどうかが一致しなければ赤。
 *
 * @param domain ドメイン仕様
 * @param tables 全 data_table
 * @param table 自表
 * @param column 外部キーの列
 * @param declared 凍結を書いたか
 * @param where 反例の欄
 * @returns 指摘(0 か 1 件)
 */
function freezeFindings(
  domain: SpecModel,
  tables: readonly DataTableSpec[],
  table: DataTableSpec,
  column: string,
  declared: boolean,
  where: Readonly<Record<string, string>>,
): readonly Finding[] {
  const personal = [...personalOf(domain, tables, table.table)];
  const pointer = `foreign_keys.${column}.refuse_erased.freezes_personal`;
  if (personal.length > 0 && !declared) {
    return [
      t27(
        table,
        pointer,
        `${table.table} は個人列(${personal.join(', ')})を持つのに、${column} の refuse_erased に freezes_personal がありません(消去済みを指したままの行に実名を書き戻せる)`,
        'refuse_erased に "freezes_personal: { word: {拒否の語}, message: {画面の文言} }" を足す(指したままの行の個人列の書き込みを、参照先が消去済みなら断る)',
        where,
      ),
    ];
  }
  if (personal.length === 0 && declared) {
    return [t27(table, pointer, `${table.table} は個人列を持たないので、freezes_personal で凍らせる列がありません`, 'freezes_personal を消す', where)];
  }
  return [];
}

/** 表の欄の名前(`id` を含む。entity が無ければ null = 欄を確かめられない)。 */
function columnsOf(domain: SpecModel, tables: readonly DataTableSpec[], table: string): ReadonlySet<string> | null {
  const entity = tables.find((candidate) => candidate.table === table)?.entity;
  if (entity === undefined) return null;
  return new Set(['id', ...(findEntityFields(domain, entity) ?? []).map((field) => field.name)]);
}

/** 表の個人列。 */
function personalOf(domain: SpecModel, tables: readonly DataTableSpec[], table: string): ReadonlySet<string> {
  const entity = tables.find((candidate) => candidate.table === table)?.entity;
  return new Set(entity === undefined ? [] : (findEntityFields(domain, entity) ?? []).filter((field) => field.personal).map((field) => field.name));
}

/** トリガ 1 本の `locks` と `copies_from`。 */
function triggerFindings(domain: SpecModel, tables: readonly DataTableSpec[], table: DataTableSpec, trigger: DataTriggerDecl): Finding[] {
  const findings: Finding[] = [];
  const pointer = `triggers.${trigger.name}`;
  for (const parent of Object.keys(trigger.locks ?? {})) {
    if (!table.foreignKeys.some((key) => bare(key.references) === parent)) {
      findings.push(t27(table, `${pointer}.locks`, `${table.table} のトリガ ${trigger.name} は ${parent} を掴むと宣言していますが、${table.table} は ${parent} を直の外部キーで指しません`, '掴む親は発火させた行が直の外部キーで指す表にする(生成器はその行を先に掴む)', { trigger: trigger.name, parent }));
    }
  }
  const own = columnsOf(domain, tables, table.table);
  for (const copy of trigger.copiesFrom ?? []) {
    const source = columnsOf(domain, tables, copy.fromTable);
    const where = { trigger: trigger.name, column: copy.column, from: `${copy.fromTable}.${copy.fromColumn}` };
    if (!trigger.supplies.includes(copy.column)) {
      findings.push(t27(table, `${pointer}.copies_from`, `${trigger.name} の copies_from の ${copy.column} が supplies にありません`, '写し元を宣言する列は、そのトリガが供給する列(supplies)にする', where));
    }
    if (source === null) {
      findings.push(t27(table, `${pointer}.copies_from`, `${trigger.name} の写し元の表 ${copy.fromTable} が entity を持つ data_table にありません`, '写し元は data_table の表(entity_spec を持つ)を名指す', where));
      continue;
    }
    const missing = [copy.fromColumn, ...Object.keys(copy.match)].filter((column) => !source.has(column));
    const ownMissing = own === null ? [] : Object.values(copy.match).filter((column) => !own.has(column));
    if (missing.length > 0 || ownMissing.length > 0) {
      findings.push(t27(table, `${pointer}.copies_from`, `${trigger.name} の写し元の列が欄にありません(${[...missing.map((column) => `${copy.fromTable}.${column}`), ...ownMissing.map((column) => `${table.table}.${column}`)].join(', ')})`, 'from と match の列は、両方の表の entity_spec の欄か id にする', where));
    }
  }
  if (trigger.derives === undefined) {
    const personal = personalOf(domain, tables, table.table);
    const declared = new Set((trigger.copiesFrom ?? []).map((copy) => copy.column));
    for (const column of trigger.supplies.filter((candidate) => personal.has(candidate) && !declared.has(candidate))) {
      findings.push(t27(table, `${pointer}.supplies`, `${table.table} のトリガ ${trigger.name} は個人列 ${column} を供給しますが、copies_from に写し元がありません`, `copies_from に "- column: ${column} / from: {表}.{列} / match: { {写し元の列}: {自表の列} }" を書く(写しの作成と写し元の消去を 1 本ずつに並べる先掴みの出どころ)`, { trigger: trigger.name, column }));
    }
  }
  return findings;
}

/**
 * 掴みの宣言の接地を見る。
 *
 * @param domain ドメイン仕様
 * @param dataTables 全 data_table
 * @returns 指摘の並び
 */
export function verifyLockDecls(domain: SpecModel, dataTables: DataTableSpecModel): Finding[] {
  if (!dataTables.available) return [];
  const tables = dataTables.tables;
  const findings: Finding[] = [];
  for (const table of tables) {
    for (const trigger of table.triggers) findings.push(...triggerFindings(domain, tables, table, trigger));
    for (const up of beforeUpgradesOf(table, domain, tables)) {
      findings.push(
        t27(
          table,
          `triggers.${up.later}.locks`,
          `${table.table} の BEFORE トリガ ${up.earlier} が ${up.parent} を共有で掴んだ後に、名前の順で後の ${up.later} が同じ親を排他で掴みます(${up.event} の格上げ。同じ親への 2 本が共有を持ったまま互いの排他を待つ)`,
          '先に発火するトリガも最初から排他で掴む(宣言の locks を update にする・本文を for update にする)か、強く掴むトリガの名前を先にする',
          { earlier: up.earlier, later: up.later, parent: up.parent, event: up.event },
        ),
      );
    }
    for (const key of table.foreignKeys) {
      const decl = key.refuseErased;
      if (decl === undefined) continue;
      const target = bare(key.references);
      const columns = columnsOf(domain, tables, target);
      const where = { column: key.column, references: key.references };
      if (columns === null) {
        findings.push(t27(table, `foreign_keys.${key.column}.refuse_erased`, `${table.table}.${key.column} の参照先 ${key.references} が entity を持つ data_table にありません`, 'refuse_erased は data_table の表(entity_spec を持つ)を指す外部キーにだけ書く', where));
        continue;
      }
      if (!columns.has(decl.column)) {
        findings.push(t27(table, `foreign_keys.${key.column}.refuse_erased`, `${table.table}.${key.column} の refuse_erased の印の列 ${decl.column} が ${target} の欄にありません`, '印の列は参照先の集約の欄(消去済みを表す状態の欄など)にする', { ...where, mark: decl.column }));
      }
      if (personalOf(domain, tables, target).size === 0) {
        findings.push(t27(table, `foreign_keys.${key.column}.refuse_erased`, `${table.table}.${key.column} の参照先 ${target} は個人列を持たず、消去の対象ではありません`, 'refuse_erased は消去の対象(個人列を持つ集約)を指す外部キーにだけ書く', where));
      }
      findings.push(...freezeFindings(domain, tables, table, key.column, decl.freezesPersonal !== undefined, where));
    }
  }
  return findings;
}

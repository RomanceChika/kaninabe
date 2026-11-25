/**
 * T28 **個人列の写しの古い値の持ち主を、消去が引き当てられる**(`triggers[].remembers_owner`。点検 19 回目の後の性質テストの反例)。
 *
 * 個人列の写し(`copies_from`)は写した時点の値を持ち、その値の持ち主は写した時点の写し元の行の持ち主である。消去は今の行の持ち主の列で
 * 行を引くので、写した後に次のどれかが起きると、写しに残った古い値が誰のものかが DB から消える:
 *
 *   - 持ち主の列が変わる(紐づけを外す・付け替える)
 *   - 行が消える
 *   - **持ち主のまま、写し元の個人列が書き換わる**(名前を直してから紐づけを外すと、外す時に残るのは直した後の名前で、写しの古い名前ではない)
 *
 * 判定(宣言だけを読む。推測しない):
 *
 *   - 写し元の個人列を持つ表で、本人(消去の効果の `anonymizes` の集約)を直に指す参照の列(`ref`)が作った後に書ける(access の
 *     `transition_writes` か `writes[].fields`)か、**行が操作で消せる**(access の `deletes` が 1 本でもある。点検 20 回目 C20-8。消せる親の
 *     cascade・RPC の副作用の `also_writes` の delete も数える。点検 21 回目 C21-6・22 回目 O22-2)なら、
 *     その列を `remembers_owner` に名指すトリガがある(持ち主の列が書けなくても、行が消えると写しに残った値の持ち主が DB から消える ——
 *     冒頭の 3 つの瞬間の 2 つ目。以前はここで求めず、記録のトリガを宣言したときだけ削除の発火を見ていた)。ただし写しの行が写し元の行の
 *     `id` を外部キーで持ち、その `on_delete` が `cascade` なら、写しは写し元と一緒に消えるので削除の瞬間は求めない(全部の写しがそうなら)
 *   - 行が消せるには、親の集約の削除の外部キーの連鎖(`on_delete: cascade`)で消える場合も数える(点検 21 回目 C21-6)
 *   - `remembers_owner` のトリガの `fires` は、行の削除・持ち主の列の更新・この表から写される個人列の全部の更新で発火する。発火を
 *     `when (…)` で絞ってはならない(条件が外した瞬間に記録しない。点検 21 回目 A21-5)
 *   - `remembers_owner` の列は、その表の集約の `ref` の欄である
 *
 * 本人へ何段かで届く参照(`entry_id → entries.owner_id`)の持ち主の変化は、途中の表の持ち主の列の変化として同じ規則に乗る。消去の効果を持たない製品は何も鳴らない(T24 と同じ扱い)。
 *
 * 本文が実際に記録するかは見ない(それは製品の性質テストが見る)。ここは「記録の口が、値の持ち主が失われる瞬間の全部に開いている」ことの宣言の単位である。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import type { DataTableSpec, DataTableSpecModel, DataTriggerDecl } from '../../model/data/types.js';
import type { JobSpecModel } from '../../model/job/types.js';
import { findEntityFields } from '../../semantics/domain-index.js';
import { firesOnUpdate, parseFires, updatedColumnsOf } from '../../model/trigger-fires.js';
import { rewrittenAfterCreate } from '../../model/written-after-create.js';
import { rowsRemovable } from '../../semantics/row-removal.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T28';

/** 指摘を組み立てる。 */
function t28(table: DataTableSpec, pointer: string, message: string, suggestion: string, counterexample: Readonly<Record<string, string>>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', message, location: { ...table.location, pointer }, suggestion, counterexample: { table: table.table, ...counterexample } };
}

/** 集約の access で、作った後に書ける列(遷移だけが書く列と、編集の規則の列)と、行が操作で消せるか。 */
function afterCreate(domain: SpecModel, tables: readonly DataTableSpec[], entity: string): { readonly writable: ReadonlySet<string>; readonly deletable: boolean } {
  for (const specs of domain.aggregates.values()) {
    if (specs.entity?.entity !== entity) continue;
    // 作った後に書き換わる列の定義は 1 本(`model/written-after-create.ts`。点検 21 回目 C の O21-1: 以前は遷移と編集の欄だけを数えた)。
    const table = tables.find((candidate) => candidate.entity === entity);
    const columns = (specs.entity?.fields ?? []).map((field) => field.name);
    return {
      writable: new Set(columns.filter((column) => rewrittenAfterCreate(column, specs, table, firesOnUpdate))),
      // 行が消えうるかの定義は 1 本(`semantics/row-removal.ts`。T24 と期待表の生成も同じ定義を読む。点検 23 回目 A23-2)。
      deletable: rowsRemovable(domain, tables, entity),
    };
  }
  return { writable: new Set(), deletable: false };
}

/** この表から写される個人列(全 data_table の `copies_from` の写し元のうち、この表の集約の個人列)。 */
function copiedPersonalColumns(domain: SpecModel, tables: readonly DataTableSpec[], table: DataTableSpec): readonly string[] {
  if (table.entity === undefined) return [];
  const personal = new Set((findEntityFields(domain, table.entity) ?? []).filter((field) => field.personal).map((field) => field.name));
  const copied = tables.flatMap((other) => other.triggers.flatMap((trigger) => (trigger.copiesFrom ?? []).filter((copy) => copy.fromTable === table.table).map((copy) => copy.fromColumn)));
  return [...new Set(copied.filter((column) => personal.has(column)))].sort();
}

/**
 * 行の削除で、写しに残った値の持ち主が失われるか(この表の個人列の写しのうち、写し元の行と一緒に消えない写しが 1 つでもあるか)。
 * 写しが写し元の `id` を外部キーで持ち、`on_delete: cascade` なら一緒に消える。
 */
function deleteLosesOwner(domain: SpecModel, tables: readonly DataTableSpec[], table: DataTableSpec): boolean {
  if (table.entity === undefined) return false;
  const personal = new Set((findEntityFields(domain, table.entity) ?? []).filter((field) => field.personal).map((field) => field.name));
  return tables.some((other) =>
    other.triggers.some((trigger) =>
      (trigger.copiesFrom ?? []).some((copy) => {
        if (copy.fromTable !== table.table || !personal.has(copy.fromColumn)) return false;
        const link = copy.match['id'];
        return !other.foreignKeys.some((key) => key.column === link && key.references === table.table && key.onDelete === 'cascade');
      }),
    ),
  );
}

/** `fires` が見ていない瞬間(削除・列の更新)。 */
function missedMoments(trigger: DataTriggerDecl, columns: readonly string[]): readonly string[] {
  if (trigger.fires === undefined) return ['delete', ...columns.map((column) => `update of ${column}`)];
  const events = parseFires(trigger.fires).events;
  const updated = updatedColumnsOf(trigger.fires);
  const missed = events.includes('delete') ? [] : ['delete'];
  for (const column of columns) {
    if (updated === 'all' || (updated !== null && updated.includes(column))) continue;
    missed.push(`update of ${column}`);
  }
  return missed;
}

/** 表 1 つぶん。 */
function tableFindings(domain: SpecModel, tables: readonly DataTableSpec[], table: DataTableSpec, targets: ReadonlySet<string>): Finding[] {
  if (table.entity === undefined) return [];
  const fields = findEntityFields(domain, table.entity) ?? [];
  const refs = new Set(fields.flatMap((field) => (field.type.kind === 'ref' ? [field.name] : [])));
  const owners = new Set(fields.flatMap((field) => (field.type.kind === 'ref' && targets.has(field.type.entity) ? [field.name] : [])));
  const copied = copiedPersonalColumns(domain, tables, table);
  const findings: Finding[] = [];
  const remembering = table.triggers.filter((trigger) => trigger.remembersOwner !== undefined);
  for (const trigger of remembering) {
    const owner = trigger.remembersOwner ?? '';
    const pointer = `triggers.${trigger.name}.remembers_owner`;
    if (!refs.has(owner)) {
      findings.push(t28(table, pointer, `${table.table} のトリガ ${trigger.name} の remembers_owner の ${owner} は ${table.entity} の参照(ref)の欄ではありません`, '持ち主の列は、本人の集約を指す ref の欄にする', { trigger: trigger.name, owner }));
      continue;
    }
    // 発火を条件で絞った記録のトリガは、条件が外した瞬間に記録しない(点検 21 回目 A21-5)。「その瞬間に必ず発火する」と読めないので、
    // remembers_owner には条件を書けない(本文の中で判定する)。
    const condition = parseFires(trigger.fires ?? '').condition;
    if (condition !== null) {
      findings.push(
        t28(
          table,
          `triggers.${trigger.name}.fires`,
          `${table.table} のトリガ ${trigger.name} は元の持ち主(${owner})を記録すると宣言していますが、発火を when (${condition}) で絞っています —— ` +
            '条件が外した削除・更新では記録されず、写しに残った古い値に消去が届きません',
          'remembers_owner のトリガの fires から when (…) を外し、絞るなら本文の中で判定する(記録の口は持ち主が失われる瞬間の全部に開いている)',
          { trigger: trigger.name, owner, condition },
        ),
      );
      continue;
    }
    const missed = missedMoments(trigger, [owner, ...copied.filter((column) => column !== owner)]);
    if (missed.length > 0) {
      findings.push(
        t28(
          table,
          `triggers.${trigger.name}.fires`,
          `${table.table} のトリガ ${trigger.name} は元の持ち主(${owner})を記録すると宣言していますが、${missed.join(' / ')} で発火しません —— ` +
            'その瞬間に写しに残った古い値の持ち主が DB から消え、消去が写しに届きません(持ち主のまま写し元の個人列を書き換えてから紐づけを外すと、記録に残るのは書き換えた後の値です)',
          `fires に ${missed.join(' / ')} を足し、本文はその瞬間の元の持ち主と古い値を記録する`,
          { trigger: trigger.name, owner, missed: missed.join(', ') },
        ),
      );
    }
  }
  if (copied.length === 0) return findings;
  const after = afterCreate(domain, tables, table.entity);
  const writable = after.writable;
  const deletable = after.deletable && deleteLosesOwner(domain, tables, table);
  for (const owner of [...owners].filter((column) => writable.has(column) || deletable).sort()) {
    if (remembering.some((trigger) => trigger.remembersOwner === owner)) continue;
    const why = writable.has(owner) ? `持ち主の列 ${owner} は作った後に書けるのに` : `行は操作で消せて写しは一緒に消えない(access の deletes・写しの外部キーが cascade でない)のに`;
    findings.push(
      t28(
        table,
        'triggers',
        `${table.table} の個人列(${copied.join(', ')})は写されますが、${why}、元の持ち主を記録するトリガ(remembers_owner: ${owner})がありません —— ` +
          '持ち主が変わった・行が消えた後、写しに残った古い値に消去が届きません',
        `元の持ち主と古い値を記録するトリガを書き、triggers に remembers_owner: ${owner} と、行の削除・${owner} と写される個人列の更新で発火する fires を宣言する`,
        { owner, columns: copied.join(', ') },
      ),
    );
  }
  return findings;
}

/**
 * 個人列の写しの古い値の持ち主を記録する口が、持ち主が失われる瞬間の全部に開いているかを見る。
 *
 * @param domain ドメイン仕様
 * @param dataTables 全 data_table
 * @param jobs ジョブカタログ(消去の効果の `anonymizes` が本人の集約。読めない構成では持ち主の列を求める側は見ない)
 * @returns 指摘の並び
 */
export function verifyCopyOwnerMemory(domain: SpecModel, dataTables: DataTableSpecModel, jobs: JobSpecModel | undefined): Finding[] {
  if (!dataTables.available) return [];
  const targets = new Set(jobs?.available === true && jobs.catalog !== null ? jobs.catalog.jobs.flatMap((job) => (job.anonymizes === undefined ? [] : [job.anonymizes])) : []);
  return dataTables.tables.flatMap((table) => tableFindings(domain, dataTables.tables, table, targets));
}

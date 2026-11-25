/**
 * T15 **トリガが供給する列を、生成物だけの系で誰が埋めるか**。
 *
 * V17 は `supplied_by: db` の側から「機構(`defaults` か `triggers[].supplies`)があるか」を、
 * T9 はその逆向きを見る。どちらも**宣言が揃っているか**しか見ておらず、
 * **その機構が実際に動く SQL になるか**は誰も見ていなかった —— `kind: trigger` の関数の本文は
 * 長いあいだ生成物ではなく、手書きの migration の中にしか無かったからである。
 *
 * 題材の製品はそれで回る。空の DB から**生成物だけで**立ち上げる系(fixture 4 題材)は回らない ——
 * 束 ③-2 の 1 往復で 親から写す列と貸出期限の列が NOT NULL に当たって落ちた。
 *
 * 写しのトリガが写し元の隠し列・個人列の約束を保つかは `checkCopyExposure` が見る(点検 12 回目 A12-2。判定は V12 と同じ `semantics/copy-exposure.ts`)。
 * 写し元が書き換えられないこと・写す列そのものの更新でも写し直すことは `t15-copy-source.ts` が見る(点検 26 回目 A26-2)。
 *
 * 見るのは 4 つである(**宣言した導出 `derives` の側は `t15-derived-columns.ts`** が見る。
 * `derives` を宣言した列は「生成物が埋める」と数え、4 つ目の warning は出ない)。
 *
 * | 何を | 重さ | なぜ |
 * |---|---|---|
 * | 写しとして導出でき、本文が生成されるのに `functions[]` に `kind: trigger` の宣言が無い | error | 生成先の宣言が無い(関数の閉世界が「DB にあって宣言に無い関数」で落ちる) |
 * | 写しのトリガの `fires` が表名まで書いている | error | 生成が `on {表}` を付けるので `… on t on public.t` になる。表名は書かない |
 * | 写しと**宣言されている**のに参照の連鎖が解けない | warning | 書いた人に「書け」と言わない。切れている場所(届かない / 道が 2 本)を名指す |
 * | 供給する列に機構が導出できない(写しでもなく `defaults` も無い) | warning | **生成物だけの系では誰も埋めない**。本文が手書きの migration にあるなら、その系でだけ埋まる |
 *
 * 3 つ目が warning なのは、手書きの本文が**正しい答えである場合がある**からである ——
 * 同じ行の別の列からの逆算(列の既定値は他の列を読めない)や子集約の畳み込みは、宣言から
 * 本文を導けない(`docs/design/triage-db-supplied-values.md`)。error にすると
 * 「導けないものを書くな」という別の規則に化ける。
 *
 * **免除リストは無い。** 導けるかどうかは宣言から読める構造(`formal` の等値比較と参照の連鎖)
 * だけで決まる。
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import { generatedCopiesOf, nameTheTable } from '../../sql/ddl-copy-triggers.js';
import { checkDerivedTrigger } from './t15-derived-columns.js';
import { checkCopyFiresOnOwnColumn, checkCopySourceFixed } from './t15-copy-source.js';
import { copyExposureFindings } from '../../semantics/copy-exposure.js';
import { type CopyDeclarations, type UnresolvedCopy, copyDeclarationsOf, MAX_COPY_DEPTH } from '../../world/index.js';
import type { DataTableSpecModel, DataTableSpec, DataTriggerDecl } from '../../model/data/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T15';

/**
 * 全 data_table のトリガについて、供給する列の機構が生成物だけの系で成立するかを見る。
 *
 * @param domain 構築済みのドメイン仕様モデル
 * @param dataTables 読み込み済みの data_table
 * @returns 違反のリスト
 */
export function verifySuppliedMechanism(domain: SpecModel, dataTables: DataTableSpecModel): Finding[] {
  if (!dataTables.available) return [];
  const findings: Finding[] = [];
  for (const table of dataTables.tables) {
    const entity = table.entity;
    for (const trigger of table.triggers) findings.push(...checkCopyExposure(trigger, table, domain));
    if (entity === undefined) continue;
    for (const trigger of table.triggers) {
      if (trigger.supplies.length === 0 && trigger.derives === undefined) continue;
      findings.push(...checkTrigger(trigger, table, entity, domain));
      findings.push(...checkCopyRefresh(trigger, table, entity, domain));
      findings.push(...checkCopySourceFixed(trigger, table, entity, domain));
      findings.push(...checkCopyFiresOnOwnColumn(trigger, table, entity, domain, firesOnUpdateOf));
    }
  }
  return findings;
}

/**
 * 写しのトリガが写し元の約束を保つかを見る(解けない写しも、写し元は宣言から読めるので見る)。
 *
 * 見るのは `supplies` に載った写しだけである —— 載っていない列の等式は「条件を課す」宣言で、値を運ばない。
 * 導出(`derives`)は同じ行の中の値なので写しではない。写しの列が無い要素の `copy_accept` は腐っている。
 */
function checkCopyExposure(trigger: DataTriggerDecl, table: DataTableSpec, domain: SpecModel): Finding[] {
  const entity = table.entity;
  const declared = entity === undefined || trigger.derives !== undefined ? null : copyDeclarationsOf(domain, entity, trigger.invariant);
  const copies = [...(declared?.resolved ?? []), ...(declared?.unresolved ?? [])].filter((copy) => trigger.supplies.includes(copy.column));
  const accepts = trigger.accept ?? [];
  const columns = new Set([...copies.map((copy) => copy.column), ...accepts.map((accept) => accept.column)]);
  return [...columns].flatMap((column) => {
    const copy = copies.find((candidate) => candidate.column === column);
    return copyExposureFindings(domain, {
      verifier: VERIFIER_ID,
      context: `${table.table} のトリガ ${trigger.name}`,
      from: { entity: copy?.fromEntity ?? '', field: copy?.fromColumn ?? '' },
      to: { entity: entity ?? '', field: column },
      accepts: accepts.filter((accept) => accept.column === column),
      location: { ...table.location, pointer: `triggers.${trigger.name}.supplies` },
      acceptHint: `トリガの copy_accept(column: ${column})`,
    });
  });
}

/** `fires` の `update` が、その列の更新で発火するか(`update of` の列の並びに無ければ発火しない)。 */
function firesOnUpdateOf(fires: string, column: string): boolean {
  const update = /\bupdate\b(?:\s+of\s+(.+?))?(?=\s+or\s+|\s+on\s+|\s+for\s+|\s*\(|\s*$)/iu.exec(fires);
  if (update === null) return false;
  const columns = update[1];
  return columns === undefined || columns.split(',').map((name) => name.trim().toLowerCase()).includes(column);
}

/**
 * 写しの参照の列が編集できるなら、トリガはその列の更新で写し直す(点検 14 回目 A14-7)。
 *
 * `before insert` だけの写しは、参照を付け替えても追わない。個人列の写しなら別の行の値が残る。
 */
function checkCopyRefresh(trigger: DataTriggerDecl, table: DataTableSpec, entity: string, domain: SpecModel): Finding[] {
  if (trigger.derives !== undefined || trigger.fires === undefined) return [];
  const editable = new Set(domain.aggregates.get(entity)?.access?.writes.flatMap((rule) => rule.fields) ?? []);
  const fires = trigger.fires;
  const stale = copyDeclarationsOf(domain, entity, trigger.invariant).resolved.filter((copy) => trigger.supplies.includes(copy.column) && editable.has(copy.path[0]?.refColumn ?? '') && !firesOnUpdateOf(fires, copy.path[0]?.refColumn ?? ''));
  return stale.map((copy) => ({
    verifier: VERIFIER_ID,
    severity: 'error' as const,
    message: `${table.table} のトリガ ${trigger.name} は ${copy.column} の写しですが、編集できる参照の列 ${copy.path[0]?.refColumn ?? ''} の更新で発火しません(付け替えても写しが追いません)`,
    location: { ...table.location, pointer: `triggers.${trigger.name}.fires` },
    suggestion: `fires に "update of ${copy.path[0]?.refColumn ?? ''}" を足す`,
    counterexample: { table: table.table, trigger: trigger.name, column: copy.column, ref: copy.path[0]?.refColumn ?? '', fires },
  }));
}

/** トリガ 1 本の機構を見る。 */
function checkTrigger(
  trigger: DataTriggerDecl,
  table: DataTableSpec,
  entity: string,
  domain: SpecModel,
): Finding[] {
  if (trigger.derives !== undefined) {
    const problems = checkDerivedTrigger(trigger, table, domain);
    return problems.length > 0 ? problems : declaredFunction(trigger, table);
  }
  const generated = generatedCopiesOf(trigger, entity, domain);
  if (generated !== null) return declaredFunction(trigger, table);
  const declarations = copyDeclarationsOf(domain, entity, trigger.invariant);
  if (nameTheTable(trigger.fires) && allCopied(trigger, declarations)) return [firesNamesTable(trigger, table)];
  const broken = declarations.unresolved.filter((copy) => trigger.supplies.includes(copy.column));
  const findings = broken.length === 0 ? [] : [brokenPath(trigger, table, entity, broken)];
  const missing = unresolvedColumns(trigger, declarations, table, broken);
  return missing.length === 0 ? findings : [...findings, unresolvedFinding(trigger, table, missing)];
}

/** そのトリガが供給する列が全部「写し」として解けるか(`fires` の形は問わない)。 */
function allCopied(trigger: DataTriggerDecl, declarations: CopyDeclarations): boolean {
  return trigger.supplies.every((column) => declarations.resolved.some((copy) => copy.column === column));
}

/**
 * 機構が導出できない列(写しの宣言も無く、列の既定値も宣言されていない)。
 *
 * **道が解けなかった列はここに入れない** —— それは「宣言が無い」ではなく「宣言はあるが
 * 連鎖が決まらない」であり、別の文言(`brokenPath`)が名指す。
 */
function unresolvedColumns(
  trigger: DataTriggerDecl,
  declarations: CopyDeclarations,
  table: DataTableSpec,
  broken: readonly UnresolvedCopy[],
): readonly string[] {
  return trigger.supplies.filter(
    (column) =>
      !declarations.resolved.some((copy) => copy.column === column) &&
      !broken.some((copy) => copy.column === column) &&
      table.defaults[column] === undefined,
  );
}

/** 写しと宣言されているのに、写し元まで参照の連鎖が解けない。 */
function brokenPath(
  trigger: DataTriggerDecl,
  table: DataTableSpec,
  entity: string,
  broken: readonly UnresolvedCopy[],
): Finding {
  const columns = broken.map((copy) => copy.column).join(' / ');
  const where = broken
    .map((copy) =>
      copy.reason === 'ambiguous'
        ? `${copy.column}: ${entity} から ${copy.fromEntity} へ届く参照の道が 2 本以上ある`
        : `${copy.column}: ${entity} から ${copy.fromEntity} へ参照列を ${MAX_COPY_DEPTH} 段たどっても届かない`,
    )
    .join(' / ');
  return {
    verifier: VERIFIER_ID,
    severity: 'warning',
    message: `${table.table} のトリガ ${trigger.name} が供給する ${columns} は写しと宣言されていますが、参照の連鎖が解けません(${where})`,
    location: { ...table.location, pointer: `triggers.${trigger.name}.supplies` },
    suggestion:
      '宣言は足りている —— 足りないのは写し元まで届く参照列である。' +
      `${entity} から写し元へ 1 本に決まる ref(...) の列を entity_spec に持たせる` +
      '(道が 2 本あるなら、写し元を近い側の集約に取り直して連鎖を 1 本にする)。' +
      'それができないなら、その列の本文は手書きの migration が持つ',
    counterexample: { table: table.table, trigger: trigger.name, columns, where },
  };
}

/** 本文を生成するトリガの関数が `functions[]` に宣言されているか。 */
function declaredFunction(trigger: DataTriggerDecl, table: DataTableSpec): Finding[] {
  const declared = table.functions.some(
    (fn) => fn.name === trigger.functionName && fn.kind === 'trigger',
  );
  if (declared) return [];
  return [
    {
      verifier: VERIFIER_ID,
      severity: 'error',
      message: `${table.table} のトリガ ${trigger.name} は本文が生成されますが、関数 ${trigger.functionName} が functions[] に kind: trigger で宣言されていません`,
      location: { ...table.location, pointer: `triggers.${trigger.name}` },
      suggestion:
        `functions に "- name: ${trigger.functionName} / args: [] / kind: trigger" を足す` +
        '(public の関数の完全集合は全 data_table の functions の和である。宣言が無い関数が DB にあると閉世界の突合が落ちる)',
      counterexample: { table: table.table, trigger: trigger.name, function: trigger.functionName },
    },
  ];
}

/** `fires` が表名まで書いている(生成が `on {表}` を付けるので二重になる)。 */
function firesNamesTable(trigger: DataTriggerDecl, table: DataTableSpec): Finding {
  return {
    verifier: VERIFIER_ID,
    severity: 'error',
    message: `${table.table} のトリガ ${trigger.name} の fires が表名まで書いています(本文を生成する形なので、表名は生成が付けます)`,
    location: { ...table.location, pointer: `triggers.${trigger.name}.fires` },
    suggestion: `fires から " on ${table.table}" を外す(例: "before insert or update of {列}")`,
    counterexample: { table: table.table, trigger: trigger.name, fires: trigger.fires ?? '' },
  };
}

/** 機構が導出できない列(生成物だけの系では誰も埋めない)。 */
function unresolvedFinding(
  trigger: DataTriggerDecl,
  table: DataTableSpec,
  columns: readonly string[],
): Finding {
  return {
    verifier: VERIFIER_ID,
    severity: 'warning',
    message: `${table.table} のトリガ ${trigger.name} が供給する ${columns.join(' / ')} は、生成物だけでは誰も埋めません(本文は手書きの migration にしかありません)`,
    location: { ...table.location, pointer: `triggers.${trigger.name}.supplies` },
    suggestion:
      '値が SQL の式 1 本で決まるなら defaults(列の既定値)へ倒す。' +
      '祖先の列の写しなら、そのトリガが宣言する不変条件の formal に "{自集約}.{列} == {別の集約}.{列}" を書く(本文が生成物になる)。' +
      'どちらでもない(同じ行の別の列からの逆算・子集約の畳み込み)なら、本文は手書きのままでよい —— ただしそのアプリは生成物だけでは空の DB から立ち上がらない',
    counterexample: { table: table.table, trigger: trigger.name, columns: columns.join(', ') },
  };
}

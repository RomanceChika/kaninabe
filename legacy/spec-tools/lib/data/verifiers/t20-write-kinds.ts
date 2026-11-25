/**
 * T20 **書き込みの宣言の接地**(`also_writes` / `self_writes` / `calls`)。
 *
 * 書き込みの種類の宣言は操作の属性(destructive / touches_personal)の材料になる。形(必須・値域・重複)はパーサー(T0)が見る。
 * ここは意味を見る:
 *
 *   - `scrub`(個人列を置き換えて消す)を宣言した表は、entity_spec に `personal: true` の欄を持つ
 *     (消す個人列が無い `scrub` は、確認の文言に「データが削除されます」を出す根拠にならない)。`self_writes` も同じ
 *   - `also_writes` の書き込み先は、data_table か entity_spec に実在する(綴り間違いが「何も書かない」と読まれない)
 *   - `also_writes` は帰属表(自表)を名指さない(自表への書き込みは `self_writes`。2 か所に書くと正が 2 つになる)
 *   - `calls` の呼び先は data_table の関数(`kind: rpc` / `helper` / `send_limit`)に実在し、自分自身ではない
 *     (呼び先の書き込みは呼んだ側の操作の属性に合流するので、引けない名前は合流を黙って落とす)
 *
 * 本文が実際に行う書き込み・呼び出しとの一致は、実 DB の rpc-parity が見る(`scrub` は本文では `update`)。
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import { pluralizeEntity } from '../../model/table-name.js';
import type { DataFunctionDecl, DataTableSpec, DataTableSpecModel } from '../../model/data/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T20';

/** 検査に要る索引(個人列の有無・実在する表・関数の名前)。 */
interface WriteIndex {
  readonly personal: ReadonlyMap<string, boolean>;
  readonly known: ReadonlySet<string>;
  readonly callable: ReadonlySet<string>;
}

/** T20 の指摘を組み立てる。 */
function finding(table: DataTableSpec, pointer: string, message: string, suggestion: string, counterexample: Record<string, string>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', message, location: { ...table.location, pointer }, suggestion, counterexample };
}

/** `also_writes` の 1 表ぶん。 */
function alsoWriteFindings(table: DataTableSpec, fn: DataFunctionDecl, written: string, kinds: readonly string[], index: WriteIndex): Finding[] {
  const pointer = `functions.${fn.name}.also_writes.${written}`;
  if (written === table.table) {
    return [
      finding(
        table,
        pointer,
        `${fn.name} の also_writes が帰属表 ${written} を名指しています(自表への書き込みは self_writes に書きます)`,
        `also_writes から ${written} を外し、自表への書き込みの種類は self_writes に書く(定型 4 形は形が決める)`,
        { function: fn.name, table: written },
      ),
    ];
  }
  if (!index.known.has(written)) {
    return [
      finding(
        table,
        pointer,
        `${fn.name} の also_writes の ${written} は、data_table にも entity_spec にも無い表です`,
        `表名の綴りを直す（実在する表: ${[...index.known].sort().join(', ')}）`,
        { function: fn.name, table: written },
      ),
    ];
  }
  return kinds.includes('scrub') && index.personal.get(written) !== true ? [scrubFinding(table, fn, pointer, written, kinds)] : [];
}

/** personal 列の無い表への scrub。 */
function scrubFinding(table: DataTableSpec, fn: DataFunctionDecl, pointer: string, written: string, kinds: readonly string[]): Finding {
  return finding(
    table,
    pointer,
    `${fn.name} の ${pointer.endsWith('self_writes') ? 'self_writes' : `also_writes の ${written}`} に scrub（個人列を置き換えて消す）が宣言されていますが、${written} に personal: true の欄がありません`,
    `${written} が消す個人列を持たないなら scrub ではなく update を書く（実際に個人列を消すなら entity_spec に personal: true を宣言する）`,
    { function: fn.name, table: written, kinds: kinds.join(',') },
  );
}

/** 関数 1 本ぶん。 */
function functionFindings(table: DataTableSpec, fn: DataFunctionDecl, index: WriteIndex): Finding[] {
  const findings = Object.entries(fn.alsoWriteKinds ?? {}).flatMap(([written, kinds]) => alsoWriteFindings(table, fn, written, kinds, index));
  if (fn.selfWriteKinds?.includes('scrub') === true && index.personal.get(table.table) !== true) {
    findings.push(scrubFinding(table, fn, `functions.${fn.name}.self_writes`, table.table, fn.selfWriteKinds));
  }
  for (const callee of fn.calls ?? []) {
    if (callee !== fn.name && index.callable.has(callee)) continue;
    findings.push(
      finding(
        table,
        `functions.${fn.name}.calls`,
        callee === fn.name
          ? `${fn.name} の calls が自分自身を名指しています`
          : `${fn.name} の calls の ${callee} は、data_table に実在する関数(kind: rpc / helper / send_limit)ではありません`,
        `calls には本文が呼ぶ他の関数を、data_table の functions に宣言した名前で書く(呼ばれた側の書き込みが操作の属性に合流する)`,
        { function: fn.name, callee },
      ),
    );
  }
  return findings;
}

/**
 * 全 data_table の書き込みの宣言を、entity_spec と表・関数の一覧に突き合わせる。
 *
 * @param domain 構築済みのドメイン仕様モデル（個人列の有無）
 * @param dataTables 読み込み済みの data_table
 * @returns 違反のリスト
 */
export function verifyWriteKinds(domain: SpecModel, dataTables: DataTableSpecModel): Finding[] {
  if (!dataTables.available) return [];
  const personal = new Map<string, boolean>();
  for (const specs of domain.aggregates.values()) {
    if (specs.entity === undefined) continue;
    personal.set(specs.entity.table ?? pluralizeEntity(specs.entity.entity), specs.entity.fields.some((field) => field.personal));
  }
  for (const table of dataTables.tables) if ((table.personalColumns ?? []).length > 0) personal.set(table.table, true);
  const index: WriteIndex = {
    personal,
    known: new Set([...personal.keys(), ...dataTables.tables.map((table) => table.table)]),
    callable: new Set(dataTables.tables.flatMap((table) => table.functions.filter((fn) => fn.kind !== 'trigger').map((fn) => fn.name))),
  };
  return dataTables.tables.flatMap((table) => table.functions.flatMap((fn) => functionFindings(table, fn, index)));
}

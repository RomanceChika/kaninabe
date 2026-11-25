/**
 * T21 **外部キーの連鎖で暗黙に起きる書き込みも、書き込みの宣言に載っている**(`on delete cascade` / `set null` の閉包)。
 *
 * RPC が行を消すと、その表を参照する外部キーの `on_delete` に従って、本文に書いていない表の行も消える(`cascade`)か
 * 書き換わる(`set_null` / `set_default`)。本文の字面だけを見る宣言(`also_writes`)はこれを取りこぼし、操作の属性
 * (destructive / touches_personal)と見張り(rpc-parity)の両方から暗黙の削除が見えなくなる
 * (後始末の削除が、その下の子の行を連鎖で消しているのに宣言に無い、が実際に起きた)。
 *
 * そこで、書き込み RPC が `delete` を宣言した表(`also_writes` と自表の `self_writes` / 形の既定)から、data_table の
 * `foreign_keys[].on_delete` を辿って閉包を求め、閉包に入る表が宣言に載っていることを要求する:
 *
 *   - `cascade` … 参照する側の表に `delete`(さらにその表から辿る)
 *   - `set_null` / `set_default` … 参照する側の表に `update`
 *   - `no_action` / `restrict` … 書き込みは起きない(子が残っていれば削除そのものが失敗する)
 *
 * 実 DB の外部キー(`pg_constraint.confdeltype`)との一致は data-table-parity が、本文の削除から辿った閉包と宣言の一致は
 * rpc-parity が見る(宣言の外部キーと DB の外部キーのどちらかがずれれば、どちらかが赤になる)。
 */

import type { Finding } from '../../kernel/finding.js';
import { selfWriteKindsOf } from '../../model/data/rpc-writes.js';
import type { DataFunctionDecl, DataTableSpec, DataTableSpecModel, DataWriteKind } from '../../model/data/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T21';

/** 閉包が要求する書き込み 1 件(どの外部キーから来たか)。 */
interface ImpliedWrite {
  readonly table: string;
  readonly kind: DataWriteKind;
  /** 起点の削除から辿った外部キーの道筋(`親 → 子.列(on delete …)`)。 */
  readonly path: readonly string[];
}

/** 参照先の表名(public の表だけを数える。`auth.users` のような別スキーマは連鎖の起点にならない)。 */
function referencedTable(references: string): string | null {
  if (!references.includes('.')) return references;
  return references.startsWith('public.') ? references.slice('public.'.length) : null;
}

/**
 * 表の削除から外部キーを辿って、暗黙に起きる書き込みを求める。
 *
 * @param tables 全 data_table
 * @param roots 起点の削除(表名)
 * @returns 暗黙に起きる書き込み(表 × 種類で重複なし)
 */
export function impliedWrites(tables: readonly DataTableSpec[], roots: readonly string[]): readonly ImpliedWrite[] {
  const result: ImpliedWrite[] = [];
  const queue: { readonly table: string; readonly path: readonly string[] }[] = roots.map((table) => ({ table, path: [] }));
  const visited = new Set<string>(roots);
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const child of tables) {
      for (const fk of child.foreignKeys) {
        if (referencedTable(fk.references) !== current.table) continue;
        const step = `${current.table} → ${child.table}.${fk.column}(on delete ${fk.onDelete})`;
        const kind: DataWriteKind | null = fk.onDelete === 'cascade' ? 'delete' : fk.onDelete === 'set_null' || fk.onDelete === 'set_default' ? 'update' : null;
        if (kind === null) continue;
        const path = [...current.path, step];
        if (!result.some((write) => write.table === child.table && write.kind === kind)) result.push({ table: child.table, kind, path });
        if (kind === 'delete' && !visited.has(child.table)) {
          visited.add(child.table);
          queue.push({ table: child.table, path });
        }
      }
    }
  }
  return result;
}

/** 関数 1 本が宣言する書き込み(他の表 + 自表)。 */
function declaredWrites(home: string, fn: DataFunctionDecl): ReadonlyMap<string, readonly DataWriteKind[]> {
  const declared = new Map<string, readonly DataWriteKind[]>(Object.entries(fn.alsoWriteKinds ?? {}));
  declared.set(home, selfWriteKindsOf(fn) ?? []);
  return declared;
}

/** 関数 1 本ぶんの検査。 */
function verifyFunction(tables: readonly DataTableSpec[], table: DataTableSpec, fn: DataFunctionDecl): Finding[] {
  const declared = declaredWrites(table.table, fn);
  const roots = [...declared].filter(([, kinds]) => kinds.includes('delete')).map(([written]) => written);
  if (roots.length === 0) return [];
  return impliedWrites(tables, roots)
    .filter((write) => !(declared.get(write.table) ?? []).includes(write.kind))
    .map((write): Finding => {
      const where = write.table === table.table ? 'self_writes' : `also_writes の ${write.table}`;
      return {
        verifier: VERIFIER_ID,
        severity: 'error',
        message:
          `${fn.name} の削除が外部キーの連鎖で ${write.table} に ${write.kind} を起こしますが、${where} に ${write.kind} が宣言されていません` +
          `(${write.path.join(' / ')})`,
        location: { ...table.location, pointer: `functions.${fn.name}.also_writes` },
        suggestion:
          write.table === table.table
            ? `self_writes に ${write.kind} を足す(自表を参照する外部キーの連鎖も、本文が書かなくても起きる書き込みである)`
            : `also_writes に "${write.table}: [${write.kind}]" を足す(連鎖で起きる書き込みは本文に書いていなくても起きる。` +
              '操作の属性と見張りが暗黙の削除を数えるため)。連鎖させたくないなら外部キーの on_delete を見直す',
        counterexample: { function: fn.name, table: write.table, kind: write.kind, path: write.path.join(' / ') },
      };
    });
}

/**
 * 全 data_table の書き込み RPC について、削除から辿る外部キーの閉包が宣言に載っているかを見る。
 *
 * @param dataTables 読み込み済みの data_table
 * @returns 違反のリスト
 */
export function verifyCascadeClosure(dataTables: DataTableSpecModel): Finding[] {
  if (!dataTables.available) return [];
  return dataTables.tables.flatMap((table) =>
    table.functions.filter((fn) => fn.kind === 'rpc').flatMap((fn) => verifyFunction(dataTables.tables, table, fn)),
  );
}

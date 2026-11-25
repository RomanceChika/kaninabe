/**
 * 定型 RPC の書き込みが**トリガと外部キーの連鎖を通して**掴む行(点検 18 回目 O18-1)。
 *
 * 定型 RPC は「この txn が触る行を全部、表名のバイト順で掴んでから最初の書き込みをする」(ARCH-SP-BE-0001)。
 * 触る行は本文に書いた行だけではない —— 書き込みが発火させるトリガが書く行と、削除が外部キーの連鎖
 * (`on delete cascade` / `set null` / `set default`)で書き換える行も、この txn が掴む。そこを先掴みの列に
 * 入れないと、トリガ・連鎖の中で**後から**掴むことになり、名前の小さい表を後ろで掴む逆順ができる
 * (実測: 親の遷移が監査ログのトリガの中で、親を指す子の表の行を後から掴み、子 → 親の順に掴む子の更新と
 * 40P01 になった。点検 18 回目 O18-1)。掴む相手は**宣言だけ**から決める(本文は読まない)。
 *
 * | 経路 | 宣言 | 掴む行 |
 * |---|---|---|
 * | 書き込みが発火させるトリガ | その表の `triggers[].fires` と、トリガ関数の `also_writes`(update / delete / scrub) | 書かれる表のうち、**自表を直に指す外部キー**が対象の行を指す行 |
 * | 削除の外部キーの連鎖 | この関数の `also_writes`(T21 が連鎖の閉包を見る)と各表の `foreign_keys[].on_delete` | 連鎖の道(cascade で消える表を経て自表へ着く外部キーの鎖)が対象の行に着く行 |
 * | 書き込みが発火させるトリガの**掴みの宣言**(点検 19 回目 A19-1) | `triggers[].locks: { {表}: share \| update }` | 発火させた行が直の外部キーで指す親の行(宣言の強さ。期待状態の親と同じ行なら、そちらの掴みを強める) |
 * | 書き込みが発火させるトリガの**写し元**(点検 19 回目 A19-3) | `triggers[].copies_from` | 写し元の表の、`match` の等式で選ぶ行(共有。写しの作成と写し元の消去を 1 本ずつに並べる) |
 * | 参照の欄が指す行を読む条件の**相手の端**が掴む錨の行(点検 D25s2-1) | 自表の執行点の宣言と不変条件の `formal`(`refCounterpartsOf`) | その行を指す自表の行が指す錨の行(id の順。強さは計画のとおり) |
 *
 * 宣言から行を引き当てられない書き込み(自表を指す外部キーが無いトリガの書き込み先)は掴まない —— その
 * 書き込みが本当にこの関数で起きるか(トリガの門で止まるか)は宣言からは読めない。そこは実 DB の本文と
 * トリガを閉包まで読む見張りテスト(`lock-order-parity`)が赤にする。
 *
 * **作成も掴みの宣言と写し元は掴む**(点検 19 回目 O19-3)。作成は対象の行がまだ無いので、それを指す子の行(上の 2 段)は
 * 無い。一方で、作成が発火させるトリガが親を強く掴む・写し元を読むことはある —— その行は作成が入れる値(`p_{列}`)で引ける。
 * 親を指す列が作成の入れない写しの列なら、写し元の行を作成の値で選ぶ副問い合わせで引く(点検 24 回目 B24-1。`copiedValue`)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { DataForeignKeyDecl, DataTableSpec, DataTriggerDecl, DataWriteKind } from '../model/data/types.js';
import type { LockStrength } from '../model/data/types-locks.js';
import { impliedLocksOf } from '../model/data/check-trigger-locks.js';
import { anchorRows } from './rpc-anchor-locks.js';
import { writtenRow, type RowId } from './rpc-row-id.js';
import type { SpecModel } from '../model/types.js';
import { parseFires, updatedColumnsOf } from '../model/trigger-fires.js';

/** 連鎖・トリガで掴む行 1 つ(`from` と `where` は対象の行の id の式を埋めたもの)。 */
export interface ClosureLockRow {
  /** 掴む表(スキーマ修飾なし。並べ替えに使う)。 */
  readonly table: string;
  /** 掴む行に付ける別名。 */
  readonly alias: string;
  readonly from: readonly string[];
  readonly where: readonly string[];
  /** 掴み方(トリガ・連鎖が書く行は `update`、宣言の強さ・写し元は宣言のとおり)。 */
  readonly mode: LockStrength;
  /** 1 行を id で名指せるならその式(同じ行を別の経路で掴む文と畳む鍵。対象の行の列は `t.{列}` と書く)。 */
  readonly idKey: string | null;
  /** 複数の行を掴むなら id の昇順で並べる。 */
  readonly ordered: boolean;
  /** 掴む 1 行がこの書き込みが自表の参照列に入れる値で決まるなら、その列(`rpc-fk-check-order.ts` の照合が読む)。 */
  readonly ids?: readonly RowId[];
}

/** 引き当ての入力。 */
export interface ClosureLockInput {
  /** 関数名(自表の `functions` から `also_writes` を引く)。 */
  readonly name: string;
  readonly shape: 'create' | 'update' | 'delete' | 'transition';
  readonly table: DataTableSpec;
  /** 全 data_table(トリガの宣言と外部キーを引く)。 */
  readonly tables: readonly DataTableSpec[];
  /** 対象の行の id を与える式。 */
  readonly targetId: string;
  /** ドメイン仕様(本文が生成物のトリガが掴む親の行 `impliedLocksOf` を引く。無ければ宣言の `locks` だけ)。 */
  readonly domain?: SpecModel;
  /** 自表への書き込みが書き換える列(`update of` の引き当て。null = 読めない = どの列も書くと読む)。 */
  readonly writtenColumns?: readonly string[] | null;
  /** 作成が列に入れる式(作成以外・入れない列は null)。 */
  readonly insertExpression?: (column: string) => string | null;
  /** 編集が列に入れる式(`t` が自表の行。編集以外・書かない列は null。fix25s)。 */
  readonly updateExpression?: (column: string) => string | null;
}

/** 掴む行に付ける別名の前置(`c0` / `c1` …。他のどの別名とも衝突しない)。 */
const CLOSURE_ALIAS_PREFIX = 'c';

/** 経由する表に付ける別名の前置(`c0_0` …)。 */
const HOP_ALIAS_SEPARATOR = '_';

/** 監査ログの設計図の名前(全部の定型 RPC が追記する)。 */
const AUDIT_FRAMEWORK = 'domain_events';

/** 行を書き換える(= 既存の行を掴む)書き込みの種類。 */
const LOCKING_KINDS: ReadonlySet<DataWriteKind> = new Set<DataWriteKind>(['update', 'delete', 'scrub']);

/** 連鎖が子の行を書き換える削除の動作。 */
const CHAINING_ACTIONS: ReadonlySet<string> = new Set(['cascade', 'set_null', 'set_default']);

/** 連鎖の道の長さの上限(循環する外部キーで止まらなくならないため)。 */
const MAX_HOPS = 4;

/** 自表から子へ 1 歩(子の表と、子が親を指す列)。 */
interface Hop {
  readonly table: string;
  readonly column: string;
}

/**
 * 定型 RPC の書き込みがトリガと外部キーの連鎖を通して掴む行を、掴める形にして返す。
 *
 * @param input 関数の宣言・自表・全 data_table・対象の行の id の式
 * @returns 掴む行の並び(宣言順。表名の並べ替えは呼ぶ側)
 */
export function closureLockRows(input: ClosureLockInput): readonly ClosureLockRow[] {
  const paths = input.shape === 'create' ? [] : [...triggerPaths(input), ...(input.shape === 'delete' ? cascadePaths(input) : [])];
  const seen = new Set<string>();
  const rows: ClosureLockRow[] = [];
  for (const path of paths) {
    const key = path.map((hop) => `${hop.table}.${hop.column}`).join('>');
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(rowOf(path, rows.length, input.targetId));
  }
  const declared = declaredRows(input, rows.length);
  return [...rows, ...declared, ...anchorRows(input, rows.length + declared.length)];
}

/** 対象の行の別名(期待状態の親の掴みと同じ字面。畳みの鍵に使う)。 */
const TARGET = 't';

/** 自表の行の列の値(作成は入れる式、それ以外は対象の行の列。言えなければ null)。 */
function ownValue(input: ClosureLockInput, alias: string, column: string): { readonly from: readonly string[]; readonly where: readonly string[]; readonly value: string; readonly key: string; readonly id?: RowId } | null {
  if (input.shape === 'create') {
    const inserted = input.insertExpression?.(column) ?? null;
    const expression = inserted ?? copiedValue(input, column);
    return expression === null ? null : { from: [], where: [], value: expression, key: expression, ...(inserted === null ? {} : { id: writtenRow(column) }) };
  }
  // 編集が書き換えうる列は、書いた後の値(本文の代入と同じ字面で、自表の行を同じ別名 `t` で引く)。トリガは書いた後の行の参照の欄で親を掴むので、
  // 書く前の値の親を掴んでも覆いにならない(fix25s。希望する部を付け替える編集が、新しい部の行をコミット時に掴んでいた)。
  const changed = input.shape === 'update' ? (input.updateExpression?.(column) ?? null) : null;
  if (changed !== null) return { from: [`public.${input.table.table} ${TARGET}`], where: [`${TARGET}.id = ${input.targetId}`], value: changed, key: `${TARGET}.${column}:changed`, id: writtenRow(column) };
  const own = `${alias}${HOP_ALIAS_SEPARATOR}${TARGET}`;
  return { from: [`public.${input.table.table} ${own}`], where: [`${own}.id = ${input.targetId}`], value: `${own}.${column}`, key: `${TARGET}.${column}` };
}

/** 写し元の行に付ける別名(ガードの鎖の 1 段目と同じ字面にして、同じ親の掴みと畳めるようにする。`rpc-reach.ts`)。 */
const COPY_SOURCE_ALIAS = 'r1';

/**
 * 作成が入れない列のうち、挿入のトリガが**写し元から写す**列の値(点検 24 回目 B24-1)。
 *
 * 写しの列(`copies_from`)は作成の引数に無いので、その列が指す親を掴む宣言(`locks`)を作成の値で引けなかった ——
 * 番号を数えるトリガが親を排他で掴むのに、RPC の先掴みには入らず、トリガの中で後から掴む逆順になる。写し元の行を
 * 作成が入れる式で選べる(`match` が 1 つの等式で、自表の側の列を作成が入れる)ときだけ、その副問い合わせを値にする。
 */
function copiedValue(input: ClosureLockInput, column: string): string | null {
  for (const trigger of input.table.triggers) {
    if (trigger.fires === undefined || !parseFires(trigger.fires).events.includes('insert')) continue;
    const copy = (trigger.copiesFrom ?? []).find((candidate) => candidate.column === column);
    if (copy === undefined) continue;
    const pairs = Object.entries(copy.match);
    const [source, own] = pairs[0] ?? [];
    const value = pairs.length === 1 && own !== undefined ? (input.insertExpression?.(own) ?? null) : null;
    if (source === undefined || value === null) return null;
    return `(select ${COPY_SOURCE_ALIAS}.${copy.fromColumn} from public.${copy.fromTable} ${COPY_SOURCE_ALIAS} where ${COPY_SOURCE_ALIAS}.${source} = ${value})`;
  }
  return null;
}

/** この関数の自表への書き込みが発火させるトリガ(種類と `update of` の列で引き当てる)。 */
function firedTriggers(input: ClosureLockInput): readonly DataTriggerDecl[] {
  const event = input.shape === 'create' ? 'insert' : input.shape === 'delete' ? 'delete' : 'update';
  const written = input.writtenColumns ?? null;
  return input.table.triggers.filter((trigger) => {
    if (trigger.fires === undefined || !parseFires(trigger.fires).events.includes(event)) return false;
    if (event !== 'update' || written === null) return true;
    const watched = updatedColumnsOf(trigger.fires);
    return watched === null || watched === 'all' || watched.some((column) => written.includes(column));
  });
}

/** トリガが掴む親の行(宣言の `locks` に、本文が生成物のトリガが掴む行 `impliedLocksOf` を足す。同じ表は強い方。fix25s)。 */
function locksOf(input: ClosureLockInput, trigger: DataTriggerDecl): Readonly<Record<string, LockStrength>> {
  const implied = input.domain === undefined ? {} : impliedLocksOf(trigger, input.table, input.domain, input.tables);
  const merged: Record<string, LockStrength> = { ...implied };
  for (const [parent, mode] of Object.entries(trigger.locks ?? {})) merged[parent] = merged[parent] === 'update' ? 'update' : mode;
  return merged;
}

/** トリガの掴みの宣言(`locks`)と写し元(`copies_from`)から決まる行(点検 19 回目 A19-1 / A19-3 / O19-3)。 */
function declaredRows(input: ClosureLockInput, start: number): readonly ClosureLockRow[] {
  const rows: ClosureLockRow[] = [];
  const seen = new Set<string>();
  const push = (table: string, mode: LockStrength, ordered: boolean, build: (alias: string) => { readonly from: readonly string[]; readonly where: readonly string[]; readonly idKey: string | null; readonly ids?: readonly RowId[] } | null): void => {
    const alias = `${CLOSURE_ALIAS_PREFIX}${String(start + rows.length)}`;
    const built = build(alias);
    if (built === null) return;
    const key = `${table}|${mode}|${built.idKey ?? built.where.join(' and ')}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ table, alias, from: [...built.from, `public.${table} ${alias}`], where: built.where, mode, idKey: built.idKey, ordered, ids: built.ids ?? [] });
  };
  for (const trigger of firedTriggers(input)) {
    for (const [parent, mode] of Object.entries(locksOf(input, trigger))) {
      for (const key of input.table.foreignKeys.filter((candidate) => bare(candidate.references) === parent)) {
        // 書き換えうる列の値は 1 つの値と言い切れない(変更集合の鍵の有無で変わる)ので、id の順に掴む。
        const changed = input.shape === 'update' && (input.updateExpression?.(key.column) ?? null) !== null;
        push(parent, mode, changed, (alias) => {
          const own = ownValue(input, alias, key.column);
          return own === null ? null : { from: own.from, where: [...own.where, `${alias}.id = ${own.value}`], idKey: own.key, ids: own.id === undefined ? [] : [own.id] };
        });
      }
    }
    for (const copy of trigger.copiesFrom ?? []) {
      push(copy.fromTable, 'share', true, (alias) => {
        const pairs = Object.entries(copy.match).map(([source, column]) => ({ source, own: ownValue(input, alias, column) }));
        if (pairs.some((pair) => pair.own === null)) return null;
        const first = pairs[0]?.own;
        const byId = pairs.length === 1 && pairs[0]?.source === 'id';
        return {
          from: first?.from ?? [],
          where: [...(first?.where ?? []), ...pairs.map((pair) => `${alias}.${pair.source} = ${pair.own?.value ?? ''}`)],
          idKey: byId ? (first?.key ?? null) : null,
          ids: byId && first?.id !== undefined ? [first.id] : [],
        };
      });
    }
  }
  return rows;
}

/** 道(自表に近い側から)を、掴む 1 文にする(最後の表を掴み、途中の表は join で辿る)。 */
function rowOf(path: readonly Hop[], index: number, targetId: string): ClosureLockRow {
  const alias = `${CLOSURE_ALIAS_PREFIX}${String(index)}`;
  const aliases = path.map((_, step) => (step === path.length - 1 ? alias : `${alias}${HOP_ALIAS_SEPARATOR}${String(step)}`));
  const from = path.map((hop, step) => `public.${hop.table} ${aliases[step] ?? alias}`);
  const where = path.map((hop, step) =>
    step === 0 ? `${aliases[0] ?? alias}.${hop.column} = ${targetId}` : `${aliases[step] ?? alias}.${hop.column} = ${aliases[step - 1] ?? alias}.id`,
  );
  return { table: path[path.length - 1]?.table ?? '', alias, from, where, mode: 'update', idKey: null, ordered: true };
}

/** この関数が書く表と、その書き込みの種類(自表は形から、監査ログは追記)。 */
function writesOf(input: ClosureLockInput): readonly { readonly table: string; readonly event: string }[] {
  const own = input.shape === 'delete' ? 'delete' : 'update';
  const audit = input.tables.find((candidate) => candidate.framework === AUDIT_FRAMEWORK);
  return [{ table: input.table.table, event: own }, ...(audit === undefined ? [] : [{ table: audit.table, event: 'insert' }])];
}

/** 書き込みが発火させるトリガが書く表のうち、自表を直に指す外部キーを持つもの(1 歩の道)。 */
function triggerPaths(input: ClosureLockInput): readonly (readonly Hop[])[] {
  const paths: Hop[][] = [];
  for (const write of writesOf(input)) {
    const owner = input.tables.find((candidate) => candidate.table === write.table);
    if (owner === undefined) continue;
    for (const trigger of owner.triggers) {
      if (trigger.fires === undefined || !parseFires(trigger.fires).events.includes(write.event)) continue;
      const fn = owner.functions.find((candidate) => candidate.name === trigger.functionName);
      for (const [written, kinds] of Object.entries(fn?.alsoWriteKinds ?? {})) {
        if (!kinds.some((kind) => LOCKING_KINDS.has(kind))) continue;
        for (const key of foreignKeysOf(input.tables, written)) {
          if (bare(key.references) === input.table.table) paths.push([{ table: written, column: key.column }]);
        }
      }
    }
  }
  return paths;
}

/**
 * 削除の連鎖が書き換える表(この関数の `also_writes`)へ、自表から外部キーの鎖を子の側へ辿る道の全部。
 *
 * 途中の表は**連鎖で消える表**(`cascade`)に限る —— `set null` で書き換わるだけの表の子は、その削除では動かない。
 */
function cascadePaths(input: ClosureLockInput): readonly (readonly Hop[])[] {
  const fn = input.table.functions.find((candidate) => candidate.name === input.name);
  const targets = new Set(
    Object.entries(fn?.alsoWriteKinds ?? {})
      .filter(([, kinds]) => kinds.some((kind) => LOCKING_KINDS.has(kind)))
      .map(([table]) => table),
  );
  const paths: Hop[][] = [];
  const walk = (parent: string, path: readonly Hop[]): void => {
    if (path.length >= MAX_HOPS) return;
    for (const child of input.tables) {
      for (const key of child.foreignKeys) {
        if (bare(key.references) !== parent || !CHAINING_ACTIONS.has(key.onDelete)) continue;
        if (path.some((hop) => hop.table === child.table)) continue;
        const next = [...path, { table: child.table, column: key.column }];
        if (targets.has(child.table)) paths.push(next);
        if (key.onDelete === 'cascade') walk(child.table, next);
      }
    }
  };
  walk(input.table.table, []);
  return paths;
}

/** その表の外部キーの宣言(表が無ければ空)。 */
function foreignKeysOf(tables: readonly DataTableSpec[], table: string): readonly DataForeignKeyDecl[] {
  return tables.find((candidate) => candidate.table === table)?.foreignKeys ?? [];
}

/** スキーマ修飾を落とした表名(`public.` 以外の参照先は自表と一致しない)。 */
function bare(reference: string): string {
  return reference.startsWith('public.') ? reference.slice('public.'.length) : reference;
}

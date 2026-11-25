/**
 * world の行を**入れる順**を、実 DB の外部キーの宣言から決める(テストの基盤)。
 *
 * 設計図(生成物)の並びは「参照先が先」だが、参照が循環していると 1 辺は後ろ向きに残る。その 1 辺が
 * 遅延可能な外部キーなら `set constraints all deferred` で救われる —— 救われないのは**遅延できない外部キーが
 * 後ろ向きに残った**ときである。どの辺が遅延できるかは設計図(仕様)が持たず、実 DB のカタログだけが
 * 知っているので、挿入の直前にカタログを引いて、**遅延できない外部キーの参照先を必ず先に**並べ直す。
 *
 * 遅延できる外部キーの辺は順序の制約に数えない(循環の逃げ道として残す)。遅延できない辺だけで循環して
 * いる設計図は並べ直せないので、残りは元の順のまま返す(挿入が実 DB の拒否として落ちる —— 設計図の誤り)。
 *
 * このファイルにアプリの語彙は 1 語も無い。
 */

/** 並べ直せる行(設計図の行のうち、順序に要る部分)。 */
export interface OrderableRow {
  readonly key: string;
  readonly table: string;
  /** 列 → 参照する行の名前。 */
  readonly refs: Readonly<Record<string, string>>;
}

/** 問い合わせを 1 回流せる口(pg の `Client` がそのまま満たす)。 */
export interface CatalogQueryable {
  query<R extends Record<string, unknown>>(text: string): Promise<{ readonly rows: R[] }>;
}

/** 遅延できない外部キーの列(`{表}.{列}` の集合)を引く。 */
async function immediateForeignKeyColumns(pg: CatalogQueryable): Promise<ReadonlySet<string>> {
  const result = await pg.query<{ table_name: string; column_name: string }>(
    `select cl.relname as table_name, a.attname as column_name
       from pg_constraint c
       join pg_class cl on cl.oid = c.conrelid
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.contype = 'f'
        and not c.condeferrable
        and cl.relnamespace = 'public'::regnamespace`,
  );
  return new Set(result.rows.map((row) => `${row.table_name}.${row.column_name}`));
}

/**
 * 遅延できない外部キーの参照先が先に来るように並べ直す(安定。動かす必要が無い行は元の順のまま)。
 *
 * @param pg カタログを引く口
 * @param rows 設計図の行(設計図の順)
 * @returns 挿入する順の行
 */
export async function orderForInsert<R extends OrderableRow>(pg: CatalogQueryable, rows: readonly R[]): Promise<R[]> {
  const immediate = await immediateForeignKeyColumns(pg);
  const pending = [...rows];
  const placed = new Set<string>();
  const ordered: R[] = [];
  while (pending.length > 0) {
    const index = pending.findIndex((row) =>
      Object.entries(row.refs).every(
        ([column, key]) => !immediate.has(`${row.table}.${column}`) || key === row.key || placed.has(key),
      ),
    );
    // 遅延できない辺だけで循環している(設計図の誤り)。残りは元の順に出し、実 DB の拒否に任せる。
    const next = index === -1 ? 0 : index;
    const [row] = pending.splice(next, 1);
    if (row === undefined) break;
    placed.add(row.key);
    ordered.push(row);
  }
  return ordered;
}

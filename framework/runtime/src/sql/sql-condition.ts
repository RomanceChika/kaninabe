/**
 * **SQL の条件の断片を、閉じた原子の連言へ読み替える**(部分索引・排他制約の `where`)。
 *
 * 宣言の `where`(SQL 断片)と実 DB の印字(`pg_get_expr` / `pg_get_constraintdef`)を**同じ原子**に読むので、検証器と実 DB の突合が同じ読み手を使う。
 * 読める形は下の表だけで、ほかは全部 `null`(比べられない)を返す。推測で読まない。
 *
 * | 原子 | SQL 断片 |
 * |---|---|
 * | `in`(値の集合) | `x = 'a'` / `x = true` / `x in ('a', 'b')` / `x = any (array['a', 'b'])` |
 * | `not_in`(値の集合) | `x <> 'a'` / `x != 'a'` / `x not in ('a', 'b')` / `x <> all (array['a', 'b'])` |
 * | `null` / `not_null` | `x is null` / `x is not null` |
 *
 * 条件の全体を包む括弧と、型の注釈 `::text` は意味を変えないので落とす。純関数であり throw しない。
 */

/** 条件の原子 1 つ。 */
export interface ConditionAtom {
  readonly column: string;
  readonly op: 'in' | 'not_in' | 'null' | 'not_null';
  /** 値の集合(文字列に畳んで昇順。`null` / `not_null` は空)。 */
  readonly values: readonly string[];
}

/**
 * 原子を作る(値は重複を除いて昇順)。
 *
 * @param column 列
 * @param op 演算
 * @param values 値の並び
 * @returns 原子
 */
export function conditionAtom(column: string, op: ConditionAtom['op'], values: readonly string[]): ConditionAtom {
  return { column, op, values: [...new Set(values)].sort() };
}

/** 全体を包む括弧を落とす(先頭の括弧が末尾で閉じるときだけ)。 */
function stripOuterParens(text: string): string {
  let current = text.trim();
  while (current.startsWith('(') && current.endsWith(')')) {
    let depth = 0;
    let closesAtEnd = true;
    for (let index = 0; index < current.length - 1; index += 1) {
      if (current[index] === '(') depth += 1;
      if (current[index] === ')') depth -= 1;
      if (depth === 0) {
        closesAtEnd = false;
        break;
      }
    }
    if (!closesAtEnd) break;
    current = current.slice(1, -1).trim();
  }
  return current;
}

/** 値の並び(`'a', 'b'`・`true` / `false`)。読めなければ null。 */
function sqlValues(list: string): readonly string[] | null {
  const parts = list.split(',').map((part) => part.trim());
  const values = parts.map((part) => /^'([^']*)'$/u.exec(part)?.[1] ?? (part === 'true' || part === 'false' ? part : null));
  return values.includes(null) ? null : (values as readonly string[]);
}

/** 読める SQL の原子の綴り(列・演算子・値の並び)。 */
const SQL_FORMS: readonly (readonly [RegExp, ConditionAtom['op']])[] = [
  [/^([a-z_][a-z0-9_]*) = any \(array\[(.+)\]\)$/u, 'in'],
  [/^([a-z_][a-z0-9_]*) <> all \(array\[(.+)\]\)$/u, 'not_in'],
  [/^([a-z_][a-z0-9_]*) in \((.+)\)$/u, 'in'],
  [/^([a-z_][a-z0-9_]*) not in \((.+)\)$/u, 'not_in'],
  [/^([a-z_][a-z0-9_]*) = (.+)$/u, 'in'],
  [/^([a-z_][a-z0-9_]*) (?:<>|!=) (.+)$/u, 'not_in'],
];

/** SQL の原子 1 つ。 */
function sqlAtom(raw: string): ConditionAtom | null {
  const text = stripOuterParens(raw).replace(/::text/gu, '').replace(/\s+/gu, ' ');
  const lowered = text.replace(/'[^']*'|[^']+/gu, (part) => (part.startsWith("'") ? part : part.toLowerCase()));
  const nullForm = /^([a-z_][a-z0-9_]*) is (not )?null$/u.exec(lowered);
  if (nullForm !== null) return conditionAtom(nullForm[1] ?? '', nullForm[2] === undefined ? 'null' : 'not_null', []);
  for (const [form, op] of SQL_FORMS) {
    const matched = form.exec(lowered);
    if (matched === null) continue;
    const values = sqlValues(matched[2] ?? '');
    return values === null ? null : conditionAtom(matched[1] ?? '', op, values);
  }
  return null;
}

/**
 * SQL 断片を原子の連言に読む。
 *
 * @param text 索引の `where`
 * @returns 原子の並び(読めない形を含めば null)
 */
export function atomsOfSql(text: string): readonly ConditionAtom[] | null {
  const parts = stripOuterParens(text).split(/\s+and\s+/iu);
  const atoms = parts.map(sqlAtom);
  return atoms.includes(null) ? null : (atoms as readonly ConditionAtom[]);
}

/**
 * 2 つの連言が同じ原子の集合か。
 *
 * @param a 片方
 * @param b もう片方
 * @returns 同じなら true
 */
export function sameAtoms(a: readonly ConditionAtom[], b: readonly ConditionAtom[]): boolean {
  const keyOf = (item: ConditionAtom): string => JSON.stringify([item.column, item.op, item.values]);
  const left = new Set(a.map(keyOf));
  const right = new Set(b.map(keyOf));
  return left.size === right.size && [...left].every((key) => right.has(key));
}

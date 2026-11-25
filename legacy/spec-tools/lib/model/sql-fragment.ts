/**
 * 仕様が書く**生の SQL 断片と識別子**の文法(読み込みで検査する純粋関数)。
 *
 * data_table の `indexes[].where` / `exclusions[].where` / `checks[].rule` / `defaults` の値は、生成される migration の SQL にそのまま置かれる。
 * 敵対的な仕様が `true) ; drop table t ; --` と書けば、夜間の出荷が本番 DB に適用する migration に任意の文が入る。そこで断片の**文法を閉じる**:
 *
 *   - 項は 数値・`'…'` の文字列(`''` の二重化。中に `$$` を置かない)・識別子(`a.b` 可)・許可した関数の呼び出し(名前と `(` の間の空白は呼び出しとして見る。
 *     修飾した関数名は書けない)・`ARRAY[…]`・`::型`(許可した型名だけ。`regclass` 以外の reg* は書けない)
 *   - 演算子は 比較(`= <> != < > <= >=`)・算術(`+ - * / %`)・連結(`||`)・正規表現(`~ ~* !~`)・`,` と括弧
 *   - 語: `and or not is null in between like true false any all array` のような式の語。`select` `from` `drop` `insert` `union` などの文の語は書けない
 *   - `;` `$` `\` ダブルクォート・行コメントとブロックコメントの記号・括弧と引用符の不釣り合いは書けない
 *
 * 識別子(表・列・制約・トリガ・関数の名前)は `^[a-z][a-z0-9_]*$`。発火の節(`fires`)・導出の幅(`offset`)・正規表現(`pattern`)は個別の文法で見る。
 * どれも違反の**理由を 1 行**で返す(null なら書いてよい)。**アプリの語彙は 1 語も持たない**。
 */

/** PostgreSQL の識別子の長さの上限(NAMEDATALEN - 1。超えた分は黙って切り詰められる。書き出す前の検査は `sql/identifier-length.ts`)。 */
export const MAX_IDENTIFIER_BYTES = 63;

/** SQL の識別子として書いてよい形。 */
export const SQL_IDENTIFIER = /^[a-z][a-z0-9_]*$/;

/** `スキーマ.名前` を許す識別子。 */
const QUALIFIED_IDENTIFIER = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?$/;

/** 断片に書いてよい関数。 */
const FUNCTIONS: ReadonlySet<string> = new Set(
  `now gen_random_uuid gen_random_bytes encode translate char_length length lower upper replace lpad rpad coalesce nullif abs round floor ceil concat trim btrim ltrim rtrim
  substr substring left right date_trunc extract age to_char current_date current_timestamp date timestamptz text int integer array_length cardinality`
    .split(/\s+/)
    .filter((name) => name !== ''),
);

/** 式の語(関数の呼び出しの形で書いてよい演算子の語)。 */
const EXPRESSION_WORDS: ReadonlySet<string> = new Set(['in', 'any', 'all', 'array', 'and', 'or', 'not', 'between', 'like', 'is']);

/** `::` の後ろに書いてよい型名(reg* の変換は書けない。`defaults` の `nextval('宣言した名前'::regclass)` だけは `replaceDeclaredNextval` が先に取り除く)。 */
const CAST_TYPES: ReadonlySet<string> = new Set(
  `uuid text varchar char character int int2 int4 int8 integer smallint bigint numeric decimal real float4 float8 double precision boolean bool
  timestamptz timestamp date time timetz interval jsonb json bytea`
    .split(/\s+/)
    .filter((name) => name !== ''),
);

/** 断片に書けない語(文・集合演算・副問い合わせ・権限・書き込み)。 */
const STATEMENT_WORDS: ReadonlySet<string> = new Set(
  `select insert update delete drop create alter grant revoke truncate copy do execute call from into union intersect except with returning set
  begin commit rollback declare perform values where having group order limit offset join lateral window over filter`
    .split(/\s+/)
    .filter((name) => name !== ''),
);

/** 宣言した採番の器を持たないときの引数の既定(`nextval` は書けない)。 */
const NO_SEQUENCES: ReadonlySet<string> = new Set();

/**
 * `nextval('名前'::regclass)` の形で、名前が宣言した採番の器なら、ただの数に置き換えて残りを検査する。
 * 宣言した名前でなければそのまま残る(`nextval` は許可表に無い関数、`::regclass` は許可表に無い型なので拒まれる)。
 */
function replaceDeclaredNextval(text: string, sequences: ReadonlySet<string>): string {
  return text.replace(/\bnextval\(\s*'([a-z][a-z0-9_]*)'::regclass\s*\)/g, (whole, name: string) => (sequences.has(name) ? '0' : whole));
}

/** 断片の長さの上限。 */
const MAX_FRAGMENT = 500;

/** 識別子の違反の理由。 */
export function identifierProblem(value: string): string | null {
  return SQL_IDENTIFIER.test(value) ? null : '識別子は小文字・数字・_ で、小文字から始めます(^[a-z][a-z0-9_]*$)';
}

/** `スキーマ.名前` 形の識別子の違反の理由。 */
export function qualifiedIdentifierProblem(value: string): string | null {
  return QUALIFIED_IDENTIFIER.test(value) ? null : '参照先は 名前 か スキーマ.名前(小文字・数字・_)で書きます';
}

/**
 * SQL の式の断片を検査する。
 *
 * @param text 断片(`where` の述語・`rule` の条件・`defaults` の値)
 * @param sequences `nextval('名前'::regclass)` が名指してよい採番の器(その表が `sequences` で宣言したもの。`defaults` の値だけが渡す)。
 *   `nextval` と `::regclass` は、この形でしか書けない(宣言した名前でなければ拒む。`where` / `rule` には書けない)
 * @returns 書けない理由。書いてよければ null
 */
export function sqlFragmentProblem(text: string, sequences: ReadonlySet<string> = NO_SEQUENCES): string | null {
  if (text.trim() === '') return '断片が空です';
  if (text.length > MAX_FRAGMENT) return `断片が長すぎます(${MAX_FRAGMENT} 文字まで)`;
  const bare = replaceDeclaredNextval(text, sequences);
  if (/[;$\\"`#@{}]|--|\/\*|\*\//.test(bare.replace(/'(?:[^']|'')*'/g, "''"))) return '断片に ; $ \\ " バッククォート # @ { } -- /* */ は書けません';
  const parens: string[] = [];
  let rest = bare;
  let previousWasIdentifier = false;
  while (rest.length > 0) {
    let match: RegExpExecArray | null;
    if ((match = /^\s+/.exec(rest)) !== null) {
      rest = rest.slice(match[0].length);
      previousWasIdentifier = false;
      continue;
    }
    if ((match = /^'(?:[^']|'')*'/.exec(rest)) !== null) {
      if (previousWasIdentifier) return '引用符の直前に文字列の接頭辞(E / U& など)は書けません';
      if (match[0].includes('$$') || /[\u0000-\u0008\u000A-\u001F]/.test(match[0])) return '文字列に $$ や制御文字は置けません';
      rest = rest.slice(match[0].length);
      continue;
    }
    if ((match = /^\d+(?:\.\d+)?/.exec(rest)) !== null) {
      rest = rest.slice(match[0].length);
      previousWasIdentifier = false;
      continue;
    }
    if ((match = /^::/.exec(rest)) !== null) {
      // 型への変換: 許可した型名(配列・長さつきも可)だけ。reg* の変換(regprocedure ほか)は関数や演算子を名前で引けるので書けない。
      const cast = /^::\s*([A-Za-z_][A-Za-z0-9_]*)(?:\(\d+(?:,\s*\d+)?\))?(?:\[\])*/.exec(rest);
      if (cast === null) return '型への変換 :: の後ろに型名がありません';
      const typeName = (cast[1] ?? '').toLowerCase();
      if (!CAST_TYPES.has(typeName)) return `型への変換に書けない型(${typeName})があります。書けるのは ${[...CAST_TYPES].join(' / ')}`;
      rest = rest.slice(cast[0].length);
      previousWasIdentifier = false;
      continue;
    }
    if ((match = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(rest)) !== null) {
      const word = match[0].toLowerCase();
      rest = rest.slice(match[0].length);
      if (STATEMENT_WORDS.has(word)) return `断片に文の語(${word})は書けません`;
      // 識別子 + 空白(省略可)+ `(` は関数の呼び出し。修飾名(`pg_catalog.f(` `public.f(`)は書けず、名前は許可表のものだけ。
      if (/^\s*\(/.test(rest) && !EXPRESSION_WORDS.has(word) && (word.includes('.') || !FUNCTIONS.has(word))) {
        return word.includes('.') ? `断片に修飾した関数名(${word})は書けません` : `断片に書けない関数(${word})があります`;
      }
      previousWasIdentifier = true;
      continue;
    }
    previousWasIdentifier = false;
    if ((match = /^(?:::|<>|!=|<=|>=|\|\||~\*|!~|[=<>+\-*/%~,])/.exec(rest)) !== null) {
      rest = rest.slice(match[0].length);
      continue;
    }
    const char = rest.charAt(0);
    if (char === '(' || char === '[') {
      parens.push(char === '(' ? ')' : ']');
      rest = rest.slice(1);
      continue;
    }
    if (char === ')' || char === ']') {
      if (parens.pop() !== char) return '括弧が釣り合っていません';
      rest = rest.slice(1);
      continue;
    }
    return `断片に書けない文字があります(「${char}」の付近)`;
  }
  return parens.length === 0 ? null : '括弧が閉じていません';
}

/**
 * 正規表現(`pattern`)を検査する。SQL の文字列リテラルに入る(`'…'` の二重化は出口が行う)ので、`$$`(関数本文を閉じる)と制御文字だけを拒む。
 *
 * @param text 正規表現の字面
 */
export function patternProblem(text: string): string | null {
  if (text.includes('$$')) return '正規表現に $$ は置けません(SQL の本文を閉じる並び。末尾の $ は 1 つだけ書く)';
  if (text.length > MAX_FRAGMENT) return `正規表現が長すぎます(${MAX_FRAGMENT} 文字まで)`;
  return null;
}

/** 発火の節(`fires`)の語の並び: いつ・何で・列・表・文/行・条件(`when (…)`。字は識別子・比較・括弧 1 段だけ。点検 20 回目 C20-7)・注記。 */
const FIRES =
  /^(?:before|after|instead of) (?:insert|update|delete|truncate)(?: of [a-z_][a-z0-9_]*(?:, ?[a-z_][a-z0-9_]*)*)?(?: or (?:insert|update|delete|truncate)(?: of [a-z_][a-z0-9_]*(?:, ?[a-z_][a-z0-9_]*)*)?)*(?: on [a-z_][a-z0-9_]*)?(?: for each (?:row|statement))?(?: when \((?:[a-z0-9_. <>=!,]|\((?:[a-z0-9_. <>=!,])*\))*\))?(?: \([^()$'";\\\n`]*\))?$/i;

/**
 * 発火の節(`triggers[].fires`)を検査する。
 *
 * @param text 発火の宣言(`before insert or update of a, b` など)
 */
export function firesProblem(text: string): string | null {
  return FIRES.test(text.trim()) ? null : 'fires は「いつ・何で・(of 列)・(on 表)」の形で書きます(例: before insert or update of state)';
}

/** 導出の幅: `{±n} {minute|hour|day}`。 */
const OFFSET = /^[+-]?\d+ (?:minute|hour|day)s?$/;

/**
 * 導出の幅(`derives.*.offset`)を検査する。
 *
 * @param text 幅の字面(`-14 days`)
 */
export function offsetProblem(text: string): string | null {
  return OFFSET.test(text.trim()) ? null : 'offset は "{±n} {minute|hour|day}" の形で書きます(例: -14 days)';
}

/** 型名(`uuid` / `text[]` / `timestamp with time zone` / `numeric(10,2)`)。 */
const TYPE_NAME = /^[a-z][a-z0-9_]*(?: [a-z][a-z0-9_]*){0,3}(?:\(\d+(?:,\d+)?\))?(?:\[\])?$/;

/**
 * 引数の型名を検査する。
 *
 * @param text 型名
 */
export function typeNameProblem(text: string): string | null {
  return TYPE_NAME.test(text) ? null : '型名は小文字の語と (n) と [] だけで書きます(例: uuid / text[])';
}

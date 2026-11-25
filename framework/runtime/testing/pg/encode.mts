import type { PgSignature } from './types.mjs';

/**
 * RPC の呼び出しを、pg のパラメータつきの文に組む(**純粋な関数**。接続には触れない)。
 *
 * ## 3 値の符号化(PostgREST と同一であること)
 *
 * 引数は実行器が `RpcArg` から JSON に直したもの(`namedArgs`)で、3 値はすでに畳まれている:
 * 編集の `unchanged` は入れ子の鍵ごと無く、`clear` は `null`、作成の `absent` は `null` で全欄が出る。
 * ここが決めるのは**最上位の引数をどう運ぶか**だけである。
 *
 * | 最上位の値 | pg への運び方 | PostgREST では |
 * |---|---|---|
 * | `undefined` | **引数を渡さない**(`p_x => …` ごと無い) | JSON に鍵が出ない(引数ごと落ちる) |
 * | `null` | SQL の NULL | JSON の `null` |
 * | jsonb の引数 | `JSON.stringify` した文字列を `$n::jsonb` で渡す | 本文の JSON |
 * | 配列型(`text[]` ほか) | JS の配列(pg が配列リテラルにする) | JSON の配列 |
 * | それ以外のスカラー | そのまま `$n::型` で渡す | JSON のスカラー |
 *
 * 「未指定を NULL にする」実装(`args[name] ?? null` と書く素朴な形)は、編集の `unchanged` の欄を落とした
 * つもりで null を送る(= `clear`)のと同じ種類の誤りを最上位の引数で起こす。`undefined` を NULL にせず**引数ごと
 * 渡さない**ことで、鍵を落とす経路が両 adapter で一致する(契約テストの 3 値の群が固定する)。
 *
 * 呼び出しの誤り(署名に無い RPC・引数名、運べない型の値、識別子として危ない綴り)は**例外**で止める。
 * DB の結果として返す失敗ではない —— 直すのは呼び出し側のコードである。
 */

/** 識別子(スキーマ名・関数名・引数名・ビュー名・列名)として許す綴り。 */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/** 型名として許す綴り(pg_catalog の表記: 英小文字・数字・下線・空白と、配列の `[]`)。 */
const TYPE_NAME = /^[a-z_][a-z0-9_ ]*(?:\[\])?$/u;

/** 組み上がった文。 */
export interface PgCall {
  /** パラメータ記法(`$1`)の SQL。 */
  readonly text: string;
  /** パラメータの値(`text` の `$1` から順)。 */
  readonly values: unknown[];
}

/**
 * 識別子として安全な綴りであることを確かめる(文に埋め込む名前は、すべてここを通す)。
 *
 * @param name - 確かめる綴り
 * @param what - 何の名前か(例外の文面に載せる)
 * @returns 同じ綴り
 * @throws Error 識別子として使えない綴りのとき
 */
export function identifier(name: string, what: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`${what}として使えない綴りです: ${JSON.stringify(name)}`);
  return name;
}

/** 1 つの引数の値を、型に合わせて pg のパラメータの値にする。 */
function paramValue(type: string, value: unknown, name: string): unknown {
  if (value === null) return null;
  if (type === 'jsonb' || type === 'json') return JSON.stringify(value);
  if (type.endsWith('[]')) {
    if (!Array.isArray(value)) throw new Error(`引数 ${name}(${type})には配列を渡します`);
    return [...(value as readonly unknown[])];
  }
  if (typeof value === 'object') throw new Error(`引数 ${name}(${type})にオブジェクトや配列は渡せません`);
  return value;
}

/**
 * 署名に載る名前付き引数のうち、渡されたものを `名前 => $n::型` に並べる。
 *
 * @param signature - 呼ぶ RPC の署名
 * @param args - 引数名 → 値(`undefined` の引数は渡さない)
 * @returns 名前付き引数の並び(署名の順)とパラメータの値
 */
function namedParams(signature: PgSignature, args: Readonly<Record<string, unknown>>): { readonly named: string; readonly values: unknown[] } {
  const unknownNames = Object.keys(args).filter((name) => !signature.params.includes(name));
  if (unknownNames.length > 0) throw new Error(`署名に無い引数です: ${unknownNames.join(', ')}`);
  const values: unknown[] = [];
  const named: string[] = [];
  signature.params.forEach((name, index) => {
    const value = args[name];
    if (value === undefined) return;
    const type = signature.args[index] ?? '';
    if (!TYPE_NAME.test(type)) throw new Error(`引数 ${name} の型の綴りが不正です: ${JSON.stringify(type)}`);
    values.push(paramValue(type, value, name));
    named.push(`${identifier(name, '引数名')} => $${values.length}::${type}`);
  });
  return { named: named.join(', '), values };
}

/**
 * RPC 1 回ぶんの文を組む。
 *
 * 結果は**どちらの形でも 1 行 1 列**(`result`)に畳む: `rows` は行を JSON にした配列
 * (`to_jsonb` は PostgREST と同じ JSON の書式 —— 日時は ISO 8601・数値は数)、`document` は jsonb そのもの。
 * ドライバの型変換(日時が `Date` になる・数値が文字列になる)に結果の形を左右させないためである。
 *
 * @param schema - RPC のあるスキーマ
 * @param rpc - 関数名
 * @param signature - その関数の署名
 * @param args - 引数名 → 値
 * @returns 文とパラメータの値
 * @throws Error 呼び出しの誤り(上の説明)
 */
export function buildRpcCall(schema: string, rpc: string, signature: PgSignature, args: Readonly<Record<string, unknown>>): PgCall {
  const { named, values } = namedParams(signature, args);
  const target = `${identifier(schema, 'スキーマ名')}.${identifier(rpc, '関数名')}(${named})`;
  const text =
    signature.returns === 'rows'
      ? `select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) as "result" from ${target} as r`
      : `select ${target} as "result"`;
  return { text, values };
}

/**
 * 1 行を id で引いて、指定した列だけを JSON にする文を組む(事実の読み取り)。
 *
 * @param schema - ビューのあるスキーマ
 * @param view - ビュー名
 * @param id - 主キー
 * @param fields - 読む列
 * @returns 文とパラメータの値
 * @throws Error 識別子として使えない綴りがあるとき
 */
export function buildFactsCall(schema: string, view: string, id: string, fields: readonly string[]): PgCall {
  const pairs = fields.map((field) => `'${identifier(field, '列名')}', t."${field}"`).join(', ');
  const text = `select jsonb_build_object(${pairs}) as "row" from ${identifier(schema, 'スキーマ名')}."${identifier(view, 'ビュー名')}" as t where t."id" = $1 limit 1`;
  return { text, values: [id] };
}

/**
 * operation の手書き `guardEnv` が返す**鍵の集合**をソースから拾う純粋関数(A14 の材料)。
 *
 * `guardEnv` は「ガード式の変数 → 実行時の値」の割り当てを作る 1 行であり、鍵はガード式の
 * パスそのものである(エンジンは `env[パス]` で引く。`domain/engine/guard.ts` の `lookup`)。
 * つまり**鍵の集合は仕様から決まっている** —— 決まっているのに手で書いているので、書き漏らせば
 * ガードが `guard_unknown` になり、余分に書けば仕様に無い事実を運ぶ。ADR-0012 の当座の手当てと
 * して、その集合を実行計画の導出(`collectGuardPaths`)と突き合わせる。
 *
 * 走査は正規表現ではなく**括弧の対応**で行う(文字列の中の括弧に釣られないため)。TypeScript の
 * 構文木を起こさないのは、見るのが「1 つの関数式が返すオブジェクトリテラルの最上位の鍵」
 * という浅い形だけであり、ここに構文解析器を持ち込むと**この検査だけが重い依存を抱える**ため。
 * 読めない形(ブロック本体・計算された鍵・スプレッド)は黙って無視せず `unreadable` で返し、
 * 呼び側(A14)が「読めなかった」ことを報告する。
 */

/** `guardEnv` の読み取り結果。 */
export interface GuardEnvExtract {
  /** 返すオブジェクトリテラルの最上位の鍵(出現順・重複なし)。 */
  readonly keys: readonly string[];
  /** 規約の形から外れていて鍵を確定できなかったか。 */
  readonly unreadable: boolean;
}

/** 設定として渡される `guardEnv` の目印(`readonly guardEnv:` の型宣言は対象外)。 */
const MARKER = 'guardEnv:';

/**
 * ソースから `guardEnv` が返す鍵を拾う。
 *
 * @param source operation の実装ファイルの中身
 * @returns 鍵の集合。`guardEnv` が無ければ null
 */
export function extractGuardEnv(source: string): GuardEnvExtract | null {
  const at = source.indexOf(MARKER);
  if (at < 0) return null;
  const arrow = source.indexOf('=>', at);
  if (arrow < 0) return { keys: [], unreadable: true };
  const body = source.slice(arrow + 2);
  const open = body.search(/\S/);
  // 規約の形は `(...) => ({ ... })`。ブロック本体(`=> { ... }`)は鍵を静的に決められない。
  if (open < 0 || body[open] !== '(') return { keys: [], unreadable: true };
  const brace = body.slice(open + 1).search(/\S/);
  if (brace < 0 || body[open + 1 + brace] !== '{') return { keys: [], unreadable: true };
  const literal = matchBraces(body, open + 1 + brace);
  if (literal === null) return { keys: [], unreadable: true };
  return keysOf(literal);
}

/** `{` の位置から対応する `}` までの中身を返す(文字列・テンプレートの中は数えない)。 */
function matchBraces(source: string, start: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let at = start; at < source.length; at += 1) {
    const char = source[at] ?? '';
    if (quote !== null) {
      if (char === '\\') at += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{' || char === '(' || char === '[') depth += 1;
    if (char === '}' || char === ')' || char === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, at);
    }
  }
  return null;
}

/** オブジェクトリテラルの中身を、最上位の要素(深さ 0 のカンマ区切り)に割る。 */
function topLevelEntries(literal: string): readonly string[] {
  const entries: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let from = 0;
  for (let at = 0; at < literal.length; at += 1) {
    const char = literal[at] ?? '';
    if (quote !== null) {
      if (char === '\\') at += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '{' || char === '(' || char === '[') depth += 1;
    else if (char === '}' || char === ')' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      entries.push(literal.slice(from, at));
      from = at + 1;
    }
  }
  entries.push(literal.slice(from));
  return entries.map((entry) => entry.trim()).filter((entry) => entry !== '');
}

/** 最上位の要素の並びを鍵の集合にする。 */
function keysOf(literal: string): GuardEnvExtract {
  const keys: string[] = [];
  let unreadable = false;
  for (const entry of topLevelEntries(literal)) {
    const key = keyOf(entry);
    if (key === null) unreadable = true;
    else if (!keys.includes(key)) keys.push(key);
  }
  return { keys, unreadable };
}

/** 要素 1 つの鍵(`'a.b': x` / `a: x` / 短縮の `a`)。読めない形なら null。 */
function keyOf(entry: string): string | null {
  const quoted = /^(['"])(.*?)\1\s*:/.exec(entry);
  if (quoted !== null) return quoted[2] ?? null;
  const plain = /^([A-Za-z_$][\w$]*)\s*(:|$)/.exec(entry);
  return plain?.[1] ?? null;
}

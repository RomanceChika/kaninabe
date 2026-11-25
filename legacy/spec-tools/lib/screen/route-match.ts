/**
 * リクエスト前段の保護範囲(`matcher`)を扱う純粋モジュール(matcher → 被覆判定)。
 *
 * S7 が見る事実は 2 つある:「画面の器の位置から決まるルート」と「リクエスト前段の `matcher` がそのルートを覆うか」。前者(ファイル配置 → ルート)は
 * **置き場の配置の逆引き**(`ProductLayout` の `screen-shell` の `classify`。アプリの枠の後段が与える)が持つので、ここに残るのは後者だけである。
 * どちらも文字列の変換規則であり、ファイル I/O とは分けられる(I/O は lib/screen/app-loader.ts に集約する。規約: scripts-code-quality.md)。
 *
 * **matcher の文法(`:name` / `:name*` / `:name+` / `:name?`)は、リクエスト前段が使うルーティングの記法の写し**で、配置の値には移していない
 * (綴りの検査の限界。仕様の route の動的セグメントも `:name` で、matcher と同じ綴りになった — 仕様の route は URL の形、matcher は前段の保護範囲の書き方で、持ち主は別)。
 */

/**
 * matcher のパターンを静的に解釈できるか。
 *
 * 解釈できるのは「リテラルのセグメント」と「`:name` / `:name*` / `:name+` / `:name?`」と、「接頭辞を除く全部」の形
 * (`/((?!a|b).*)`。リクエスト前段の公式文書の例の形で、生成したリクエスト前段が使う)だけである。
 * 正規表現つき(`/:path(\\d+)`)やパターン以外の形は、ここで**解釈できないと明示**して
 * S7 が検査の範囲外だと言えるようにする(黙って「覆っている」と扱わない)。
 *
 * @param pattern matcher に書かれた 1 本
 * @returns 静的に解釈できるなら true
 */
export function isParsableMatcher(pattern: string): boolean {
  if (exclusionPrefixes(pattern) !== null) return true;
  if (!pattern.startsWith('/')) return false;
  if (/[(){}[\]|\\?]/.test(pattern.replace(/:[a-zA-Z0-9_]+\?/g, ''))) return false;
  return pattern
    .slice(1)
    .split('/')
    .every((segment) => segment === '' || /^(?::[a-zA-Z0-9_]+[*+?]?|[a-zA-Z0-9_.-]+)$/.test(segment));
}

/**
 * matcher のパターンがルートを覆うか(静的判定)。
 *
 * 動的セグメント(`:id`)は「何が入るか実行時まで分からない」ため、リテラルのセグメントに
 * 対しては**覆っていないと判定する**(安全側。覆えているつもりの見落としを作らない)。
 *
 * @param pattern matcher に書かれた 1 本(`isParsableMatcher` が true のもの)
 * @param route screen_spec の route(例: `/workshops/:id`)
 * @returns 覆っているなら true
 */
export function matcherCovers(pattern: string, route: string): boolean {
  const excluded = exclusionPrefixes(pattern);
  if (excluded !== null) return !excluded.some((prefix) => mayStartWith(route.replace(/^\//, ''), prefix));
  const patternSegments = splitPath(pattern);
  const routeSegments = splitPath(route);
  return match(patternSegments, routeSegments);
}

/** 除く項 1 つ(綴りの 1 字ずつ: `any` は正規表現の素の `.` = 任意の 1 字。`exact` は終端 `$` つき = パスの完全一致)。 */
interface Exclusion {
  readonly chars: readonly { readonly char: string; readonly any: boolean }[];
  readonly exact: boolean;
}

/**
 * 「除く URL を除く全部」の形(`/((?!a/|b/c|d\.e$).*)`。リクエスト前段の公式文書の例の形)なら、除く項の並びを返す。ほかの形は null。
 * 項に書けるのは英数字と `_` `-` `/` と `.`(素の `.` は任意の 1 字・`\.` は文字どおりの点)と、末尾の終端 `$` だけ(それ以外の正規表現の文字が
 * あれば解釈できないとして null)。6 回目 B6-3: 生成器は `.` をエスケープし、完全一致に終端を付ける。
 */
function exclusionPrefixes(pattern: string): readonly Exclusion[] | null {
  const body = /^\/\(\(\?!([^()]*)\)\.\*\)$/.exec(pattern)?.[1];
  if (body === undefined) return null;
  const terms = body.split('|').map(parseExclusion);
  return terms.every((term): term is Exclusion => term !== null) ? terms : null;
}

/** 除く項 1 つを読む(書けない文字があれば null)。 */
function parseExclusion(term: string): Exclusion | null {
  const exact = term.endsWith('$');
  const text = exact ? term.slice(0, -1) : term;
  const chars: { char: string; any: boolean }[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    if (char === '\\') {
      const next = text[index + 1];
      if (next !== '.') return null;
      chars.push({ char: '.', any: false });
      index += 1;
    } else if (/^[A-Za-z0-9_/-]$/.test(char)) chars.push({ char, any: false });
    else if (char === '.') chars.push({ char, any: true });
    else return null;
  }
  return chars.length === 0 ? null : { chars, exact };
}

/**
 * route(先頭の `/` を除いた形)が、除く項に当たり**うる**か(安全側: 素の `.` は任意の 1 文字として比べ、route の動的セグメント `:x` に
 * 差しかかったら「当たりうる」とみなす —— 中身が実行時まで分からないので、覆えているつもりの見落としを作らない)。
 * 完全一致の項(終端 `$`)は、route が項で**終わる**ときだけ当たる(`favicon\.ico$` は `/favicon.ico/x` に当たらない)。
 */
function mayStartWith(route: string, exclusion: Exclusion): boolean {
  for (let index = 0; index < exclusion.chars.length; index += 1) {
    const char = route[index];
    if (char === undefined) return false;
    if (char === ':') return true;
    const expected = exclusion.chars[index];
    if (expected !== undefined && !expected.any && expected.char !== char) return false;
  }
  return !exclusion.exact || route.length === exclusion.chars.length;
}

/** パスをセグメント列にする(先頭・末尾の空要素を落とす)。 */
function splitPath(path: string): readonly string[] {
  return path.split('/').filter((segment) => segment !== '');
}

/** セグメント列どうしの照合(`*` / `+` の可変長を含むので後戻りありの再帰で書く)。 */
function match(pattern: readonly string[], route: readonly string[]): boolean {
  const head = pattern[0];
  if (head === undefined) return route.length === 0;

  const quantifier = head.startsWith(':') && /[*+?]$/.test(head) ? head.slice(-1) : '';
  const rest = pattern.slice(1);
  if (quantifier === '*' || quantifier === '?') {
    // 0 個で通るか、1 個消費して通るか。
    if (match(rest, route)) return true;
    return route.length > 0 && match(quantifier === '*' ? pattern : rest, route.slice(1));
  }
  if (route.length === 0) return false;
  if (quantifier === '+') {
    return match([`${head.slice(0, -1)}*`, ...rest], route.slice(1));
  }
  const segment = route[0] ?? '';
  if (head.startsWith(':')) return match(rest, route.slice(1));
  // リテラルどうしの一致。動的セグメントは中身が決まらないので一致とみなさない。
  return head === segment && match(rest, route.slice(1));
}

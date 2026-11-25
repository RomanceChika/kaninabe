/**
 * 実装側 CSS の走査(純粋関数)。G1(生値の直書き)と G2(未定義トークンの参照)の材料を作る。
 *
 * 完全な CSS パーサーではない。**宣言 1 行と var() の参照だけ**を取り出せればよく、
 * それ以上を読もうとすると、検査そのものがパーサーのバグに支配される。
 * 読めなかった書き方は「検査されない」のであって「通った」のではない —— この限界は
 * styling.md の「既知の穴」に書いてある。
 */

/** CSS の宣言 1 件(`property: value`)。 */
export interface CssDeclaration {
  /** ファイル(リポジトリルート相対)。 */
  readonly file: string;
  /** 1 始まりの行番号。 */
  readonly line: number;
  /** プロパティ名(小文字)。 */
  readonly property: string;
  /** 値(前後の空白を落としたもの。文字列リテラルは残る)。 */
  readonly value: string;
}

/** `var(--x)` の参照 1 件。 */
export interface CssVarUse {
  /** ファイル(リポジトリルート相対)。 */
  readonly file: string;
  /** 1 始まりの行番号。 */
  readonly line: number;
  /** 変数名(`--` を除いたもの)。 */
  readonly name: string;
}

/** `/* *​/` のコメント(行をまたぐ)。 */
const COMMENT = /\/\*[\s\S]*?\*\//g;

/** 宣言の形。行頭のプロパティ名とコロンの後ろを取る。 */
const DECLARATION = /^\s*(-{0,2}[a-zA-Z][a-zA-Z0-9-]*)\s*:\s*([^;{}]*?)\s*;?\s*$/;

/** `var(--name)` の参照。 */
const VAR_USE = /var\(\s*--([a-zA-Z0-9-]+)/g;

/**
 * コメントを空白に置き換える(行番号を保つため、改行だけ残す)。
 *
 * @param source CSS の中身
 * @returns コメントを潰した中身
 */
export function stripComments(source: string): string {
  return source.replace(COMMENT, (match) => match.replace(/[^\n]/g, ' '));
}

/**
 * 宣言を取り出す。
 *
 * 1 行 1 宣言で書かれていることを前提にする(このリポジトリの CSS は生成物も手書きも
 * その形をしている)。`@media (min-width: 900px)` のような at-rule の条件も宣言として
 * 拾う —— そこに書かれた px も生値だからである。
 *
 * @param file ファイル(リポジトリルート相対)
 * @param source CSS の中身
 * @returns 見つかった宣言(出現順)
 */
export function scanDeclarations(file: string, source: string): readonly CssDeclaration[] {
  const found: CssDeclaration[] = [];
  stripComments(source)
    .split('\n')
    .forEach((rawLine, index) => {
      for (const line of splitLine(rawLine)) {
        const match = DECLARATION.exec(line);
        if (match === null) continue;
        const [, property, value] = match;
        if (property === undefined || value === undefined || value === '') continue;
        found.push({ file, line: index + 1, property: property.toLowerCase(), value });
      }
    });
  return found;
}

/**
 * 1 行を宣言の候補に割る。
 *
 * セレクタ(`{` の手前)と at-rule の括弧を落として、`prop: value` の形だけを残す。
 */
function splitLine(rawLine: string): readonly string[] {
  const trimmed = rawLine.trim();
  if (trimmed.startsWith('@media') || trimmed.startsWith('@supports')) {
    return [...trimmed.matchAll(/\(([^()]*)\)/g)].map((match) => match[1] ?? '');
  }
  if (trimmed.includes('{')) return [];
  return [trimmed];
}

/**
 * `var(--…)` の参照を取り出す。
 *
 * @param file ファイル(リポジトリルート相対)
 * @param source CSS の中身
 * @returns 見つかった参照(出現順)
 */
export function scanVarUses(file: string, source: string): readonly CssVarUse[] {
  const found: CssVarUse[] = [];
  stripComments(source)
    .split('\n')
    .forEach((line, index) => {
      for (const match of line.matchAll(VAR_USE)) {
        const name = match[1];
        if (name === undefined) continue;
        found.push({ file, line: index + 1, name });
      }
    });
  return found;
}

/**
 * 値から文字列リテラルを落とす。
 *
 * `content: "12px"` の中身まで単位として拾わないため。フォント名の検査は
 * プロパティ単位で別に行う(G1)。
 *
 * @param value 宣言の値
 * @returns 引用符で囲まれた部分を空にした値
 */
export function stripStrings(value: string): string {
  return value.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
}

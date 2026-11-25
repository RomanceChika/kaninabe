/**
 * 「書き方の例」章(docs/book/examples.md)が実コード・実仕様から抜粋を切り出すための
 * 汎用エンジン。docs/rules/process/common/tooling/standards/code-examples.md が正。
 *
 * **例は腐るので手で写さない。** 実コードに `// #region example:{name}` /
 * `-- #region example:{name}`(SQL)の印を置き、この切り出し器がそのまま抜き出す。
 * 仕様 md は印を持たず、`### ` 見出し(見出しレベルは問わない)をアンカーに節を切る。
 *
 * **この module は意図して I/O を行う。** `scripts-code-quality.md` の「生成器は
 * ファイル読み込みをしない」は仕様モデル(SpecModel)から導出する生成器の規約であり、
 * この章の主題は「リポジトリの実ファイルそのもの」である。CLI(generate-docs.ts)を
 * 経由する形にすると新しい ctx フィールドの配線が要り、ここは各種ローダー
 * (lib/model/query/loader.ts 等)と同じ「読み込みは専用モジュールが担う」の側に立つ。
 */

import fs from 'node:fs';
import path from 'node:path';
import { toRelative, walkFiles } from '../../io/paths.js';
import { sourceRootPath } from '../../model/product/layout.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 1 例に許す最大行数。超えたら generate エラーにする(例を小さく保つための強制)。 */
export const MAX_EXAMPLE_LINES = 40;

/**
 * 印を探す木(リポジトリルート相対)。
 *
 * **一覧(どのファイルに印があるか)は誰も持たない。** 索引を人が書くと (a) 体系側に置けば
 * 別のリポジトリのハンドブックにこちらのアプリのコードが載り(束 ⑱ の題材 B が実測)、
 * (b) 規約文書に置けば `docs/rules/` を持たないリポジトリはこの章を構造的に持てない
 * (束 ⑲-1 の独立レビュー 4-A)。どちらも**免除リストを持たない**原則(PRIN-0006)に反する
 * —— 印が置かれている事実はファイルの側にあるので、**走査して導出する**のが正しい。
 *
 * ここに並ぶのは層の名前(**軸**)だけであり、アプリの語彙は 1 語も無い ——
 * 実装の木(ARCH-BE-0001)・migration の置き場(Supabase)・仕様の木の 3 つである。
 * 仕様の木を含めるのは、仕様 md は**印を持たない**(見出しをアンカーにする)規約だから
 * であり、置いてしまった印を「未参照の印」として捕まえるためである。
 */
export function exampleScanRoots(roots: ProductRoots, layout: ProductLayout): readonly string[] {
  return [sourceRootPath(layout, roots), roots.migrations, roots.specs].filter(
    (root): root is string => root !== null,
  );
}

/** 印を置きうるファイルの拡張子(走査で読む対象)。 */
const SCANNED_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.sql', '.md'];

/**
 * 印(`#region example:{name}`)が実際に置かれているファイルを走査して集める。
 *
 * 「印はあるがどの章の例からも参照されていない」を検出するには、参照されている名前の集合
 * (カタログ側)だけでなく**実際に印が置かれているファイル**の母集合が要る。その母集合は
 * リポジトリの中身そのものであり、宣言で二重に持たない(持てば宣言と実体がずれる)。
 *
 * **印が 1 つも無いリポジトリでは空を返す** —— 「書き方の例」の章そのものを生成しないという
 * 意味であり、欠落ではない(仕様だけのリポジトリ・実装をまだ書いていない新規プロジェクト)。
 *
 * @param root 生成対象のリポジトリルート(絶対パス)
 * @param roots 製品が宣言した根(走査する木の位置)
 * @param layout 置き場の配置(実装のソースの根)
 * @returns 印を持つファイル(リポジトリルート相対・辞書順)。無ければ空
 */
export function scanExampleSourceFiles(root: string, roots: ProductRoots, layout: ProductLayout): readonly string[] {
  const found: string[] = [];
  for (const scanRoot of exampleScanRoots(roots, layout)) {
    const base = path.join(root, scanRoot);
    for (const absolute of walkFiles(base, (name) => SCANNED_EXTENSIONS.some((ext) => name.endsWith(ext)))) {
      // **借りてきた実体は数えない。** 走査は symlink を辿るので、別のリポジトリのコードを
      // symlink で覗かせている木(fixture の通し実行が本物のエンジン・実行器をつなぐ形)では、
      // そのリポジトリの実コードではないファイルが母集合に入ってしまう —— 章は「そのリポジトリの
      // 実コードからしか採らない」ので、実体が木の外にあるものは落とす。
      if (!insideRepo(root, absolute)) continue;
      const source = fs.readFileSync(absolute, 'utf-8');
      if (!source.includes('#region example:')) continue;
      found.push(`${scanRoot}/${toRelative(base, absolute)}`);
    }
  }
  // 章の中身は順序に依らない(カタログが並びを決める)が、母集合の並びは検査の出力順に出るので
  // **辞書順に固定する** —— ファイルシステムの列挙順が環境で変われば、エラーの並びが変わる。
  return found.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * そのファイルの**実体**がリポジトリの木の中にあるか(symlink で外を覗いていないか)。
 *
 * @param root 生成対象のリポジトリルート(絶対パス)
 * @param absolute 走査で見つかったファイルの絶対パス
 * @returns 実体が木の中にあれば true
 */
function insideRepo(root: string, absolute: string): boolean {
  try {
    return fs.realpathSync(absolute).startsWith(fs.realpathSync(root) + path.sep);
  } catch {
    return false;
  }
}

/** `// #region example:{name}` / `-- #region example:{name}` の開始行。 */
const REGION_START = /^\s*(?:\/\/|--)\s*#region example:([a-zA-Z0-9][a-zA-Z0-9_-]*)\s*$/;
/** `// #endregion` / `-- #endregion` の終了行。 */
const REGION_END = /^\s*(?:\/\/|--)\s*#endregion\s*$/;
/** Markdown の見出し行(`#`〜`######`)。 */
const HEADING_LINE = /^(#{1,6})\s+(.+?)\s*$/;
/** 生成ブロックの境界コメント(見出しアンカーの節に紛れ込んだら除く)。 */
const GENERATED_MARKER_LINE = /^<!--\s*\/?AUTO-GENERATED:[a-z0-9-]+\s*-->$/;
/** 生成ブロックの境界コメントの分解(1 つ目が `/`(終了)か空(開始)・2 つ目が印の名前)。 */
const GENERATED_MARKER_PART = /^<!--\s*(\/?)AUTO-GENERATED:([a-z0-9-]+)\s*-->$/;

/**
 * 「書き方の例」の章を持つリポジトリか。
 *
 * 章の生成器(book/examples-page.ts)と表紙の章立て(book/chapters.ts)が**同じ判定**を使うための
 * 述語である。片方だけが持つと、表紙が存在しないページへリンクする。
 *
 * 判定は「**そのリポジトリの実ファイルに印が 1 つでもあるか**」だけであり、`docs/rules/` の
 * 有無には依らない(束 ⑲-3)—— 規約文書をまだ書いていないリポジトリでも、印を置けば章を持てる。
 *
 * @param ctx 生成器の共有文脈
 * @returns 章を生成するなら true
 */
export function hasExamplesChapter(ctx: {
  readonly actions?: unknown;
  readonly repoRoot?: string;
  readonly roots: ProductRoots;
  readonly layout: ProductLayout;
}): boolean {
  if (ctx.actions === undefined || ctx.repoRoot === undefined) return false;
  const known = EXAMPLES_CHAPTER_OF.get(ctx);
  if (known !== undefined) return known;
  const found = scanExampleSourceFiles(ctx.repoRoot, ctx.roots, ctx.layout).length > 0;
  EXAMPLES_CHAPTER_OF.set(ctx, found);
  return found;
}

/**
 * 文脈ごとの判定の控え。章の一覧(`bookChapters`)は 1 回の生成の中で何度も引かれ、そのたびに実ファイルの全走査をすると生成の大半の時間になる
 * (実測: 本の生成 18 秒のうち 13 秒)。文脈は 1 回の生成の間は変わらない(読み取り専用)ので、同じ文脈の 2 回目からは控えを返す。文脈が違えば(作り直せば)走査し直す。
 */
const EXAMPLES_CHAPTER_OF = new WeakMap<object, boolean>();

/**
 * リポジトリルート相対パスのファイルを読む。**無い・ファイルでない**(空文字や、ディレクトリを指す相対パス = 配置が決められなかった抜粋元)なら null
 * (呼び出し側がエラーに変える。ディレクトリを読もうとして例外で落とさない)。
 *
 * **リポジトリルートは呼び出し側が渡す。** 以前はこのファイル自身の位置から 5 階層上を
 * 解いていたが、それは「生成器が住んでいるリポジトリ」であって**生成対象のリポジトリ**では
 * ない —— 別のリポジトリの仕様を生成しても、抜粋だけがこちらのコードから採られていた
 * (束 ⑱ の題材 B が実測)。
 *
 * @param root 生成対象のリポジトリルート(絶対パス)
 * @param relativePath リポジトリルートからの相対パス
 */
export function readRepoFile(root: string, relativePath: string): string | null {
  if (relativePath === '') return null;
  const absolute = path.join(root, relativePath);
  return fs.statSync(absolute, { throwIfNoEntry: false })?.isFile() === true ? fs.readFileSync(absolute, 'utf-8') : null;
}

/** 行数(空行を含む素朴な行数。上限判定に使う)。 */
export function countLines(text: string): number {
  if (text === '') return 0;
  return text.split('\n').length;
}

/**
 * `source` から `#region example:{name}` 〜 `#endregion` の中身を取り出す。
 * 印が無い・閉じていない場合は null(呼び出し側が「未解決の印」として報告する)。
 *
 * @param source ファイルの中身
 * @param name 探す例の名前(`#region example:` の後ろ)
 */
export function extractRegion(source: string, name: string): string | null {
  const lines = source.split('\n');
  const startIndex = lines.findIndex((line) => REGION_START.exec(line)?.[1] === name);
  if (startIndex === -1) return null;
  const endOffset = lines.slice(startIndex + 1).findIndex((line) => REGION_END.test(line));
  if (endOffset === -1) return null;
  const body = lines.slice(startIndex + 1, startIndex + 1 + endOffset);
  return trimBlankEdges(body).join('\n');
}

/** `source` に置かれている `#region example:{name}` の名前を宣言順に全部返す。 */
export function regionNamesIn(source: string): readonly string[] {
  const names: string[] = [];
  for (const line of source.split('\n')) {
    const name = REGION_START.exec(line)?.[1];
    if (name !== undefined) names.push(name);
  }
  return names;
}

/**
 * 見出しの節の行の範囲(`start` は見出し行、`end` は次に現れる**同じか浅いレベル**の見出しの行。無ければ行数)。
 *
 * @param lines 仕様ファイルの行
 * @param heading 見出しのテキスト(先頭の `#` と前後の空白を除いた文字列。完全一致)
 * @returns 範囲(見出しが無ければ null)
 */
function sectionRange(lines: readonly string[], heading: string): { readonly start: number; readonly end: number } | null {
  let start = -1;
  let level = 0;
  for (const [index, line] of lines.entries()) {
    const match = HEADING_LINE.exec(line);
    if (match?.[2] === heading) {
      start = index;
      level = match[1]?.length ?? 0;
      break;
    }
  }
  if (start === -1) return null;

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = HEADING_LINE.exec(lines[index] ?? '');
    if (match !== null && (match[1]?.length ?? 0) <= level) {
      end = index;
      break;
    }
  }
  return { start, end };
}

/**
 * Markdown から `heading` に一致する見出し(`### ` 等。レベルは問わない)の節を切り出す。
 * 節は見出し行自身から、次に現れる**同じか浅いレベル**の見出しの直前まで(無ければ EOF まで)。
 * 生成ブロックの境界コメント行は取りこぼれても意味的な雑音になるので除く。
 *
 * @param markdown 仕様ファイルの中身
 * @param heading 見出しのテキスト(先頭の `#` と前後の空白を除いた文字列。完全一致)
 */
export function extractSection(markdown: string, heading: string): string | null {
  const lines = markdown.split('\n');
  const range = sectionRange(lines, heading);
  if (range === null) return null;
  const body = lines
    .slice(range.start, range.end)
    .filter((line) => !GENERATED_MARKER_LINE.test(line.trim()));
  return trimBlankEdges(body).join('\n');
}

/**
 * 見出しの節が**生成ブロックと重なる**とき、そのブロックの印(マーカー名)を返す。
 *
 * 節の見出しがブロックの中にある場合と、手書きの見出しの節がブロックを含む場合の両方を数える
 * (どちらも、抜粋の中身が生成器の出力に左右される)。「書き方の例」の章が、ディスクの前回の結果ではなく
 * この回の生成結果から引くべき抜粋の見分けに使う。
 *
 * @param markdown 仕様ファイルの中身
 * @param heading 見出しのテキスト(`extractSection` と同じ)
 * @returns 重なる生成ブロックの印(ファイルに現れる順。見出しが無ければ空)
 */
export function generatedMarkersOverlapping(markdown: string, heading: string): readonly string[] {
  const lines = markdown.split('\n');
  const range = sectionRange(lines, heading);
  if (range === null) return [];
  const names: string[] = [];
  let open: { readonly name: string; readonly line: number } | null = null;
  for (const [index, line] of lines.entries()) {
    const marker = GENERATED_MARKER_PART.exec(line.trim());
    if (marker === null) continue;
    if (marker[1] === '') {
      open = { name: marker[2] ?? '', line: index };
    } else if (open !== null && open.name === marker[2]) {
      if (open.line < range.end && index >= range.start && !names.includes(open.name)) names.push(open.name);
      open = null;
    }
  }
  return names;
}

/** 先頭・末尾の空行を落とす(印・見出しのすぐ内側に空行があっても抜粋がきれいになるように)。 */
function trimBlankEdges(lines: readonly string[]): string[] {
  const body = [...lines];
  while (body.length > 0 && body[0]?.trim() === '') body.shift();
  while (body.length > 0 && body[body.length - 1]?.trim() === '') body.pop();
  return body;
}

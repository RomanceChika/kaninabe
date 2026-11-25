/**
 * 写し元の**閉包**(C24 の鮮度の hash の対象)。
 *
 * `\* SOURCE: <パス> <sha256>` の sha256 は、そのファイル 1 本の本文ではなく、**そのファイルと、
 * そこから相対 import(`./` `../`)で辿れる全モジュールの内容の hash** である。写し元 1 本の本文だけを固定
 * すると、`RPC_BODY_WORDS` や `findEntityFields` のように **import 先の本文だけが変わる**束で hash が動かず、
 * モデルが古くなっても鮮度が緑のままになる。
 *
 * - **辿る辺**: `lib/semantics/import-graph.ts` の `importsOfSource` が AST で拾う全部(値・型・副作用・再輸出・
 *   動的)。**型だけの import も入れる**(区別しない。単純で嘘が無い)。
 * - **別名の import(`@/…`)** は製品の実装の木のソースの根に解いて辿る。Outbox の写し元は
 *   app の実装で、`@/operation/jobs/ports` のように別名で import するため、辿らないと import 先だけが変わった
 *   ときに hash が動かない。**別名の綴り(`@/`)も行き先のディレクトリも、置き場の配置が与える**(`SourceAlias`。このファイルは綴りを持たない)。
 * - **止まる所**: それ以外の相対でない指定子(`@kaninabe/…` / `node:…` / パッケージ名)。ここは閉包に入れない
 *   (依存の中身は写し元の外)。呼び手が**素の指定子の許可表**(`bare`)を渡したら、表に無い素の指定子は閉包の欠け
 *   (`unlisted`)として `unresolved` に載せる —— `package.json` の `imports`(`#…`)・`tsconfig` の `paths` の別名は束ねる道具が
 *   自分のソースに解くので、境界として捨てると届く先が黙って消える(点検 7 回目 B7-2。X8 が渡す。C24 は渡さない)。
 * - **辿るのは TS / JS だけ**: `.sql` などは葉(import を持たない)。
 * - **循環**は訪問済みの印で止まる。
 * - **字句でない指定子**(`` import(`./${x}`) `` / `require(x)`)は辿れないので `unresolved` に `opaque: true` で載せる
 *   (閉包が欠けた。点検 6 回目 B6-1)。
 * - **hash** = 閉包の各ファイルの `(リポジトリ相対パス, sha256)` をパスの昇順に並べて連結したものの sha256。
 *   import の無い写し元 1 本だけでも**同じ式**で出す(形を 1 つにする。本文の sha256 とは別の値になる)。
 *
 * 純粋関数であり throw しない(ファイルの読み取りは呼び出し側が `SourceReader` で注入する)。
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { importsOfSource, resolutionCandidates } from './import-graph.js';
import { FRAMEWORK_CODE_EXTENSIONS } from '../io/paths.js';

/** リポジトリルート相対のパス → 本文(読めなければ null。ディレクトリも null)。 */
export type SourceReader = (relative: string) => string | null;

/** 閉包の 1 ファイル。 */
export interface ClosureFile {
  /** リポジトリルート相対(`/` 区切り)。 */
  readonly path: string;
  readonly sha256: string;
}

/** 辿れなかった import(読む側と指定子)。 */
export interface UnresolvedImport {
  readonly from: string;
  /** 指定子(`opaque` のときは引数の字面)。 */
  readonly specifier: string;
  /**
   * 指定子が字句でない動的 import / `require`(行き先が字面から決まらない。点検 6 回目 B6-1)。
   * 実体が無い相対 import と違い、**どこへ届くかが分からない**ので、届く先で判定する検査(X8・J2)は
   * これがあれば閉包を信じない(fail-closed)。
   */
  readonly opaque?: true;
  /**
   * 指定子が字句だが、相対でも配置の別名でもなく、呼び手が渡した**素の指定子の許可表**(依存のパッケージ・`node:` の組み込み)にも無い
   * (`package.json` の `imports` の `#…`・`tsconfig` の `paths` の別名・自分のパッケージ名の自己参照など。点検 7 回目 B7-2)。
   * 束ねる道具はこれを自分のソースに解きうるので、`opaque` と同じく**どこへ届くかが分からない**(fail-closed)。許可表を渡さない呼び手(C24)には出ない。
   */
  readonly unlisted?: true;
}

/** 閉包の計算結果。 */
export interface Closure {
  /** パスの昇順。 */
  readonly files: readonly ClosureFile[];
  /** 閉包の hash(`closureHash(files)`)。 */
  readonly hash: string;
  /** 相対 import なのに実体が見つからなかったものと、指定子が字句でないもの(あれば閉包は欠けている)。 */
  readonly unresolved: readonly UnresolvedImport[];
}

/** 本文の sha256(小文字 16 進)。 */
export function sha256Of(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * 閉包の hash。
 *
 * @param files 閉包のファイル(並びは問わない。ここでパスの昇順にする)
 * @returns `パス sha256\n` をパスの昇順に連結したものの sha256
 */
export function closureHash(files: readonly ClosureFile[]): string {
  const lines = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((file) => `${file.path} ${file.sha256}\n`);
  return sha256Of(lines.join(''));
}

/** import を辿るファイルか(TS / JS の拡張子)。 */
function isCode(file: string): boolean {
  return FRAMEWORK_CODE_EXTENSIONS.includes(path.posix.extname(file));
}

/**
 * 製品の実装の木の別名(`@/…` の形)。**綴りと行き先は置き場の配置が与える**(`lib/model/product/layout.ts` の `sourceAliasOf`。
 * 配置の型を値でも型でも読まない形にするため、この形はここで宣言する — C24 の写し元の閉包に配置を引き込まない)。
 */
export interface SourceAlias {
  /** 別名の綴り(区切り `/` まで含む。例: `@/`)。 */
  readonly prefix: string;
  /** 別名が指す実装のソースの根(リポジトリルート相対)。 */
  readonly dir: string;
}

/**
 * import の指定子の解決先の候補(辿らない指定子なら null)。
 *
 * - 相対(`./` `../`): 読む側のディレクトリから畳む(リポジトリの外へ出るなら辿れない = 空)。
 * - 別名(`alias.prefix` で始まる): **製品の実装の木**(`alias.dir`)に解く。`app/tsconfig.json` の `paths` は読まない —— 仕組みが
 *   決めている in-app の形(別名 = 実装の木のソースの根)と、配置から引いた別名を使う。
 *   実装の木を持たない製品(`alias` が null)では辿らない。
 * - それ以外(`@kaninabe/…` / `node:…` / 素のパッケージ名): 境界。閉包に入れない。
 */
function candidatesOf(from: string, specifier: string, alias: SourceAlias | null): readonly string[] | null {
  if (specifier.startsWith('.')) {
    const joined = path.posix.join(path.posix.dirname(from), specifier);
    return joined.startsWith('../') ? [] : resolutionCandidates(joined);
  }
  if (alias !== null && specifier.startsWith(alias.prefix)) {
    return resolutionCandidates(path.posix.join(alias.dir, specifier.slice(alias.prefix.length)));
  }
  return null;
}

/**
 * 写し元の閉包を計算する。
 *
 * @param entry 写し元のリポジトリルート相対パス
 * @param read 本文を読む口
 * @param alias 実装の木の別名(配置の `sourceAliasOf`)。別名の import をここに解く。null なら別名の import は境界
 * @param entrySpecifiers 写し元そのものが辿ってよい import の指定子(**起点の束縛を絞る口**)。省略なら全部を辿る
 *   (C24 の hash はこの形)。渡すと、写し元の import のうちここに無い指定子は辺に数えない —— 起動口が「呼んでいる」
 *   ものだけから閉包を始めるための口で、絞るのは**写し元 1 本の辺だけ**(その先は全部の辺を辿る)
 * @param bare 素の指定子(相対でも別名でもない)の許可表(依存のパッケージ・`node:` の組み込みなら true)。省略なら素の指定子は全部境界
 *   (C24 の hash はこの形)。渡すと、表に無い素の指定子は `unresolved` に `unlisted: true` で載る(点検 7 回目 B7-2)
 * @returns 閉包。写し元そのものが読めなければ null
 */
export function computeClosure(
  entry: string,
  read: SourceReader,
  alias: SourceAlias | null = null,
  entrySpecifiers?: ReadonlySet<string>,
  bare?: (specifier: string) => boolean,
): Closure | null {
  const texts = new Map<string, string>();
  const unresolved: UnresolvedImport[] = [];
  const start = read(entry);
  if (start === null) return null;
  texts.set(entry, start);
  const queue = [entry];
  /** 候補を順に当て、実在する最初の 1 本を閉包へ入れる(入れた・すでに入っていたなら true)。 */
  const admit = (candidates: readonly string[]): boolean => {
    for (const candidate of candidates) {
      if (texts.has(candidate)) return true;
      const text = read(candidate);
      if (text === null) continue;
      texts.set(candidate, text);
      queue.push(candidate);
      return true;
    }
    return false;
  };
  for (let from = queue.pop(); from !== undefined; from = queue.pop()) {
    if (!isCode(from)) continue;
    for (const raw of importsOfSource(from, texts.get(from) ?? '')) {
      // 行き先が字面から決まらない指定子は、起点の絞り込みに関わらず「閉包が欠けた」として必ず載せる
      // (動的 import は呼べば読む = 常に「使われている」。fail-closed)。
      if (raw.opaque === true) {
        unresolved.push({ from, specifier: raw.specifier, opaque: true });
        continue;
      }
      if (from === entry && entrySpecifiers !== undefined && !entrySpecifiers.has(raw.specifier)) continue;
      const candidates = candidatesOf(from, raw.specifier, alias);
      if (candidates === null) {
        if (bare !== undefined && !bare(raw.specifier)) unresolved.push({ from, specifier: raw.specifier, unlisted: true });
        continue;
      }
      if (!admit(candidates)) unresolved.push({ from, specifier: raw.specifier });
    }
  }
  const files = [...texts.entries()]
    .map(([file, text]) => ({ path: file, sha256: sha256Of(text) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, hash: closureHash(files), unresolved };
}

/** 2 つの閉包の差。 */
export interface ClosureDelta {
  /** 両方にあって中身が変わったファイル。 */
  readonly changed: readonly { readonly path: string; readonly before: string; readonly after: string }[];
  /** いまだけにあるファイル(import が増えた)。 */
  readonly added: readonly ClosureFile[];
  /** 前だけにあるファイル(import が減った・消えた)。 */
  readonly removed: readonly ClosureFile[];
}

/**
 * 旧い閉包といまの閉包の差を、ファイル単位で名指す。
 *
 * @param before 宣言された hash を作った時点の閉包のファイル
 * @param after いまの閉包のファイル
 * @returns 変わった・増えた・減ったファイル
 */
export function diffClosure(before: readonly ClosureFile[], after: readonly ClosureFile[]): ClosureDelta {
  const past = new Map(before.map((file) => [file.path, file.sha256]));
  const now = new Map(after.map((file) => [file.path, file.sha256]));
  return {
    changed: after
      .filter((file) => past.has(file.path) && past.get(file.path) !== file.sha256)
      .map((file) => ({ path: file.path, before: past.get(file.path) ?? '', after: file.sha256 })),
    added: after.filter((file) => !past.has(file.path)),
    removed: before.filter((file) => !now.has(file.path)),
  };
}

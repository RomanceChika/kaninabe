/**
 * 作業置き場(`tmp` ディレクトリ)の読み書き(io 層)。**リンクを辿らない。**
 *
 * `.gitignore` の末尾スラッシュ指定(ディレクトリ名 + スラッシュ)は**ディレクトリだけ**に当たるので、シンボリックリンクの `tmp` はコミットできてしまう。
 * 追跡された `tmp -> fixtures/x` があると、(1) 書き込み(`deps:check` の結果・SBOM・`spec:diff --out`)がリンクの先
 * (リポジトリの別の場所)へ書かれ、(2) 読み取り(`verify` の「依存の検査の最終実施」)が**コミットされた偽の記録**を読んで
 * 警告を恒久に黙らせる(3 回目の点検 C-4)。そこで根から先の各要素を `lstat` で見て、リンクがあれば書かず・読まない。
 * 最後の 1 要素は `O_NOFOLLOW` で開く(検査と書くまでの間にリンクへ差し替えられても辿らない)。
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * `root` から `rel` までの途中の要素にシンボリックリンクがあるか(実在する要素だけ見る。無い要素から先は見ない)。
 *
 * @param root 根の絶対パス
 * @param rel 根からの相対パス(区切りは `/`)
 * @returns リンクだった要素の相対パス。無ければ null
 */
export function symlinkOnPath(root: string, rel: string): string | null {
  let current = root;
  const segments = rel.split('/').filter((segment) => segment !== '');
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch {
      return null;
    }
    if (stat.isSymbolicLink()) return segments.slice(0, index + 1).join('/');
  }
  return null;
}

/**
 * 作業置き場のファイルを読む。**途中にリンクがあれば読まない**(null)。無い・読めないときも null。
 *
 * @param root 根の絶対パス
 * @param rel 根からの相対パス
 */
export function readScratchText(root: string, rel: string): string | null {
  if (symlinkOnPath(root, rel) !== null) return null;
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8');
  } catch {
    return null;
  }
}

/** `O_NOFOLLOW` で開いて書く(最後の要素がリンクなら開けずに投げる。通常のファイル以外・ハードリンクつきは書かない)。 */
export function writeFileNoFollow(absolute: string, body: string): void {
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW ?? 0);
  const descriptor = fs.openSync(absolute, flags, 0o644);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink > 1) throw new Error(`${absolute} は通常のファイルでない、またはハードリンクを持つファイルです`);
    fs.ftruncateSync(descriptor, 0);
    fs.writeFileSync(descriptor, body);
  } finally {
    fs.closeSync(descriptor);
  }
}

/**
 * 根の下のファイルを書く(置き場は要素ごとに作る)。**途中の要素がリンクなら投げる**(`tmp` 自体がリンクでも拒む)。
 *
 * @param root 根の絶対パス
 * @param rel 根からの相対パス(区切りは `/`。`..` は不可)
 * @param body 本文
 */
export function writeScratchFile(root: string, rel: string, body: string): void {
  const segments = rel.split('/');
  if (rel === '' || path.isAbsolute(rel) || segments.some((segment) => segment === '' || segment === '..')) {
    throw new Error(`作業置き場のパスが不正です: ${rel}`);
  }
  const link = symlinkOnPath(root, rel);
  if (link !== null) throw new Error(`${link} はシンボリックリンクです(書き込みが辿って別の場所を書き換える)。リンクを外してください`);
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) fs.mkdirSync(current);
  }
  writeFileNoFollow(path.join(root, rel), body);
}

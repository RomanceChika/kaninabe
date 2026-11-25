/**
 * 生成物の**書き込みの関所**(生成器の出口で、書いてよい場所かを 1 か所で決める)。
 *
 * **仕様の束は信頼できない入力である**。生成物のファイル名は仕様が宣言する(migration の名前など)ので、
 * 敵対的な仕様は `../../../.zshrc` を書き先にできてしまう。リポジトリがコミットしたシンボリックリンク
 * (`出力の木 -> /home/…`)を辿って木の外へ書くこともできる。そこで、**生成の書き込みは必ずここを通る**
 * (`applyGeneratedSections` が全ファイルを書く前にここで検査し、1 件でも拒否があれば何も書かない)。
 *
 * 拒否する形(どれも**書かずに理由を返す**。例外は投げない):
 *   - 絶対パス・ドライブ文字・`\` を含む・空の要素 / `.` / `..` の要素・制御文字(書き先の綴りが曖昧になる形)
 *   - `.git` で始まる要素(フックと CI を書き換える口。大文字小文字・正規化を畳んで見る)・末尾が `.` / 空白・`:` を含む要素
 *   - ハードリンクを持つファイル(`nlink > 1`)
 *   - 製品が宣言した書き込み先の木(`writableTreesOf`)の外
 *   - 製品の根から書き先までの途中に**シンボリックリンク**がある(ディレクトリでもファイルでも。宙ぶらりんのリンクも)
 *   - 書き先が通常のファイルでない(ディレクトリなど)
 *
 * **アプリの語彙は 1 語も持たない**。木の一覧は製品の宣言(`product.md` の `roots`)から組む。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ProductRoots } from '../model/product/types.js';
import { FRAMEWORK_GUARANTEES_FILE } from '../io/framework-paths.js';

/** 書き込みの拒否 1 件(どのファイルを、なぜ)。 */
export interface WriteRefusal {
  /** 製品の根からの相対パス(宣言のままの綴り。制御文字は `?` に置き換えて報告の行を壊さない)。 */
  readonly file: string;
  /** 拒否の理由(1 行)。 */
  readonly reason: string;
}

/** 書き込みの関所が見る口(実ファイルへの問い合わせ。テストが差し替えられる)。 */
export interface GateProbe {
  /** パスそのものの種類(リンクを辿らない)。無ければ `absent`。 */
  readonly kindOf: (absolute: string) => 'absent' | 'file' | 'directory' | 'symlink' | 'multilink' | 'other';
}

/** 実ファイルに問い合わせる既定の口。 */
export const FS_GATE_PROBE: GateProbe = {
  kindOf: (absolute) => {
    try {
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) return 'symlink';
      if (stat.isDirectory()) return 'directory';
      if (stat.isFile() && stat.nlink > 1) return 'multilink';
      return stat.isFile() ? 'file' : 'other';
    } catch {
      return 'absent';
    }
  },
};

/**
 * 書き先の要素として置けない名前かを、大文字小文字と Unicode の正規化(NFC)を畳んで見る(`.GIT` `.Github` や分解形の綴りで抜けさせない)。
 * `.git` で始まる名前(`.git` `.github` `.gitignore` `.gitmodules` `.gitattributes` …)と、Windows の短い名前(`GIT~1`)は置けない。
 */
function forbiddenSegment(segment: string): boolean {
  const folded = segment.normalize('NFC').toLowerCase();
  return folded.startsWith('.git') || /^git~\d/.test(folded);
}

/** 書き先の綴りに置けない文字(制御文字・バックスラッシュ)。 */
const UNSAFE_CHARACTER = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060\u2066-\u2069\uFEFF\\]/u;

/** 報告の行に出す綴り(制御文字を `?` にする)。 */
function printable(file: string): string {
  return file.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu, '?');
}

/**
 * 相対パスの**綴りだけ**を見る(実ファイルに触れない)。
 *
 * @param file 製品の根からの相対パス(区切りは `/`)
 * @returns 拒否の理由。置いてよい綴りなら null
 */
export function relativePathProblem(file: string): string | null {
  if (file === '') return '空のパスです';
  if (UNSAFE_CHARACTER.test(file)) return '制御文字またはバックスラッシュを含みます';
  if (file.startsWith('/') || /^[A-Za-z]:/.test(file)) return '絶対パスです';
  for (const segment of file.split('/')) {
    if (segment === '' || segment === '.') return '空の要素または "." を含みます';
    if (segment === '..') return '".." を含みます(木の外へ出る形)';
    if (/[. ]$/.test(segment)) return '要素の末尾が "." か空白です(ファイルシステムが削って別の名前になる)';
    if (segment.includes(':')) return '要素に ":" を含みます(代替データストリーム・ドライブの綴り)';
    if (forbiddenSegment(segment)) return `${segment} の中へは書けません(.git で始まる名前)`;
  }
  return null;
}

/** `tree` の下(または `tree` そのもの)か。木の一覧の要素は 1 ファイルでもよい。 */
function isWithin(file: string, tree: string): boolean {
  return file === tree || file.startsWith(`${tree}/`);
}

/**
 * 1 ファイルが書いてよい場所かを見る。
 *
 * @param repoRoot 製品の根の絶対パス
 * @param file 書き先(製品の根からの相対パス)
 * @param trees 書いてよい木(`writableTreesOf`。製品の根からの相対パス)
 * @param probe 実ファイルへの問い合わせ
 * @returns 拒否の理由。書いてよいなら null
 */
export function writeTargetProblem(repoRoot: string, file: string, trees: readonly string[], probe: GateProbe = FS_GATE_PROBE): string | null {
  const spelled = relativePathProblem(file);
  if (spelled !== null) return spelled;
  if (!trees.some((tree) => isWithin(file, tree))) return '製品が宣言した書き込み先の木の外です';
  let current = repoRoot;
  const segments = file.split('/');
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const kind = probe.kindOf(current);
    if (kind === 'absent') return null;
    if (kind === 'symlink') return `${segments.slice(0, index + 1).join('/')} はシンボリックリンクです(書き込みが辿って木の外のファイルを書き換える)`;
    if (kind === 'multilink') return `${segments.slice(0, index + 1).join('/')} はハードリンクを持つファイルです(書くと別名の先も書き換わる)`;
    const last = index === segments.length - 1;
    if (last && kind !== 'file') return '通常のファイルではありません';
    if (!last && kind !== 'directory') return `${segments.slice(0, index + 1).join('/')} はディレクトリではありません`;
  }
  return null;
}

/**
 * 書き先の全ファイルを検査し、拒否を集める(1 件でもあれば呼び手は何も書かない)。
 *
 * @param repoRoot 製品の根の絶対パス
 * @param files 書き先(製品の根からの相対パス)
 * @param trees 書いてよい木
 * @param probe 実ファイルへの問い合わせ
 * @returns 拒否(昇順)。0 件なら全部書いてよい
 */
export function writeRefusalsOf(repoRoot: string, files: Iterable<string>, trees: readonly string[], probe: GateProbe = FS_GATE_PROBE): readonly WriteRefusal[] {
  const refusals: WriteRefusal[] = [];
  for (const file of files) {
    const reason = writeTargetProblem(repoRoot, file, trees, probe);
    if (reason !== null) refusals.push({ file: printable(file), reason });
  }
  return refusals.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/**
 * 製品が宣言した**書き込み先の木**。生成物が書かれるのは、製品が `product.md` の `roots` で宣言した木だけである。
 *
 * 仕組み自身の保証台帳(`framework/guarantees.md`)に書くのは、生成の対象の木が仕組みの木そのもののときだけ
 * (別の製品の木を生成するとき、道具の木へ書かない)。木ではなく**そのファイル 1 本**だけを足す。
 *
 * @param roots 製品が宣言した根
 * @param options `ownFrameworkTree`: 生成の対象の木が仕組みの木そのものか
 * @returns 製品の根からの相対パス(区切りは `/`)
 */
export function writableTreesOf(roots: ProductRoots, options: { readonly ownFrameworkTree: boolean }): readonly string[] {
  const declared = [roots.specs, roots.book, roots.generated, roots.migrations, roots.app, roots.knowledge, roots.previews];
  const trees = declared.filter((tree): tree is string => tree !== null);
  return options.ownFrameworkTree ? [...trees, FRAMEWORK_GUARANTEES_FILE] : trees;
}

/**
 * 関所を通った書き先へ書く(リンクを辿らない・ハードリンクを書き換えない)。
 *
 * 検査から書くまでの間にリンクへ差し替えられても辿らないよう、`O_NOFOLLOW` で開き、**開いた実体**を `fstat` で見る(通常のファイルで `nlink === 1`)。
 * 切り詰めは見たあと(開くときに `O_TRUNC` を付けない)。
 *
 * @param absolute 書き先の絶対パス
 * @param content 中身
 * @returns 書けなかった理由。書けたら null
 */
export function writeGuarded(absolute: string, content: string): string | null {
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW ?? 0);
  let descriptor: number;
  try {
    descriptor = fs.openSync(absolute, flags, 0o644);
  } catch (error) {
    return `開けませんでした(${error instanceof Error ? error.message : String(error)})`;
  }
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink > 1) return '通常のファイルでない、またはハードリンクを持つファイルです';
    fs.ftruncateSync(descriptor, 0);
    fs.writeFileSync(descriptor, content);
    return null;
  } catch (error) {
    return `書けませんでした(${error instanceof Error ? error.message : String(error)})`;
  } finally {
    fs.closeSync(descriptor);
  }
}

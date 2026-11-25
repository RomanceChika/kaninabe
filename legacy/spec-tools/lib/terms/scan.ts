/**
 * 用語の台帳の M7〜M9 が見る本文を読む I/O 境界。
 *
 * 走査範囲は `TermScanScope`(`scope.ts` が宣言する)が決める —— Markdown の本文(規約・設計メモ・
 * ブック・スキル・仕様・案内)と、コードのコメントと日本語を含む文字列リテラル、シェルと YAML の `#` コメント。
 * 台帳が `first` に書いた文書は範囲の外のものも読む。
 * **ファイルを読むのはここだけ**で、検証器は読んだ結果(`TermCorpus`)だけを受け取る
 * (規約: scripts-code-quality.md「I/O と純粋ロジックの分離」)。
 *
 * 読まないもの(生成物・適用済みの migration・歴史の記録など)は `scope.ts` の `TERM_OUT_OF_SCOPE` が
 * 理由つきで宣言する。仕様の frontmatter の値と台帳の欄は、本文の取り出し(`proseLines`)が落とす
 * —— 台帳は旧綴りを**挙げる側**であり、歴史の記録は書き換えない。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { walkRepoFiles } from '../io/output-paths.js';
import { FRAMEWORK_CODE_EXTENSIONS, isFile, toRelative } from '../io/paths.js';
import { GENERATED_MARKER, WHOLE_FILE_GENERATED_NOTICE } from '../generality/scan.js';
import { literalProseLines, isTestFile } from './code-literals.js';
import { hashCommentProseLines } from './hash-comments.js';
import { collectSpecText, collectSummaries } from './summaries.js';
import { commentProseLines, proseLines, type ProseLinesOptions } from './prose.js';
import type { HumanSentence, ProseFile, TermCorpus, TermLedgerSpec, TermScanScope } from '../model/terms/types.js';

/** 走査する文書(Markdown の本文)か。 */
function isProseFile(name: string): boolean {
  return name.endsWith('.md');
}

/** 仕様の雛形(`template.*.md`)か。雛形の `summary` は置き換える前の書き方の例なので、人が書く文として数えない。 */
function isTemplate(name: string): boolean {
  return /^template\..+\.md$/.test(name);
}

/** 人が書く文と語彙を集める仕様ファイルか(雛形を除く Markdown)。 */
function isSpecFile(name: string): boolean {
  return isProseFile(name) && !isTemplate(name);
}

/** 走査するコードか(仕組み側のコードの拡張子の値域。W1 / W2 と同じ宣言)。 */
function isCodeFile(name: string): boolean {
  return FRAMEWORK_CODE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/** `#` コメントを読むファイルか(シェルと YAML。拡張子を持たないファイルはフックなどのスクリプト)。 */
function isHashCommentFile(name: string): boolean {
  return /\.(?:ya?ml|sh)$/.test(name) || !name.includes('.');
}

/** 全体が生成物の文書か(先頭の数行に、全体が生成物であることの宣言がある)。 */
function isWholeFileGenerated(source: string): boolean {
  return source.split('\n', 3).some((line) => line.trim() === WHOLE_FILE_GENERATED_NOTICE);
}

/** ファイルを読む。読めなければ null。 */
function readOrNull(absolute: string): string | null {
  if (!isFile(absolute)) return null;
  try {
    return readFileSync(absolute, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 木を走査して本文の行を集める。木が無ければ空(規約だけの木・仕様だけの木は正当な形)。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param trees 走査する木(リポジトリルート相対)
 * @param options 生成ブロックを落とすか
 * @param excluded 読まない文書(リポジトリルート相対。歴史の記録)
 * @returns 文書ごとの本文(木の順・名前順)
 */
/** 除外の名指し。末尾が `/` の項は木ごと(その下の全ファイル)、それ以外はファイルの完全一致。 */
function isExcludedProse(file: string, excluded: readonly string[]): boolean {
  return excluded.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : entry === file));
}

export function scanProseFiles(
  repoRoot: string,
  trees: readonly string[],
  options: ProseLinesOptions = {},
  excluded: readonly string[] = [],
): ProseFile[] {
  const files: ProseFile[] = [];
  for (const tree of trees) {
    for (const absolute of walkRepoFiles(repoRoot, tree, isProseFile)) {
      const file = toRelative(repoRoot, absolute);
      if (isExcludedProse(file, excluded)) continue;
      const source = readOrNull(absolute);
      // ブックの生成物は読まない(綴りの正は仕様と生成器。読むと違反が生成物の側で 2 件目になり、生成が 1 回で落ち着かない)。
      if (source === null || isWholeFileGenerated(source)) continue;
      files.push({ file, lines: proseLines(source, options) });
    }
  }
  return files;
}

/**
 * コードの木を走査して、コメントの行と、日本語を含む文字列リテラルの行を集める。
 *
 * 生成物(先頭の目印を持つファイル)は読まない —— 生成物のコメントは生成器が書いたもので、綴りの正は
 * 生成器の側にある(W1 / W2 が生成物を外すのと同じ線。`GENERATED_MARKER`)。木が無ければ空。
 * 文字列リテラルは `literalExcluded` の名指すファイルでは読まない(`scope.ts` の `TERM_OUT_OF_SCOPE` が
 * 理由を宣言する)。テストのファイルは題だけを読む(`code-literals.ts`)。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param trees 走査する木(リポジトリルート相対)
 * @param literalExcluded 文字列リテラルを読まないファイル(リポジトリルート相対)
 * @param appRoot 実装の木の根(木の根そのものを歩くときの出力の表に使う)
 * @returns コメントかリテラルを持つファイルごとの行(木の順・名前順。ファイルの中は行番号順)
 */
export function scanCodeText(repoRoot: string, trees: readonly string[], literalExcluded: readonly string[] = [], appRoot: string | null = null): ProseFile[] {
  const files: ProseFile[] = [];
  for (const tree of trees) {
    for (const absolute of walkRepoFiles(repoRoot, tree, isCodeFile, appRoot)) {
      const source = readOrNull(absolute);
      if (source === null || source.includes(GENERATED_MARKER)) continue;
      const file = toRelative(repoRoot, absolute);
      const literals = literalExcluded.includes(file) ? [] : literalProseLines(source, isTestFile(file));
      const lines = [...commentProseLines(source), ...literals].sort((a, b) => a.line - b.line);
      if (lines.length > 0) files.push({ file, lines });
    }
  }
  return files;
}

/**
 * シェルと YAML の木を走査して、`#` コメントの行を集める。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param trees 走査する木(リポジトリルート相対)
 * @returns コメントを持つファイルごとの行(木の順・名前順)
 */
export function scanHashComments(repoRoot: string, trees: readonly string[]): ProseFile[] {
  const files: ProseFile[] = [];
  for (const tree of trees) {
    for (const absolute of walkRepoFiles(repoRoot, tree, isHashCommentFile)) {
      const source = readOrNull(absolute);
      if (source === null) continue;
      const lines = hashCommentProseLines(source);
      if (lines.length > 0) files.push({ file: toRelative(repoRoot, absolute), lines });
    }
  }
  return files;
}

/**
 * ドメイン仕様の木を走査して、人が書く文(`summary:`)を集める。木が無ければ空。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param trees 走査する木(リポジトリルート相対)
 * @returns 人が書く文(木の順・名前順・ファイルの中は出現順)
 */
export function scanSummaries(repoRoot: string, trees: readonly string[]): HumanSentence[] {
  const found: HumanSentence[] = [];
  for (const tree of trees) {
    for (const absolute of walkRepoFiles(repoRoot, tree, isSpecFile)) {
      const source = readOrNull(absolute);
      if (source !== null) found.push(...collectSummaries(toRelative(repoRoot, absolute), source));
    }
  }
  return found;
}

/**
 * ドメイン仕様の木の frontmatter の値(`summary` を除く)をつなげる。M10 の語彙になる。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param trees 走査する木(リポジトリルート相対)
 * @returns 改行でつないだ本文(木が無ければ空)
 */
export function scanSpecText(repoRoot: string, trees: readonly string[]): string {
  const found: string[] = [];
  for (const tree of trees) {
    for (const absolute of walkRepoFiles(repoRoot, tree, isSpecFile)) {
      const source = readOrNull(absolute);
      if (source !== null) found.push(...collectSpecText(source));
    }
  }
  return found.join('\n');
}

/** 案内のファイル 1 枚を読む(無ければ空)。 */
function scanProseFileList(repoRoot: string, paths: readonly string[]): ProseFile[] {
  const files: ProseFile[] = [];
  for (const file of paths) {
    const source = readOrNull(join(repoRoot, file));
    if (source !== null) files.push({ file, lines: proseLines(source) });
  }
  return files;
}

/**
 * M7〜M10・M12 の入力を作る。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param scope 走査範囲
 * @param ledger 読み込み済みの台帳(`first` の文書を読む)
 * @returns 本文(Markdown → コード → シェルと YAML の順)と、初出の生テキスト
 */
export function scanTermCorpus(repoRoot: string, scope: TermScanScope, ledger: TermLedgerSpec): TermCorpus {
  const firstTexts = new Map<string, string | null>();
  for (const decl of ledger.terms) {
    if (!firstTexts.has(decl.first)) firstTexts.set(decl.first, readOrNull(join(repoRoot, decl.first)));
  }
  return {
    files: [
      ...scanProseFiles(repoRoot, scope.proseTrees, {}, scope.proseOutOfScope),
      ...scanProseFiles(repoRoot, scope.specTrees, { skipGeneratedBlocks: true }),
      ...scanProseFileList(repoRoot, scope.proseFiles),
      ...scanCodeText(repoRoot, scope.codeTrees, scope.literalOutOfScope, scope.appRoot ?? null),
      ...scanHashComments(repoRoot, scope.hashCommentTrees),
    ],
    firstTexts,
    summaries: scanSummaries(repoRoot, scope.summaryTrees),
    specText: scanSpecText(repoRoot, scope.summaryTrees),
  };
}

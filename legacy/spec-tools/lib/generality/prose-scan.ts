/**
 * 仕組み側コードの**散文**(行コメント・doc コメント)を走査する I/O 境界。
 *
 * W1 は文字列リテラルだけを見る。しかし「軸は仕組み、語はアプリ」が破れる形は
 * リテラルだけではない —— 検査の漏れ探し(2026-09-12 §6)は、**仕組み側の doc コメントが
 * アプリの語で仕組みを説明している**箇所を実測した(`app/src/operation/_template/actor.ts`
 * が「集約ごとに違う(`entry.performer_id` / `workshop.organizer_id`)」と書く、等)。
 * リテラルと違って実行時の挙動は変わらないが、**読み手にとっては仕組みがその集約を
 * 知っているように見える**し、別のアプリに移したときに嘘になる文である。
 *
 * ## 走査の範囲(なぜ `legacy/spec-tools/lib` を入れないか)
 *
 * 対象は**アプリ側の仕組みの層**(`app/src/components` と、土台の宣言で
 * `vocabularyScan: true` の置き場、`app/e2e/walker*`)だけである。`legacy/spec-tools/lib`
 * (検証器・生成器)の doc コメントは**体系が自分を説明する散文**であり、`docs/rules/**` の
 * 規約文書と同じく「このアプリを例に説明する」ことが本来の仕事である(実測でも 254 行が
 * その形だった)。アプリ側の仕組みの層は逆に、**そのアプリのことを知っていてはいけない
 * コード**なので、同じ文がそこにあれば漏れである。
 *
 * ## 例示の印
 *
 * アプリの語を**例として**挙げる文は、その行に `例:` を書く(規約: dsl-extension-triage.md
 * §軸と語)。印のある行は走査から外れる —— 「アプリの語を書くな」ではなく
 * 「アプリの語を**例だと明示せずに**書くな」が規則である。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { walkRepoFiles } from '../io/output-paths.js';
import { isDirectory, listEntries, toRelative } from '../io/paths.js';
import { commentRanges } from './literals.js';
import { vocabularyScanRoots, walkerDir, WALKER_FILE, isScannedFile, isExcludedPath, GENERATED_MARKER, FRAMEWORK_LIB_DIR, FORMAL_DIR } from './scan.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';

/** 例示であることの印(この行は走査から外れる)。 */
export const EXAMPLE_MARK = '例:';

/** 散文のヒット 1 件。 */
export interface VocabularyProseHit {
  /** リポジトリルート相対パス。 */
  readonly file: string;
  /** 1 始まりの行番号。 */
  readonly line: number;
  /** 一致した仕様の語。 */
  readonly word: string;
  /** その行の散文(前後を落とした 1 行)。 */
  readonly text: string;
}

/**
 * 散文を語に割る区切り(日本語の約物込み)。
 *
 * **`・` も区切りである**(日本語の並列の中黒)。区切りにしないと `JSDoc・\`eslint-disable\`` が
 * 1 トークンになり、日本語を含むので英字列の切り出しが走って `disable` が仕様の語に化ける(実測)。
 *
 * **`/` と `.` は区切りにしない。** 区切りにすると
 * `docs/rules/process/frontend/system/x.md` が `system` という語の使用に化ける
 * (パスの途中の一般語であって、アプリの語を書いたわけではない)。パスは 1 トークンの
 * まま落とし、`/` の割りは下の `proseCandidates()` が**文書への参照を落としたあとで**行う。
 */
const TOKEN_SPLIT = /[\s、。・,:：;；（）()「」『』【】[\]{}<>|]+/;

/** 語の前後に付く記号(バッククォート・強調・引用符)。 */
const TRIM_MARKS = /^[`*_'"・\-—]+|[`*_'"・\-—]+$/g;

/** ハンドブックの抜粋の印(散文ではない)。 */
const REGION_MARK = /#(region|endregion)\b/;

/** メンバ参照の区切り(`facts?.entry.performerId` を 3 つに割る)。 */
const MEMBER_SPLIT = /[?.]+/;

/** 日本語に貼り付いた英字列(`誰がorganizerか` から `organizer` を切り出す)。 */
const ASCII_RUN = /[A-Za-z][A-Za-z0-9_]*/g;

/** 非 ASCII(日本語)を含むか。**含むときだけ**英字列を切り出す。 */
const HAS_NON_ASCII = /[^\u0020-\u007e]/;

/** 短すぎる語は偶然の一致が多すぎるので見ない(W1 のリテラルと違い、散文は文脈が緩い)。 */
const MIN_LENGTH = 3;

/**
 * コメントが占める行番号(1 始まり)の集合を返す。
 *
 * 実体は `literals.ts` の `commentRanges()`(**W1 と同じ 1 つの走査器**)である。2 回当てる形は
 * どちらの順でも誤検出を作る —— どちらも実測した。
 *   - 行コメントを先に落とすと、**ブロックコメントの中の `//` が閉じの `*​/` を食べて**ブロックが
 *     次の閉じまで伸び、実コードが散文に化ける(`/** see https://x/y *​/` の 1 行が典型)
 *   - ブロックを先に取ると、**行コメントの中の `/**` が偽のブロックを開き**、同じことが起きる
 *     (実測: 設定ファイルの `resolve: {` が「散文の語」として報告された)
 * 1 回の走査なら「先に始まったコメントが閉じるまで、中の記号は記号でない」が自然に成り立つ。
 *
 * **文字列の中の記号は記号でない。** URL の `//` を行コメントの開始と読むと、その行の実コードが
 * 散文に化ける(実測: `DISCORD_GUILD_INVITE_URL: 'https://…'` の 1 行が「散文の語」として報告された)。
 * だから引用符の 3 種(`'` / `"` / backtick)も状態に持つ。**正規表現リテラルも状態に持つ** ——
 * そこに `//` は書けない(空の正規表現は書けない)が、**中の引用符とバッククォートが文字列を開く**
 * 形は起きる(①-c-d で実測。`/[`]/` の 1 行が次の行の本物のコメントを食べていた)。
 *
 * @param source ソース全文
 * @returns コメントが占める行番号の集合(1 始まり)
 */
export function commentLines(source: string): ReadonlySet<number> {
  const lines = new Set<number>();
  for (const { start, end } of commentRanges(source)) {
    const first = source.slice(0, start).split('\n').length;
    const span = source.slice(start, end).split('\n').length;
    for (let i = 0; i < span; i += 1) lines.add(first + i);
  }
  return lines;
}

/**
 * コメントの**文字だけ**を、行ごとに返す(コードと同じ行にあるコメントは、コメントの部分だけ)。
 *
 * `commentLines` は「コメントがかかる行」を返すので、行の後半がコメントでも行全体を散文として読む。
 * 用語の台帳の M9 は**コメントの綴り**だけを見たい(コードの文字列は別の道で直す)ので、同じ走査器
 * (`commentRanges`)から部分を切り出す。複数行のコメントは 1 行ずつに割り、行番号は元のもの(1 始まり)。
 *
 * @param source ソース全文
 * @returns コメントを含む行の、行番号とコメント部分(出現順。同じ行に 2 つあれば連結)
 */
export function commentSegments(source: string): readonly { readonly line: number; readonly text: string }[] {
  const byLine = new Map<number, string>();
  for (const { start, end } of commentRanges(source)) {
    const first = source.slice(0, start).split('\n').length;
    source
      .slice(start, end)
      .split('\n')
      .forEach((part, offset) => byLine.set(first + offset, `${byLine.get(first + offset) ?? ''}${part}`));
  }
  return [...byLine].sort((a, b) => a[0] - b[0]).map(([line, text]) => ({ line, text }));
}

/**
 * 散文 1 行から、仕様の語と一致する語を拾う。
 *
 * 文書への参照(`docs/rules/.../styling.md` のようなパス)は語に割る前に落とす ——
 * パスの途中に `system` のような一般語が入っているだけで、アプリの語の使用ではない。
 *
 * @param text 散文 1 行
 * @param vocabulary 仕様が宣言した id の集合
 * @returns 一致した語(出現順・重複なし)
 */
export function matchProseWords(text: string, vocabulary: ReadonlySet<string>): readonly string[] {
  if (text.includes(EXAMPLE_MARK)) return [];
  return matchIgnoringExampleMark(text, vocabulary);
}

/**
 * 例示の印を**無視して**照合する(印で免除した行を数えるための口)。
 *
 * @param text 散文 1 行
 * @param vocabulary 仕様が宣言した id の集合
 * @returns 一致した仕様の語(出現順・重複なし)
 */
export function matchIgnoringExampleMark(text: string, vocabulary: ReadonlySet<string>): readonly string[] {
  // 抜粋の印(`#region example:…` / `#endregion`)は散文ではなく**機械の目印**であり、その名前は
  // ハンドブックが引く仕様の id である(code-examples.md)。散文として読むと、印の名前そのものが
  // 漏れに見える(実測: `#region example:notification-handler-row`)。
  if (REGION_MARK.test(text)) return [];
  const found: string[] = [];
  for (const raw of text.split(TOKEN_SPLIT)) {
    if (raw.includes('.md')) continue;
    for (const candidate of proseCandidates(raw.replace(TRIM_MARKS, ''))) {
      if (candidate.length < MIN_LENGTH || !vocabulary.has(candidate)) continue;
      if (!found.includes(candidate)) found.push(candidate);
      break;
    }
  }
  return found;
}

/**
 * 1 トークンを、仕様の語と突き合わせる候補に開く。
 *
 * **全部の区切りで割る。** 束 ①-c-b のレビューが実測した取りこぼしは 3 つとも「割り方が足りない」
 * ことだった。
 *   - `facts?.entry.performerId` → 先頭(`facts?`)だけを見ていたので `entry` を逃した
 *   - `multiple_workshops` → `_` で割らないので、断片が仕様の語と一致しなかった
 *   - `誰がorganizerか` → 日本語に貼り付いた英字列を切り出さないので `organizer` を逃した
 *
 * @param token 区切りで割ったあとの 1 トークン
 * @returns 突き合わせる候補(長いものから。重複なし)
 */
function proseCandidates(token: string): readonly string[] {
  const parts = new Set<string>([token]);
  // **`/` で割るのはここ**(文書への参照は呼ぶ側が落としている)。割らないと
  // `href="/admin/members"` が 1 トークンのままで、表の名前(`members`)が見えない
  // (束 ①-c-c のレビューが実測した穴)。
  for (const segment of token.split('/')) {
    if (segment !== '') parts.add(segment);
  }
  for (const piece of token.split(MEMBER_SPLIT)) {
    if (piece === '') continue;
    parts.add(piece);
  }
  // **日本語に貼り付いているときだけ**切り出す。ASCII だけの語にも当てると、ハイフンでつないだ
  // 技術用語が仕様の語に化ける(実測: `eslint-disable` の `disable` が `membership.disable` と
  // 一致した)。狙いは「区切りの無い言語に埋まった英単語」であって、英語の複合語ではない。
  if (HAS_NON_ASCII.test(token)) {
    for (const ascii of token.match(ASCII_RUN) ?? []) parts.add(ascii);
  }
  return [...parts].sort((left, right) => right.length - left.length);
}

/** ファイルを読む。読めなければ空文字(走査は best-effort)。 */
function readText(absolute: string): string {
  try {
    return readFileSync(absolute, 'utf8');
  } catch {
    return '';
  }
}

/** 1 ファイルを走査してヒットを集める。 */
function scanFile(
  repoRoot: string,
  absolute: string,
  vocabulary: ReadonlySet<string>,
  hits: VocabularyProseHit[],
  exempted: string[],
): void {
  const relativePath = toRelative(repoRoot, absolute);
  if (isExcludedPath(relativePath)) return;
  const source = readText(absolute);
  if (source.includes(GENERATED_MARKER)) return;
  const lines = source.split('\n');
  for (const line of commentLines(source)) {
    const text = lines[line - 1] ?? '';
    // 印で免除した行を**数える**。台帳は持たないが、件数が見えていれば「静かに増える」が起きない
    // (束 ①-c-c のレビュー記録 D: `例:` は行を丸ごと免除する第 3 の口である)。
    if (text.includes(EXAMPLE_MARK)) {
      if (matchIgnoringExampleMark(text, vocabulary).length > 0) exempted.push(relativePath);
      continue;
    }
    for (const word of matchProseWords(text, vocabulary)) {
      hits.push({ file: relativePath, line, word, text: text.trim() });
    }
  }
}

/**
 * アプリ側の仕組みの層の散文を走査し、仕様の語と一致する語を集める。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param vocabulary 仕様が宣言した id の集合
 * @param roots 製品が宣言した根(走査範囲の位置)
 * @param layout 置き場の配置(走査範囲の層と土台の表の宣言元)
 * @returns ヒットの一覧と、`例:` の印で免除した行数(対象ディレクトリが無ければ空)
 */
export function scanVocabularyProse(
  repoRoot: string,
  vocabulary: ReadonlySet<string>,
  roots: ProductRoots,
  layout: ProductLayout,
): { readonly hits: readonly VocabularyProseHit[]; readonly exemptedLines: number } {
  const hits: VocabularyProseHit[] = [];
  const exempted: string[] = [];
  for (const { dir, extensions } of vocabularyScanRoots(roots, layout)) {
    // 体系側(検証器・生成器と約束事のモデル)の散文は**自分を説明する文**であり、対象外
    // (冒頭の doc コメント)。判定を「`docs/` で始まるか」ではなく仕組み自身の住所との一致に
    // したのは、製品が仕様の木を `docs/` の下に置くかどうかと無関係な線だからである。
    if (dir === FRAMEWORK_LIB_DIR || dir === FORMAL_DIR) continue;
    const absoluteRoot = join(repoRoot, dir);
    if (!isDirectory(absoluteRoot)) continue;
    for (const absolute of walkRepoFiles(repoRoot, dir, (name) => isScannedFile(name, extensions))) {
      scanFile(repoRoot, absolute, vocabulary, hits, exempted);
    }
  }
  const walker = walkerDir(roots, layout);
  if (walker !== null) {
    const walkerRoot = join(repoRoot, walker);
    for (const entry of listEntries(walkerRoot)) {
      if (!WALKER_FILE.test(entry) || entry.endsWith('.test.mts')) continue;
      scanFile(repoRoot, join(walkerRoot, entry), vocabulary, hits, exempted);
    }
  }
  return { hits, exemptedLines: exempted.length };
}

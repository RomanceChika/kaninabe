/**
 * 文書の本文を「行」と「語の境界を見る照合」に割る純粋関数(用語の台帳の M7〜M9 が使う)。
 *
 * W2(散文の語彙漏れ。`generality/prose-scan.ts`)と同じ骨 —— 行を集める → 照合する →
 * 例示の印(`例:`)のある行を外す —— を、**コメントではなく Markdown の本文**に当てたものである。
 * 違うのは 2 点だけ: ①走る対象がフロントマターと HTML コメントを除いた全行であること
 * (見出し・表・コードフェンスも含む。規約の表は散文そのものなので、落とすと検査の半分が抜ける)、
 * ②照合が**語の境界**を見ること(日本語には空白の区切りが無く、部分一致だと `閉世界` の中の
 * `世界` や `画面` の中の `面` が旧綴りの使用に化ける)。
 */

import { commentSegments } from '../generality/prose-scan.js';
import type { ProseLine } from '../model/terms/types.js';

/** フロントマターの区切り行。 */
const FRONTMATTER_FENCE = /^---\s*$/;

/** 例示であることの印。この行は M9 の走査から外れる(旧綴りを**説明するために**挙げている行)。 */
export const EXAMPLE_MARKS: readonly string[] = ['例:', '例：'];

/** 生成ブロックの始まり(`<!-- AUTO-GENERATED:{名前} -->`)と終わり(`<!-- /AUTO-GENERATED:{名前} -->`)。 */
const GENERATED_BLOCK_OPEN = /^<!--\s*AUTO-GENERATED:/;
const GENERATED_BLOCK_CLOSE = /^<!--\s*\/AUTO-GENERATED:/;

/** `proseLines` の設定。 */
export interface ProseLinesOptions {
  /**
   * 生成ブロック(`AUTO-GENERATED:` の開きから閉じまで)の中の行を落とす。
   *
   * 仕様の本文の図・表は生成物であり、手で書いた散文ではない(綴りの正は生成器と仕様の frontmatter に
   * あるので、そちらを直す)。**ブックは全体が生成物**だが、読者が読む文そのものなので落とさない。
   */
  readonly skipGeneratedBlocks?: boolean;
}

/**
 * 文書の生テキストから本文の行を取り出す。
 *
 * フロントマターと HTML コメントの行(`<!--` で始まる行と、複数行コメントの中身)は落とす。
 * 行番号は元のファイルのもの(1 始まり)なので、落とした行があっても場所がずれない。
 * 閉じ `---` の無い壊れた入力は全行を本文として扱う(`prose.ts` の `bodyLines` と同じ)。
 *
 * @param source ファイルの生テキスト
 * @param options 生成ブロックを落とすか
 * @returns 本文の行(出現順)
 */
export function proseLines(source: string, options: ProseLinesOptions = {}): ProseLine[] {
  const all = source.split(/\r?\n/);
  let start = 0;
  if (all[0] !== undefined && FRONTMATTER_FENCE.test(all[0])) {
    const close = all.findIndex((line, index) => index > 0 && FRONTMATTER_FENCE.test(line));
    if (close !== -1) start = close + 1;
  }
  const lines: ProseLine[] = [];
  let inComment = false;
  let inGenerated = false;
  for (let index = start; index < all.length; index += 1) {
    const text = all[index] ?? '';
    if (inComment) {
      if (text.includes('-->')) inComment = false;
      continue;
    }
    const trimmed = text.trimStart();
    if (options.skipGeneratedBlocks === true) {
      if (GENERATED_BLOCK_OPEN.test(trimmed)) inGenerated = true;
      else if (GENERATED_BLOCK_CLOSE.test(trimmed)) inGenerated = false;
    }
    if (trimmed.startsWith('<!--')) {
      if (!trimmed.includes('-->')) inComment = true;
      continue;
    }
    if (inGenerated) continue;
    lines.push(proseLine(index + 1, text));
  }
  return lines;
}

/** 本文の 1 行(`例:` の印を見る)。 */
function proseLine(line: number, text: string): ProseLine {
  return { line, text, example: EXAMPLE_MARKS.some((mark) => text.includes(mark)) };
}

/**
 * ソースのコメントから、本文の行を取り出す(用語の台帳の M9 が、コードのコメントを散文として読むための口)。
 *
 * コメントの切り出しは W2(散文の語彙漏れ)と**同じ走査器**が持つ(`commentSegments`)。コードの部分
 * (文字列・識別子)は見ない —— 文字列の中の旧綴りは、コメントとは別の道(人向け文言の書き換え)で直す。
 *
 * @param source ソース全文
 * @returns コメントを含む行(行番号は元のファイルのもの。コメントの部分だけを `text` に持つ)
 */
export function commentProseLines(source: string): ProseLine[] {
  return commentSegments(source).map(({ line, text }) => proseLine(line, text));
}

/** 引用ブロックの行(Markdown の `> ` で始まる行)。 */
const QUOTE_BLOCK = /^\s*>(\s|$)/;

/**
 * 引用ブロックの行か(Markdown の `> ` で始まる行)。
 *
 * **引用(人の発言・検査の出力の写し)は置換しない。** 引用は原文のまま残す記録であり、旧い綴りが
 * 出てくるのは引用元がそう言ったからである(M9 は読まない)。
 *
 * @param text 1 行の本文
 * @returns 引用ブロックの行なら true
 */
export function isQuoteBlockLine(text: string): boolean {
  return QUOTE_BLOCK.test(text);
}

/**
 * 行からかぎ括弧「」の中身を落とす(M9 が引用を読まないための口)。括弧そのものは残す。
 *
 * 入れ子は外側の括弧ごとに 1 つの引用として落とす。**同じ行で閉じていない「は引用として扱わない**
 * (閉じ括弧を書き忘れた行で、行の残りを黙って読まなくなるのを避けるため)。
 *
 * @param text 1 行の本文
 * @returns かぎ括弧の中身を落とした行
 */
export function withoutQuotes(text: string): string {
  let result = '';
  let depth = 0;
  let openedAt = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '「') {
      if (depth === 0) {
        openedAt = index;
        result += char;
      }
      depth += 1;
    } else if (char === '」' && depth > 0) {
      depth -= 1;
      if (depth === 0) result += char;
    } else if (depth === 0) {
      result += char;
    }
  }
  return depth === 0 ? result : result.slice(0, result.length - 1) + text.slice(openedAt);
}

/** 文字の種類(語の境界の判定に使う)。`other` は区切り(空白・約物・中黒・記号)。 */
type Script = 'kanji' | 'katakana' | 'hiragana' | 'ascii' | 'other';

/** 漢字 1 文字(々・〆を含む)。 */
const KANJI = /[㐀-䶿一-鿿豈-﫿々〆]/u;

/** 1 文字の種類。 */
function scriptOf(char: string): Script {
  if (KANJI.test(char)) return 'kanji';
  if (/[ァ-ヺー-ヿ]/u.test(char)) return 'katakana';
  if (/[ぁ-ゟ]/u.test(char)) return 'hiragana';
  if (/[A-Za-z0-9_]/.test(char)) return 'ascii';
  return 'other';
}

/** 識別子・ファイル名・パスをつなぐ記号(`data-table-parity` / `policy.test.ts` / `lib/parity`)。 */
const IDENTIFIER_JOINERS = new Set(['-', '.', '/']);

/**
 * 隣の文字が、綴りの端の文字と同じ種類の連なりに入っているか(= 語の途中か)。
 *
 * **英字の端に限り**、`-` `.` `/` の向こうにもう 1 つ英数字が続くなら識別子の一部として扱う
 * (例: `data-table-parity` の `parity`)。日本語の端には当てない。スラッシュで並べた列挙
 * (例: `ステップ/手順`)や、文末の `.` の隣の綴りを見逃さないためである。
 * (例: `突合/parity` や文末の `parity.` は識別子ではない)
 *
 * @param text 1 行の本文
 * @param at 隣の文字の位置(綴りの前なら出現位置 - 1・後なら出現の直後)
 * @param step 綴りから遠ざかる向き(前へ -1・後ろへ +1)
 * @param edge 綴りの端の文字
 */
function continuesWord(text: string, at: number, step: -1 | 1, edge: string | undefined): boolean {
  const neighbor = text[at];
  if (neighbor === undefined || edge === undefined) return false;
  const kind = scriptOf(edge);
  if (kind === 'other') return false;
  if (scriptOf(neighbor) === kind) return true;
  if (kind !== 'ascii' || !IDENTIFIER_JOINERS.has(neighbor)) return false;
  const beyond = text[at + step];
  return beyond !== undefined && scriptOf(beyond) === 'ascii';
}

/** 綴りが ASCII だけ(大文字小文字を畳んで探す綴り)。 */
const ASCII_SPELLING = /^[\u0020-\u007e]+$/;

/** ASCII の大文字だけを小文字にする(文字数を変えない。`toLowerCase` は一部の文字で長さが変わる)。 */
function lowerAscii(text: string): string {
  return text.replace(/[A-Z]/g, (char) => char.toLowerCase());
}

/**
 * 綴りが現れる位置を返す。**語の途中に埋まっているものは数えない。**
 *
 * 規則は「前後の隣の文字が、綴りの端の文字と同じ種類(漢字・カタカナ・ひらがな・英数字)なら
 * 語の途中」である。`世界` は `閉世界` の中では数えず、`RLS の世界を作る` では数える。`面` は
 * `画面` / `場面` の中では数えない。端の文字の種類だけを見るので、漢字が隣にあっても綴りの
 * 端がカタカナなら数える(例: `全ゲート緑` の `ゲート`)。
 *
 * **例外が 1 つある。漢字を含み、ひらがなで終わる綴り(活用する語)は、後ろに続くひらがなを語の途中にしない。**
 * (例: `降りる` は `降りるのは` の `の` で切らず、`降ろし` は `降ろして` の `て` で切らない) 送り仮名の後ろの仮名は助詞か活用語尾で、
 * そこで切れなければ活用する語の旧綴りを 1 つも捕れないからである(前の隣の文字は同じ規則のまま)。
 *
 * 取りこぼす形もある(`世界作り` のように漢字が続く複合語)。**取りこぼしの側に倒してある** ——
 * 逆に倒すと `閉世界` のような別の語が旧綴りの使用に化けるからである。
 *
 * **捕る形・捕らない形・誤って捕る形(実測。ブック ①-d)。**
 *   - 捕る(例: `テストの固定物を置く` / `固定物ファイル` / `3ステップ` / `全ゲート緑` / `2 段階で` / `parity テスト` / `Parity テスト` / `PARITY`)
 *   - 捕らない・取りこぼし(例: 漢字が続く `半固定物` `旧固定物` `固定物作り`・カタカナが続く `ステップバイステップ`・ハイフンでつながる `parity-check`(検査 ID と同じ形なので見分けない)。どれも現存 0 件)
 *   - 捕らない・意図どおり(例: `ワンステップ` `ゲートウェイ` `段階的` `設計段階` `名札` `data-table-parity` `expectDdlParity`)
 *   - 誤って捕る(例: 一般語そのものを avoid に載せたとき。`世界` なら `世界で最も`・`面` なら `面する`・`行列` なら `待ち行列`)。
 *     だから台帳は一般語を avoid に載せず、旧綴りだけを指す複合語(例: `世界の設計図` `外から届く面`)にする
 *   - 活用する旧綴り(例: ブック ①-e の `降りる` 系)は、活用語尾と助詞までを数える。
 *     - 捕る(例: `降りるとき` `降りてくる` `降ろせる` `降ろされる` `降ろした`)
 *     - 取りこぼす(例: `降りられる` `降りれば` `降りず` `降り、` `降りよう` `降ろそう` `降り方` `降りきる`。台帳の綴りに語頭が合わない形で、現存 0 件)
 *     - 誤って捕る(例: 本物の動作の `階段を降りる` `バスを降りて` `積み降ろし`。現存 0 件。出たら `例:` の印で逃がす)
 *   - 失敗する意味の `倒れる` と `倒す`(ブック ①-l。例: 台帳の `倒れ` は 1 つで活用語尾まで数える)。`倒す` は単体では載せず、助詞つきの形だけを載せる
 *     (「安全側に倒す」のように決まった側へ寄せる一般の慣用と、同じ字で見分けられないため)。
 *     - 捕る(例: `倒れる` `倒れた` `倒れて` `倒れ方` `S2 が倒す` `Y8 が反例つきで倒す` `ここで倒す` `空なら倒す` `検査も倒せず` `関門の倒し方`)
 *     - 取りこぼす(例: `なければ倒す` `として倒す` `書けず倒す` `未定義は倒す` の一部。助詞の前がひらがなだと、助詞を語の途中と数えるため。台帳の綴りは漢字で始められない)
 *     - 捕らない・意図どおり(例: `安全側に倒す` `既定値に倒す` `空に倒す` `HEAD~1 に倒し` `過検出には倒さない`。「倒す」単体は台帳に載せない)
 *     - 実測(言い直す前の、`倒` を含む 527 行): 慣用の `に倒す` 系 158 行を誤って捕った行は 0。失敗する意味の 314 行のうち 192 行を捕り、
 *       取りこぼした行は言い直しの置換で直した。慣用の `に倒れる` 55 行は `倒れ` が捕るので、言い直した(例: `安全側に寄る`)
 *
 * @param text 1 行の本文
 * @param spelling 探す綴り
 * @returns 見つかった位置(先頭からの文字数。重ならない出現だけ)
 */
export function findSpelling(text: string, spelling: string): number[] {
  if (spelling === '') return [];
  const first = spelling[0];
  const last = spelling[spelling.length - 1];
  // 活用する語(漢字 + 送り仮名)は、送り仮名の後ろに続く仮名(助詞・活用語尾)を語の途中にしない。
  const inflects = scriptOf(last ?? '') === 'hiragana' && KANJI.test(spelling);
  // 英字の綴りは大文字小文字を区別しない(例: `Parity` / `PARITY`)。長さが変わらないよう ASCII の範囲だけを小文字にする。
  const fold = ASCII_SPELLING.test(spelling);
  const haystack = fold ? lowerAscii(text) : text;
  const needle = fold ? lowerAscii(spelling) : spelling;
  const hits: number[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return hits;
    from = at + spelling.length;
    const after = inflects ? undefined : last;
    if (continuesWord(text, at - 1, -1, first) || continuesWord(text, at + spelling.length, 1, after)) continue;
    hits.push(at);
  }
}

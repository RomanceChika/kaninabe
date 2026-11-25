/**
 * シェルと YAML の `#` コメントを、本文の行として取り出す純粋関数(用語の台帳の M9 が読むため)。
 *
 * git フックのスクリプト(シェル)と CI の設定(YAML)は、コミットのたびに画面に出る
 * 文言と、CI の設計の説明を**コメントに**持つ。TypeScript のコメント(`commentSegments`)だけを読むと、
 * この 2 種類が台帳の外に残る(ブック ①-d のレビューの実測: 旧綴り 26 行)。
 *
 * `#` がコメントの始まりになる条件は、シェルと YAML で共通の 1 つに絞る —— **行頭か空白の直後にあり、
 * 引用符の外で、ヒアドキュメントの本文の外にあること**。
 *   - `"a # b"` / `'a # b'`(文字列の中の `#` はコメントではない。引用符は行をまたいで持つ)
 *   - `$#` / `${#x}` / `foo#bar`(空白の直後でない `#`。シェルの特殊変数・YAML のプレーンな値)
 *   - `cat <<EOF` … `EOF`(ヒアドキュメントの本文の `#` は、コメントではなく**データ**)
 *   - `don't`(英単語の途中の `'` は引用符を開かない)
 *
 * YAML の `run: |` のブロックの中身はシェルのスクリプトであり、その中の `#` コメントも本物のコメントである
 * (`ci.yml` の説明の大半はここにある)ので、YAML とシェルを同じ規則で読む。
 */

import { EXAMPLE_MARKS } from './prose.js';
import type { ProseLine } from '../model/terms/types.js';

/** ヒアドキュメントの開始(`<<EOF` / `<<-EOF` / `<<'EOF'` / `<<"EOF"`)。`<<` の直後から読む。 */
const HEREDOC_WORD = /-?[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/y;

/** 英数字か(英単語の途中の `'` を見分ける)。 */
function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9]/.test(char);
}

/** 1 行の走査結果。 */
interface LineScan {
  /** コメントの始まりの位置(無ければ -1)。 */
  readonly commentAt: number;
  /** 行の終わりで開いたままの引用符。 */
  readonly quote: '"' | "'" | null;
  /** この行で始まったヒアドキュメントの終わりの語。 */
  readonly heredoc: string | null;
}

/** 1 行を読む。引用符の状態は行をまたいで受け渡す。 */
function scanLine(line: string, startQuote: '"' | "'" | null): LineScan {
  let quote = startQuote;
  let heredoc: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? '';
    if (quote !== null) {
      if (char === '\\' && quote === '"') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '\\') {
      index += 1;
    } else if (char === '"' || (char === "'" && !isWordChar(line[index - 1]))) {
      quote = char;
    } else if (char === '#' && (index === 0 || /\s/.test(line[index - 1] ?? ''))) {
      return { commentAt: index, quote, heredoc };
    } else if (char === '<' && line[index + 1] === '<' && line[index + 2] !== '<' && line[index - 1] !== '<') {
      HEREDOC_WORD.lastIndex = index + 2;
      const word = HEREDOC_WORD.exec(line)?.[2];
      if (word !== undefined) heredoc = word;
      index += 1;
    }
  }
  return { commentAt: -1, quote, heredoc };
}

/**
 * シェルと YAML のソースから、`#` コメントを行ごとに取り出す。
 *
 * @param source ファイル全文
 * @returns コメントを含む行(行番号は元のファイルのもの。`text` は `#` から行末まで)
 */
export function hashCommentProseLines(source: string): ProseLine[] {
  const comments: ProseLine[] = [];
  let quote: '"' | "'" | null = null;
  let heredoc: string | null = null;
  source.split(/\r?\n/).forEach((line, index) => {
    if (heredoc !== null) {
      if (line.trim() === heredoc) heredoc = null;
      return;
    }
    const scan = scanLine(line, quote);
    quote = scan.quote;
    heredoc = scan.heredoc;
    if (scan.commentAt === -1) return;
    const text = line.slice(scan.commentAt);
    comments.push({ line: index + 1, text, example: EXAMPLE_MARKS.some((mark) => text.includes(mark)) });
  });
  return comments;
}

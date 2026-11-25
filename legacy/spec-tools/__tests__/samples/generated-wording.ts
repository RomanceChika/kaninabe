/**
 * サンプルシステムの**生成コード**に出る日本語が、2 つの出どころだけで説明できることの走査。
 *
 * 出どころは 2 つしか無い。
 *   1. **サンプルの仕様**(`label` / `statement` / `summary` …)—— 題材ごとに変わる語
 *   2. **文言表**(`legacy/spec-tools/lib/messages/messages.ts`)—— どのアプリでも同じ仕組みの文
 *
 * どちらでも説明できない日本語が生成物に出ていたら、それは**生成器のどこかに直接書かれた
 * 文言**である(検査の漏れ探し 2026-09-12 §6 が `code-operation-inputs.ts` の
 * 「更新するフィールドを 1 つ以上指定してください」を実測した)。散らばった文言は、
 * 別の言語のアプリを作るときに「何を訳せばよいか」が誰にも分からない状態になる。
 *
 * `host-vocabulary.ts` が「**ホストの語**が出ていないか」を見るのに対し、ここは
 * 「**表に無い日本語**が出ていないか」を見る —— 同じ出力側の目の、別の軸である。
 *
 * 対象は**生成コード**(`.ts` / `.tsx`)の文字列リテラルだけである。doc コメントは出力の
 * 意味を変えず、散文の性質上どうしても日本語が入る(生成物の説明文である)。
 */

import { messageFragments } from '../../lib/generate/message-fragments.js';
import { TEST_LAYOUT } from '../helpers/platform.js';

/** 日本語(ひらがな・カタカナ・漢字・長音・踊り字)。 */
const JAPANESE_RUN = /[぀-ヿ一-鿿々ー]+/g;

/** 文字列・テンプレートリテラル(クォート込み)。 */
const STRING_LITERAL = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

/** ブロックコメント・行コメント(生成物の説明文は対象外)。 */
const COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

/** 説明できなかった日本語 1 件。 */
export interface UnexplainedWording {
  /** 生成物のパス(リポジトリルート相対)。 */
  readonly file: string;
  /** 説明できなかった日本語の連なり。 */
  readonly text: string;
  /** それが出ていた文字列リテラルの全体(手がかり)。 */
  readonly literal: string;
}

/** コメントを空白に潰す。 */
function stripComments(source: string): string {
  return source.replace(COMMENT, (match) => match.replace(/[^\n]/g, ' '));
}

/**
 * 1 つのリテラルから、仕様にも文言表にも無い日本語の連なりを取り出す。
 *
 * @param literal 文字列リテラルの中身
 * @param fragments 文言表の断片
 * @param specText サンプルの仕様の生テキスト(全ファイルの連結)
 * @returns 説明できなかった連なり(空なら健全)
 */
export function unexplainedRuns(
  literal: string,
  fragments: readonly string[],
  specText: string,
): readonly string[] {
  let rest = literal;
  for (const fragment of fragments) {
    if (fragment !== '' && rest.includes(fragment)) rest = rest.split(fragment).join('\u0000');
  }
  return [...(rest.match(JAPANESE_RUN) ?? [])].filter((run) => !specText.includes(run));
}

/**
 * 生成コードを走査して、説明できない日本語を返す。
 *
 * @param args 生成物(パス → 内容)とサンプルの仕様の生テキスト
 * @returns 説明できなかった箇所(空なら健全)
 */
export function findUnexplainedWording(args: {
  readonly generatedFiles: ReadonlyMap<string, string>;
  readonly specText: string;
}): readonly UnexplainedWording[] {
  const fragments = [...messageFragments(TEST_LAYOUT)].sort((a, b) => b.length - a.length);
  const found: UnexplainedWording[] = [];
  for (const [file, content] of args.generatedFiles) {
    if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
    const code = stripComments(content);
    for (const match of code.matchAll(STRING_LITERAL)) {
      const literal = match[0].slice(1, -1);
      for (const run of unexplainedRuns(literal, fragments, args.specText)) {
        found.push({ file, text: run, literal });
      }
    }
  }
  return found;
}

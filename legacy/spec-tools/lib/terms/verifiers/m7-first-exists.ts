/**
 * M7: 台帳の各行の `first`(初出)に、その語が実在すること。
 *
 * 台帳の `first` は「この語を導入している文書」であり、語の定義を辿るときの入口である。
 * 文書が消えた・改名された・語を別の綴りに直した —— のどれが起きても初出は黙って腐るので、
 * 機械で見る。**error** である(安くて確実。1 行ごとに直す先が 1 つに決まる)。
 *
 * 見るのは 3 つ: ①`first` の文書が読めること、②その文書に語の綴り(`term`)が書かれていること、
 * ③**英語のまま使う語(`origin: english`)は、初出の行か直後の行に印つきの 1 行説明があること**。
 * 走査範囲の外のファイルも `first` に書ける(ブックの生成文が初出の語は生成器のテンプレートではなく
 * ブック自身を指す)ので、照合の相手は `corpus.firstTexts` であって本文の走査結果ではない。
 *
 * ③の印は `<!-- term: {id} -->`(コード例の印 `#region example:{name}` と同じ流儀の「行に埋める目印」)で、
 * **説明と同じ行**に書く。語が初めて出る行か、その次の空でない行までに置くことで「初出の近くにある」を
 * 機械で見る(説明の中身が台帳の語釈と同じ意味かまでは機械では見られない —— そこはレビューの領分)。
 */

import { makeFinding, type Finding } from '../../kernel/finding.js';
import type { TermCorpus, TermDecl, TermLedgerSpec } from '../../model/terms/types.js';

export const VERIFIER_ID = 'M7';

/** 初出の 1 行説明の印(`id` は台帳の id)。 */
function explanationMark(id: string): string {
  return `<!-- term: ${id} -->`;
}

/** 次の空でない行の添字(無ければ与えた添字のまま)。 */
function nextNonBlank(lines: readonly string[], from: number): number {
  for (let index = from + 1; index < lines.length; index += 1) {
    if ((lines[index] ?? '').trim() !== '') return index;
  }
  return from;
}

/**
 * 1 語の初出を検査する。
 *
 * @param decl 台帳の 1 行
 * @param corpus 走査入力(`first` の生テキストを引く)
 * @returns 違反(無ければ空)
 */
function checkFirst(decl: TermDecl, corpus: TermCorpus): Finding[] {
  const pointer = decl.location.pointer === undefined ? 'first' : `${decl.location.pointer}.first`;
  const location = { file: decl.location.file, pointer };
  const text = corpus.firstTexts.get(decl.first) ?? null;
  if (text === null) {
    return [
      makeFinding(VERIFIER_ID, {
        message: `語「${decl.term}」の初出の文書が実在しません: ${decl.first}`,
        location,
        suggestion:
          '文書を移した・改名したなら first を新しいパスに直す。語を導入している文書が無くなったなら、語を別の文書で導入してからその文書を first に書く',
        counterexample: { term: decl.term, first: decl.first },
      }),
    ];
  }
  if (text.includes(decl.term)) return decl.origin === 'english' ? checkExplanation(decl, text, location) : [];
  return [
    makeFinding(VERIFIER_ID, {
      message: `語「${decl.term}」の初出の文書に語が書かれていません: ${decl.first}`,
      location,
      suggestion:
        '語を実際に導入している文書を first に書く。語の綴りを文書側で変えたなら、台帳の term と avoid を合わせ直す(旧い綴りを台帳が知らないまま残さない)',
      counterexample: { term: decl.term, first: decl.first },
    }),
  ];
}

/**
 * 英語のまま使う語の初出に、印つきの 1 行説明があるかを見る。
 *
 * @param decl 台帳の 1 行(`origin: english`)
 * @param text 初出の文書の生テキスト(語は書かれていることが分かっている)
 * @param location 指摘の位置(`first` の欄)
 * @returns 違反(無ければ空)
 */
function checkExplanation(decl: TermDecl, text: string, location: { file: string; pointer: string }): Finding[] {
  const mark = explanationMark(decl.id);
  const lines = text.split('\n');
  const markIndex = lines.findIndex((line) => line.includes(mark));
  const fail = (message: string, suggestion: string): Finding[] => [
    makeFinding(VERIFIER_ID, { message, location, suggestion, counterexample: { term: decl.term, first: decl.first } }),
  ];
  if (markIndex < 0) {
    return fail(
      `語「${decl.term}」(英語のまま使う語)の初出の 1 行説明がありません(${mark}): ${decl.first}`,
      `初出の文書の、語が初めて出る行か直後の行に、語の意味を 1 行で書いて行末に ${mark} を付ける`,
    );
  }
  if (!(lines[markIndex] ?? '').replace(mark, '').includes(decl.term)) {
    return fail(
      `語「${decl.term}」の印の行に語が書かれていません: ${decl.first}(${markIndex + 1} 行目)`,
      '説明は印と同じ行に書き、その行に語の綴りを含める(説明と印が離れると片方だけが残って腐る)',
    );
  }
  const firstIndex = lines.findIndex((line) => line.replace(mark, '').includes(decl.term));
  if (markIndex > nextNonBlank(lines, firstIndex)) {
    return fail(
      `語「${decl.term}」の 1 行説明が初出より後にあります: ${decl.first}(初出 ${firstIndex + 1} 行目・印 ${markIndex + 1} 行目)`,
      '説明を語が初めて出る行か直後の行へ移す(読者は初出で意味を知る)',
    );
  }
  return [];
}

/**
 * 台帳の全行の初出を検査する。
 *
 * @param ledger 読み込み済みの台帳
 * @param corpus 走査入力
 * @returns M7 の違反(error)
 */
export function verifyFirstExists(ledger: TermLedgerSpec, corpus: TermCorpus): Finding[] {
  return ledger.terms.flatMap((decl) => checkFirst(decl, corpus));
}

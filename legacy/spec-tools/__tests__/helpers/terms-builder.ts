/**
 * 用語の台帳(term_ledger)テスト用の最小ビルダー。
 *
 * 規約(scripts-code-quality.md)により検証器のテストはファイル I/O を行わず、
 * モデルをテスト内でリテラル構築する。ここではその定型部分(location・既定値)を引き受ける。
 */

import type { HumanSentence, ProseFile, TermCorpus, TermDecl, TermLedgerSpec } from '../../lib/model/terms/types.js';
import { proseLines } from '../../lib/terms/prose.js';
import { loc } from './model-builder.js';

/** 台帳の仕様ファイル(location に使う)。 */
export const LEDGER_FILE = 'docs/specs/terms.md';

/** 台帳の 1 行を作る。既定は「framework・借用・avoid なし」。 */
export function term(word: string, opts: Partial<Omit<TermDecl, 'term' | 'location'>> = {}): TermDecl {
  const id = opts.id ?? `id_${word.length}_${word.charCodeAt(0)}`;
  return {
    term: word,
    id,
    gloss: opts.gloss ?? `${word} の語釈`,
    origin: opts.origin ?? 'borrowed',
    first: opts.first ?? 'docs/rules/first.md',
    face: opts.face ?? 'framework',
    avoid: opts.avoid ?? [],
    not: opts.not ?? null,
    location: loc(LEDGER_FILE, `terms.${id}`),
  };
}

/** 台帳 1 枚を作る。 */
export function ledger(terms: readonly TermDecl[]): TermLedgerSpec {
  return { id: 'term-ledger', terms, location: loc(LEDGER_FILE) };
}

/** 文書 1 枚の本文(生テキスト)から走査対象の行を作る。 */
export function proseFile(file: string, source: string): ProseFile {
  return { file, lines: proseLines(source) };
}

/** 走査入力を作る。`firstTexts` を省略すると、台帳の `first` は実在しない扱い(空)になる。 */
export function corpus(
  files: readonly ProseFile[],
  firstTexts: Readonly<Record<string, string | null>> = {},
  summaries: readonly HumanSentence[] = [],
  specText = '',
): TermCorpus {
  return { files, firstTexts: new Map(Object.entries(firstTexts)), summaries, specText };
}

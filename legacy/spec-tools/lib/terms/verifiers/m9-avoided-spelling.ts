/**
 * M9: 台帳が `avoid`(使わない綴り)に挙げた綴りが、本文に出ていないこと = 旧綴りの再発を止める。
 *
 * **台帳でいちばん効く 1 本**である。台帳の仕事は別名を許すことではなく**禁じること**で、
 * 1 つの概念に 2 つの綴りができると grep が効かなくなり、AI への指示がぶれる。`avoid` に載せた
 * 綴りが書かれたら、その場所と直し先の語を名指す。
 *
 * W2(散文の語彙漏れ)の骨をそのまま写している —— 行を走査 → 語の集合と照合 → 例示の印
 * (`例:`)のある行を外す → **warning** → **ファイル 1 件につき 1 件**にまとめる(直すときは
 * 1 ファイルの本文をまとめて見直すのであって、行ごとに直すものではない)。消し込みの道も
 * W2 と同じ 2 つで、旧綴りを**説明するために**挙げているなら行に `例:` を書く・本文を台帳の語に
 * 書き換える。**免除の一覧は持たない**(PRIN-0006)。
 *
 * 照合は語の境界を見る(`findSpelling`)。`世界` を禁じても `閉世界` は旧綴りの使用ではない。
 * 英字の綴り(例: `parity`)は、`-` `.` `/` でもう 1 つの英数字の連なりにつながるなら識別子
 * (`data-table-parity` など)として数えない。捕る形・捕らない形・誤って捕る形の実測は `findSpelling` の JSDoc。
 *
 * **引用は読まない。** `> ` で始まる引用ブロックの行と、かぎ括弧「」の中は走査から外す
 * (人の発言や検査の出力の写しは、旧い綴りでも原文のまま残す記録であり、書き換えない)。
 *
 * **範囲**は `terms/scope.ts` が宣言する —— Markdown の本文(規約・設計メモ・ブック・スキル・仕様・案内)と
 * コードのコメント・日本語を含む文字列リテラル・シェルと YAML の `#` コメント。生成物・適用済み migration・
 * 歴史の記録などは範囲外(理由つきで宣言)。
 */

import { makeFinding, type Finding } from '../../kernel/finding.js';
import { findSpelling, isQuoteBlockLine, withoutQuotes } from '../prose.js';
import type { ProseFile, TermCorpus, TermLedgerSpec } from '../../model/terms/types.js';

export const VERIFIER_ID = 'M9';

/** 反例に載せる場所の数の上限(1 ファイルに大量にあるとき、出力が膨らみすぎないように)。 */
const MAX_LOCATIONS = 8;

/** 禁じた綴り 1 つ。直し先になる語(複数ありうる)を持つ。 */
interface AvoidedSpelling {
  readonly spelling: string;
  /** その綴りを禁じている台帳の語(宣言順・重複なし)。 */
  readonly terms: readonly string[];
}

/** 台帳から禁じた綴りの一覧を作る。同じ綴りを禁じる語が複数あれば 1 件にまとめる。 */
function avoidedSpellings(ledger: TermLedgerSpec): AvoidedSpelling[] {
  const bySpelling = new Map<string, string[]>();
  for (const decl of ledger.terms) {
    for (const spelling of decl.avoid) {
      const owners = bySpelling.get(spelling) ?? [];
      if (!owners.includes(decl.term)) owners.push(decl.term);
      bySpelling.set(spelling, owners);
    }
  }
  return [...bySpelling].map(([spelling, terms]) => ({ spelling, terms }));
}

/** 1 か所の出現。 */
interface Occurrence {
  readonly line: number;
  readonly avoided: AvoidedSpelling;
}

/** 文書 1 枚の中の旧綴りの出現を集める(例示の行は外す)。 */
function occurrencesIn(file: ProseFile, avoided: readonly AvoidedSpelling[]): Occurrence[] {
  const found: Occurrence[] = [];
  for (const line of file.lines) {
    if (line.example || isQuoteBlockLine(line.text)) continue;
    // 引用(人の発言・検査の出力の写し)は原文のまま残す記録なので、かぎ括弧の中は読まない。
    const text = withoutQuotes(line.text);
    for (const entry of avoided) {
      for (const _hit of findSpelling(text, entry.spelling)) found.push({ line: line.line, avoided: entry });
    }
  }
  return found;
}

/** ファイル 1 件ぶんの warning を組み立てる。 */
function fileFinding(file: string, hits: readonly Occurrence[]): Finding {
  const first = hits[0];
  const spellings = [...new Set(hits.map((hit) => hit.avoided.spelling))];
  const fixes = [...new Set(hits.flatMap((hit) => hit.avoided.terms))];
  const places = hits.map((hit) => `${file}:${hit.line}`);
  const shown = places.length > MAX_LOCATIONS ? [...places.slice(0, MAX_LOCATIONS), `ほか ${places.length - MAX_LOCATIONS} か所`] : places;
  return makeFinding(VERIFIER_ID, {
    severity: 'warning',
    message:
      `${file} に台帳が使わないと決めた綴り(${spellings.join(' / ')})が ${hits.length} 箇所あります` +
      `(台帳の語: ${fixes.join(' / ')})`,
    location: first === undefined ? { file } : { file, pointer: `L${first.line}` },
    suggestion:
      '台帳の語に書き換える。旧い綴りを説明するために挙げているだけなら、その行に「例:」を書く(印のある行は対象外になる)。' +
      '台帳の avoid が広すぎるなら、台帳の側を直す(免除の一覧は持たない)',
    counterexample: {
      spellings: spellings.join(' / '),
      use: fixes.join(' / '),
      occurrences: String(hits.length),
      at: shown.join(', '),
    },
  });
}

/**
 * 走査範囲の本文から、台帳が禁じた綴りを探す。
 *
 * @param ledger 読み込み済みの台帳
 * @param corpus 走査入力
 * @returns M9 の違反(warning。ファイルごとに 1 件)
 */
export function verifyAvoidedSpellings(ledger: TermLedgerSpec, corpus: TermCorpus): Finding[] {
  const avoided = avoidedSpellings(ledger);
  if (avoided.length === 0) return [];
  return corpus.files.flatMap((file) => {
    const hits = occurrencesIn(file, avoided);
    return hits.length === 0 ? [] : [fileFinding(file.file, hits)];
  });
}

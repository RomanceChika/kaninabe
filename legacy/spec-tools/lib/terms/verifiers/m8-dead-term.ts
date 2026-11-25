/**
 * M8: 台帳の語が、走査範囲(規約・設計メモ・ブック・スキル・仕様・案内の本文と、コードのコメント)のどこにも出てこないこと = 死んだ行が無い。
 *
 * 台帳に載せた語が誰にも使われていなければ、台帳の行だけが残って腐る。**warning** である
 * (語を消した日に台帳の行も消す、が正しい直し方だが、語を使う文書をこれから書く日の
 * 一時的な状態を error にすると、台帳を先に書く流れ = 造語は載せてから使う、を妨げる)。
 *
 * 数えるのは**本文とコメントの全行**で、例示の印のある行も数える(旧綴りの説明でなく語そのものを
 * 説明している行は、語が生きている証拠である)。
 */

import { makeFinding, type Finding } from '../../kernel/finding.js';
import type { TermCorpus, TermLedgerSpec } from '../../model/terms/types.js';

export const VERIFIER_ID = 'M8';

/**
 * 台帳の語のうち、走査範囲のどの本文にも出てこないものを挙げる。
 *
 * @param ledger 読み込み済みの台帳
 * @param corpus 走査入力
 * @returns M8 の違反(warning。語ごとに 1 件)
 */
export function verifyDeadTerms(ledger: TermLedgerSpec, corpus: TermCorpus): Finding[] {
  const alive = (word: string): boolean =>
    corpus.files.some((file) => file.lines.some((line) => line.text.includes(word)));
  return ledger.terms
    .filter((decl) => !alive(decl.term))
    .map((decl) =>
      makeFinding(VERIFIER_ID, {
        severity: 'warning',
        message: `台帳の語「${decl.term}」が、走査範囲のどの本文・コメントにも出てきません(死んだ行)`,
        location: decl.location,
        suggestion:
          '語を使う文書がもう無いなら台帳の行を消す。これから書く文書のために先に載せたなら、その文書を書いた日に消し込まれる。綴りを文書側で変えたなら台帳の term を合わせる',
        counterexample: { term: decl.term, id: decl.id },
      }),
    );
}

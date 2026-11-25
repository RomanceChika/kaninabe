/**
 * 充足性を**判定できなかった**ときの文面(V9 / V10 で 1 か所)。
 *
 * 充足性を問うのは V9(guard / when / binding)と V10(行内制約)の 2 つであり、どちらも
 * 「判定できなかった式を黙って通すと、恒偽・恒真の見落としが緑のまま生き延びる」という同じ
 * 事情を持つ。文面を 2 か所に書くと、片方だけが直る —— 実際、束 ⑳-5c は V9 にだけ warning を
 * 足し、V10 は `unknown` を黙って通していた(⑳-5c-b のレビュー「直す 5」)。
 *
 * **`unknown` には 2 つの意味がある。**
 *
 * | どちらか | 何が起きたか | severity |
 * |---|---|---|
 * | 時間内に答えられなかった | 式が難しい(判定器は動いている) | warning |
 * | 判定器が壊れた | 起動できない・写像を拒まれた(= 写像のバグ) | **error** |
 *
 * 後者を前者と見分けのつかない形で出すと診断が丸ごと嘘になり、**判定器が 1 件も解けていない状態でも
 * `verify` が exit 0 で終わる**(warning 止まりのため)。だから分ける。区別の出どころは
 * `SatResult.failure`(既製品の判定器だけが立てる。lib/guard/z3.ts)である。
 */

import type { SatResult } from '../guard/ast.js';
import type { Finding } from '../kernel/finding.js';

/**
 * 何を判定できなかったかの言い換え(省略時は V9 / V10 の「充足性 / 時間内に答えていません」)。
 *
 * V21(有界到達性)も同じ表 —— 時間切れは warning・**判定器の故障は error** —— に乗るが、
 * 問うているものが違うので名詞と対処だけを差し替える。severity の出し分けを 2 か所に書くと
 * 片方だけが直るので、分けるのは文面だけである。
 */
export interface UndecidedTopic {
  /** 何を判定できなかったか(既定「充足性」)。 */
  readonly noun?: string;
  /** なぜ答えが無いか(既定「判定器が時間内に答えていません」)。 */
  readonly cause?: string;
  /** 時間内に答えられなかったときの対処(既定は恒偽・恒真の見落としの話)。 */
  readonly suggestion?: string;
  /** 反例に載せる欄の名前(既定 `satisfiability`)。 */
  readonly counterKey?: string;
}

/** 判定できなかったことを報告する Finding の中身(verifier / location は呼び側が付ける)。 */
export interface UndecidedText {
  readonly severity: Finding['severity'];
  readonly message: string;
  readonly suggestion: string;
  readonly counterexample: Record<string, string>;
}

/** 時間内に答えられなかったときの対処。 */
const TIMEOUT_SUGGESTION =
  '恒偽・恒真の見落としがありうるので、この式が成立する例と成立しない例を 1 つずつ手で確かめてください。' +
  '節を分けて短くすると判定できることがあります(判定器の時間の上限は lib/guard/z3.ts の DEFAULT_TIMEOUT_MS)';

/** 判定器が壊れているときの対処(仕様を直す話ではない)。 */
const FAILURE_SUGGESTION =
  'これは仕様の誤りではなく**判定器が動いていない**ことの報告です。' +
  'まず `npm ci` で z3-solver が入っているかを確かめ、入っているなら ' +
  'lib/guard/smt.ts の写像が出した SMT-LIB を判定器が拒んでいます(= 写像のバグ)。' +
  '式を書き換えて黙らせてはいけません —— 黙らせると、その式だけ判定されないまま緑になります';

/**
 * `unknown` を報告する Finding の中身を作る。
 *
 * @param subject 対象の名前(例: `entry.submit の guard "state == draft"`)
 * @param result 判定の結果(`failure` が立っていれば判定器の故障)
 * @param fixed 反例に必ず載せる欄(式そのものなど)
 * @returns severity・message・suggestion・counterexample
 */
export function undecidedText(
  subject: string,
  result: Pick<SatResult, 'failure'>,
  fixed: Readonly<Record<string, string>>,
  topic: UndecidedTopic = {},
): UndecidedText {
  const noun = topic.noun ?? '充足性';
  if (result.failure === undefined) {
    return {
      severity: 'warning',
      message: `${subject} は${noun}を判定できませんでした(${topic.cause ?? '判定器が時間内に答えていません'})`,
      suggestion: topic.suggestion ?? TIMEOUT_SUGGESTION,
      counterexample: { ...fixed, [topic.counterKey ?? 'satisfiability']: 'unknown' },
    };
  }
  return {
    severity: 'error',
    message: `${subject} の${noun}を判定できませんでした(判定器が壊れています: ${result.failure})`,
    suggestion: FAILURE_SUGGESTION,
    counterexample: { ...fixed, [topic.counterKey ?? 'satisfiability']: 'unknown', solver_failure: result.failure },
  };
}

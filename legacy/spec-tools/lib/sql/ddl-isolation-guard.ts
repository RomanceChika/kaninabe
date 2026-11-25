/**
 * 制約トリガの本文の先頭に置く**隔離の水準の拒否**(天井・末尾の番号・別の集約の等式・参照の欄が指す行を読む条件の相手の端が
 * 1 つの実装を共有する)。
 *
 * 取引の最初の snapshot は、同時に確定した行を見ない。repeatable read の取引は、数える・結合するといった検査を
 * **古い snapshot** で行うので、先に確定した行を見落として素通りする(行の lock や advisory lock で直列化しても、
 * lock の後に新しい snapshot を取らない限り直らない)。
 *
 * **serializable も断る**(点検 D25s-3)。以前は「衝突を PostgreSQL が検出する」として通していたが、SSI が衝突を検出するのは
 * **関わる取引の全部**が serializable のときだけである。serializable の催しの公開と read committed の枠の解放が交錯すると、
 * serializable の側は古い snapshot で読み、read committed の側は相手の未コミットを見ないので、両方がコミットして不変条件が
 * 破れた(実測)。隔離の水準を揃える運用に任せず、**read committed(PostgREST の既定。文ごとに新しい snapshot を取る)だけを支える**。
 *
 * 拒否の SQLSTATE は `invalid_transaction_state`(25000)。**トリガ名も不変条件 ID も載せない** —— 載せると、呼び出し側の
 * 写像(制約名・ID を本文から探す)が「不変条件の違反」と誤読する。環境の前提が破れているのであって、条件が破れたのではない。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { sqlLiteral } from './guard-to-sql.js';

/** 隔離の拒否の SQLSTATE。 */
export const ISOLATION_ERRCODE = 'invalid_transaction_state';

/** 支える唯一の隔離の水準(`current_setting('transaction_isolation')` の字面)。 */
export const SUPPORTED_ISOLATION = 'read committed';

/**
 * 門の 1 行目(生成物 `isolationGateHead` として製品の見張りへ写す。手書きの数える条件も同じ字面の門を置き、実 DB の全部のトリガ関数の
 * 閉世界で照らされる —— 製品の isolation-gate-parity。観察 O2-1)。
 */
export const ISOLATION_GATE_HEAD = `if current_setting('transaction_isolation') <> ${sqlLiteral(SUPPORTED_ISOLATION)} then`;

/**
 * 本文の先頭に置く、read committed 以外の拒否(`if … end if;` の行)。
 *
 * @param message 拒否の文面(トリガ名・不変条件 ID を含めない)
 * @returns SQL の行(相対のインデント)
 */
export function isolationGuardLines(message: string): readonly string[] {
  return [
    ISOLATION_GATE_HEAD,
    '    raise exception using',
    `        message = ${sqlLiteral(message)},`,
    `        errcode = ${sqlLiteral(ISOLATION_ERRCODE)};`,
    'end if;',
  ];
}

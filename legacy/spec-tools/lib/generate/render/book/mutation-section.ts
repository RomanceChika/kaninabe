/**
 * 保証の章の「**宣言を 1 か所壊したら、どれが赤になるか**」(変異の目録。束 ⑳-5c)。
 *
 * 保証の台帳が答えるのは「何が起こりえないか」であり、その根拠は見張りテストである。
 * では**その見張りテストや生成物が、本当に壊れたときに赤くなるのか**—— それを答えるのがこの表で
 * ある。読み方は 1 つだけ: **行(壊したもの)ごとに ✅ が 1 つ以上あること**。1 つも無い行は
 * 「その宣言を壊しても誰も気づかない」という意味であり、免除ではなく**検査の漏れ**である。
 *
 * 表の中身は実測である —— 生成器と検査器に**変異させた仕様を本当に流して**、観測できるものが
 * 変わったかどうかを見ている(`lib/mutation/**`)。**壊せる場所は全部実行する**(件数の上限は
 * 持たない —— 上限は残りを黙って見ないことにする免除リストとして働く)。
 *
 * **この節は変異を自分で回さない。** 回した結果(`MutationReport`)は組み立ての根が
 * `ctx.mutation` に載せて渡す —— 本が検出器を import すると、本の生成器の依存が DDL・RLS・RPC 本文の
 * 生成器まで広がる(設計メモ framework-modules §11)。結果が渡されていなければ節を出さない。
 *
 * 捕られなかった変異は表の下に**そのまま**出る。書き分けは 3 つ(検査の漏れ / 検査器が報告して
 * いる穴 / 宣言された例外)で、どれも根拠を宣言と検査器から機械が読む
 * (`lib/mutation/exemptions.ts`)—— 書き足せる免除の台帳はどこにも無い。
 */

import type { GenerateContext } from '../../../gen-kit/generator.js';
import { exemptedOf, exemptionText, holesOf, namedOf } from '../../../kernel/mutation-report.js';
import type { MutationReport, MutationRow } from '../../../kernel/mutation-report.js';
import { cell, markdownTable } from '../../../gen-kit/state-machine-table.js';

/** 見出し。 */
const HEADING = '## 宣言を 1 か所壊したら、どれが赤になるか(変異の目録)';

/** 導入(定型)。 */
export const MUTATION_LEAD =
  '見張りテストが「壊れたら赤くなる」ことは、正しい仕様で緑になることでは示せない。' +
  'ここは**仕様の宣言を機械で 1 か所わざと壊し**、生成物・期待・検査のどれが変わるかを' +
  '実測した表である。**壊せる場所は全部壊す**(件数の上限は持たない —— 上限は' +
  '「残りを黙って見ないことにする」免除リストとして働く)。読むところは 2 つある —— ' +
  '**どの行にも ✅ が 1 つ以上あること**と、**「実行した数」に「誰も捕らなかったもの」が' +
  '混じっていないこと**である。混じっていれば、その 1 件ずつが表の下に名前つきで並ぶ。' +
  '受け入れる口(免除リスト)は持たない。';

/**
 * **目録の範囲**の説明(節の冒頭に出る 1 段落)。
 *
 * 文は手で書かない —— 変異器の宣言(`breaks`)と検査の全数、そして
 * 「まだ壊す変異器を持たない宣言」(`mutation/scope.ts`)から組み立てる。
 * 変異器を 1 本足せば範囲の語が増え、`formal` の変異器を投入すれば最後の 1 文が消える ——
 * 生成物にしてあるのは、**範囲の説明だけが古くなる**ことを起こさないためである。
 *
 * @param report 変異の目録の実測結果(変異器・検査の全数・範囲の宣言を含む)
 * @returns 範囲を宣言する 1 段落
 */
export function scopeNote(report: MutationReport): string {
  const breaks = [...new Set(report.operators.map((operator) => operator.breaks))].map((name) => `\`${name}\``).join(' / ');
  const pending = report.unmutated.map((entry) => `${entry.label}の \`${entry.declaration}\` を壊す変異器はまだ無い(${entry.pending})`);
  // **消し込みが終わった日に文が崩れないようにする。** 「まだ壊す変異器を持たない宣言」は
  // 消し込み式の台帳なので空になりうる —— 空のまま並べると読点だけが残る。
  const pendingNote = pending.length === 0 ? '' : `、${pending.join('、')}`;
  return (
    `**この目録の範囲**: 表は(変異器 ${report.operators.length} 本 × 検査 ` +
    `${report.detectors.length} 本)で閉じている —— 行は登録された変異器の全数であり、` +
    `列は検査の全数である。壊す対象は**${report.scope}**(${breaks})である${pendingNote}。` +
    '閉じているのは(変異器 × 検査)であって' +
    '**「DSL の構文 × 変異器」ではない** —— 目録に無い宣言の壊し方は、ここでは 1 件も' +
    '実行していない(✅ が並んでいることは「全部の宣言を試した」という意味ではない)。'
  );
}

/** 壊せる場所が無かった変異器の「壊した例」欄。 */
const NO_SITE = '(この仕様にはその宣言がまだ無い)';

/** 表のあとの注記(定型)。 */
export const MUTATION_NOTE =
  '`—` はその検査が**その変異器で実行した全部の変異**に気づかなかったこと' +
  '(逆に ✅ は「1 件以上で気づいた」であり、その変異器の全部を捕ったという意味ではない —— ' +
  'だから「誰も捕らなかったもの」の数を同じ行に出している)。' +
  `「壊した例」が ${NO_SITE} の行は**まだ試していない** —— ` +
  'このシステムの仕様にその宣言が 1 つも無いので壊せなかった(穴ではない)。' +
  '**`verify` の列が `—` でも穴ではない** —— 仕様の検査が見るのは宣言どうしの整合であり、' +
  '「権限を広げた仕様」は仕様として整合している。そこを捕るのは執行点と期待の側である。';

/** 穴があったときの見出し(表の下に出す)。 */
const HOLE_PREFIX = '**検査の漏れ**: 次の変異はどの検査も捕らなかった。免除はしない —— 検査を足して直す。';

/** 検査器が報告している漏れの見出し。 */
const NAMED_PREFIX =
  '**検査器が報告している漏れ**: 次の変異はどの検査も捕らないが、' +
  'その宣言に執行点が無いこと自体を `npm run verify` が警告として毎回出している。' +
  '免除ではない —— 警告を消すには、執行点を宣言するか規則を消すしかない。';

/** 宣言された例外があったときの見出し。 */
const EXEMPT_PREFIX =
  '**宣言された例外**: 次の変異を捕る検査は無いが、仕様が「この本文は手で書く」と' +
  '理由つきで宣言しており、見張りテストの宣言もある場所である' +
  '(根拠は仕様の宣言そのもので、別台帳の免除ではない)。';

/** 変異の目録の中身(見出しを除く段落・表・箇条書き)と、数。 */
export interface MutationParts {
  /** 導入・範囲・表・注記・表の下の箇条書き(Markdown の断片)。 */
  readonly blocks: readonly string[];
  /** 表の行の数(変異器の全数)。 */
  readonly rows: number;
  /** 宣言された例外(仕様が理由つきで「この本文は手で書く」と宣言している場所)の数。 */
  readonly exempted: number;
}

/** 変異の目録が出ないとき、章がそのことを言う 1 文(`mutationAbsence`)。 */
export interface MutationAbsent {
  readonly absence: string;
}

/**
 * 変異の目録の中身を作る(実測が無ければ、出ない理由を言う 1 文)。
 *
 * @param ctx 生成器の文脈(状態 `ctx.mutation` は組み立ての根が載せる)
 * @returns 見出しを除く断片と、表の行の数(`ran` のとき)/ 出ない理由の 1 文(それ以外)
 */
export function mutationParts(ctx: GenerateContext): MutationParts | MutationAbsent {
  if (ctx.mutation?.state !== 'ran') return { absence: mutationAbsence(ctx.mutation) };
  const report = ctx.mutation.report;
  const rows = report.rows;
  const without = new Set(report.withoutSite);
  return {
    rows: report.operators.length,
    exempted: exemptedOf(rows).length,
    blocks: [
      MUTATION_LEAD,
      scopeNote(report),
      matrixTable(report, without),
      MUTATION_NOTE,
      ...mutationListings(report).flatMap((entry) => [entry.prefix, entry.lines.map((line) => `- ${line}`).join('\n')]),
    ],
  };
}

/**
 * 変異の目録が**出ない理由**を言う 1 文(章がそのことを言うための文)。
 *
 * 3 つの状態を書き分ける(「目録 0 行」で回していないことを隠さない):
 *   - 回していない(`not_run`・状態が渡されていない) … この生成の入口が変異を回さない(全部入りの `generate` が回す)
 *   - 回せなかった(`unavailable`) … 材料が無い。理由は起動の口が決めた句
 *
 * @param outcome 文脈の変異の目録の状態(実測があるときは呼ばれない)
 * @returns 出さない理由の 1 文
 */
function mutationAbsence(outcome: GenerateContext['mutation']): string {
  if (outcome?.state === 'unavailable') return `変異の目録は、${outcome.reason}ので出さない`;
  return '変異の目録は未実施(この生成の入口は変異を回していない。全部入りの `generate` が回して出す)';
}

/** 変異の目録の見出し(章の折りたたみの題にも使う)。 */
export const MUTATION_TITLE = HEADING.replace(/^## /, '');

/** 表の下の箇条書き 1 群(見出しの文と行。共有の文)。 */
export interface MutationListing {
  readonly prefix: string;
  readonly lines: readonly string[];
}

/** 表の下の箇条書き(検査の漏れ → 検査器が報告している漏れ → 宣言された例外。0 件の群は出さない)。 */
export function mutationListings(report: MutationReport): MutationListing[] {
  const rows = report.rows;
  const groups: MutationListing[] = [
    { prefix: HOLE_PREFIX, lines: holesOf(rows).map((row) => row.at) },
    {
      prefix: NAMED_PREFIX,
      lines: namedOf(rows).map((row) => (row.named === undefined ? row.at : `${row.at} — ${row.named.verifier} が「${row.named.label}」と報告する`)),
    },
    {
      prefix: EXEMPT_PREFIX,
      lines: exemptedOf(rows).map((row) => (row.exemption === undefined ? row.at : `${row.at} — ${exemptionText(row.exemption)}`)),
    },
  ];
  return groups.filter((group) => group.lines.length > 0);
}

/** 変異器(行)× 検査(列)の表。 */
function matrixTable(report: MutationReport, without: ReadonlySet<string>): string {
  const matrix = mutationMatrix(report, without);
  return markdownTable(
    [...matrix.headers],
    matrix.rows.map((row) => [...row]),
  );
}

/** 変異器(行)× 検査(列)の表の列と行(セルは `cell` を通した文字列)。 */
export function mutationMatrix(
  report: MutationReport,
  without: ReadonlySet<string>,
): {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
} {
  const { rows, detectors } = report;
  const headers = ['壊したもの', ...detectors.map((detector) => detector.title), '実行した数', '壊した例'];
  const body = report.operators.map((operator) => {
    const mine = rows.filter((row) => row.operator === operator.id);
    if (mine.length === 0) {
      return [cell(operator.title), ...detectors.map(() => cell('')), cell('0'), cell(without.has(operator.id) ? NO_SITE : '')];
    }
    const uncaught = mine.filter((row) => row.caughtBy.length === 0).length;
    return [
      cell(operator.title),
      ...detectors.map((detector) => cell(mine.some((row) => row.caughtBy.includes(detector.id)) ? '✅' : '')),
      cell(uncaught === 0 ? `${mine.length}` : `${mine.length}(うち誰も捕らなかったもの ${uncaught})`),
      cell(example(mine)),
    ];
  });
  return { headers, rows: body };
}

/** 「壊した例」欄(先頭 1 件 + 残りの件数。全数は表の下の箇条書きと元の実測にある)。 */
function example(rows: readonly MutationRow[]): string {
  const first = rows[0]?.at ?? '';
  return rows.length === 1 ? first : `${first}(ほか ${rows.length - 1} 件)`;
}

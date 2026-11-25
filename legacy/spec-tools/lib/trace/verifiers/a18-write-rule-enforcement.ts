/**
 * A18 `writes` に並んでいるのに**執行する生成物が 1 つも無い書き込み規則**(束 ⑳-5c-b)。
 *
 * A17 の隣にある同じ家族の検査である。A17 が見るのは「宣言はあるが誰も**動かせない**欄」で、
 * ここが見るのは「宣言はあるが誰も**執行しない**規則」である。
 *
 * ## どこから出てきた検査か
 *
 * 生成器の変異テスト(`lib/mutation/**`)が題材の製品で実測した検査の漏れがこれである ——
 * `access_spec.writes[]` の `when` を機械で落としても、**どの生成物も 1 バイトも変わらない**
 * 表が実在した。理由は単純で、`writes[]` の規則を SQL の執行点に落とすのは
 * **`shape: update` の生成 RPC の本文だけ**だからである(`lib/sql/rpc-authz-build.ts` の
 * `updateAuthz`)。その形の関数を宣言していない表では、`writes[]` は読み物になる。
 *
 * ## 執行点として認めるもの(宣言から読む。免除リストではない)
 *
 * | 宣言 | 意味 |
 * |---|---|
 * | `kind: rpc` / `shape: update` / `migration:` | **本文が生成物**である(執行点が仕様から出る) |
 * | `kind: rpc` / `shape: update` / `handwritten:` | 本文は手写しだが、T6 が理由を必須にし、テストの宣言(`test_cases`)が見張る |
 * | `kind: rpc` / `shape: composite` / `enforces:` | **規則ごとに名指しした**手書きの執行点(ADR-0014)。見張りテストの id(`test_case`)が同じ表の `test_cases` に実在する規則だけが消える。書き間違いは T18 が error にする |
 *
 * どちらも無ければ warning である。`handwritten:` を宣言しながら `test_cases` が 1 つも無い表も
 * 同じく warning —— 見張りテストを宣言していない手写しは宣言ではなく、ただの穴である(T4 と同じ流儀)。
 *
 * ## 遷移が書く列の規則は、遷移の RPC が執行点である(`by: system` かつ `when` 無しに限る)
 *
 * `writes` には **人が編集する列**のほかに「**遷移が書く列**」が載る —— `records_actor` /
 * `records_time` / `clears` / `computes` はどれも「その列を書くのは操作であって人のフォームではない」の宣言である。
 * いまは前の 3 語の列は `transition_writes`(V19)、`computes` の列はどの `writes` にも並べない(V18。2026-10-20 の裁定)
 * ので、この経路に乗る行は新しくは生まれない(以前の宣言で `by: system` の行に置いた列の扱いとして残っている)。
 * その規則を執行するのは `shape: update` ではなく **`shape: transition` の RPC** である。
 * 規則の**全列**が遷移の書き込みとして宣言済みなら、執行点は遷移の RPC で足りる。
 *
 * **乗れるのは `by: system` の行だけである。** V19 が要求しているのは `by: system` の行であり、
 * そこが「人の操作としては現れない列」の置き場である。人間ロールの行(`by: organizer` 等)は
 * **人がフォームから実行する許可**の宣言であって、遷移の RPC はそれを 1 度も執行しない ——
 * 同じ列を遷移も書くからといって、人が起こせる許可の執行点が生えるわけではない。
 * だから人間ロールの行は `shape: update` が無ければ warning のままである。
 *
 * **`when` を持つ規則はこの経路に乗らない。** `writes[].when` を条件として実行するのは
 * `shape: update` の生成本文だけであり(`updateAuthz`)、遷移の RPC が見るのはイベントの
 * `from` である —— 2 つは別の条件で、遷移の RPC は `when` を 1 度も読まない。そこに `when` を
 * 書くと「誰も実行しない関門」が宣言として残り、しかも**同じことを 2 か所が言う**ことになる
 * (どの状態で書けるかの正は state_spec の `from` である)。だから `when` があれば warning は
 * 消えない —— 消したければ `when` を落として正を 1 つにするか、執行点を宣言する。
 *
 * 1 列でも宣言の外に残れば warning のままである —— そこは本当に「誰も執行しない宣言」だからで、
 * この経路が免除にならないのはそのためである(規則ごと・列ごとに宣言から数え直す)。
 *
 * ## severity は warning である
 *
 * 仕様の誤りではない。「その集約を編集する操作をまだ作っていない」ことの帰結でもありうるし、
 * 本当に規則が要らない(= 消すべき)こともある。どちらかを決めるのは人である —— ここがするのは
 * **執行を伴わない宣言の所在を報告すること**だけである。
 *
 * テーブル仕様が使えない(未選択・阻害)構成では判定を出さず、見ていないことを実行ログが報告する(`PartialRun.gaps`)。
 *
 * 判定(`unenforcedWriteRules`)は意味解析の層(`lib/semantics/unenforced-write-rules.ts`)にある。
 * 変異の目録(`lib/mutation/exemptions.ts`)も同じ判定を読むので、検証器のファイルには置かない。
 */

import type { Finding, PartialInputTraceVerifier, PartialRun } from '../verifier.js';
import { traceFinding } from '../verifier.js';
import { dataTablesGap, dataTablesOf, type TraceInput } from '../input.js';
import { enforcementGapWords } from '../../messages/messages-enforcement.js';
import { unenforcedWriteRules } from '../../semantics/unenforced-write-rules.js';
import type { DataTableSpec } from '../../model/data/types.js';
import type { AccessSpec, WriteRule } from '../../model/types.js';

/** A18: `writes` の規則に執行点があることを検証する。 */
export const writeRuleEnforcementVerifier: PartialInputTraceVerifier = {
  id: 'A18',
  title: 'writes の規則の執行点 — 誰も執行しない書き込み規則を報告する',

  verify: (input) => writeRuleRun(input).findings,
  runPartial: writeRuleRun,
};

/**
 * 検査の本体。テーブル仕様が使えない(未選択・阻害)ときは執行点を探せないので、判定は出さず `gaps` で報告する
 * (以前は黙って何も言わなかった)。
 */
function writeRuleRun(input: TraceInput): PartialRun {
  const tables = dataTablesOf(input);
  if (tables === undefined) {
    const gap = dataTablesGap(input, 'writes の規則に執行点があるか(誰も執行しない書き込み規則)は見ていません');
    return { findings: [], gaps: gap === null ? [] : [gap] };
  }
  return {
    findings: unenforcedWriteRules(input.domain, tables, input.actions).map((found) =>
      finding(found.access, found.rule, found.table, enforcementGapWords(found.gap)),
    ),
    gaps: [],
  };
}

/** 執行点の無い規則 1 本ぶんの指摘(対処は 3 択で出す)。 */
function finding(
  access: AccessSpec,
  rule: WriteRule,
  table: DataTableSpec | undefined,
  reason: string,
): Finding {
  const when = rule.when === undefined ? '' : ` / when "${rule.when}"`;
  return traceFinding('A18', {
    severity: 'warning',
    message: `${access.entity} の writes(by: ${rule.by}${when})を執行する生成物がありません(${reason})`,
    location: { ...access.location, pointer: 'writes' },
    suggestion:
      '次の 4 つのどれかを選ぶ —— (1) その表の data_table に kind: rpc / shape: update の関数を ' +
      'migration: つきで宣言する(本文が生成物になり、by と when が SQL の執行点に落ちる)。' +
      '(2) 本文を手で持つなら handwritten: に理由を書き、その規則の見張りテストを test_cases に ' +
      '宣言する(見張りテストを宣言していない手写しは宣言ではない)。(3) その規則を執行する操作が無いなら、' +
      'writes から規則ごと消す。黙って残すと「この規則は効いている」と読まれる宣言だけが残る。' +
      '(4) 複数行を一括で動かすなど定型に乗らない composite の関数が執行点なら、その関数に ' +
      'enforces: [{ writes, by, test_case }] でその規則と見張りテストの id(同じ表の test_cases)を書く',
    counterexample: {
      entity: access.entity,
      by: rule.by,
      ...(rule.when === undefined ? {} : { when: rule.when }),
      ...(table === undefined ? {} : { table: table.table }),
    },
  });
}

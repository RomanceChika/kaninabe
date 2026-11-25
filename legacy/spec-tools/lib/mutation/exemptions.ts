/**
 * 捕る検査が無かった変異のうち、**仕様が「本文は手で持つ」と宣言している**ものを見分ける
 * (束 ⑳-5c-b)。
 *
 * ## なぜこれが免除リストではないのか
 *
 * 免除リストとは「この件は見なくてよい」と**別の台帳に書き足せる**口のことである。ここにあるのは
 * その逆で、根拠は**仕様の中の既存の宣言**しかない。機械が読むのは 3 つだけである。
 *
 * | 宣言 | どこに書くか | 誰が縛るか |
 * |---|---|---|
 * | `runner`(生成に乗らない操作) | action_spec | A15 が**両方向**を見る(導出できるのに宣言していてもエラー) |
 * | `functions[].handwritten`(本文が手写しの RPC) | data_table | T6 が理由を必須にする |
 * | `functions[].enforces`(`composite` の関数が執行点になる規則) | data_table | T18 が規則と見張りテストの実在を見る(ADR-0014) |
 *
 * どちらも**見張りテストの宣言(`test_cases`)が無ければ例外として認めない**。テストの宣言が無い
 * 手写しは宣言ではなく、ただの穴である(T4 と同じ流儀)。したがって「変異を黙らせるために
 * 宣言を書き足す」ことはできない —— 書き足せば A15 / T6 / T4 が別の場所で鳴る。
 *
 * **`shape: composite` の RPC は、`enforces` を宣言したものだけがここに現れる。** 定型に乗らない RPC で
 * 実現される操作は、その操作の action_spec が必ず `runner` を宣言する(A15 の両方向)ので、1 行目で読める ——
 * 題材の製品の `erase_member`(composite)は `membership.erase` の `runner: manual` として現れる。
 * 配列を受けて複数行を一括で動かす `composite` の関数のように、**操作の action_spec ではなく表の側で**
 * 「どの `writes` の規則の執行点か」を宣言する関数は、3 行目の `enforces` が根拠になる
 * (`enforces` が名指す規則 = 壊した規則のときだけ。canaries はその見張りテスト)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { unenforcedWriteRules } from '../semantics/unenforced-write-rules.js';
import { enforcementGapWords } from '../messages/messages-enforcement.js';
import type { MutationExemption, MutationNamedHole } from '../kernel/mutation-report.js';
import type { MutationSite, MutationSubject } from './types.js';

/**
 * その変異が「宣言された例外」に当たるかを、仕様の宣言から引く。
 *
 * @param site 壊した宣言の執行点の所在(所在を持たない変異では undefined)
 * @param subject 題材の材料(**変異前**の仕様を読む —— 変異が宣言そのものを作り変えないため)
 * @returns 宣言された例外(当たらなければ undefined)
 */
export function exemptionOf(
  site: MutationSite | undefined,
  subject: MutationSubject,
): MutationExemption | undefined {
  if (site === undefined) return undefined;
  return byRunner(site, subject) ?? byHandwritten(site, subject) ?? byEnforces(site, subject);
}

/** action_spec の `runner`(生成に乗らない操作)を根拠にする。 */
function byRunner(site: MutationSite, subject: MutationSubject): MutationExemption | undefined {
  const action = (subject.actions?.actions ?? []).find((candidate) => candidate.handles.raw === site.event);
  if (action?.runner === undefined) return undefined;
  const canaries = action.testCases.map((testCase) => testCase.id);
  if (canaries.length === 0) return undefined;
  return {
    kind: 'runner',
    label: `生成に乗らない操作(${action.relPath} の runner: ${action.runner.kind})`,
    canaries,
  };
}

/** data_table の `functions[].handwritten`(本文が手写しの RPC)を根拠にする。 */
function byHandwritten(site: MutationSite, subject: MutationSubject): MutationExemption | undefined {
  const table = (subject.dataTables?.tables ?? []).find((candidate) => candidate.entity === site.entity);
  if (table === undefined) return undefined;
  const handwritten = table.functions.find(
    (fn) => fn.kind === 'rpc' && fn.shape === site.shape && fn.handwritten !== undefined,
  );
  if (handwritten === undefined) return undefined;
  const canaries = table.testCases.map((testCase) => testCase.id);
  if (canaries.length === 0) return undefined;
  return { kind: 'handwritten', label: `本文が手写しの RPC ${handwritten.name}`, canaries };
}

/**
 * data_table の `functions[].enforces`(`composite` の関数が執行点になる規則)を根拠にする。
 *
 * 壊した規則(`writes` のエンティティと `by`)を名指す宣言があるときだけ例外と認める。`by` を
 * 持たない変異(所在が `by` まで絞れないもの)は、そのエンティティを名指す宣言のどれでもよい。
 * canaries は名指された見張りテストのうち、その表の `test_cases` に実在するものだけである
 * (実在しなければ T18 が別に鳴る。ここで黙って数えない)。
 */
function byEnforces(site: MutationSite, subject: MutationSubject): MutationExemption | undefined {
  if (site.shape !== 'update') return undefined;
  for (const table of subject.dataTables?.tables ?? []) {
    for (const fn of table.functions) {
      if (fn.kind !== 'rpc' || fn.shape !== 'composite') continue;
      const named = (fn.enforces ?? []).filter(
        (item) => item.writes === site.entity && (site.by === undefined || item.by === site.by),
      );
      const known = new Set(table.testCases.map((testCase) => testCase.id));
      const canaries = [...new Set(named.map((item) => item.testCase))].filter((id) => known.has(id));
      if (canaries.length === 0) continue;
      return { kind: 'enforces', label: `本文が手写しの composite RPC ${fn.name}(enforces で規則の執行点を宣言)`, canaries };
    }
  }
  return undefined;
}

/**
 * その変異が「**検査器が既に報告している漏れ**」に当たるかを引く。
 *
 * 判定そのものは A18 と共有の 1 本(`unenforcedWriteRules`。意味解析の層)をそのまま呼ぶ —— 同じ判定を 2 か所に
 * 書くと片方だけが直る。ここが返すのは免除ではない: A18 の warning は `verify` に毎回出続け、
 * 消すには仕様を直すしかない(執行点を宣言するか、規則を消すか)。
 *
 * @param site 壊した宣言の執行点の所在
 * @param subject 題材の材料(**変異前**の仕様を読む)
 * @returns 報告している検査器(当たらなければ undefined)
 */
export function namedHoleOf(
  site: MutationSite | undefined,
  subject: MutationSubject,
): MutationNamedHole | undefined {
  if (site?.shape !== 'update') return undefined;
  const found = unenforcedWriteRules(subject.model, subject.dataTables).find(
    (candidate) => candidate.entity === site.entity,
  );
  if (found === undefined) return undefined;
  return { verifier: 'A18', label: `執行点が無い書き込み規則(${enforcementGapWords(found.gap)})` };
}

/**
 * T17 の下位検査: **不変条件を名指すトリガの条件を、本文と照らせるか**(点検 21 回目 C21-4)。
 *
 * 宣言の不変条件の前提・条件とトリガの本文の照らし(data-table-parity の `diffConditions`)は、語に割れる不変条件しか見られない
 * (割るのは `sql/trigger-condition-words.ts`)。割れない不変条件を黙って外すと、本文が前提を落としても誰も赤にしない。そこで
 * 割れない理由(`T17_REASONS` の照らしの語)ごとに警告で名指す。
 *
 * - 形式定義が DSL の外(`trigger_condition_no_formal`)は仕組みの宿題で、拡張候補の台帳 `X-trigger-condition-words`
 *   (絞りの鍵 `trigger_condition_inexpressible`)に当たる。**受け入れは不変条件ごと**で、不変条件が DSL の外である理由
 *   (`formal_outside`)を宣言したものだけがこの理由になる(点検 22 回目 C22-3)。警告は消えず、毎回名指しで理由つきで出る。
 * - 形式定義も理由も無い(`trigger_condition_formal_missing`)は「書けるのに書いていない」と区別できないので、製品の側で直す。
 * - それ以外(名指した不変条件が無い・一意や排他を名指した・式が読めない・語も列も無い)は製品の宣言で直せるので、どの候補にも当たらず
 *   未分類(`--fail-on-unclassified` で赤)になる。
 *
 * 免除の口は無い。受け入れるなら台帳の候補(理由の文)に当たる形だけである。純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import type { DataTableSpec } from '../../model/data/types.js';
import { conditionWordsOf } from '../../sql/trigger-condition-words.js';
import { T17_REASONS } from '../check-reasons.js';

/** 理由ごとの言い方と直し方。 */
const WORDING: Readonly<Record<string, { readonly why: string; readonly fix: string }>> = {
  [T17_REASONS.conditionMissingInvariant]: { why: '名指した不変条件が見つからない', fix: 'triggers[].invariant を実在する不変条件 ID に直す' },
  [T17_REASONS.conditionNoFormal]: {
    why: '不変条件が形式定義(formal)を持たない(DSL の外。formal_outside の理由つき)',
    fix: '形式定義の語彙が増えて書けるようになったら invariant_spec に formal を書き、formal_outside を外す。それまでは拡張候補 X-trigger-condition-words の宿題として残る',
  },
  [T17_REASONS.conditionFormalMissing]: {
    why: '不変条件が形式定義(formal)も、DSL の外である理由(formal_outside)も持たない(書けるのに書いていないと区別できない)',
    fix: '形式定義を書ける条件なら invariant_spec に formal を書く。形式定義の型で言えない条件なら、言えない理由を formal_outside に 1 文で書く(理由を書いた不変条件だけが拡張候補の宿題に数える)',
  },
  [T17_REASONS.conditionKindOutside]: {
    why: '形式定義の種類(一意・排他)が条件の語に割れない(その執行点は索引・排他制約のはず)',
    fix: 'トリガが本当に守る不変条件を名指すか、執行点を索引・排他制約に移す',
  },
  [T17_REASONS.conditionUnparsable]: { why: '形式定義の式が読めない', fix: 'invariant_spec の formal の式を直す' },
  [T17_REASONS.conditionNoWords]: {
    why: '形式定義から照らす語も欄も出ない',
    fix: '形式定義の式に、トリガが見る欄(`{集約}.{欄}`)の比較を書く',
  },
};

/**
 * 全 data_table のトリガのうち、不変条件を名指すのに本文と照らせないものを警告にする。
 *
 * @param verifier 検査 ID(T17)
 * @param domain ドメイン仕様
 * @param tables 全 data_table
 * @returns 警告の並び
 */
export function unreadableConditionFindings(verifier: string, domain: SpecModel, tables: readonly DataTableSpec[]): Finding[] {
  const findings: Finding[] = [];
  for (const table of tables) {
    for (const trigger of table.triggers) {
      const read = conditionWordsOf(trigger, table, domain);
      if (read === null || read.unreadable === null) continue;
      const wording = WORDING[read.unreadable];
      findings.push({
        verifier,
        severity: 'warning',
        reason: read.unreadable,
        message: `${table.table} のトリガ ${trigger.name} が名指す ${read.invariant} の条件を、本文と照らせません(${wording?.why ?? read.unreadable}${read.outside === undefined ? '' : `。理由: ${read.outside}`})。本文が宣言の前提を落としても data-table-parity は赤にならない`,
        location: { ...table.location, pointer: `triggers.${trigger.name}` },
        suggestion: wording?.fix ?? '形式定義を見直す',
        counterexample: { table: table.table, trigger: trigger.name, invariant: read.invariant, reason: read.unreadable },
      });
    }
  }
  return findings;
}

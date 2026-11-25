/**
 * 台帳の語の語釈(ブックの表紙の「この本に出てくる言葉」と、`<Term>` の辞書が同じ語釈を使う)。
 *
 * gloss の `{例}` の位置には、その語の例を**仕様の宣言から採って**差し込む。表紙の生成器
 * (index-page.ts)と用語の辞書の生成器(book-assets.ts)の両方が読むので、どちらにも属さない
 * このモジュールに置く(値の循環を作らない)。
 */

import { allMachines, type SpecModel } from '../../../model/types.js';
import type { TermDecl } from '../../../model/terms/types.js';

/** gloss の中で「その語の例を仕様から採って差し込む位置」を示す印(台帳の書き方: term-ledger-writing.md)。 */
const EXAMPLE_SLOT = '{例}';

/**
 * 台帳の語のうち、例を仕様の宣言から採る語の例(`{例}` の差し込み先)。
 *
 * 例に出す**語**だけは仕様の宣言から採る —— どのシステムでも同じ説明文の中に、そのシステムには
 * 無い概念の名前が混ざらないようにするためである(`machineExample` / `contextRoleExample`)。
 * 宣言が 1 つも無ければ空文字で、`{例}` は消える。
 */
function termExample(id: string, model: SpecModel): string {
  if (id === 'state_machine') return machineExample(model);
  if (id === 'role') return contextRoleExample(model);
  return '';
}

/** 台帳の語の語釈(`{例}` の位置には、その語の例を仕様の宣言から採って差し込む)。 */
export function termGloss(decl: TermDecl, model: SpecModel): string {
  return decl.gloss.replace(EXAMPLE_SLOT, termExample(decl.id, model));
}

/**
 * 状態機械の例(`(例: {初期状態} → … → {終端})`)。宣言が 1 つも無ければ空文字。
 *
 * **例に出す語はこのアプリの宣言から採る。** 以前は「下書き → 提出 → 確定」と固定で書いて
 * あり、これは題材の製品の状態の `label` そのものだった —— 状態にその語を持たないシステムの
 * 用語表にも同じ 3 語が出る。状態数が最も多い機械の `stateLabels` を宣言順に 3 つ借りる。
 */
function machineExample(model: SpecModel): string {
  const machines = [...allMachines(model)].map(({ machine }) => machine);
  const widest = machines.sort((a, b) => b.states.length - a.states.length)[0];
  if (widest === undefined || widest.states.length < 2) return '';
  // 例なので先頭 3 つで足りる(全部並べると用語表の 1 行が状態一覧になる)。
  const labels = widest.states.slice(0, 3).map((state) => widest.stateLabels[state] ?? state);
  const tail = widest.states.length > labels.length ? ' → …' : '';
  return `(例: ${labels.join(' → ')}${tail})`;
}

/** 実行者自身の行を指す binding(`{entity}.id == actor.id`)の形。 */
const SELF_BINDING = /^[a-z][a-z0-9_]*\.id\s/;

/**
 * 文脈依存ロールの例(`(例: その{label})`)。宣言が 1 つも無ければ空文字。
 *
 * **例に出す語はこのアプリの宣言から採る。** 以前は「その枠の枠主」と書いてあり、これは
 * 題材の製品の `entry_owner` の `label` そのものだった —— 別のシステムのハンドブックの用語表に
 * その語が出る(束 ⑱ の題材 B が実測)。
 *
 * 選ぶのは「**参照列で結ばれる**ロール」を優先する(binding の左辺が `{entity}.id` ではない
 * もの)—— 「そのレコードとの関係で決まる」の例としては、実行者自身の行を指すロール(本人)
 * より分かりやすいからである。無ければ最初の文脈依存ロールで代える。
 */
function contextRoleExample(model: SpecModel): string {
  const contextual = model.roles.roles.filter((role) => role.binding !== undefined);
  const related = contextual.find((role) => !SELF_BINDING.test(role.binding ?? ''));
  const picked = related ?? contextual[0];
  if (picked === undefined) return '';
  return `(例: その${picked.label ?? picked.id})`;
}

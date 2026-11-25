/**
 * 拡張候補の絞りの鍵(`scope`)の定義と、警告 1 件がその鍵に収まるかの判定(純関数)。
 *
 * 候補が当たる警告は、まず**検査 ID**(`rules`)で決まる。ところが一般の検査は理由の混ざる警告を出す —— T2 は
 * 「どの query_spec・関数も要求しない索引」を広く拾い、仕組みの表の索引も製品の余分な索引も同じ ID で出る。
 * 検査 ID だけで当てると、**仕様を書く人が消すべき警告まで「仕組みの宿題」に化ける**(読まなくてよい側へ落ちる)。
 * そこで候補は `scope` で、**その検査の警告のうち、候補の言い分に当たる分だけ**に絞れる。
 *
 * 絞りは**警告が持つ値**で決める。理由の混ざる検査は、**理由を明示の欄**(`Finding.reason`。T16 の語は
 * `lib/data/check-reasons.ts`・T2 の語は `lib/data/index-reasons.ts`)で載せ、絞りはそれを読む(反例の欄から推定しない)。
 * T2 の「仕組みの表」は、表の名前だけでは足りない —— **製品がその表を持ち場とする関数を宣言している**なら製品が
 * `lookup` を書けるので、仕組みの宿題に当てない(未分類に落ちる)。
 * `scope` を書かない候補は従来どおり検査 ID の全体に当たる。鍵は閉じた語で、**各鍵は絞れる検査を宣言する**
 * (`verifiers`)。絞れない検査に鍵を付けると警告の欄が無く絞りが空振りするので、W5 がそれを error にする。
 */

import type { Finding } from '../kernel/finding.js';
import { T2_REASONS } from '../data/index-reasons.js';
import { T16_REASONS, T17_REASONS } from '../data/check-reasons.js';
import { A19_REASONS } from '../trace/compute-reasons.js';
import type { ExtensionScope } from '../model/extension/types.js';

/** 絞りの鍵 1 つの定義。 */
export interface ScopeDefinition {
  /** この鍵で絞れる検査の ID(警告がその絞りに要る欄を持つ検査)。 */
  readonly verifiers: readonly string[];
  /** 人が読む言い方(台帳・手引きに添える)。 */
  readonly meaning: string;
  /** 警告 1 件がこの鍵に収まるか。 */
  readonly admits: (finding: Finding) => boolean;
}

/** 絞りの鍵の定義(鍵の値域は `EXTENSION_SCOPES`。ここに全部の鍵があることを型が見る)。 */
export const SCOPES: Readonly<Record<ExtensionScope, ScopeDefinition>> = {
  framework_tables: {
    verifiers: ['T2'],
    meaning: '仕組みが所有する表のうち、製品がその表を持ち場とする関数を宣言していないものだけ',
    admits: (finding) => finding.reason === T2_REASONS.frameworkTableFunctionless,
  },
  trigger_formal_inexpressible: {
    verifiers: ['T16'],
    meaning: '執行点がトリガで、形式定義が DSL の外のものだけ(形式定義が無いものは、不変条件が理由 formal_outside を宣言したものだけ)',
    admits: (finding) => finding.reason === T16_REASONS.triggerFormalInexpressible,
  },
  trigger_cross_aggregate: {
    verifiers: ['T16'],
    meaning: '執行点がトリガで、形式定義の式が別の集約の欄を見るものだけ',
    admits: (finding) => finding.reason === T16_REASONS.crossAggregateCheck,
  },
  compute_child_set: {
    verifiers: ['A19'],
    meaning: '計算の材料に子の行の集合を宣言したもの(計画が積めないもの)だけ',
    admits: (finding) => finding.reason === A19_REASONS.childSetRead,
  },
  trigger_condition_inexpressible: {
    verifiers: ['T17'],
    meaning: 'トリガが名指す不変条件が形式定義を持たない(DSL の外。不変条件が理由 formal_outside を宣言したものだけ)ために、宣言の条件をトリガ関数の中身と照らせないものだけ',
    admits: (finding) => finding.reason === T17_REASONS.conditionNoFormal,
  },
};

/**
 * 絞りの鍵が 1 つでも存在する検査の ID の集合(各鍵の `verifiers` の和)。
 *
 * **これらの検査を `rules` に挙げる候補は `scope` が必須である**(W5)。鍵の無い候補は検査 ID の全体に当たり、
 * 理由の混ざる検査では製品の側で直せる警告まで宿題に吸い込むため。手書きの一覧を持たず、鍵の定義から導く。
 */
export const SCOPED_VERIFIERS: ReadonlySet<string> = new Set(
  Object.values(SCOPES).flatMap((definition) => definition.verifiers),
);

/**
 * 警告が候補の絞りに収まるか。
 *
 * @param scope 候補の絞りの鍵(書かれていなければ undefined = 検査 ID の全体)
 * @param finding 警告
 * @returns 絞りが無ければ常に true
 */
export function scopeAdmits(scope: ExtensionScope | undefined, finding: Finding): boolean {
  return scope === undefined || SCOPES[scope].admits(finding);
}

/**
 * 2 つの候補の絞りが重なりうるか(同じ検査に付いたとき、1 件の警告が両方に当たりうるか)。
 *
 * どちらかが絞りを持たなければ(検査の全体)重なる。両方が絞りを持つなら、同じ鍵のときだけ重なる
 * (違う鍵は警告の別の欄を見るので、別々の警告を取り合うものとして扱う)。
 *
 * @param a 一方の絞り
 * @param b もう一方の絞り
 */
export function scopesOverlap(a: ExtensionScope | undefined, b: ExtensionScope | undefined): boolean {
  return a === undefined || b === undefined || a === b;
}

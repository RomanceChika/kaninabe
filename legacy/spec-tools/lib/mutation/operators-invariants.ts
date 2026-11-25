/**
 * **不変条件の `formal` を壊す**変異器(束 §17 で再投入)。
 *
 * 壊す先(不変条件の `formal`)ごとの変異器で(`operators-reads.ts` と同じ分け方)、目録の全数は
 * `operators.ts` の `ALL_MUTATION_OPERATORS` が持つ。
 *
 * ## なぜこれが長いあいだ入れられなかったのか
 *
 * 変異器は「壊したら**どれかの検査が赤になる**」ことでしか意味を持たない。`formal` は
 * 束 ㉓ まで**どの生成物にも反映されていなかった**ので、`is null` を `is not null` に裏返しても
 * 生成物のバイト列は 1 ビットも動かず、全題材で検査の漏れになった(だから目録から外し、
 * `scope.ts` の「まだ壊す変異器を持たない宣言」に 1 行だけ残した)。
 *
 * いまは 2 つの経路で反映されている —— `checks[]` が `invariant` だけを宣言する行(行 CHECK)と、
 * `triggers[]` が宣言する**条件を課すトリガの本文**である。どちらも表の DDL に出るので、
 * 捕るのは `ddl` の目である。
 *
 * ## 何を壊すか
 *
 * **`formal` の中の空かどうかの判定を 1 つだけ裏返す**(`is null` ⇄ `is not null`)。
 * 選んだ理由は 2 つある。① 裏返しても**仕様としては成り立つ**(V 群は黙る)——
 * つまり静かに通る種類の壊れ方であり、執行点が動くことだけが検査になる。② 不変条件の
 * 意味は**真っ向から反対**になる(「紐付け済みならアカウントを持つ」が「紐付け済みなら
 * アカウントを持たない」になる)。
 *
 * **式を持つ `formal` はすべて対象**である —— `check` の `expr` だけでなく、
 * `uniqueness` / `exclusion` / `cardinality` の `where` と `state_dependency` の
 * `if` / `then` も裏返す。反映されない宣言を母集合から外すと、それは「捕れないものは
 * 壊さない」という**黙った免除**になる。
 *
 * **執行点の所在(`site`)は示さない。** 宣言された例外(`exemptions.ts`)の 2 つの根拠
 * —— action_spec の `runner` と data_table の `functions[].handwritten`(**RPC の本文**)——
 * はどちらも「書き込み RPC の本文が手写しである」ことの宣言であり、不変条件の執行点
 * (CHECK / トリガ)とは別物である。所在を示して例外を引かせると、関係の無い宣言を
 * 根拠に穴が消える。捕られなければ**そのまま検査の漏れとして出る**。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { AggregateSpecs, InvariantFormal, SpecModel } from '../model/types.js';
import type { Mutant, MutationOperator } from './types.js';

/** 空かどうかの判定の裏返し(**長いほうを先に見る**)。 */
const FLIPS: readonly (readonly [string, string])[] = [
  ['is not null', 'is null'],
  ['is null', 'is not null'],
];

/** 式を持つ `formal` の欄(裏返す先。宣言に現れる語をそのまま鍵にする)。 */
type ExprField = 'expr' | 'where' | 'if' | 'then';

/** その `formal` が持つ式の欄と中身(式を持たない欄は現れない)。 */
function expressionsOf(formal: InvariantFormal): readonly (readonly [ExprField, string])[] {
  switch (formal.kind) {
    case 'check':
      return [['expr', formal.expr]];
    case 'state_dependency':
      return [
        ['if', formal.if],
        ['then', formal.then],
      ];
    default:
      return formal.where === undefined ? [] : [['where', formal.where]];
  }
}

/** 1 か所だけ裏返した式(裏返せる場所が無ければ空)。 */
function flipped(source: string): readonly { readonly at: number; readonly text: string }[] {
  const results: { at: number; text: string }[] = [];
  for (let i = 0; i < source.length; i += 1) {
    for (const [from, to] of FLIPS) {
      if (!source.startsWith(from, i)) continue;
      results.push({ at: i, text: `${source.slice(0, i)}${to}${source.slice(i + from.length)}` });
      // 同じ位置で 2 つの綴りに当たることはない(長いほうを先に見ている)。
      break;
    }
  }
  return results;
}

/** 集約 1 つの不変条件 1 本の `formal` を差し替えたモデル。 */
function withFormal(
  model: SpecModel,
  name: string,
  specs: AggregateSpecs,
  invariantIndex: number,
  formal: InvariantFormal,
): SpecModel {
  const spec = specs.invariants;
  if (spec === undefined) return model;
  const invariants = spec.invariants.map((current, index) =>
    index === invariantIndex ? { ...current, formal } : current,
  );
  const aggregates = new Map(model.aggregates);
  aggregates.set(name, { ...specs, invariants: { ...spec, invariants } });
  return { ...model, aggregates };
}

/** 式の欄 1 つを差し替えた `formal`(欄は必ずその `kind` が持つものだけが来る)。 */
function replaceExpression(formal: InvariantFormal, field: ExprField, text: string): InvariantFormal {
  return { ...formal, [field]: text } as InvariantFormal;
}

/** `formal` の空かどうかの判定を 1 つ裏返す(「空でない」⇄「空である」)。 */
export const flipNullTest: MutationOperator = {
  id: 'flip_null_test',
  title: '不変条件の `formal` の空かどうかの判定を 1 つ裏返す',
  breaks: 'formal',

  mutate(model: SpecModel): readonly Mutant[] {
    const mutants: Mutant[] = [];
    for (const [name, specs] of model.aggregates) {
      (specs.invariants?.invariants ?? []).forEach((invariant, invariantIndex) => {
        const formal = invariant.formal;
        if (formal === undefined) return;
        for (const [field, source] of expressionsOf(formal)) {
          for (const found of flipped(source)) {
            mutants.push({
              operator: flipNullTest.id,
              at: `${invariant.id} の formal.${field} の ${found.at} 文字目の空の判定を裏返した("${found.text}")`,
              model: withFormal(
                model,
                name,
                specs,
                invariantIndex,
                replaceExpression(formal, field, found.text),
              ),
            });
          }
        }
      });
    }
    return mutants;
  },
};

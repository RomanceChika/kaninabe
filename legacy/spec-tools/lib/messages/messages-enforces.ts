/**
 * T18(`composite` の `enforces` の書き間違い)の**文面**(事実 → 日本語)。
 *
 * 判定そのもの(どの宣言が書き間違いか)は `lib/data/verifiers/t18-composite-enforces.ts` にある。
 * ここは事実を受けて字面を組むだけで、文言の層に置く。
 */

/** `enforces` の書き間違い(事実。文面は持たない)。 */
export type EnforcesProblem =
  /** `kind: rpc` + `shape: composite` でない関数に書いた。 */
  | { readonly kind: 'wrong_place'; readonly function: string; readonly fnKind: string; readonly shape: string }
  /** `writes` が access_spec のエンティティとして実在しない。 */
  | { readonly kind: 'unknown_entity'; readonly function: string; readonly writes: string; readonly known: readonly string[] }
  /** そのエンティティの `writes` に、その `by` の規則が無い。 */
  | {
      readonly kind: 'no_rule';
      readonly function: string;
      readonly writes: string;
      readonly by: string;
      readonly declared: readonly string[];
    }
  /** `test_case` が、その関数の表の `test_cases` に無い。 */
  | { readonly kind: 'no_test_case'; readonly function: string; readonly table: string; readonly testCase: string }
  /** 同じ規則を別の宣言がすでに名指ししている(執行点は 1 つ)。 */
  | {
      readonly kind: 'duplicate';
      readonly function: string;
      readonly writes: string;
      readonly by: string;
      readonly first: string;
    };

/** 指摘の文面(message と suggestion)。 */
export interface EnforcesWords {
  readonly message: string;
  readonly suggestion: string;
}

/**
 * 書き間違い 1 つの文面(事実 → 日本語)。
 *
 * @param problem 書き間違い(事実)
 * @returns 指摘の message と suggestion
 */
export function enforcesProblemWords(problem: EnforcesProblem): EnforcesWords {
  switch (problem.kind) {
    case 'wrong_place':
      return {
        message: `${problem.function} は kind: ${problem.fnKind}${problem.shape === '' ? '' : ` / shape: ${problem.shape}`} なので enforces を宣言できません`,
        suggestion:
          'enforces は定型に乗らない composite の関数が「どの writes の規則の執行点か」を名指す宣言である。' +
          '定型の update は本文が writes から生成されるので執行点が仕様から出る(宣言は要らない)。行を削除する',
      };
    case 'unknown_entity':
      return {
        message: `${problem.function} の enforces が名指す writes のエンティティ ${problem.writes} が、writes の宣言を持つ access_spec にありません`,
        suggestion: `writes に access_spec のエンティティを書く(いまある writes を持つエンティティ: ${listWords(problem.known)})`,
      };
    case 'no_rule':
      return {
        message: `${problem.function} の enforces が名指す ${problem.writes} の writes に by: ${problem.by} の規則がありません`,
        suggestion: `by に ${problem.writes} の access_spec の writes にある規則の by を書く(いまある by: ${listWords(problem.declared)})`,
      };
    case 'no_test_case':
      return {
        message: `${problem.function} の enforces の test_case ${problem.testCase} が表 ${problem.table} の test_cases にありません`,
        suggestion:
          'test_case にはその規則を守っていることを確かめる見張りテストの id を書く(同じ表の test_cases に宣言しておく)。' +
          '見張りテストを宣言していない手写しは宣言ではない',
      };
    case 'duplicate':
      return {
        message: `${problem.writes} の writes(by: ${problem.by})の執行点を ${problem.function} と ${problem.first} が両方名指ししています`,
        suggestion: '執行点は 1 つにする(2 つの関数が同じ規則を守ると言うと、どちらの本文が正か決まらない)。どちらかの enforces から削除する',
      };
  }
}

/** 候補の並び(空なら「なし」)。 */
function listWords(items: readonly string[]): string {
  return items.length === 0 ? 'なし' : items.join(' / ');
}

/**
 * 生成の前に回す検証(`generate` が自分で回す V 群)。
 *
 * 生成の入力は「**エラーなしで検証を通った仕様**」だけである。これが無いと、例えばパース不能な
 * ガードを持つ仕様から「ガード無し = 常に許可」の遷移テーブルが生成される fail-open の経路が
 * できてしまう(検証は数 ms なので常時実行する)。
 *
 * **充足性の判定器は `npm run verify` と同じものである。** ここだけ自作の列挙器に落とすと
 * V9 / V10 に正が 2 つできる —— 列挙器が `unknown` を返す式で非対称になり、「verify は恒偽と
 * 断じて error なのに、generate はそのまま生成を続ける」が静かに入る(C22 が繰り返し警戒して
 * いる「検査と生成が別の規則で決める」の裏返し。⑳-5c-b)。enforcement-matrix の C3 行が書いて
 * いる「`generate` は内部で同じ検証を先に実行する」を、字義どおりに保つための 1 か所である。
 *
 * **到達性(V21)だけは、ここでは見ない。** 生成を止めるのは error であり、V21 が出すのは
 * warning だけなので、解いても 1 件も止まらない —— 数百 KB のスクリプトを何十本も Z3 に
 * 流す十数秒を `generate` のたびに払うことになる。**黙って落とさない**ために母集合から
 * 明示的に外し(`GENERATION_VERIFIERS`)、外れていることを単体テストが実測する。
 * 到達性は `npm run verify` が見る(そこでは答えの表が必ず配線される)。
 */

import type { GuardServices } from '../guard/ast.js';
import type { SpecModel } from '../model/types.js';
import type { Finding } from '../kernel/finding.js';
import type { ProductRoots } from '../model/product/types.js';
import type { Verifier } from '../check-api/contract.js';
import { ALL_VERIFIERS } from './verifiers/index.js';
import { withZ3Satisfiability } from './z3-satisfiability.js';
import { REACHABILITY_VERIFIER_IDS } from './z3-reachability.js';

/**
 * **実装の木との突合**で error を出す検査の ID(生成を止めない)。
 *
 * `generate` は全群の検証(`runAllVerifications`)を回し、**error が 1 件でもあれば何も書かずに止まる**(`generationBlockers`)。
 * 例外はここに載せた検査だけである。これらは仕様を**実装の木**(テスト・Server Action・画面の経路・CSS・アダプタ・設定を読む実装)と
 * 突き合わせる検査で、突合先は生成の**後**にしか在らない(生成が作る、またはこれから手で書く)—— 仕様を足した直後は必ず赤くなり、
 * 止めると生成も実装も始められない(鶏と卵)。仕様だけで決まる error(名前の綴り・置き場・参照の欠落・スキーマ違反)は、ここに無いので全部止める。
 *
 * 載せるのは**実装の木を読む検査だけ**で、免除ではない(読み込み・綴り・参照の検査は載せない)。載せ忘れは単体テストが見る:
 * 実装の木が空の題材を検証して出る error は、検査 ID がここにあるか、指摘に `grounding: 'implementation'` の印があること(`generation-blockers.test.ts`)。
 *
 * **仕様だけで決まる指摘と実装との突合の指摘を同じ ID が出す検査**(A2 の置き場・G8 の宣言・H2 の着地・J2 の接地・V10 の執行点)は、ここに載せず、
 * 突合の側の指摘にだけ印(`Finding.grounding`)を付けた。印の付いた指摘は止めず、印の無い指摘(仕様の誤り)は止める。
 */
export const IMPLEMENTATION_COMPARISON_CHECK_IDS: readonly string[] = [
  // action_spec: テストの注釈・操作の閉世界・ガード環境
  'A6',
  'A10',
  'A11',
  'A12',
  'A14',
  'A16',
  // 視覚層: 実装の CSS が生値を書いていないか・引いたトークンが実在するか・宣言したトークンが引かれているか
  'G1',
  'G2',
  'G7',
  // 認証フロー・保証台帳・外部連携・ジョブ・設定: 実装・テスト・雛形・ホストの登録との突合
  'H3',
  'J3',
  'J4',
  'K1',
  'K2',
  'X1',
  'X4',
  'X6',
  'Z1',
  'Z3',
  // 読み取りクエリ・画面・テーブル・ユースケース: テストの注釈・実ルート・E2E との突合
  'Q6',
  'S7',
  'S8',
  'S11',
  'T3',
  'Y9',
];

/**
 * 生成の前に回す検証器の母集合(= V 群から到達性を外したもの)。
 *
 * 外す理由は上の冒頭のとおりである。**定数として出してあるのは、外れていることを
 * テストが実測できるようにするため**で、黙って範囲が縮んだ検査はここでは作らない。
 */
export const GENERATION_VERIFIERS: readonly Verifier[] = ALL_VERIFIERS.filter(
  (verifier) => !REACHABILITY_VERIFIER_IDS.includes(verifier.id),
);

/**
 * 生成を止めるエラー(V 群の error だけ)を集める。
 *
 * @param model 構築済みのドメイン仕様モデル
 * @param guards ガードサービス(充足性だけ Z3 に差し替えて使う)
 * @param roots 製品が宣言した根(検証器が道案内のパスを組み立てるのに使う)
 * @returns severity が error の Finding
 */
export async function generationBlockingErrors(
  model: SpecModel,
  guards: GuardServices,
  roots: ProductRoots,
): Promise<readonly Finding[]> {
  // この経路は action_spec / data_table を読まない(生成を止める判定のうち、他の種類を要る V16〜V19 は `verify` が受け持つ)。
  // 採っていない(未選択)のではなく**読み込みが行われていない**ので、阻害(not-loaded)として渡す —— 未選択と偽ると
  // 「入力に現れる欄は事実として無い」と読める。報告(実行ログ)は `npm run verify` の V 群が出す。
  const notLoaded = { state: 'blocked', reason: 'not-loaded', findings: [] } as const;
  const verified = await withZ3Satisfiability(model, { guards, roots, actions: notLoaded, dataTables: notLoaded });
  return GENERATION_VERIFIERS.flatMap((verifier) => verifier.verify(model, verified.ctx)).filter(
    (finding) => finding.severity === 'error',
  );
}

/**
 * 生成を止める error(全群の error のうち、実装の木との突合を除いたすべて)。
 *
 * @param findings `runAllVerifications` の全 Finding
 * @returns 生成を止める error。0 件なら生成してよい
 */
export function generationBlockers(findings: readonly Finding[]): readonly Finding[] {
  return findings.filter((finding) => finding.severity === 'error' && finding.grounding !== 'implementation' && !IMPLEMENTATION_COMPARISON_CHECK_IDS.includes(finding.verifier));
}

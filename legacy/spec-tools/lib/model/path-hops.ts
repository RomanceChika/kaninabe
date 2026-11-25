/**
 * `context` の連鎖を 1 段ずつ辿る純粋モジュール(束 ⑲-2a)。
 *
 * このファイルの責務は**経路の探索**(起点から相手のエンティティまで `context` を何段で辿れるか)
 * だけである。使い手は 4 本 —— 欄の解決 `path-resolve.ts`(探した経路の終点の欄を引く)・
 * 到達性の検査 V11(`verify/verifiers/v11-reachability.ts`。経路があるかだけを問う)・スコープ条件の列パス
 * の導出(`semantics/query-window-columns.ts`)・写しの列の参照パス(`ref-path.ts`)。後ろの 3 本は
 * 欄の解決を要らず経路探索だけを読むので、解決の規則とは別の部品として置いてある(一方向の依存:
 * `path-resolve.ts` がここを読み、ここは `path-resolve.ts` を読まない)。
 *
 * ## 経路は書き手ではなく解決器が探す
 *
 * 文脈依存ロールの `binding` は「対象のエンティティとその欄」を**1 度だけ**書くものであり、
 * どの集約から辿るかは集約ごとに違う —— `{相手}.{欄} == actor.id` は、ある集約から見れば
 * 1 段・別の集約から見れば中継を経由した 2 段である。だから 1 段で届かなければ中継を 1 つ探す。
 * 明示の連鎖(`{起点}.{中継}.{相手}.{欄}`)も同じ関数で辿れる。
 *
 * 1 段しか辿れなかったあいだ、木の各段に**写しの列**とそれを埋めるトリガと一致を守る
 * 不変条件が要っていた —— 階層の深さぶんの非正規化である(束 ⑱ の題材が実測)。
 *
 * ## 経路が 2 通りあれば探さない(断る)
 *
 * **中継が違えば指す行も違う。** 起点から同じ相手へ 2 通りの経路があるとき、宣言順で先に
 * 見つかった方を採ると、著者は何の警告も無く「意図と別の行を指す宣言」を得る(束 ⑲-2a の
 * レビューが実測: ある中継を意図した宣言が、宣言順で先に来る別の中継の先の行として解決された)。
 * だから曖昧なときは**選ばずに断る** —— どちらを通るかは書き手が決める。
 */

import type { EntitySpec, FieldDef, SpecModel } from './types.js';

/**
 * `context` を辿れるホップ数の上限。
 *
 * 2 段で止めるのは、**生成物が写せる形の上限**である —— スコープ条件は埋め込みの列パス、実行計画は
 * FactReader の逐次読みに落ちるが、どちらも段が増えるほど読む行が増える。3 段目が要るなら、
 * それは中継のエンティティを起点にすべき形である
 * (dsl-extension-triage.md の「表現力を買う前に、形を変える」)。
 */
export const MAX_CONTEXT_HOPS = 2;

/** 辿った 1 段の結果(次のエンティティ)、または断る理由。 */
export type HopResult =
  | { readonly kind: 'entity'; readonly entity: EntitySpec }
  | { readonly kind: 'error'; readonly reason: string };

/**
 * 宣言されたホップを順に辿る。
 *
 * ホップが手前のエンティティの `context` に**直接**無ければ、中継を 1 つ挟んで届くかを探す
 * (§経路は書き手ではなく解決器が探す)。届かなければ、直接辿ろうとしたときの理由を返す ——
 * 「context に無い」という言い方が、書き手にとって一番短い直し方になる。
 *
 * @param model ドメイン仕様全体
 * @param source 起点のエンティティ
 * @param hops パスが名指したホップ(最後のフィールドは含まない)
 * @param originLabel 起点を人間に示すときの呼び名
 * @returns 辿り着いたエンティティ、または断る理由
 */
export function walkHops(
  model: SpecModel,
  source: EntitySpec,
  hops: readonly string[],
  originLabel: string,
): HopResult {
  let current = source;
  let budget = MAX_CONTEXT_HOPS;
  for (const hop of hops) {
    const routes = contextRoutes(model, current, hop, budget);
    if (routes.length > 1) return ambiguousHop(current, hop, routes);
    const route = routes[0];
    if (route === undefined) return hopTo(model, current, hop, originLabel);
    for (const step of route) {
      const moved = hopTo(model, current, step, originLabel);
      if (moved.kind === 'error') return moved;
      current = moved.entity;
    }
    budget -= route.length;
  }
  return { kind: 'entity', entity: current };
}

/**
 * `from` から `target` へ `context` を辿る**最短の経路の全体**(エンティティ名の並びの並び)。
 *
 * 直接届けば 1 段だけを返す(直接の宣言があるなら、それが書き手の名指しである)。直接届かない
 * ときは、中継を 1 つ挟んで届く経路を**全部**返す —— 2 本以上あればその宣言は曖昧であり、
 * 呼び側は選ばずに断る(§経路が 2 通りあれば探さない)。
 *
 * @param model ドメイン仕様全体
 * @param from 起点のエンティティ
 * @param target 届きたいエンティティ名
 * @param budget 使える段数
 * @returns 辿るエンティティ名の並びの全体(届かなければ空)
 */
export function contextRoutes(
  model: SpecModel,
  from: EntitySpec,
  target: string,
  budget: number,
): readonly (readonly string[])[] {
  if (budget <= 0) return [];
  if (from.context[target] !== undefined) return [[target]];
  if (budget < 2) return [];
  return relayRoutes(model, from, target);
}

/**
 * `from` から `target` へ**中継を 1 つ挟んで**届く経路の全体(直接の宣言の有無は見ない)。
 *
 * `contextRoutes` は直接の宣言があればそれだけを返す —— 直接の宣言は書き手の名指しだからである。
 * だが「直接の宣言はあるが、その文脈ではその列の値が引けない」(まだ埋まっていない写しの列を
 * 根にしようとする場合など)は起こりうるので、中継の経路だけを別に列挙する口をここに置く
 * (使う側は `ref-path.ts`。**2 本以上あればどちらも選ばない**のは同じ)。
 *
 * @param model ドメイン仕様全体
 * @param from 起点のエンティティ
 * @param target 届きたいエンティティ名
 * @returns 「中継 → 相手」の並びの全体(無ければ空)
 */
export function relayRoutes(
  model: SpecModel,
  from: EntitySpec,
  target: string,
): readonly (readonly string[])[] {
  const routes: (readonly string[])[] = [];
  for (const mid of Object.keys(from.context)) {
    if (mid === target) continue;
    const next = findEntity(model, mid);
    if (next === null || next === from || next.context[target] === undefined) continue;
    routes.push([mid, target]);
  }
  return routes;
}

/**
 * `from` から `target` へ **一意に**辿れる経路(曖昧なら null。届かなくても null)。
 *
 * 生成器(スコープ条件の列パス)と検査が同じ規則を共有するための口である —— 検査が断る形を生成器が
 * 黙って 1 つ選ぶと、「verify は緑なのにスコープ条件が別の行を指す」という最も気づきにくい穴になる。
 *
 * @param model ドメイン仕様全体
 * @param from 起点のエンティティ
 * @param target 届きたいエンティティ名
 * @param budget 使える段数
 * @returns 辿るエンティティ名の並び(届かない・曖昧なら null)
 */
export function contextRoute(
  model: SpecModel,
  from: EntitySpec,
  target: string,
  budget: number,
): readonly string[] | null {
  const routes = contextRoutes(model, from, target, budget);
  return routes.length === 1 ? (routes[0] ?? null) : null;
}

/** 経路が 2 通り以上あるときに断る理由(どの中継を通るのかが決まらない)。 */
function ambiguousHop(from: EntitySpec, hop: string, routes: readonly (readonly string[])[]): HopResult {
  const shown = routes.map((route) => [from.entity, ...route].join(' → ')).join(' / ');
  return {
    kind: 'error',
    reason:
      `${from.entity} から ${hop} へ context を辿る経路が ${routes.length} 通りあります(${shown})` +
      `(中継が違えば指す行も違うので、${from.entity} の context に ${hop} への参照パスを直接宣言するか、` +
      `明示の連鎖(${from.entity}.{中継}.${hop}.{欄})でどちらを通るかを書いてください)`,
  };
}

/**
 * `context` の 1 段を辿る。
 *
 * 要求は 2 つある。**`context` に宣言があること**と、その参照パスが **`ref(次のエンティティ)` の
 * 欄**であること。2 つ目を見るのは、`context` の値が「どこから辿るか」の宣言でしかないためで、
 * 参照の欄でないもの(文字列の列など)を辿ると、生成される埋め込みの列パスも逐次読みも
 * 成り立たない(段を 1 つで止めていたあいだ、この形は問われなかった)。
 *
 * @param model ドメイン仕様全体
 * @param from 手前のエンティティ
 * @param hop 辿る相手のエンティティ名
 * @param originLabel 起点を人間に示すときの呼び名
 * @returns 次のエンティティ、または断る理由
 */
export function hopTo(model: SpecModel, from: EntitySpec, hop: string, originLabel: string): HopResult {
  const via = from.context[hop];
  if (via === undefined) {
    return {
      kind: 'error',
      reason:
        `${from.entity} の context に ${hop} がありません` +
        `(参照できるのは ${originLabel} のフィールドと context で解決できるパスだけです)`,
    };
  }
  const next = findEntity(model, hop);
  if (next === null) return { kind: 'error', reason: `エンティティ ${hop} が未定義です` };
  const column = columnOf(via);
  const def = column === undefined ? undefined : fieldOf(model, from.entity, column);
  if (def === undefined || def.type.kind !== 'ref' || findEntity(model, def.type.entity) !== next) {
    return {
      kind: 'error',
      reason:
        `${from.entity} の context の ${hop}(${via})は ${hop} への参照の欄ではありません` +
        '(段を辿るには ref({次のエンティティ}) の欄でなければなりません)',
    };
  }
  return { kind: 'entity', entity: next };
}

/**
 * `context` の値(`{自エンティティ}.{欄}`)から欄名を取る。
 *
 * 形の正は v2-context.ts であり、ここは辿るだけなので前置の無い書き方も欄名として読む。
 */
export function columnOf(via: string): string | undefined {
  const parts = via.split('.');
  return parts[parts.length - 1];
}

/**
 * エンティティ名(または集約ディレクトリ名)から entity_spec を引く。
 *
 * `lib/semantics/domain-lookup.ts` の `findEntitySpec` と同じ規則だが、そちらを import すると
 * model 層が query 層に依存してしまうため、ここが model 層の 1 つの正である
 * (`ref-path.ts` も道を辿るのにこれを使う)。
 */
export function findEntity(model: SpecModel, entity: string): EntitySpec | null {
  for (const [aggregate, specs] of model.aggregates) {
    const spec = specs.entity;
    if (spec === undefined) continue;
    if (spec.entity === entity || aggregate === entity) return spec;
  }
  return null;
}

/** そのエンティティの欄 1 つを引く(段を辿るとき、参照の型を見るために使う)。 */
function fieldOf(model: SpecModel, entity: string, field: string): FieldDef | undefined {
  return findEntity(model, entity)?.fields.find((candidate) => candidate.name === field);
}

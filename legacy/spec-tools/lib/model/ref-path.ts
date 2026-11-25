/**
 * 集約から集約への**参照の道**を探す純関数(`context:` の宣言を 1 段ずつ辿る)。
 *
 * 「対象の行から、別の集約の行へどう届くか」は 2 か所が要る —— RPC の本文(他集約の欄を
 * スカラー副問い合わせで辿る)と RLS のポリシー(文脈依存ロールの根拠まで EXISTS で辿る)である。
 * 同じ探索を 2 度書くと、片方だけが「2 段目を辿れる」ような食い違いが静かに入る。
 *
 * ## 道は `context:` の宣言が決める(生の `ref(...)` 欄を勝手に辿らない)
 *
 * 辿る道は `entity_spec` の `context:`(「この集約から誰へ、どの欄で届くか」の宣言)から取り、
 * 段の上限も経路が 2 通りあるときの断り方も `path-hops.ts` に委ねる —— 検査(V11)と生成器が
 * 別の規則で道を選ぶと、「**verify は緑なのに別の行を指す**」という最も気づきにくい穴になる
 * (path-hops.ts §経路が 2 通りあれば探さない)。
 *
 * 生の `ref(...)` 欄を宣言順に辿ると、**同じ相手を指す参照が 2 本ある形**で黙って先頭を選ぶ
 * ことになる(たとえば申請の行が申請者の欄と承認者の欄をどちらも同じ従業員の
 * `ref(…)` で持つ形であり、どちらを通るかは `context:` が列まで書いて決めている)。列の曖昧さを
 * 解いているのは `context:` の宣言だけなので、それを見ない探索は「書き手が決めたはずのこと」を
 * 探索器が上書きできてしまう。
 *
 * 段の各辺は `ref({次の集約})` の欄でなければならない —— 参照でない欄(写しの文字列など)を
 * 辿ると、スカラー副問い合わせも EXISTS の結合条件も成り立たない。届かなければ `null` を返し、
 * 呼び側は「写せない」と報告する(黙って別の行を指すより、生成しないほうを選ぶ)。
 *
 * ## 直接の宣言が使えない文脈では中継を探す(ただし 2 通りあれば断る)
 *
 * 直接の宣言(`context:` に相手が直接ある)を最優先する —— それが書き手の名指しである
 * (`contextRoutes` と同じ優先順)。ただし**その文脈でその列の値が引けない**ことがある ——
 * 作成の RPC は「まだ埋まっていない写しの列」を根にできない(値を書くのがトリガであれば、
 * insert の時点では引数にも行にも無い)。そのときだけ中継を 1 つ挟んだ経路を探し、
 * **使える経路が 2 通りあれば選ばずに `null`** を返す(検査が断る形を生成器が黙って
 * 1 つ選ばない)。どの根が使えるかは呼び側が `rootAllowed` で与える。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { FieldDef, SpecModel } from './types.js';
import { columnOf, findEntity, MAX_CONTEXT_HOPS, relayRoutes } from './path-hops.js';

/** 道の探索が使う、根の絞り込み(自集約が直に指す参照のうち、値が引ける列だけを根にする)。 */
export type RootFilter = (field: FieldDef) => boolean;

/**
 * `from` から `target` へ `context:` の宣言で届く道を探す。
 *
 * 返る道は**根から目的地の順**であり、`from` 自身は含まない(道の 1 つ目は `from` が
 * 直に指す集約である)。段の上限は `MAX_CONTEXT_HOPS`、経路が 2 通りあれば選ばずに `null`。
 *
 * @param domain ドメイン仕様
 * @param from 出発する集約
 * @param target 届きたい集約
 * @param rootAllowed 根に使ってよい参照列か(既定は全部)
 * @returns 集約名の道。届かない・曖昧・参照の欄で結べないなら `null`
 */
export function refPathTo(
  domain: SpecModel,
  from: string,
  target: string,
  rootAllowed: RootFilter = () => true,
): readonly string[] | null {
  const source = findEntity(domain, from);
  if (source === null) return null;
  if (source.context[target] !== undefined && usable(domain, from, [target], rootAllowed)) return [target];
  if (MAX_CONTEXT_HOPS < 2) return null;
  const relays = relayRoutes(domain, source, target).filter((route) => usable(domain, from, route, rootAllowed));
  return relays.length === 1 ? (relays[0] ?? null) : null;
}

/**
 * その経路が実際に辿れるか(各段が `ref(次の集約)` の欄で、根が使ってよい列であること)。
 *
 * @param domain ドメイン仕様
 * @param from 出発する集約
 * @param route 辿る集約名の並び
 * @param rootAllowed 根に使ってよい参照列か
 * @returns 辿れるなら true
 */
function usable(domain: SpecModel, from: string, route: readonly string[], rootAllowed: RootFilter): boolean {
  let current = from;
  for (const [index, step] of route.entries()) {
    const field = refField(domain, current, step);
    if (field === null) return false;
    if (index === 0 && !rootAllowed(field)) return false;
    current = step;
  }
  return true;
}

/**
 * `from` の側が `to` を指す参照列(`context:` が名指しした 1 本)。
 *
 * 同じ相手を指す参照欄が 2 本あっても宣言順で先頭を選ばない —— どちらを通るかは
 * `context:` の値(`{自集約}.{欄}`)が列まで書いて決めている。
 *
 * @param domain ドメイン仕様
 * @param from 参照を持つ側の集約
 * @param to 参照される側の集約
 * @returns 列名。`context:` に宣言が無い・参照の欄でないなら `null`
 */
export function refColumn(domain: SpecModel, from: string, to: string): string | null {
  return refField(domain, from, to)?.name ?? null;
}

/**
 * `from` の `context:` が `to` へ辿ると宣言している参照の欄。
 *
 * 宣言があることと、その欄が **`ref(to)` であること**の 2 つを見る(`hopTo` と同じ要求)。
 *
 * @param domain ドメイン仕様
 * @param from 参照を持つ側の集約
 * @param to 参照される側の集約
 * @returns フィールド定義。どちらかを欠けば `null`
 */
function refField(domain: SpecModel, from: string, to: string): FieldDef | null {
  const source = findEntity(domain, from);
  const target = findEntity(domain, to);
  const via = source === null ? undefined : source.context[to];
  if (source === null || target === null || via === undefined) return null;
  const column = columnOf(via);
  const field = column === undefined ? undefined : source.fields.find((candidate) => candidate.name === column);
  if (field === undefined || field.type.kind !== 'ref') return null;
  return findEntity(domain, field.type.entity) === target ? field : null;
}

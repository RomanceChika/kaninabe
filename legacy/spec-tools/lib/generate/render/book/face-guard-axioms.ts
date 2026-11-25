/**
 * 遷移に関係する公理(段の「出る手」と横断する遷移に添える「関係する公理」)。
 *
 * 引き方は 1 つだけ: 公理の `enforced_by` に **`kind: guard` で `{機械}.{イベント}` を名指した行**があること。
 * これは宣言の写しで、文章から推測しない(`statement` の中にイベント名が書いてあっても引かない — 導出が
 * 再現しなくなるため)。トリガは `before update of state` のように**状態の更新全体**に掛かり、特定の遷移を
 * 指さないので、遷移の関係には使わない。引けない遷移には何も足さない(発明しない)。
 *
 * 公理には、行の宿り先(`bf-axiom` の `id`)へ飛ぶリンクを付ける。短い形にまとめられる公理
 * (`uniqueness`)は 1 行に束ねられて `id` を持たないので、リンクを付けず公理の id だけを出す。
 */

import type { InvariantDef, SpecModel } from '../../../model/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { axiomAnchor } from './face-axioms.js';
import { bookLayout, hasFace } from './face-scope.js';

/** 遷移に関係する公理 1 本(リンク先が無いときは `href` が null)。 */
export interface GuardAxiom {
  readonly id: string;
  readonly href: string | null;
  /** リンク先(章の集約と、公理の行の `id`)。HTML の本は `href`(Markdown の章へのもの)でなくこちらから URL を作る。リンクが無ければ null。 */
  readonly target: { readonly chapter: string; readonly anchor: string } | null;
}

/** 公理が行ごとの `id` を持つか(一意性は 1 行に束ねられるので持たない)。 */
function hasAnchor(invariant: InvariantDef): boolean {
  return invariant.formal?.kind !== 'uniqueness';
}

/**
 * 遷移 1 つ(`{機械}.{イベント}`)に関係する公理を宣言順に返す。
 *
 * @param ref 機械名とイベント id を `.` でつないだ参照
 */
export function guardAxioms(model: SpecModel, ctx: GenerateContext, ref: string): GuardAxiom[] {
  const layout = bookLayout(model, ctx);
  const found: GuardAxiom[] = [];
  for (const [owner, specs] of model.aggregates) {
    for (const invariant of specs.invariants?.invariants ?? []) {
      if (!invariant.enforcedBy.some((point) => point.kind === 'guard' && point.ref === ref)) continue;
      const chapter = layout.chapterOf(owner);
      const linked = hasAnchor(invariant) && hasFace(model, ctx, chapter);
      found.push({
        id: invariant.id,
        href: linked ? `./${chapter}.md#${axiomAnchor(invariant.id)}` : null,
        target: linked ? { chapter, anchor: axiomAnchor(invariant.id) } : null,
      });
    }
  }
  return found;
}


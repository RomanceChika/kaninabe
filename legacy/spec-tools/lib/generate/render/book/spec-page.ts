/**
 * 新しい形の章(`docs/book/spec/{集約}.html` と入口の `spec/index.html`)の生成器 — 事実の層(`semantics/spec-book/`)から章を組む。
 *
 * 設計メモ `docs/design/book-as-spec/plan-generator.md` §5・§6 の束 1(縦串)の最初の一歩。**並置**の間は旧い集約の章
 * (`domain/*.html`)を無傷で残す。節は事実の層が揃った順に足す(いま: 流れ = 状態機械を持つ集約だけ・できること・見える範囲・
 * 決めごと)。語は `spec/words.ts`。
 *
 * 発火元(ジョブ・サインインの分岐・外から届く連携)は製品全体で 1 度集める。採ったのに読めなかったカタログは
 * `unread` に名指し、自動の判定を「確かめていない」に落とす(空に落とすと、発火元が無いのか見ていないのかを区別できない)。
 */

import type { GenerateContext } from '../../../gen-kit/generator.js';
import type { SpecModel } from '../../../model/types.js';
import { collectEventOrigins, type EventOrigins, type OriginSource } from '../../../semantics/spec-book/event-origins.js';

/** 章の頭の 1 行(並置の間の断り)。 */
export const SPEC_LEAD = '新しい形の章(試作の本番化の途中)。いまは「流れ」「できること」「見える範囲」「決めごと」の節だけで、ほかの節は旧い集約の章にある。';

/** 製品全体の発火元。 */
export function originsOf(model: SpecModel, ctx: GenerateContext): EventOrigins {
  const unread: OriginSource[] = [];
  if (ctx.jobs?.available === true && ctx.jobs.catalog === null) unread.push('jobs');
  if (ctx.auth?.available === true && ctx.auth.flow === null) unread.push('auth');
  if (ctx.external?.available === true && ctx.external.catalog === null) unread.push('external');
  return collectEventOrigins(model, {
    jobs: ctx.jobs?.catalog?.jobs ?? [],
    auth: ctx.auth?.flow ?? null,
    integrations: ctx.external?.catalog?.integrations ?? [],
    unread,
  });
}

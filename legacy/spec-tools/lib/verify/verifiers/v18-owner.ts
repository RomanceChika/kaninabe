/**
 * V18 の下位検査: 作成の**持ち主の欄**(action_spec の `owner: {集約}.{欄}`)の接地。
 *
 * `owner` は「作成者(実行者)そのものでこの欄を埋める」の明示の宣言で、作成で実行者が入る欄は、これ・ユースケースの
 * `defaults.self`・遷移の `records_actor` だけである。以前は「必須で入力に無い実行者への参照は作成者」を推測で当てて
 * いたが、数える母集合を変えるたびに漏れた(点検 8 回目 A8-1・9 回目 A9-1: 起案者を入力に出した代理作成で、
 * 残った査閲者の欄が黙って作成者で埋まった)ので、推測の仕組みごと無くして明示させる。宣言の無い実行者への参照の欄は
 * 実行計画が「値が仕様のどこにも無い」で止める(Y8 / A15)。
 *
 * ここが見るのは宣言の形の正しさだけである:
 *   (a) **作成**の action_spec(`handles: {集約}.create`)に書かれている(遷移・編集・削除は既存の行を書くので持ち主を作らない)
 *   (b) 作る集約の欄を指す(`{集約}` が handles の集約と同じ)
 *   (c) entity_spec に実在し、**`ref(実行者の集約)`** 型で、**必須**である(作成の RPC が実行者に縛る母集合 =
 *       必須か入力にある実行者への参照の欄。任意の欄を持ち主にすると縛りの外に落ちる)
 *   (d) 同じ操作の `input` にも `computes` にも無い(人が選ぶ値・純関数が決める値と、作成者は同時に成り立たない)
 *
 * 作成者がその欄の役を自分の行に持つことの受け入れは R2 が見る(`create_owner` の経路。欄 × 役を名指す `self_assign`)。
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../../model/types.js';
import type { ActionSpec } from '../../model/trace/types.js';
import { findEntitySpec } from '../../semantics/domain-lookup.js';
import { actorEntity } from '../../usecase/param-source-facts.js';
import type { Finding } from '../../kernel/finding.js';

/** この検証器の ID(計算値の接地と同じ、action_spec の値の出どころの宣言の接地)。 */
const VERIFIER_ID = 'V18';

/** 作成の操作のイベント名。 */
const CREATE_EVENT = 'create';

/** 指摘を組み立てる。 */
function finding(action: ActionSpec, message: string, suggestion: string): Finding {
  const owner = action.owner;
  return {
    verifier: VERIFIER_ID,
    severity: 'error',
    message: `${action.handles.raw} の owner ${owner?.raw ?? ''} は${message}`,
    location: owner?.location ?? action.location,
    suggestion,
    counterexample: { action: action.handles.raw, owner: owner?.raw ?? '' },
  };
}

/**
 * 1 つの action_spec の `owner` を見る。
 *
 * @param model ドメイン仕様
 * @param action action_spec
 * @returns 違反(宣言が無ければ空)
 */
export function ownerFindings(model: SpecModel, action: ActionSpec): Finding[] {
  const owner = action.owner;
  if (owner === undefined) return [];
  if (action.handles.event !== CREATE_EVENT) {
    return [finding(action, '作成でない操作に書かれています', 'owner は作成(handles: {集約}.create)の action_spec にだけ書ける。既存の行に実行者を書き留めるなら state_spec のそのイベントの records_actor を使う')];
  }
  if (owner.entity !== action.handles.machine) {
    return [finding(action, `作る集約(${action.handles.machine})の欄を指していません`, `owner は作る行の欄を "${action.handles.machine}.{欄}" の形で書く`)];
  }
  const field = findEntitySpec(model, owner.entity)?.fields.find((candidate) => candidate.name === owner.field);
  if (field === undefined) {
    return [finding(action, ' entity_spec に実在しません', `${owner.entity} の entity.md に ${owner.field} を足すか、owner の綴りを直す`)];
  }
  const actor = actorEntity(model);
  if (field.type.kind !== 'ref' || actor === null || field.type.entity !== actor) {
    return [finding(action, ` ref(${actor ?? '実行者の集約'}) 型ではありません`, 'owner に書けるのは実行者の集約への参照の欄だけである(作成者そのものを入れる欄)。純関数が決める値なら computes を使う')];
  }
  if (!field.required) {
    return [
      finding(
        action,
        '必須の欄ではありません',
        `${owner.entity} の entity.md の ${owner.field} を required: true にする(作成の RPC が実行者に縛るのは必須か入力にある実行者への参照の欄で、任意の持ち主の欄は縛りの外に落ちる)`,
      ),
    ];
  }
  const findings: Finding[] = [];
  if (action.input.some((ref) => ref.entity === owner.entity && ref.field === owner.field)) {
    findings.push(finding(action, '同じ操作の input にも現れます', '人が選ぶ欄(代理で作る相手・査閲者など)なら owner から外す。作成者そのものなら input から外す'));
  }
  if (action.computes.some((decl) => decl.entity === owner.entity && decl.field === owner.field)) {
    findings.push(finding(action, '同じ操作の computes にも現れます', '作成者そのものと純関数が決める値は同時に成り立たない。どちらかから外す'));
  }
  return findings;
}

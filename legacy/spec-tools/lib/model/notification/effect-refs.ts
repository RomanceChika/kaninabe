/**
 * `effects` に現れた副作用 ID の全数(前段の層。モデルを歩くだけの純関数)。
 *
 * `state_spec` の `effects` と `access_spec` の `writes[].effects` は、どちらも「outbox に積まれる副作用」の
 * 発火元である。ジョブカタログの閉世界(J1)・通知カタログの閉世界(N1)・ジョブ / 通知の本文の生成が、
 * **同じこの 1 本の走査**を読む(かつては J1 / N1 の検証器のファイルに同居していて、生成側が検証器を
 * 読む逆向きになっていた)。
 * 置き場が前段(`lib/model/`)なのは、製品の根の宣言の検査(P2。土台と前段だけを読む)も「ドメイン仕様が副作用を
 * 宣言しているか」を同じ走査で数えるためである。意味解析の層からは `lib/semantics/effect-refs.ts` が再輸出する。
 *
 * 後者(`writes[].effects`)は対応するドメインイベントを持たない(遷移ではない)ため、参照元は
 * `{entity}.update`(update-fields テンプレートの予約イベント ID。`_template/update-fields.ts`)と表す。
 */

import type { SpecModel } from '../types.js';
import type { SourceLocation } from '../../kernel/source-location.js';
import { NOTIFY_PREFIX } from './parse-notifications.js';

/** effects に現れた副作用 1 件(どのイベントが宣言したか付き)。 */
export interface EffectRef {
  /** 副作用 ID(ジョブ種別 / 通知 ID)。 */
  readonly id: string;
  /** 宣言しているドメインイベント ID(`{machine}.{event}`。`writes[].effects` は `{entity}.update`)。 */
  readonly event: string;
  /** 宣言している集約(エンティティ名)。積まれるジョブの payload は、この集約の行の ID を運ぶ。 */
  readonly aggregate: string;
  /** 宣言の位置。 */
  readonly location: SourceLocation;
}

/** `state_spec` の `effects` + `access_spec` の `writes[].effects` から、`accept` を通る副作用 ID を宣言順に集める。 */
function collectEffects(domain: SpecModel, accept: (id: string) => boolean): readonly EffectRef[] {
  const refs: EffectRef[] = [];
  for (const [directory, specs] of domain.aggregates) {
    const aggregate = specs.entity?.entity ?? directory;
    for (const machine of specs.stateMachines) {
      for (const effect of machine.effects) {
        for (const id of effect.do) {
          if (accept(id)) {
            refs.push({ id, event: `${machine.machine}.${effect.on}`, aggregate, location: effect.location });
          }
        }
      }
    }
    const access = specs.access;
    if (access === undefined) continue;
    for (const rule of access.writes) {
      for (const id of rule.effects ?? []) {
        if (accept(id)) refs.push({ id, event: `${access.entity}.update`, aggregate, location: rule.location });
      }
    }
  }
  return refs;
}

/**
 * `effects` に現れる副作用 ID をすべて集める(ジョブの母集合。**接頭辞で切らない**)。
 *
 * ジョブカタログは「outbox に積まれうるもの」の全数を宣言するので、`create_member_account` のような
 * 通知でない副作用も数える(それらが「積まれない」ことこそ宣言の対象である)。
 *
 * @param domain ドメイン仕様全体
 * @returns 宣言順の参照(同じ ID が複数イベント / writes 規則から宣言され得る)
 */
export function collectJobEffects(domain: SpecModel): readonly EffectRef[] {
  return collectEffects(domain, () => true);
}

/**
 * `effects` に現れる通知 ID をすべて集める(通知の母集合。`notify_` 接頭辞だけで判別する)。
 *
 * 接頭辞で切るのは、`create_member_account` のような通知でない副作用をカタログに要求しないためである。
 *
 * @param domain ドメイン仕様全体
 * @returns 宣言順の通知参照(同じ ID が複数イベント / writes 規則から宣言され得る)
 */
export function collectNotifyEffects(domain: SpecModel): readonly EffectRef[] {
  return collectEffects(domain, (id) => id.startsWith(NOTIFY_PREFIX));
}

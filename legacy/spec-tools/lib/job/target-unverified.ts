/**
 * 後段が**毎回名指す未検証**の契約(derive 層)。
 *
 * ホストやプラットフォームの本番の設定(IP 単位の流量制限など)は仕様から見えず、検査では確かめられない。見えないことを黙って緑にしないために、
 * 後段が「この条件のとき、これは見えていない」を登録し、実行ログが `R5: 未実施 — …` の 1 行で名指す(H5 が本番の設定を毎回名指すのと同じ語・同じ件数の数え方。
 * error でも warning でもなく、出荷を止めない)。コアは後段の名前も具体のスタックの語も持たず、**条件に使う事実(`AbuseExposure`)と行の形**だけを持つ。
 */

import type { AbuseExposure } from '../model/external/abuse-exposure.js';
import type { SelectedTarget } from './target-checks.js';

/** 後段が登録する未検証の名指し 1 件。 */
export interface TargetUnverified {
  /** 後段の中で一意の名前(テストと台帳の目印)。 */
  readonly id: string;
  /** 名指す文(文末。句点は付けない)。名指さないとき(この製品には当たらない)は null。 */
  note(exposure: AbuseExposure): string | null;
}

/** 名指す未検証 1 件(誰が・何を)。 */
export interface UnverifiedNote {
  /** 名指した後段の名前。 */
  readonly target: string;
  /** 名指した後段の役割。 */
  readonly role: SelectedTarget['role'];
  /** 名指す文(文末。句点は付けない)。 */
  readonly text: string;
}

/**
 * 選んだ後段の未検証の名指しを集める(後段の並び・後段の中の並びの順。当たらないものは出ない)。
 *
 * @param targets 選んだ後段
 * @param exposure 製品の濫用の口
 */
export function unverifiedNotesOf(targets: readonly SelectedTarget[], exposure: AbuseExposure): UnverifiedNote[] {
  return targets.flatMap((target) =>
    (target.unverified ?? []).flatMap((entry) => {
      const text = entry.note(exposure);
      return text === null ? [] : [{ target: target.id, role: target.role, text }];
    }),
  );
}

/**
 * 未検証の名指しの名前の空・重なり(後段の契約の検査が呼ぶ)。
 *
 * @param targets 選んだ後段
 */
export function unverifiedProblems(targets: readonly { readonly id: string; readonly unverified?: readonly TargetUnverified[] }[]): string[] {
  const problems: string[] = [];
  for (const target of targets) {
    const seen = new Set<string>();
    for (const entry of target.unverified ?? []) {
      if (entry.id.trim() === '') problems.push(`後段 ${target.id} の未検証の名指しに、名前(id)が空のものがあります`);
      else if (seen.has(entry.id)) problems.push(`後段 ${target.id} の未検証の名指し ${entry.id} が重なっています`);
      seen.add(entry.id);
    }
  }
  return problems;
}

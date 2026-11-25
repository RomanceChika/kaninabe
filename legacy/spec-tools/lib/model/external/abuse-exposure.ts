/**
 * 製品が**濫用の口**を持つか —— 未ログインに開いた作成と、有料の口(`spend: paid` かつ `endpoints` のある送信の連携)の有無。
 *
 * R5(`risk/verifiers/r5-abuse.ts` / `r5-paid.ts`)が見る対象と同じ導出(未ログインの到達は `anonymousReach`・有料の口は
 * `spend` と `endpoints`)を、ホストの後段が「IP 単位の流量制限は見えていない」と名指すかの判断に使う。流量制限を掛ける相手が
 * 製品に無ければ、名指す意味が無い。純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { ExternalCatalogSpec } from './types.js';
import type { SpecModel } from '../types.js';
import { anonymousReach } from '../data/ceiling-plan.js';

/** 濫用の口の有無(名前は仕様に書かれたもの。並びは仕様の並び)。 */
export interface AbuseExposure {
  /** 未ログインが作成できる集約(`creates[].by` が未ログインのロールの到達に入るもの)。 */
  readonly anonymousCreates: readonly string[];
  /** 有料の口を持つ連携(`spend` があり、ブラウザから叩かれる口 `endpoints` を持つ送信の連携)。 */
  readonly paidEndpoints: readonly string[];
}

/** 濫用の口が無い(何も名指さない)。 */
export const NO_ABUSE_EXPOSURE: AbuseExposure = { anonymousCreates: [], paidEndpoints: [] };

/**
 * 濫用の口を導く。
 *
 * @param model ドメイン仕様全体
 * @param external 外部連携カタログ(読めていなければ undefined = 有料の口は無いものとして数える)
 */
export function abuseExposureOf(model: SpecModel, external: ExternalCatalogSpec | undefined): AbuseExposure {
  const open = anonymousReach(model);
  const anonymousCreates = [...model.aggregates.values()].flatMap((specs) => {
    const access = specs.access;
    return access !== undefined && access.creates.some((rule) => open.has(rule.by)) ? [access.entity] : [];
  });
  const paidEndpoints = (external?.integrations ?? []).flatMap((integration) =>
    integration.direction === 'outbound' && integration.spend !== undefined && (integration.endpoints ?? []).length > 0 ? [integration.id] : [],
  );
  return { anonymousCreates, paidEndpoints };
}

/** 濫用の口が 1 つでもあるか。 */
export function hasAbuseExposure(exposure: AbuseExposure): boolean {
  return exposure.anonymousCreates.length > 0 || exposure.paidEndpoints.length > 0;
}

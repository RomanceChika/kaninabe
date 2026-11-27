/**
 * 実装の範囲の「持ち主の一覧」と「読めなかった種類」を、id と読み込みの成否から 1 つの関数で組み立てる。
 *
 * 持ち主を集める(`scopeOwners`)ところと、P14 が「仕様から消えた」と数えてよいかを決める読み込みの成否(`unloadedKinds`・`invariantsUnloaded`)は
 * 同じ材料から出るので、1 か所に置く(別々に組むと、持ち主は載っているのに成否は「読めた」になるなど、食い違いを作れる)。
 * **ここはモデルを見ない**(入力は id と真偽値だけ)。モデルから id を取り出すのは配線の側(`lib/compose/scope-owner-input.ts`)。
 */

import type { Finding } from '../kernel/finding.js';
import type { ScopeOwner } from '../kernel/scope-owner.js';
import type { SpecKind } from '../model/product/uses.js';
import { scopeOwners, unloadedKinds, type ScopeOwnerInput } from './owners.js';

/** 持ち主の一覧と読み込みの成否。 */
export interface ScopeUniverse {
  /** 持ち主の一覧(印の持ち主と `implemented` に書ける id の正)。 */
  readonly owners: readonly ScopeOwner[];
  /** 採ったのに error なく読めなかった種類。 */
  readonly unloaded: readonly SpecKind[];
  /** ドメイン仕様の読み込みに error があったか(不変条件の持ち主は種類を持たないので別の欄)。 */
  readonly invariantsUnloaded: boolean;
}

/** 組み立ての材料(持ち主の id・カタログの有無と、種類ごとの読み込みの成否)。 */
export interface ScopeUniverseInput extends ScopeOwnerInput {
  /** 種類ごとの「読み込みが error なく済んだか」(載っていない種類は済んだものとして扱う。`cleanLoad` で作る)。 */
  readonly clean: Readonly<Partial<Record<SpecKind, boolean>>>;
  /** ドメイン仕様の読み込みが error なく済んだか。 */
  readonly domainClean: boolean;
}

/**
 * 持ち主の一覧と読み込みの成否を組み立てる。
 *
 * @param input id と成否
 */
export function scopeUniverseOf(input: ScopeUniverseInput): ScopeUniverse {
  return {
    owners: scopeOwners(input),
    unloaded: unloadedKinds(input.uses, { ...input.clean, design_tokens: input.catalogs.designTokens }),
    invariantsUnloaded: !input.domainClean,
  };
}

/**
 * 種類の読み込みが error なく済んだか(読めた仕様があり、読み込みの error も落とした仕様も無い)。
 *
 * @param available 仕様を読めたか
 * @param loadFindings その種類の読み込みの指摘
 * @param dropped 読めずに落とした仕様の数
 */
export function cleanLoad(available: boolean, loadFindings: readonly Finding[], dropped: number): boolean {
  return available && dropped === 0 && !loadFindings.some((finding) => finding.severity === 'error');
}

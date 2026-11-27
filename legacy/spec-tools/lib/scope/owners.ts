/**
 * 実装の範囲の持ち主の一覧(`scopeOwners`)と、head で読めなかった種類(`unloadedKinds`)。
 *
 * **印(`absentFor`)の持ち主と、`implemented` に書ける id は、この 1 つの一覧から出る**(別の表を持たない)。印の付く id と書ける id が
 * 別の表だと、「書いたのに何にも当たらない id」が黙って通る。持ち主は、読めた仕様から集める:
 * 操作・読み取り・画面・表・use case の id、system 遷移の走査の event id、不変条件の id、カタログの id(ジョブ・認証フロー・保証台帳・
 * 外部連携・設定・デザイントークン)。読めなかった種類の持ち主は一覧に載らない(書かれた id は P13 が赤にする = 厳しい側)。
 */

import type { ScopeOwner } from '../kernel/scope-owner.js';
import { AUTH_FLOW_ID } from '../model/auth/parse-auth.js';
import { CONFIG_CATALOG_ID } from '../model/config/parse-config.js';
import { DESIGN_TOKENS_ID } from '../model/design/catalog-id.js';
import { EXTERNAL_CATALOG_ID } from '../model/external/parse-external.js';
import { GUARANTEE_CATALOG_ID } from '../model/guarantee/namespace.js';
import { JOB_CATALOG_ID } from '../model/job/parse-jobs.js';
import type { ProductUses, SpecKind } from '../model/product/uses.js';
import { usesKind } from '../model/product/uses.js';

/** 持ち主を集める材料(読めた仕様の id。読めなかった・採っていない種類は空か false)。仕様のモデルは持たない(id だけを受ける)。 */
export interface ScopeOwnerInput {
  readonly uses: ProductUses;
  readonly actionIds: readonly string[];
  /** system 遷移の走査の event id。 */
  readonly scanEvents: readonly string[];
  readonly queryIds: readonly string[];
  readonly screenIds: readonly string[];
  readonly tableIds: readonly string[];
  readonly usecaseIds: readonly string[];
  /** 不変条件の id(ドメイン仕様の持ち物。`uses` に依らない)。 */
  readonly invariantIds: readonly string[];
  /** 読めたカタログ(それぞれ 1 枚が読めたか)。 */
  readonly catalogs: {
    readonly jobs: boolean;
    readonly auth: boolean;
    readonly guarantees: boolean;
    readonly external: boolean;
    readonly config: boolean;
    readonly designTokens: boolean;
  };
}

/** 持ち主を集める(重複なし・集めた順)。 */
export function scopeOwners(input: ScopeOwnerInput): readonly ScopeOwner[] {
  const owners: ScopeOwner[] = [];
  const add = (kind: ScopeOwner['kind'], ids: readonly string[]): void => {
    for (const id of ids) if (!owners.some((owner) => owner.kind === kind && owner.id === id)) owners.push({ kind, id });
  };
  const uses = (kind: SpecKind): boolean => usesKind(input.uses, kind);
  if (uses('actions')) {
    add('action', input.actionIds);
    add('scan', input.scanEvents);
  }
  if (uses('queries')) add('query', input.queryIds);
  if (uses('screens')) add('screen', input.screenIds);
  if (uses('data_tables')) add('table', input.tableIds);
  if (uses('usecases')) add('usecase', input.usecaseIds);
  add('invariant', input.invariantIds);
  if (uses('jobs') && input.catalogs.jobs) add('catalog', [JOB_CATALOG_ID]);
  if (uses('auth') && input.catalogs.auth) add('catalog', [AUTH_FLOW_ID]);
  if (uses('guarantees') && input.catalogs.guarantees) add('catalog', [GUARANTEE_CATALOG_ID]);
  if (uses('external') && input.catalogs.external) add('catalog', [EXTERNAL_CATALOG_ID]);
  if (uses('config') && input.catalogs.config) add('catalog', [CONFIG_CATALOG_ID]);
  if (uses('design_tokens') && input.catalogs.designTokens) add('catalog', [DESIGN_TOKENS_ID]);
  return owners;
}

/** 持ち主を出す種類のうち、`id` を書くのに採る必要がある種類(`null` はドメイン仕様の持ち主で、`uses` に依らない)。 */
export function requiredUse(owner: ScopeOwner): SpecKind | null {
  switch (owner.kind) {
    case 'action':
    case 'scan':
      return 'actions';
    case 'query':
      return 'queries';
    case 'screen':
      return 'screens';
    case 'table':
      return 'data_tables';
    case 'usecase':
      return 'usecases';
    case 'invariant':
      return null;
    case 'catalog':
      return CATALOG_USES.get(owner.id) ?? null;
  }
}

/** カタログの id → 採る種類。 */
const CATALOG_USES: ReadonlyMap<string, SpecKind> = new Map<string, SpecKind>([
  [JOB_CATALOG_ID, 'jobs'],
  [AUTH_FLOW_ID, 'auth'],
  [GUARANTEE_CATALOG_ID, 'guarantees'],
  [EXTERNAL_CATALOG_ID, 'external'],
  [CONFIG_CATALOG_ID, 'config'],
  [DESIGN_TOKENS_ID, 'design_tokens'],
]);

/**
 * 持ち主を出す種類のうち、採ったのに head で error なく読めなかった種類(P14 が「仕様から消えた」と数えてよいかを決める)。
 *
 * @param uses 採る種類
 * @param clean 種類ごとの「読み込みが error なく済んだか」(持ち主を出す種類だけ。載っていない種類は読めたものとして扱う)
 */
export function unloadedKinds(uses: ProductUses, clean: Readonly<Partial<Record<SpecKind, boolean>>>): readonly SpecKind[] {
  return uses.filter((kind) => clean[kind] === false);
}

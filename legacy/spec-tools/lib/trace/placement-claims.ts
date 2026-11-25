/**
 * **操作・保存点・フォームの置き場の主張**を集める(A2 の続き `a2-placement-collision.ts` の材料)。
 *
 * 置き場の役割(`operation-entry` / `operation-composition` / `save-entry` / `save-composition` / `ui-component`)は「衝突したら失敗」(`onCollision: 'fail'`)と宣言している。
 * 宣言だけでは何も止まらないので、仕様から「この役割のこのキーの置き場を、この持ち主が取る」という主張を集めて、既存の衝突の一括検査
 * (`lib/model/product/layout-claims.ts` の `layoutClaimProblems`)に通す。J2 の続き(HTTP の入口の衝突)と同じ仕組みで、集める主張が違う。
 *
 * 集める主張:
 *   - 操作 1 つ(action_spec の `handles`)の組み立ての根 `operation-composition` … 持ち主は、`runner: manual` なら製品(手書き)・それ以外は操作の生成器
 *   - 操作 1 つの入口 `operation-entry` … 同じ持ち主。**システム専用のイベントは入口を持たない**(Server Action を生成しない)ので主張しない
 *   - 保存点 1 つ(usecase_spec)の入口 `save-entry`・組み立ての根 `save-composition`・1 画面フォーム `ui-component` … 持ち主は保存点・フォームの生成器
 *   - 受信の連携 1 件(external_spec の `direction: inbound`)の配線 `composition-root` … 持ち主は受信口の生成器(**役割をまたぐ主張**。操作の組み立ての根と
 *     同じ層の下に居て、集約名が土台のディレクトリ名と同じになると同じパスを取る)
 *
 * 出どころの文面(`source`)から仕様の位置を引く表も返す(検査が違反の位置にする)。純関数で throw しない。
 */

import type { SourceLocation } from '../kernel/source-location.js';
import type { LayoutClaim } from '../model/product/layout-claims.js';
import type { ExternalCatalogSpec } from '../model/external/types.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import type { UsecaseSpecModel } from '../model/usecase/types.js';
import type { SpecModel } from '../model/types.js';
import { isSystemOnlyOperation } from '../usecase/operation-plan-marks.js';
import { formFileNameFor, saveIdFor } from '../usecase/save-names.js';

/** 単発の操作の入口と組み立ての根を書く生成器の ID(コアの生成器 `code-operation-app` と同じ。`a2-placement-collision.test.ts` が食い違いを見る)。 */
export const OPERATION_APP_GENERATOR_ID = 'code-operation-app';

/** 保存点の入口と組み立ての根を書く生成器の ID(コアの生成器 `code-usecase-app` と同じ。同上)。 */
export const SAVE_APP_GENERATOR_ID = 'code-usecase-app';

/** 保存点の 1 画面フォームを書く生成器の ID(コアの生成器 `code-usecase-form` と同じ。同上)。 */
export const FORM_GENERATOR_ID = 'code-usecase-form';

/** 受信口と配線を書く生成器の ID(コアの生成器 `code-inbound-route` と同じ。同上)。 */
export const INBOUND_GENERATOR_ID = 'code-inbound-route';

/** 主張を集める材料(読み込めたものだけ。無いものは主張が無い)。 */
export interface PlacementClaimSources {
  /** ドメイン仕様(システム専用のイベントの判定)。 */
  readonly domain: SpecModel;
  /** 読み込めた action_spec(読めなければ undefined = 操作の主張が無い)。 */
  readonly actions: ActionSpecModel | undefined;
  /** 読み込めた usecase_spec(`available: false` ・未指定は保存点の主張が無い)。 */
  readonly usecases: UsecaseSpecModel | undefined;
  /** 読み込めた外部連携カタログ(読めなければ undefined = 受信の主張が無い)。 */
  readonly external: ExternalCatalogSpec | undefined;
}

/** 主張と、出どころの文面 → 仕様の位置。 */
export interface PlacementClaims {
  /** 主張の並び(操作 → 保存点 → 受信の順。宣言の並びのまま)。 */
  readonly claims: readonly LayoutClaim[];
  /** 出どころの文面 → 仕様の位置。 */
  readonly locations: ReadonlyMap<string, SourceLocation>;
}

/**
 * 置き場の主張を集める。
 *
 * @param sources 読み込めた仕様
 * @returns 主張と、出どころの位置
 */
export function placementClaimsOf(sources: PlacementClaimSources): PlacementClaims {
  const claims: LayoutClaim[] = [];
  const locations = new Map<string, SourceLocation>();
  const add = (claim: LayoutClaim, location: SourceLocation): void => {
    claims.push(claim);
    locations.set(claim.source, location);
  };
  for (const action of sources.actions?.actions ?? []) {
    const op = action.handles.raw;
    const owner = action.runner === undefined ? OPERATION_APP_GENERATOR_ID : 'product';
    const how = action.runner === undefined ? '' : '(runner: manual)';
    if (!isSystemOnlyOperation(sources.domain, op)) {
      add({ role: 'operation-entry', key: op, owner, source: `操作 ${op}${how} の Server Action` }, action.location);
    }
    add({ role: 'operation-composition', key: op, owner, source: `操作 ${op}${how} の組み立ての根` }, action.location);
  }
  for (const usecase of sources.usecases?.available === true ? sources.usecases.usecases : []) {
    for (const save of usecase.saves) {
      const key = saveIdFor(usecase.name, save.id);
      add({ role: 'save-entry', key, owner: SAVE_APP_GENERATOR_ID, source: `保存点 ${key} の Server Action` }, save.location);
      add({ role: 'save-composition', key, owner: SAVE_APP_GENERATOR_ID, source: `保存点 ${key} の組み立ての根` }, save.location);
      add({ role: 'ui-component', key: formFileNameFor(usecase.name, save.id), owner: FORM_GENERATOR_ID, source: `保存点 ${key} の 1 画面フォーム` }, save.location);
    }
  }
  for (const integration of sources.external?.integrations ?? []) {
    if (integration.direction !== 'inbound') continue;
    add({ role: 'composition-root', key: integration.id, owner: INBOUND_GENERATOR_ID, source: `外部連携 ${integration.id} の受信の配線` }, integration.location);
  }
  return { claims, locations };
}

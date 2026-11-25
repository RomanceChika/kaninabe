/**
 * Y 群・derive.ts の単体テストが共有する最小ドメイン(container → item)。
 *
 * container.create(member) → item.create(member。container_id は ref(container)) →
 * item.submit(member。draft → submitted)という、entry_self を単純化した形にしてある。
 * screen-list(container.create を発火)→ screen-detail(item.create / item.submit を発火)。
 */

import {
  accessSpec,
  aggregate,
  create,
  entitySpec,
  event,
  field,
  machine,
  role,
  roleSpec,
  specModel,
  stubGuards,
} from '../../helpers/model-builder.js';
import { actionSpec } from '../../helpers/trace-builder.js';
import { screenSpec } from '../../helpers/screen-builder.js';
import { loadedInput, UNSELECTED } from '../../helpers/verify-inputs.js';
import type { SpecModel } from '../../../lib/model/types.js';
import type { ActionSpecModel } from '../../../lib/model/trace/types.js';
import type { ScreenSpecModel } from '../../../lib/model/screen/types.js';
import type { AuthGateDecl, AuthSpecModel } from '../../../lib/model/auth/types.js';
import type { CatalogInput } from '../../../lib/kernel/input-state.js';
import type { UsecaseContext } from '../../../lib/usecase/verifier.js';
import type { UsecaseInput } from '../../../lib/usecase/derive.js';
import type { OperationCatalogs } from '../../../lib/semantics/operation-catalogs.js';
import type { UsecaseSpecModel } from '../../../lib/model/usecase/types.js';

/** ガード式の共有サービス(実物。V2 と同じスタブで `==` の比較まで解釈できる)。 */
export const USECASE_CTX: UsecaseContext = { guards: stubGuards(), dataTables: UNSELECTED, actions: UNSELECTED, reachabilityGaps: [] };

/** container(作成のみ) → item(作成 + 状態機械)の最小ドメイン。 */
export function testDomain(): SpecModel {
  return specModel(
    [
      aggregate('container', {
        entity: entitySpec('container', {
          fields: [field('id', { kind: 'uuid' }), field('title', { kind: 'string' }, { required: true })],
        }),
        access: accessSpec('container', { creates: [create('member')] }),
      }),
      aggregate('item', {
        entity: entitySpec('item', {
          fields: [
            field('id', { kind: 'uuid' }),
            field('container_id', { kind: 'ref', entity: 'container' }, { required: true }),
            field('name', { kind: 'string' }, { required: true }),
            field('state', { kind: 'state', machine: 'item' }),
          ],
        }),
        access: accessSpec('item', { creates: [create('member')] }),
        stateMachines: [
          machine('item', {
            states: ['draft', 'submitted'],
            initial: 'draft',
            events: [event('submit', { from: ['draft'], to: 'submitted', by: ['member'] })],
          }),
        ],
      }),
    ],
    roleSpec([role('member'), role('anonymous'), role('system')]),
  );
}

/** container.create / item.create / item.submit の action_spec。 */
export function testActions(): ActionSpecModel {
  return {
    actions: [
      actionSpec({ handles: 'container.create', input: ['container.title'] }),
      actionSpec({ handles: 'item.create', input: ['item.container_id', 'item.name'] }),
      actionSpec({ handles: 'item.submit', input: ['item.id'] }),
    ],
    unhandled: [],
    scans: [],
    unscanned: [],
    testTagBaseline: [],
  };
}

/** screen-list(container.create)→ screen-detail(item.create / item.submit)。 */
export function testScreens(): ScreenSpecModel {
  const list = screenSpec({
    name: 'list',
    for: ['member'],
    requiresAuth: true,
    entryPoint: true,
    actions: ['container.create'],
    navigations: [{ on: 'go_detail', to: 'screen-detail' }],
  });
  const detail = screenSpec({
    name: 'detail',
    for: ['member'],
    requiresAuth: true,
    actions: ['item.create', 'item.submit'],
  });
  return {
    available: true,
    screens: [list, detail],
    chromes: [],
    unexposed: [],
    unreachableStates: [],
    unseenStates: [],
  };
}

/** auth_spec 無し(gates 無し)。 */
export function testAuth(): AuthSpecModel {
  return { available: false, flow: null };
}

/** 関門の入力の状態(読込済み。既定は関門 0 本)。 */
export function testGates(gates: readonly AuthGateDecl[] = []): CatalogInput<readonly AuthGateDecl[]> {
  return loadedInput(gates);
}

/** UsecaseInput を組み立てる。省略した入力は上の既定フィクスチャ。 */
export function usecaseInput(init: {
  usecases: UsecaseSpecModel;
  domain?: SpecModel;
  actions?: ActionSpecModel | null;
  screens?: ScreenSpecModel;
  auth?: AuthSpecModel;
  gates?: CatalogInput<readonly AuthGateDecl[]>;
  catalogs?: OperationCatalogs;
}): UsecaseInput {
  return {
    domain: init.domain ?? testDomain(),
    usecases: init.usecases,
    actions: init.actions === undefined ? testActions() : init.actions,
    screens: init.screens ?? testScreens(),
    gates: init.gates ?? (init.auth === undefined ? testGates() : testGates(init.auth.flow?.gates ?? [])),
    catalogs: init.catalogs ?? {},
  };
}

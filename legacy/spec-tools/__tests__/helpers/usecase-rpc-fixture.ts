/**
 * 複合 RPC(束 ⑯c)の単体テストが共有する最小の世界。
 *
 * `_fixtures.ts`(Y 群の素の検査用)より 1 段だけ具体的で、**実行者に対応する集約**(`session: true` を
 * 持つ `owner`)と **data_table の関数宣言**(引数名つき)を持つ。Y8(引数の解決)と
 * 複合 RPC の生成器は、この 2 つが無いと何も判定できないためである。
 *
 * container(作成のみ・実行者を持ち主に持つ) → item(作成 + 状態機械)という形にしてあり、
 * entry_self を最小化したものになっている。
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
} from './model-builder.js';
import { actionSpec } from './trace-builder.js';
import { dataTable, dataTableModel } from './data-builder.js';
import type { SpecModel } from '../../lib/model/types.js';
import type { ActionSpecModel } from '../../lib/model/trace/types.js';
import type { DataTableSpec, DataTableSpecModel } from '../../lib/model/data/types.js';

/** `rpcDomain` の調整つまみ(規約の分岐を実行し分けるためだけのもの)。 */
export interface RpcDomainOptions {
  /**
   * `container.owner_id`(実行者への参照)を必須にするか。既定は true。
   * false にすると「必須で入力に無い」経路が消えるので、`defaults.self` の規約だけが
   * その欄を実行者に解決できる状態になる。
   */
  readonly ownerRequired?: boolean;
  /**
   * `item` に実行者への参照(`owner_id`)を持たせるか。既定は false。
   * true にすると「同じ表に行を作る 2 つの手順のうち、片方だけが実行者の行」という形が作れる
   * (再送の読み直しの絞り込みの規約を実行するための形)。
   */
  readonly itemOwner?: boolean;
}

/** owner(実行者)/ container / item の最小ドメイン。 */
export function rpcDomain(options: RpcDomainOptions = {}): SpecModel {
  return specModel(
    [
      aggregate('owner', {
        entity: entitySpec('owner', {
          fields: [
            field('id', { kind: 'uuid' }),
            field('name', { kind: 'string' }, { required: true, session: true }),
          ],
        }),
      }),
      aggregate('container', {
        entity: entitySpec('container', {
          fields: [
            field('id', { kind: 'uuid' }),
            field('owner_id', { kind: 'ref', entity: 'owner' }, { required: options.ownerRequired ?? true }),
            field('title', { kind: 'string' }, { required: true }),
          ],
        }),
        access: accessSpec('container', { creates: [create('member')] }),
      }),
      aggregate('item', {
        entity: entitySpec('item', {
          fields: [
            field('id', { kind: 'uuid' }),
            field('container_id', { kind: 'ref', entity: 'container' }, { required: true }),
            ...(options.itemOwner === true ? [field('owner_id', { kind: 'ref', entity: 'owner' })] : []),
            field('name', { kind: 'string' }, { required: true }),
            field('size', { kind: 'integer' }),
            field('state', { kind: 'state', machine: 'item' }),
          ],
        }),
        access: accessSpec('item', { creates: [create('member')] }),
        stateMachines: [
          machine('item', {
            states: ['draft', 'submitted'],
            initial: 'draft',
            events: [event('submit', { from: ['draft'], to: 'submitted', by: ['member'] })],
            effects: [
              {
                on: 'submit',
                do: ['notify_owner'],
                location: { file: 'docs/specs/domain/item/states.md', pointer: 'effects.submit' },
              },
            ],
          }),
        ],
      }),
    ],
    roleSpec([role('member'), role('anonymous'), role('system')]),
  );
}

/** container.create / item.create / item.submit の action_spec。 */
export function rpcActions(extra: { readonly containerOwner?: boolean; readonly itemOwner?: boolean } = {}): ActionSpecModel {
  return {
    actions: [
      actionSpec({
        handles: 'container.create',
        input: ['container.title', ...(extra.containerOwner === true ? ['container.owner_id'] : [])],
        // 持ち主の欄(作成者で埋める欄)は明示する(点検 9 回目 A9-1。入力に出す形では宣言しない)
        ...(extra.containerOwner === true ? {} : { owner: 'container.owner_id' }),
      }),
      actionSpec({
        handles: 'item.create',
        input: ['item.container_id', ...(extra.itemOwner === true ? ['item.owner_id'] : []), 'item.name', 'item.size'],
      }),
      actionSpec({ handles: 'item.submit', input: ['item.id'] }),
    ],
    unhandled: [],
    scans: [],
    unscanned: [],
    testTagBaseline: [],
  };
}

/** 錨の表(containers)の再送の宣言: 返すのは作成者(owner_id = 実行者)の行だけ。 */
export const OWN_CONTAINER: DataTableSpec['resend'] = {
  returnsExisting: true,
  creator: 'owner_id',
  location: { file: 'docs/specs/backend/data/tables/containers.md', pointer: 'resend' },
};

/**
 * containers / items の data_table(`kind: rpc` の引数名つき)。
 *
 * @param itemOwner `insert_item` に `p_owner_id`(実行者への参照)を持たせるか
 */
export function rpcDataTables(itemOwner = false, containerResend: DataTableSpec['resend'] = OWN_CONTAINER): DataTableSpecModel {
  return dataTableModel([
    dataTable('containers', {
      entity: 'container',
      resend: containerResend,
      functions: [
        {
          name: 'insert_container',
          args: ['uuid', 'uuid', 'jsonb', 'uuid'],
          params: ['p_id', 'p_owner_id', 'p_values', 'p_actor_id'],
          kind: 'rpc',
          shape: 'create',
          alsoWrites: [],
        },
      ],
    }),
    dataTable('items', {
      entity: 'item',
      functions: [
        {
          name: 'insert_item',
          args: itemOwner ? ['uuid', 'uuid', 'uuid', 'jsonb', 'uuid'] : ['uuid', 'uuid', 'jsonb', 'uuid'],
          params: itemOwner
            ? ['p_id', 'p_container_id', 'p_owner_id', 'p_values', 'p_actor_id']
            : ['p_id', 'p_container_id', 'p_values', 'p_actor_id'],
          kind: 'rpc',
          shape: 'create',
          alsoWrites: ['audits'],
        },
        {
          name: 'apply_item_transition',
          args: ['uuid', 'text', 'text', 'text[]', 'text', 'uuid'],
          params: ['p_item_id', 'p_expected_state', 'p_next_state', 'p_effects', 'p_event_id', 'p_actor_id'],
          kind: 'rpc',
          shape: 'transition',
          alsoWrites: ['outbox'],
        },
      ],
    }),
    // 保存点の再送の入力の要約の置き場(仕組みの表。点検 21 回目 A21-1。錨が既存の行を返す保存点は Y12 がこれを要る)。
    dataTable('resend_digests', { internal: true, framework: 'resend_digests', retentionHours: 24 }),
  ]);
}

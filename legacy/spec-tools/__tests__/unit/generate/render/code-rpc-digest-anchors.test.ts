/**
 * 消去の RPC の期待表に要約の錨の期待を写す口(`digestAnchorsLiteral`。点検 23 回目 A23-4)のテスト。
 * 対象は要約の表の錨の列を scrub_via に載せた RPC だけで、錨の消えうるかは行の消える定義(semantics/row-removal.ts)から引く。
 */

import { describe, expect, it } from 'vitest';
import { digestAnchorsLiteral } from '../../../../lib/generate/render/code-rpc-digest-anchors.js';
import type { DataFunctionDecl } from '../../../../lib/model/data/types.js';
import { dataTable } from '../../../helpers/data-builder.js';
import { aggregate, entitySpec, specModel } from '../../../helpers/model-builder-v8plus.js';

const fk = (column: string, references: string) => ({ column, references, onDelete: 'cascade' as const });
const erase = (scrubVia: Readonly<Record<string, readonly string[]>>): DataFunctionDecl => ({ name: 'erase_member', args: [], kind: 'rpc', shape: 'composite', alsoWrites: [], scrubVia }) as unknown as DataFunctionDecl;
const members = dataTable('members', { entity: 'member' });
const slots = dataTable('slots', { entity: 'slot', foreignKeys: [fk('owner_id', 'members')] });
const digests = dataTable('resend_digests', { internal: true, framework: 'resend_digests', retentionHours: 24 });
const model = specModel({ aggregates: [aggregate({ name: 'member', entity: entitySpec('member', []) }), aggregate({ name: 'slot', entity: entitySpec('slot', []) })] });
const SAVES = [{ event: 'usecase:s.register', anchor: 'slots', created: ['slots'] }];

describe('digestAnchorsLiteral', () => {
  it('要約の錨の列を scrub_via に載せた RPC に、保存点ごとの枝と消えうるかを写す', () => {
    expect(digestAnchorsLiteral(erase({ resend_digests: ['actor_id', 'entity_id'] }), members, [members, slots, digests], model, SAVES)).toEqual([
      { event: 'usecase:s.register', table: 'slots', branches: [{ from: 'slots', column: 'owner_id', up: 'id' }], removable: false },
    ]);
  });

  it('逆向きの枝(本人の表の列が錨を指す)には reverse: true を写し、順向きの枝には写さない(点検 24 回目 A24-2)', () => {
    const home = dataTable('members', { entity: 'member', foreignKeys: [fk('invited_via', 'invites')] });
    const invites = dataTable('invites', { entity: 'invite', foreignKeys: [fk('issued_by', 'members')] });
    expect(digestAnchorsLiteral(erase({ resend_digests: ['entity_id'] }), home, [home, invites, digests], model, [{ event: 'usecase:i.invite', anchor: 'invites', created: ['invites'] }])).toEqual([
      { event: 'usecase:i.invite', table: 'invites', branches: [{ from: 'invites', column: 'issued_by', up: 'id' }, { from: 'invites', column: 'invited_via', reverse: true, up: 'id' }], removable: false },
    ]);
  });

  it('錨の列を載せていない RPC・要約の表が無い製品には写さない', () => {
    expect(digestAnchorsLiteral(erase({ resend_digests: ['actor_id'] }), members, [members, slots, digests], model, SAVES)).toBeNull();
    expect(digestAnchorsLiteral(erase({ resend_digests: ['entity_id'] }), members, [members, slots], model, SAVES)).toBeNull();
  });
});

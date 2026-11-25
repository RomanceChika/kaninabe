/** 受信の署名の鍵の集め方(K6 が strength を求める相手)。 */

import { describe, expect, it } from 'vitest';
import { inboundSignatureKeys } from '../../../lib/config/inbound-keys.js';
import type { IntegrationDecl } from '../../../lib/model/external/types.js';
import { integration as buildIntegration } from '../../helpers/external-builder.js';

const make = (id: string, over = {}): IntegrationDecl =>
  buildIntegration(id, {
    service: 'billing', direction: 'inbound', effect: 'write', port: 'P', adapter: 'a.ts', config: ['K'], degrade: 'refuse', retry: 'none', idempotency: 'x',
    signature: 'hmac_sha256', signatureKey: 'KEY_A', eventIdTable: 't', emits: 'e.x', migration: 'm.sql', onConflict: 'retry', sends: { fields: [], text: 'x' }, summary: 's',
    ...over,
  });

describe('inboundSignatureKeys', () => {
  it.each([
    ['カタログなし', undefined, []],
    ['null', null, []],
    ['送信だけ', { integrations: [make('o', { direction: 'outbound' })] }, []],
    ['hmac の鍵', { integrations: [make('a')] }, ['KEY_A']],
    ['provider_sdk の鍵も', { integrations: [make('a', { signature: 'provider_sdk', signatureKey: 'KEY_B' })] }, ['KEY_B']],
    ['署名しない口は鍵を持たない', { integrations: [make('a', { signature: 'none', signatureReason: '社内' })] }, []],
    ['同じ鍵は 1 つに', { integrations: [make('a'), make('b')] }, ['KEY_A']],
    ['宣言順', { integrations: [make('a', { signatureKey: 'KEY_Z' }), make('b', { signatureKey: 'KEY_A' })] }, ['KEY_Z', 'KEY_A']],
  ])('%s', (_name, catalog, expected) => {
    expect(inboundSignatureKeys(catalog)).toEqual(expected);
  });
});

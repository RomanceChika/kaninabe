/**
 * **Axiom の adapter の公開の口の閉じた表**(fix27 項目 C。照らしの本体は `@kaninabe/adapter-postgrest/testing/closed-surface`)。
 *
 * DB の接続層に触らない adapter でも、公開の口の全部を表に載せる(adapter を足すたびに、生の接続層を返す口が黙って入らないように、
 * 仕組みの保証 `fw_connection_path_closed` の照らしは `framework/adapters/*` の全部を数える)。
 */

import { describe, expect, it } from 'vitest';
import { ownSurfaceProblems } from '@kaninabe/adapter-postgrest/testing/closed-surface';
import type * as Root from '../index';

/** 入口 → 口の名前 → 口の型。 */
export interface PublicSurface {
  '.': {
    AXIOM_DEFAULT_DOMAIN: typeof Root.AXIOM_DEFAULT_DOMAIN;
    AXIOM_DEFAULT_TIMEOUT_MS: typeof Root.AXIOM_DEFAULT_TIMEOUT_MS;
    AXIOM_MAX_BATCH: typeof Root.AXIOM_MAX_BATCH;
    axiomSinkFromValues: typeof Root.axiomSinkFromValues;
    createAxiomSink: typeof Root.createAxiomSink;
    AxiomEnvValues: Root.AxiomEnvValues;
    AxiomSinkOptions: Root.AxiomSinkOptions;
  };
}

describe('Axiom の adapter の公開の口は閉じている', () => {
  it('exports の全部の口が表に載り、どの口も生の道を返さず受け取らない', () => {
    expect(ownSurfaceProblems(import.meta.url)).toEqual([]);
  });
});

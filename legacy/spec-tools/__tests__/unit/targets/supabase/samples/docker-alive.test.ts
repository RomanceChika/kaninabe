/**
 * Docker の生存確認(`@kaninabe/runtime/testing/local/docker-alive.mts`。統合テストの globalSetup が
 * ローカル Supabase を起こす前に呼ぶ)の単体テスト。
 *
 * 見るのは 2 つである。
 *   1. **応答するなら黙って通ること**(`docker info` が返れば何も投げない)。
 *   2. **返らない・失敗したら 1 行で言い切って落ちること** —— 固まったデーモンの前で
 *      後段の CLI が黙って止まるのを防ぐ。上限(30 秒)を実装へ渡していることも確かめる。
 *
 * `docker info` を実行する実装は引数で受ける口なので、実物のコンテナは要らない。
 */

import { describe, expect, it } from 'vitest';
import {
  DOCKER_TIMEOUT_MS,
  DOCKER_UNRESPONSIVE_MESSAGE,
  assertDockerResponds,
} from '@kaninabe/runtime/testing/local/docker-alive';

describe('assertDockerResponds', () => {
  it('応答するなら何も投げず、既定の上限 30 秒を実装へ渡す', () => {
    const seen: number[] = [];
    expect(() => {
      assertDockerResponds({ run: (timeoutMs) => void seen.push(timeoutMs) });
    }).not.toThrow();
    expect(seen).toEqual([DOCKER_TIMEOUT_MS]);
    expect(DOCKER_TIMEOUT_MS).toBe(30_000);
  });

  it('返らない(タイムアウトで例外)なら、直し方つきの 1 行で落ちる', () => {
    const run = (): void => {
      throw new Error('spawnSync docker ETIMEDOUT');
    };
    expect(() => {
      assertDockerResponds({ run });
    }).toThrow(DOCKER_UNRESPONSIVE_MESSAGE);
    expect(DOCKER_UNRESPONSIVE_MESSAGE).toContain('open -a Docker');
    expect(DOCKER_UNRESPONSIVE_MESSAGE).not.toContain('\n');
  });

  it('上限は呼び出し側が変えられる', () => {
    const seen: number[] = [];
    assertDockerResponds({ timeoutMs: 5, run: (timeoutMs) => void seen.push(timeoutMs) });
    expect(seen).toEqual([5]);
  });
});

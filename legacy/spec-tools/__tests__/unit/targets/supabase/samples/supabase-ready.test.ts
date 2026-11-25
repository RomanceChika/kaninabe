/**
 * `supabase db reset` の直後に**surface が応答するまで待つ**ところの単体テスト
 * (`@kaninabe/runtime/testing/local/supabase-ready.mts`。統合テストの globalSetup と 4 題材の通し実行が共有する)。
 *
 * ここが見るのは 3 つである。
 *   1. **遅れて上がる口を待てること** —— 1 回目に落ちて 2 回目に 200 を返す口で緑になる。
 *   2. **上限を超えたら、どの口が応答しなかったかを報告すること** —— 黙って進むと、後段が
 *      Kong の 502(`An invalid response was received from the upstream server`)で落ち、
 *      テストの中身をいくら読んでも原因に辿り着かない(CI の `samples-db` が実際にそうなった)。
 *   3. **REST が応答していても認証が応答していなければ待つこと** —— この穴はまさに
 *      「REST は上がっているのに GoTrue が上がっていない」時間帯で起きる。
 *
 * 時計も `fetch` も引数で受ける口なので、実 DB もコンテナも要らない。
 */

import { describe, expect, it } from 'vitest';
import {
  describeWait,
  localServiceProbes,
  waitForServices,
  type ServiceProbe,
} from '@kaninabe/runtime/testing/local/supabase-ready';

/** 叩く口 2 つ(名前だけで区別できれば足りる)。 */
const PROBES: readonly ServiceProbe[] = [
  { name: 'REST', url: 'http://local/rest/v1/' },
  { name: '認証', url: 'http://local/auth/v1/health' },
];

/** 呼ばれた順に答えを返す `fetch`(url → 返す status の並び)。 */
function scriptedFetch(script: Readonly<Record<string, readonly number[]>>): {
  readonly impl: typeof fetch;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const counts = new Map<string, number>();
  const impl = ((input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    const seen = counts.get(url) ?? 0;
    counts.set(url, seen + 1);
    const statuses = script[url] ?? [200];
    const status = statuses[Math.min(seen, statuses.length - 1)] ?? 200;
    return Promise.resolve(new Response(null, { status }));
  }) as typeof fetch;
  return { impl, calls };
}

/** 時間を進める偽の時計(待つたびに進む)。 */
function fakeClock(): { readonly now: () => number; readonly sleep: (ms: number) => Promise<void> } {
  let current = 0;
  return {
    now: () => current,
    sleep: (ms: number) => {
      current += ms;
      return Promise.resolve();
    },
  };
}

describe('ローカル Supabase の面が応答するまで待つ', () => {
  it('遅れて上がる口は待って緑になる(2 回目で 200)', async () => {
    const { impl } = scriptedFetch({ 'http://local/auth/v1/health': [503, 200] });
    const clock = fakeClock();
    const result = await waitForServices({
      probes: PROBES,
      apiKey: 'test-key',
      options: { fetchImpl: impl, now: clock.now, sleep: clock.sleep, intervalMs: 1_000 },
    });
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    // 1 回目に落ちたぶんだけ待っている(待ちが 0 秒なら「待ち合わせをしていない」と同じ)。
    expect(result.waitedMs).toBe(1_000);
  });

  it('REST が応答していても認証が応答していなければ待つ', async () => {
    const { impl, calls } = scriptedFetch({ 'http://local/auth/v1/health': [502, 502, 200] });
    const clock = fakeClock();
    const result = await waitForServices({
      probes: PROBES,
      apiKey: 'test-key',
      options: { fetchImpl: impl, now: clock.now, sleep: clock.sleep, intervalMs: 500 },
    });
    expect(result.ok).toBe(true);
    expect(result.waitedMs).toBe(1_000);
    expect(calls.filter((url) => url.endsWith('/auth/v1/health'))).toHaveLength(3);
  });

  it('上限を超えたら、どの口が応答しなかったかを報告して赤くなる', async () => {
    const { impl } = scriptedFetch({ 'http://local/auth/v1/health': [502] });
    const clock = fakeClock();
    const result = await waitForServices({
      probes: PROBES,
      apiKey: 'test-key',
      options: { fetchImpl: impl, now: clock.now, sleep: clock.sleep, intervalMs: 1_000, timeoutMs: 3_000 },
    });
    expect(result.ok).toBe(false);
    expect(result.waitedMs).toBe(3_000);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain('認証');
    expect(result.problems[0]).toContain('502');
    const lines = describeWait(result, 3_000);
    expect(lines[0]).toContain('3 秒以内に応答しませんでした');
    expect(lines.join('\n')).toContain('認証');
  });

  it('繋がらない口は例外の理由をそのまま診断に載せる', async () => {
    const impl = ((): Promise<Response> => Promise.reject(new Error('ECONNREFUSED'))) as typeof fetch;
    const clock = fakeClock();
    const result = await waitForServices({
      probes: [{ name: 'REST', url: 'http://local/rest/v1/' }],
      apiKey: 'test-key',
      options: { fetchImpl: impl, now: clock.now, sleep: clock.sleep, intervalMs: 1_000, timeoutMs: 0 },
    });
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('ECONNREFUSED');
  });

  it('叩く口は REST と認証の 2 つで、末尾のスラッシュは重ねない', () => {
    expect(localServiceProbes('http://local/')).toEqual([
      { name: 'REST(PostgREST)', url: 'http://local/rest/v1/' },
      { name: '認証(GoTrue)', url: 'http://local/auth/v1/health' },
    ]);
  });
});

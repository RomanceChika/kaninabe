/**
 * 口が閉じる要求で何にも触れずに閉じたかを観測する道具(`@kaninabe/runtime/testing/http/route-isolation`)のテスト。
 *
 * 生成した配線の見張りテストは、この道具で「閉じる要求で、外へ呼ばず・認証の文脈に触れず・本文を読まず、関門と同じ応答で閉じる」ことを見る。
 * ここでは道具そのものが**閉じていない実装を閉じていないと言う**ことを、実装の形の負例で固定する ——
 *   ①関門を後置した実装(認証を先に呼んでから関門の結果を返す)
 *   ②関門の結果を捨てる実装(関門を呼ぶが、その戻り値を返さずに本体へ進む)
 *   ③関門をコメントに書いただけの実装(奥の守りが別の形の 403 で閉じるものを含む)
 *   ④関門より先に本文を読む実装 / 外へ呼ぶ実装
 * と、正しい 2 つの書き方(`??` で返す・`if` で返す)が閉じ、同じオリジンの要求(フォームの送信・fetch)では本体へ進む対照。
 *
 * 口の依存は**引数で渡す**(この仕組みはモジュールの差し替えを禁じている)。認証は「要求の文脈の外では例外を投げる」もの、
 * 本体は「外へ呼ぶ」もの、奥の守りは「出どころを自分でも確かめ、別の形の 403 を返す」もの(セッションの adapter の形)として作る。
 */

import { describe, expect, it } from 'vitest';
import { installNetworkProbe, observeHandler, passedGuard, refusalLeaks, refusalShapeOf } from '@kaninabe/runtime/testing/http/route-isolation';
import type { RefusalShape } from '@kaninabe/runtime/testing/http/route-isolation';
import { crossOriginRefusal, isSameOriginRequest, refuseCrossOrigin } from '../request-origin';
import type { BrowserDefensePolicy } from '../browser-defense';

/** 見本の宣言(関門が読むのはキャッシュの禁止だけ)。 */
const POLICY: BrowserDefensePolicy = {
  headers: [],
  csp: { directives: [], nonceDirectives: [], development: [] },
  noStore: { name: 'Cache-Control', value: 'no-store' },
  clearSiteData: { name: 'Clear-Site-Data', value: '"cache", "cookies", "storage"' },
};

/** 口の依存(引数で渡す)。 */
interface Dependencies {
  /** 認証(要求の文脈の外では例外を投げる。`cookies()` を読む形)。 */
  readonly resolveActorId: () => Promise<string>;
  /** 本体(外へ呼んでから 303 を返す)。 */
  readonly handle: (request: Request) => Promise<Response>;
  /** 奥の守り(出どころを自分でも確かめ、閉じるときは本文の無い 403。セッションの adapter の形)。 */
  readonly guardedInside: (request: Request) => Promise<Response>;
}

/** 依存の見本。 */
const DEPS: Dependencies = {
  resolveActorId: () => Promise.reject(new Error('`cookies` was called outside a request scope')),
  handle: async () => {
    await fetch('/api/x').catch(() => undefined);
    return new Response(null, { status: 303 });
  },
  guardedInside: async (request) => (isSameOriginRequest(request) ? DEPS.handle(request) : new Response(null, { status: 403 })),
};

/** 口の書き方。 */
type HandlerShape = (request: Request) => Promise<Response>;

/** 正しい書き方 2 つ。 */
const CORRECT: Readonly<Record<string, HandlerShape>> = {
  coalesce: async (request) => refuseCrossOrigin(request, POLICY) ?? (await DEPS.guardedInside(request)),
  ifReturn: async (request) => {
    const refused = refuseCrossOrigin(request, POLICY);
    if (refused !== null) return refused;
    await DEPS.resolveActorId();
    return DEPS.handle(request);
  },
};

/** 閉じていない書き方(どれも閉じる要求で 403 を返しうるが、何かに触れるか、関門でないものが閉じる)。 */
const BROKEN: Readonly<Record<string, HandlerShape>> = {
  // ①関門の後置: 認証を先に呼んでから、関門の結果を返す
  guardAfterAuth: async (request) => {
    await DEPS.resolveActorId();
    return refuseCrossOrigin(request, POLICY) ?? DEPS.handle(request);
  },
  // ②関門の結果を捨てる
  guardResultDiscarded: async (request) => {
    refuseCrossOrigin(request, POLICY);
    return DEPS.handle(request);
  },
  // ③関門をコメントに書いただけ: refuseCrossOrigin(request, POLICY)
  guardInCommentOnly: async (request) => DEPS.handle(request),
  // ③コメントだけで、奥の守りが別の形の 403 で閉じる(戻り値は 403 なので、状態だけを見ると緑になる形)
  innerGuardOnly: async (request) => DEPS.guardedInside(request),
  // ④関門より先に本文を読む
  bodyReadFirst: async (request) => {
    await request.text();
    return refuseCrossOrigin(request, POLICY) ?? new Response(null);
  },
  // ④関門より先に外へ呼ぶ
  fetchFirst: async (request) => {
    await fetch('/api/x').catch(() => undefined);
    return refuseCrossOrigin(request, POLICY) ?? new Response(null);
  },
};

/** 出どころを確かめられない要求(他のサイトから・出どころが無い)。 */
function untrusted(): Request[] {
  return [
    new Request('https://app.example/api/x', { method: 'POST', headers: { host: 'app.example', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, body: 'x' }),
    new Request('https://app.example/api/x', { method: 'POST', headers: { host: 'app.example' }, body: 'x' }),
  ];
}

/** 同じオリジンのページからの要求(フォームの送信・fetch)。 */
function trusted(): Request[] {
  const page = { host: 'app.example', origin: 'https://app.example', 'sec-fetch-site': 'same-origin' };
  return [
    new Request('https://app.example/api/x', { method: 'POST', headers: { ...page, 'sec-fetch-mode': 'navigate', 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1' }),
    new Request('https://app.example/api/x', { method: 'POST', headers: { ...page, 'sec-fetch-mode': 'cors', 'content-type': 'application/json' }, body: '{}' }),
  ];
}

/** 口を全部の要求で観測し、理由を集める(観測の口は必ず戻す)。 */
async function leaksOf(handler: HandlerShape, requests: readonly Request[], refusal: RefusalShape): Promise<readonly string[]> {
  const probe = installNetworkProbe();
  try {
    const reasons: string[] = [];
    for (const request of requests) reasons.push(...refusalLeaks(await observeHandler(handler, request, probe, refusal), refusal));
    return reasons;
  } finally {
    probe.dispose();
  }
}

describe('route-isolation(口が閉じる要求で何にも触れずに閉じたかを観測する)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-BROWSER-008
  it('関門を後置した実装・関門の結果を捨てる実装・コメントに書いただけの実装・先に本文や外部に触れる実装は、閉じていないと判定する', async () => {
    const refusal = await refusalShapeOf(crossOriginRefusal(POLICY));
    const verdicts: Record<string, readonly string[]> = {};
    for (const [name, handler] of Object.entries(BROKEN)) verdicts[name] = await leaksOf(handler, untrusted(), refusal);
    expect(verdicts['guardAfterAuth']).toContain('threw:`cookies` was called outside a request scope');
    expect(verdicts['guardResultDiscarded']).toEqual(expect.arrayContaining(['status:303', 'touched:fetch:relative']));
    expect(verdicts['guardInCommentOnly']).toEqual(expect.arrayContaining(['status:303', 'touched:fetch:relative']));
    expect(verdicts['innerGuardOnly']).toContain('not-guard-refusal');
    expect(verdicts['bodyReadFirst']).toContain('body-read');
    expect(verdicts['fetchFirst']).toContain('touched:fetch:relative');
    for (const [name, reasons] of Object.entries(verdicts)) expect(reasons.length, name).toBeGreaterThan(0);
  });

  it('正しい 2 つの書き方は、閉じる要求で何にも触れずに関門と同じ応答を返し、同じオリジンの要求では本体へ進む(対照)', async () => {
    const refusal = await refusalShapeOf(crossOriginRefusal(POLICY));
    for (const [name, handler] of Object.entries(CORRECT)) {
      expect(await leaksOf(handler, untrusted(), refusal), name).toEqual([]);
      const probe = installNetworkProbe();
      try {
        for (const request of trusted()) expect(passedGuard(await observeHandler(handler, request, probe, refusal), refusal), name).toBe(true);
      } finally {
        probe.dispose();
      }
    }
  });

  it('行き先はホストだけを記録し、重複は 1 本にする。戻り値が応答でなければ状態は null', async () => {
    const refusal = await refusalShapeOf(crossOriginRefusal(POLICY));
    const probe = installNetworkProbe();
    try {
      const handler = async (): Promise<unknown> => {
        await fetch('/api/c').catch(() => undefined);
        await fetch('/api/d').catch(() => undefined);
        return 'not a response';
      };
      const observed = await observeHandler(handler, new Request('https://app.example/'), probe, refusal);
      expect(observed).toEqual({ status: null, refusalBody: null, thrown: null, touched: ['fetch:relative'], bodyUsed: false });
      expect(refusalLeaks(observed, refusal)).toEqual(['status:null', 'touched:fetch:relative']);
    } finally {
      probe.dispose();
    }
  });

  it('観測の口を戻したあとは記録しない(戻すのは 1 度だけ効く)', async () => {
    const probe = installNetworkProbe();
    probe.dispose();
    probe.dispose();
    await expect(DEPS.handle(new Request('https://app.example/'))).resolves.toBeInstanceOf(Response);
    expect(probe.touched()).toEqual([]);
  });
});

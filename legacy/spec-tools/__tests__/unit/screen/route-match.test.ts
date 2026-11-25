/**
 * リクエスト前段の保護範囲(`matcher`)の変換規則(lib/screen/route-match.ts)のテスト。
 *
 * 対象の要求: 「matcher が静的に解釈できるかを判定し、覆っているかを安全側で答える」。
 * ファイル配置 → ルートの逆引きは置き場の配置の値になった(`targets/nextjs/screen-shell.test.ts`)。
 */

import { describe, expect, it } from 'vitest';
import { isParsableMatcher, matcherCovers } from '../../../lib/screen/route-match.js';

describe('isParsableMatcher', () => {
  it('リテラルと :name / :name* / :name+ / :name? だけなら解釈できる', () => {
    expect(isParsableMatcher('/workshops')).toBe(true);
    expect(isParsableMatcher('/workshops/:path*')).toBe(true);
    expect(isParsableMatcher('/workshops/:id')).toBe(true);
    expect(isParsableMatcher('/workshops/:id?')).toBe(true);
    expect(isParsableMatcher('/workshops/:path+')).toBe(true);
  });

  it('正規表現つき・スラッシュ始まりでないものは解釈できない', () => {
    expect(isParsableMatcher('/settings/:id(\\d+)')).toBe(false);
    expect(isParsableMatcher('/((?!api|x[0-9]).*)')).toBe(false);
    expect(isParsableMatcher('/((?!api).*)/x')).toBe(false);
    expect(isParsableMatcher('workshops')).toBe(false);
  });
});

describe('matcherCovers', () => {
  it(':path* は親ルートも子ルートも覆う', () => {
    expect(matcherCovers('/workshops/:path*', '/workshops')).toBe(true);
    expect(matcherCovers('/workshops/:path*', '/workshops/:id')).toBe(true);
    expect(matcherCovers('/workshops/:path*', '/workshops/:id/edit')).toBe(true);
  });

  it('リテラルどうしは完全一致だけ覆う', () => {
    expect(matcherCovers('/workshops', '/workshops')).toBe(true);
    expect(matcherCovers('/workshops', '/workshops/:id')).toBe(false);
    expect(matcherCovers('/workshops', '/login')).toBe(false);
  });

  it(':name は 1 セグメントちょうど、:name+ は 1 つ以上を覆う', () => {
    expect(matcherCovers('/workshops/:id', '/workshops/:id')).toBe(true);
    expect(matcherCovers('/workshops/:id', '/workshops')).toBe(false);
    expect(matcherCovers('/workshops/:path+', '/workshops')).toBe(false);
    expect(matcherCovers('/workshops/:path+', '/workshops/:id/edit')).toBe(true);
  });

  it('動的セグメントはリテラルに一致しない(安全側に倒す)', () => {
    // 実行時に何が入るか分からない以上、「覆っているかもしれない」を覆っている扱いにしない。
    expect(matcherCovers('/workshops/detail', '/workshops/:id')).toBe(false);
  });
});

describe('「接頭辞を除く全部」の形(生成したリクエスト前段の matcher)', () => {
  const pattern = '/((?!api/|_next/static/|favicon.ico).*)';

  it('解釈でき、除く接頭辞で始まらない route を覆う(根の / も覆う)', () => {
    expect(isParsableMatcher(pattern)).toBe(true);
    expect(matcherCovers(pattern, '/')).toBe(true);
    expect(matcherCovers(pattern, '/rooms/:id')).toBe(true);
    expect(matcherCovers(pattern, '/apiary')).toBe(true);
  });

  it('除く接頭辞で始まる route は覆わない(正規表現の . は任意の 1 文字として比べる)', () => {
    expect(matcherCovers(pattern, '/api/x')).toBe(false);
    expect(matcherCovers(pattern, '/faviconXico')).toBe(false);
  });

  it('生成した形(エスケープ・終端つき。6 回目 B6-3): 完全一致の項は、その URL ちょうどだけを覆わない', () => {
    const generated = '/((?!api/|_next/static/|favicon\\.ico$).*)';
    expect(isParsableMatcher(generated)).toBe(true);
    expect(matcherCovers(generated, '/favicon.ico')).toBe(false);
    expect(matcherCovers(generated, '/favicon.ico/x')).toBe(true);
    expect(matcherCovers(generated, '/favicon.icoX')).toBe(true);
    expect(matcherCovers(generated, '/faviconXico')).toBe(true);
    expect(matcherCovers(generated, '/api/x')).toBe(false);
    expect(matcherCovers(generated, '/:id')).toBe(false);
  });

  it.each([
    ['エスケープの後ろが . でない', '/((?!a\\d).*)'],
    ['途中の $', '/((?!a$b).*)'],
    ['空の項', '/((?!a|).*)'],
    ['$ だけ', '/((?!$).*)'],
  ])('読めない項(%s)は解釈できない', (_name, pattern) => {
    expect(isParsableMatcher(pattern)).toBe(false);
  });

  it('動的なセグメントに差しかかる route は、除く接頭辞で始まりうるので覆わない(安全側)', () => {
    expect(matcherCovers('/((?!users/admin).*)', '/users/:id')).toBe(false);
    expect(matcherCovers('/((?!users/admin).*)', '/teams/:id')).toBe(true);
  });
});

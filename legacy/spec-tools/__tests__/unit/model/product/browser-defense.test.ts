/**
 * ブラウザ側の守りの宣言の床(`lib/model/product/browser-defense.ts` の `browserDefenseProblems`)のテスト。
 *
 * 固定するのは 4 点 —— ①Next.js の値は床を満たす ②固定のヘッダの欠落・弱めた値(HSTS の寿命・サブドメイン・nosniff・Referrer-Policy・枠)と、
 * 固定のヘッダに CSP / CORS を置くことは止まる ③スクリプトの CSP の床(nonce・strict-dynamic・object-src / base-uri / frame-ancestors)を
 * 下回ると止まり、床の外の源は理由つきの宣言でだけ足せる(緩められない床・開け放つ源は理由があっても止まる) ④開発中だけ足す源は理由が要る。
 */

import { describe, expect, it } from 'vitest';
import { browserDefenseProblems } from '../../../../lib/model/product/browser-defense.js';
import type { BrowserDefenseProfile, DefenseCspDirective } from '../../../../lib/model/product/browser-defense.js';
import { NEXTJS_BROWSER_DEFENSE } from '../../../../lib/targets/nextjs/browser-defense.js';

/** 固定のヘッダ 1 本を差し替えた宣言。 */
function withHeader(name: string, value: string | null): BrowserDefenseProfile {
  const kept = NEXTJS_BROWSER_DEFENSE.headers.filter((header) => header.name !== name);
  return { ...NEXTJS_BROWSER_DEFENSE, headers: value === null ? kept : [...kept, { name, value }] };
}

/** CSP の指令 1 つを差し替えた宣言(`null` は指令を外す)。 */
function withDirective(name: string, sources: readonly string[] | null, extra: Partial<BrowserDefenseProfile> = {}): BrowserDefenseProfile {
  const kept = NEXTJS_BROWSER_DEFENSE.csp.directives.filter((directive) => directive.name !== name);
  const directives: DefenseCspDirective[] = sources === null ? kept : [...kept, { name, sources }];
  return { ...NEXTJS_BROWSER_DEFENSE, csp: { ...NEXTJS_BROWSER_DEFENSE.csp, directives }, ...extra };
}

describe('browserDefenseProblems: 固定のヘッダの床', () => {
  it('Next.js の値は床を満たす', () => {
    expect(browserDefenseProblems(NEXTJS_BROWSER_DEFENSE)).toEqual([]);
  });

  it('必ず付けるヘッダの欠落・弱めた値は止まる', () => {
    expect(browserDefenseProblems(withHeader('X-Frame-Options', null))).toEqual(['全応答に付けるヘッダ x-frame-options がありません']);
    expect(browserDefenseProblems(withHeader('Strict-Transport-Security', 'max-age=86400; includeSubDomains'))).toEqual([
      'ヘッダ Strict-Transport-Security: max-age=86400; includeSubDomains が床を下回ります — max-age が 31536000 秒(1 年)に足りません',
    ]);
    expect(browserDefenseProblems(withHeader('Strict-Transport-Security', 'max-age=63072000'))[0]).toContain('includeSubDomains がありません');
    expect(browserDefenseProblems(withHeader('X-Content-Type-Options', 'sniff'))[0]).toContain('nosniff ではありません');
    expect(browserDefenseProblems(withHeader('Referrer-Policy', 'unsafe-url'))[0]).toContain('外へ URL を漏らさない値');
    expect(browserDefenseProblems(withHeader('X-Frame-Options', 'ALLOW-FROM https://x.example'))[0]).toContain('DENY か SAMEORIGIN ではありません');
  });

  it('固定のヘッダに CSP・CORS は置けず、同じ名前の 2 回・改行の入った値も止まる', () => {
    expect(browserDefenseProblems(withHeader('Content-Security-Policy', "frame-ancestors 'none'"))[0]).toContain('固定のヘッダに置けません');
    expect(browserDefenseProblems(withHeader('Access-Control-Allow-Origin', '*'))[0]).toContain('固定のヘッダに置けません');
    const twice = { ...NEXTJS_BROWSER_DEFENSE, headers: [...NEXTJS_BROWSER_DEFENSE.headers, { name: 'x-content-type-options', value: 'nosniff' }] };
    expect(browserDefenseProblems(twice)).toEqual(['ヘッダ x-content-type-options が 2 回あります(1 回だけ書く)']);
    expect(browserDefenseProblems(withHeader('Permissions-Policy', 'camera=()\r\nSet-Cookie: x'))).toEqual(['ヘッダ Permissions-Policy の名前か値に改行があります']);
  });

  it('キャッシュの禁止は no-store・ログアウトの消去は cache / cookies / storage の全部', () => {
    expect(browserDefenseProblems({ ...NEXTJS_BROWSER_DEFENSE, noStore: { name: 'Cache-Control', value: 'no-cache' } })[0]).toContain('Cache-Control: no-store です');
    expect(browserDefenseProblems({ ...NEXTJS_BROWSER_DEFENSE, clearSiteData: { name: 'Clear-Site-Data', value: '"cache"' } })[0]).toContain('"cookies" / "storage"');
  });
});

describe('browserDefenseProblems: スクリプトの CSP の床', () => {
  it('必須の指令の欠落と、nonce を差し込まない宣言は止まる', () => {
    expect(browserDefenseProblems(withDirective('object-src', null))).toEqual(['CSP の指令 object-src がありません']);
    expect(browserDefenseProblems(withDirective('script-src', ["'self'"]))).toEqual([
      "CSP の script-src に 'strict-dynamic' がありません",
      "CSP の script-src の 'self' は床の外です(足すなら relaxations に理由つきで宣言する)",
    ]);
    const noNonce = { ...NEXTJS_BROWSER_DEFENSE, csp: { ...NEXTJS_BROWSER_DEFENSE.csp, nonceDirectives: [] } };
    expect(browserDefenseProblems(noNonce)).toEqual(['CSP の script-src に要求ごとの nonce を差し込みません(nonceDirectives に script-src が要る)']);
  });

  it("開け放つ源('unsafe-inline'・*・https:)と本番の 'unsafe-eval' は、理由の宣言があっても書けない", () => {
    for (const source of ["'unsafe-inline'", '*', 'https:']) {
      const relaxations = [{ directive: 'script-src', source, reason: '外部の部品が要る' }];
      expect(browserDefenseProblems(withDirective('script-src', ["'strict-dynamic'", source], { relaxations }))).toContain(
        `CSP の script-src に ${source} は書けません(読み込み元を開け放つ源。理由の宣言でも開けない)`,
      );
    }
    expect(browserDefenseProblems(withDirective('script-src', ["'strict-dynamic'", "'unsafe-eval'"]))[0]).toContain("'unsafe-eval' は書けません");
  });

  it('object-src は緩められない床で、ほかの指令は理由つきの宣言でだけ床の外の源を足せる(理由が空・死んだ宣言・緩められない宛先も止まる)', () => {
    expect(browserDefenseProblems(withDirective('object-src', ["'none'", "'self'"]))).toEqual(["CSP の object-src は 'none' だけです(緩められない床。いま 'self' がある)"]);
    const declared = withDirective('frame-ancestors', ["'self'"], { relaxations: [{ directive: 'frame-ancestors', source: "'self'", reason: '同じオリジンの管理画面に埋め込む' }] });
    expect(browserDefenseProblems(declared)).toEqual([]);
    const noReason = withDirective('frame-ancestors', ["'self'"], { relaxations: [{ directive: 'frame-ancestors', source: "'self'", reason: ' ' }] });
    expect(browserDefenseProblems(noReason)).toEqual(["CSP の frame-ancestors の 'self' を緩める宣言に理由がありません"]);
    const dead = { ...NEXTJS_BROWSER_DEFENSE, relaxations: [{ directive: 'base-uri', source: "'self'", reason: '使っていない' }] };
    expect(browserDefenseProblems(dead)).toEqual(["CSP の base-uri を緩める宣言の源 'self' が、本番の CSP に書かれていません(死んだ宣言)"]);
    const unrelaxable = withDirective('object-src', ["'self'"], { relaxations: [{ directive: 'object-src', source: "'self'", reason: 'x' }] });
    expect(browserDefenseProblems(unrelaxable)).toContain('CSP の object-src は緩める宣言の宛先になりません(床の表で緩められる指令だけ)');
  });

  it('深層の守り(default-src・connect-src・img-src)は既定で同じオリジンに絞られ、欠落・開け放つ源は止まり、外のサービスは理由つきの宣言でだけ足せる', () => {
    const sourcesOf = (name: string): readonly string[] | undefined => NEXTJS_BROWSER_DEFENSE.csp.directives.find((directive) => directive.name === name)?.sources;
    expect(sourcesOf('default-src')).toEqual(["'self'"]);
    expect(sourcesOf('connect-src')).toEqual(["'self'"]);
    expect(sourcesOf('img-src')).toEqual(["'self'", 'data:']);
    for (const name of ['default-src', 'connect-src', 'img-src']) {
      expect(browserDefenseProblems(withDirective(name, null))).toEqual([`CSP の指令 ${name} がありません`]);
      expect(browserDefenseProblems(withDirective(name, ['https:', "'self'"]))[0]).toContain('https: は書けません');
      expect(browserDefenseProblems(withDirective(name, ['*', "'self'"]))[0]).toContain('* は書けません');
      expect(browserDefenseProblems(withDirective(name, ['https://x.example']))).toEqual([
        `CSP の ${name} に 'self' がありません`,
        `CSP の ${name} の https://x.example は床の外です(足すなら relaxations に理由つきで宣言する)`,
      ]);
    }
    // ブラウザが直に繋ぐ外のサービス(例: 認証基盤)は、理由つきで origin を名指して足せる。
    const supabase = 'https://auth.service.test';
    const declared = withDirective('connect-src', ["'self'", supabase], { relaxations: [{ directive: 'connect-src', source: supabase, reason: 'ブラウザが認証基盤へ直に繋ぐ' }] });
    expect(browserDefenseProblems(declared)).toEqual([]);
    // data: は画像にだけ許し、接続先・既定には許さない。
    expect(browserDefenseProblems(withDirective('connect-src', ["'self'", 'data:']))[0]).toContain('data: は書けません');
    expect(browserDefenseProblems(withDirective('img-src', ["'self'", 'blob:']))[0]).toContain('blob: は書けません');
  });

  it('開発中だけ足す源は理由が要り、緩められない指令・開け放つ源には足せない', () => {
    const csp = (development: BrowserDefenseProfile['csp']['development']): BrowserDefenseProfile => ({ ...NEXTJS_BROWSER_DEFENSE, csp: { ...NEXTJS_BROWSER_DEFENSE.csp, development } });
    expect(browserDefenseProblems(csp([{ name: 'script-src', sources: ["'unsafe-eval'"], reason: '' }]))).toEqual(['開発中だけ足す script-src の源に理由がありません']);
    expect(browserDefenseProblems(csp([{ name: 'object-src', sources: ['*'], reason: 'x' }]))).toEqual(['CSP の object-src は開発中も緩められません']);
    expect(browserDefenseProblems(csp([{ name: 'script-src', sources: ["'unsafe-inline'"], reason: 'x' }]))).toEqual(["開発中でも CSP の script-src に 'unsafe-inline' は書けません"]);
  });

  it('指令に改行・; を入れられず、リクエスト前段が通さない接頭辞は正規表現の特別な文字を持てない', () => {
    expect(browserDefenseProblems(withDirective('frame-ancestors', ["'none'; script-src *"]))[0]).toContain('改行・;・空の値があります');
    expect(browserDefenseProblems({ ...NEXTJS_BROWSER_DEFENSE, gateExcludedPrefixes: ['api/', '(.*)'] })).toEqual([
      'リクエスト前段が通さない接頭辞 "(.*)" は、先頭の / を除いたパスの綴り(英数字と . _ - /)で書きます',
    ]);
  });
});

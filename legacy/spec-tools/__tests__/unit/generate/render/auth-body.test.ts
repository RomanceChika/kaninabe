/**
 * auth-body / code-auth / book-auth のユニットテスト。
 *
 * 生成は情報を足さない(決定表の展開のみ)。ここで固定するのは:
 *   - 差し込み先(auth.md の auth-body マーカー)と、分岐図が宣言と同じ本数の枝を持つこと
 *   - 実装側の期待表が**着地先のパスを画面仕様の route から引く**こと(URL を 2 か所に書かない)
 *   - 突合に使う 4 軸と runs が写ること(summary は写さないこと)
 *   - ハンドブックの章が丸ごと生成されること
 */

import { describe, expect, it } from 'vitest';
import { GeneratorPreconditionError } from '../../../../lib/kernel/generator-precondition.js';
import { authBodyGenerator } from '../../../../lib/generate/render/auth-body.js';
import { authExpectationsGenerator } from '../../../../lib/generate/render/code-auth.js';
import { bookChapterSections, pageText } from '../../../helpers/book-html.js';
import { specModel, stubGuards } from '../../../helpers/model-builder.js';
import { authBranch, authCallback, authEntry, authIdpSession, authLanding, authModel, authSessions } from '../../../helpers/auth-builder.js';
import { screenSpec } from '../../../helpers/screen-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** 着地先の画面(route が生成物のパスの出どころ)。 */
const SCREENS = {
  available: true,
  screens: [
    screenSpec({ name: 'workshop_list', route: '/workshops' }),
    screenSpec({ name: 'guest', route: '/guest' }),
  ],
  chromes: [],
  unexposed: [],
  unreachableStates: [],
  unseenStates: [],
};

/** 標準的な宣言(通す行 1 本 + 案内へ送る行 1 本)。 */
function standard() {
  return authModel({
    landings: [
      authLanding('active', { screen: 'screen-workshop-list', summary: '通常の入口へ' }),
      authLanding('guest', { screen: 'screen-guest', variant: 'guest', summary: '参加案内へ' }),
    ],
    branches: [
      authBranch('member_active', { values: { member: 'active' }, summary: '有効メンバーは通す' }),
      authBranch('guest_in_guild', {
        values: { member: 'guest', guild: 'joined', activate: 'accepted' },
        runs: ['membership.activate'],
        summary: '在籍を確かめて有効化する',
      }),
      authBranch('guest_not_in_guild', {
        values: { member: 'guest', guild: 'not_joined' },
        lands: 'guest',
        summary: '未在籍なら案内へ',
      }),
    ],
  });
}

/** 生成の文脈。 */
const CTX = (auth: ReturnType<typeof authModel>) => ({ guards: stubGuards(), roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, auth, screens: SCREENS });

describe('auth-body', () => {
  it('決定表が図と表に展開され、差し込み先が auth.md になる', () => {
    const sections = authBodyGenerator.generate(specModel([]), CTX(standard()));
    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('docs/specs/backend/auth.md');
    expect(sections[0]?.marker).toBe('auth-body');
    const content = sections[0]?.content ?? '';
    // 図: 分岐の本数だけ枝が出る(宣言に無い枝を足さない)。
    expect(content.split('subject -->').length - 1).toBe(3);
    // 実行する操作を持つ行だけが中間の節点を持つ。
    expect(content).toContain('run_guest_in_guild[["membership.activate"]]');
    expect(content).not.toContain('run_member_active');
    // 表: 条件が日本語で並び、着地が出る。
    expect(content).toContain('ギルドに在籍していない');
    expect(content).toContain('| `guest_not_in_guild` |');
  });

  it('認証の口(callback・start・logout)を宣言していれば節が出る。どれも宣言が無ければ節ごと出さない', () => {
    const withCallback = authModel({ callback: authCallback('/api/auth/callback'), start: authEntry('start'), logout: authEntry('logout') });
    const content = authBodyGenerator.generate(specModel([]), CTX(withCallback))[0]?.content ?? '';
    const without = authBodyGenerator.generate(specModel([]), CTX(standard()))[0]?.content ?? '';

    expect(content).toContain('### 認証の口(OAuth の帰り道・サインインの開始・ログアウト。');
    expect(content).toContain('| `/api/auth/callback` | /api/auth/callback は OAuth の帰り道 |');
    expect(content).toContain('| start | サインインの開始(POST。要求の出どころを確かめる) | `/api/auth/sign-in` |');
    expect(content).toContain('| logout | ログアウト(POST。要求の出どころを確かめる) | `/api/auth/logout` |');
    // 関門の節のあと・テストケースの前に並ぶ(宣言の並びと同じ向き)。
    expect(content.indexOf('### 認証の口')).toBeGreaterThan(content.indexOf('### 画面に入るときの関門'));
    expect(content.indexOf('### 認証の口')).toBeLessThan(content.indexOf('### テストケース'));
    expect(without).not.toContain('### 認証の口');
  });

  it('セッションの節に同時セッションの数と理由が出る(上限なし / 上限あり)。宣言が無ければ節ごと出さない', () => {
    const unbounded = authBodyGenerator.generate(specModel([]), CTX(authModel({ sessions: authSessions() })))[0]?.content ?? '';
    const limited = authBodyGenerator.generate(specModel([]), CTX(authModel({ sessions: authSessions('8h', 8 * 3600, '24h', 24 * 3600, { kind: 'limited', max: 2, onLimit: 'refuses_new', reason: '二台まで' }) })))[0]?.content ?? '';

    expect(unbounded).toContain('同時に持てるセッションの数: 上限なし。理由: テストが選んだ上限なし');
    expect(limited).toContain('同時に持てるセッションの数: 1 人 2 件まで(上限に達したら新しいサインインを断る)。理由: 二台まで');
    expect(authBodyGenerator.generate(specModel([]), CTX(standard()))[0]?.content).not.toContain('同時に持てるセッションの数');
  });

  it('IdP とアプリのセッションの関係の節が 3 つの問いと理由で出る。宣言が無ければ節ごと出さない', () => {
    const content = authBodyGenerator.generate(specModel([]), CTX(authModel({ sessions: authSessions(), idpSession: authIdpSession() })))[0]?.content ?? '';
    const without = authBodyGenerator.generate(specModel([]), CTX(standard()))[0]?.content ?? '';

    expect(content).toContain('### IdP とアプリのセッションの関係');
    expect(content).toContain('アプリのログアウトは IdP のセッションを終えない');
    expect(content).toContain('アプリのセッションはアプリの寿命(sessions)が来るまで続く');
    expect(content).toContain('IdP のセッションの寿命とは揃えない');
    expect(content).toContain('理由: テストが選んだ関係');
    // セッションの寿命の節のあと・多要素認証の前(宣言の並びと同じ向き)。
    expect(content.indexOf('### IdP とアプリ')).toBeGreaterThan(content.indexOf('### セッションの寿命'));
    expect(without).not.toContain('### IdP とアプリ');
  });

  it('仕様が無ければ何も生成しない', () => {
    expect(authBodyGenerator.generate(specModel([]), { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards() })).toEqual([]);
  });
});

describe('code-auth', () => {
  it('突合の 4 軸と runs を写し、着地のパスは画面の route から引く', () => {
    const sections = authExpectationsGenerator.generate(specModel([]), CTX(standard()));
    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('app/src/domain/generated/auth.ts');
    expect(sections[0]?.wholeFile).toBe(true);
    const content = sections[0]?.content ?? '';
    expect(content).toContain("id: 'guest_in_guild'");
    expect(content).toContain("guild: 'joined'");
    expect(content).toContain("runs: ['membership.activate']");
    // 人間向けの説明は突合に使わないので写さない。
    expect(content).not.toContain('在籍を確かめて有効化する');
    // 着地 → パス(URL は画面仕様が正)。
    expect(content).toContain("active: '/workshops'");
    expect(content).toContain("guest: '/guest'");
  });

  it('実装との突合の置き場(突合テスト)は、配置が宣言する土台(操作の層のテスト支援)の下から引く。宣言が無ければ置き場を示さない', () => {
    const noteOf = (layout: typeof TEST_LAYOUT): string => authExpectationsGenerator.generate(specModel([]), { ...CTX(standard()), layout })[0]?.content ?? '';
    const moved = { ...TEST_LAYOUT, 'source-root': { ...(TEST_LAYOUT['source-root'] ?? failMissing()), place: () => 'server_code' } };

    expect(noteOf(TEST_LAYOUT)).toContain('app/src/operation/__tests__/shared/sign-in-sync.test.ts');
    expect(noteOf(moved)).toContain('app/server_code/operation/__tests__/shared/sign-in-sync.test.ts');
    // 実装の木を宣言していない製品は置き場を示さない。実装の木があるのに配置が土台を宣言していなければ、黙って行を消さず前提の失敗で止める。
    const noApp = authExpectationsGenerator.generate(specModel([]), { ...CTX(standard()), roots: { ...TEST_ROOTS, app: null }, layout: {} })[0]?.content ?? '';
    expect(noApp).not.toContain('sign-in-sync');
    expect(noApp).toContain('verify の H1 が見る');
    expect(() => noteOf({})).toThrow(GeneratorPreconditionError);
  });

  it('仕様が無ければ何も生成しない', () => {
    expect(authExpectationsGenerator.generate(specModel([]), { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards() })).toEqual([]);
  });
});

/** 認証の章(HTML の本)のセクション。 */
const bookAuth = (ctx: ReturnType<typeof CTX> | Parameters<typeof bookChapterSections>[1]) => bookChapterSections(specModel([]), ctx as Parameters<typeof bookChapterSections>[1], 'auth.html');

describe('book-auth(HTML の本の認証の章)', () => {
  it('章が丸ごと生成され、分岐・着地・関門が並ぶ', () => {
    const sections = bookAuth(CTX(standard()));
    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('docs/book/auth.html');
    expect(sections[0]?.wholeFile).toBe(true);
    const html = sections[0]?.content ?? '';
    const content = pageText(html);
    expect(content).toContain('入るとどうなるか(認証)');
    expect(content).toContain('有効メンバーは通す');
    expect(content).toContain('どこへ着くか(2)');
    expect(content).toContain('画面に入るときの関門(0)');
    expect(html).toContain('data-el="auth.branch"');
  });

  it('callback を宣言していれば章の範囲に OAuth の帰り道の口が出る(公理には数えない)。宣言が無ければ出ない', () => {
    const withCallback = pageText(bookAuth(CTX(authModel({ callback: authCallback('/api/auth/callback'), start: authEntry('start'), logout: authEntry('logout') })))[0]?.content ?? '');
    const without = pageText(bookAuth(CTX(standard()))[0]?.content ?? '');

    expect(withCallback).toContain('OAuth の帰り道');
    expect(withCallback).toContain('/api/auth/callback');
    expect(withCallback).toContain('/api/auth/sign-in');
    expect(withCallback).toContain('/api/auth/logout');
    expect(without).not.toContain('OAuth の帰り道');
  });

  it('章の設定と突き合わせる宣言の行に、同時セッションの数と IdP とのセッションの関係が出る(読めていなければ出ない)', () => {
    const content = pageText(bookAuth(CTX(authModel({ sessions: authSessions(), idpSession: authIdpSession() })))[0]?.content ?? '');
    const without = pageText(bookAuth(CTX(standard()))[0]?.content ?? '');

    expect(content).toContain('同時に持てるセッションの数は 上限なし。理由: テストが選んだ上限なし');
    expect(content).toContain('IdP とのセッションの関係');
    expect(content).toContain('アプリのログアウトは IdP のセッションを終えない');
    expect(content).toContain('理由: テストが選んだ関係');
    expect(without).not.toContain('IdP とのセッションの関係');
    expect(without).not.toContain('同時に持てるセッションの数');
  });

  it('読めていない仕様は章を作らない', () => {
    expect(bookAuth({ roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards() })).toEqual([]);
  });
});

/** 配置の元の値が足りないテストの書き間違いを知らせる。 */
function failMissing(): never {
  throw new Error('配置に必要な宣言がありません');
}

/**
 * HTML の本の認証の章(`html/auth-chapter.ts` と骨格の `html/layer-chapter.ts`)のテスト。
 *
 * 骨格の節の並びと目次の並びが同じこと・Markdown 版の記法(部品のタグ・`##`)を持たないこと・認証の仕様が読めないときは 1 行で言うことを見る。
 */

import { describe, expect, it } from 'vitest';

import { authChapter } from '../../../../../lib/generate/render/book/html/auth-chapter.js';
import type { AuthMfaDecl } from '../../../../../lib/model/auth/mfa.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';
import { pageText } from '../../../../helpers/book-html.js';
import { loc } from '../../../../helpers/model-builder.js';
import { authBranch, authGate, authLanding, authModel } from '../../../../helpers/auth-builder.js';

describe('authChapter', () => {
  it('認証の仕様が読めないときは、題とその旨の 1 行だけ', () => {
    const chapter = authChapter(bookModel(), bookCtx(), null, 'docs/book/auth.md', 'docs/book/auth.html');
    expect(chapter.headings).toEqual([]);
    expect(chapter.body).toContain('まだ認証フロー仕様を読めていない');
  });
});

describe('authChapter: 読めた仕様', () => {
  const HOSTILE = '<img src=x onerror=alert(1)>{{ 1 }}';
  const auth = authModel({
    landings: [authLanding('active', { screen: 'screen-item-list' }), authLanding('guest', { variant: 'guest' })],
    branches: [
      authBranch('member_active', { values: { member: 'active' }, summary: HOSTILE }),
      authBranch('guest_waits', { values: { member: 'guest', guild: 'not_joined' }, lands: 'guest' }),
    ],
    gates: [authGate('session')],
  });
  const ctx = { ...bookCtx(), auth };
  const chapter = authChapter(bookModel(), ctx, auth.flow, 'docs/book/auth.md', 'docs/book/auth.html');

  it('節は 上段 → 下段 → 数の出どころ の順で、目次も本文と同じ順', () => {
    const ids = chapter.headings.map((heading) => heading.id);
    for (const id of ['legend', 'upper', 'branches', 'landings', 'gates', 'acceptance', 'lower', 'origin']) expect(ids).toContain(id);
    const positions = ids.map((id) => chapter.body.indexOf(` id="${id}"`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('分岐の行は着地へ飛べ、Markdown 版の記法(部品のタグ・見出しの #)を持たない', () => {
    expect(chapter.body).toContain('href="#landing-active"');
    expect(chapter.body).toContain('id="landing-active"');
    expect(chapter.body).not.toMatch(/<(Grid|Fold|Term|Mode)\b|^#{2,3} /m);
  });

  it('仕様の文字列は構造にならない', () => {
    expect(chapter.body).not.toContain('<img');
    expect(chapter.body).toContain('&#60;img src=x onerror=alert(1)&#62;{{ 1 }}');
  });
});

describe('authChapter: 多要素認証の宣言の行', () => {
  const DELEGATED: AuthMfaDecl = { kind: 'delegated', provider: 'discord', evidence: 'none', reason: 'Discord に任せる', location: loc('docs/specs/backend/auth.md', 'mfa') };
  const EXEMPT: AuthMfaDecl = { kind: 'exempt', reason: '敷居を上げない', location: loc('docs/specs/backend/auth.md', 'mfa') };

  /** 多要素認証の宣言を差し替えた認証の章の本文(字)。 */
  function mfaText(mfa: AuthMfaDecl): string {
    const auth = authModel({ mfa, providers: ['discord'] });
    return pageText(authChapter(bookModel(), { ...bookCtx(), auth }, auth.flow, 'docs/book/auth.md', 'docs/book/auth.html').body);
  }

  it('delegated は、任せ先・理由・確かめられないこと・任せる先以外の方式には要素が掛からないことを言い、外している文言は混ざらない', () => {
    const text = mfaText(DELEGATED);

    expect(text).toContain('多要素認証');
    expect(text).toContain('IdP discord に任せている(受け入れた危険)。理由: Discord に任せる');
    expect(text).toContain('確かめられない');
    expect(text).toContain('任せる先以外の方式で入る人には要素が 1 つも掛からない');
    expect(text).not.toContain('外している');
  });

  it('exempt は「外している」と理由を言い、IdP に任せるとは言わない(対照)', () => {
    const text = mfaText(EXEMPT);

    expect(text).toContain('外している(受け入れた危険)。理由: 敷居を上げない');
    expect(text).not.toContain('に任せている');
  });
});

/**
 * 画面の章(HTML の本。render/book/html/screens-chapter.ts)のテスト。
 *
 * 画面 1 枚 = 上段の 1 行(誰が・条件・決まること)・下段の折りたたみ(遷移図 2 枚 + グループ別・画面ごとの
 * カードと表)・標識の引用を検める(HTML の字と要素で見る)。
 */

import { describe, expect, it } from 'vitest';

import { bookHtmlGenerator } from '../../../../../lib/generate/render/book/html/generator.js';
import { bookHtmlFiles, bookHtmlPage, pageText } from '../../../../helpers/book-html.js';
import type { GenerateContext } from '../../../../../lib/gen-kit/generator.js';
import { GEN_CTX } from '../../../../helpers/generate-context.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';
import { stateKeyOf } from '../../../../../lib/gen-kit/book-inputs.js';
import { screenSpec } from '../../../../helpers/screen-builder.js';

/** 画面の章のページ(HTML の文書)。 */
function content(ctx: GenerateContext = { ...bookCtx(), humanFaceChapters: 'all' }): string {
  const page = bookHtmlPage(bookModel(), ctx, 'screens.html');
  if (page === undefined) throw new Error('ページが生成されませんでした');
  return page;
}

/** 画面の章の字。 */
const textOf = (ctx?: GenerateContext): string => pageText(content(ctx));

/** 画面だけを差し替えた文脈。 */
function withScreens(screens: ReturnType<typeof screenSpec>[]): GenerateContext {
  return {
    ...bookCtx(),
    screens: { available: true, screens, chromes: [], unexposed: [], unreachableStates: [], unseenStates: [] },
  };
}

describe('画面の章(HTML): 出力先', () => {
  it('docs/book/screens.html をファイル全体(wholeFile)で生成する', () => {
    const sections = bookHtmlGenerator.generate(bookModel(), bookCtx()).filter((section) => section.file === 'docs/book/screens.html');

    expect(sections).toHaveLength(1);
    expect(sections[0]?.wholeFile).toBe(true);
  });

  it('screen_spec を読めていない環境では何も生成しない(空ページを作らない)', () => {
    expect(bookHtmlFiles(bookModel(), GEN_CTX).has('docs/book/screens.html')).toBe(false);
  });

  it('画面が 1 枚も無ければ、空の骨格を出さず案内の 1 文だけを出す', () => {
    const html = content(withScreens([]));

    expect(pageText(html)).toContain('まだ画面が無い');
    expect(html).not.toContain('bf-grid');
  });
});

describe('画面の章(HTML): 上段(画面 1 枚 = 1 行)', () => {
  it('画面ごとに行(行頭に必読の印)を出し、画面名から導いたアンカーを持つ', () => {
    const html = content();
    const text = pageText(html);

    expect(html).toContain('id="workshop-detail"');
    expect(html).toContain('id="workshop-list"');
    expect(text).toContain('画面(2)');
    expect(text).toContain('公理 2 本。画面 2 枚(部品の宣言を持つもの 0 枚)');
  });

  it('入場の条件と行き先・要ログイン・入口・読むもの・できること(重ね表示の操作を含む)を載せる', () => {
    const text = textOf();

    expect(text).toContain('要ログイン');
    expect(text).toContain('state == accepting');
    expect(text).toContain('満たさなければ screen-workshop-list へ');
    expect(text).toContain('入口の画面');
    expect(text).toContain('読むもの query-workshop-detail');
    expect(text).toContain('できること workshop.publish、workshop.update');
  });

  it('排他表示(variants)は行の「決まること」に、スロットと状態名つきで出す。排他を持たない画面は何も足さない', () => {
    const html = content(
      withScreens([
        screenSpec({
          name: 'with_variants',
          slots: [{ slot: 'body.center', components: [{ name: 'form_part', variant: 'none' }, { name: 'link_part', variant: 'open' }, 'free'] }],
        }),
        screenSpec({ name: 'plain', slots: [{ slot: 'body.center', components: ['free'] }] }),
      ]),
    );
    const text = pageText(html);

    expect(text).toContain('同時には出ない body.center — none → form_part / open → link_part');
    expect(text.split('同時には出ない ')).toHaveLength(2);
    expect(html).toContain('data-el="screen.for screen.variants"');
  });

  it('日本語名があれば行頭に添える(アンカーは内部名のまま)。宣言の無い画面には発明しない', () => {
    const html = content(
      withScreens([
        screenSpec({ name: 'item_detail', label: '催し詳細', route: '/items/:id', group: 'item' }),
        screenSpec({ name: 'item_list', route: '/items', group: 'item' }),
      ]),
    );
    const text = pageText(html);

    expect(text).toContain('item_detail 催し詳細');
    expect(html).toContain('id="item-detail"');
    // 日本語名の無い画面は、内部名だけ(名前を発明しない)。
    expect(text).toMatch(/^item_list 必読$/m);
  });

  it('生成物として宣言された部品(kind)は、画面の行の中に並べる。別の単位には数えない', () => {
    const text = textOf(
      withScreens([
        screenSpec({
          name: 'list',
          group: 'workshop',
          slots: [{ slot: 'body.center', components: [{ name: 'table', kind: 'table', reads: 'query-a', shows: ['title', 'state'] }] }],
        }),
      ]),
    );

    expect(text).toContain('表 — 読む query-a、見せる title、state');
    expect(text).toContain('公理 1 本。画面 1 枚(部品の宣言を持つもの 1 枚)');
  });

  it('4 枚の数(公理 = 上段の印、参照 = 下段の折りたたみの件数)が章の項目と一致する', () => {
    const text = textOf();

    expect(text).toContain('業務 2 / 開発者 0');
    expect(text).toContain('4 枚の数は、この章に並ぶ項目の数と一致する');
    expect(text).toContain('testid 6 件、遷移 1 件、テスト 0 件');
  });
});

describe('画面の章(HTML): 下段(導出)', () => {
  it('動線は、グループ別 + 全体 2 枚(画面固有 / 全遷移)を、遷移の表で出す', () => {
    const text = textOf();

    expect(text).toContain('動線 — workshop');
    expect(text).toContain('全体 — 画面固有の遷移');
    expect(text).toContain('全体 — 全遷移');
    expect(text).toContain('workshop_detail | workshop.publish.success | workshop_detail | 遷移');
    expect(text).toContain('workshop_detail | 入場条件を満たさない | workshop_list | 入場条件の逃げ道');
  });

  it('画面ごとの折りたたみは、カード(実物・構造・動線)と testid・遷移・テストの表 1 枚を持ち、件数は表の行の数', () => {
    const html = content();
    const text = pageText(html);

    expect(text).toContain('workshop_detail5実物・構造・動線のカードと、testid・遷移・テストの表');
    expect(text).toContain('種類 | 名前 | 中身');
    expect(text).toContain('遷移 | workshop.publish.success | screen-workshop-detail');
    expect(html).toContain('data-el="screen.preview screen.navigation screen.testid screen.tests"');
  });

  it('画面固有の遷移は共有クローム由来を含まず、全遷移は含む。表の遷移は画面固有だけ', () => {
    const text = textOf(
      withScreens([
        screenSpec({
          name: 'detail',
          navigations: [
            { on: 'entry.create.success', to: 'screen-detail' },
            { on: 'home_link', to: 'screen-list', viaChrome: 'chrome-main' },
          ],
        }),
        screenSpec({ name: 'list' }),
      ]),
    );
    const overview = text.split('全体 — 画面固有の遷移')[1] ?? '';
    const specific = overview.split('全体 — 全遷移')[0] ?? '';
    const full = overview.split('全体 — 全遷移')[1] ?? '';

    expect(specific).toContain('detail | entry.create.success | detail');
    expect(specific).not.toContain('home_link');
    expect(full).toContain('detail | home_link | list');
    expect(text).toContain('共有クロームの遷移 1 本は含めない');
    expect(text).not.toContain('遷移 | home_link');
  });

  it('画面カードはレイアウトの構造(chrome の外枠つき)を持ち、断片が無ければ未生成の表記を出す', () => {
    const html = content();
    const text = pageText(html);

    expect(text).toContain('共有クローム main');
    expect(text).toContain('重ね表示 confirm');
    expect(text).toContain('プレビュー未生成');
    expect(html).not.toContain('<div class="screen-preview"');
  });

  it('断片があれば、画面の折りたたみに SSR プレビューと重ね表示を埋め込む', () => {
    const previews = new Map([
      [
        'workshop_detail',
        '<main data-testid="workshop_detail.body.center" class="pageWide">本文</main>' +
          '<dialog data-testid="workshop_detail.overlay.confirm.body.center" class="dialog">やめる</dialog>',
      ],
    ]);
    const html = content({ ...bookCtx(), book: { previews }, humanFaceChapters: 'all' });

    expect(html).toContain('<div class="screen-preview" inert data-preview-screen="workshop_detail">');
    expect(html).toContain('<dialog open data-testid="workshop_detail.overlay.confirm.body.center"');
    expect(html).toContain('data-preview-overlay="confirm"');
  });
});

describe('画面の章(HTML): 受け入れと標識', () => {
  it('UX 原則の受け入れ(ux:)は理由つきの受け入れとして表に並び、4 枚の受け入れの数と一致する', () => {
    const text = textOf(
      withScreens([screenSpec({ name: 'a', ux: [{ principle: 'U4', subject: 'x.y', reason: '階層ごとに分かれて並ぶ' }] }), screenSpec({ name: 'b' })]),
    );

    expect(text).toContain('受け入れ(1)');
    expect(text).toContain('a の U4 x.y');
    expect(text).toContain('階層ごとに分かれて並ぶ');
    expect(text).toMatch(/受け入れ受け入れ\n1\n/);
  });

  it('screen / chrome の標識だけを引用する(このフィクスチャでは 0 本 = ブロック無し)', () => {
    expect(textOf()).not.toMatch(/標識 [1-9]\d* 本 —/);
  });
});

describe('画面の章(HTML): 動線の表(グループ別)', () => {
  const screens = [
    screenSpec({ name: 'login', group: 'auth', navigations: [{ on: 'signed_in', to: 'screen-list' }] }),
    screenSpec({
      name: 'list',
      group: 'item',
      route: '/items',
      entryPoint: true,
      navigations: [
        { on: 'selected', to: 'screen-detail' },
        { on: 'home_link', to: 'screen-login', viaChrome: 'chrome-main' },
      ],
    }),
    screenSpec({ name: 'detail', group: 'item', route: '/items/:id' }),
  ];
  const text = textOf(withScreens(screens));
  /** グループの動線の折りたたみ 1 枚分の字。 */
  const groupFold = (name: string): string => (text.split(`動線 — ${name}`)[1] ?? '').split('動線 — ')[0]?.split('全体 — 画面固有の遷移')[0] ?? '';

  it('グループ内の画面の出入りを、遷移元・きっかけ・遷移先・種類の行で出す', () => {
    const item = groupFold('item');

    expect(item).toContain('list | selected | detail | 遷移');
  });

  it('他グループから入る辺・他グループへ抜ける辺は落とさず、相手の画面にはグループ名を併記する(スタブ節点の代わり)', () => {
    expect(groupFold('item')).toContain('login (auth) | signed_in | list | 遷移');
    expect(groupFold('auth')).toContain('login | signed_in | list (item) | 遷移');
  });

  it('共有クローム由来(viaChrome)の遷移はグループの動線に出さない', () => {
    expect(groupFold('item')).not.toContain('home_link');
    expect(groupFold('auth')).not.toContain('home_link');
  });

  it('画面の名前は上段の画面の行へのリンクになる(カードへ飛ぶ)', () => {
    const html = content(withScreens(screens));

    expect(html).toContain('<a href="#list"><span class="bf-mono">list</span></a>');
  });

  it('グループをまたぐ辺が無ければグループ名の併記は出ない', () => {
    const solo = textOf(withScreens([screenSpec({ name: 'solo', group: 'home', entryPoint: true })]));

    expect(solo).toContain('動線 — home');
    expect(solo.split('動線 — home')[1]?.split('全体 — 画面固有の遷移')[0]).toContain('この範囲に遷移は無い');
  });
});

describe('画面の章(HTML): 状態ごとの見え方(states.requires)', () => {
  /** 画面の折りたたみの中の「状態ごとの見え方」(次の表の手前まで)。 */
  function states(html: string): string {
    const start = html.indexOf('<p class="bf-group">状態ごとの見え方');
    return start === -1 ? '' : html.slice(start, html.indexOf('<div class="bf-table">', start));
  }

  it('states.requires を宣言していない画面には何も足さない', () => {
    expect(states(content(withScreens([screenSpec({ name: 'home', group: 'home', requires: [] })])))).toBe('');
  });

  it('宣言した状態だけを、宣言順に並べる(宣言していない状態の断片が置いてあっても出さない)', () => {
    const statePreviews = new Map([
      [stateKeyOf('item_list', 'empty'), '<p>empty</p>'],
      [stateKeyOf('item_list', 'error'), '<p>error</p>'],
      [stateKeyOf('item_list', 'not_found'), '<p>not_found</p>'],
    ]);
    const html = content({ ...withScreens([screenSpec({ name: 'item_list', group: 'item', requires: ['empty', 'error'] })]), book: { statePreviews } });
    const part = states(html);

    expect(part).toContain('data-preview-state="empty"');
    expect(part).toContain('data-preview-state="error"');
    expect(part).toContain('<p>empty</p>');
    expect(part).toContain('<p>error</p>');
    expect(part).not.toContain('<p>not_found</p>');
    expect(part.indexOf('empty — 空')).toBeGreaterThan(-1);
    expect(part.indexOf('empty — 空')).toBeLessThan(part.indexOf('error — 入力エラー'));
  });

  it('断片が無く理由もある状態は、断片の代わりに理由を出す(定型の「未生成」は出さない)', () => {
    const stateGaps = [{ screen: 'invite', state: 'loading', reason: 'クリックハンドラの中にしか無い' }];
    const part = states(content({ ...withScreens([screenSpec({ name: 'invite', group: 'auth', requires: ['loading'] })]), book: { stateGaps } }));

    expect(part).toContain('クリックハンドラの中にしか無い');
    expect(part).toContain('data-quoted="app"');
    expect(part).not.toContain('プレビュー未生成');
  });

  it('断片も理由も無い状態は「未生成」の表記を出す(足し忘れが見える)', () => {
    const part = states(content(withScreens([screenSpec({ name: 'item_list', group: 'item', requires: ['empty'] })])));

    expect(part).toContain('プレビュー未生成');
    expect(part).toContain('npm run book:previews');
  });

  it('他の画面の gap は混ざらない', () => {
    const stateGaps = [{ screen: 'invite', state: 'loading', reason: '別の画面の理由' }];
    const part = states(content({ ...withScreens([screenSpec({ name: 'login', group: 'auth', requires: ['error'] })]), book: { stateGaps } }));

    expect(part).not.toContain('別の画面の理由');
    expect(part).toContain('プレビュー未生成');
  });
});

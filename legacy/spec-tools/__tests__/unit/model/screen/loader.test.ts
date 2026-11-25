/**
 * screen_spec / chrome_spec ローダー(I/O 境界)と S0(スキーマ適合)のテスト。
 *
 * 規約(scripts-code-quality.md)により fixture ファイルを使うのはローダー自身のテストだけ。
 * 検証器のテストは verifiers/ 配下でモデルをリテラル構築する。
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkLabelUniqueness, loadScreenSpecModel } from '../../../../lib/model/screen/loader.js';
import type { Finding } from '../../../../lib/kernel/finding.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_LAYOUT } from '../../../helpers/platform.js';

const FIXTURES = path.resolve(import.meta.dirname, '../../../fixtures');
const REPO_ROOT = path.resolve(FIXTURES, '..');

/** fixture ディレクトリを repoRoot 固定で読む(Finding のパスを安定させるため)。 */
function load(name: string) {
  return loadScreenSpecModel(path.join(FIXTURES, name), { repoRoot: REPO_ROOT, roots: TEST_ROOTS, layout: TEST_LAYOUT });
}

/** 指摘のメッセージだけを取り出す(照合を読みやすくするため)。 */
function messages(findings: readonly { message: string }[]): string[] {
  return findings.map((finding) => finding.message);
}

describe('loadScreenSpecModel', () => {
  /** 名前で 1 枚引く。 */
  function screenNamed(name: string) {
    return load('screens-valid').model.screens.find((screen) => screen.name === name);
  }

  it('正常なツリーから screen_spec と chrome_spec を読む', () => {
    const { model, findings } = load('screens-valid');

    expect(findings).toEqual([]);
    expect(model.available).toBe(true);
    expect(model.screens).toHaveLength(2);
    expect(model.chromes).toHaveLength(1);
    expect(screenNamed('login')).toMatchObject({
      id: 'screen-login',
      route: '/login',
      forRoles: ['anonymous'],
      entryPoint: true,
      relPath: 'auth/login.md',
      requiredStates: ['loading', 'error'],
    });
  });

  it('画面とクロームの日本語名(トップレベル label)を読む', () => {
    const { model } = load('screens-valid');

    expect(screenNamed('login')?.label).toBe('ログイン');
    expect(screenNamed('detail')?.label).toBe('催し詳細');
    expect(model.chromes[0]?.label).toBe('メンバー向けクローム');
  });

  it('README とテンプレートは仕様として読まない', () => {
    const names = load('screens-valid').model.screens.map((screen) => screen.name);

    expect(names).toEqual(['login', 'detail']);
  });

  it('README のフロントマターから S10 の免除宣言(unexposed)を読む', () => {
    const { model, findings } = load('screens-valid');

    expect(findings).toEqual([]);
    expect(model.unexposed).toEqual([
      expect.objectContaining({ event: 'entry.withdraw', reason: '取下げの画面が未着手のため' }),
    ]);
  });

  it('unexposed が無い README でも黙って空になる(免除なし)', () => {
    // screens-invalid の README は unexposed を持たない。免除宣言はあくまで任意である。
    expect(load('screens-invalid').model.unexposed).toEqual([]);
  });

  it('画面の ux から UX 原則の受け入れを読む(subject は画面の接頭辞を除いた部分。省略は画面そのもの)', () => {
    const { findings } = load('screens-valid');

    expect(findings).toEqual([]);
    expect(screenNamed('detail')?.ux).toEqual([
      expect.objectContaining({
        principle: 'U1',
        subject: 'entry.withdraw',
        reason: '取下げは日常操作なので確認を挟まない',
      }),
      expect.objectContaining({ principle: 'U3', subject: '' }),
    ]);
  });

  it('ux が無い画面は受け入れなし', () => {
    expect(screenNamed('login')?.ux).toEqual([]);
  });

  it('chrome / requires_auth / subject / precondition / on_fail を型付きで読む', () => {
    const screen = screenNamed('detail');

    expect(screen?.chrome).toMatchObject({ id: 'chrome-member' });
    expect(screen?.requiresAuth).toBe(true);
    expect(screen?.subject).toMatchObject({ entity: 'workshop' });
    expect(screen?.precondition).toMatchObject({ source: 'state == closed' });
    expect(screen?.onFail).toMatchObject({ raw: 'redirect(screen-login)', screen: 'screen-login' });
  });

  it('requires_auth を書かない画面は false になる', () => {
    expect(screenNamed('login')?.requiresAuth).toBe(false);
    expect(screenNamed('login')?.subject).toBeUndefined();
  });

  it('chrome の navigations を継承画面へ展開する', () => {
    const detail = screenNamed('detail');
    const inherited = detail?.navigations.filter((navigation) => navigation.viaChrome !== undefined);

    expect(inherited?.map((navigation) => [navigation.on, navigation.to])).toEqual([
      ['signed_out', 'screen-login'],
    ]);
    // 継承しない画面には展開されない。
    expect(screenNamed('login')?.navigations.every((n) => n.viaChrome === undefined)).toBe(true);
  });

  it('reads / actions / navigations を要素ごとの位置つきで読む', () => {
    const screen = screenNamed('detail');

    expect(screen?.reads.map((read) => read.id)).toEqual(['query-workshop-detail']);
    expect(screen?.actions.map((action) => action.id)).toEqual(['entry.create', 'entry.submit']);
    expect(screen?.reads[0]?.location).toMatchObject({ pointer: 'reads[0]' });
    // 自分で書いた 2 本 + chrome から展開された 1 本。
    expect(screen?.navigations).toHaveLength(3);
    expect(screen?.navigations[0]).toMatchObject({ on: 'entry.create.success', to: 'screen-detail' });
  });

  it('レイアウトを平坦なスロット列にする(入れ子はフルパスで親を残す)', () => {
    const slots = screenNamed('detail')?.layout.slots ?? [];

    expect(slots.map((slot) => [slot.path, slot.slot, slot.owner])).toEqual([
      ['body.center.own_entry_panel.footer', 'footer', 'own_entry_panel'],
      ['body.center', 'body.center', null],
      ['footer', 'footer', null],
    ]);
    expect(slots.find((slot) => slot.path === 'body.center')?.components.map((c) => c.name)).toEqual([
      'workshop_summary',
      'entry_form',
      'own_entry_panel',
    ]);
    // 同名スロット(footer)が 2 か所にあってもフルパスで区別できる。
    expect(new Set(slots.map((slot) => slot.path)).size).toBe(slots.length);
  });

  it('部品の label(表示名)を読む。宣言の無い部品は持たない', () => {
    const center = screenNamed('detail')?.layout.slots.find((slot) => slot.path === 'body.center');

    expect(center?.components.find((c) => c.name === 'workshop_summary')?.label).toBe('催しの概要');
    expect(center?.components.find((c) => c.name === 'entry_form')?.label).toBeUndefined();
  });

  it('排他表示(variants)の部品を同じスロットに平坦に積む(状態名はパスに現れない)', () => {
    const slots = screenNamed('detail')?.layout.slots ?? [];
    const center = slots.find((slot) => slot.path === 'body.center');

    expect(center?.components.map((component) => component.variant?.key)).toEqual([
      undefined,
      'no_entry',
      'own_entry',
    ]);
    // 同じ variants ブロックの部品は同じグループに属する(= 互いに排他)。
    expect(center?.components.map((component) => component.variant?.group)).toEqual([
      undefined,
      0,
      0,
    ]);
    // 状態名(own_entry)はスロットパスに現れず、入れ子は部品名の下に続く。
    expect(slots.map((slot) => slot.path)).toContain('body.center.own_entry_panel.footer');
  });

  it('overlays を読む', () => {
    const overlay = screenNamed('detail')?.overlays[0];

    expect(overlay).toMatchObject({ id: 'report_dialog', openedBy: 'report_button', closesOn: ['cancel'], label: '通報する' });
    expect(overlay?.actions.map((action) => action.id)).toEqual(['entry.submit']);
    expect(overlay?.layout.slots.map((slot) => slot.path)).toEqual(['body.center']);
  });

  it('test_cases は action_spec と同じ形式で読む(未記入は空)', () => {
    expect(screenNamed('detail')?.testCases.map((testCase) => testCase.id)).toEqual([
      'TC-SCREEN-DETAIL-001',
    ]);
    expect(screenNamed('login')?.testCases).toEqual([]);
  });

  it('chrome_spec を読む', () => {
    const chrome = load('screens-valid').model.chromes[0];

    expect(chrome).toMatchObject({ id: 'chrome-member', name: 'member', relPath: 'member.md' });
    expect(chrome?.layout.slots[0]).toMatchObject({ path: 'header', owner: null });
  });

  it('screens ディレクトリが無ければ available: false', () => {
    const { model, findings } = load('domain-valid');

    expect(model).toEqual({
      available: false,
      screens: [],
      chromes: [],
      unexposed: [],
      unreachableStates: [],
      unseenStates: [],
    });
    expect(findings).toEqual([]);
  });

  describe('S0(スキーマ適合)', () => {
    const found = messages(load('screens-invalid').findings);

    it('scope が frontend でなければ失敗する', () => {
      expect(found).toContain('screen_spec の scope は frontend でなければなりません');
    });

    it('id が name から導かれる ID と一致しなければ失敗する', () => {
      expect(found).toContain('id が name(wrong)から導かれる ID と一致しません');
    });

    it('for が空なら失敗する', () => {
      expect(found).toContain('for が空です');
    });

    it('layout が無ければ失敗する', () => {
      expect(found).toContain('layout がありません');
    });

    it('precondition があるのに on_fail が無ければ失敗する', () => {
      expect(found).toContain('precondition があるのに on_fail がありません');
    });

    it('subject が無い画面の precondition をエラーにする', () => {
      expect(found).toContain('subject が無い画面に precondition は書けません');
    });

    it('排他表示(variants)が空なら失敗する', () => {
      expect(found).toContain('排他表示(variants)に部品が 1 つもありません');
    });

    it('排他表示(variants)がマッピングでなければ失敗する', () => {
      expect(
        found.some((message) => message.includes('layout.body.right[0].variants はマッピングで書きます')),
      ).toBe(true);
    });

    it('レイアウトの入れ子が深すぎれば失敗する', () => {
      expect(found).toContain('レイアウトの入れ子が深すぎます(3 段まで)');
    });

    it('重ね表示の id が snake_case でなければ失敗する', () => {
      expect(found).toContain('overlays の id ReportDialog が snake_case ではありません');
    });

    it('操作を発火する重ね表示に opened_by が無ければ失敗する', () => {
      // 開く口の無い重ね表示のボタンは、S10 に「UI 到達がある」と数えられるのに誰も押せない。
      expect(found).toContain('overlays の orphan_dialog は操作を発火しますが opened_by がありません');
    });

    it('空のトップレベル label をエラーにする', () => {
      expect(found).toContain('label が空です');
    });

    it('states.requires の語彙外をエラーにする', () => {
      expect(found).toContain('states.requires の spinning は表示義務の語彙ではありません');
    });

    it('navigations の to が無ければ失敗する', () => {
      expect(found).toContain('to がありません');
    });

    it('置き場が screens/{group}/{name}.md でなければ失敗する', () => {
      expect(
        found.some((message) => message.includes('screens/{group}/{name}.md ではありません')),
      ).toBe(true);
    });

    it('chrome_spec が許可されていない節を持てば失敗する(allowlist)', () => {
      expect(found).toContain('chrome_spec に reads は書けません');
      expect(found).toContain('chrome_spec に actions は書けません');
      expect(found).toContain('chrome_spec に for は書けません');
      expect(found).toContain('chrome_spec に route は書けません');
      // 綴り違いも黙って無視せずエラーにする(禁止リストでは見逃す種類の事故)。
      expect(found).toContain('chrome_spec に navigation は書けません');
    });

    it('chrome_spec の navigations に操作の結果は書けない', () => {
      expect(
        found.some((message) => message.includes('chrome_spec の on に "entry.create.success" は書けません')),
      ).toBe(true);
    });

    it('S0 として積まれる(V1 のままにしない)', () => {
      expect(load('screens-invalid').findings.every((finding) => finding.verifier === 'S0')).toBe(true);
    });

    it('必須項目を読めなかった画面はモデルに載せない', () => {
      const { model } = load('screens-invalid');

      // wrong.md は for が空で読めない。deep.md（入れ子・overlay id）と misplaced.md（置き場）は
      // 必須項目が揃っているので載る — 違反は指摘しつつ、他の検査(S1〜S10)もこれらに効かせたい。
      expect(model.screens.map((screen) => screen.name)).toEqual(['deep', 'misplaced']);
    });
  });
});

describe('checkLabelUniqueness', () => {
  const spec = (name: string, label?: string) => ({
    name,
    ...(label === undefined ? {} : { label }),
    location: { file: `docs/specs/frontend/screens/g/${name}.md` },
  });

  it('表示名が全体で一意なら何も言わない', () => {
    const findings: Finding[] = [];

    checkLabelUniqueness([spec('login', 'ログイン'), spec('home', 'トップ'), spec('guest')], findings);

    expect(findings).toEqual([]);
  });

  it('2 枚の画面が同じ表示名を宣言したら S0 でエラーにする', () => {
    const findings: Finding[] = [];

    checkLabelUniqueness([spec('workshop_list', '催し一覧'), spec('my_workshops', '催し一覧')], findings);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      verifier: 'S0',
      severity: 'error',
      message: 'label "催し一覧" が workshop_list と my_workshops で重複しています',
      location: { file: 'docs/specs/frontend/screens/g/my_workshops.md', pointer: 'label' },
    });
  });
});

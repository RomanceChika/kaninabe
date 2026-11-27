/**
 * H2(着地と関門の接地)のユニットテスト。
 *
 * 規約網羅(auth-spec-writing.md §検証):
 *   - 着地先の画面が実在すること・動的セグメントの画面へ送らないこと
 *   - **案内画面の排他表示と着地が双方向に一致すること**(この検証器の中心)
 *   - 関門の送り先が実在し、それ自身がログインを要求しないこと(無限リダイレクトの禁止)
 *   - 関門の実装が実在すること(関数名まで)
 *   - 画面仕様を読めない構成では何も見ないこと
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyLandingGrounding } from '../../../../lib/auth/verifiers/h2-landing-grounding.js';
import type { CatalogInput } from '../../../../lib/kernel/input-state.js';
import type { ScreenSpecModel } from '../../../../lib/model/screen/types.js';
import { layout, screenSpec } from '../../../helpers/screen-builder.js';
import { authGate, authLanding, authModel } from '../../../helpers/auth-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { loadedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';

/**
 * 関門の実装の実在を見るための、実装の木を持つリポジトリのルート(テストが一時ディレクトリに組む)。
 * 関門の既定の実装(`app/src/composition/auth.ts::requireSession`)だけを置く —— 実物の製品の木には寄りかからない。
 */
const REPO_ROOT = ((): string => {
  const root = mkdtempSync(path.join(tmpdir(), 'h2-landing-'));
  mkdirSync(path.join(root, 'app/src/composition'), { recursive: true });
  writeFileSync(path.join(root, 'app/src/composition/auth.ts'), 'export function requireSession(): void {}\n');
  return root;
})();

/** 案内画面(guest / disabled の 2 つの排他表示を持つ)と催し一覧。 */
function screenModel(init: { readonly loginRequiresAuth?: boolean } = {}): ScreenSpecModel {
  const guestFile = 'docs/specs/frontend/screens/auth/guest.md';
  return {
    available: true,
    screens: [
      screenSpec({ name: 'workshop_list', route: '/workshops' }),
      {
        ...screenSpec({ name: 'guest', route: '/guest' }),
        layout: layout(guestFile, [
          {
            slot: 'body.center',
            components: [
              { name: 'guild_join_guide', variant: 'guest' },
              { name: 'disabled_notice', variant: 'disabled' },
            ],
          },
        ]),
      },
      screenSpec({
        name: 'login',
        route: '/login',
        entryPoint: true,
        requiresAuth: init.loginRequiresAuth ?? false,
      }),
      screenSpec({ name: 'workshop_detail', route: '/workshops/:id' }),
    ],
    chromes: [],
    unexposed: [],
    unreachableStates: [],
    unseenStates: [],
  };
}

/** 画面仕様の入力の状態(読込済み)。 */
function screens(init: { readonly loginRequiresAuth?: boolean } = {}): CatalogInput<ScreenSpecModel> {
  return loadedInput(screenModel(init));
}

/** 排他表示と過不足なく噛み合った着地の宣言。 */
const MATCHED = [
  authLanding('active', { screen: 'screen-workshop-list' }),
  authLanding('guest', { screen: 'screen-guest', variant: 'guest' }),
  authLanding('disabled', { screen: 'screen-guest', variant: 'disabled' }),
];

describe('H2: 着地と関門の接地', () => {
  it('噛み合っていれば違反なし', () => {
    const auth = authModel({ landings: MATCHED, gates: [authGate('session')] });
    expect(verifyLandingGrounding({ roots: TEST_ROOTS, auth, screens: screens(), repoRoot: REPO_ROOT })).toEqual([]);
  });

  it('画面仕様を読めない構成では何も見ない', () => {
    const auth = authModel({ landings: [authLanding('active', { screen: 'nowhere' })] });
    const unavailable: ScreenSpecModel = { ...screenModel(), available: false };
    expect(verifyLandingGrounding({ roots: TEST_ROOTS, auth, screens: loadedInput(unavailable), repoRoot: REPO_ROOT })).toEqual([]);
  });

  it('画面仕様を採っていない(未選択)なら何も見ない', () => {
    const auth = authModel({ landings: [authLanding('active', { screen: 'nowhere' })] });
    expect(verifyLandingGrounding({ roots: TEST_ROOTS, auth, screens: UNSELECTED, repoRoot: REPO_ROOT })).toEqual([]);
  });

  it('画面仕様が阻害(読めずに落とした画面がある)なら判定を出さない — 落とした画面を指す着地を「画面がありません」と言わない', () => {
    const auth = authModel({ landings: [authLanding('active', { screen: 'screen-nowhere' })] });
    const blocked: CatalogInput<ScreenSpecModel> = { state: 'blocked', reason: 'invalid', findings: [], partial: screenModel() };

    expect(verifyLandingGrounding({ roots: TEST_ROOTS, auth, screens: blocked, repoRoot: REPO_ROOT })).toEqual([]);
    // 対: 読込済みなら同じ着地は「画面がありません」になる(保留が効いている)
    expect(verifyLandingGrounding({ roots: TEST_ROOTS, auth, screens: screens(), repoRoot: REPO_ROOT })[0]?.message).toContain('screen-nowhere');
  });

  it('着地先の画面が実在しなければエラー', () => {
    const auth = authModel({ landings: [authLanding('active', { screen: 'screen-nowhere' })] });
    const findings = verifyLandingGrounding({ roots: TEST_ROOTS, auth, screens: screens(), repoRoot: REPO_ROOT });
    expect(findings[0]?.verifier).toBe('H2');
    expect(findings[0]?.message).toContain('screen-nowhere');
  });

  it('動的セグメントを持つ画面へは送れない', () => {
    const auth = authModel({
      landings: [authLanding('active', { screen: 'screen-workshop-detail' })],
    });
    const findings = verifyLandingGrounding({ roots: TEST_ROOTS, auth, screens: screens(), repoRoot: REPO_ROOT });
    expect(findings.some((finding) => finding.message.includes('/workshops/:id'))).toBe(true);
  });

  it('排他表示を持つ画面へ variant 無しで落ちるとエラー', () => {
    const auth = authModel({
      landings: [...MATCHED, authLanding('left', { screen: 'screen-guest' })],
    });
    const findings = verifyLandingGrounding({ roots: TEST_ROOTS, auth, screens: screens(), repoRoot: REPO_ROOT });
    expect(findings.some((finding) => finding.message.includes('variant がありません'))).toBe(true);
  });

  it('宣言されていない variant へ落ちるとエラー', () => {
    const auth = authModel({
      landings: [
        authLanding('active', { screen: 'screen-workshop-list' }),
        authLanding('guest', { screen: 'screen-guest', variant: 'guest' }),
        authLanding('left', { screen: 'screen-guest', variant: 'left' }),
      ],
    });
    const messages = verifyLandingGrounding({ roots: TEST_ROOTS, auth, screens: screens(), repoRoot: REPO_ROOT }).map(
      (finding) => finding.message,
    );
    expect(messages.some((message) => message.includes('variant left は'))).toBe(true);
    // 画面側の disabled には誰も落ちてこない(双方向のもう片側)。
    expect(messages.some((message) => message.includes('排他表示 disabled へ落ちる着地がありません'))).toBe(
      true,
    );
  });

  it('着地が 1 つも variant を宣言しない画面の排他表示は見ない(レイアウトの語彙は認証の関心の外)', () => {
    // 束 ⑲-2b: `variants` は「ロールで出し分ける作成ボタン」のようなレイアウトの語彙でもある。
    // その画面へ着地が落ちるだけで双方向一致を要求すると、サインインと無関係な出し分けを
    // 書いた瞬間に認証の検査がエラーにする(束 ⑱ stores の実測)。
    const auth = authModel({
      landings: [
        authLanding('active', { screen: 'screen-workshop-list' }),
        authLanding('work', { screen: 'screen-guest' }),
      ],
      gates: [authGate('session')],
    });

    expect(verifyLandingGrounding({ roots: TEST_ROOTS, auth, screens: screens(), repoRoot: REPO_ROOT })).toEqual([]);
  });

  it('着地が 1 つでも variant を宣言すれば、その画面は双方向に閉じる', () => {
    const auth = authModel({
      landings: [
        authLanding('active', { screen: 'screen-workshop-list' }),
        authLanding('guest', { screen: 'screen-guest', variant: 'guest' }),
        authLanding('work', { screen: 'screen-guest' }),
      ],
      gates: [authGate('session')],
    });

    const messages = verifyLandingGrounding({ roots: TEST_ROOTS, auth, screens: screens(), repoRoot: REPO_ROOT }).map(
      (finding) => finding.message,
    );

    expect(messages.some((message) => message.includes('variant がありません'))).toBe(true);
    expect(messages.some((message) => message.includes('排他表示 disabled へ落ちる着地がありません'))).toBe(true);
  });

  it('排他表示を持たない画面に variant を書くとエラー', () => {
    const auth = authModel({
      landings: [
        ...MATCHED,
        authLanding('extra', { screen: 'screen-workshop-list', variant: 'anything' }),
      ],
    });
    const findings = verifyLandingGrounding({ roots: TEST_ROOTS, auth, screens: screens(), repoRoot: REPO_ROOT });
    expect(findings.some((finding) => finding.message.includes('排他表示はありません'))).toBe(true);
  });

  it('関門の送り先が実在しなければエラー', () => {
    const auth = authModel({ landings: MATCHED, gates: [authGate('session', { to: 'screen-nope' })] });
    const findings = verifyLandingGrounding({ roots: TEST_ROOTS, auth, screens: screens(), repoRoot: REPO_ROOT });
    expect(findings[0]?.message).toContain('screen-nope');
  });

  it('送り先自身がログインを要求するとエラー(無限リダイレクト)', () => {
    const auth = authModel({ landings: MATCHED, gates: [authGate('session')] });
    const findings = verifyLandingGrounding({ roots: TEST_ROOTS,
      auth,
      screens: screens({ loginRequiresAuth: true }),
      repoRoot: REPO_ROOT,
    });
    expect(findings.some((finding) => finding.message.includes('自身がログインを必要とします'))).toBe(true);
  });

  it('関門の実装が実在しなければエラー / 関数名が無くてもエラー', () => {
    const missingFile = authModel({
      landings: MATCHED,
      gates: [authGate('session', { implementation: 'app/src/composition/nope.ts::requireSession' })],
    });
    expect(
      verifyLandingGrounding({ roots: TEST_ROOTS, auth: missingFile, screens: screens(), repoRoot: REPO_ROOT })[0]?.message,
    ).toContain('実在しません');

    const missingSymbol = authModel({
      landings: MATCHED,
      gates: [authGate('session', { implementation: 'app/src/composition/auth.ts::requireNothing' })],
    });
    expect(
      verifyLandingGrounding({ roots: TEST_ROOTS, auth: missingSymbol, screens: screens(), repoRoot: REPO_ROOT })[0]?.message,
    ).toContain('requireNothing');
  });

  it('範囲の印: ファイルが無いだけの実装には印が付き、`::関数名` / `ファイル::` / `::` なしの書き間違いには付かない', () => {
    const find = (implementation: string) =>
      verifyLandingGrounding({ roots: TEST_ROOTS, auth: authModel({ landings: MATCHED, gates: [authGate('session', { implementation })] }), screens: screens(), repoRoot: REPO_ROOT })[0];

    expect(find('app/src/composition/nope.ts::requireSession')?.absentFor).toEqual({ kind: 'catalog', id: 'auth-flow' });
    for (const malformed of ['::requireSession', 'app/src/composition/nope.ts::', '::', 'app/src/composition/nope.ts']) {
      const finding = find(malformed);
      expect(finding?.message, malformed).toContain('実在しません');
      expect(finding?.absentFor, malformed).toBeUndefined();
    }
  });

  it('画面仕様が阻害でも、画面に依らない関門の実装の実在は見る(画面との突合だけを止める)。未選択は何も見ない', () => {
    const blocked: CatalogInput<ScreenSpecModel> = { state: 'blocked', reason: 'invalid', findings: [], partial: screenModel() };
    const missingFile = authModel({
      landings: [authLanding('active', { screen: 'screen-nowhere' })],
      gates: [authGate('session', { implementation: 'app/src/composition/nope.ts::requireSession' })],
    });

    const findings = verifyLandingGrounding({ roots: TEST_ROOTS, auth: missingFile, screens: blocked, repoRoot: REPO_ROOT });

    // 着地先の「画面がありません」は言わず、実装の実在だけを言う
    expect(findings.map((finding) => finding.message)).toEqual([expect.stringContaining('implementation')]);
    expect(findings[0]?.message).toContain('実在しません');
    expect(verifyLandingGrounding({ roots: TEST_ROOTS, auth: missingFile, screens: UNSELECTED, repoRoot: REPO_ROOT })).toEqual([]);
    // 実装の実在が正しければ、阻害のときは何も言わない
    expect(verifyLandingGrounding({ roots: TEST_ROOTS, auth: authModel({ gates: [authGate('session')] }), screens: blocked, repoRoot: REPO_ROOT })).toEqual([]);
  });
});

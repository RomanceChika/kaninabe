/**
 * 認証基盤の操作の画面の部品(`kind: platform_read` / `platform_actions` / `kind: table` の `row_actions`。ADR-0019)の生成器のテスト。
 *
 * 固定するのは:
 *   - 表: 列・見出し(宣言した `labels`)・整形(`formats: datetime` は表示のタイムゾーンを器から受ける)・null と真偽値の表示・空の表示
 *   - 行のボタン: 宣言した `skip_if` でいまの端末の行を抑える・行から受ける識別子を入力に渡す・確認の器は重ね表示の testid から引く
 *   - ボタン列: 行を持たない・確認の重ね表示を経る / 表の行の提供者: 確認と拒否の表示は表の外側に 1 回だけ(行の数に依らない)
 *   - 部品が `_actions` を import しない・業務の判断(`if` でロールや状態を見る)を持たない
 *   - 宣言の無い製品・部品の無い製品は何も出さない
 */

import { describe, expect, it } from 'vitest';
import { platformPartsGenerator } from '../../../../lib/generate/render/code-platform-parts.js';
import { buildPlatformParts } from '../../../../lib/generate/render/platform-parts-plan.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';
import { platformContext } from '../../../helpers/platform-ops-fixture.js';
import { specModel } from '../../../helpers/model-builder.js';

/** 部品の本文(ファイル名の末尾で引く)。 */
function parts(ctx: GenerateContext): ReadonlyMap<string, string> {
  return new Map(platformPartsGenerator.generate(specModel([]), ctx).map((section) => [section.file.split('/').pop() ?? section.file, section.content]));
}

describe('buildPlatformParts', () => {
  it('部品の形を 3 つに振り分け、行のボタンの入力・確認の器・抑える欄を宣言から導く', () => {
    const plans = buildPlatformParts(platformContext());

    expect(plans.map((plan) => `${plan.kind}:${plan.screen}.${plan.component}`)).toEqual(['read:sessions.session_table', 'bar:sessions.end_others_bar', 'rows:member_admin.member_table', 'bar:member_admin.member_bulk_bar']);
    const read = plans[0];
    expect(read?.buttons.map((button) => ({ leaf: button.leaf, inputs: button.inputEntries, skip: button.skipProp }))).toEqual([{ leaf: 'end_mine', inputs: ['sessionId: row.id'], skip: 'isCurrent' }]);
    expect(read?.buttons[0]?.confirm).toBeUndefined();
    expect(read?.shows.map((field) => field.field)).toEqual(['last_used_at', 'is_current']);
    expect(plans[1]?.buttons[0]?.confirm).toEqual({ dialogKey: 'overlay.end_others_confirm.body.center', barKey: 'overlay.end_others_confirm.body.center.confirm_bar', labelKey: 'overlay.end_others_confirm' });
    expect(plans[2]?.rowProps).toEqual(['id']);
    // 型つきの入力は既定の値で渡す。
    expect(plans[3]?.buttons[0]?.inputEntries).toEqual(['keepSelf: true']);
  });

  it('宣言の無い製品・認証基盤の部品を持たない画面は空', () => {
    expect(buildPlatformParts(GEN_CTX)).toEqual([]);
    expect(buildPlatformParts(platformContext({ screens: [] }))).toEqual([]);
  });
});

describe('platformPartsGenerator', () => {
  it('部品ごとに 1 本(表・ボタン列・表の行の提供者)を出し、宣言の無い製品は何も出さない', () => {
    const files = parts(platformContext());

    expect([...files.keys()].sort()).toEqual(['member_admin.member_bulk_bar.tsx', 'member_admin.member_table.platform.tsx', 'sessions.end_others_bar.tsx', 'sessions.session_table.tsx']);
    expect(platformPartsGenerator.generate(specModel([]), GEN_CTX)).toEqual([]);
  });

  describe('platform_read(表)', () => {
    const table = (): string => parts(platformContext()).get('sessions.session_table.tsx') ?? '';

    it('列・見出し(宣言した labels)・整形(日時は器の timeZone)・真偽値の表示が宣言から決まる', () => {
      const text = table();

      expect(text.startsWith("'use client';")).toBe(true);
      expect(text).toContain('最後に使った日時</th>');
      expect(text).toContain('data-testid={`${TESTID}.column.last_used_at`}');
      expect(text).toContain('{formatDateTime(row.lastUsedAt, timeZone)}');
      expect(text).toContain('{row.isCurrent ? YES : NO}');
      expect(text).toContain('readonly timeZone: string;');
      expect(text).toContain("const EMPTY_MESSAGE = 'ログイン中の端末はまだありません';");
    });

    it('行のボタン: skip_if でいまの端末の行を抑え、行の識別子を入力に渡し、確認は要らない', () => {
      const text = table();

      expect(text).toContain('available: (row) => !row.isCurrent,');
      expect(text).toContain("run: (row) => actions['session.end_mine']({ sessionId: row.id }),");
      expect(text).not.toContain('confirm: {');
      expect(text).toContain('{rowActions.buttons(row)}');
      expect(text).toContain('{rowActions.footer}');
    });

    it('部品は Server Action を import せず(器が渡す)、ロールや状態を見る分岐を持たない', () => {
      const text = table();

      expect(text).not.toMatch(/from '[^']*_actions/u);
      expect(text).not.toMatch(/role|state ===|\.state\b/u);
      expect(text).toContain('readonly actions: {\n    readonly \'session.end_mine\': (input: SessionEndMineInput) => Promise<PlatformOpResult<boolean>>;');
    });
  });

  describe('platform_actions(ボタン列)', () => {
    it('行を持たず、確認が要る操作は重ね表示の器(testid と見出し)を経る', () => {
      const text = parts(platformContext()).get('sessions.end_others_bar.tsx') ?? '';

      expect(text).toContain('type NoRow = Readonly<Record<string, never>>;');
      expect(text).toContain("dialogTestId: sessionsTestIds['overlay.end_others_confirm.body.center'],");
      expect(text).toContain("confirmBarTestId: sessionsTestIds['overlay.end_others_confirm.body.center.confirm_bar'],");
      expect(text).toContain("label: sessionsLabels['overlay.end_others_confirm'],");
      expect(text).toContain("run: () => actions['session.end_others']({}),");
      expect(text).toContain('{bar.buttons(NO_ROW)}\n      {bar.footer}');
    });

    it('型つきの入力は既定の値で渡す。確認の重ね表示を宣言していなければ確認の器は付かない(宣言の整合は S20 が止める)', () => {
      const text = parts(platformContext()).get('member_admin.member_bulk_bar.tsx') ?? '';

      expect(text).toContain("run: () => actions['session.end_every']({ keepSelf: true }),");
      expect(text).not.toContain('confirm: {');
    });
  });

  describe('table の row_actions(表の行の提供者)', () => {
    it('提供者が確認と拒否の表示を 1 回だけ引き受け、行のボタンは文脈から取る(行の数に依らない)', () => {
      const text = parts(platformContext()).get('member_admin.member_table.platform.tsx') ?? '';

      expect(text).toContain('export function MemberAdminMemberTablePlatformProvider(');
      expect(text).toContain('<Context.Provider value={rowActions}>\n      {children}\n      {rowActions.footer}\n    </Context.Provider>');
      expect(text).toContain('export function MemberAdminMemberTablePlatformButtons({ row }');
      expect(text).toContain("run: (row) => actions['session.end_member']({ memberId: row.id }),");
      expect(text).toContain("dialogTestId: memberAdminTestIds['overlay.end_member_confirm.body.center'],");
      expect(text).toContain("label: platformOpLabels['session.end_member'],\n        run:"); // 重ね表示に label が無い → 操作の表示名
    });
  });
});

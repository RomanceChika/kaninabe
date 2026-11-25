/**
 * 認証基盤の操作(`platform_ops`)の生成テストの生成器のテスト(ADR-0019)。
 *
 * 固定するのは、宣言から導く期待の表と、期待が無い試験を書かないこと:
 *   - 権限表: 本人の操作は未ログイン以外の全員・ロールの操作は宣言したロールの持ち主だけ(無効化された持ち主は `active_member` の宣言で決まる)
 *   - 偽造 ID の試験は「本人の読みの行から受ける識別子」を持つ操作だけ・現在の端末の試験は `needs: current_session` の操作があるときだけ・
 *     結果の写しの試験は読みの操作があるときだけ(母集合が空の試験は黙って緑になるので書かない)
 *   - 型つきの入力の変種(真偽値は true / false の両方)・配線先が受けるはずの呼び出し(対応表から)・余分な欄に秘密の語を使うこと
 *   - 多要素認証の試験は要求する製品でだけ。仕様の `test_cases` が題を指していれば `@tc` の注釈が付く
 *   - 宣言の無い製品・実装の木を持たない製品は何も出さない
 */

import { describe, expect, it } from 'vitest';
import { platformOpsTestsGenerator } from '../../../../lib/generate/render/code-platform-ops-tests.js';
import { PLATFORM_TEST_TITLES } from '../../../../lib/generate/render/platform-ops-test-body.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import { loc } from '../../../helpers/model-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';
import { designSection, MFA_ALL, MFA_EXEMPT, platformContext } from '../../../helpers/platform-ops-fixture.js';
import { platformOp, platformOpsSection, rowArg } from '../../../helpers/auth-builder.js';
import { specModel } from '../../../helpers/model-builder.js';

/** 生成テストの本文。 */
function render(ctx: GenerateContext): { readonly file: string; readonly content: string } {
  const sections = platformOpsTestsGenerator.generate(specModel([]), ctx);
  const section = sections[0];
  if (sections.length !== 1 || section === undefined) throw new Error(`生成テストは 1 本のはずです(${sections.length} 本)`);
  return section;
}

describe('platformOpsTestsGenerator', () => {
  it('宣言の無い製品・実装の木を持たない製品は何も出さない', () => {
    expect(platformOpsTestsGenerator.generate(specModel([]), GEN_CTX)).toEqual([]);
    expect(platformOpsTestsGenerator.generate(specModel([]), { ...platformContext(), roots: { ...GEN_CTX.roots, app: null } })).toEqual([]);
  });

  it('権限表: 本人の操作は未ログイン以外の全員・ロールの操作は宣言したロールの持ち主だけ(有効メンバーが必須ならロールの持ち主でも無効化されていれば拒む)', () => {
    const { content } = render(platformContext());

    expect(content).toContain("type ActorName = 'logged_out' | 'signed_in' | 'holder_staff' | 'deactivated_staff';");
    const row = (op: string): string => content.slice(content.indexOf(`id: '${op}'`), content.indexOf('probe:', content.indexOf(`id: '${op}'`)));
    expect(row('session.end_mine')).toContain("allowed: ['signed_in', 'holder_staff', 'deactivated_staff']");
    expect(row('session.end_member')).toContain("allowed: ['holder_staff']");
    expect(row('session.end_member')).toContain("defaultMode: 'foreign'");
    // active_member: false のロールの操作は、無効化された持ち主にも許す。
    const lenient = platformOpsSection([platformOp('session.end_every', { actor: { kind: 'role', role: 'staff', activeMember: false }, confirm: true })]);
    expect(render(platformContext({ section: lenient, screens: [] })).content).toContain("allowed: ['holder_staff', 'deactivated_staff']");
  });

  it('接続: 型つきの入力は真偽値の両方を変種にし、配線先が受けるはずの呼び出しを対応表から導く', () => {
    const { content } = render(platformContext());

    expect(content).toContain('variants: [{"keepSelf":true},{"keepSelf":false}],');
    expect(content).toContain("const input = { keepSelf: variant['keepSelf'] === true };");
    expect(content).toContain("expected: [{ method: 'end_every', args: [{ keepSelf: input.keepSelf }] }]");
    expect(content).toContain("expected: [{ method: 'end_mine', args: [input.sessionId] }]");
    expect(content).toContain("sessionId: targetOf(world, 'session.list_mine', options.mode ?? 'own')");
    expect(content).toContain("memberId: targetOf(world, 'query-member-admin-list', options.mode ?? 'own')");
  });

  it('入力のスキーマの試験の表: 識別子は UUID の形の値・宣言した引数だけが欄になる', () => {
    const { content } = render(platformContext());

    expect(content).toContain('{ id: \'session.end_mine\', schema: sessionEndMineInputSchema, props: ["sessionId"], rowProps: ["sessionId"], valid: {"sessionId":"00000000-0000-4000-8000-000000000001"} },');
    expect(content).toContain('{ id: \'session.list_mine\', schema: sessionListMineInputSchema, props: [], rowProps: [], valid: {} },');
  });

  it('余分な欄の試験は、秘密の語を名前に使う(語は製品の宣言から)', () => {
    const { content } = render(platformContext());

    expect(content).toContain('"unexpectedExtra": LEAK_MARKER, "tokenValue": LEAK_MARKER, "refreshValue": LEAK_MARKER, "secretValue": LEAK_MARKER, "jwtValue": LEAK_MARKER');
  });

  it('本人の読みの行から受ける識別子・現在の端末を要る操作・読みの操作がある製品は、その 3 つの試験を書く。無い製品は書かない', () => {
    const full = render(platformContext()).content;
    for (const key of ['matrix', 'currentSession', 'forged', 'connection', 'projection', 'schema', 'gates'] as const) {
      expect(full, key).toContain(`it(${JSON.stringify(PLATFORM_TEST_TITLES[key])}`);
    }
    // 現在の端末・本人の行から受ける識別子・読みの操作を 1 つも持たない宣言。
    const bare = platformOpsSection([platformOp('session.end_every', { actor: { kind: 'role', role: 'staff', activeMember: true }, confirm: true })]);
    const content = render(platformContext({ section: bare, screens: [] })).content;
    for (const key of ['currentSession', 'forged', 'projection'] as const) {
      expect(content, key).not.toContain(PLATFORM_TEST_TITLES[key]);
    }
    expect(content).toContain(PLATFORM_TEST_TITLES.matrix);
    // 空の母集合を回す試験が無い(黙って緑にならない): 書いた試験は必ずループの外で母集合が空でないことを確かめる。
    expect(full).toContain('expect(CASES).not.toHaveLength(0);');
    expect(full).toContain('expect(cases).not.toHaveLength(0);');
  });

  it('本人の読みの行でない出どころ(別の読み)から受ける識別子は、偽造 ID の試験の対象にしない', () => {
    const memberOnly = platformOpsSection([platformOp('session.end_member', { actor: { kind: 'role', role: 'staff', activeMember: true }, confirm: true, args: [rowArg('member_id', 'query-member-admin-list', 'id')] })]);
    const content = render(platformContext({ section: memberOnly, screens: [] })).content;

    expect(content).toContain('selfRows: false,');
    expect(content).not.toContain(PLATFORM_TEST_TITLES.forged);
  });

  it('多要素認証の試験は要求する製品でだけ書き、済ませていないセッションの場面を渡す', () => {
    const required = render(platformContext({ mfa: MFA_ALL })).content;

    expect(required).toContain(PLATFORM_TEST_TITLES.mfa);
    expect(required).toContain('actorMfa: options.mfa ?? true');
    expect(required).toContain("probe.result.refusal.kind, op.id).toBe('mfa_required')");
    const exempt = render(platformContext({ mfa: MFA_EXEMPT })).content;
    expect(exempt).not.toContain(PLATFORM_TEST_TITLES.mfa);
    expect(exempt).not.toContain('actorMfa');
  });

  it('入口の関門の表は、入口と組み立ての根を生成テストからの相対で指し、組み立てを呼ぶ字面を持つ', () => {
    const { content } = render(platformContext({ mfa: MFA_ALL }));

    expect(content).toContain("entryFile: '../../../app/_actions/platform/session/end_every.ts'");
    expect(content).toContain("compositionFile: '../../platform/session/end_every.ts'");
    expect(content).toContain("callText: 'sessionEndEvery({ actorId, actorMfa }, parsed.data)'");
    expect(content).toContain("compose: 'sessionEndEvery', mfa: true");
  });

  it('仕様の test_cases がこのファイルの題を指していれば @tc の注釈が付き、指していなければ付かない', () => {
    const base = render(platformContext());
    expect(base.content).not.toContain('@tc');

    const testCases = [
      {
        id: 'TC-AUTH-PLATFORM-001',
        type: 'unit' as const,
        specIds: ['auth-flow'],
        covers: ['forbidden' as const],
        implementation: { raw: 'x', file: base.file, testName: PLATFORM_TEST_TITLES.matrix },
        location: loc('docs/specs/backend/auth.md', 'test_cases'),
      },
    ];
    const tagged = render(platformContext({ testCases })).content;

    expect(tagged).toContain(`  // @spec auth-flow @tc TC-AUTH-PLATFORM-001\n  it(${JSON.stringify(PLATFORM_TEST_TITLES.matrix)}`);
    expect(tagged.match(/@tc /gu)).toHaveLength(1);
  });

  it('設計どおりの宣言の場面の関数は、操作ごとに配線先の組み立ての根を呼ぶ', () => {
    const { content } = render(platformContext());

    expect(designSection().ops).toHaveLength(5);
    for (const op of ['SessionListMine', 'SessionEndMine', 'SessionEndOthers', 'SessionEndMember', 'SessionEndEvery']) {
      expect(content).toContain(`async function probe${op}(`);
      expect(content).toContain(`${op.charAt(0).toLowerCase()}${op.slice(1)}({ actorId: spec.actor?.id ?? null }, input, port)`);
    }
  });
});

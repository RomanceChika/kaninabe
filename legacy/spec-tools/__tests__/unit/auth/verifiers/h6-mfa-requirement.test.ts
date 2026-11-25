/**
 * H6(多要素認証の要求)のユニットテスト。
 *
 * 規約網羅(auth-spec-writing.md §`mfa`):
 *   - 外す宣言は毎回 warning で名指し、受け入れた危険(`acceptance`)として出す。組み立ての根が W5 へ渡す宣言と同じもの
 *   - ロールで絞る要求のロールは roles.md に実在し、サインインする人のロールであること
 *   - 送り先の画面は実在し、引数なしで送れて、ログインを要求し、ロールで絞るならそのロールの画面でないこと
 *   - 確かめる関数の実在を、字面ではなく構文木の export で見る(実装の木が無い構成では飛ばす)
 *   - 書き込みの入口の解決の関数(`resolveSessionMfa`)が認証の組み立ての根から export されていること(要求するときだけ)
 *   - `runner: manual` の操作の手書きの Server Action が、組み立ての根を呼ぶ前に多要素認証の判定を呼んで返していること
 *     (構文木で見る。呼んでいなければ赤・呼んでいれば緑・外す宣言なら見ない・Server Action が無い操作は見ない)
 *   - 画面が未選択・阻害なら画面との突合は出さない(ロールと関数は見る)
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mfaAcceptances, verifyMfaRequirement } from '../../../../lib/auth/verifiers/h6-mfa-requirement.js';
import type { AuthMfaDecl } from '../../../../lib/model/auth/mfa.js';
import type { ScreenSpecModel } from '../../../../lib/model/screen/types.js';
import type { CatalogInput } from '../../../../lib/kernel/input-state.js';
import { authModel } from '../../../helpers/auth-builder.js';
import { loc } from '../../../helpers/model-builder.js';
import { role, specModel } from '../../../helpers/model-builder-v8plus.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_LAYOUT } from '../../../helpers/platform.js';
import { layoutModule, layoutPath } from '../../../../lib/model/product/layout.js';
import type { ActionSpecModel } from '../../../../lib/model/trace/types.js';
import { actionSpec } from '../../../helpers/trace-builder.js';
import { screenSpec } from '../../../helpers/screen-builder.js';
import { blockedInput, loadedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';

/** 認証の組み立ての根(配置が決める場所。リポジトリルート相対)。 */
const AUTH_COMPOSITION = layoutPath(TEST_LAYOUT, TEST_ROOTS.app, 'auth-composition') ?? '';

/**
 * 確かめる関数と書き込みの入口の解決を置いた実装の木。
 *
 * `impl/gate.ts` は、export した関数のほかに **export していない関数**と**コメントの中の名前**を持つ(字面で見ると通ってしまう形)。
 */
function implementationTree(composition: string, extra: Readonly<Record<string, string>> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'h6-mfa-'));
  mkdirSync(path.join(root, TEST_ROOTS.app ?? ''), { recursive: true });
  mkdirSync(path.join(root, 'impl'), { recursive: true });
  writeFileSync(
    path.join(root, 'impl/gate.ts'),
    ['export function requireMfa(): void {}', 'function requireHidden(): void {}', '// requireComment は無い', 'export { requireHidden as requireAlias };', ''].join('\n'),
  );
  mkdirSync(path.dirname(path.join(root, AUTH_COMPOSITION)), { recursive: true });
  writeFileSync(path.join(root, AUTH_COMPOSITION), composition);
  for (const [file, content] of Object.entries(extra)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return root;
}

const REPO_ROOT = implementationTree('export async function resolveSessionMfa(): Promise<boolean> { return false; }\n');

/** 実装の木を持たないリポジトリ。 */
const SPEC_ONLY = mkdtempSync(path.join(tmpdir(), 'h6-spec-only-'));

const DOMAIN = specModel({ roles: [role('anonymous'), role('member'), role('system'), role('desk', undefined, ['member'], undefined)] });

const MFA_SCREEN = screenSpec({ name: 'mfa', route: '/mfa', requiresAuth: true, for: ['member'] });

/** 画面仕様(送り先の画面だけ、または差し替えた画面)。 */
function screens(...list: ReturnType<typeof screenSpec>[]): CatalogInput<ScreenSpecModel> {
  return loadedInput({ available: true, screens: list.length === 0 ? [MFA_SCREEN] : list, chromes: [], unexposed: [], unreachableStates: [], unseenStates: [] });
}

/** 要求の宣言。 */
function requirement(overrides: Partial<Extract<AuthMfaDecl, { kind: 'require' }>> = {}): AuthMfaDecl {
  return { kind: 'require', scope: { kind: 'all' }, to: 'screen-mfa', implementation: 'impl/gate.ts::requireMfa', summary: '求める', location: loc('docs/specs/backend/auth.md', 'mfa'), ...overrides };
}

/** 検査を回す。 */
function run(mfa: AuthMfaDecl | undefined, input: Partial<Parameters<typeof verifyMfaRequirement>[0]> = {}): ReturnType<typeof verifyMfaRequirement> {
  const model = authModel(mfa === undefined ? {} : { mfa });
  return verifyMfaRequirement({ auth: model, domain: DOMAIN, screens: screens(), repoRoot: REPO_ROOT, roots: TEST_ROOTS, layout: TEST_LAYOUT, actions: UNSELECTED, ...input });
}

describe('H6: 多要素認証の要求', () => {
  it('送り先・関数が接地した要求は違反なし(全員にも、ロールで絞っても)', () => {
    expect(run(requirement())).toEqual([]);
    expect(run(requirement({ scope: { kind: 'roles', roles: ['desk'] } }))).toEqual([]);
  });

  it('外す宣言は warning で名指し、受け入れた危険として出す(W5 へ渡す宣言と同じ)', () => {
    const exempt: AuthMfaDecl = { kind: 'exempt', reason: '敷居を上げない', location: loc('docs/specs/backend/auth.md', 'mfa') };
    const findings = run(exempt);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'H6', severity: 'warning', acceptance: { reason: '敷居を上げない', location: { pointer: 'mfa' } } });
    expect(findings[0]?.message).toContain('多要素認証を外しています(理由: 敷居を上げない)');
    expect(mfaAcceptances(authModel({ mfa: exempt }).flow)).toEqual([findings[0]?.acceptance]);
    expect(mfaAcceptances(authModel({ mfa: requirement() }).flow)).toEqual([]);
    expect(mfaAcceptances(null)).toEqual([]);
  });

  it('宣言が読めなければ何も言わない(H0 が言っている)', () => {
    expect(run(undefined)).toEqual([]);
  });

  it('ロールが実在しない・サインインしないロールならエラー', () => {
    const findings = run(requirement({ scope: { kind: 'roles', roles: ['nobody', 'anonymous', 'system'] } }));

    expect(findings.map((finding) => finding.message)).toEqual([
      'mfa.require.roles の nobody は roles.md に定義されていません',
      expect.stringContaining('mfa.require.roles の anonymous は kind: anonymous のロールで'),
      expect.stringContaining('mfa.require.roles の system は kind: system のロールで'),
    ]);
  });

  it('送り先の画面が無い・動的な route・ログインを要求しない・要求に掛かるロールの画面ならエラー', () => {
    expect(run(requirement({ to: 'screen-nowhere' }))[0]?.message).toBe('mfa.to screen-nowhere に対応する画面がありません');
    const dynamic = screenSpec({ name: 'mfa', route: '/mfa/:step', requiresAuth: true });
    expect(run(requirement(), { screens: screens(dynamic) })[0]?.message).toContain('動的セグメントを持ちます');
    const open = screenSpec({ name: 'mfa', route: '/mfa', requiresAuth: false });
    expect(run(requirement(), { screens: screens(open) })[0]?.message).toContain('requires_auth: true ではありません');
    const looped = screenSpec({ name: 'mfa', route: '/mfa', requiresAuth: true, for: ['desk'] });
    expect(run(requirement({ scope: { kind: 'roles', roles: ['desk'] } }), { screens: screens(looped) })[0]?.message).toContain('多要素認証を要求するロールの画面です');
  });

  it('確かめる関数が実在しなければエラー(実装の木との突合)。実装の木が無ければ見ない', () => {
    const missingFile = run(requirement({ implementation: 'impl/nowhere.ts::requireMfa' }));
    expect(missingFile).toEqual([expect.objectContaining({ grounding: 'implementation', message: expect.stringContaining('が実在しません') })]);
    expect(run(requirement({ implementation: 'impl/gate.ts::requireOther' }))[0]?.message).toContain('requireOther を export していません');
    expect(run(requirement({ implementation: 'impl/nowhere.ts::requireMfa' }), { repoRoot: SPEC_ONLY })).toEqual([]);
  });

  it('確かめる関数は字面ではなく構文木の export で見る(export していない関数・コメントの中の名前は無いのと同じ。別名の export は在る)', () => {
    expect(run(requirement({ implementation: 'impl/gate.ts::requireHidden' }))[0]?.message).toContain('requireHidden を export していません');
    expect(run(requirement({ implementation: 'impl/gate.ts::requireComment' }))[0]?.message).toContain('requireComment を export していません');
    expect(run(requirement({ implementation: 'impl/gate.ts::requireAlias' }))).toEqual([]);
  });

  it('要求するなら、認証の組み立ての根が書き込みの入口の解決(resolveSessionMfa)を export していなければエラー。外す宣言・実装の木が無い構成では見ない', () => {
    const unexported = implementationTree('async function resolveSessionMfa(): Promise<boolean> { return false; }\n// resolveSessionMfa\n');
    const findings = run(requirement(), { repoRoot: unexported });
    expect(findings).toEqual([
      expect.objectContaining({ grounding: 'implementation', counterexample: { file: AUTH_COMPOSITION, symbol: 'resolveSessionMfa' } }),
    ]);
    expect(findings[0]?.message).toContain(`認証の組み立ての根 ${AUTH_COMPOSITION} が resolveSessionMfa を export していません`);
    expect(run(requirement({ scope: { kind: 'roles', roles: ['desk'] } }), { repoRoot: unexported })).toHaveLength(1);
    const exempt: AuthMfaDecl = { kind: 'exempt', reason: '敷居を上げない', location: loc('docs/specs/backend/auth.md', 'mfa') };
    expect(run(exempt, { repoRoot: unexported }).map((finding) => finding.severity)).toEqual(['warning']);
    expect(run(requirement(), { repoRoot: SPEC_ONLY })).toEqual([]);
  });

  it('画面が未選択・阻害なら画面との突合は出さない(ロールと関数は見る)', () => {
    const broken = requirement({ to: 'screen-nowhere', scope: { kind: 'roles', roles: ['nobody'] }, implementation: 'impl/gate.ts::requireOther' });
    const inputs: readonly CatalogInput<ScreenSpecModel>[] = [UNSELECTED, blockedInput('missing')];
    for (const input of inputs) {
      const messages = run(broken, { screens: input }).map((finding) => finding.message);
      expect(messages.some((message) => message.includes('screen-nowhere'))).toBe(false);
      expect(messages).toHaveLength(2);
    }
  });

  describe('runner: manual の操作の手書きの Server Action', () => {
    const OP = 'widget.settle';
    const ACTION_FILE = layoutPath(TEST_LAYOUT, TEST_ROOTS.app, 'operation-entry', OP) ?? '';
    const COMPOSITION = layoutModule(TEST_LAYOUT, 'operation-composition', OP) ?? '';
    const AUTH_MODULE = layoutModule(TEST_LAYOUT, 'auth-composition') ?? '';
    const RESOLVER = 'export async function resolveSessionMfa(): Promise<boolean> { return false; }\n';

    /** action_spec(手書きの操作 1 本と、生成に乗る操作 1 本)。 */
    const ACTIONS: ActionSpecModel = {
      actions: [actionSpec({ handles: OP, runner: { reason: '専用の RPC を呼ぶため' } }), actionSpec({ handles: 'widget.send' })],
      unhandled: [],
      scans: [],
      unscanned: [],
      testTagBaseline: [],
    };

    /** 手書きの Server Action の本文(本体の前の行だけ差し替える)。 */
    function actionSource(beforeBody: readonly string[]): string {
      return [
        "'use server';",
        "import { err } from '@kaninabe/runtime/result';",
        "import { refuseUnverifiedMfa } from '@kaninabe/runtime/template/mfa';",
        `import { createSettleWidget } from '${COMPOSITION}';`,
        `import { resolveSessionMfa } from '${AUTH_MODULE}';`,
        "import { resolveSessionMfa as fake } from './elsewhere';",
        '',
        'export async function settleWidgetAction(input: unknown) {',
        ...beforeBody.map((line) => `  ${line}`),
        '  return createSettleWidget()(input);',
        '}',
        '',
      ].join('\n');
    }

    const GUARDED = actionSource([
      'const actorMfa = await resolveSessionMfa();',
      "const refusal = refuseUnverifiedMfa(runtimeBindings, { actorId, actorMfa }, ['member'], 'widget.settle');",
      'if (refusal !== null) return err(refusal);',
    ]);

    it('組み立ての根の前に判定を呼んで返していなければ赤(呼ばない・結果を捨てる・コメントだけ)', () => {
      for (const body of [[], ["refuseUnverifiedMfa(runtimeBindings, { actorId, actorMfa }, ['member'], 'widget.settle');"], ['// refuseUnverifiedMfa を呼ぶ']]) {
        const repo = implementationTree(RESOLVER, { [ACTION_FILE]: actionSource(body) });
        const findings = run(requirement(), { repoRoot: repo, actions: loadedInput(ACTIONS) });
        expect(findings).toEqual([
          expect.objectContaining({ verifier: 'H6', severity: 'error', grounding: 'implementation', counterexample: { operation: OP, file: ACTION_FILE, export: 'settleWidgetAction', state: 'unguarded' } }),
        ]);
        expect(findings[0]?.message).toContain(`runner: manual の操作 ${OP} の手書きの Server Action`);
      }
    });

    it('判定を呼んで返していれば緑。範囲がロールでも同じ', () => {
      const repo = implementationTree(RESOLVER, { [ACTION_FILE]: GUARDED });
      expect(run(requirement(), { repoRoot: repo, actions: loadedInput(ACTIONS) })).toEqual([]);
      expect(run(requirement({ scope: { kind: 'roles', roles: ['desk'] } }), { repoRoot: repo, actions: loadedInput(ACTIONS) })).toEqual([]);
    });

    it('判定に渡す actorMfa が認証の組み立ての根の resolveSessionMfa() の結果でなければ赤(決め打ち・別の出どころ・let・欄なし・spread / 算出のキー / 重ね書き・位置違い。外部レビュー)', () => {
      const unsourced = [
        ["const refusal = refuseUnverifiedMfa(runtimeBindings, { actorId, actorMfa: true }, ['member'], 'widget.settle');"],
        ['const actorMfa = await fake();', "const refusal = refuseUnverifiedMfa(runtimeBindings, { actorId, actorMfa }, ['member'], 'widget.settle');"],
        ['let actorMfa = await resolveSessionMfa();', "const refusal = refuseUnverifiedMfa(runtimeBindings, { actorId, actorMfa }, ['member'], 'widget.settle');"],
        ["const refusal = refuseUnverifiedMfa(runtimeBindings, actor, ['member'], 'widget.settle');"],
        ["const refusal = refuseUnverifiedMfa(runtimeBindings, { actorId, actorMfa: (await resolveSessionMfa()) || true }, ['member'], 'widget.settle');"],
        // 外部レビュー: 後ろの spread・算出のキー・同じ名前の重ね書きで上書きできる形
        ["const overrides = { actorMfa: true };", "const refusal = refuseUnverifiedMfa(runtimeBindings, { actorId, actorMfa: await resolveSessionMfa(), ...overrides }, ['member'], 'widget.settle');"],
        ["const key = 'actorMfa';", "const refusal = refuseUnverifiedMfa(runtimeBindings, { actorId, actorMfa: await resolveSessionMfa(), [key]: true }, ['member'], 'widget.settle');"],
        ["const refusal = refuseUnverifiedMfa(runtimeBindings, { actorId, actorMfa: await resolveSessionMfa(), 'actorMfa': true }, ['member'], 'widget.settle');"],
        ["const refusal = refuseUnverifiedMfa(runtimeBindings, ['member'], { actorId, actorMfa: await resolveSessionMfa() }, 'widget.settle');"],
      ];
      for (const lines of unsourced) {
        const repo = implementationTree(RESOLVER, { [ACTION_FILE]: actionSource([...lines, 'if (refusal !== null) return err(refusal);']) });
        const findings = run(requirement(), { repoRoot: repo, actions: loadedInput(ACTIONS) });
        expect(findings, lines.join(' ')).toEqual([expect.objectContaining({ verifier: 'H6', severity: 'error', counterexample: expect.objectContaining({ state: 'unsourced' }) })]);
      }
      const direct = actionSource([
        "const refusal = refuseUnverifiedMfa(runtimeBindings, { actorId, actorMfa: await resolveSessionMfa() }, ['member'], 'widget.settle');",
        'if (refusal !== null) return err(refusal);',
      ]);
      expect(run(requirement(), { repoRoot: implementationTree(RESOLVER, { [ACTION_FILE]: direct }), actions: loadedInput(ACTIONS) })).toEqual([]);
    });

    it('組み立ての根を呼ばない手書きの入口は、判定の位置を確かめられないので赤', () => {
      const repo = implementationTree(RESOLVER, { [ACTION_FILE]: ["'use server';", 'export async function settleWidgetAction() { return null; }', ''].join('\n') });
      expect(run(requirement(), { repoRoot: repo, actions: loadedInput(ACTIONS) })[0]?.counterexample).toMatchObject({ state: 'no_target' });
    });

    it('外す宣言の製品・Server Action のファイルが無い操作・action_spec を採っていない・読めない(阻害。名指しの表が言う)ときは見ない', () => {
      const unguarded = implementationTree(RESOLVER, { [ACTION_FILE]: actionSource([]) });
      const exempt: AuthMfaDecl = { kind: 'exempt', reason: '敷居を上げない', location: loc('docs/specs/backend/auth.md', 'mfa') };
      expect(run(exempt, { repoRoot: unguarded, actions: loadedInput(ACTIONS) }).map((finding) => finding.severity)).toEqual(['warning']);
      expect(run(requirement(), { repoRoot: implementationTree(RESOLVER), actions: loadedInput(ACTIONS) })).toEqual([]);
      expect(run(requirement(), { repoRoot: unguarded, actions: UNSELECTED })).toEqual([]);
      expect(run(requirement(), { repoRoot: unguarded, actions: blockedInput('missing') })).toEqual([]);
    });
  });
});

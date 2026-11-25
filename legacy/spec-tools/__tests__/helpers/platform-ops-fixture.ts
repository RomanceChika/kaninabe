/**
 * 認証基盤の操作(`platform_ops`)の生成器・検査器のテストが共有する、設計どおりの宣言一式
 * (本人の読み・行から受ける終了・現在の端末を要る操作・ロールの操作・型つきの入力のオブジェクトの引数)と、生成の文脈。
 */

import type { GenerateContext } from '../../lib/gen-kit/generator.js';
import type { AuthMfaDecl } from '../../lib/model/auth/mfa.js';
import type { AuthPlatformOps, PlatformShape } from '../../lib/model/auth/platform-ops.js';
import type { ScreenSpec } from '../../lib/model/screen/types.js';
import { authModel, platformOp, platformOpsSection, platformPort, platformShape, rowArg, typedArg } from './auth-builder.js';
import { loc } from './model-builder.js';
import { GEN_CTX } from './generate-context.js';
import { screenInput, screenSpec } from './screen-builder.js';

const STAFF = { kind: 'role', role: 'staff', activeMember: true } as const;

/** 設計どおりの 5 操作(`SessionManagement`)と、返す欄(見出し・整形つき)。 */
export function designSection(): AuthPlatformOps {
  const shape: PlatformShape = {
    ...platformShape('session_summary', ['id', 'created_at', 'last_used_at', 'is_current'], { mapping: { last_used_at: 'lastActiveAt', is_current: 'current' } }),
    labels: [{ field: 'last_used_at', label: '最後に使った日時' }, { field: 'is_current', label: 'この端末' }],
    formats: [{ field: 'last_used_at', format: 'datetime' }],
  };
  const ops = [
    platformOp('session.list_mine', { kind: 'read' }),
    platformOp('session.end_mine', { args: [rowArg('session_id', 'session.list_mine', 'id', { skipIf: 'is_current', format: 'uuid' })] }),
    platformOp('session.end_others', { needsCurrentSession: true, confirm: true, binding: { port: 'SessionManagement', method: 'end_others', params: [], result: { kind: 'scalar', type: 'number' } } }),
    platformOp('session.end_member', {
      actor: STAFF,
      confirm: true,
      args: [rowArg('member_id', 'query-member-admin-list', 'id', { format: 'uuid' })],
      binding: { port: 'SessionManagement', method: 'end_member', params: [{ kind: 'scalar', name: 'memberId', map: { arg: 'member_id', type: 'string', optional: false }, location: loc('docs/specs/backend/auth.md', 'p') }], result: { kind: 'scalar', type: 'number' } },
    }),
    platformOp('session.end_every', {
      actor: STAFF,
      confirm: true,
      args: [typedArg('keep_self', 'bool', true)],
      binding: {
        port: 'SessionManagement',
        method: 'end_every',
        params: [{ kind: 'object', name: 'options', optional: true, props: [{ prop: 'keepSelf', arg: 'keep_self', type: 'boolean', optional: true }], location: loc('docs/specs/backend/auth.md', 'p') }],
        result: { kind: 'scalar', type: 'number' },
      },
    }),
  ];
  return platformOpsSection(ops, { shapes: [shape], ports: [platformPort('SessionManagement', [shape], { current: 'boolean' })] });
}

/** 配線先のポート(行の型は shapes の対応先から導く)。 */
export function designPort(section: AuthPlatformOps = designSection()) {
  return platformPort('SessionManagement', section.shapes, { current: 'boolean' });
}

/** 多要素認証の要求(全員)。 */
export const MFA_ALL: AuthMfaDecl = { kind: 'require', scope: { kind: 'all' }, to: 'screen-mfa', implementation: 'impl/gate.ts::requireMfa', summary: '求める', location: loc('docs/specs/backend/auth.md', 'mfa') };

/** 多要素認証を外す宣言。 */
export const MFA_EXEMPT: AuthMfaDecl = { kind: 'exempt', reason: '敷居を上げない', location: loc('docs/specs/backend/auth.md', 'mfa') };

/** 設計どおりの画面(自分のセッション・メンバー管理の一部)。 */
export function designScreens(): readonly ScreenSpec[] {
  return [
    screenSpec({
      name: 'sessions',
      route: '/profile/sessions',
      for: ['anonymous'],
      requiresAuth: true,
      platformOps: ['session.list_mine', 'session.end_mine', 'session.end_others'],
      overlays: [{ id: 'end_others_confirm', openedBy: 'end_others_bar', label: 'ほかの端末をログアウトする', platformOps: ['session.end_others'], slots: [{ slot: 'body.center', components: ['confirm_bar'] }] }],
      slots: [
        {
          slot: 'body.center',
          components: [
            { name: 'session_table', label: 'ログイン中の端末', kind: 'platform_read', op: 'session.list_mine', shows: ['last_used_at', 'is_current'], rowActions: ['session.end_mine'] },
            { name: 'end_others_bar', kind: 'platform_actions', ops: ['session.end_others'] },
          ],
        },
      ],
    }),
    screenSpec({
      name: 'member_admin',
      route: '/admin/members',
      for: ['staff'],
      requiresAuth: true,
      platformOps: ['session.end_member', 'session.end_every'],
      overlays: [{ id: 'end_member_confirm', openedBy: 'member_table', platformOps: ['session.end_member'], slots: [{ slot: 'body.center', components: ['confirm_bar'] }] }],
      slots: [{ slot: 'body.center', components: [{ name: 'member_table', kind: 'table', reads: 'query-member-admin-list', rowActions: ['session.end_member'] }, { name: 'member_bulk_bar', kind: 'platform_actions', ops: ['session.end_every'] }] }],
    }),
  ];
}

/** 認証基盤の操作を宣言した製品の生成の文脈(`mfa` を渡せば要求する製品)。 */
export function platformContext(options: { readonly mfa?: AuthMfaDecl; readonly section?: AuthPlatformOps; readonly screens?: readonly ScreenSpec[]; readonly testCases?: NonNullable<Parameters<typeof authModel>[0]>['testCases'] } = {}): GenerateContext {
  const section = options.section ?? designSection();
  return {
    ...GEN_CTX,
    auth: authModel({ platformOps: section, ...(options.mfa === undefined ? {} : { mfa: options.mfa }), ...(options.testCases === undefined ? {} : { testCases: options.testCases }) }),
    screens: screenInput({ screens: options.screens ?? designScreens() }).screens,
  };
}

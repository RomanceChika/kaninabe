/**
 * auth_spec(認証フロー仕様)テスト用の最小ビルダー。
 *
 * 規約(scripts-code-quality.md)により検証器・生成器のテストはファイル I/O を行わず、
 * モデルをテスト内でリテラル構築する。ここではその定型部分(location・既定値)を引き受ける。
 */

import type {
  AuthAxisDecl,
  AuthCallbackDecl,
  AuthFlowSpec,
  AuthGateDecl,
  AuthLandingDecl,
  AuthSpecModel,
  LocalOnlyDecl,
  SignInBranchDecl,
} from '../../lib/model/auth/types.js';
import type { AuthSessionsDecl, ConcurrentSessionsDecl } from '../../lib/model/auth/sessions.js';
import type { AuthIdpSessionDecl } from '../../lib/model/auth/idp-session.js';
import type { AuthMfaDecl } from '../../lib/model/auth/mfa.js';
import type { AuthPlatformOps, PlatformArg, PlatformBindingParam, PlatformOpDecl, PlatformPortDecl, PlatformShape } from '../../lib/model/auth/platform-ops.js';
import { VALUE_TYPE_OF_ARG } from '../../lib/model/auth/platform-ops.js';
import type { ActionTestCase } from '../../lib/testcase/types.js';
import { loc } from './model-builder.js';

/** 仕様ファイル(location に使う)。 */
const AUTH_FILE = 'docs/specs/backend/auth.md';

/**
 * 既定の軸。**この 2 つの名前は体系側の要求ではなく、テストが選んだ語である**
 * (軸の名前は仕様側の事情。束 ⑲-2a)。主語の軸 `member` と、それに従属する `invitation`。
 */
export function defaultAuthAxes(subject = 'membership'): readonly AuthAxisDecl[] {
  return [
    {
      id: 'member',
      kind: 'state',
      summary: 'メンバー行の状態',
      of: subject,
      absent: 'none',
      labels: {
        none: 'メンバー行が無い',
        guest: 'メンバー行が guest',
        active: 'メンバー行が active',
        suspended: 'メンバー行が suspended',
        disabled: 'メンバー行が disabled',
        left: 'メンバー行が left',
      },
      location: loc(AUTH_FILE, 'axes.member'),
    },
    {
      id: 'invitation',
      kind: 'enum',
      summary: '招待コードの扱い',
      when: { axis: 'member', value: 'none' },
      values: ['none', 'unknown', 'refused', 'unreadable', 'accepted'],
      labels: {
        none: '招待コードを持っていない',
        unknown: '招待コードが引き当たらない',
        refused: '受諾が拒否された',
        unreadable: '受諾できたのにメンバー行が読めない',
        accepted: '招待を受諾できた',
      },
      location: loc(AUTH_FILE, 'axes.invitation'),
    },
    {
      id: 'guild',
      kind: 'enum',
      summary: 'ギルド在籍の確認結果',
      optional: true,
      values: ['joined', 'not_joined'],
      labels: { joined: 'ギルドに在籍している', not_joined: 'ギルドに在籍していない' },
      location: loc(AUTH_FILE, 'axes.guild'),
    },
    {
      id: 'activate',
      kind: 'enum',
      summary: '有効化の結末',
      optional: true,
      values: ['accepted', 'refused', 'refused_but_active'],
      labels: {
        accepted: '有効化できた',
        refused: '有効化が拒否された',
        refused_but_active: '有効化は拒否されたが読み直すと有効',
      },
      location: loc(AUTH_FILE, 'axes.activate'),
    },
  ];
}

/** 着地 1 件を作る。既定は「案内画面の guest 表示」。 */
export function authLanding(
  id: string,
  opts: Partial<Omit<AuthLandingDecl, 'id' | 'location'>> = {},
): AuthLandingDecl {
  const base = {
    id,
    screen: opts.screen ?? 'screen-guest',
    summary: opts.summary ?? `${id} の説明`,
    location: loc(AUTH_FILE, `landings.${id}`),
  };
  return opts.variant === undefined ? base : { ...base, variant: opts.variant };
}

/**
 * 分岐 1 行を作る。既定は「有効メンバーがそのまま通る」行。
 *
 * 軸の値は `values`(軸 ID → 値)で渡す。主語の軸の既定値だけは書きやすさのために
 * `member: 'active'` を入れてある(テストが選んだ軸名であって体系側の語ではない)。
 */
export function authBranch(
  id: string,
  opts: Partial<Omit<SignInBranchDecl, 'id' | 'location'>> = {},
): SignInBranchDecl {
  return {
    id,
    values: opts.values ?? { member: 'active' },
    runs: opts.runs ?? [],
    lands: opts.lands ?? 'active',
    summary: opts.summary ?? `${id} の説明`,
    location: loc(AUTH_FILE, `sign_in.${id}`),
  };
}

/** 関門 1 件を作る。既定は「ログイン画面へ送り返すセッション関門」。 */
export function authGate(
  id: string,
  opts: Partial<Omit<AuthGateDecl, 'id' | 'location'>> = {},
): AuthGateDecl {
  const onFail = opts.onFail ?? 'redirect';
  const to = opts.to ?? (onFail === 'redirect' ? 'screen-login' : undefined);
  const base = {
    id,
    guards: opts.guards ?? ('requires_auth' as const),
    onFail,
    implementation: opts.implementation ?? 'app/src/composition/auth.ts::requireSession',
    summary: opts.summary ?? `${id} の説明`,
    location: loc(AUTH_FILE, `gates.${id}`),
  };
  const withTo = to === undefined ? base : { ...base, to };
  return opts.role === undefined ? withTo : { ...withTo, role: opts.role };
}

/** OAuth の帰り道の口(`callback`)を作る。既定の URL は `/api/auth/callback`。 */
export function authCallback(endpoint = '/api/auth/callback'): AuthCallbackDecl {
  return { endpoint, summary: `${endpoint} は OAuth の帰り道`, location: loc(AUTH_FILE, 'callback') };
}

/** サインインの開始(`start`)・ログアウト(`logout`)の口を作る。 */
export function authEntry(key: 'start' | 'logout', endpoint = key === 'start' ? '/api/auth/sign-in' : '/api/auth/logout'): AuthCallbackDecl {
  return { endpoint, summary: `${endpoint} は ${key} の口`, location: loc(AUTH_FILE, key) };
}

/** セッションの寿命(`sessions`)を作る。既定は無操作 8 時間・絶対 24 時間・同時セッションは上限なし。 */
export function authSessions(
  inactivity = '8h',
  inactivitySeconds = 8 * 3600,
  absolute = '24h',
  absoluteSeconds = 24 * 3600,
  concurrent: ConcurrentSessionsDecl = { kind: 'unbounded', reason: 'テストが選んだ上限なし' },
): AuthSessionsDecl {
  return { inactivity, inactivitySeconds, absolute, absoluteSeconds, reason: 'テストが選んだ寿命', concurrent, location: loc(AUTH_FILE, 'sessions') };
}

/** IdP とアプリのセッションの関係(`idp_session`)を作る。既定は仕組みが支えられる 3 つの主張。 */
export function authIdpSession(): AuthIdpSessionDecl {
  return { logout: 'keeps_idp', idpEnds: 'app_continues', lifetime: 'independent', reason: 'テストが選んだ関係', location: loc(AUTH_FILE, 'idp_session') };
}

/** ログアウトの口の宣言を作る(`control` はログアウトの操作の名前。省略は宣言しない)。 */
export function authLogout(endpoint = '/api/auth/logout', control?: string): AuthCallbackDecl {
  return { endpoint, summary: `${endpoint} はログアウトの口`, ...(control === undefined ? {} : { control }), location: loc(AUTH_FILE, 'logout') };
}

/** 認証フロー仕様 1 件を作る。 */
export function authFlow(init: {
  readonly subject?: string;
  readonly providers?: readonly string[];
  readonly localOnly?: readonly LocalOnlyDecl[];
  readonly axes?: readonly AuthAxisDecl[];
  readonly landings?: readonly AuthLandingDecl[];
  readonly branches?: readonly SignInBranchDecl[];
  readonly gates?: readonly AuthGateDecl[];
  readonly callback?: AuthCallbackDecl;
  readonly start?: AuthCallbackDecl;
  readonly sessions?: AuthSessionsDecl;
  readonly idpSession?: AuthIdpSessionDecl;
  readonly mfa?: AuthMfaDecl;
  readonly logout?: AuthCallbackDecl;
  readonly platformOps?: AuthPlatformOps;
  readonly testCases?: readonly ActionTestCase[];
}): AuthFlowSpec {
  const subject = init.subject ?? 'membership';
  return {
    id: 'auth-flow',
    subject,
    providers: init.providers ?? ['oauth_a'],
    localOnly: init.localOnly ?? [],
    axes: init.axes ?? defaultAuthAxes(subject),
    landings: init.landings ?? [authLanding('active', { screen: 'screen-workshop-list' })],
    branches: init.branches ?? [authBranch('member_active')],
    gates: init.gates ?? [],
    ...(init.callback === undefined ? {} : { callback: init.callback }),
    ...(init.start === undefined ? {} : { start: init.start }),
    ...(init.sessions === undefined ? {} : { sessions: init.sessions }),
    ...(init.idpSession === undefined ? {} : { idpSession: init.idpSession }),
    ...(init.mfa === undefined ? {} : { mfa: init.mfa }),
    ...(init.logout === undefined ? {} : { logout: init.logout }),
    ...(init.platformOps === undefined ? {} : { platformOps: init.platformOps }),
    testCases: init.testCases ?? [],
    location: loc(AUTH_FILE),
  };
}

/** AuthSpecModel を作る(available は既定 true)。 */
export function authModel(
  init: Parameters<typeof authFlow>[0] = {},
  available = true,
): AuthSpecModel {
  return { available, flow: authFlow(init) };
}

/** スネークケース → キャメルケース(配線先の引数・行のプロパティの既定の名前)。 */
function camel(name: string): string {
  return name.replace(/_([a-z])/g, (_all, letter: string) => letter.toUpperCase());
}

/** 宣言した引数から、1 引数 1 スカラーの既定の対応表を作る。 */
function defaultParams(args: readonly PlatformArg[]): readonly PlatformBindingParam[] {
  return args.map((arg) => ({
    kind: 'scalar' as const,
    name: camel(arg.name),
    map: { arg: arg.name, type: arg.kind === 'row' ? ('string' as const) : VALUE_TYPE_OF_ARG[arg.type], optional: false },
    location: loc(AUTH_FILE, `platform_ops.params.${arg.name}`),
  }));
}

/** プラットフォーム操作 1 件を作る(既定は本人の `do`・確認なし・`SessionManagement.{id の名前}` へ配線。対応表は宣言した引数から作る)。 */
export function platformOp(
  id: string,
  init: {
    readonly kind?: PlatformOpDecl['kind'];
    readonly actor?: PlatformOpDecl['actor'];
    readonly args?: readonly PlatformArg[];
    readonly returns?: string;
    readonly needsCurrentSession?: boolean;
    readonly confirm?: boolean;
    readonly binding?: PlatformOpDecl['binding'];
  } = {},
): PlatformOpDecl {
  const kind = init.kind ?? 'do';
  const method = id.split('.')[1] ?? id;
  return {
    id,
    label: `${id} の操作`,
    kind,
    actor: init.actor ?? { kind: 'self' },
    args: init.args ?? [],
    ...(kind === 'read' ? { returns: init.returns ?? 'session_summary' } : { confirm: init.confirm ?? false }),
    needsCurrentSession: init.needsCurrentSession ?? false,
    binding:
      init.binding ??
      ({
        port: 'SessionManagement',
        method,
        params: defaultParams(init.args ?? []),
        result: kind === 'read' ? { kind: 'rows', row: 'SessionSummary' } : { kind: 'scalar', type: 'boolean' },
      } as const),
    location: loc(AUTH_FILE, `platform_ops.${id}`),
  };
}

/** `from: row` の引数を作る。 */
export function rowArg(name: string, of: string, field: string, init: { readonly skipIf?: string; readonly format?: 'uuid' } = {}): PlatformArg {
  return { kind: 'row', name, of, field, ...(init.format === undefined ? {} : { format: init.format }), ...(init.skipIf === undefined ? {} : { skipIf: init.skipIf }), location: loc(AUTH_FILE, `platform_ops.args.${name}`) };
}

/** 型つきの自由入力の引数を作る。 */
export function typedArg(name: string, type: 'bool' | 'int' | 'string', defaultValue?: boolean | number | string): PlatformArg {
  return { kind: 'typed', name, type, ...(defaultValue === undefined ? {} : { default: defaultValue }), location: loc(AUTH_FILE, `platform_ops.args.${name}`) };
}

/** `platform_ops` の節を作る(shapes を省略すると `session_summary` を 1 つ宣言する)。 */
export function platformOpsSection(
  ops: readonly PlatformOpDecl[],
  init: { readonly shapes?: readonly PlatformShape[]; readonly secretWords?: readonly string[]; readonly ports?: readonly PlatformPortDecl[] } = {},
): AuthPlatformOps {
  const shapes = init.shapes ?? [platformShape('session_summary', ['id', 'created_at', 'last_used_at', 'user_agent', 'ip', 'is_current'])];
  return {
    ops,
    shapes,
    ports: init.ports ?? [platformPort('SessionManagement', shapes)],
    secretWords: init.secretWords ?? ['token', 'refresh', 'secret', 'jwt'],
    location: loc(AUTH_FILE, 'platform_ops'),
  };
}

/**
 * 返す欄の集合を作る(既定は行の型 `SessionSummary` への、キャメルケースの名前の対応表つき)。
 * `mapped: false` は対応表なしの形(`fields: [欄, …]`)。
 */
export function platformShape(name: string, fields: readonly string[], init: { readonly mapped?: boolean; readonly mapping?: Readonly<Record<string, string>> } = {}): PlatformShape {
  const location = loc(AUTH_FILE, `shapes.${name}`);
  if (init.mapped === false) return { name, fields, location };
  return { name, fields, row: 'SessionSummary', mapping: fields.map((field) => ({ field, from: init.mapping?.[field] ?? camel(field) })), location };
}

/** 配線先のポートを作る(行の型 `SessionSummary` は、渡した shapes の対応先を `string` のプロパティとして持つ)。 */
export function platformPort(name: string, shapes: readonly PlatformShape[], types: Readonly<Record<string, 'string' | 'boolean' | 'number'>> = {}): PlatformPortDecl {
  const props = [...new Set(shapes.flatMap((shape) => shape.mapping?.map((entry) => entry.from) ?? []))];
  return {
    name,
    union: { type: 'SessionManagementResult', ok: 'ok', value: 'value', reason: 'reason' },
    refusals: [
      { reason: 'unauthenticated', message: 'ログインしてください' },
      { reason: 'forbidden', message: 'この操作はできません' },
      { reason: 'unknown_current_session', message: 'もう一度ログインしてください' },
    ],
    rows: [{ name: 'SessionSummary', props: props.map((prop) => ({ name: prop, type: types[prop] ?? ('string' as const), nullable: false })) }],
    location: loc(AUTH_FILE, `platform_ports.${name}`),
  };
}

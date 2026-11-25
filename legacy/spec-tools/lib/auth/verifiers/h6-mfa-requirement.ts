/**
 * H6 多要素認証の要求 — 認証フロー仕様の `mfa` の接地と、外す宣言の名指し。
 *
 * 多要素認証の正は認証基盤のセッションの保証の水準(Supabase なら JWT の `aal` が `aal2`)であり、要求はサインインの瞬間ではなく
 * **入場のたびに**確かめる(URL を直に打てば着地を素通りできるので、決定表の着地では守れない)。だから要求の宣言は関門と同じ形を取る ——
 * 送り先の画面(`to`)と、確かめる関数(`implementation`)。ここが見るのは:
 *
 *   - **外す宣言(`exempt`)** … 毎回 warning で名指す。区分は「受け入れた危険」(理由は宣言の側。`Finding.acceptance`)
 *   - **IdP に任せる宣言(`delegated`)** … 外部の IdP でログインする製品の既定。`provider` が `providers` に実在する外部の IdP であり、
 *     **本番の方式(`providers`)がその IdP 1 つだけ**であること(無い・ローカルだけで開けている・メール等の IdP でない方式・
 *     ほかの本番の方式〔メールのパスワード・別の IdP〕が並ぶ → error。任せる先以外の方式で入る人には要素が 1 つも掛からない)。根拠が `none` の間は毎回 warning で名指す
 *     (区分は同じく「受け入れた危険」。文言だけが「IdP に任せた」)。根拠を確かめられる形は parse が止める(未対応)ので、ここには来ない
 *   - **ロールで絞る要求のロール** … roles.md に実在し、サインインする人のロールであること(未ログイン・内部実行のロールは要求できない)
 *   - **送り先の画面** … 実在し、引数なしで送れて、ログインを要求する(要素の登録・確認にはセッションが要る)こと。ロールで絞るなら、
 *     送り先がそのロールの画面でないこと(同じ要求に掛かって無限に送り返される)
 *   - **確かめる関数の実在** … 本文の字面ではなく構文木で、そのモジュールが**値として export している**こと(コメントに名前が
 *     あるだけ・内部関数のままでは import できない)。実装の木が無い構成では飛ばす
 *   - **書き込みの入口の執行の接続点** … 画面の関門は画面の入場しか守らないので、書き込みの入口(Server Action)でも執行する。
 *     執行は生成物が持つ —— 生成された Server Action がセッションの状態を解決して実行器へ渡し、実行器が判断と書き込みの前に
 *     止める(`@kaninabe/runtime` の `mfa-requirement.ts`。要求の範囲は生成された束の `mfa`)。手で書くのは解決の関数 1 つだけ
 *     (`resolveSessionMfa`。認証の組み立ての根に住む)なので、その export の実在を同じく構文木で見る
 *   - **手書きの入口**(`runner: manual` の操作の Server Action)… 実行器を通らないので、判断と書き込みの前に同じ判定
 *     (`@kaninabe/runtime/template/mfa`)を呼び、拒否なら返していることを構文木で見る(`h6-manual-entry.ts`)
 *
 * **見ていないこと**: 画面の実装が本当に `implementation` を呼ぶか(画面の関門と同じく app 側の静的走査の仕事)・解決の関数が
 * 本当に認証基盤の保証の水準を読んでいるか(Supabase の後段の部品 `sessionMfaVerified` を使う形が既定。中身は見ない)・
 * 手書きの入口が関門に渡すロールの正しさ。DB の RPC は実行者を引数で信じる
 * サーバー専用の口(面のロールから呼べない)なので、執行の正は実行器である。
 */

import path from 'node:path';
import { appGrounded, isFile } from '../../io/paths.js';
import { readText } from '../../io/read-text.js';
import { exportedValueNames } from '../../semantics/module-exports.js';
import { layoutPath } from '../../model/product/layout.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ActionSpecModel } from '../../model/trace/types.js';
import { verifyManualEntryMfa } from './h6-manual-entry.js';
import type { AcceptedRiskDecl, Finding } from '../../kernel/finding.js';
import { inputValue, type CatalogInput } from '../../kernel/input-state.js';
import { dynamicParams } from '../../model/screen/route-syntax.js';
import type { ScreenSpec, ScreenSpecModel } from '../../model/screen/types.js';
import type { AuthFlowSpec, AuthSpecModel } from '../../model/auth/types.js';
import { MFA_RESOLVER, NON_IDP_SIGN_IN_METHODS } from '../../model/auth/mfa.js';
import type { AuthMfaDecl } from '../../model/auth/mfa.js';
import type { ProductRoots } from '../../model/product/types.js';
import { ROLE_KINDS, type SpecModel } from '../../model/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'H6';

/**
 * サインインする人のグローバルロールの種別(未ログイン・内部実行の種別はセッションを持たないので、多要素認証を要求できない)。
 * 種別を持たないロール(ロールの欄や文脈から立つロール)はサインインした人のロールである。
 */
const SIGNED_IN_ROLE_KINDS: ReadonlySet<string> = new Set(ROLE_KINDS.filter((kind) => kind === 'authenticated_default'));

/** 要求の宣言(外す宣言ではないもの)。 */
type MfaRequirement = Extract<AuthMfaDecl, { kind: 'require' }>;

/** H6 の指摘を組み立てる。 */
function h6(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** H6 の入力。 */
export interface MfaRequirementInput {
  readonly auth: AuthSpecModel;
  /** ドメイン仕様(ロールの実在を引く)。 */
  readonly domain: SpecModel;
  /** 画面仕様の入力の状態(送り先の画面は読込済みのときだけ判定する。阻害でも関数の実在は判定する)。 */
  readonly screens: CatalogInput<ScreenSpecModel>;
  /** リポジトリルートの絶対パス(確かめる関数の実在を見る)。 */
  readonly repoRoot: string;
  /** 製品が宣言した根(実装の木があるかの判定に使う)。 */
  readonly roots: ProductRoots;
  /** 置き場の配置(書き込みの入口の解決の関数が住む、認証の組み立ての根の場所を引く)。 */
  readonly layout: ProductLayout;
  /** action_spec の入力の状態(`runner: manual` の操作の手書きの入口を引く。阻害なら判定を出さず、名指しの表の行が言う)。 */
  readonly actions: CatalogInput<ActionSpecModel>;
}

/**
 * 外す宣言を、受け入れた危険の宣言として取り出す(組み立ての根が W5 へ渡す。警告の `acceptance` と同じもの)。
 *
 * @param flow 読めた認証フロー仕様(無ければ空)
 */
export function mfaAcceptances(flow: AuthFlowSpec | null): readonly AcceptedRiskDecl[] {
  const mfa = flow?.mfa;
  return mfa?.kind === 'exempt' || mfa?.kind === 'delegated' ? [{ reason: mfa.reason, location: mfa.location }] : [];
}

/** 任せる IdP が `providers` に実在する外部の IdP であること(違反の組み立てを 1 か所に)。 */
function delegatedFindings(mfa: Extract<AuthMfaDecl, { kind: 'delegated' }>, flow: AuthFlowSpec): Finding[] {
  const at = { location: mfa.location, counterexample: { provider: mfa.provider } };
  if (flow.localOnly.some((entry) => entry.method === mfa.provider)) {
    return [h6({ ...at, message: `mfa.delegated.provider ${mfa.provider} は local_only の方式で、本番では開けません(本番の多要素認証を任せる先にならない)`, suggestion: `providers に書いた外部の IdP(${flow.providers.join(' / ')})を指す` })];
  }
  if (!flow.providers.includes(mfa.provider)) {
    return [h6({ ...at, message: `mfa.delegated.provider ${mfa.provider} は providers に書かれていません`, suggestion: `providers に書いた外部の IdP(${flow.providers.join(' / ')})を指す` })];
  }
  if (NON_IDP_SIGN_IN_METHODS.has(mfa.provider)) {
    return [h6({ ...at, message: `mfa.delegated.provider ${mfa.provider} は外部の IdP ではありません(任せる先が無い)`, suggestion: 'IdP に任せられるのは外部の IdP でログインするときだけ。アプリ側で要求する(to / implementation / summary)か、理由つきで exempt にする' })];
  }
  const others = flow.providers.filter((method) => method !== mfa.provider);
  if (others.length > 0) {
    return [
      h6({
        location: mfa.location,
        counterexample: { provider: mfa.provider, others: others.join(',') },
        message:
          `mfa.delegated は多要素認証を IdP(${mfa.provider})に任せますが、本番の providers に任せる先以外の方式(${others.join(' / ')})があります。` +
          `${others.join(' / ')} で入る人には、IdP の要素もアプリの要素も掛からず、1 つの要素だけで全部の書き込みに届きます`,
        suggestion: 'IdP に任せられるのは、本番の方式が任せる IdP 1 つだけの製品に限る。ほかの方式を残すなら delegated を消し、アプリ側で要求する(require の形: to / implementation / summary。aal2)か、理由つきで exempt にする。ほかの方式が開発・テストだけなら local_only に移す',
      }),
    ];
  }
  return [];
}

/** IdP に任せた宣言の警告(受け入れた危険。根拠が無いので、IdP の多要素認証が今回のログインで使われたかは確かめられない)。 */
function delegatedWarning(mfa: Extract<AuthMfaDecl, { kind: 'delegated' }>): Finding {
  return {
    verifier: VERIFIER_ID,
    severity: 'warning',
    message: `多要素認証を IdP(${mfa.provider})に任せています(根拠: なし。理由: ${mfa.reason})。アプリは今回のログインで IdP の多要素認証が使われたかを確かめられず、IdP の側が 1 要素で通せば、そのまま入れます。アプリ側の要素は無いので、任せる先(${mfa.provider})以外の方式で入る人には要素が 1 つも掛かりません(本番の方式は ${mfa.provider} だけに限る)`,
    location: mfa.location,
    suggestion: '任せる理由が今も成り立つかを確かめる。厳しくしたい製品は delegated を消し、to / implementation / summary を書いてアプリ側で要求する(aal2)',
    counterexample: { provider: mfa.provider, evidence: mfa.evidence },
    acceptance: { reason: mfa.reason, location: mfa.location },
  };
}

/** 外す宣言の警告(受け入れた危険)。 */
function exemptFinding(mfa: Extract<AuthMfaDecl, { kind: 'exempt' }>): Finding {
  return {
    verifier: VERIFIER_ID,
    severity: 'warning',
    message: `多要素認証を外しています(理由: ${mfa.reason})。サインインは 1 つの要素だけで済み、要素を盗まれた人のアカウントはそのまま使われます`,
    location: mfa.location,
    suggestion: '外す理由が今も成り立つかを確かめる。成り立たなくなったら exempt を消し、to / implementation / summary を書いて要求する(既定は全員に要求する)',
    counterexample: { exempt: mfa.reason },
    acceptance: { reason: mfa.reason, location: mfa.location },
  };
}

/** ロールで絞る要求のロールが実在し、サインインする人のロールであること。 */
function roleFindings(mfa: MfaRequirement, domain: SpecModel): Finding[] {
  if (mfa.scope.kind !== 'roles') return [];
  const byId = new Map(domain.roles.roles.map((role) => [role.id, role]));
  return mfa.scope.roles.flatMap((id) => {
    const role = byId.get(id);
    if (role === undefined) {
      return [h6({ message: `mfa.require.roles の ${id} は roles.md に定義されていません`, location: mfa.location, suggestion: `roles.md のロール(${[...byId.keys()].join(' / ')})に直す`, counterexample: { role: id } })];
    }
    if (role.kind !== undefined && !SIGNED_IN_ROLE_KINDS.has(role.kind)) {
      return [h6({ message: `mfa.require.roles の ${id} は kind: ${role.kind} のロールで、サインインしないので多要素認証を要求できません`, location: mfa.location, suggestion: 'サインインする人のロールを書く', counterexample: { role: id, kind: role.kind } })];
    }
    return [];
  });
}

/** 送り先の画面の接地。 */
function screenFindings(mfa: MfaRequirement, byId: ReadonlyMap<string, ScreenSpec>): Finding[] {
  const screen = byId.get(mfa.to);
  const at = { location: mfa.location };
  if (screen === undefined) {
    return [h6({ ...at, message: `mfa.to ${mfa.to} に対応する画面がありません`, suggestion: '多要素認証の登録・確認の画面の screen_spec の id を書く', counterexample: { to: mfa.to } })];
  }
  const findings: Finding[] = [];
  if (dynamicParams(screen.route).length > 0) {
    findings.push(h6({ ...at, message: `mfa.to の画面 ${screen.id} の route ${screen.route} は動的セグメントを持ちます`, suggestion: '引数なしで送れる route の画面にする(送る側は引数を知らない)', counterexample: { to: mfa.to, route: screen.route } }));
  }
  if (!screen.requiresAuth) {
    findings.push(h6({ ...at, message: `mfa.to の画面 ${screen.id} は requires_auth: true ではありません`, suggestion: '送り先の画面を requires_auth: true にする(要素の登録・確認にはサインイン済みのセッションが要る)', counterexample: { to: mfa.to } }));
  }
  const looped = mfa.scope.kind === 'roles' ? mfa.scope.roles.filter((role) => screen.forRoles.includes(role)) : [];
  if (looped.length > 0) {
    findings.push(h6({ ...at, message: `mfa.to の画面 ${screen.id} は for: [${looped.join(', ')}] で、多要素認証を要求するロールの画面です`, suggestion: '送り先は要求に掛からない画面にする(そうしないと同じ要求に掛かって無限に送り返される)', counterexample: { to: mfa.to, roles: looped.join(',') } }));
  }
  return findings;
}

/** そのファイルが実在し、値として `symbol` を export しているか(構文木で見る)。 */
function exports(repoRoot: string, file: string, symbol: string): 'missing_file' | 'missing_export' | 'ok' {
  const absolute = path.join(repoRoot, file);
  if (!isFile(absolute)) return 'missing_file';
  return exportedValueNames(file, readText(absolute)).has(symbol) ? 'ok' : 'missing_export';
}

/** 確かめる関数(`パス::関数名`)の実在。 */
function implementationFindings(mfa: MfaRequirement, repoRoot: string): Finding[] {
  const [file, symbol] = mfa.implementation.split('::');
  const state = file === undefined || symbol === undefined ? 'missing_file' : exports(repoRoot, file, symbol);
  if (state === 'ok') return [];
  if (state === 'missing_file') {
    return [h6({ message: `mfa.implementation ${mfa.implementation} が実在しません`, location: mfa.location, suggestion: '"リポジトリルート相対パス::関数名" の形で、実在するモジュールと関数を指す', counterexample: { implementation: mfa.implementation }, grounding: 'implementation' })];
  }
  return [h6({ message: `mfa.implementation の ${file} は ${symbol} を export していません`, location: mfa.location, suggestion: `${file} に ${symbol} を実装して export するか、implementation を実際の関数名に直す(コメントに名前があるだけ・export していない関数は呼び手が import できない)`, counterexample: { symbol: symbol ?? '' }, grounding: 'implementation' })];
}

/**
 * 書き込みの入口の解決の関数(`resolveSessionMfa`)が、認証の組み立ての根から export されていること。
 *
 * 生成された Server Action はここから import して実行器へ渡すので、無ければ要求が書き込みの入口で執行できない。
 * 認証の組み立ての根の場所を配置が決められなければ見ない(配置の定義の検査と生成の前提の失敗が名指す)。
 */
function resolverFindings(mfa: MfaRequirement, input: MfaRequirementInput): Finding[] {
  const file = layoutPath(input.layout, input.roots.app, 'auth-composition');
  if (file === null || exports(input.repoRoot, file, MFA_RESOLVER) === 'ok') return [];
  return [
    h6({
      message: `多要素認証を要求していますが、認証の組み立ての根 ${file} が ${MFA_RESOLVER} を export していません(生成された Server Action が、書き込みの入口でセッションが多要素認証を済ませたかを解決できません)`,
      location: mfa.location,
      suggestion: `${file} に「リクエストのセッションが多要素認証を済ませたか」を返す ${MFA_RESOLVER}(): Promise<boolean> を export する(Supabase なら後段の部品 sessionMfaVerified にリクエストのクライアントを渡す)`,
      counterexample: { file, symbol: MFA_RESOLVER },
      grounding: 'implementation',
    }),
  ];
}

/**
 * 多要素認証の要求を検証する。
 *
 * @param input 認証フロー仕様・ドメイン仕様・画面仕様・リポジトリルート
 * @returns 違反と、外す宣言の警告
 */
export function verifyMfaRequirement(input: MfaRequirementInput): Finding[] {
  const mfa = input.auth.flow?.mfa;
  if (mfa === undefined) return [];
  if (mfa.kind === 'exempt') return [exemptFinding(mfa)];
  if (mfa.kind === 'delegated') return [...(input.auth.flow === null ? [] : delegatedFindings(mfa, input.auth.flow)), delegatedWarning(mfa)];
  const implementations = appGrounded(input.repoRoot, input.roots.app) ? [...implementationFindings(mfa, input.repoRoot), ...resolverFindings(mfa, input), ...verifyManualEntryMfa({ ...input, verifier: VERIFIER_ID })] : [];
  const roles = roleFindings(mfa, input.domain);
  if (input.screens.state === 'blocked') return [...roles, ...implementations];
  const screens = inputValue(input.screens);
  if (screens === undefined || !screens.available) return [...roles, ...implementations];
  return [...roles, ...screenFindings(mfa, new Map(screens.screens.map((screen) => [screen.id, screen]))), ...implementations];
}

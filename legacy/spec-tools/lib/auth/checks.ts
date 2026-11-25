/**
 * 認証フロー仕様の検査(H 群)の登録 — どの検査を、どの順で実行するか。
 *
 * 実行口(`run.ts`)はここの `AUTH_STEPS` を上から回すだけである。並びは**違反の並び**を決める。
 * ID は各検証器のファイルが持つ `VERIFIER_ID` を参照する。全検査の表(`lib/compose/all-checks.ts`)は `AUTH_CHECKS` を読む。
 */

import type { Finding } from '../kernel/finding.js';
import type { CheckEntry } from '../kernel/check-entry.js';
import { H0_VERIFIER_ID } from '../model/auth/loader.js';
import type { AuthRunInput } from './run.js';
import { VERIFIER_ID as H1, verifyBranchTotality } from './verifiers/h1-branch-totality.js';
import { VERIFIER_ID as H2, verifyLandingGrounding } from './verifiers/h2-landing-grounding.js';
import { VERIFIER_ID as H3, verifyAuthTestTrace } from './verifiers/h3-test-trace.js';
import { H5_ID, H5_TITLE } from './platform-config.js';
import { VERIFIER_ID as H4, verifyGateDeclaration, verifyGateRoles } from './verifiers/h4-gate-declaration.js';
import { VERIFIER_ID as H6, verifyMfaRequirement } from './verifiers/h6-mfa-requirement.js';
import { VERIFIER_ID as H7, verifyRefusalLog } from './verifiers/h7-refusal-log.js';
import { VERIFIER_ID as H8, verifyLogoutControl } from './verifiers/h8-logout-control.js';
import { VERIFIER_ID as H9, verifyPlatformOps } from './verifiers/h9-platform-ops.js';

/** 実行の段 1 つ(検査 1 本)。 */
export interface AuthStep extends CheckEntry {
  /** 検査を実行し、違反を返す。 */
  run(input: AuthRunInput): Finding[];
}

/** 実行の順(違反の並びを決める)。 */
export const AUTH_STEPS: readonly AuthStep[] = [
  { id: H1, title: 'サインイン分岐の全域性と接地', run: (i) => verifyBranchTotality(i.domain, i.auth) },
  {
    id: H2,
    title: '着地と関門の接地(画面仕様・実装との突合)',
    run: (i) => verifyLandingGrounding({ auth: i.auth, screens: i.screens, repoRoot: i.repoRoot, roots: i.roots }),
  },
  { id: H3, title: 'テスト突合(認証フロー仕様 ⇔ テスト)', run: (i) => verifyAuthTestTrace(i.domain, i.registry, i.tests) },
  {
    id: H4,
    title: '関門の宣言(screen_spec ⇔ auth_spec の双方向一致・ロールの関門のロールの実在と一意)',
    run: (i) => [...verifyGateRoles(i.auth.flow, i.domain), ...verifyGateDeclaration(i.auth.flow, i.screens, i.roots)],
  },
  {
    id: H6,
    title: '多要素認証の要求(送り先の画面・ロール・確かめる関数・書き込みの入口の解決・手書きの入口の判定の接地と、外す宣言の名指し)',
    run: (i) => verifyMfaRequirement({ auth: i.auth, domain: i.domain, screens: i.screens, repoRoot: i.repoRoot, roots: i.roots, layout: i.layout, actions: i.actions }),
  },
  {
    id: H7,
    title: '拒否の記録の接地(認証の組み立ての根の接続点・手書きの入口の記録と、実行者の解決がパースより先であること)',
    run: (i) => verifyRefusalLog({ actions: i.actions, repoRoot: i.repoRoot, roots: i.roots, layout: i.layout }),
  },
  {
    id: H8,
    title: 'ログアウトの操作(認証の要る全画面が、ログアウトの遷移を持つ共有クロームを被る)',
    run: (i) => verifyLogoutControl(i.auth.flow, i.screens),
  },
  {
    id: H9,
    title: 'プラットフォーム操作の宣言(id・配線先の重複なし・actor のロールの実在・引数の出どころ・返す欄の値域と秘密語の不在・配線先との明示の対応表と実際の形)',
    run: (i) => verifyPlatformOps(i.auth.flow, i.domain, { repoRoot: i.repoRoot, roots: i.roots, layout: i.layout }),
  },
];

/** H 群の全検査(ローダーの H0 を含む。全検査の表が読む)。 */
export const AUTH_CHECKS: readonly CheckEntry[] = [
  { id: H0_VERIFIER_ID, title: 'auth_spec のスキーマ適合(ローダーが実施)' },
  ...AUTH_STEPS,
  // H5 の本体はプラットフォームの後段が登録する(口の ID と題だけがここに載る。実行は run.ts が登録の有無を見て行う)。
  { id: H5_ID, title: H5_TITLE },
];

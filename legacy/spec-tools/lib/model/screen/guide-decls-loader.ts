/**
 * screens ルートの README.md から免除宣言(S10 の `unexposed`・
 * S13 の `unreachable_states`・S14 の `unseen_states`)を読む。
 *
 * README.md はディレクトリガイドであり、フロントマターの有無やその他のキーは
 * このローダーの関心ではない。読めない・キーが無い場合は空配列(免除なし)を返し、
 * 書き方が壊れている場合だけ S0 違反を積む(A4 の `unhandled` と同じ流儀)。
 *
 * 画面仕様の読み込み(`loader.ts`)とは別に、免除宣言の種類が増えるたびにここだけが伸びる形にする。
 */

import { join } from 'node:path';
import type { Finding } from '../../kernel/finding.js';
import type { Decl } from '../decl-list.js';
import { declValue, readDeclLists } from '../decl-list.js';
import { toRelative } from '../../io/paths.js';
import type { ExposureDecl, PlatformOpExposureDecl, RoleStateReachDecl, ScreenSpecModel, StateVisibilityDecl } from './types.js';

/** ディレクトリガイド。仕様ではないので読み飛ばす(免除宣言だけをここから読む)。 */
export const GUIDE_FILE = 'README.md';

const UNEXPOSED_SUGGESTION =
  'screens/README.md のフロントマターに "unexposed:" を作り、"- event: {操作 ID}" と "reason: {理由}" を並べる';

const UNEXPOSED_PLATFORM_OPS_SUGGESTION =
  'screens/README.md のフロントマターに "unexposed_platform_ops:" を作り、"- op: {プラットフォーム操作の id}" と "reason: {理由}" を並べる';

const UNREACHABLE_STATES_SUGGESTION =
  'screens/README.md のフロントマターに "unreachable_states:" を作り、' +
  '"- transition: {遷移 ID}" と "state: {状態}" と "role: {ロール}" と "reason: {理由}" を並べる';

const UNSEEN_STATES_SUGGESTION =
  'screens/README.md のフロントマターに "unseen_states:" を作り、' +
  '"- state: {machine}.{状態}" と "reason: {理由}" を並べる';

/**
 * screens ルートの README.md から免除宣言一式を読む。
 *
 * @param screensRoot specs/frontend/screens の絶対パス
 * @param repoRoot Finding の location.file を相対パスにする基準
 * @param findings 書き方の違反(S0)の記録先
 * @returns 免除宣言 3 種
 */
export function readGuideDecls(
  screensRoot: string,
  repoRoot: string,
  findings: Finding[],
  verifierId: string,
): Pick<ScreenSpecModel, 'unexposed' | 'unreachableStates' | 'unseenStates' | 'unexposedPlatformOps'> {
  const absolute = join(screensRoot, GUIDE_FILE);
  const result = readDeclLists({
    absolute,
    file: toRelative(repoRoot, absolute),
    verifierId,
    specs: [
      {
        key: 'unexposed',
        fields: ['event', 'reason'],
        suggestion: UNEXPOSED_SUGGESTION,
        emptySuggestion: (id) => `${id} を画面から発火できるようにしていない理由を reason に日本語で書く`,
      },
      {
        key: 'unexposed_platform_ops',
        fields: ['op', 'reason'],
        suggestion: UNEXPOSED_PLATFORM_OPS_SUGGESTION,
        emptySuggestion: (id) => `${id} を画面に出していない理由を reason に日本語で書く`,
      },
      {
        key: 'unreachable_states',
        fields: ['transition', 'state', 'role', 'reason'],
        suggestion: UNREACHABLE_STATES_SUGGESTION,
        identify: (values) => `${values['transition'] ?? ''}/${values['state'] ?? ''}/${values['role'] ?? ''}`,
        emptySuggestion: (id, field) =>
          field === 'reason'
            ? `${id} からまだ到達できる画面を作っていない理由を reason に日本語で書く`
            : `${id} の ${field} を書く`,
      },
      {
        key: 'unseen_states',
        fields: ['state', 'reason'],
        suggestion: UNSEEN_STATES_SUGGESTION,
        emptySuggestion: (id) => `${id} の実体を人間の読み取り経路から見せていない理由を reason に日本語で書く`,
      },
    ],
  });
  findings.push(...result.findings);
  return {
    unexposed: (result.decls.get('unexposed') ?? []).map(toExposure),
    unreachableStates: (result.decls.get('unreachable_states') ?? []).map(toRoleStateReach),
    unseenStates: (result.decls.get('unseen_states') ?? []).map(toStateVisibility),
    unexposedPlatformOps: (result.decls.get('unexposed_platform_ops') ?? []).map(toPlatformOpExposure),
  };
}

/** `unexposed` の 1 件へ写す。 */
function toExposure(decl: Decl): ExposureDecl {
  return { event: declValue(decl, 'event'), reason: declValue(decl, 'reason'), location: decl.location };
}

/** `unreachable_states` の 1 件へ写す(S13 の免除)。 */
function toRoleStateReach(decl: Decl): RoleStateReachDecl {
  return {
    transition: declValue(decl, 'transition'),
    state: declValue(decl, 'state'),
    role: declValue(decl, 'role'),
    reason: declValue(decl, 'reason'),
    location: decl.location,
  };
}

/** `unseen_states` の 1 件へ写す(S14 の免除)。 */
function toStateVisibility(decl: Decl): StateVisibilityDecl {
  return { state: declValue(decl, 'state'), reason: declValue(decl, 'reason'), location: decl.location };
}

/** `unexposed_platform_ops` の 1 件へ写す(S21 の免除)。 */
function toPlatformOpExposure(decl: Decl): PlatformOpExposureDecl {
  return { op: declValue(decl, 'op'), reason: declValue(decl, 'reason'), location: decl.location };
}

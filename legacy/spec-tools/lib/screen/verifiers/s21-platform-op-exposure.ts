/**
 * S21 プラットフォーム操作の UI 到達検査(S10 の兄弟 — 逆向きの網羅)。
 *
 * auth_spec の `platform_ops` に宣言した操作(人間が起こすもの)は、必ずどこかの画面の `platform_ops`(重ね表示を含む)に現れる。
 * 宣言しただけで画面のどこからも呼べない操作は、仕様の上では完結しているのに利用者からは存在しない(S10 が見るドメイン操作と同じ「作ったつもり」)。
 * `system` ロールが実行者の操作は人間が起こすものではないので対象外。
 *
 * 免除は S10 の `unexposed` と同じ方式で、specs/frontend/screens/README.md のフロントマターに `unexposed_platform_ops:` として
 * 理由つきで書く(`- op: {id} / reason: {理由}`)。消し忘れ(画面ができたのに宣言が残っている / 実在しない操作の宣言)は警告で拾う。
 * auth_spec が使えない(阻害)・画面をまだ仕様化していない構成は何も見ない。
 */

import type { PlatformOpDecl } from '../../model/auth/platform-ops.js';
import { declaredPlatformOpRefs } from '../../model/screen/declared-actions.js';
import type { PlatformOpExposureDecl, ScreenInput } from '../../model/screen/types.js';
import { systemRoleId } from '../../model/role-hierarchy.js';
import { platformOpIndex } from '../platform-ops.js';
import type { Finding, ScreenContext, ScreenVerifier } from '../verifier.js';
import { authGateBlocked, screenFinding } from '../verifier.js';

/** S21 の実装。 */
export const platformOpExposureVerifier: ScreenVerifier = {
  id: 'S21',
  title: 'プラットフォーム操作の UI 到達の網羅 — 人間が起こせる全操作に、露出する画面か理由がある',

  verify(input: ScreenInput, ctx: ScreenContext): Finding[] {
    if (!input.screens.available) return [];
    const index = platformOpIndex(input, authGateBlocked(ctx));
    if (index === null) return [];
    const exposed = new Set(input.screens.screens.flatMap((screen) => declaredPlatformOpRefs(screen).map((ref) => ref.id)));
    const excused = new Map<string, PlatformOpExposureDecl>((input.screens.unexposedPlatformOps ?? []).map((decl) => [decl.op, decl]));
    const system = systemRoleId(input.domain.roles.roles);
    const missing = [...index.ops.values()]
      .filter((op) => !(op.actor.kind === 'role' && op.actor.role === system))
      .filter((op) => !exposed.has(op.id) && !excused.has(op.id))
      .map(missingExposure);
    return [...missing, ...staleExcuses(excused, exposed, index.ops)];
  },
};

/** 操作がどの画面にも現れない。 */
function missingExposure(op: PlatformOpDecl): Finding {
  return screenFinding('S21', {
    message: `プラットフォーム操作 ${op.id} は人間が起こせますが、どの画面の platform_ops にも現れません`,
    location: op.location,
    suggestion:
      `その操作を露出する画面の screen_spec に "platform_ops: - ${op.id}" を足す。` +
      'まだ画面を作らないなら specs/frontend/screens/README.md のフロントマターに ' +
      `"unexposed_platform_ops: - op: ${op.id} / reason: {理由}" を書く(理由の一覧がそのまま「これから作る画面」の一覧になる)`,
    counterexample: { op: op.id },
  });
}

/** 用済みになった免除宣言(画面ができたのに残っている / 実在しない操作)。掃除漏れなので warning。 */
function staleExcuses(excused: ReadonlyMap<string, PlatformOpExposureDecl>, exposed: ReadonlySet<string>, ops: ReadonlyMap<string, PlatformOpDecl>): Finding[] {
  return [...excused.values()].flatMap((decl) => {
    if (exposed.has(decl.op)) {
      return [
        screenFinding('S21', {
          severity: 'warning',
          message: `${decl.op} は画面の platform_ops にあるのに unexposed_platform_ops の理由宣言が残っています`,
          location: decl.location,
          suggestion: `screens/README.md の unexposed_platform_ops から ${decl.op} の項目を削除する`,
          counterexample: { op: decl.op, reason: decl.reason },
        }),
      ];
    }
    if (ops.has(decl.op)) return [];
    return [
      screenFinding('S21', {
        severity: 'warning',
        message: `unexposed_platform_ops に書かれた ${decl.op} は auth_spec の platform_ops に存在しない操作です`,
        location: decl.location,
        suggestion: `操作 id の綴りを確認し、実在するもの(${[...ops.keys()].join(', ') || 'なし'})へ直すか項目を削除する`,
        counterexample: { op: decl.op, reason: decl.reason },
      }),
    ];
  });
}

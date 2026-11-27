/**
 * 全検査の表 — 検査 ID を 1 つの表で列挙する(組み立ての根)。
 *
 * 各群が自分の検査を `CheckEntry` の並びとして export し(`lib/<群>/checks.ts`・`lib/verify/domain-checks.ts`)、ここが全群を束ねる。
 * 検査を足すときは、その群の登録に足すだけで表に載る。ID を表のために書き写さない(各検証器のファイルが持つ ID を群が参照する)。
 *
 * **この表が「検査 ID が実在する」の正である。** 拡張候補の台帳(W5)が `rules` の ID の実在を見るのはこの表で、コードの文字列リテラルを走査して
 * 近似しない(検査を消した後に同じ綴りが別の文字列に残っても、表から消えれば通らない)。同じ ID を 2 つの群が登録することは許さない
 * (`duplicateCheckIds`。構造テストが固定する)。
 *
 * **後段が登録する検査は口の ID で載る。** ホストの Cron の登録の突合などは後段の値を読まず、口の表(`JOB_CHECK_SLOTS`)の ID だけが
 * ジョブ群の登録(`JOB_CHECKS`)に載る。後段が口を埋めない構成では、その口は実行ログが未実施・対象外と名指す(表には口として載ったまま)。
 */

import { flattenCheckGroups, type CheckGroup, type RegisteredCheck } from '../kernel/check-entry.js';
import { AUTH_CHECKS } from '../auth/checks.js';
import { CONFIG_CHECKS } from '../config/checks.js';
import { DATA_CHECKS } from '../data/checks.js';
import { DESIGN_CHECKS } from '../design/checks.js';
import { DOC_CHECKS } from '../docs/checks.js';
import { EXTENSION_CHECKS } from '../extension/checks.js';
import { EXTERNAL_CHECKS } from '../external/checks.js';
import { GENERALITY_CHECKS } from '../generality/checks.js';
import { GUARANTEE_CHECKS } from '../guarantee/checks.js';
import { JOB_CHECKS } from '../job/checks.js';
import { NOTIFICATION_CHECKS } from '../notification/checks.js';
import { PRODUCT_CHECKS } from '../product/checks.js';
import { RISK_CHECKS } from '../risk/checks.js';
import { QUERY_CHECKS } from '../query/checks.js';
import { SCOPE_CHECKS } from '../scope/checks.js';
import { SCREEN_CHECKS } from '../screen/checks.js';
import { SPEC_INDEX_CHECKS } from '../spec-index/checks.js';
import { TERM_CHECKS } from '../terms/checks.js';
import { TRACE_CHECKS } from '../trace/checks.js';
import { USECASE_CHECKS } from '../usecase/checks.js';
import { UX_CHECKS } from '../ux/checks.js';
import { UX_PRINCIPLES_CHECKS } from '../ux-principles/checks.js';
import { DOMAIN_CHECKS } from '../verify/domain-checks.js';

/** 群ごとの登録(パイプラインの実行の順。群の名前は仕様の種類と検査 ID の頭文字で言う)。 */
export const ALL_CHECK_GROUPS: readonly CheckGroup[] = [
  { group: '製品の根(P)', checks: PRODUCT_CHECKS },
  { group: 'ドメイン仕様(V)', checks: DOMAIN_CHECKS },
  { group: 'テストケース ID の台帳(A9)', checks: SPEC_INDEX_CHECKS },
  { group: 'action_spec(A)', checks: TRACE_CHECKS },
  { group: 'query_spec(Q)', checks: QUERY_CHECKS },
  { group: 'data_table(T)', checks: DATA_CHECKS },
  { group: '通知カタログ(N)', checks: NOTIFICATION_CHECKS },
  { group: 'ジョブカタログ(J)', checks: JOB_CHECKS },
  { group: '設定カタログ(K)', checks: CONFIG_CHECKS },
  { group: '認証フロー仕様(H)', checks: AUTH_CHECKS },
  { group: '保証台帳(Z)', checks: GUARANTEE_CHECKS },
  { group: '外部連携カタログ(X)', checks: EXTERNAL_CHECKS },
  { group: '危ない形(R)', checks: RISK_CHECKS },
  { group: 'screen_spec(S)', checks: SCREEN_CHECKS },
  { group: 'usecase_spec(Y)', checks: USECASE_CHECKS },
  { group: 'UX 検査(U)', checks: UX_CHECKS },
  { group: 'UX 原則の台帳(U8)', checks: UX_PRINCIPLES_CHECKS },
  { group: '視覚層(G)', checks: DESIGN_CHECKS },
  { group: '語彙漏れ(W1〜W4)', checks: GENERALITY_CHECKS },
  { group: 'ルール文書(M0〜M6)', checks: DOC_CHECKS },
  { group: '用語の台帳(M7〜M12)', checks: TERM_CHECKS },
  { group: '拡張候補の台帳(W5)', checks: EXTENSION_CHECKS },
  { group: '実装の範囲(P13・P14)', checks: SCOPE_CHECKS },
];

/** 全検査の表(群の順・群の中の順。群の中で同じ ID は 1 本に畳んである)。 */
export const ALL_CHECKS: readonly RegisteredCheck[] = flattenCheckGroups(ALL_CHECK_GROUPS);

/**
 * 登録された検査 ID の集合(W5 が拡張候補の台帳の `rules` の実在を見る)。
 *
 * @returns 全検査の表にある ID
 */
export function knownCheckIds(): ReadonlySet<string> {
  return new Set(ALL_CHECKS.map((check) => check.id));
}

/**
 * 生成の後の木で回し直す段を持つ検査 ID(段の宣言 `onGeneratedTree` から導く。fix27 A2)。題材の通し実行が、回し直しの指摘をこの ID で絞る。
 *
 * @param groups 群ごとの登録(既定は全群。畳む前の並びを読む — 畳むと段の欄が落ちる)
 * @returns 回し直す段を 1 つでも持つ検査 ID(名前順)
 */
export function generatedTreeCheckIds(groups: readonly CheckGroup[] = ALL_CHECK_GROUPS): readonly string[] {
  return [...new Set(groups.flatMap(({ checks }) => checks.filter((entry) => entry.onGeneratedTree === true).map((entry) => entry.id)))].sort();
}

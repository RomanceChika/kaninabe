/**
 * 危ない形の検査(R 群)の登録 — どの検査を、どの順で実行するか。
 *
 * R 群は「正しく読めた仕様の中の、攻撃に開いた形」を見る横断の群である(規則の正は docs/rules/process/backend/system/standards/conventions/enforcement/enforcement-matrix.md の C32)。
 * 読み込みの文法(R17)は検査ではなく各種類のローダーの拒否なので、ここには載らない(その種類の 0 番の検査・V1 が報告する)。
 * 実行口(`run.ts`)はここの `RISK_STEPS` を上から回すだけである。ID は各検証器のファイルが持つ ID の定数を参照する。
 */

import type { Finding } from '../kernel/finding.js';
import type { CheckEntry } from '../kernel/check-entry.js';
import type { RiskRunInput } from './run.js';
import { VERIFIER_ID as R2, verifyGroundWriters } from './verifiers/r2-ground-writers.js';
import { VERIFIER_ID as R10, verifyFieldBounds } from './verifiers/r10-field-bounds.js';
import { VERIFIER_ID as R14, verifyUrlFields } from './verifiers/r14-url-fields.js';
import { VERIFIER_ID as R15, verifyRichText } from './verifiers/r15-rich-text.js';
import { VERIFIER_ID as R16, verifyBearer } from './verifiers/r16-bearer.js';
import { VERIFIER_ID as R5, verifyAbuseOf } from './verifiers/r5-abuse.js';

/** 実行の段 1 つ(検査 1 本)。 */
export interface RiskStep extends CheckEntry {
  /** 検査を実行し、違反と、材料が阻害のため判定を出さなかった対象を返す。 */
  run(input: RiskRunInput): { readonly findings: readonly Finding[]; readonly withheld: readonly string[] };
}

/** 実行の順(違反の並びを決める)。 */
export const RISK_STEPS: readonly RiskStep[] = [
  {
    id: R2,
    title: '役の根拠の欄(claim・binding・actor.{欄})を書けるのは、その役を持つか含意する役と、追える内部実行の入口だけ',
    run: (input) => verifyGroundWriters(input.groundWriters),
  },
  {
    id: R10,
    title: '文字列の欄は長さの上限を・数の欄は下限と上限を持つ(文字列だけ unbounded: 理由 で受け入れられる)',
    run: (input) => ({ findings: verifyFieldBounds(input.groundWriters.model), withheld: [] }),
  },
  {
    id: R14,
    title: 'URL は pattern で書かず format: url で書く(絶対 URL の http / https だけ。入力スキーマ・CHECK・world の値・表示側のリンクの部品が同じ宣言から出る)',
    run: (input) => ({ findings: verifyUrlFields(input.groundWriters.model), withheld: [] }),
  },
  {
    id: R15,
    title: '書式つきの本文として描いている欄は format: markdown で宣言する(描く口 MarkdownView / renderMarkdown / plainTextOf に渡す欄の参照を、宣言と突き合わせる。許可リストで無害化する描画の口だけが HTML を載せる)',
    run: (input) => ({ findings: verifyRichText({ model: input.groundWriters.model, richText: input.richText }), withheld: [] }),
  },
  {
    id: R16,
    title: '持っていれば効く値(bearer)は寿命を宣言し(失効と使い切り / 使い回しの受け入れ)、列の既定値の CSPRNG で作り(UUID 不可・値を渡す口なし)、URL のパスに載せない',
    run: (input) => ({ findings: verifyBearer(input.bearer), withheld: [] }),
  },
  {
    id: R5,
    title: '未ログインが書ける作成は全体の天井を持ち、未ログインの更新・削除・遷移は理由つきでしか通らない。有料の口は入力の上限と回数の枠を宣言する(宣言だけで、執行は証明しない)',
    run: (input) => ({ findings: verifyAbuseOf(input.abuse), withheld: [] }),
  },
];

/** R 群の全検査(全検査の表が読む)。 */
export const RISK_CHECKS: readonly CheckEntry[] = RISK_STEPS;

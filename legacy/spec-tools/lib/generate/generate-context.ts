/**
 * 生成の文脈の最終段の組み立て(`cli/generate-docs.ts` と通し実行のハーネスが同じ 1 本を呼ぶ)。
 *
 * **`lib/generate/` に置くのは、通し実行のハーネスを `lib/targets/supabase/samples` へ移した後も lib が cli を読む形にしない
 * ため**である(組み立ては CLI の仕事ではない。読む I/O は `lib/io` の小道具を通す)。
 *
 * 文脈のうち「ローダーで読んだ入力」は呼び側が並べるが、章の描き方と検証の結果の受け渡しは
 * **ここ 1 本**で決める —— 2 か所に持つと、通し実行が実 CLI と違う章の描き方で緑になる
 * (束 ⑦ のレビューが実測: 通し実行は人向けの表示の章を 1 度も通っていなかった)。
 *
 * - 人向けの表示で出す章(`humanFaceChapters`)は `FACE_CHAPTERS`(全章)
 * - 仕様の木の Markdown の生テキスト(`specSources`)は `readSpecSources`(母集合の定めは 1 本。入口が採っていない種類の置き場は
 *   `excludedPlaces` で母集合から除く = 標識の集計に混ぜない。全部入りの `generate` は渡さない)
 * - ジョブカタログの起動口の Route Handler の生テキスト(`routeSources`)は `readRouteSources`
 * - 検証の警告は「まだ通していない受け入れ」として章と手引きに配る(`findings`。error は
 *   生成の前に `generationBlockingErrors` が止める側なので、ここが集めるのは warning だけ。
 *   検証を回さない入口(ハンドブックだけを出す `cli/generate-book.ts`)は null を渡し、欄ごと載せない)
 * - 変異の目録(`mutation`)は**ここでは回さず、呼び側が渡す起動の口**(`runMutation`)で 1 度だけ回す。
 *   **状態を必ず 1 つ載せる**(`ran` / `unavailable` / `not_run`。口が null = 入口が変異を回さない = `not_run`)。章は
 *   「回していない」「回せなかった」「回した」を書き分け、「目録 0 行」で回していないことを隠さない。
 *   人向けの本は変異を自分で回さず結果をデータで受け取る(回すと本の生成器の依存が DDL・RLS・RPC 本文の
 *   生成器まで広がる。設計メモ framework-modules §11)。**生成器の側が変異の層を読まない**のは、変異の検出器が
 *   生成器を呼ぶので、互いを読む形にしないため(§13。`CLOSURE_BANS`)。口を必須の引数にしてあるのは、
 *   CLI と通し実行が同じ 1 本を渡し、渡し忘れが型で止まるようにするため
 */

import type { SpecModel } from '../model/types.js';
import type { ProductRoots } from '../model/product/types.js';
import type { Finding } from '../kernel/finding.js';
import type { ExtensionLedgerModel } from '../model/extension/types.js';
import type { MutationRunOutcome } from '../kernel/mutation-report.js';
import type { PlatformProfile } from '../model/product/platform-profile.js';
import type { ProductLayout } from '../model/product/layout.js';
import { FACE_CHAPTERS, type GenerateContext } from '../gen-kit/generator.js';
import type { GenerateInputs } from './generate-inputs.js';
import { describeSurfaceUnsupported } from '../verify/check-run-report.js';
import { readRouteSources } from './route-sources.js';
import { readSpecSources } from './spec-sources.js';

/**
 * 変異の目録の実測を起動する口(変異の層が持つ `mutationReportOfContext` を、呼び側が渡す)。
 *
 * 材料が足りなければ `unavailable`(理由つき。目録を出さずに、そのことを書く)。
 */
export type MutationRunner = (model: SpecModel, context: GenerateContext) => MutationRunOutcome;

/**
 * ローダーで読んだ入力から、生成器へ渡す文脈を完成させる。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param roots 製品が宣言した根
 * @param platform プラットフォームの設定(DB のロール名・現在の実行者の式など)。**値を選ぶのは呼び側の組み立ての根**で、
 *   ここは文脈に載せるだけ(SQL を書く生成器はここから引く。人向けの本だけを出す入口も同じ形で渡す)
 * @param layout 置き場の配置(役割 → パス。アプリの枠の後段が与える)。**値を選ぶのは呼び側の組み立ての根**で、ここは文脈の必須の欄に載せるだけ
 *   (`GenerateContext.layout`)。ジョブの起動口の Route Handler の読み込みにも使う
 * @param model ドメイン仕様全体
 * @param inputs ローダーで読んだ入力(章の描き方・仕様の生テキスト・検証の結果・プラットフォームの設定はまだ載せない)
 * @param verified 検証(`runAllVerifications`)の全 Finding。**検証を回していない入口は null**(`findings` を載せない。
 *   章は「未集計。検証の結果が渡されていない」と言う。空配列を渡すと「警告 0 件」と読めるので、回していないことを空配列にしない)
 * @param runMutation 変異の目録の実測を起動する口(`mutationReportOfContext`。実測の欄を除く完成した文脈に 1 度だけ回す)。
 *   **変異を回さない入口は null**(状態は `not_run`。回せなかった `unavailable` とは別の事実)
 * @param readingBase 基点つきの読み(章の「今回変わった」)。無ければ基点なし
 * @param extensionLedger 拡張候補の台帳(検証が返したもの。警告の区分に使う)。無ければ警告はすべて未分類として数える
 * @param excludedPlaces 仕様の生テキストを読まない置き場(リポジトリルート相対。製品が採っていない種類の置き場)。無ければ全部読む(全部入りの `generate`)
 * @returns 生成器へ渡す文脈
 */
export function completeGenerateContext(
  repoRoot: string,
  roots: ProductRoots,
  platform: PlatformProfile,
  layout: ProductLayout,
  model: SpecModel,
  inputs: GenerateInputs,
  verified: readonly Finding[] | null,
  runMutation: MutationRunner | null,
  readingBase?: GenerateContext['readingBase'],
  extensionLedger?: ExtensionLedgerModel,
  excludedPlaces?: readonly string[],
): GenerateContext {
  const withFace: GenerateContext = { ...inputs, platform, layout, humanFaceChapters: FACE_CHAPTERS };
  const specSources = readSpecSources(repoRoot, roots, model, withFace, excludedPlaces);
  const base: GenerateContext = {
    ...withFace,
    specSources,
    routeSources: readRouteSources(repoRoot, roots, layout, inputs.jobs, inputs.external, inputs.auth),
    ...(verified === null ? {} : { findings: verified.filter((finding) => finding.severity === 'warning') }),
    ...(readingBase === undefined ? {} : { readingBase }),
    ...(extensionLedger === undefined ? {} : { extensionLedger }),
  };
  return { ...base, mutation: runMutation === null ? { state: 'not_run' } : runMutation(model, base) };
}

/**
 * 後段が SQL の公開面(surface)を API として外へ出す能力を持たないとき、`generate` が出さないものを名指す 1 行(能力があれば null)。
 * 検査側の `T12` の行と同じ語(`describeSurfaceUnsupported`)で、3 つの生成器(公開スキーマの土台・ビュー・API の期待表)が
 * 何も出さないことを黙って完走させない。この行を言うのは生成の入口(`cli/generate-docs.ts`)である。
 *
 * @param platform プラットフォームの設定
 * @param entry 行頭に出す入口の名前(CLI が自分の名前を渡す)
 * @returns 未対応の 1 行。能力があれば null
 */
export function surfaceUnsupportedNotice(platform: PlatformProfile, entry: string): string | null {
  const exposure = platform.surfaceExposure;
  return exposure.kind === 'unsupported'
    ? describeSurfaceUnsupported(entry, exposure.reason, 'SQL の公開面の migration と期待表(土台・ビュー・API スキーマ)の生成')
    : null;
}

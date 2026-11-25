/**
 * X2 設定への接地チェック。
 *
 * external-spec-writing.md の要求:
 *   - `config[]` の各 id が config カタログ(`docs/specs/backend/config.md`)に実在する
 *   - `degrade: not_configured | fallback` の連携が挙げる config は、config カタログの
 *     `requirement` が `optional_degrades` または `production_only` である
 *   - `degrade: refuse` の連携が挙げる config は、`requirement` が `required` である
 *
 * **なぜこの食い違いを見るのか。** 「鍵が無ければ縮退する」と宣言したのに、config カタログの
 * 側ではその鍵を `required`(無いとアプリが動かない)と宣言していたら、どちらかが嘘になる
 * ——「縮退すると言ったのに実は必須」「拒否すると言ったのに実は任意」という主張の食い違いを
 * 機械が検出しないと、どちらかの仕様が読み手を誤らせたまま残る。
 *
 * `requirement` の語彙(`optional_degrades` / `production_only` / `required`)は
 * config_spec 側のカタログが宣言する語(体系側の値域ではない)だが、この対応表そのものは
 * config-spec-writing.md と external-spec-writing.md の両方が定める規約であり、ここに
 * ハードコードする(config_spec 側の語が増減しても、この 3 語の意味は動かない)。
 */

import type { Finding } from '../../kernel/finding.js';
import { inputValue, unusableOf, type CatalogInput, type InputGapNote } from '../../kernel/input-state.js';
import type { ConfigCatalogSpec } from '../../model/config/types.js';
import type { ExternalCatalogSpec, IntegrationDecl } from '../../model/external/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'X2';

/** X2 の指摘を組み立てる。 */
function x2(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** `degrade: not_configured | fallback` の連携が挙げてよい requirement。 */
const DEGRADES_REQUIREMENTS = new Set(['optional_degrades', 'production_only']);

/** X2 の入力。 */
export interface ConfigGroundingInput {
  /** 読み込み済みの外部連携カタログ(X0 はローダーが済ませてある)。 */
  readonly catalog: ExternalCatalogSpec;
  /**
   * 設定カタログの**入力の状態**(接地先。**必須**)。
   *
   * **未選択は「設定カタログは無い」という事実**で、接地先が無いので何も言わない(製品が `config` を採っていなければ、
   * 挙げられた設定を引く先は仕様のどこにも無い)。**連携が 1 件でもあるのに設定カタログを採っていない食い違いは、宣言の段で P2 が止める**
   * (`SPEC_KIND_REQUIREMENTS`)ので、この沈黙が「採っていない製品の事実」以外の黙りになることはない。**阻害は「分からない」**で、実在や requirement の食い違いを決められないので
   * 判定を出さず、見ていないことを `configGroundingGaps` が名指して返す(欠けた設定カタログで「実在しません」と偽の error を出さない)。
   */
  readonly config: CatalogInput<ConfigCatalogSpec>;
}

/**
 * 設定への接地を検証する。
 *
 * 設定カタログが読込済みでないとき(未選択・阻害)は、接地先が無いので何も見ない(阻害は `configGroundingGaps` が言う)。
 *
 * @param input 外部連携カタログ・設定カタログの入力の状態
 * @returns 違反のリスト
 */
export function verifyConfigGrounding(input: ConfigGroundingInput): Finding[] {
  const variables = inputValue(input.config)?.variables;
  if (variables === undefined) return [];
  const known = new Map(variables.map((variable) => [variable.id, variable]));
  return input.catalog.integrations.flatMap((integration) => checkIntegration(integration, known));
}

/**
 * 設定カタログが阻害のために、X2 が判定を出さなかった連携の記録(使えるとき・未選択のときは空)。
 *
 * 未選択は事実(設定カタログは無い)なので載せない。阻害のときだけ、設定を挙げている連携(`config` が空でないもの)を名指して返す
 * (**無ければ見ていないものも無いので空**)。実行ログが 1 行で報告する。
 *
 * @param input X2 の入力
 */
export function configGroundingGaps(input: ConfigGroundingInput): readonly InputGapNote[] {
  const gap = unusableOf(input.config, 'config');
  if (gap === null || gap.state !== 'blocked') return [];
  const subjects = input.catalog.integrations.filter((integration) => integration.config.length > 0).map((integration) => integration.id);
  if (subjects.length === 0) return [];
  return [{ gap, consequence: '設定への接地(挙げた設定が設定カタログに実在するか・縮退の宣言と requirement の食い違い)は見ていません', subjects }];
}

/** 連携 1 件の config[] を突き合わせる。 */
function checkIntegration(
  integration: IntegrationDecl,
  known: ReadonlyMap<string, { readonly requirement: string }>,
): Finding[] {
  return integration.config.flatMap((configId) => {
    const variable = known.get(configId);
    if (variable === undefined) {
      return [
        x2({
          message: `連携 ${integration.id} の config ${configId} は config カタログに実在しません`,
          location: integration.location,
          suggestion: 'config.md の variables に足すか、実在する id に直す',
          counterexample: { integration: integration.id, config: configId },
        }),
      ];
    }
    return checkRequirementParity(integration, configId, variable.requirement);
  });
}

/** degrade と requirement の食い違いを見る。 */
function checkRequirementParity(
  integration: IntegrationDecl,
  configId: string,
  requirement: string,
): Finding[] {
  if (integration.degrade === 'refuse') {
    if (requirement === 'required') return [];
    return [
      x2({
        message:
          `連携 ${integration.id} は degrade: refuse なのに config ${configId} の requirement は ` +
          `${requirement} です(required ではない)`,
        location: integration.location,
        suggestion:
          'config.md 側の requirement を required に直すか、external.md 側の degrade を実態に合わせて直す',
        counterexample: { integration: integration.id, config: configId, requirement },
      }),
    ];
  }
  // not_configured | fallback
  if (DEGRADES_REQUIREMENTS.has(requirement)) return [];
  return [
    x2({
      message:
        `連携 ${integration.id} は degrade: ${integration.degrade} なのに config ${configId} の requirement は ` +
        `${requirement} です(optional_degrades / production_only のどちらでもない)`,
      location: integration.location,
      suggestion:
        'config.md 側の requirement を optional_degrades か production_only に直すか、' +
        'external.md 側の degrade を実態(無いと動かないなら refuse)に合わせて直す',
      counterexample: { integration: integration.id, config: configId, requirement },
    }),
  ];
}

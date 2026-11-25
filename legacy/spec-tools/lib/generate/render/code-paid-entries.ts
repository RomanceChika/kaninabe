/**
 * 外部連携カタログの有料の口(`spend: paid`)→ 口ごとの定数表(`app/src/domain/generated/paid-entries.ts`)の生成器。
 *
 * 宣言(`abuse.max_body_bytes` の口ごとの上限・`authz.role` の役・`meter` の RPC・`abuse.quota` の枠)を、口の Route Handler が
 * 共通の入口(`@kaninabe/runtime/http/paid-entry` の `runPaidEntry`)へ渡す値の**唯一の出どころ**にする。口が上限や役を自分の側に書き写すと、
 * 宣言を直しても口は動かない(config.ts / jobs.ts / external-expectations.ts と同じ理由で、値の住所を 1 つにする)。
 *
 * 口が上限・役をこの表から読み、有料の処理を `runPaidEntry` の `handler` の中だけに置いているかは X8 が構文木で見る。
 * 宣言が揃っていない連携(R5-7 が止める)は表に載せない —— 揃わない宣言から値を捏造しない。
 *
 * 規約どおりファイル I/O はせず、カタログから GeneratedSection を返す純粋関数である(scripts-code-quality.md)。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { ExternalCatalogSpec, ExternalQuotaDecl, OutboundIntegrationDecl } from '../../model/external/types.js';
import type { LiteralValue } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import { DEEP_FREEZE_HELPER, docComment, generatedFile, generatedHeader, renderLiteral } from '../../gen-kit/code-emit.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'paid-entries.ts');

/** 宣言が揃った有料の口の連携(送信・`spend: paid`・口あり・上限と役と RPC と枠が全部ある)。 */
function completePaid(catalog: ExternalCatalogSpec): readonly OutboundIntegrationDecl[] {
  return catalog.integrations.filter(
    (integration): integration is OutboundIntegrationDecl =>
      integration.direction === 'outbound' &&
      integration.spend === 'paid' &&
      (integration.endpoints ?? []).length > 0 &&
      integration.abuse?.quota !== undefined &&
      integration.meter !== undefined &&
      integration.authz?.kind === 'role' &&
      integration.authz.role !== undefined,
  );
}

/** 回数の枠をリテラルにする(数の出どころは `source` か `max` のどちらか 1 つ)。 */
function quotaLiteral(quota: ExternalQuotaDecl): LiteralValue {
  return {
    ...(quota.source === undefined ? {} : { source: quota.source }),
    ...(quota.max === undefined ? {} : { max: quota.max }),
    per: quota.per,
    key: quota.key,
  };
}

/** 口 1 本の定数。上限が宣言に無い口は載せない。 */
function entryLiteral(integration: OutboundIntegrationDecl, endpoint: string): LiteralValue | null {
  const maxBodyBytes = integration.abuse?.maxBodyBytes[endpoint];
  const quota = integration.abuse?.quota;
  const role = integration.authz?.role;
  if (maxBodyBytes === undefined || quota === undefined || role === undefined || integration.meter === undefined) return null;
  return { integration: integration.id, maxBodyBytes, role, meter: integration.meter, quota: quotaLiteral(quota) };
}

/** 表の本体(口の URL → 定数。宣言の並び)。 */
function tableLiteral(catalog: ExternalCatalogSpec): Record<string, LiteralValue> {
  const table: Record<string, LiteralValue> = {};
  for (const integration of completePaid(catalog)) {
    for (const endpoint of integration.endpoints ?? []) {
      const entry = entryLiteral(integration, endpoint);
      if (entry !== null) table[endpoint] = entry;
    }
  }
  return table;
}

/** ファイル全体。 */
function renderFile(catalog: ExternalCatalogSpec): string {
  return [
    generatedHeader([catalog.location.file]),
    '',
    docComment(['回数の枠(`abuse.quota`)。数の出どころは `source`(設定の id)か `max`(リテラル)の、どちらか 1 つ。']),
    'export interface PaidQuota {',
    '  readonly source?: string;',
    '  readonly max?: number;',
    '  readonly per: string;',
    '  readonly key: string;',
    '}',
    '',
    docComment(['有料の口 1 本の定数(宣言 `spend: paid` の行から導く)。']),
    'export interface PaidEntry {',
    '  /** 連携 ID。 */',
    '  readonly integration: string;',
    '  /** 本文の最大バイト数(宣言 `abuse.max_body_bytes`)。 */',
    '  readonly maxBodyBytes: number;',
    '  /** 口を使える役(宣言 `authz.role`)。 */',
    '  readonly role: string;',
    '  /** 枠を消費する RPC の名前(宣言 `meter`)。 */',
    '  readonly meter: string;',
    '  /** 回数の枠(宣言 `abuse.quota`)。 */',
    '  readonly quota: PaidQuota;',
    '}',
    '',
    ...DEEP_FREEZE_HELPER,
    '',
    docComment([
      '有料の口の定数表(口の URL → 定数。閉世界)。',
      '',
      '口の Route Handler は `runPaidEntry` へ渡す本文の上限と役を**この表から読む**(同じ数を口の側へ書き写さない)。',
      '読んでいること・有料の処理が `runPaidEntry` の `handler` の中だけにあることは X8 が構文木で見る。',
      '`as const` にするのは、宣言の無い口を読もうとしたら型エラーにするためである。値は深く凍結する(実行時の書き換えで上限を外させない)。',
    ]),
    `export const PAID_ENTRIES = ${frozen(`${renderLiteral(tableLiteral(catalog))} as const satisfies Readonly<Record<string, PaidEntry>>`)};`,
    '',
  ].join('\n');
}

/**
 * 外部連携カタログから有料の口の定数表を生成するジェネレーター。出力は app/src/domain/generated/paid-entries.ts の 1 ファイル(全置換)。
 * 外部連携カタログが無いときは何も出さない。
 */
export const paidEntriesGenerator: DocGenerator = {
  id: 'code-paid-entries',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const catalog = ctx.external?.catalog;
    if (catalog === undefined || catalog === null) return [];
    return [{ file: outputFile(ctx.roots), content: renderFile(catalog), wholeFile: true }];
  },
};

/**
 * 定数表に載る有料の口の URL(宣言の並び)。口の関門の見張りテスト(`code-paid-entry-tests`)が、表と同じ閉世界で口を数えるために使う。
 *
 * @param catalog - 外部連携カタログ
 * @returns 表の鍵の並び
 */
export function paidEntryUrls(catalog: ExternalCatalogSpec): readonly string[] {
  return Object.keys(tableLiteral(catalog));
}

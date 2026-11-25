/**
 * 外部連携カタログ(docs/specs/backend/external.md)の本文ブロックの生成器。
 *
 * YAML フロントマターが正であり、本文はその展開にすぎない(生成は情報を足さない)。
 * 出すのはマトリクス(連携 / 相手 / 向き / 効果 / ポート / 縮退 / タイムアウト / リトライ /
 * 送る情報)とテストケースの一覧、**手書きの口の表**(送信の連携が `endpoints` を宣言していれば)、そして**受け取る側の 3 軸の表**(`direction: inbound` の
 * 行が 1 つでもあるときだけ)の 3 つ。受け取る側は「誰の署名を検証し・どの表で冪等にし・
 * どのドメインイベントが起きるか」が読めないと意味が伝わらない。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { ProductLayout } from '../../model/product/layout.js';
import { httpEntryPath } from '../../model/product/layout.js';
import { inboundUrlOf } from '../../inbound/inbound-url.js';
import type { ExternalCatalogSpec, IntegrationDecl } from '../../model/external/types.js';
import { isInbound } from '../../model/external/types.js';
import { cell, markdownTable, withLabel } from '../../gen-kit/state-machine-table.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';
import { inboundRouteFileOf } from './code-inbound-route.js';

/** 差し込み先(リポジトリルート相対)。 */
export function externalFile(roots: ProductRoots): string {
  return specPath(roots, 'backend/external.md');
}

/** service の表示名を引く。 */
function serviceLabels(catalog: ExternalCatalogSpec): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  for (const term of catalog.vocabulary.service) {
    if (term.label !== undefined) labels.set(term.id, term.label);
  }
  return labels;
}

/** 送る情報の表示(fields + text を 1 セルに畳む)。 */
function sendsText(integration: IntegrationDecl): string {
  const parts: string[] = [];
  if (integration.sends.fields.length > 0) parts.push(integration.sends.fields.map((f) => `\`${f}\``).join(', '));
  if (integration.sends.text !== undefined) parts.push(integration.sends.text);
  return parts.join(' / ');
}

/** 連携のマトリクス(1 行 = 連携 1 件)。 */
function integrationsSection(catalog: ExternalCatalogSpec): string {
  const labels = serviceLabels(catalog);
  const rows = catalog.integrations.map((integration) => [
    cell(`\`${integration.id}\``),
    cell(withLabel(integration.service, labels.get(integration.service))),
    cell(integration.direction),
    cell(integration.effect),
    cell(`\`${integration.port}\``),
    cell(integration.degrade),
    cell(integration.direction !== 'outbound' || integration.timeoutMs === undefined ? '—' : `${integration.timeoutMs}ms`),
    cell(integration.retry),
    cell(integration.idempotencySource ?? '—'),
    cell(sendsText(integration)),
    cell(integration.summary),
  ]);
  return [
    '### 連携の全数',
    '',
    markdownTable(
      ['連携 ID', '相手', '向き', '効果', 'ポート', '縮退', 'タイムアウト', 'リトライ', '二重反映を防ぐ源', '送る情報', 'summary'],
      rows,
    ),
  ].join('\n');
}

/**
 * 受け取る側の 3 軸の表(`direction: inbound` の行だけ)。
 *
 * 送信の行しか無いカタログには節ごと出さない —— 「無い」ことを 1 行で明示するのは
 * data_table の流儀だが、ここは向きの選択であって集め忘れではないからである。
 */
function inboundSection(catalog: ExternalCatalogSpec, roots: ProductRoots, layout: ProductLayout): string {
  const inbound = catalog.integrations.filter(isInbound);
  if (inbound.length === 0) return '';
  const rows = inbound.map((integration) => [
    cell(`\`${integration.id}\``),
    cell(integration.signature),
    cell(integration.config.map((id) => `\`${id}\``).join(', ')),
    cell(`\`${integration.eventIdTable}\``),
    cell(`\`${integration.emits}\``),
    cell(`${integration.maxBodyBytes} バイト`),
    cell(routeCell(integration, roots, layout)),
  ]);
  return [
    '',
    '### 受け取る側の 3 軸(口は生成物)',
    '',
    markdownTable(['連携 ID', '署名の方式', '鍵(設定)', 'イベント ID の表', '起きるイベント', '本文の上限', '口(生成)'], rows),
  ].join('\n');
}

/**
 * 手書きの口を持つ連携の表(送信の連携の `endpoints`。1 行 = 口 1 本)。送信の連携が口を 1 つも宣言していなければ節ごと出さない
 * (口の無い連携が普通で、「無い」ことを言う節は要らない)。置き場は配置が決める(実装の木が無ければ「—」)。
 */
function endpointsSection(catalog: ExternalCatalogSpec, roots: ProductRoots, layout: ProductLayout): string {
  const rows = catalog.integrations.flatMap((integration) =>
    (integration.direction === 'outbound' ? (integration.endpoints ?? []) : []).map((endpoint) => {
      const place = httpEntryPath(layout, { app: roots.app ?? '' }, endpoint);
      return [cell(`\`${integration.id}\``), cell(`\`${endpoint}\``), cell(place === null ? '—' : `\`${place}\``)];
    }),
  );
  if (rows.length === 0) return '';
  return [
    // 直前の表の最後の行との間に空行を 1 つ入れる(この節の前は表で終わる)。
    '',
    '',
    '### この連携を使う手書きの口(ブラウザから叩かれ、サーバーの側で連携を呼ぶ)',
    '',
    markdownTable(['連携 ID', '口(URL)', '口(置き場)'], rows),
  ].join('\n');
}

/**
 * 口(生成)の列。実装の木が無ければ、製品の根からの相対で示し、置き場が決まらなければ「—」(置き場が無いことが事実)。
 * **実装の木があるのに配置が役割を解決できなければ、黙って「—」にせず前提の失敗で止める**(`code-inbound-route.ts`)。
 */
function routeCell(integration: IntegrationDecl, roots: ProductRoots, layout: ProductLayout): string {
  const resolved = httpEntryPath(layout, { app: roots.app ?? '' }, inboundUrlOf(integration.id));
  if (resolved !== null) return `\`${resolved}\``;
  return roots.app === null ? '—' : `\`${inboundRouteFileOf(integration, layout, roots)}\``;
}

/** テストケースの台帳。任意宣言のため 0 件のこともある。 */
function testCaseSection(catalog: ExternalCatalogSpec): string {
  if (catalog.testCases.length === 0) {
    return '### テストケース\n\nまだ無い(任意宣言。既存テストがあれば test_cases に登録する)。';
  }
  const rows = catalog.testCases.map((testCase) => [
    cell(testCase.id),
    cell(testCase.type),
    cell((testCase.covers ?? []).join(', ')),
    cell(testCase.specIds.join(', ')),
    cell(`\`${testCase.implementation.raw}\``),
  ]);
  return [
    '### テストケース',
    '',
    markdownTable(['ID', 'type', 'covers', 'spec_ids', 'implementation'], rows),
  ].join('\n');
}

/**
 * 外部連携カタログの本文ブロックを生成するジェネレーター。
 * 出力は external.md の `external-body` マーカー 1 か所。
 */
export const externalBodyGenerator: DocGenerator = {
  id: 'external-body',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const catalog = ctx.external?.catalog;
    if (catalog === undefined || catalog === null) return [];
    return [
      {
        file: externalFile(ctx.roots),
        marker: 'external-body',
        content: [
          `${integrationsSection(catalog)}${inboundSection(catalog, ctx.roots, ctx.layout)}${endpointsSection(catalog, ctx.roots, ctx.layout)}`,
          testCaseSection(catalog),
        ].join('\n\n'),
      },
    ];
  },
};

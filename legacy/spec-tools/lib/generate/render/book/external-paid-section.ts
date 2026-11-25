/**
 * 外部連携の章の 1 節: **有料の資源を使う口**(外部連携の `spend: paid` と `abuse`。V15.1.3 の「重い機能の洗い出し」と
 * V2.1.3 の「上限の文書」の証拠。未ログインの作成の対の表は可視性の章の「未ログインに開いた書き込み」)。
 *
 * 載せるのは宣言された上限(口ごとの本文の上限・回数の枠)と、口を使える役・枠を消費する RPC。宣言を口が実際に使っているか
 * (本文を読む前に上限で落とし、課金の前に枠を消費しているか)は宣言の検査(R5-7)ではなく X8 が構文木で見る。
 * 節の導入にその断りを必ず書く。純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { ExternalCatalogSpec, IntegrationDecl, ExternalQuotaDecl } from '../../../model/external/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { cell } from '../../../gen-kit/state-machine-table.js';

/** 節の導入(定型。宣言と、執行を誰が見るかを書く)。 */
export const PAID_LEAD =
  '呼び出しごとにお金を使う連携(`spend: paid`)を、ブラウザから叩ける口の一覧と、**宣言された**入力の上限・回数の枠・口を使える役・枠を消費する RPC である。' +
  '1 回の入力が巨大でも・回数に枠が無くても・誰でも叩けても費用が膨らむので、口ごとに宣言する(`npm run verify` の R5-7 が、宣言の有無と書き方を見る)。' +
  '**宣言は口が使う値の出どころである**: 口は共通の入口(`runPaidEntry`)で包まれ、本文の上限と役を宣言から生成した定数表から読み、' +
  '認可 → 本文の上限 → 形の検査 → 枠の消費 → 有料の処理 の順を入口が持つ(本文は上限を超えて読まず、枠は課金の前に消費する)。' +
  '口が入口を使っていること・有料の処理が入口の中だけにあること・枠を消費する RPC が役を DB の行で確かめて原子的に消費することは、X8 が構文木と migration の本文で見る。' +
  '重い機能の洗い出し(V15.1.3)のもう一方、未ログインが書ける作成の天井は、可視性の章の「未ログインに開いた書き込み」にある。';

/** 節の見出し。 */
export const PAID_HEADING = '有料の資源を使う口';

/** 表の見出し。 */
export const PAID_HEADER: readonly string[] = ['口(URL)', '連携', '本文の上限', '回数の枠', '枠の数の出どころ', '口を使える役', '枠を消費する RPC'];

/** 本文の上限(バイト)を人が読める形にする(`262144 バイト(256 KiB)`)。 */
function bytesText(bytes: number | undefined): string {
  if (bytes === undefined) return '宣言なし';
  const kib = bytes % 1024 === 0 ? `(${bytes / 1024} KiB)` : '';
  return `${bytes} バイト${kib}`;
}

/** 回数の枠の人間向け表示(鍵と期間。数は出どころの列)。 */
function quotaText(quota: ExternalQuotaDecl | undefined): string {
  if (quota === undefined) return '宣言なし';
  const unit = quota.key === 'actor' ? '実行者ごと' : '全体で';
  return quota.max === undefined ? `${unit} / ${quota.per}` : `${unit} ${quota.max} 回 / ${quota.per}`;
}

/** 枠の数の出どころ(config の id と、その設定の「無いとき」の挙動。設定カタログが読めていれば添える)。 */
function sourceText(quota: ExternalQuotaDecl | undefined, ctx: GenerateContext): string {
  if (quota === undefined) return '—';
  if (quota.source === undefined) return '仕様に直接書いた数';
  const variable = ctx.config?.available === true ? ctx.config.catalog?.variables.find((candidate) => candidate.id === quota.source) : undefined;
  return variable === undefined ? `設定 \`${quota.source}\`` : `設定 \`${quota.source}\`(設定が無いとき: ${variable.absence})`;
}

/** 有料の口 1 つ分の行(口ごとに 1 行)。 */
function rowsOf(integration: IntegrationDecl, ctx: GenerateContext): string[][] {
  if (integration.direction !== 'outbound' || integration.spend !== 'paid') return [];
  return (integration.endpoints ?? []).map((endpoint) => [
    cell(`\`${endpoint}\``),
    cell(integration.summary),
    cell(bytesText(integration.abuse?.maxBodyBytes[endpoint])),
    cell(quotaText(integration.abuse?.quota)),
    cell(sourceText(integration.abuse?.quota, ctx)),
    cell(integration.authz?.role === undefined ? '宣言なし' : `\`${integration.authz.role}\``),
    cell(integration.meter === undefined ? '宣言なし' : `\`${integration.meter}\``),
  ]);
}

/**
 * 有料の口の表の行(共有の行)。`spend: paid` の連携が 1 つも無ければ空。
 *
 * @param catalog 読み込み済みの外部連携カタログ
 * @param ctx 生成の文脈(枠の数の出どころの設定カタログを引く)
 */
export function paidRows(catalog: ExternalCatalogSpec, ctx: GenerateContext): string[][] {
  return catalog.integrations.flatMap((integration) => rowsOf(integration, ctx));
}


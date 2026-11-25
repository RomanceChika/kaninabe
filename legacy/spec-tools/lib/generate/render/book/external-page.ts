
import type { ExternalCatalogSpec, IntegrationDecl } from '../../../model/external/types.js';
import { cell, withLabel } from '../../../gen-kit/state-machine-table.js';

/** 章の題。 */
export const EXTERNAL_TITLE = '外と何をやり取りするか(外部連携)';

/** カタログを読めていないときの 1 文。 */
export const NO_CATALOG = 'まだ外部連携カタログを読めていない(スキーマエラーを直すと、ここに一覧が生成される)。';

/** ページの導入(定型)。 */
export const LEAD =
  'このシステムが外の誰と何のためにやり取りしているかの**全部**である。' +
  '**鍵(設定)が無いときの挙動**(縮退する / 拒否する)を必ず添えて読む — ' +
  '「設定していないので適当に動く」は最悪の挙動であり(PRIN-0009)、この章の縮退はどれも' +
  '静かな側に寄るよう宣言されている(`npm run verify` の X2 が設定カタログの `requirement` との' +
  '食い違いを見る)。';

/** 送る情報の読み方(定型。可視性の章へのリンクの前・リンクの題・リンクの後)。 */
export const SENDS_NOTE_HEAD =
  '**送る情報**の列は、外へ出るデータの宣言である。個人データ(entity_spec の `personal: true`)を' +
  '含む行は';
export const SENDS_NOTE_LINK = '「誰に何が見えるか」の章';
export const SENDS_NOTE_TAIL = 'の「外部サービスへ送る個人データ」節にも重出する。';

/** 「ブラウザから叩かれる口」の節の見出し・導入・表の見出し(定型)。 */
export const ENDPOINTS_HEADING = 'ブラウザから叩かれる口';
export const ENDPOINTS_LEAD =
  'ブラウザから叩かれ、サーバーの側でこの連携を呼ぶ手書きの口である。**実装の木の HTTP の入口は、ジョブの起動口・受信口・認証の帰り道・ここの口のどれかに宣言されていなければならない**' +
  '(`npm run verify` の J2 が見る)。';
export const ENDPOINTS_HEADERS: readonly string[] = ['口(URL)', '何のため'];

/** 口の表の行(`html/external-chapter.ts` が読む。口が無ければ空)。 */
export function endpointRows(catalog: ExternalCatalogSpec): string[][] {
  return catalog.integrations.flatMap((integration) =>
    (integration.direction === 'outbound' ? (integration.endpoints ?? []) : []).map((endpoint) => [
      cell(`\`${endpoint}\``),
      cell(integration.summary),
    ]),
  );
}

/** 二重反映の節の見出しと、無いときの 1 文・表の見出し(定型)。 */
export const DUPLICATE_HEADING = '同じ知らせが二度届きうる経路';
export const DUPLICATE_NONE = '無い(再送する経路はどれも二重反映を防ぐ源を持っている)。';
export const DUPLICATE_HEADERS: readonly string[] = ['何のため', '再送の仕方', '二度届いてよいとした理由'];

/** 二重反映の節の導入(定型)。 */
export const DUPLICATE_LEAD =
  '**再送する経路のうち、二重反映を防ぐ源が無い(`idempotency_source: none`)ものである。** ' +
  '送ったあとに応答が返らず「失敗」と記録された呼び出しは、リトライでもう一度送られる —— ' +
  '相手に冪等キーを渡す口も、送信済みを覚えるこちら側の台帳も無ければ、**同じ知らせが二度届く**。' +
  'これは事故ではなく、そう宣言してある(理由の列)。届かないことより二度届くことを選んだ、という判断である。';

/** 二度届きうる経路の表の行(`html/external-chapter.ts` が読む。無ければ空)。 */
export function duplicateRows(catalog: ExternalCatalogSpec): string[][] {
  return catalog.integrations
    .filter((integration) => integration.idempotencySource === 'none' && integration.retry !== 'none')
    .map((integration) => [
      cell(integration.summary),
      cell(integration.retry === 'job' ? 'ジョブのリトライ(outbox)' : 'その場で有限回'),
      cell(integration.idempotencyReason ?? '—'),
    ]);
}

/** 連携の節の見出しと、連携が無いときの 1 文・表の見出し(定型)。 */
export const INTEGRATION_HEADING = '相手・何のため・鍵が無いとどうなるか';
export const NO_INTEGRATIONS = 'まだ連携の宣言が無い(カタログに行を足すと、ここに一覧が生成される)。';
export const INTEGRATION_HEADERS: readonly string[] = ['相手', '向き', '何のため', '鍵が無いとどうなるか', '送る情報'];

/** 連携の表の行(共有の行。`html/external-chapter.ts` が読む)。 */
export function integrationRows(catalog: ExternalCatalogSpec): string[][] {
  const labels = new Map(
    catalog.vocabulary.service.filter((term) => term.label !== undefined).map((term) => [term.id, term.label]),
  );
  return catalog.integrations.map((integration) => [
    cell(withLabel(integration.service, labels.get(integration.service))),
    cell(directionText(integration)),
    cell(integration.summary),
    cell(degradeText(integration)),
    cell(sendsText(integration)),
  ]);
}

/**
 * 向きの人間向け表示。
 *
 * 受け取る側は**何が起きるか**(`emits`)まで書く —— 読者にとっての意味は「外から連絡が来ると
 * この仕組みの中で何が動くか」であって、HTTP の向きそのものではない。
 */
function directionText(integration: IntegrationDecl): string {
  if (integration.direction === 'outbound') return 'こちらから呼ぶ';
  return `向こうから届く(届くと \`${integration.emits}\` が起きる)`;
}

/** 縮退の人間向け表示(degrade + degrade_summary)。 */
function degradeText(integration: IntegrationDecl): string {
  if (integration.degrade === 'refuse') return `拒否する(${integration.degradeSummary ?? '常に拒否'})`;
  return integration.degradeSummary ?? integration.degrade;
}

/** 送る情報の表示(fields + text を 1 セルに畳む。external-body.ts と同じ組み方)。 */
function sendsText(integration: IntegrationDecl): string {
  const parts: string[] = [];
  if (integration.sends.fields.length > 0) parts.push(integration.sends.fields.map((f) => `\`${f}\``).join(', '));
  if (integration.sends.text !== undefined) parts.push(integration.sends.text);
  return parts.join(' / ') || '—';
}

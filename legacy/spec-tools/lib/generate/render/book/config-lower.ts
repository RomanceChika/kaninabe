/**
 * 設定の章の下段(導出): 連携の表・置き場の表・実装と雛形との対応の表。
 *
 * すべて折りたたむ。件数は表の行の数(構造テストが一致を見る)。**値そのものはどこにも出さない**:
 * 出すのは設定の名前・置き場の名前・語の表示名・雛形に載るかどうかだけである。
 */

import { LOG_FIELDS, SECURITY_EVENTS } from '@kaninabe/runtime/security-log';
import type { ConfigCatalogSpec, ConfigLoggingDecl } from '../../../model/config/types.js';
import { cell } from '../../../gen-kit/state-machine-table.js';
import type { FoldProps } from './face-html.js';
import { CRYPTO_INVENTORY_HEADERS, cryptoInventoryRows } from './config-crypto.js';
import type { CryptoInventoryInput } from './config-crypto.js';

/** 連携の表を畳む前の説明(定型)。 */
const INTEGRATION_NOTE =
  '外部サービスとの繋がりは、使う先の軸がそのまま一覧になる。何と繋がっているかと、それが何のためかを 1 表で確かめられる。';

/** ログの目録の読み方(定型)。 */
const LOGGING_NOTE =
  'ログは標準出力に 1 行 1 JSON で出る。侵入されても証拠が残るように、本番ではホストの外の転送先へも送る(アプリから直接送る場合は、鍵が設定されたときだけ。送れなくてもアプリは止まらない)。転送先の設定そのものは配置先の管理画面や環境変数にある。';

/** 事象の目録の読み方(定型)。 */
const EVENTS_NOTE =
  '入力値・認証の情報(トークン・cookie)・個人を特定する値・拒否の理由文はどの行にも載らない。載るのは事象の ID・操作・実行者の ID・分類・不変条件の ID・要求の識別子だけである。流量の天井の拒否は不変条件の拒否として出る。';

/** 暗号の目録の読み方(定型)。 */
const CRYPTO_NOTE =
  '暗号に関わるものの全数。秘密(設定カタログの confidential の種類の行)・受信の署名・ログインセッション・持っていれば効く値を、宣言から導いて 1 表に並べる。' +
  '値そのものは載せない。使ってよい範囲を外れた使い方(別の口への流用)は、この表に無い使い方として人が止める。';

/** 置き場の読み方(定型)。 */
const TARGET_NOTE =
  '各行は値が要る置き場を持ち、`npm run config:doctor` が名前だけを照合して「有る / 無い / その置き場は見られない」を表で出す。' +
  '照合の手(`probe`)は名前の列挙しか返せない形しか宣言できないので、道具が値を読む経路そのものが無い。';

/** セキュリティの事象の出どころの呼び名(目録の `source`)。 */
const EVENT_SOURCE_WORDS = {
  server_action: 'Server Action(生成された入口と手書きの入口)',
  request_gate: '要求の前段・Route Handler の関門',
  auth_route: 'サインインの開始・帰り道・ログアウトの口',
  route_guard: 'Route Handler の出口の関所(`guardRoute`)',
} as const;

/** 死んだジョブの知らせ先の一文(エラーのログは宣言によらず出る)。 */
function alertWhere(logging: ConfigLoggingDecl): string {
  const destination = logging.deadLetterAlert?.destination;
  if (destination?.kind === 'forward') return `エラーのログに加えて ${destination.label}(鍵 \`${destination.keyEnv ?? ''}\` があるときだけ)`;
  if (destination?.kind === 'exempt') return `エラーのログだけ(本番でも知らせないと受け入れている。理由: ${destination.reason})`;
  return 'エラーのログだけ(知らせ先は宣言していない)';
}

/** ログの目録(宣言)の表の行。転送先の設定が検査から見えないことを、最後の行で毎回言う。 */
function loggingDeclarationRows(logging: ConfigLoggingDecl, labels: ReadonlyMap<string, string>): string[][] {
  const targets = logging.sink.requiredIn.map((id) => labels.get(`target:${id}`) ?? `\`${id}\``).join('、');
  const destination = logging.sink.destination;
  const where =
    destination.kind === 'forward'
      ? `標準出力 → ${destination.mode === 'app_direct' ? `アプリから直接(鍵 \`${destination.keyEnv ?? ''}\` があるときだけ)` : '配置先のログドレイン'} → ${destination.label}(ホストの外: ${destination.offHost ? 'はい' : 'いいえ'})`
      : destination.kind === 'exempt'
        ? `標準出力のみ(本番でも送らないと受け入れている。理由: ${destination.reason})`
        : '標準出力のみ(転送先は宣言していない)';
  return [
    [cell('形式'), cell('1 行 1 JSON(標準出力。配置先のログが付ける時刻と合わせて読む)')],
    [cell('どこへ'), cell(where)],
    [cell('転送先を必須にする置き場'), cell(targets === '' ? '宣言していない(本番を宣言していないので、転送先が無くても何も言われない)' : targets)],
    [cell('転送先を設定する場所'), cell(destination.kind === 'forward' ? destination.configuredIn : '—')],
    [cell('死んだジョブの知らせ先'), cell(alertWhere(logging))],
    [cell('保管日数'), cell(`${logging.retention.days} 日(${logging.retention.reason})`)],
    [cell('読める人'), cell(logging.readers.join('、'))],
    [cell('検査から見えないこと'), cell('本番の転送先が有効か(鍵が本番に置かれているか)・保管日数・読める人が宣言どおりか。verify が毎回「未検証」と名指す(K5)')],
  ];
}

/** `{軸}:{語}` → 表示名の索引(宣言が無い語はキーを持たない)。 */
export function termLabels(catalog: ConfigCatalogSpec): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  for (const [axis, terms] of Object.entries(catalog.vocabulary)) {
    for (const term of terms) if (term.label !== undefined) labels.set(`${axis}:${term.id}`, term.label);
  }
  return labels;
}

/** 下段の表 1 つ(折りたたみの見出し・読み方・列・行。共有の行)。 */
export interface ConfigLowerTable {
  readonly fold: FoldProps;
  readonly note?: string;
  readonly headers: readonly string[];
  /** 行(`cell` を通した文字列。識別子はバッククォートで囲む)。 */
  readonly rows: readonly (readonly string[])[];
}

/**
 * 設定の章の下段の表(並びは章に出る順)。
 *
 * @param catalog 設定カタログ
 */
export function configLowerTables(catalog: ConfigCatalogSpec, crypto?: Omit<CryptoInventoryInput, 'catalog'>): ConfigLowerTable[] {
  const labels = termLabels(catalog);
  const integrationRows = catalog.vocabulary.used_by.map((term) => {
    const variables = catalog.variables.filter((decl) => decl.usedBy.includes(term.id));
    return [cell(term.label ?? `\`${term.id}\``), cell(variables.map((decl) => `\`${decl.id}\``).join(', ') || '—'), cell(String(variables.length))];
  });
  const targetRows = catalog.vocabulary.target.map((term) => [
    cell(`\`${term.id}\``),
    cell(term.label ?? '—'),
    cell(String(catalog.variables.filter((decl) => decl.targets.includes(term.id)).length)),
  ]);
  const templateRows = catalog.variables.map((decl) => [
    cell(`\`${decl.id}\``),
    cell(decl.targets.map((id) => `\`${id}\``).join(', ') || '—(どこにも入れない)'),
    cell(labels.get(`provision:${decl.provision}`) ?? `\`${decl.provision}\``),
    cell(decl.notInTemplateReason === undefined ? '○' : '—(理由は上段の受け入れ)'),
  ]);
  const cryptoRows = cryptoInventoryRows({ catalog, external: crypto?.external, sessionToken: crypto?.sessionToken, bearerPlaces: crypto?.bearerPlaces ?? [] }, labels);
  const logging = catalog.logging;
  const loggingRows = logging === undefined ? [] : loggingDeclarationRows(logging, labels);
  const eventRows =
    logging === undefined
      ? []
      : SECURITY_EVENTS.map((event) => [
          cell(`\`${event.id}\``),
          cell(event.level),
          cell(EVENT_SOURCE_WORDS[event.source]),
          cell(event.summary),
          cell(event.codeField === null ? '—' : `\`${event.codeField}\`${event.codes.length === 0 ? '' : `: ${event.codes.map((code) => `\`${code}\``).join(', ')}`}`),
        ]);
  const fieldRows = logging === undefined ? [] : LOG_FIELDS.map((field) => [cell(`\`${field.name}\``), cell(field.value)]);
  return [
    {
      fold: { kind: 'table', title: '何と繋がっているか(連携)', count: integrationRows.length, hint: '使う先の軸。設定の行から導いた対応', element: 'config.integration' },
      note: INTEGRATION_NOTE,
      headers: ['何と / 何のために', '要る設定', '本数'],
      rows: integrationRows,
    },
    {
      fold: { kind: 'table', title: 'どこに入れるか(置き場)', count: targetRows.length, hint: '値がどこに要るか。名前だけを照合する', element: 'config.target' },
      note: TARGET_NOTE,
      headers: ['置き場', 'どこの・何が読むか', '要る設定の本数'],
      rows: targetRows,
    },
    {
      fold: { kind: 'table', title: '実装と雛形との対応(設定ごと)', count: templateRows.length, hint: '実装が読む環境変数と、雛形の両方と双方向に突き合わせる', element: 'config.template' },
      headers: ['環境変数', '置き場', '調達のしかた', '雛形に載るか'],
      rows: templateRows,
    },
    {
      fold: { kind: 'table', title: '暗号の目録(何を・どの方式で・どこで使い・どの範囲か)', count: cryptoRows.length, hint: '秘密・受信の署名・ログインセッション・持っていれば効く値。宣言から導いた全数', element: 'config.crypto' },
      note: CRYPTO_NOTE,
      headers: [...CRYPTO_INVENTORY_HEADERS],
      rows: cryptoRows,
    },
    {
      fold: { kind: 'table', title: 'ログの目録(どこへ・誰が読む・何日残す)', count: loggingRows.length, hint: '設定カタログの logging の宣言。転送先の設定は検査から見えない', element: 'config.logging' },
      note: LOGGING_NOTE,
      headers: ['項目', '内容'],
      rows: loggingRows,
    },
    {
      fold: { kind: 'table', title: 'セキュリティの事象(何を記録するか)', count: eventRows.length, hint: '仕組みの事象の目録。拒否・認証・出どころの確認', element: 'config.log_events' },
      note: EVENTS_NOTE,
      headers: ['事象', '重大度', '出す場所', '何が起きたか', '運ぶ分類'],
      rows: eventRows,
    },
    {
      fold: { kind: 'table', title: 'ログの欄(出してよい項目)', count: fieldRows.length, hint: '閉じた欄。個人の値を載せる欄は無い', element: 'config.log_fields' },
      headers: ['欄', '値'],
      rows: fieldRows,
    },
  ];
}


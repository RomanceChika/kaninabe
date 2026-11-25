/**
 * 設定の章の下段(導出): 暗号の目録(何を・どの方式で・どこで使い・どの範囲に使ってよいか。ASVS V11.1.2)。
 *
 * 材料はすべて宣言から導く(手で書き足す欄を持たない):
 *   - 秘密 … 設定カタログの `confidential: true` の種類の行(使う先・長さの下限・寿命と更新の手順・更新の間の旧い値)
 *   - 受信の署名 … 外部連携カタログの `direction: inbound` の行(方式・鍵の設定・受信口)
 *   - ログインセッション … プラットフォームの設定の `sessionToken`(方式がリポジトリの宣言に無いなら、その旨をそのまま出す)
 *   - 持っていれば効く値 … 仕組みの採番(`bearer` の欄。CSPRNG 32 バイトを base64url に)と、それを宣言した欄
 * **値そのものはどこにも出さない。** 出すのは名前・方式・長さの下限・範囲・周期だけ。
 */

import { BEARER_BYTES, BEARER_LENGTH } from '../../../kernel/bearer.js';
import { cell } from '../../../gen-kit/state-machine-table.js';
import { inboundUrlOf } from '../../../inbound/inbound-url.js';
import type { ConfigCatalogSpec, ConfigRotationDecl, ConfigVariableDecl } from '../../../model/config/types.js';
import type { ExternalCatalogSpec } from '../../../model/external/types.js';
import { isInbound } from '../../../model/external/types.js';
import type { SessionTokenProfile } from '../../../model/product/platform-profile.js';
import type { SpecModel } from '../../../model/types.js';

/** 暗号の目録の材料(宣言の側から集めたもの)。 */
export interface CryptoInventoryInput {
  readonly catalog: ConfigCatalogSpec;
  readonly external: Pick<ExternalCatalogSpec, 'integrations'> | null | undefined;
  readonly sessionToken: SessionTokenProfile | undefined;
  /** `bearer` を宣言した欄(`{集約}.{欄}`)。 */
  readonly bearerPlaces: readonly string[];
}

/** 暗号の目録の見出し(列)。 */
export const CRYPTO_INVENTORY_HEADERS = ['種別', '何', '方式・強さ', 'どこで使う', '使ってよい範囲', '寿命・更新'] as const;

/** 周期の表示(例 `365 日ごと`・`12 か月ごと`)。 */
function everyText(rotation: ConfigRotationDecl): string {
  return `${String(rotation.everyCount)} ${rotation.everyUnit === 'day' ? '日' : 'か月'}ごと`;
}

/** 更新の欄(周期・根拠・手順・持つ者)。 */
function rotationText(decl: ConfigVariableDecl): string {
  const rotation = decl.rotation;
  if (rotation === undefined) return decl.previous === undefined ? '—' : `更新の間だけ入れる旧い値(${decl.previous})`;
  const previous = decl.previous === undefined ? '' : `。更新の間は旧い値(\`${decl.previous}\`)も受ける`;
  const reason = rotation.reason === undefined ? '' : `(${rotation.reason})`;
  return `${everyText(rotation)}${reason}。手順: ${rotation.procedure}。持つ者: ${rotation.holders.join('、')}${previous}`;
}

/** 秘密の行。 */
function secretRows(input: CryptoInventoryInput, labels: ReadonlyMap<string, string>): string[][] {
  const secretKinds = new Set(input.catalog.vocabulary.kind.filter((term) => term.confidential === true).map((term) => term.id));
  const previousIds = new Set(input.catalog.variables.flatMap((decl) => (decl.previous === undefined ? [] : [decl.previous])));
  return input.catalog.variables
    .filter((decl) => secretKinds.has(decl.kind) && !previousIds.has(decl.id))
    .map((decl) => [
      cell('秘密(共有秘密・鍵・トークン)'),
      cell(`\`${decl.id}\``),
      cell(decl.strength === undefined ? '長さの下限の宣言なし(サービスの認証の秘密ではない)' : `長さ ${String(decl.strength.minLength)} 文字以上。下限に満たない値は未設定と同じに閉じる`),
      cell(decl.usedBy.map((id) => labels.get(`used_by:${id}`) ?? `\`${id}\``).join('、')),
      cell(decl.targets.length === 0 ? 'どの置き場にも人が入れない(道具が扱わない)' : `置き場: ${decl.targets.map((id) => `\`${id}\``).join('、')}`),
      cell(rotationText(decl)),
    ]);
}

/** 受信の署名の行。 */
function inboundRows(input: CryptoInventoryInput): string[][] {
  return (input.external?.integrations ?? []).filter(isInbound).map((integration) => {
    const url = `\`${inboundUrlOf(integration.id)}\``;
    if (integration.signature === 'none') {
      return [cell('受信の署名'), cell(`\`${integration.id}\``), cell('検証しない(誰でも叩ける)'), cell(url), cell(`範囲なし。理由: ${integration.signatureReason}`), cell('—')];
    }
    const scope = integration.signature === 'hmac_sha256' ? '受信口の本文(受信したバイト列)の検証だけ' : '相手の SDK が検証する(アダプタの実装)';
    const method = integration.signature === 'hmac_sha256' ? 'HMAC-SHA256(16 進)' : '相手の SDK';
    return [cell('受信の署名'), cell(`\`${integration.id}\``), cell(method), cell(url), cell(`${scope}。鍵は \`${integration.signatureKey}\`(上の秘密の行)`), cell('鍵の寿命と更新は、鍵の行の宣言に従う')];
  });
}

/** ログインセッションの行。 */
function sessionRows(input: CryptoInventoryInput): string[][] {
  const token = input.sessionToken;
  if (token === undefined) return [];
  return [[cell('ログインセッション'), cell(`${token.format}(${token.issuer} が発行)`), cell(token.algorithm), cell('ブラウザの cookie'), cell(token.scope), cell('セッションの寿命は認証の設定(H5)')]];
}

/** 持っていれば効く値の行(採番の方式は仕組みが持つ)。 */
function bearerRows(input: CryptoInventoryInput): string[][] {
  if (input.bearerPlaces.length === 0) return [];
  return [
    [
      cell('持っていれば効く値(bearer)'),
      cell(input.bearerPlaces.map((place) => `\`${place}\``).join('、')),
      cell(`CSPRNG ${String(BEARER_BYTES)} バイトを base64url にした ${String(BEARER_LENGTH)} 字(DB の列の既定値が採番する)`),
      cell('招待のように、持っているだけで権能が手に入る値の発行'),
      cell('宣言した欄の発行・受諾だけ。監査ログに値を載せない'),
      cell('欄の寿命の宣言(expires_at・used_at・reusable)に従う'),
    ],
  ];
}

/**
 * 暗号の目録の行を組む。
 *
 * @param input 宣言から集めた材料
 * @param labels `{軸}:{語}` → 表示名
 * @returns 表の行
 */
export function cryptoInventoryRows(input: CryptoInventoryInput, labels: ReadonlyMap<string, string>): string[][] {
  return [...secretRows(input, labels), ...inboundRows(input), ...sessionRows(input), ...bearerRows(input)];
}

/**
 * `bearer` を宣言した欄(`{集約}.{欄}`)の全数。
 *
 * @param model 仕様モデル
 * @returns 欄の場所
 */
export function bearerPlacesOf(model: SpecModel): string[] {
  return [...model.aggregates.values()].flatMap((specs) => (specs.entity === undefined ? [] : specs.entity.fields.filter((field) => field.bearer !== undefined).map((field) => `${specs.entity?.entity ?? ''}.${field.name}`)));
}

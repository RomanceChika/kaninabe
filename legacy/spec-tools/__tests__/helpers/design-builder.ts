/**
 * G 群のテスト用のモデル構築ヘルパー。
 *
 * 検証器のテストは**モデルをテスト内でリテラル構築して渡す**（規約: scripts-code-quality.md）。
 * ファイル I/O を挟まないので、loader のバグとテストの失敗が混ざらない。
 */

import type {
  BrandFileCheck,
  BrandFileStatus,
  ContrastPair,
  DesignBrand,
  DesignExternal,
  DesignGroup,
  DesignInput,
  DesignToken,
  DesignTokenSpec,
  ScannedCssFile,
} from '../../lib/model/design/types.js';
import { TEST_ROOTS } from './product-roots.js';
import { defaultIconPath } from '../../lib/model/design/loader.js';
import { TEST_LAYOUT } from './platform.js';

/** グループを 1 つ作る（トークン名は `{group}-` で始める）。 */
export function group(name: string, tokens: readonly DesignToken[]): DesignGroup {
  return { group: name, purpose: `${name} のテスト用`, tokens };
}

/** 色トークン（palette 参照つき）を 1 つ作る。 */
export function colorToken(name: string, hex: string, decorative: string | null = null): DesignToken {
  return { name, group: 'color', value: hex, ref: `${name}-palette`, note: null, decorative };
}

/** 色以外のトークン（直値）を 1 つ作る。 */
export function valueToken(groupName: string, name: string, value: string): DesignToken {
  return { name, group: groupName, value, ref: null, note: null, decorative: null };
}

/** テスト用のトークン仕様を組み立てる。 */
export function tokenSpec(options: {
  readonly groups?: readonly DesignGroup[];
  readonly externals?: readonly DesignExternal[];
  readonly contrast?: readonly ContrastPair[];
  readonly brand?: DesignBrand | null;
}): DesignTokenSpec {
  const groups = options.groups ?? [];
  return {
    theme: 'test_theme',
    file: 'docs/specs/frontend/design/tokens.md',
    palette: [],
    groups,
    tokens: groups.flatMap((entry) => entry.tokens),
    externals: options.externals ?? [],
    contrast: options.contrast ?? [],
    brand: options.brand ?? null,
  };
}

/** テスト用の brand 宣言を組み立てる(既定は icon だけ・placeholder なし)。 */
export function brand(options: {
  readonly icon?: string | null;
  readonly appleIcon?: string | null;
  readonly ogImage?: string | null;
  readonly placeholderReason?: string | null;
}): DesignBrand {
  return {
    icon: options.icon === undefined ? 'app/src/app/icon.svg' : options.icon,
    appleIcon: options.appleIcon ?? null,
    ogImage: options.ogImage ?? null,
    placeholder:
      options.placeholderReason === undefined || options.placeholderReason === null
        ? null
        : { reason: options.placeholderReason },
  };
}

/** 走査済みの CSS ファイルを 1 枚作る。 */
export function cssFile(file: string, source: string, generated = false): ScannedCssFile {
  return { file, source, generated };
}

/** brand ファイル 1 件のチェック結果を作る(既定は実在・既定 favicon と不一致)。 */
export function brandFileCheck(options: {
  readonly declaredPath?: string;
  readonly exists?: boolean;
  readonly sha256?: string | null;
}): BrandFileCheck {
  const exists = options.exists ?? true;
  return {
    declaredPath: options.declaredPath ?? 'app/src/app/icon.svg',
    exists,
    sha256: options.sha256 ?? (exists ? 'x'.repeat(64) : null),
  };
}

/** 検証器に渡す brand の実在チェック結果一式を作る(既定はすべて未宣言・favicon.ico 無し)。 */
export function brandStatus(options: {
  readonly icon?: BrandFileCheck | null;
  readonly appleIcon?: BrandFileCheck | null;
  readonly ogImage?: BrandFileCheck | null;
  readonly bookCopy?: BrandFileCheck | null;
  readonly faviconIcoExists?: boolean;
  readonly appGrounded?: boolean;
  readonly faviconIcoPath?: string | null;
}): BrandFileStatus {
  return {
    icon: options.icon ?? null,
    appleIcon: options.appleIcon ?? null,
    ogImage: options.ogImage ?? null,
    bookCopy: options.bookCopy ?? null,
    faviconIcoExists: options.faviconIcoExists ?? false,
    appGrounded: options.appGrounded ?? true,
    faviconIcoPath: options.faviconIcoPath ?? defaultIconPath(TEST_ROOTS, TEST_LAYOUT),
  };
}

/** 検証器に渡す入力を組み立てる。 */
export function designInput(options: {
  readonly spec?: DesignTokenSpec | null;
  readonly files?: readonly ScannedCssFile[];
  readonly cssAvailable?: boolean;
  readonly brand?: BrandFileStatus;
}): DesignInput {
  return {
    roots: TEST_ROOTS,
    tokens: { available: true, spec: options.spec ?? null },
    css: { available: options.cssAvailable ?? true, files: options.files ?? [] },
    brand: options.brand ?? brandStatus({}),
  };
}

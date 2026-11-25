/**
 * `brand`(ロゴ)のパース。トークン全体を読む `parse-tokens.ts` が呼ぶ下位の部品で、G0 の一部である。
 */

import { asRecord, type SpecReporter } from '../parse-common.js';
import { YamlReader } from '../yaml-reader.js';
import type { DesignBrand, DesignBrandPlaceholder } from './types.js';

/**
 * brand(ロゴ)を読む。
 *
 * `brand:` の節そのものは構文としては任意で書ける(書かなければ null を返すだけで G0 は
 * エラーにしない) —— 「宣言されていなければならない」という**意味の検査**は G8 の役目であり
 * (styling.md 8.8 節と同じ「構造の妥当性は G0 / 意味は G 各検証器」の分担)、ここで
 * 必須項目として落とすと G8(a)の Finding と役割が重複する。
 */
export function readBrand(reader: YamlReader, reporter: SpecReporter): DesignBrand | null {
  const raw = reader.raw('brand');
  if (raw === undefined || raw === null) return null;
  const record = asRecord(raw);
  if (record === null) {
    reporter.error(
      'brand',
      'brand はマッピングで書きます',
      'brand: の下に icon(必須。ファイル名の規約は置き場の配置の役割 app-icon を与えるアプリの枠の後段が持つ)・apple_icon / og_image / placeholder(任意)を書く',
    );
    reporter.dropRows();
    return null;
  }
  const brandReader = new YamlReader(record, 'brand', reporter);
  const icon = readBrandPath(brandReader, 'icon', 'brand.icon にアプリのアイコンのファイル(アプリの枠の規約の名前。置き場の配置の役割 app-icon を参照)へのパスを書く');
  const appleIcon = readBrandPath(brandReader, 'apple_icon', 'brand.apple_icon にアプリの枠の規約のアイコンのファイルへのパスを書く');
  const ogImage = readBrandPath(brandReader, 'og_image', 'brand.og_image にアプリの枠の規約の共有用画像のファイルへのパスを書く');
  const placeholder = readBrandPlaceholder(brandReader, reporter);
  return { icon, appleIcon, ogImage, placeholder };
}

/** brand のパス 1 件を読む(文字列として読めなかった宣言は、読み取り器が落とした宣言として数える)。 */
function readBrandPath(reader: YamlReader, key: string, suggestion: string): string | null {
  return reader.optionalString(key, suggestion) ?? null;
}

/** brand.placeholder(実物のロゴ待ちの受け入れ)を読む。 */
function readBrandPlaceholder(reader: YamlReader, reporter: SpecReporter): DesignBrandPlaceholder | null {
  const raw = reader.raw('placeholder');
  if (raw === undefined || raw === null) return null;
  const record = asRecord(raw);
  if (record === null) {
    reporter.error('brand.placeholder', 'brand.placeholder はマッピングで書きます', 'placeholder: の下に reason: <理由> を書く');
    reporter.dropRows();
    return null;
  }
  const placeholderReader = new YamlReader(record, 'brand.placeholder', reporter);
  const reason = placeholderReader.requiredString(
    'reason',
    '実物のロゴ待ちである理由(差し替え時期・仮アイコンの説明)を書く',
  );
  if (reason === null) {
    reporter.dropRows();
    return null;
  }
  return { reason };
}

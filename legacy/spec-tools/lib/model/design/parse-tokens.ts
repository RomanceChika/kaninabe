/**
 * トークン仕様(`design_token_spec`)のパース。検査 G0(スキーマ適合)の実体。
 *
 * ファイル I/O はしない(I/O は loader.ts に集約する。規約: scripts-code-quality.md)。
 * 何を書けるかの正は
 * `docs/rules/process/frontend/system/standards/conventions/styling.md`。
 */

import {
  asRecord,
  checkDocType,
  elementPointer,
  type ParseResult,
  SpecReporter,
} from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import { isHex } from './color.js';
import { cssValueProblem } from './css-value.js';
import { readBrand } from './parse-brand.js';
import type {
  ContrastPair,
  DesignExternal,
  DesignGroup,
  DesignToken,
  DesignTokenSpec,
  PaletteEntry,
} from './types.js';

/** トークン名・グループ名・palette 名に使える形(小文字・数字・ハイフン)。 */
const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** テーマ名の形(snake_case)。 */
const THEME_PATTERN = /^[a-z][a-z0-9_]*$/;

/** トークン仕様のパース結果。読めずに落とした行の数(`SpecReporter.droppedCount`)を添える。 */
export interface DesignParseResult extends ParseResult<DesignTokenSpec> {
  /** 読めずにモデルへ入れなかった行(palette の名前・externals / groups / tokens / contrast の要素・読めなかった brand の宣言)の数。 */
  readonly dropped: number;
}

/**
 * トークン仕様のフロントマターを読む。
 *
 * 1 つの欠落で全体を捨てないため、読めた部分は返しつつ違反を積む
 * (ドメイン仕様のパーサーと同じ流儀)。
 *
 * @param data フロントマターのマッピング
 * @param file 仕様ファイル(リポジトリルート相対)
 * @returns 構築できた仕様と G0 違反と、落とした行の数
 */
export function parseDesignTokens(data: unknown, file: string): DesignParseResult {
  const reporter = new SpecReporter(file);
  const record = asRecord(data);
  if (record === null) {
    reporter.error(undefined, 'トークン仕様のフロントマターがマッピングではありません', 'template.design_token_spec.md をコピーして書き直す');
    return { value: null, findings: reporter.findings(), dropped: reporter.droppedCount() };
  }
  checkDocType(record, 'design_token_spec', reporter);

  const reader = new YamlReader(record, '', reporter);
  const theme = readTheme(reader, reporter);
  const palette = readPalette(reader, reporter);
  const externals = readExternals(reader, reporter);
  const groups = readGroups(reader, reporter, palette);
  const tokens = groups.flatMap((group) => group.tokens);
  const contrast = readContrast(reader, reporter, tokens);
  const brand = readBrand(reader, reporter);

  if (theme === null) return { value: null, findings: reporter.findings(), dropped: reporter.droppedCount() };
  return {
    value: { theme, file, palette, groups, tokens, externals, contrast, brand },
    findings: reporter.findings(),
    dropped: reporter.droppedCount(),
  };
}

/** テーマ名を読む。 */
function readTheme(reader: YamlReader, reporter: SpecReporter): string | null {
  const theme = reader.requiredString('theme', 'theme にテーマ名(snake_case)を書く(例: night_workshop)');
  if (theme === null) return null;
  if (!THEME_PATTERN.test(theme)) {
    reporter.error('theme', 'theme は snake_case で書きます', 'theme: night_workshop のように小文字とアンダースコアで書く', {
      theme,
    });
  }
  return theme;
}

/** palette を読む。ここだけが hex を持つ。 */
function readPalette(reader: YamlReader, reporter: SpecReporter): readonly PaletteEntry[] {
  const raw = reader.raw('palette');
  const record = asRecord(raw);
  if (record === null) {
    reporter.error('palette', 'palette がありません(またはマッピングではありません)', 'palette に「名前: \'#rrggbb\'」の行を並べる');
    reporter.dropRows();
    return [];
  }
  const entries: PaletteEntry[] = [];
  for (const [name, value] of Object.entries(record)) {
    const pointer = `palette.${name}`;
    if (!NAME_PATTERN.test(name)) {
      reporter.error(pointer, `palette の名前 ${name} は小文字・数字・ハイフンで書きます`, '例: indigo-600', { name });
      reporter.dropRows();
      continue;
    }
    if (typeof value !== 'string' || !isHex(value)) {
      reporter.error(pointer, `palette.${name} は #rrggbb の文字列で書きます`, 'YAML の # はコメント記号なので、必ず引用符で囲む', {
        value: String(value),
      });
      reporter.dropRows();
      continue;
    }
    entries.push({ name, hex: value.toLowerCase() });
  }
  return entries;
}

/** externals を読む。 */
function readExternals(reader: YamlReader, reporter: SpecReporter): readonly DesignExternal[] {
  const items = reader.optionalList('externals', 'externals は「name / from / reason」を持つマッピングのリストで書く');
  const externals: DesignExternal[] = [];
  eachRecord(items, 'externals', reporter, 'name / from / reason を持つマッピングを並べる', (entry, index) => {
    const name = entry.requiredString('name', '外から供給される CSS 変数名を -- 抜きで書く');
    const from = entry.requiredString('from', '供給元のファイルをリポジトリルート相対で書く');
    const reason = entry.requiredString('reason', 'なぜ仕様側で値を持てないかを書く(理由の無い外部変数はトークン層の穴になる)');
    if (name === null || from === null || reason === null) return;
    if (!NAME_PATTERN.test(name)) {
      reporter.error(elementPointer('externals', index, name), `externals の name ${name} は小文字・数字・ハイフンで書きます`, '例: font-serif-jp', { name });
      return;
    }
    externals.push({ name, from, reason });
  });
  reporter.settleRows(items.length, externals.length);
  return externals;
}

/** groups を読む。 */
function readGroups(
  reader: YamlReader,
  reporter: SpecReporter,
  palette: readonly PaletteEntry[],
): readonly DesignGroup[] {
  const items = reader.requiredList('groups', 'groups に「group / purpose / tokens」のマッピングを並べる');
  if (items === null) return [];
  const paletteByName = new Map(palette.map((entry) => [entry.name, entry.hex]));
  const groups: DesignGroup[] = [];
  eachRecord(items, 'groups', reporter, 'group / purpose / tokens を持つマッピングを並べる', (entry, index) => {
    const group = entry.requiredString('group', 'グループ名(色なら color)を書く');
    const purpose = entry.requiredString('purpose', 'このグループが何を決めるかを 1 文で書く');
    if (group === null || purpose === null) return;
    const base = elementPointer('groups', index, group);
    if (!NAME_PATTERN.test(group)) {
      reporter.error(base, `group ${group} は小文字・数字・ハイフンで書きます`, '例: color / space / radius', { group });
      return;
    }
    const tokens = readTokens(entry, reporter, { group, base, paletteByName });
    groups.push({ group, purpose, tokens });
  });
  reporter.settleRows(items.length, groups.length);
  return groups;
}

/** readTokens に渡す文脈(引数が多く、位置で並べると取り違えても型が通るため)。 */
interface TokenContext {
  readonly group: string;
  readonly base: string;
  readonly paletteByName: ReadonlyMap<string, string>;
}

/** 1 グループ分のトークンを読む。 */
function readTokens(entry: YamlReader, reporter: SpecReporter, ctx: TokenContext): readonly DesignToken[] {
  const items = entry.requiredList('tokens', 'tokens に「name と value(または ref)」のマッピングを並べる');
  if (items === null) return [];
  const tokens: DesignToken[] = [];
  eachRecord(items, `${ctx.base}.tokens`, reporter, 'name と value(または ref)を持つマッピングを並べる', (item, index) => {
    const name = item.requiredString('name', `トークン名を ${ctx.group}- で始まる形で書く`);
    if (name === null) return;
    const pointer = elementPointer(`${ctx.base}.tokens`, index, name);
    if (!NAME_PATTERN.test(name) || !name.startsWith(`${ctx.group}-`)) {
      reporter.error(pointer, `トークン名 ${name} は ${ctx.group}- で始まる小文字・ハイフン区切りで書きます`, `CSS 変数名がそのままトークン名になる。例: ${ctx.group}-accent`, { name, group: ctx.group });
      return;
    }
    const resolved = resolveValue(item, reporter, pointer, ctx);
    if (resolved === null) return;
    const decorative = readDecorative(item, reporter, pointer, resolved.ref);
    tokens.push({
      name,
      group: ctx.group,
      value: resolved.value,
      ref: resolved.ref,
      note: item.optionalNote('note', 'note は用途を 1 文で書く') ?? null,
      decorative,
    });
  });
  reporter.settleRows(items.length, tokens.length);
  return tokens;
}

/**
 * `decorative` を読む(色トークンだけが持てる)。
 *
 * 「実際には重ねないので contrast 網羅の床(G3)の対象外」という受け入れの記録であり、
 * `ref` を持たないトークン(色以外)には書けない ―― 重ねる/重ねないの判断自体が
 * 色トークンにしか無い概念のため。
 */
function readDecorative(item: YamlReader, reporter: SpecReporter, pointer: string, ref: string | null): string | null {
  const decorative = item.optionalString('decorative', 'decorative には「実際には重ねない」理由を 1 行で書く(色トークンだけ)');
  if (decorative === undefined) return null;
  if (ref === null) {
    reporter.error(pointer, 'decorative は色トークン(ref を持つトークン)にしか書けません', '色でないなら decorative を消す', { decorative });
    return null;
  }
  return decorative;
}

/** value / ref の排他を検査して実値を解決する。 */
function resolveValue(
  item: YamlReader,
  reporter: SpecReporter,
  pointer: string,
  ctx: TokenContext,
): { value: string; ref: string | null } | null {
  const ref = item.optionalString('ref', 'ref には palette の名前を書く');
  const value = item.optionalString('value', 'value には直値(px・秒・数値・フォント列)を書く');
  if (ref !== undefined && value !== undefined) {
    reporter.error(pointer, 'value と ref は同時に書けません', '色は ref(palette 参照)、それ以外は value(直値)のどちらか一方にする', { ref, value });
    return null;
  }
  if (ref === undefined && value === undefined) {
    reporter.error(pointer, 'value も ref もありません', '色なら ref に palette の名前を、それ以外なら value に直値を書く');
    return null;
  }
  if (ref !== undefined) {
    const hex = ctx.paletteByName.get(ref);
    if (hex === undefined) {
      reporter.error(pointer, `ref が指す palette の名前 ${ref} がありません`, 'palette に定義を足すか、既存の名前に直す', { ref });
      return null;
    }
    return { value: hex, ref };
  }
  const literal = value ?? '';
  if (isHex(literal)) {
    reporter.error(pointer, 'トークンに hex を直接書くことはできません', 'palette に名前を付けてから ref で指す(色の名前空間を 1 つに保つため)', { value: literal });
    return null;
  }
  const problem = cssValueProblem(literal);
  if (problem !== null) {
    reporter.error(pointer, `トークンの value が書ける綴りではありません: ${problem}`, 'value は 数値(単位つき)・識別子・"引用符つきの名前"・許可した関数(var / calc ほか)の並びで書く。生成物の CSS にそのまま置かれるので、; { } @ url() などは書けない', { value: literal.slice(0, 80) });
    return null;
  }
  return { value: literal, ref: null };
}

/** contrast を読む。宣言した組み合わせだけが G3 の対象になる。 */
function readContrast(
  reader: YamlReader,
  reporter: SpecReporter,
  tokens: readonly DesignToken[],
): readonly ContrastPair[] {
  const items = reader.optionalList('contrast', 'contrast は「fg / bg / min」を持つマッピングのリストで書く');
  const known = new Set(tokens.filter((token) => token.ref !== null).map((token) => token.name));
  const pairs: ContrastPair[] = [];
  eachRecord(items, 'contrast', reporter, 'fg / bg / min を持つマッピングを並べる', (entry, index) => {
    const fg = entry.requiredString('fg', '前景の色トークン名を書く');
    const bg = entry.requiredString('bg', '背景の色トークン名を書く');
    const min = entry.optionalNumber('min', 'min には 4.5(本文)か 3(大きい文字・UI 部品の境界)を書く');
    if (fg === null || bg === null) return;
    const pointer = elementPointer('contrast', index, `${fg}-on-${bg}`);
    for (const name of [fg, bg]) {
      if (known.has(name)) continue;
      reporter.error(pointer, `contrast が指すトークン ${name} は palette を参照する色トークンではありません`, 'groups の color グループに ref つきで定義するか、名前の綴りを直す', { token: name });
      return;
    }
    if (min === undefined) {
      reporter.error(pointer, 'min がありません', 'WCAG AA なら 4.5(本文)か 3(大きい文字・UI 部品の境界)を書く');
      return;
    }
    pairs.push({ fg, bg, min });
  });
  reporter.settleRows(items.length, pairs.length);
  return pairs;
}

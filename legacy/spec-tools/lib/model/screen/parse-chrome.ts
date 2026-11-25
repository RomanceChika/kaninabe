/**
 * chrome_spec(`specs/frontend/chrome/{name}.md`)のパーサー。
 *
 * スキーマの正: screen-spec-writing.md §chrome_spec。S0(スキーマ適合)はここが担う。
 * chrome が持てるのは「画面をまたいで共有される骨格」— レイアウトと、そこに置いた部品から出る
 * 遷移だけである。読み取り(reads)と操作(actions)は持たない(共有部が業務の配線まで持つと、
 * 「この画面が何を読み何を発火するか」が画面仕様から消えて画面ごとの検査が効かなくなる)。
 *
 * 許すキーは**列挙**して、それ以外をエラーにする。禁止キーの列挙だと、綴りを間違えた宣言や
 * 将来の新しい語彙が黙って無視され、「書いたのに効いていない」状態が仕様に残る。
 */

import { asRecord, checkDocType, SpecReporter, type ParseResult } from '../parse-common.js';
import { YamlReader } from '../yaml-reader.js';
import { missingLayout, parseLayout } from './parse-layout.js';
import { parseNavigations } from './parse-screen-parts.js';
import type { ChromeSpec } from './types.js';

/** クローム名(snake_case)。 */
const NAME = /^[a-z][a-z0-9_]*$/;

const NAME_SUGGESTION = 'name にクローム名を snake_case で書く(例: member)';

/** クロームそのものの表示名(トップレベル label)の書き方。 */
const LABEL_SUGGESTION =
  'label はこの共有クロームの表示名(日本語名)を空でない文字列で書く。例: label: メンバー向けクローム。' +
  '表示名を決めていないならキーごと消す(label は任意。testid には影響しない)';

/**
 * クローム名から id を導く。`_` を `-` に置き換えて `chrome-` を前置する。
 *
 * @param name クローム名(snake_case)
 * @returns 期待される id(例: member → chrome-member)
 */
export function chromeIdOf(name: string): string {
  return `chrome-${name.split('_').join('-')}`;
}

/**
 * chrome_spec のフロントマターを ChromeSpec に変換する。
 *
 * @param data フロントマターのパース結果(unknown)
 * @param file リポジトリルートからの相対パス(Finding の location に入る)
 * @param relPath specs/frontend/chrome からの相対パス(例: "member.md")
 * @returns ChromeSpec と S0 違反。必須項目を読めない場合は value=null
 */
export function parseChromeSpec(data: unknown, file: string, relPath: string): ParseResult<ChromeSpec> {
  const reporter = new SpecReporter(file);
  const record = asRecord(data);
  if (record === null) {
    reporter.error(
      undefined,
      'chrome_spec のフロントマターがマッピングではありません',
      'template.chrome_spec.md をコピーし、doc_type: chrome_spec から始まる YAML マッピングとして書き直す',
    );
    return { value: null, findings: reporter.findings() };
  }

  checkDocType(record, 'chrome_spec', reporter);
  const root = new YamlReader(record, '', reporter);
  checkScope(root, reporter);
  checkAllowedKeys(record, reporter);

  const name = parseName(root, reporter);
  const id = parseId(root, name, reporter);
  const label = root.optionalLabel('label', LABEL_SUGGESTION);
  const layout = parseChromeLayout(root, reporter);
  const navigations = parseNavigations(root, reporter, true);
  if (name !== null) checkPlacement(name, relPath, reporter);
  if (id === null || name === null) return { value: null, findings: reporter.findings() };

  return {
    value: {
      id,
      name,
      ...(label === undefined ? {} : { label }),
      layout,
      navigations,
      relPath,
      location: reporter.location(),
    },
    findings: reporter.findings(),
  };
}

/** `layout` を読む。未記入はエラー(骨格の宣言が無いクロームは何も共有していない)。 */
function parseChromeLayout(root: YamlReader, reporter: SpecReporter) {
  if (!root.has('layout')) {
    reporter.error(
      'layout',
      'layout がありません',
      'layout に "header: [app_header]" のようにスロットと部品を書く(chrome の中身はこれだけ)',
    );
    return missingLayout('layout', reporter);
  }
  return parseLayout(root.raw('layout'), 'layout', reporter);
}

/** scope は frontend 固定。 */
function checkScope(root: YamlReader, reporter: SpecReporter): void {
  const scope = root.optionalString('scope', 'scope: frontend と書く');
  if (scope === undefined) {
    reporter.error('scope', 'scope がありません', 'フロントマターに scope: frontend を書く');
    return;
  }
  if (scope === 'frontend') return;
  reporter.error(
    'scope',
    'chrome_spec の scope は frontend でなければなりません',
    'scope: frontend に直す(specs/frontend 配下の仕様はすべて frontend)',
    { actual: scope },
  );
}

/** chrome_spec に書けるキーの全体(これ以外はエラーにする)。 */
const ALLOWED_KEYS: readonly string[] = [
  'doc_type',
  'scope',
  'id',
  'name',
  'label',
  'layout',
  'navigations',
];

/**
 * 許可された節だけで書かれているかを見る(allowlist)。
 *
 * chrome に `reads` / `actions` / `for` を許すと、「この画面が何を読み・何を発火し・誰が見るか」が
 * 画面仕様から消えて共有部に隠れ、画面ごとの検査(S2 / S4)がその分だけ効かなくなる。
 * 列挙するのを「禁止」ではなく「許可」の側にしているのは、綴りを間違えた宣言
 * (`navigation:` など)が黙って無視されるのを防ぐためである。
 */
function checkAllowedKeys(
  record: Readonly<Record<string, unknown>>,
  reporter: SpecReporter,
): void {
  for (const key of Object.keys(record)) {
    if (ALLOWED_KEYS.includes(key)) continue;
    reporter.error(
      key,
      `chrome_spec に ${key} は書けません`,
      `chrome_spec に書けるのは ${ALLOWED_KEYS.join(' / ')} だけ。` +
        `${key} が画面ごとの宣言なら各 screen_spec に書く(綴り違いなら直す)`,
      { key, allowed: ALLOWED_KEYS.join(', ') },
    );
  }
}

/** name を読む。 */
function parseName(root: YamlReader, reporter: SpecReporter): string | null {
  const name = root.requiredString('name', NAME_SUGGESTION);
  if (name === null) return null;
  if (NAME.test(name)) return name;
  reporter.error('name', `name ${name} が snake_case ではありません`, NAME_SUGGESTION, { name });
  return null;
}

/** id を読み、name から導かれる `chrome-{name}` と一致するかを見る。 */
function parseId(root: YamlReader, name: string | null, reporter: SpecReporter): string | null {
  const suggestion = 'id を "chrome-{name をハイフン区切りにしたもの}"(例: chrome-member)形式で書く';
  const id = root.requiredString('id', suggestion);
  if (id === null || name === null) return id;
  const expected = chromeIdOf(name);
  if (id === expected) return id;
  reporter.error(
    'id',
    `id が name(${name})から導かれる ID と一致しません`,
    `id: ${expected} に直す(id は name と 1 対 1 に対応する)`,
    { expected, actual: id },
  );
  return id;
}

/** 置き場が `chrome/{name}.md`(ディレクトリを掘らない)かを見る。 */
function checkPlacement(name: string, relPath: string, reporter: SpecReporter): void {
  if (relPath === `${name}.md`) return;
  reporter.error(
    'name',
    `chrome_spec の置き場(${relPath})が chrome/{name}.md ではありません`,
    `ファイルを chrome/${name}.md に移すか、name をファイル名に合わせる(共有クロームは数が少ないのでディレクトリは掘らない)`,
    { expected: `${name}.md`, actual: relPath },
  );
}

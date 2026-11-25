/**
 * 製品の根の宣言(`product.md`)のフロントマターをモデルに変換する純粋関数。
 *
 * I/O は loader.ts が担う(規約: scripts-code-quality.md「I/O と純粋ロジックの分離」)。
 * 違反は例外ではなく Finding として積む。
 */

import { asRecord, checkDocType, type SpecReporter } from '../parse-common.js';
import { YamlReader } from '../yaml-reader.js';
import {
  OPTIONAL_ROOT_NAMES,
  REQUIRED_ROOT_NAMES,
  type ProductRootName,
  type ProductRoots,
} from './types.js';
import { parseProductSummary } from './parse-summary.js';
import { parseTermScan } from './parse-term-scan.js';
import { isSpecKind, RETIRED_SPEC_KINDS, SPEC_KINDS, type ProductUses, type SpecKind } from './uses.js';

/** 宣言ファイルの doc_type。 */
export const PRODUCT_ROOTS_DOC_TYPE = 'product_roots';

/** 宣言のフロントマターに書いてよいキー。 */
const ALLOWED_KEYS: readonly string[] = ['doc_type', 'scope', 'id', 'norms', 'decisions', 'name', 'summary', 'roots', 'uses', 'term_scan'];

/** 根の値の 1 要素の綴り(許可表): 英数字・`_` で始まり、英数字・`_` `.` `-` が続く。`.` で始まる名前(`.git` `.github` `.env` …)は置けない。 */
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/** 根にできない木(仕組み自身と道具の木。生成物の書き先にしない)。 */
const RESERVED_TREES: readonly string[] = ['framework', 'tools', 'node_modules'];

/** 根の値として受け付けない形(絶対パス・上へ登る・末尾のスラッシュ・書き先の綴りを曖昧にする形・仕組みの木)。 */
const REJECTED = [
  { test: (value: string): boolean => value.startsWith('/'), reason: '絶対パスです' },
  { test: (value: string): boolean => value.split('/').includes('..'), reason: '".." を含みます' },
  { test: (value: string): boolean => value.endsWith('/'), reason: '末尾がスラッシュです' },
  { test: (value: string): boolean => value.trim() === '', reason: '空です' },
  { test: (value: string): boolean => /^[A-Za-z]:/.test(value), reason: 'ドライブ文字で始まります' },
  { test: (value: string): boolean => /[\u0000-\u001F\u007F-\u009F\u2028\u2029\\]/u.test(value), reason: '制御文字またはバックスラッシュを含みます' },
  { test: (value: string): boolean => value.split('/').some((segment) => !SEGMENT.test(segment)), reason: '要素が英数字・_ で始まる英数字・_ . - の綴りではありません(. で始まる名前・空の要素・空白は置けない)' },
  { test: (value: string): boolean => value.split('/').some((segment) => RESERVED_TREES.includes(segment)), reason: '仕組みの木・道具の木・node_modules の要素を含みます' },
] as const;

/** どう直すかの定型文(根の書き方)。 */
const HOW = 'リポジトリルートからの相対パスを "/" 区切りで 1 行書く(例: specs: docs/specs)';

/**
 * 宣言のフロントマターから根を組み立てる。
 *
 * @param data フロントマターのマッピング
 * @param reporter 違反の記録先
 * @returns 読めた根。必須の根が 1 つでも欠けたら null
 */
export function parseProductRoots(
  data: Readonly<Record<string, unknown>>,
  reporter: SpecReporter,
): ProductRoots | null {
  checkDocType(data, PRODUCT_ROOTS_DOC_TYPE, reporter);
  const top = new YamlReader(data, '', reporter);
  top.rejectUnknownKeys(ALLOWED_KEYS, '製品の根の宣言', '根は roots の下にまとめて書く');

  const record = asRecord(data['roots']);
  if (record === null) {
    reporter.error('roots', 'roots がありません', `roots のマッピングを書き、${HOW}`);
    return null;
  }
  const reader = new YamlReader(record, 'roots', reporter);
  const known = [...REQUIRED_ROOT_NAMES, ...OPTIONAL_ROOT_NAMES];
  reader.rejectUnknownKeys(
    known,
    'roots',
    `宣言できる根は ${known.join(' / ')} だけである(手書き層の置き場は仕組みが形として決めるので宣言しない)`,
  );

  const required = readRequired(reader, reporter);
  if (required === null) return null;
  const summary = parseProductSummary(data, reporter);
  return {
    // 製品の名前は根ではない(パスを持たない)が、**必須**である —— これが無いと W1 / W2 の語彙に
    // 製品の名前が入らず、仕組み側のコードに製品名を書いても**完全に無音**になる(束 ①-c-c の
    // レビューが実測: `name:` の 1 行を消すと、仕込んだ製品名のリテラルも散文も落ちなくなった)。
    // 宣言を新設したのに番人が無い形を残さないため、欠落はここで落とす。
    name: top.requiredString('name', '製品の名前を 1 行書く(例: name: my_product)。仕組み側のコードにこの語が出たら W1 / W2 が落とす'),
    ...required,
    app: readOptional(reader, reporter, 'app'),
    knowledge: readOptional(reader, reporter, 'knowledge'),
    previews: readOptional(reader, reporter, 'previews'),
    termScan: parseTermScan(data, reporter),
    // 任意。書いていなければキー自体を持たない(推測の文・既定の文を入れない)。
    ...(summary === undefined ? {} : { summary }),
  };
}

/** 必須の 4 根を読む。1 つでも欠けたら null(根が決まらないと何も動かせない)。 */
function readRequired(
  reader: YamlReader,
  reporter: SpecReporter,
): Pick<ProductRoots, 'specs' | 'book' | 'generated' | 'migrations'> | null {
  const values = new Map<ProductRootName, string>();
  for (const name of REQUIRED_ROOT_NAMES) {
    const raw = reader.requiredString(name, `${HOW}。この根はどの製品にも要る`);
    if (raw === null) continue;
    const value = accept(raw, name, reporter);
    if (value !== null) values.set(name, value);
  }
  const specs = values.get('specs');
  const book = values.get('book');
  const generated = values.get('generated');
  const migrations = values.get('migrations');
  if (specs === undefined || book === undefined || generated === undefined || migrations === undefined) {
    return null;
  }
  return { specs, book, generated, migrations };
}

/** 省略できる根を読む。書かれていなければ null(「持たない製品」を表す)。 */
function readOptional(
  reader: YamlReader,
  reporter: SpecReporter,
  name: ProductRootName,
): string | null {
  const raw = reader.optionalString(name, `${HOW}。持たない製品はこの行を書かない`);
  if (raw === undefined) return null;
  return accept(raw, name, reporter);
}

/** 根の値の形を確かめる。受け付けない形なら違反を積んで null。 */
function accept(value: string, name: ProductRootName, reporter: SpecReporter): string | null {
  for (const rule of REJECTED) {
    if (!rule.test(value)) continue;
    reporter.error(`roots.${name}`, `roots.${name} が${rule.reason}`, HOW, { value });
    return null;
  }
  return value;
}

/** `uses` の書き方の定型文。 */
const USES_HOW =
  `この製品が採る仕様の種類を列挙する(値は ${SPEC_KINDS.join(' / ')} だけ。何も採らないなら \`uses: []\`)。` +
  '採っていない種類の検査は「未実施」と報告され、採ったのに読めない種類は「阻害」と報告される。ファイルの有無からは推定しない';

/**
 * 宣言のフロントマターから**採る仕様の種類**(`uses`)を組み立てる。
 *
 * **既定値を置かない。** `uses` が無い宣言は読めない(P0)—— 無いことを「何も採らない」や
 * 「置き場にあるものを全部採る」と推定すると、採ったのに消えた種類が黙って「採っていない」に化ける。
 * 値は閉じた一覧(`SPEC_KINDS`)の中だけで、知らない値・重複は落とす(書いたのに効かない状態を作らない)。
 *
 * @param data フロントマターのマッピング
 * @param reporter 違反の記録先
 * @returns 採る種類(宣言順)。欠落・不正があれば null
 */
export function parseProductUses(
  data: Readonly<Record<string, unknown>>,
  reporter: SpecReporter,
): ProductUses | null {
  const reader = new YamlReader(data, '', reporter);
  // 要素を自分で見る(文字列でない要素を読み飛ばすと、残りが「何も採らない」宣言に化けてしまう)。
  const listed = reader.requiredList('uses', USES_HOW);
  if (listed === null) return null;

  const accepted: SpecKind[] = [];
  let valid = true;
  listed.forEach((value, index) => {
    const pointer = `uses[${index}]`;
    if (typeof value !== 'string') {
      reporter.error(pointer, `uses[${index}] は文字列で書きます`, USES_HOW, { value: String(value) });
      valid = false;
      return;
    }
    if (!isSpecKind(value)) {
      const renamed = RETIRED_SPEC_KINDS.get(value);
      if (renamed !== undefined) {
        reporter.error(pointer, `uses の ${value} は廃止されました(${renamed} と書きます)`, `uses の ${value} を ${renamed} に書き直す`, {
          value,
          expected: renamed,
        });
      } else {
        reporter.error(pointer, `uses に知らない種類 ${value} があります`, USES_HOW, { value });
      }
      valid = false;
      return;
    }
    if (accepted.includes(value)) {
      reporter.error(pointer, `uses に ${value} が重複しています`, '同じ種類は 1 回だけ書く', { value });
      valid = false;
      return;
    }
    accepted.push(value);
  });
  return valid ? accepted : null;
}

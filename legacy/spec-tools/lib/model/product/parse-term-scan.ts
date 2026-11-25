/**
 * 製品の宣言(`product.md`)の `term_scan` を、用語の台帳(M8 / M9)の追加の走査範囲に変換する純粋関数。
 *
 * 開発用リポジトリだけにある置き場(設計メモ・引き継ぎ文書・案内・フック・CI)を、仕組みのコードが
 * 綴りで持たないための入口である。書かなければ空 —— 配布の木の製品はこの宣言を持たない。
 * 違反は例外ではなく Finding として積む(規約: scripts-code-quality.md「I/O と純粋ロジックの分離」)。
 */

import { asRecord, type SpecReporter } from '../parse-common.js';
import { YamlReader } from '../yaml-reader.js';
import { NO_TERM_SCAN, type ProductTermScan } from './types.js';

/** `term_scan` に書いてよいキー(YAML の綴り)。 */
const TERM_SCAN_KEYS: readonly string[] = ['prose_trees', 'prose_files', 'script_trees', 'history'];

/** どう直すかの定型文。 */
const HOW = 'リポジトリルートからの相対パスを "/" 区切りで、"- " で始まる行として並べる(例: prose_trees の下に - memo)';

/** 受け付けない形(絶対パス・上へ登る・空)。末尾のスラッシュは `history` だけが「木ごと外す」印として使う。 */
const REJECTED = [
  { test: (value: string): boolean => value.startsWith('/'), reason: '絶対パスです' },
  { test: (value: string): boolean => value.split('/').includes('..'), reason: '".." を含みます' },
  { test: (value: string): boolean => value.trim() === '', reason: '空です' },
] as const;

/** 1 つの欄を読む。受け付けない要素は違反を積んで落とす。 */
function readList(reader: YamlReader, reporter: SpecReporter, key: string, allowTrailingSlash: boolean): readonly string[] {
  const accepted: string[] = [];
  reader.optionalStringList(key, HOW).forEach((value, index) => {
    const pointer = `term_scan.${key}[${index}]`;
    const rejected = REJECTED.find((rule) => rule.test(value));
    if (rejected !== undefined) {
      reporter.error(pointer, `${pointer} が${rejected.reason}`, HOW, { value });
      return;
    }
    if (!allowTrailingSlash && value.endsWith('/')) {
      reporter.error(pointer, `${pointer} の末尾がスラッシュです`, `${HOW}(末尾の "/" で木ごと外せるのは history だけ)`, { value });
      return;
    }
    accepted.push(value);
  });
  return accepted;
}

/**
 * 宣言のフロントマターから用語の台帳の追加の走査範囲を組み立てる。
 *
 * @param data フロントマターのマッピング
 * @param reporter 違反の記録先
 * @returns 読めた範囲。`term_scan` が無ければ空(`NO_TERM_SCAN`)
 */
export function parseTermScan(data: Readonly<Record<string, unknown>>, reporter: SpecReporter): ProductTermScan {
  const raw = data['term_scan'];
  if (raw === undefined || raw === null) return NO_TERM_SCAN;
  const record = asRecord(raw);
  if (record === null) {
    reporter.error('term_scan', 'term_scan はマッピングで書きます', `term_scan の下に ${TERM_SCAN_KEYS.join(' / ')} を書く`);
    return NO_TERM_SCAN;
  }
  const reader = new YamlReader(record, 'term_scan', reporter);
  reader.rejectUnknownKeys(TERM_SCAN_KEYS, 'term_scan', `書けるのは ${TERM_SCAN_KEYS.join(' / ')} だけである`);
  return {
    proseTrees: readList(reader, reporter, 'prose_trees', false),
    proseFiles: readList(reader, reporter, 'prose_files', false),
    scriptTrees: readList(reader, reporter, 'script_trees', false),
    history: readList(reader, reporter, 'history', true),
  };
}

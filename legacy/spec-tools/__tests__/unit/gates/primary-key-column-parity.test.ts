/**
 * 主キー列名(全表が持つ `id`)の写しの突き合わせ。
 *
 * 主キー列の名前の正は `lib/sql/ddl-plan.ts` の `KEY_COLUMN` である。SQL を書く部品・DB の索引を導く関係の層・検査・意味の層は、
 * それぞれ自分の定数に同じ値を書き写している —— 部品の間に辺(import)を増やさないため(候補の間の向きの構造テストを赤にしない)。
 * 写しは別々に書き換えられうるので、**定数を import せず**、ソースの宣言を読んで値の一致をここで見張る。
 *
 * 写しの一覧は人が書く。ただし `lib` を走査して、主キー列の名前の定数(`…KEY_COLUMN` / `KEY` / `PRIMARY_KEY`)が一覧に無ければ、
 * 新しい写しとして赤にする(一覧に足すか、写さずに既存の定数を使う)。アクターの表の `id` 欄を指す定数(`ACTOR_ID_FIELD` など)は
 * 名前が別の概念(行の識別子ではなくアクターの属性)なので対象にしない。
 *
 * **検出の限界**: 走査が拾うのは、定数の名前が上の型(`…KEY_COLUMN` / `KEY` / `PRIMARY_KEY`)で、宣言が `const X = '…';`(単一引用符の文字列リテラル 1 つ)の形のものだけ。
 * 別の名前・テンプレートリテラル・二重引用符・式で組んだ値の写しは見えない(守っているのは「この形の写しが一覧から漏れない」まで)。
 */

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KEY_COLUMN } from '../../../lib/sql/ddl-plan.js';
import { walkFiles } from '../../../lib/io/paths.js';

const LIB_DIR = fileURLToPath(new URL('../../../lib/', import.meta.url));

/** 主キー列の名前の写し(`lib` からの相対パス → 定数名)。 */
const COPIES: Readonly<Record<string, string>> = {
  'sql/ddl-plan.ts': 'KEY_COLUMN',
  'sql/rls-context.ts': 'KEY_COLUMN',
  'sql/rls-migration.ts': 'KEY_COLUMN',
  'sql/rls-when.ts': 'KEY_COLUMN',
  'sql/rpc-reach.ts': 'KEY_COLUMN',
  'sql/rpc-reach-login.ts': 'KEY_COLUMN',
  'sql/roles-to-sql.ts': 'ACTOR_KEY_COLUMN',
  'sql/ddl-copy-triggers.ts': 'KEY',
  'sql/ddl-check-triggers.ts': 'KEY',
  'sql/ddl-cross-check-body.ts': 'KEY',
  'sql/ddl-ref-check-ends.ts': 'KEY',
  'semantics/query-window-columns.ts': 'PRIMARY_KEY',
  'relations/index-requirements/index-derivation.ts': 'PRIMARY_KEY_COLUMN',
  'trace/compute-child-set.ts': 'PRIMARY_KEY_COLUMN',
};

/** 主キー列の名前の定数らしい名前。 */
const KEY_CONSTANT_NAME = /^(?:[A-Z_]*KEY_COLUMN|KEY|PRIMARY_KEY)$/u;

/** ファイルの先頭の階層に宣言された文字列の定数を (名前 → 値) で集める。 */
function stringConstantsOf(source: string): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const match of source.matchAll(/^(?:export )?const ([A-Z][A-Z0-9_]*) = '([^']*)';/gmu)) {
    found.set(match[1] ?? '', match[2] ?? '');
  }
  return found;
}

/** `lib` 配下の `.ts` の (相対パス → 先頭の階層の文字列の定数)。 */
function libConstants(): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const files = walkFiles(LIB_DIR, (name) => name.endsWith('.ts'));
  return new Map(files.map((file) => [relative(LIB_DIR, file), stringConstantsOf(readFileSync(file, 'utf8'))]));
}

describe('主キー列名の写しの突き合わせ', () => {
  const constants = libConstants();

  it('正の定数は id である', () => {
    expect(KEY_COLUMN).toBe('id');
  });

  it.each(Object.entries(COPIES))('%s の %s は正の定数と同じ値', (file, name) => {
    expect(constants.get(file)?.get(name), `${file} に ${name} の宣言が見つかりません`).toBe(KEY_COLUMN);
  });

  it('主キー列の名前の定数は、一覧にあるものだけ(新しい写しを黙って増やさない)', () => {
    const found = [...constants]
      .flatMap(([file, names]) => [...names.keys()].filter((name) => KEY_CONSTANT_NAME.test(name)).map((name) => `${file}:${name}`))
      .sort();

    expect(found).toEqual(Object.entries(COPIES).map(([file, name]) => `${file}:${name}`).sort());
  });
});

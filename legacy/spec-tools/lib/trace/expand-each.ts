/**
 * `@tc-each` のひな形を、台帳(`test_cases`)の宣言に当てて**注釈に展開する**純粋関数。
 *
 * ## なぜひな形が要るのか
 *
 * 表ごとの突合(`ddl-parity` / `data-table-parity` / `rpc-parity`)は、注釈を 1 対 1 で付ける
 * ために**表ごとの `it` を手で並べて**いた。その形はテストファイルを**アプリの表名の一覧**に
 * するので、別題材の通し実行(`npm run samples:db`)はそのファイルを 1 本も実行できない ——
 * 仕組みの側の突合が、題材では 1 度も回らないということである。
 *
 * ループに寄せれば表名は消えるが、`it` の名前が実行時にしか定まらないので静的な突合
 * (3 段: ファイル → `@tc` → テスト名)が成立しない。そこで**ひな形だけを静的に示す**。
 *
 * ## 何を根拠に「実行している」と言えるのか
 *
 * ループが回る母集合は**期待表のキー**であり、期待表は仕様(`ddl_migration` を宣言した
 * data_table 等)から生成される。したがって「宣言された表 = ループが実行する表」は生成の側で
 * 閉じている。ここが見るのはその手前の 1 点 ——
 * **台帳が示すテスト名が、そのファイルのループのひな形に当てはまるか**である。
 * 当てはまれば注釈 1 件に展開し、以降の検査(A6 / T3 / A12 / Z1 …)はこれまでどおり読む。
 *
 * ひな形とループの `it` の名前が食い違う場合(`loopName`)は A12 が止める —— ひな形だけを
 * 書き換えて突合を空にできないようにするためである。
 */

import { normalizeTemplate } from './extract-annotations.js';
import type { EachTagRef, TestAnnotation, TcRegistry, TcRegistryEntry } from '../testcase/types.js';
import type { ScanWithFramework } from '../testcase/index.js';

/** 正規表現の特殊文字を素の文字に落とす。 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * ひな形に当てはまるテスト名かどうかの判定器を作る。
 *
 * 穴(`{table}`)は**空でない 1 つ以上の文字**にだけ当たる —— 空に当ててしまうと、
 * ひな形の固定部分だけのテスト名(ループの外に置いた別のテスト)まで拾ってしまう。
 *
 * @param template `@tc-each` に書かれたひな形
 * @returns テスト名を当てる正規表現
 */
export function templateMatcher(template: string): RegExp {
  const parts = normalizeTemplate(template).split('{}').map(escapeRegExp);
  return new RegExp(`^${parts.join('(.+)')}$`);
}

/** ひな形 1 件から展開した注釈(台帳のエントリ 1 件につき 1 つ)。 */
function expandOne(
  each: { readonly file: string; readonly line: number; readonly template: string },
  entry: TcRegistryEntry,
): TestAnnotation {
  return {
    tcId: entry.tcId,
    // ひな形は ID ごとの `@spec` を持てない(1 行で N 件を示すため)。台帳の宣言を
    // そのまま写すので、`@spec` の食い違いの警告はここからは出ない。
    specIds: entry.specIds,
    testName: entry.implementation.testName,
    decorates: true,
    file: each.file,
    line: each.line,
  };
}

/**
 * ひな形の列を台帳に当てて、足す注釈を作る(1 つの走査の範囲ぶん)。
 *
 * @param annotations その範囲の展開前の注釈
 * @param eachTags その範囲のひな形
 * @param registry 全仕様種のテストケース ID 台帳
 * @returns 足す注釈(無ければ空)
 */
function expandInScope(
  annotations: readonly TestAnnotation[],
  eachTags: readonly EachTagRef[],
  registry: TcRegistry,
): TestAnnotation[] {
  const known = new Set(annotations.map((annotation) => annotation.tcId));
  const expanded: TestAnnotation[] = [];
  for (const each of eachTags) {
    const matcher = templateMatcher(each.template);
    for (const entry of registry.entries) {
      if (entry.implementation.file !== each.file) continue;
      if (known.has(entry.tcId)) continue;
      if (!matcher.test(entry.implementation.testName)) continue;
      known.add(entry.tcId);
      expanded.push(expandOne(each, entry));
    }
  }
  return expanded;
}

/**
 * 走査結果の `@tc-each` を台帳に当てて展開し、注釈を足した走査結果を返す。
 *
 * 展開しても元の注釈は消さない(同じファイルに手書きの `@tc` が残っていてよい)。
 * ひな形に当てはまる宣言が 1 件も無ければ何も足さない —— その場合は宣言の側が
 * 「注釈が無い」として落ちるので、ここで別のことを言わない。
 *
 * **仕組みの根の走査(`framework`)のひな形も、その範囲の注釈へ展開する**(範囲ごとに独立に当てる —— 製品の注釈と仕組みの注釈は
 * 別の根のパスで数える)。
 *
 * @param tests app/ の走査結果(仕組みの走査を入れ子で持っていてよい)
 * @param registry 全仕様種のテストケース ID 台帳
 * @returns 展開後の走査結果(入力は変更しない)
 */
export function expandEachTags<T extends ScanWithFramework>(tests: T, registry: TcRegistry): T {
  const product = expandInScope(tests.annotations, tests.eachTags ?? [], registry);
  const framework = tests.framework;
  const frameworkAdded =
    framework === undefined ? [] : expandInScope(framework.annotations, framework.eachTags ?? [], registry);
  if (product.length === 0 && frameworkAdded.length === 0) return tests;
  return {
    ...tests,
    annotations: [...tests.annotations, ...product],
    ...(framework === undefined ? {} : { framework: { ...framework, annotations: [...framework.annotations, ...frameworkAdded] } }),
  };
}

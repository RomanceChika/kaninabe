/**
 * A12 注釈なしテストの検出(ファイル単位のラチェット)。
 *
 * action-spec-writing.md の A12:「`@tc` の注釈を 1 つも持たないテストファイルは、
 * 既知の未処理台帳(`test_tag_baseline`)に載っているものに限る」。
 *
 * 機械が突合キーに使うのは `@tc` だけであり、注釈の無いテストは A6 の orphan 判定にも
 * A7 の網羅にも**母集合として現れない**(違反ではなく不在として扱われる)。その結果、
 * 注釈を付けずに書いたテストは何を確かめているのかを機械に言えないまま増えていく。
 *
 * 既存の無印はテスト義務の全域化(BACKLOG)の本体で解消するため、ここでは
 * **ラチェット(現状より悪くしない)**だけを執行する。導入時点の無印ファイルは
 * specs/backend/actions/README.md の `test_tag_baseline` に台帳として持ち、
 * 台帳に無い無印ファイル(= 新規追加)だけをエラーにする。台帳は免除ではなく
 * **未処理一覧**であり、新しい行を足すことは想定しない(消し込みのみ)。
 * 消し忘れ・実在しないファイルの宣言は warning で拾う(A10 の staleDecls と同型)。
 *
 * **注釈の位置もここで執行する**(独立レビュー 束 ㉑ の 2-B)。注釈は「テスト宣言の直前の
 * 行」に置く —— `it(...)` の**中**に書いても A6 / Z1 は受理するが、A16(注釈の中身)は
 * その形のブロックを切り出せず何も言えない。つまり**注釈を 1 行下げるだけで中身の検査を
 * 外せた**。位置は書式の一部であり、外れた位置は error にする(黙らせない)。
 *
 * **ひな形の注釈(`@tc-each`)の接地もここで見る。** ひな形は台帳のテスト名に当てて N 件の
 * 注釈に展開される(lib/trace/expand-each.ts)ので、**ひな形だけを書き換えれば突合を空に
 * できる** —— ループが実際に付けている `it` の名前と食い違うひな形は error にする。
 */

import type { Finding, TraceVerifier } from '../verifier.js';
import { traceFinding } from '../verifier.js';
import type { EachTagRef, HalfTagRef, TestAnnotation } from '../../testcase/types.js';
import type { TestTagBaselineDecl } from '../../model/trace/types.js';
import type { TraceInput } from '../input.js';
import { normalizeTemplate } from '../extract-annotations.js';

/** A12: 注釈の無いテストファイルが既知の台帳の外に増えていないか、片方だけの注釈が無いかを検証する。 */
export const untaggedTestsVerifier: TraceVerifier = {
  id: 'A12',
  title: '注釈の台帳 — 注釈なしのテストファイルは既知の未処理一覧に限る・片方だけの注釈は許さない',

  verify(input: TraceInput): Finding[] {
    // 実装がまだ無い(app/ を読めない)構成では判断材料が無い(A2 の実装側と同じ扱い)。
    if (!input.tests.available) return [];
    const tagged = new Set(input.tests.annotations.map((annotation) => annotation.file));
    const baseline = new Set(input.actions.testTagBaseline.map((decl) => decl.file));
    const findings: Finding[] = [];

    for (const file of input.tests.testFiles) {
      if (tagged.has(file) || baseline.has(file)) continue;
      findings.push(untaggedFinding(file));
    }
    findings.push(...(input.tests.halfTags ?? []).map(halfTagFinding));
    findings.push(
      ...input.tests.annotations
        .filter((annotation) => annotation.decorates === false)
        .map(misplacedFinding),
    );
    findings.push(...(input.tests.eachTags ?? []).flatMap(checkEachTag));
    findings.push(...staleBaseline(input, tagged));
    return findings;
  },
};

/**
 * テスト宣言の直前の行に無い注釈の Finding。
 *
 * 位置がずれた注釈は A16(注釈の中身)の視界から外れる —— 切り出せないブロックには
 * 何も言えないため、**assert を全部消しても緑**という、A16 が塞いだはずの形が復活する。
 */
function misplacedFinding(annotation: TestAnnotation): Finding {
  return traceFinding('A12', {
    message: `${annotation.file}:${annotation.line} の注釈(${annotation.tcId})がテスト宣言の直前の行にありません`,
    location: { file: annotation.file, pointer: `L${annotation.line}` },
    suggestion:
      '注釈は `it` / `test` の宣言の直前の行に置く(間に挟めるのはコード例の印 ' +
      '`// #region …` の行だけ)。位置がずれた注釈は A16 の視界から外れ、中身が空でも通る',
    counterexample: { file: annotation.file, line: String(annotation.line), tc: annotation.tcId },
  });
}

/**
 * ひな形とループの `it` の名前が合っているか(合っていなければ展開は絵に描いた餅である)。
 *
 * @param each ひな形 1 件
 * @returns 違反(合っていれば空)
 */
function checkEachTag(each: EachTagRef): Finding[] {
  const wanted = normalizeTemplate(each.template);
  if (each.loopName === wanted) return [];
  return [
    traceFinding('A12', {
      message:
        each.loopName === null
          ? `${each.file}:${each.line} の @tc-each の直後にテスト宣言がありません`
          : `${each.file}:${each.line} の @tc-each のひな形がループの it の名前と食い違います`,
      location: { file: each.file, pointer: `L${each.line}` },
      suggestion:
        'ひな形は直後のループが付ける `it` の名前そのものにする(穴は `{…}` で書く)。' +
        'ひな形だけを書き換えると、台帳のテスト名が当たらなくなって突合が静かに空になる',
      counterexample: {
        file: each.file,
        line: String(each.line),
        template: wanted,
        loop: each.loopName ?? '(テスト宣言が見つからない)',
      },
    }),
  ];
}

/** 台帳に無い無印ファイルの Finding。 */
function untaggedFinding(file: string): Finding {
  return traceFinding('A12', {
    message: `${file} は @tc の注釈を 1 つも持たないテストファイルです(未処理台帳にもありません)`,
    location: { file },
    suggestion:
      `テストに \`// @spec {仕様ID} @tc {テストケースID}\` の注釈を付け、対応する仕様の ` +
      `test_cases に宣言を足す(書式の正: action-spec-writing.md)。台帳(test_tag_baseline)は ` +
      `導入時点の未処理一覧であり、新しいファイルを足す場所ではない`,
    counterexample: { file },
  });
}

/**
 * 片方だけの注釈(`@spec` はあるが `@tc` が無い行)の Finding(テスト義務の全域化 決定 #3)。
 *
 * 注釈の名前空間は `@tc` 一本であり、`@spec` だけの行は突合キーを持たないので
 * どの検査の母集合にも現れない。書いた本人には「注釈を付けたつもり」に見えるため、
 * 沈黙ではなく直接エラーにする。
 */
function halfTagFinding(ref: HalfTagRef): Finding {
  return traceFinding('A12', {
    message: `${ref.file}:${ref.line} は @spec はあるが @tc がありません(片方だけの注釈)`,
    location: { file: ref.file, pointer: `L${ref.line}` },
    suggestion:
      '同じ行に "@tc {テストケースID}" を足して注釈を完成させる' +
      '(注釈は @spec と @tc が揃って初めて突合キーになる。書式の正: action-spec-writing.md)',
    counterexample: { file: ref.file, line: String(ref.line), spec: ref.specIds.join(' ') },
  });
}

/**
 * 用済み・矛盾した台帳の行を洗い出す(A10 の staleDecls と同型)。
 *
 * 注釈が付いたのに行が残っている / 実在しないファイルを指している、の 2 つ。
 * どちらも検査の穴ではなく消し込み漏れなので warning にする。
 */
function staleBaseline(input: TraceInput, tagged: ReadonlySet<string>): Finding[] {
  const existing = new Set(input.tests.testFiles);
  const findings: Finding[] = [];

  for (const decl of input.actions.testTagBaseline) {
    if (!existing.has(decl.file)) {
      findings.push(staleFinding(decl, `${decl.file} は存在しないテストファイルです`, '行を削除する(ファイルを移動したなら宣言を追随させる)'));
    } else if (tagged.has(decl.file)) {
      findings.push(staleFinding(decl, `${decl.file} には注釈が付いたのに test_tag_baseline に行が残っています`, '消し込み(行の削除)をする'));
    }
  }
  return findings;
}

/** 台帳の消し込み漏れの Finding(warning)。 */
function staleFinding(decl: TestTagBaselineDecl, message: string, action: string): Finding {
  return traceFinding('A12', {
    severity: 'warning',
    message,
    location: decl.location,
    suggestion: `specs/backend/actions/README.md の test_tag_baseline から${action}`,
    counterexample: { file: decl.file },
  });
}

/**
 * Z3 の一部: 仕組みの根の注釈の**形**(片方だけの注釈・注釈の位置・ひな形とループの食い違い)。
 *
 * 製品の木の注釈の形は A12 が見る。同じ規則を仕組みの根の注釈にも当てるための写しで、規則の根拠は A12 の冒頭が正である
 * (位置がずれた注釈は A16 の視界から外れる・ひな形だけを書き換えると突合が静かに空になる)。
 */

import { makeFinding, type Finding } from '../../kernel/finding.js';
import type { EachTagRef, HalfTagRef, TestAnnotation } from '../../testcase/types.js';
import type { FrameworkScan } from '../../testcase/index.js';
import { normalizeTemplate } from '../../trace/extract-annotations.js';

const VERIFIER_ID = 'Z3';

/**
 * 仕組みの根の走査の注釈の形の違反を集める。
 *
 * @param scan 仕組みの根の走査
 * @returns 違反のリスト
 */
export function annotationShapeFindings(scan: FrameworkScan): Finding[] {
  return [
    ...(scan.halfTags ?? []).map(halfTagFinding),
    ...scan.annotations.filter((annotation) => annotation.decorates === false).map(misplacedFinding),
    ...(scan.eachTags ?? []).flatMap(eachTagFinding),
  ];
}

function halfTagFinding(ref: HalfTagRef): Finding {
  return makeFinding(VERIFIER_ID, {
    message: `${ref.file}:${ref.line} は @spec はあるが @tc がありません(片方だけの注釈)`,
    location: { file: ref.file, pointer: `L${ref.line}` },
    suggestion: '同じ行に "@tc {テストケースID}" を足して注釈を完成させる(注釈は @spec と @tc が揃って初めて突合キーになる)',
    counterexample: { file: ref.file, line: String(ref.line), spec: ref.specIds.join(' ') },
  });
}

function misplacedFinding(annotation: TestAnnotation): Finding {
  return makeFinding(VERIFIER_ID, {
    message: `${annotation.file}:${annotation.line} の注釈(${annotation.tcId})がテスト宣言の直前の行にありません`,
    location: { file: annotation.file, pointer: `L${annotation.line}` },
    suggestion:
      '注釈は `it` / `test` の宣言の直前の行に置く(間に挟めるのはコード例の印 `// #region …` の行だけ)。' +
      '位置がずれた注釈は注釈の中身の検査の視界から外れ、中身が空でも通る',
    counterexample: { file: annotation.file, line: String(annotation.line), tc: annotation.tcId },
  });
}

function eachTagFinding(each: EachTagRef): Finding[] {
  const wanted = normalizeTemplate(each.template);
  if (each.loopName === wanted) return [];
  return [
    makeFinding(VERIFIER_ID, {
      message:
        each.loopName === null
          ? `${each.file}:${each.line} の @tc-each の直後にテスト宣言がありません`
          : `${each.file}:${each.line} の @tc-each のひな形がループの it の名前と食い違います`,
      location: { file: each.file, pointer: `L${each.line}` },
      suggestion: 'ひな形は直後のループが付ける `it` の名前そのものにする(穴は `{…}` で書く)',
      counterexample: {
        file: each.file,
        line: String(each.line),
        template: wanted,
        loop: each.loopName ?? '(テスト宣言が見つからない)',
      },
    }),
  ];
}

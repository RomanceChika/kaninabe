/**
 * M4 リンク切れチェック。
 *
 * 本文の相対リンクが実在するファイルを指しているかを見る。
 * ルール文書は「上位の正典へ辿れること」が価値なので、リンク切れは
 * 読み手(人間・AI)をそこで行き止まりにする実害がある。
 *
 * 実在判定そのものはローダーが済ませてあり(検証器は fs に触れない)、
 * ここは Finding の組み立てだけを行う。
 * **見る範囲は CLAUDE.md と docs/ の下の全部の .md**(フロントマターの有無を問わない。`model.linked`)。
 * 走査対象からの除外(外部 URL・コード・AUTO-GENERATED ブロック)は
 * markdown-links(構文木)/ link-scan の責務。
 */

import type { DocVerifier, Finding } from '../verifier.js';
import { docFinding } from '../verifier.js';
import type { DocsModel, LinkedFile } from '../../model/docs/types.js';

/** M4: 本文の相対リンクが解決できることを検証する。 */
export const markdownLinkVerifier: DocVerifier = {
  id: 'M4',
  title: 'リンク切れ — 本文の相対リンクが実在するファイルを指す',

  verify(model: DocsModel): Finding[] {
    return model.linked.flatMap(checkFile);
  },
};

/** 1 ファイルのリンクを検査する。 */
function checkFile(doc: LinkedFile): Finding[] {
  return doc.links
    .filter((link) => !link.exists)
    .map((link) =>
      docFinding('M4', {
        message: `リンク先が見つかりません: ${link.href}`,
        location: { file: doc.file, pointer: `L${link.line}` },
        suggestion:
          'リンク先のパスを実在するファイルに直す。移動済みなら新しい場所へ、廃止済みならリンクごと外す',
        counterexample: { href: link.href, resolved: link.target, line: String(link.line) },
      }),
    );
}

/**
 * `kind` の語の `declares`(その語の行が必ず持つキー)と行のキーの有無の**対**を見る共通部品。
 *
 * 機械が読む軸が「キーの有無」(`anonymizes` / `emits`)であるものについて、語(呼び名)はカタログが宣言し
 * 体系は比べない。語の側が「この語の行は {キー} を必ず持つ」と宣言するので、**語を選んで書き忘れた行**
 * (そのキーを持つ行が他に 1 つも無くても)も、**キーを持つのに宣言の無い語を選んだ行**も落ちる。
 * どのキーを見るか・指摘の文面は検証器ごとに違う(匿名化は J5・積む通知は J2)ので、ここは**ずれの検出だけ**を
 * 持ち、文面は呼び出し側が組む。
 */

import type { JobCatalogSpec, JobDeclarableKey, JobDecl } from '../model/job/types.js';

/** 語と行のずれ 1 件。 */
export interface DeclaresMismatch {
  readonly decl: JobDecl;
  /** `missing` = 宣言した語を選んだのにキーが無い / `undeclared` = キーを持つのに宣言の無い語を選んだ。 */
  readonly problem: 'missing' | 'undeclared';
}

/**
 * 語の `declares` と行のキーの有無が食い違う行を集める。
 *
 * @param catalog 読み込み済みのジョブカタログ
 * @param key 見るキー
 * @param hasKey 行がそのキーを持つか
 * @returns ずれた行(宣言順)
 */
export function declaresMismatches(
  catalog: JobCatalogSpec,
  key: JobDeclarableKey,
  hasKey: (decl: JobDecl) => boolean,
): readonly DeclaresMismatch[] {
  const declaring = new Set(
    catalog.vocabulary.kind.filter((term) => term.declares?.includes(key) === true).map((term) => term.id),
  );
  return catalog.jobs.flatMap((decl): DeclaresMismatch[] => {
    const declared = declaring.has(decl.kind);
    const has = hasKey(decl);
    if (declared && !has) return [{ decl, problem: 'missing' }];
    if (!declared && has) return [{ decl, problem: 'undeclared' }];
    return [];
  });
}

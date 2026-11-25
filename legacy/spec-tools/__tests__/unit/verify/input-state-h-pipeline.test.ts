/**
 * 画面・通知・認証フロー・ユースケースの検査が他の種類から引く材料(読み取りクエリ・ユースケース・ジョブ・画面)の入力の状態(束 入力の状態-h)を、
 * **実ローダー・実パイプラインを通して**確かめる。
 *
 *   - 阻害(採ったのに読めない)は、読む検査ごとに「<種類> を採っているが検査へ渡せない」と名指す。欠けたモデルで「無い」と言う判定は出さない
 *   - 読込済み(題材そのまま)は何も言わない。未選択(採っていない)は事実として無い。黙る
 *
 * 行の書き方・表の整合は `verify/operation-input-notes.test.ts`、検査器ごとの保留は各検査器のテスト、読み手の全数は `foreign-readers.test.ts` が見る。
 * 実パイプライン(Z3 を使う)を回すのは 8 回(共有部品 `helpers/stores-pipeline.ts` の注意: Z3 は隔離した worker で、回数の上限は無い)。
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ALL, BROKEN, breakFile, findingsOf, removeDir, removeTrees, rowsOf, verifyTree, without } from '../../helpers/stores-pipeline.js';

afterEach(removeTrees);

/** この束が名指す検査(ID 順)。 */
const IDS = ['H2', 'H4', 'J2', 'N1', 'N2', 'S2', 'S4', 'S8', 'S12', 'S14', 'S16', 'S18', 'S19', 'Y1'] as const;

/** 行の頭の検査 ID。 */
const idOf = (row: string): string => row.slice(0, row.indexOf(':'));

/** 行のうち、指した種類を阻害として名指すもの。 */
const naming = (rows: readonly string[], kind: string): string[] => rows.filter((row) => row.includes(`阻害 — ${kind} を採っているが検査へ渡せない(`));

/** 置き場に壊れた仕様を 1 枚足す(読めずに落とした 1 枚 = 阻害)。 */
const addBroken =
  (...segments: string[]) =>
  (specs: string): void =>
    writeFileSync(path.join(specs, ...segments), BROKEN);

describe('題材そのまま(全部読込済み)は、この束の行を出さない', () => {
  it('H2 / H4 / J2 / N1 / N2 / S2〜S19 / Y1 の阻害の行が 1 つも出ない', async () => {
    const result = await verifyTree(ALL);

    expect(rowsOf(result.lines, IDS)).toEqual([]);
  });
});

describe('読み取りクエリが阻害', () => {
  it('壊れた query_spec が 1 枚あれば、reads の指す読みを引く検査が「queries を採っているが検査へ渡せない」と名指し、判定は出さない', async () => {
    const result = await verifyTree(ALL, addBroken('backend', 'queries', 'store', 'broken.md'));

    expect(naming(rowsOf(result.lines, IDS), 'queries').map(idOf)).toEqual(['S2', 'S4', 'S8', 'S14', 'S18', 'S19']);
    // S12 は、読めて仕様を落としただけの阻害では欠けた読みを否定できない側に倒して実行済みなので、行を出さず、判定も出ない(置き場ごと無い阻害は下)
    for (const id of ['S2', 'S4', 'S12', 'S14', 'S18', 'S19']) expect(findingsOf(result.findings, id)).toEqual([]);
  });

  it('読めずに落とした仕様が 1 枚(既存の 1 枚を壊す): 画面の reads が指す読みは「無い」ではなく「分からない」。S2 が偽の error を出さない', async () => {
    const result = await verifyTree(ALL, breakFile('backend', 'queries', 'store', 'store_list.md'));

    expect(naming(rowsOf(result.lines, IDS), 'queries').map(idOf)).toEqual(['S2', 'S4', 'S8', 'S14', 'S18', 'S19']);
    expect(findingsOf(result.findings, 'S2').filter((finding) => finding.message.includes('対応する query_spec がありません'))).toEqual([]);
  });

  it('置き場そのものが無い(採ったのに読めない = モデルが渡らない): S12 は実行されないので、他の検査と同じく行で名指す。偽の error は出ない', async () => {
    const result = await verifyTree(ALL, removeDir('backend', 'queries'));

    // 読めずに落とした仕様(上の 2 本)と違い、S12 では否定できない側へ寄せる分岐に届かず、実行されない。行が無いと「実行済みで指摘なし」と区別できない
    expect(naming(rowsOf(result.lines, IDS), 'queries').map(idOf)).toEqual(['S2', 'S4', 'S8', 'S12', 'S14', 'S18', 'S19']);
    for (const id of ['S2', 'S12']) expect(findingsOf(result.findings, id)).toEqual([]);
  });
});

describe('ユースケース仕様が阻害', () => {
  it('壊れた usecase_spec が 1 枚あれば、保存点を引く S16 が「usecases を採っているが検査へ渡せない」と名指し、判定は出さない', async () => {
    const result = await verifyTree(ALL, addBroken('frontend', 'usecases', 'broken.md'));

    expect(naming(rowsOf(result.lines, IDS), 'usecases').map(idOf)).toEqual(['S16']);
    expect(findingsOf(result.findings, 'S16')).toEqual([]);
  });
});

describe('ジョブカタログが阻害', () => {
  it('ジョブカタログが読めない: 走査の emits を引く N1 / N2 が「jobs を採っているが検査へ渡せない」と名指し、「emits がありません」と言わない', async () => {
    const result = await verifyTree(ALL, breakFile('backend', 'jobs.md'));

    // S19 は確認の要否の導出が読むカタログとしてのジョブ(従来の入力の状態-g)。ここで見るのは N1 / N2 が加わっていること。
    expect(naming(rowsOf(result.lines, IDS), 'jobs').map(idOf)).toEqual(['N1', 'N2', 'S19']);
    expect(findingsOf(result.findings, 'N1').filter((finding) => finding.message.includes('emits がありません'))).toEqual([]);
  });
});

describe('画面が阻害', () => {
  it('壊れた画面が 1 枚ある: 着地・関門の送り先を引く H2 / H4、入口の衝突を引く J2、start を引く Y1 が screens を名指し、判定は出さない', async () => {
    const result = await verifyTree(ALL, addBroken('frontend', 'screens', 'store', 'broken.md'));

    // S16 は画面の到達を読む検査(従来の画面の到達の入力の状態)。ここで見るのは H2 / H4 / J2 / Y1 が screens を名指していること。
    expect(naming(rowsOf(result.lines, IDS), 'screens').map(idOf).sort()).toEqual(['H2', 'H4', 'J2', 'S16', 'Y1']);
    for (const id of ['H2', 'H4', 'Y1']) expect(findingsOf(result.findings, id)).toEqual([]);
  });
});

describe('採っていない種類は事実として無い(黙る)', () => {
  it('読み取りクエリ・ユースケース・ジョブを採らない宣言(置き場に仕様が残っていても)では、それらを名指す行は出ない', async () => {
    const result = await verifyTree(without('queries', 'usecases', 'jobs'));

    const rows = rowsOf(result.lines, IDS);
    for (const kind of ['queries', 'usecases', 'jobs']) expect(naming(rows, kind)).toEqual([]);
  });
});

/**
 * 画面・UX・ユースケース・ジョブの検査が他の種類から引く材料(action_spec・確認の要否の導出が読むカタログ・ジョブが読む画面・関門)の
 * 入力の状態(束 入力の状態-g)を、**実ローダー・実パイプラインを通して**確かめる。
 *
 *   - 阻害(採ったのに読めない)は、読む検査ごとに「<種類> を採っているが検査へ渡せない」と名指す。判定を保留する検査は判定を出さない
 *   - 読込済み(題材そのまま)は何も言わない。未選択(採っていない)は事実として無い。黙る
 *
 * 行の書き方・表の整合は `verify/operation-input-notes.test.ts`、検査器ごとの保留は各検査器のテストが見る。
 * 実パイプライン(Z3 を使う)を回すのは 9 回(共有部品 `helpers/stores-pipeline.ts` の注意: Z3 は隔離した worker で、回数の上限は無い)。
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ALL, BROKEN, breakFile, findingsOf, removeTrees, rowsOf, verifyTree, without } from '../../helpers/stores-pipeline.js';

afterEach(removeTrees);

/** この束が名指す検査(ID 順)。 */
const IDS = ['J2', 'S14', 'S15', 'S17', 'S18', 'S19', 'U1', 'Y2', 'Y5', 'Y8', 'Y10', 'Y12'] as const;

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
  it('J2 / S14 / S15 / S17〜S19 / U1 / Y2 / Y5 / Y8 / Y10 / Y12 の阻害の行が 1 つも出ない', async () => {
    const result = await verifyTree(ALL);

    expect(rowsOf(result.lines, IDS)).toEqual([]);
  });
});

describe('action_spec が阻害', () => {
  it('壊れた action_spec が 1 枚あれば、action_spec を引く検査が「actions を採っているが検査へ渡せない」と名指し、判定は出さない', async () => {
    const result = await verifyTree(ALL, addBroken('backend', 'actions', 'sales_order', 'broken.md'));

    const rows = naming(rowsOf(result.lines, IDS), 'actions');
    expect(rows.map(idOf)).toEqual(['J2', 'S17', 'S18', 'S19', 'U1', 'Y2', 'Y5', 'Y8', 'Y10', 'Y12']);
    // 保留した検査は、仕様が読めても判定を出さない(読めない入力から「ある / ない」を導かない)。
    for (const id of ['Y2', 'Y8', 'Y10', 'Y12', 'U1']) expect(findingsOf(result.findings, id)).toEqual([]);
  });
});

describe('確認の要否の導出が読むカタログが阻害', () => {
  it('通知カタログが読めない: S19 / U1 / Y5 が「notifications を採っているが検査へ渡せない」と名指す', async () => {
    const result = await verifyTree(ALL, breakFile('backend', 'notifications.md'));

    expect(naming(rowsOf(result.lines, IDS), 'notifications').map(idOf)).toEqual(['S19', 'U1', 'Y5']);
  });

  it('ジョブカタログが読めない: S19 / U1 / Y5 が「jobs を採っているが検査へ渡せない」と名指す', async () => {
    const result = await verifyTree(ALL, breakFile('backend', 'jobs.md'));

    expect(naming(rowsOf(result.lines, IDS), 'jobs').map(idOf)).toEqual(['S19', 'U1', 'Y5']);
  });

  it('テーブル仕様が読めない(置き場の表の 1 枚が壊れている): S19 / U1 / Y5 が data_tables を名指す', async () => {
    const result = await verifyTree(ALL, addBroken('backend', 'data', 'tables', 'broken.md'));

    expect(naming(rowsOf(result.lines, IDS), 'data_tables').map(idOf).sort()).toEqual(['S19', 'U1', 'Y10', 'Y12', 'Y5', 'Y8']);
  });
});

describe('関門(auth)と画面が阻害', () => {
  it('認証フロー仕様が読めない: 関門に依る S14 / S15 を含め、画面の到達を読む検査が「auth を採っているが検査へ渡せない」と名指す', async () => {
    const result = await verifyTree(ALL, breakFile('backend', 'auth.md'));

    expect(naming(rowsOf(result.lines, ['S13', 'S14', 'S15', 'S16', 'Y3', 'Y5']), 'auth').map(idOf)).toEqual(['S13', 'S14', 'S15', 'S16', 'Y3', 'Y5']);
    expect(findingsOf(result.findings, 'S14')).toEqual([]);
  });

  it('壊れた画面が 1 枚ある: ジョブが読む画面の route が見られないので J2 が screens を名指す(関門に依る S14 / S15 は言わない)', async () => {
    const result = await verifyTree(ALL, addBroken('frontend', 'screens', 'store', 'broken.md'));

    const rows = rowsOf(result.lines, IDS);
    // J2 の行はこの束、Y5 の行は画面の到達の入力(従来)。関門に依る S14 / S15 は、画面の欠けでは言わない。
    expect(naming(rows, 'screens').map(idOf).sort()).toEqual(['J2', 'Y5']);
    expect(rows.some((row) => /^S1[45]:/.test(row))).toBe(false);
  });
});

describe('採っていない種類は事実として無い(黙る)', () => {
  it('通知・ジョブを採らない宣言(置き場に仕様が残っていても)では、それらを名指す行は出ない', async () => {
    const result = await verifyTree(without('notifications', 'jobs'));

    const rows = rowsOf(result.lines, IDS);
    expect(naming(rows, 'notifications')).toEqual([]);
    expect(naming(rows, 'jobs')).toEqual([]);
  });
});

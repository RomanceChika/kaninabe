/**
 * 入力の状態を報告する検査の実行ログ 1 行(未実施 / 阻害)と、サマリへの数え入れのテスト。
 *
 * 実行した検査は言わない(群の要約行が言う)。言うのは範囲が縮んだものだけで、その行は
 * 「範囲を実行していません」の件数(skip-notes)に入る。
 */

import { describe, expect, it } from 'vitest';
import type { BlockedReason, CheckRun } from '../../../lib/kernel/input-state.js';
import { describeCheckRun, describeGapNotes, describeInputGap, describeInputGapNote, describeJobScopeNotes, describeMissingTarget, describeNotApplicableTarget, describeUnreadable, describeUnusableInput, isCheckRunNote } from '../../../lib/verify/check-run-report.js';
import { JOB_CHECK_SLOTS } from '../../../lib/job/target-checks.js';
import { collectSkipNotes, isSkipNote } from '../../../lib/verify/skip-notes.js';

const skipped: CheckRun = { status: 'skipped', reason: 'unselected', loaderFindings: [], verifierFindings: [] };
const executed: CheckRun = { status: 'executed', loaderFindings: [], verifierFindings: [] };
const blocked = (reason: BlockedReason): CheckRun => ({ status: 'blocked', reason, loaderFindings: [], verifierFindings: [] });

describe('describeCheckRun', () => {
  it('未実施は、採っていない種類を名指しして理由を言う', () => {
    expect(describeCheckRun({ id: 'A13', kind: 'jobs', run: skipped })).toBe(
      'A13: 未実施 — 製品が jobs を採っていない(product.md の uses に無い)。',
    );
  });

  it.each([
    ['not-loaded', '読み込みが行われていない'],
    ['missing', '置き場に仕様が無い'],
    ['load-failed', '読めない・壊れている'],
    ['invalid', '読めなかった仕様があってモデルが欠けている、または欠けていないと言えない'],
  ] as const)('阻害(%s)は理由を言い、原因の error が別にあることを案内する', (reason, text) => {
    const line = describeCheckRun({ id: 'A13', kind: 'jobs', run: blocked(reason) });

    expect(line).toContain(`A13: 阻害 — jobs を採っているが検査へ渡せない(${text}。`);
    expect(line).toContain('P 群が出している');
  });

  it('実行した検査は何も言わない(0 件の実行も)', () => {
    expect(describeCheckRun({ id: 'A13', kind: 'jobs', run: executed })).toBeNull();
  });
});

describe('サマリへの数え入れ', () => {
  it('未実施 / 阻害の行は、「スキップ」の語が無くても範囲が縮んだ報告として数える', () => {
    const notes = [
      describeCheckRun({ id: 'A13', kind: 'jobs', run: skipped }),
      describeCheckRun({ id: 'A13', kind: 'jobs', run: blocked('missing') }),
    ];

    for (const note of notes) {
      expect(note).not.toBeNull();
      expect(isCheckRunNote(note ?? '')).toBe(true);
      expect(isSkipNote(note ?? '')).toBe(true);
    }
  });

  it('群の検査の範囲を ID にした行(`T1〜T18: 阻害 — …`)も、範囲が縮んだ報告として数える(範囲の形でない散文は数えない)', () => {
    const note = describeInputGap('T1〜T18', { input: 'data_tables', state: 'blocked', reason: 'missing' }, 'テーブル仕様の検査(T1〜T18)は見ていません');

    expect(note.startsWith('T1〜T18: 阻害 — ')).toBe(true);
    expect(isCheckRunNote(note)).toBe(true);
    expect(isSkipNote(note)).toBe(true);
    expect(isCheckRunNote('テーブル仕様 T1〜T18: 阻害 — と書いた散文')).toBe(false);
  });

  it('文中に語が出るだけの行は数えない(行の頭の形で判定する)', () => {
    expect(isCheckRunNote('A 群: 検査 A13 は未実施 — と書いた散文')).toBe(false);
    expect(isSkipNote('J 群(ジョブ仕様): ジョブ 40 件に対し J1〜J7 を実行しました。')).toBe(false);
  });

  it('collectSkipNotes は素通ししつつ、未実施 / 阻害の行も貯める', () => {
    const passed: string[] = [];
    const collector = collectSkipNotes((line) => passed.push(line));

    collector.log('A13: 未実施 — 製品が jobs を採っていない(product.md の uses に無い)。');
    collector.log('J 群(ジョブ仕様): ジョブ 1 件に対し J1〜J7 を実行しました。');

    expect(passed).toHaveLength(2);
    expect(collector.notes).toEqual(['A13: 未実施 — 製品が jobs を採っていない(product.md の uses に無い)。']);
  });
});

describe('describeInputGap(検査の入力のうち 1 つが使えなかったとき)', () => {
  const consequence = 'queries から導く索引の要求は見ていません(ほかの入力から導く要求は実行済み)';

  it('未選択は未実施の語で、採っていない種類と見ていないことを言う', () => {
    expect(describeInputGap('T2', { input: 'queries', state: 'unselected' }, consequence)).toBe(
      'T2: 未実施 — 製品が queries を採っていない(product.md の uses に無い)ため、queries から導く索引の要求は見ていません(ほかの入力から導く要求は実行済み)。',
    );
  });

  it.each([
    ['not-loaded', '読み込みが行われていない'],
    ['missing', '置き場に仕様が無い'],
    ['load-failed', '読めない・壊れている'],
    ['invalid', '読めなかった仕様があってモデルが欠けている、または欠けていないと言えない'],
  ] as const)('阻害(%s)は理由を言い、原因の error が別にあることを案内する', (reason, text) => {
    const line = describeInputGap('T2', { input: 'queries', state: 'blocked', reason }, consequence);

    expect(line).toContain(`T2: 阻害 — queries を採っているが検査へ渡せない(${text}。`);
    expect(line).toContain('P 群が出している)ため、queries から導く索引の要求は見ていません');
  });

  it('どちらの行も、サマリの「範囲を実行していません」の件数に入る', () => {
    for (const gap of [{ input: 'queries', state: 'unselected' }, { input: 'data_tables', state: 'blocked', reason: 'missing' }] as const) {
      expect(isSkipNote(describeInputGap('T2', gap, consequence))).toBe(true);
    }
  });
});

describe('describeUnusableInput(行と群の要約行が共有する、使えなかった入力の事情)', () => {
  it('未選択は「採っていない」、阻害は「採っているが渡せない」と理由を言う。describeInputGap の行の前半と同じ言い方', () => {
    const unselected = { input: 'actions', state: 'unselected' } as const;
    const blocked = { input: 'actions', state: 'blocked', reason: 'missing' } as const;

    expect(describeUnusableInput(unselected)).toBe('製品が actions を採っていない(product.md の uses に無い)');
    expect(describeUnusableInput(blocked)).toBe(
      'actions を採っているが検査へ渡せない(置き場に仕様が無い。原因の error は各種類の読み込みの診断と P 群が出している)',
    );
    expect(describeInputGap('A1', unselected)).toBe(`A1: 未実施 — ${describeUnusableInput(unselected)}。`);
    expect(describeInputGap('A1', blocked, '見ていません')).toBe(`A1: 阻害 — ${describeUnusableInput(blocked)}ため、見ていません。`);
  });
});

describe('行の書き方は describeInputGap の 1 本(A13 の形・T2 の形・関係の層の gaps の形)', () => {
  it('見ていないこと(consequence)を省くと、検査全体が止まった形(A13 の行)と同じ文面になる', () => {
    expect(describeInputGap('A13', { input: 'jobs', state: 'unselected' })).toBe(
      describeCheckRun({ id: 'A13', kind: 'jobs', run: skipped }),
    );
    for (const reason of ['not-loaded', 'missing', 'load-failed', 'invalid'] as const) {
      expect(describeInputGap('A13', { input: 'jobs', state: 'blocked', reason })).toBe(
        describeCheckRun({ id: 'A13', kind: 'jobs', run: blocked(reason) }),
      );
    }
  });

  it('見ていないことを添えると、同じ行の末尾に「ため、…」が付く(T2 の形)', () => {
    const base = describeInputGap('S13', { input: 'screens', state: 'unselected' });

    expect(describeInputGap('S13', { input: 'screens', state: 'unselected' }, '到達は見ていません')).toBe(
      `${base.slice(0, -1)}ため、到達は見ていません。`,
    );
  });
});

describe('describeGapNotes(関係の層の gaps を、読む検査ごとの行にする)', () => {
  const dependents = [
    { id: 'S13', consequence: '到達は見ていません' },
    { id: 'Y3', consequence: '起点からの到達は見ていません' },
  ];

  it('欠けが無ければ行は出ない', () => {
    expect(describeGapNotes([], dependents)).toEqual([]);
  });

  it('欠けがあれば、読む検査ごとに 1 行(検査の順)・どれも範囲が縮んだ報告として数える', () => {
    const notes = describeGapNotes([{ input: 'screens', state: 'blocked', reason: 'missing' }], dependents);

    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain('S13: 阻害 — screens を採っているが検査へ渡せない(置き場に仕様が無い');
    expect(notes[1]).toContain('Y3: 阻害 — screens を採っているが検査へ渡せない');
    expect(notes.every((note) => isSkipNote(note))).toBe(true);
  });

  it('欠けが複数あれば、検査ごとに欠けの数だけ並ぶ', () => {
    const notes = describeGapNotes(
      [
        { input: 'screens', state: 'unselected' },
        { input: 'usecases', state: 'unselected' },
      ],
      dependents,
    );

    expect(notes.map((note) => note.slice(0, 3))).toEqual(['S13', 'S13', 'Y3:', 'Y3:']);
  });
});

describe('describeInputGapNote(検査の gaps の 1 件を、理由つきの 1 行にする)', () => {
  const gap = { input: 'data_tables', state: 'blocked', reason: 'invalid' } as const;
  const consequence = 'computes の材料が実行計画に届くかは見ていません';

  it('対象が無ければ describeInputGap と同じ行になる(書き方は 1 本)', () => {
    expect(describeInputGapNote('A19', { gap, consequence })).toBe(describeInputGap('A19', gap, consequence));
    expect(describeInputGapNote('A19', { gap, consequence, subjects: [] })).toBe(describeInputGap('A19', gap, consequence));
  });

  it('対象を名指せるときは、文末に件数と名前を足す。5 件を超えたぶんは件数だけ言う', () => {
    const line = describeInputGapNote('A19', { gap, consequence, subjects: ['a.x', 'b.y'] });
    const base = describeInputGap('A19', gap, consequence);

    expect(line).toBe(`${base.slice(0, -1)}(対象 2 件: a.x・b.y)。`);
    const many = describeInputGapNote('A19', { gap, consequence, subjects: ['1', '2', '3', '4', '5', '6', '7'] });
    expect(many).toContain('(対象 7 件: 1・2・3・4・5 ほか 2 件)。');
  });

  it('未選択も阻害も、範囲が縮んだ報告として数える', () => {
    for (const note of [
      { gap, consequence, subjects: ['a.x'] },
      { gap: { input: 'data_tables', state: 'unselected' } as const, consequence },
    ]) {
      expect(isSkipNote(describeInputGapNote('A15', note))).toBe(true);
    }
  });
});

describe('describeMissingTarget(後段が受け持つ検査の口が埋まっていない)', () => {
  it('「ID: 未実施 — <役割>の後段がこの構成に無いため、見ていないこと」の形(他の未実施の行と同じ頭)。後段の名前は書かない', () => {
    const lines = JOB_CHECK_SLOTS.map((slot) => describeMissingTarget(slot, true));
    expect(lines).toEqual([
      'J2: 未実施 — ホストの後段がこの構成に無いため、Cron の登録とカタログの双方向の突合は見ていません(実装・起動口・fires・due_from の接地と、HTTP の入口(起動口・受信口・認証の callback・送信の連携の口)の衝突と閉世界の検査は実行済み)。',
      'J3: 未実施 — プラットフォームの後段がこの構成に無いため、DB 内のスケジューラの登録とカタログの双方向の突合は見ていません。',
      'J4: 未実施 — ホストの後段がこの構成に無いため、ホストの Cron の頻度制約の突合は見ていません。',
    ]);
    for (const line of lines) {
      expect(isCheckRunNote(line), line).toBe(true);
      expect(isSkipNote(line), line).toBe(true);
    }
  });

  it('その役割の後段は選ばれているが口を登録していないときは、後段の名前を挙げて「登録していない」と言う(「この構成に無い」とは言わない)', () => {
    const [, j3] = JOB_CHECK_SLOTS;
    if (j3 === undefined) throw new Error('口の表に J3 が無い');
    const line = describeMissingTarget({ ...j3, selectedTarget: 'plat' }, true);
    expect(line).toBe('J3: 未実施 — プラットフォームの後段 plat がこの検査を登録していないため、DB 内のスケジューラの登録とカタログの双方向の突合は見ていません。');
    expect(line).not.toContain('この構成に無い');
    expect(isSkipNote(line)).toBe(true);
  });

  it('後段が無くても動く部分が無い口は、その但し書きを付けない', () => {
    const [, j3] = JOB_CHECK_SLOTS;
    expect(j3 === undefined ? '' : describeMissingTarget(j3, true)).not.toContain('(');
  });

  it('後段が無くても動く部分がある口(J2)は、実装の木があるときだけ「実装・起動口」の接地を実行済みと言う', () => {
    const [j2] = JOB_CHECK_SLOTS;
    if (j2 === undefined) throw new Error('口の表に J2 が無い');
    expect(describeMissingTarget(j2, true)).toContain('(実装・起動口・fires・due_from の接地と、HTTP の入口(起動口・受信口・認証の callback・送信の連携の口)の衝突と閉世界の検査は実行済み)');
    expect(describeMissingTarget(j2, false)).toContain('(fires・due_from の接地は実行済み。HTTP の入口の衝突と閉世界は実装の木が無いので見ていない)');
    expect(describeMissingTarget(j2, false)).not.toContain('実装・起動口');
  });
});

describe('describeNotApplicableTarget(後段が理由つきで対象外と宣言した口)', () => {
  it('「ID: 対象外 — …(理由: …)」の形。未実施とは別の語で、範囲サマリ(skip-notes)に数えない', () => {
    const j4 = JOB_CHECK_SLOTS[2];
    if (j4 === undefined) throw new Error('口の表に J4 が無い');
    const line = describeNotApplicableTarget({ ...j4, target: 'quiet-host', reason: '頻度の制約を持たないホスト' }, true);
    expect(line).toBe('J4: 対象外 — ホストの後段 quiet-host は、ホストの Cron の頻度制約の突合を対象外と宣言しています(理由: 頻度の制約を持たないホスト)。');
    expect(isCheckRunNote(line)).toBe(false);
    expect(isSkipNote(line)).toBe(false);
    expect(line).not.toContain('未実施');
  });

  it('後段が無くても動く部分がある口(J2)は、その部分も言う', () => {
    const [j2] = JOB_CHECK_SLOTS;
    if (j2 === undefined) throw new Error('口の表に J2 が無い');
    expect(describeNotApplicableTarget({ ...j2, target: 'h', reason: '理由' }, false)).toBe(
      'J2: 対象外 — ホストの後段 h は、Cron の登録とカタログの双方向の突合を対象外と宣言しています(理由: 理由)(fires・due_from の接地は実行済み。HTTP の入口の衝突と閉世界は実装の木が無いので見ていない)。',
    );
  });
});

describe('describeJobScopeNotes(J 群の見出しの但し書き)', () => {
  const [j2, j3, j4] = JOB_CHECK_SLOTS;
  if (j2 === undefined || j3 === undefined || j4 === undefined) throw new Error('口の表が J2 / J3 / J4 でない');

  it('縮んでいなければ空(全部入りの見出しは変わらない)', () => {
    expect(describeJobScopeNotes([], [])).toBe('');
  });

  it('一部は動く口は「<ID> は<言い方>のみ」・動かない口は「下の未実施」・対象外の口は「下の対象外」と言う', () => {
    expect(describeJobScopeNotes([j2, j3, j4], [])).toBe('(J2 は接地と入口の衝突・閉世界のみ。J3 / J4 は下の未実施)');
    expect(describeJobScopeNotes([j3], [{ ...j4, target: 'h', reason: 'r' }])).toBe('(J3 は下の未実施。J4 は下の対象外)');
    expect(describeJobScopeNotes([], [{ ...j2, target: 'h', reason: 'r' }])).toBe('(J2 は接地と入口の衝突・閉世界のみ)');
  });
});

describe('describeUnreadable(走査で読めなかった場所の阻害)', () => {
  it('読めなかった場所を名指しして、見ていないことを言う。語は阻害で、範囲サマリの件数に入る', () => {
    const line = describeUnreadable('J2', ['app/src/app', 'app/src/app/api/x'], '入口の閉世界は見ていません');

    expect(line).toBe('J2: 阻害 — app/src/app・app/src/app/api/x を読めなかったため、入口の閉世界は見ていません。');
    expect(isCheckRunNote(line)).toBe(true);
    expect(isSkipNote(line)).toBe(true);
  });

  it('名前を並べる上限(5 件)を超えたぶんは件数だけ言う', () => {
    const paths = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

    expect(describeUnreadable('J2', paths, '見ていません')).toBe('J2: 阻害 — a・b・c・d・e ほか 2 件 を読めなかったため、見ていません。');
  });
});

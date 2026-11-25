/**
 * 通知・ジョブ・認証・設定・保証・可視性の章(HTML の本の生成器 `book-html` が出す notifications.html ほか)のテスト。
 *
 * 小さなカタログから章を作り、行の数・4 枚の数・読めない形のときの縮退(例外を投げない)・手引きと同じ数え方を見る。
 * 本番の章の数の二重計上は dev-repo の `chapter-axiom-overlap.test.ts`(生成物の HTML)が見る。
 */

import { describe, expect, it } from 'vitest';
import { blockReadings, chapterReading } from '../../../../../lib/generate/render/book/block-reading.js';
import { GEN_CTX } from '../../../../helpers/generate-context.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';
import { bookChapterSections, pageText } from '../../../../helpers/book-html.js';
import { authBranch, authGate, authLanding, authModel, defaultAuthAxes } from '../../../../helpers/auth-builder.js';
import { configModel, configVariable } from '../../../../helpers/config-builder.js';
import { configValueLeaks } from '../../../../helpers/config-leak.js';
import { dataTableModel } from '../../../../helpers/data-builder.js';
import { guarantee, guaranteeModel } from '../../../../helpers/guarantee-builder.js';
import type { MutationReport } from '../../../../../lib/kernel/mutation-report.js';
import { jobModel, notScheduledJob, outboxJob, scheduledJob } from '../../../../helpers/job-builder.js';
import { notification, notificationModel } from '../../../../helpers/notification-builder.js';

/** 通知とジョブをそろえた文脈。 */
function ctxWith(): ReturnType<typeof bookCtx> {
  return {
    ...bookCtx(),
    notifications: notificationModel([notification('notify_a'), notification('notify_b', { trigger: 'manual', mention: 'none' })]),
    jobs: jobModel([
      outboxJob('notify_a'),
      scheduledJob('timed', { cron: '0 19 * * *', dueFrom: 'workshop.entry_deadline' }),
      scheduledJob('odd', { cron: '0 19 * * 1' }),
      notScheduledJob('later', '鍵が入るまで動かさない'),
    ]),
    humanFaceChapters: 'all',
  };
}

/** 章の識別子(読む量の集計が章を引く鍵。内部の識別子は `.md` の名のまま持つ)。 */
const identityOf = (file: string): string => file.replace(/\.html$/, '.md');

/** 章のページ。`content` は HTML の文書そのもの(属性・構造の検査用)、`text` はそれを読む字にしたもの(事実の検査用)。 */
function section(generate: () => readonly { content: string; file: string }[]): { content: string; text: string; file: string } {
  const found = generate()[0];
  if (found === undefined) throw new Error('セクションが生成されませんでした');
  return { ...found, text: pageText(found.content) };
}

describe('通知の章', () => {
  const ctx = ctxWith();
  const { content, text, file } = section(() => bookChapterSections(bookModel(), ctx, 'notifications.html'));

  it('docs/book/notifications.html を wholeFile で生成し、読めていない環境では何も生成しない', () => {
    expect(file).toBe('docs/book/notifications.html');
    expect(bookChapterSections(bookModel(), GEN_CTX, 'notifications.html')).toEqual([]);
  });

  it('通知 1 本・語 1 語が上段の 1 行。4 枚の数は本文の項目の数と一致し、構造の規則を守る', () => {
    // 通知 2 本 + 宛先の語 2 + メンションの語 1 = 5 本(`notificationCatalog` の語彙の既定)。
    expect(content).toContain('公理 5 本。通知 2 本、宛先の語 2、メンションの語 1');
  });

  it('手引きと同じ数え方: 章の必読(公理)は、カタログのブロックの公理の本数', () => {
    const sum = chapterReading(bookModel(), ctx, identityOf(file));
    const block = blockReadings(bookModel(), ctx).find((reading) => reading.file === 'docs/specs/backend/notifications.md');

    expect(sum.axioms).toBe(5);
    expect(block?.axioms).toBe(5);
    expect(text).toContain('業務 5 / 開発者 0');
  });

  it('テストの表の実装は、宣言した implementation.raw の文字列そのもの(構造体を文字列に埋めて `[object Object]` にしない)', () => {
    const declared = ctx.notifications?.catalog?.testCases.map((testCase) => testCase.implementation.raw) ?? [];

    expect(declared.length).toBeGreaterThan(0);
    for (const raw of declared) expect(text).toContain(raw);
    expect(text).not.toContain('[object Object]');
  });

  it('発火のしかた(auto / manual)を言い、発火元は下段の表に出す。理由を書く欄が無いことを言う', () => {
    expect(content).toContain('遷移のあとで自動');
    expect(content).toContain('人が送信を押したとき');
    expect(content).toContain('通知の仕様に、理由を書く欄は無い');
    expect(content).toContain('data-el="notification.source"');
  });

  it('カタログを読めていない(スキーマエラー)ときは、例外を投げず案内の 1 文だけを出す', () => {
    const broken = { ...ctx, notifications: { available: true, catalog: null } };
    const text = section(() => bookChapterSections(bookModel(), broken, 'notifications.html')).content;

    expect(text).toContain('まだ通知カタログを読めていない');
    expect(text).not.toContain('<Grid');
  });
});

describe('ジョブの章', () => {
  const ctx = ctxWith();
  const { content, text, file } = section(() => bookChapterSections(bookModel(), ctx, 'jobs.html'));

  it('docs/book/jobs.html を wholeFile で生成し、読めていない環境では何も生成しない', () => {
    expect(file).toBe('docs/book/jobs.html');
    expect(bookChapterSections(bookModel(), GEN_CTX, 'jobs.html')).toEqual([]);
  });

  it('時刻で起きるジョブは行、そのほかは表の行。失敗したときの語は 1 語 1 行。4 枚の数は本文と一致する', () => {
    // ジョブ 4 本のうち、通知を送る 1 本(notify_a。通知カタログに同じ ID)は数えない。3 本 + 失敗したときの語 2 = 5 本。
    expect(content).toContain('公理 5 本。ジョブ 3 本(時刻で起きるもの 3)、失敗したときの語 2');
  });

  it('通知を送るジョブは公理に数えず、通知の章へ案内して、下段の積む元の表に原文つきで畳む。手引きの数え方も同じ', () => {
    const sum = chapterReading(bookModel(), ctx, identityOf(file));
    const block = blockReadings(bookModel(), ctx).find((reading) => reading.file === 'docs/specs/backend/jobs.md');

    expect(text).toContain('通知を送るジョブ 1 本は、通知の章で読む');
    expect(content).toContain('href="./notifications.html"');
    expect(text).toContain('イベントなどで積まれるジョブ(0)');
    expect(content).not.toMatch(/<span class="bf-mono">notify_a<\/span> <span class="bf-mark bf-mark--axiom">/);
    expect(text).toContain('notify_a | notify_a の説明');
    expect(content).toContain('data-el="job.source"');
    expect(sum.axioms).toBe(5);
    expect(block?.axioms).toBe(5);
  });

  it('失敗したときの語は、その語を選んでいるジョブの数を機械が数えて添える(ジョブ全体のこととして言い切らない)', () => {
    expect(content).toContain('ジョブ 1 本(時刻で起きるもの 0・積まれるもの 1・うち通知を送るもの 1)');
    expect(content).toContain('ジョブ 3 本(時刻で起きるもの 3・積まれるもの 0)');
    expect(content).not.toContain('何度か試される');
  });

  it('通知カタログが読めていなければ、全ジョブを公理に数える(通知の章へ案内しない)', () => {
    const alone = section(() => bookChapterSections(bookModel(), { ...ctx, notifications: { available: true, catalog: null } }, 'jobs.html')).content;

    expect(alone).toContain('公理 6 本。ジョブ 4 本(時刻で起きるもの 3)、失敗したときの語 2');
    expect(alone).not.toContain('通知の章</a>で読む');
  });

  it('cron 式は読める形だけ人の時刻にする。読めない形は式だけを出す。登録がまだなら、そう言う', () => {
    expect(content.split('毎日 04:00(日本時間)')).toHaveLength(2);
    expect(content).toContain('0 19 * * 1');
    expect(content).toContain('まだ動いていない');
  });

  it('テストの表の実装は、宣言した implementation.raw の文字列そのもの(構造体を文字列に埋めて `[object Object]` にしない)', () => {
    const declared = ctx.jobs?.catalog?.testCases.map((testCase) => testCase.implementation.raw) ?? [];

    expect(declared.length).toBeGreaterThan(0);
    for (const raw of declared) expect(text).toContain(raw);
    expect(text).not.toContain('[object Object]');
  });

  it('時刻の登録をまだしていない理由は、理由つきの受け入れ 1 件になる(手引きと同じ数え方)。読み手は開発者', () => {
    const sum = chapterReading(bookModel(), ctx, identityOf(file));

    expect(sum.byReader.developer.reasoned).toBe(1);
    expect(sum.byReader.business.reasoned).toBe(0);
    expect(sum.reasoned).toBe(1);
    expect(content).toContain('鍵が入るまで動かさない');
    expect(text).toContain('受け入れ受け入れ\n1\n');
  });

  it('カタログを読めていないときは、例外を投げず案内の 1 文だけを出す', () => {
    const broken = { ...ctx, jobs: { available: true, catalog: null } };

    expect(section(() => bookChapterSections(bookModel(), broken, 'jobs.html')).content).toContain('まだジョブカタログを読めていない');
  });
});

describe('認証の章', () => {
  const ctx = {
    ...bookCtx(),
    auth: authModel({
      landings: [authLanding('active', { screen: 'screen-workshop-list' }), authLanding('guest', { variant: 'guest' })],
      branches: [
        authBranch('member_active', { values: { member: 'active' }, summary: '有効メンバーは通す' }),
        authBranch('guest_in_guild', { values: { member: 'guest', guild: 'joined' }, runs: ['membership.activate'], lands: 'active' }),
        authBranch('guest_waits', { values: { member: 'guest', guild: 'not_joined' }, lands: 'guest' }),
      ],
      gates: [authGate('session')],
    }),
  };
  const { content, text, file } = section(() => bookChapterSections(bookModel(), ctx, 'auth.html'));

  it('docs/book/auth.html を wholeFile で生成し、読めていない環境では何も生成しない', () => {
    expect(file).toBe('docs/book/auth.html');
    expect(bookChapterSections(bookModel(), GEN_CTX, 'auth.html')).toEqual([]);
  });

  it('条件の軸 1 本・分岐 1 行・着地 1 つ・関門 1 つが上段の 1 行。4 枚の数は本文の項目の数と一致し、構造の規則を守る', () => {
    expect(content).toContain('公理 9 本。条件の軸 3、分岐 3 行、着地 2、関門 1');
    expect((content.match(/data-el="auth\.condition"/g) ?? []).length).toBe(3);
    expect((content.match(/data-el="auth\.branch"/g) ?? []).length).toBe(3);
    expect((content.match(/data-el="auth\.landing"/g) ?? []).length).toBe(2);
    expect((content.match(/data-el="auth\.gate"/g) ?? []).length).toBe(1);
  });

  it('手引きと同じ数え方: 章の必読は認証フローのブロックの公理の本数。読み手は業務', () => {
    const sum = chapterReading(bookModel(), ctx, identityOf(file));
    const block = blockReadings(bookModel(), ctx).find((reading) => reading.file === 'docs/specs/backend/auth.md');

    expect(sum.axioms).toBe(9);
    expect(block?.axioms).toBe(9);
    expect(text).toContain('業務 9 / 開発者 0');
  });

  it('分岐の「どこへ」は着地の行へのリンクで、リンク先の行が章の中にある', () => {
    for (const landing of ['active', 'guest']) {
      expect(content).toContain(`id="landing-${landing}"`);
      expect(content).toContain(`href="#landing-${landing}"`);
    }
    expect(content).toContain('この着地に着く分岐は 2 行');
  });

  it('値と持つ行を直接宣言する軸は上段の公理(取りうる値・持つ行つき)。主語の軸は数えず、下段の表に出す。理由を書く欄が無いことを言う', () => {
    expect(content).toContain('data-el="auth.axis"');
    expect(content).toContain('認証の仕様に、理由を書く欄は無い');
    expect(content).not.toContain('data-el="auth.axis" class="bf-axiom"');
    expect(content).toContain('id="axis-invitation"');
    expect(content).toContain('id="axis-guild"');
    expect(content).toContain('<span class="bf-mono">not_joined</span> ギルドに在籍していない');
    expect(content).toContain('確かめた行だけが持つ(任意)');
    expect(content).toContain('(<span class="bf-mono">member</span> = <span class="bf-mono">none</span>)');
    expect(text).toContain('主語の軸');
  });

  it('条件の軸が無い仕様(主語の軸だけ)は、軸の節を出さず、条件の軸 0 と数える', () => {
    const subjectOnly = { ...ctx, auth: authModel({ axes: defaultAuthAxes().slice(0, 1), landings: [authLanding('active')], branches: [authBranch('member_active')], gates: [] }) };
    const text = section(() => bookChapterSections(bookModel(), subjectOnly, 'auth.html')).content;

    expect(text).toContain('公理 2 本。条件の軸 0、分岐 1 行、着地 1、関門 0');
    expect(text).not.toContain('分岐の条件に使う軸');
    expect(text).not.toContain('data-el="auth.condition"');
  });

  it('仕様を読めていないときは、例外を投げず案内の 1 文だけを出す', () => {
    const broken = { ...ctx, auth: { available: true, flow: null } };
    const text = section(() => bookChapterSections(bookModel(), broken, 'auth.html')).content;

    expect(text).toContain('まだ認証フロー仕様を読めていない');
    expect(text).not.toContain('<Grid');
  });
});

describe('設定の章', () => {
  const ctx = {
    ...bookCtx(),
    config: configModel([
      configVariable('API_KEY'),
      configVariable('MODE', { kind: 'switch', requirement: 'tooling_only', targets: [], notInTemplateReason: '走査のたびに渡すつまみ' }),
    ]),
  };
  const { content, text, file } = section(() => bookChapterSections(bookModel(), ctx, 'config.html'));

  it('docs/book/config.html を wholeFile で生成し、読めていない環境では何も生成しない', () => {
    expect(file).toBe('docs/book/config.html');
    expect(bookChapterSections(bookModel(), GEN_CTX, 'config.html')).toEqual([]);
  });

  it('設定 1 本・値の性質の語・要求度の語が上段の 1 行。4 枚の数は本文と一致する', () => {
    // 設定 2 本 + 値の性質の語 3 + 要求度の語 3(`configCatalog` の語彙の既定)= 8 本。
    expect(content).toContain('公理 8 本。設定 2 本、値の性質の語 3、要求度の語 3');
  });

  it('雛形に載せない理由は、理由つきの受け入れ 1 件(読み手は開発者)。手引きと同じ数え方', () => {
    const sum = chapterReading(bookModel(), ctx, identityOf(file));

    expect(sum.byReader.developer.reasoned).toBe(1);
    expect(sum.byReader.business.reasoned).toBe(0);
    expect(sum.axioms).toBe(8);
    expect(text).toContain('受け入れ受け入れ\n1\n');
    expect(content).toContain('走査のたびに渡すつまみ');
  });

  it('値そのものはどこにも出さない: 出すのは名前・性質・要求度・未設定のときの挙動だけ', () => {
    expect(content).toContain('API_KEY が無いと落ちる');
    expect(configValueLeaks(content, ['API_KEY', 'MODE'])).toEqual([]);
    expect(content).toContain('値そのものはここには無い');
  });

  it('カタログを読めていないときは、例外を投げず案内の 1 文だけを出す', () => {
    const broken = { ...ctx, config: { available: true, catalog: null } };

    expect(section(() => bookChapterSections(bookModel(), broken, 'config.html')).content).toContain('まだ設定カタログを読めていない');
  });
});

describe('保証の章', () => {
  const ctx = {
    ...bookCtx(),
    guarantees: guaranteeModel([guarantee('rows_by_rls'), guarantee('writes_only_via_rpc', { enforcedBy: ['grant'] }), guarantee('later', { status: 'planned' })]),
  };
  const { content, text, file } = section(() => bookChapterSections(bookModel(), ctx, 'guarantees.html'));

  it('docs/book/guarantees.html を wholeFile で生成し、読めていない環境では何も生成しない', () => {
    expect(file).toBe('docs/book/guarantees.html');
    expect(bookChapterSections(bookModel(), GEN_CTX, 'guarantees.html')).toEqual([]);
  });

  it('保証 1 本が上段の 1 行。これからの保証は別の群にして正直に出す。4 枚の数は本文と一致する', () => {
    expect(content).toContain('公理 3 本。保証 3 本(守られている 2、これから 1)');
    expect(content).toContain('守られている(見張りテスト 1 本)');
    expect(content).toContain('これから(まだ着手していないため)');
  });

  it('性質から執行者と見張りテストへの対応・執行者の語・テストは下段の表で、件数は表の行の数', () => {
    expect(content).toContain('data-el="guarantee.enforcer"');
    expect(content).toContain('data-el="guarantee.tests"');
    expect(text).toContain('TC-GUAR-ROWS_BY_RLS-001');
  });

  it('回せなかった(unavailable)ときは目録を出さず、理由を言う。サマリ行は「0 行」と言わない', () => {
    const unavailable = { ...ctx, mutation: { state: 'unavailable', reason: 'テーブル仕様が読めていない' } as const };
    const { content: text } = section(() => bookChapterSections(bookModel(), unavailable, 'guarantees.html'));

    expect(text).not.toContain('data-el="guarantee.mutation"');
    expect(text).toContain('変異の目録は、テーブル仕様が読めていないので出さない');
    expect(text).not.toContain('変異の目録 0 行');
    expect(text).not.toContain('未実施(この生成の入口は変異を回していない');
  });

  it('入口が回さない(not_run)ときは目録を出さず、「未実施」と言う。回せなかった場合とは文面が違う', () => {
    const notRun = { ...ctx, dataTables: dataTableModel([]), mutation: { state: 'not_run' } as const };
    const { content: text } = section(() => bookChapterSections(bookModel(), notRun, 'guarantees.html'));

    expect(text).not.toContain('data-el="guarantee.mutation"');
    expect(text).toContain('変異の目録は未実施(この生成の入口は変異を回していない');
    expect(text).not.toContain('変異の目録 0 行');
    expect(text).not.toContain('ので出さない');
    expect(text).not.toContain('変異の目録は実測で、導出に置く');
  });

  it('状態が渡されていない文脈は not_run と同じに書く(実測が無いのに「0 行」と言わない)', () => {
    const { content: text } = section(() => bookChapterSections(bookModel(), { ...ctx, dataTables: dataTableModel([]) }, 'guarantees.html'));

    expect(text).not.toContain('data-el="guarantee.mutation"');
    expect(text).toContain('変異の目録は未実施(この生成の入口は変異を回していない');
    expect(text).not.toContain('変異の目録 0 行');
  });

  it('実測が渡されていれば、本は渡された結果をそのまま表にする(変異を自分で回さない)', () => {
    const mutation: MutationReport = {
      rows: [
        { subject: '', operator: 'op_a', at: '宣言 A を壊した', caughtBy: ['det_x'] },
        { subject: '', operator: 'op_a', at: '宣言 B を壊した', caughtBy: [] },
      ],
      operators: [
        { id: 'op_a', title: '壊し方 A', breaks: 'reads' },
        { id: 'op_b', title: '壊し方 B', breaks: 'writes' },
      ],
      detectors: [{ id: 'det_x', title: '検査 X' }],
      withoutSite: ['op_b'],
      scope: '権限と条件の宣言',
      unmutated: [],
    };
    const { content: text } = section(() =>
      bookChapterSections(bookModel(), { ...ctx, dataTables: dataTableModel([]), mutation: { state: 'ran', report: mutation } }, 'guarantees.html'),
    );

    expect(text).toContain('data-el="guarantee.mutation"');
    expect(text).toContain('変異の目録 2 行');
    expect(text).toContain('変異の目録は実測で、導出に置く');
    expect(text).not.toContain('変異の目録は未実施');
    expect(text).toContain('変異器 2 本 × 検査 1 本');
    expect(text).toContain('壊し方 A');
    expect(text).toContain('(うち誰も捕らなかったもの 1)');
    expect(text).toContain('宣言 B を壊した');
    expect(text).toContain('(この仕様にはその宣言がまだ無い)');
  });

  it('台帳を読めていないときは、例外を投げず案内の 1 文だけを出す', () => {
    const broken = { ...ctx, guarantees: { available: true, catalog: null } };

    expect(section(() => bookChapterSections(bookModel(), broken, 'guarantees.html')).content).toContain('まだ保証台帳を読めていない');
  });
});

describe('可視性の章', () => {
  const ctx = bookCtx();
  const { content, text, file } = section(() => bookChapterSections(bookModel(), ctx, 'visibility.html'));

  it('この章に公理は無い: 上段に公理の行を 1 つも持たず、必読は 0 / 0。4 枚の数は本文と一致する', () => {
    expect(content).toContain('公理 0 本。');
    expect(content).not.toContain('class="bf-axiom"');
    expect(text).toContain('業務 0 / 開発者 0');
  });

  it('アクセスの宣言を数えている章を、手引きと同じ集計から引いて案内する(二重に必読に数えない)', () => {
    const counted = blockReadings(bookModel(), ctx).filter((reading) => reading.file === 'docs/specs/domain/workshop/access.md');
    const axioms = counted.reduce((sum, reading) => sum + reading.axioms, 0);

    expect(axioms).toBeGreaterThan(0);
    expect(text).toContain('集約 workshop');
    expect(text).toContain(`domain/workshop/access.md | ${axioms}`);
    expect(chapterReading(bookModel(), ctx, identityOf(file)).axioms).toBe(0);
  });

  it('横断の表・読み取り経路は下段の導出の折りたたみで、行は集約の章の宣言と同じ', () => {
    expect(content).toContain('data-el="visibility.matrix"');
    expect(content).toContain('data-el="visibility.query"');
    expect(text).toContain('workshop | member | 全件(all) ⚠ | —');
  });
});

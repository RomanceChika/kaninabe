import { describe, expect, it } from 'vitest';
import { bookEntryReport, formatBookEntryReport, formatStaleChapters, type BookEntryRun } from '../../../lib/generate/book-entry-report.js';
import type { EntryInputPlan } from '../../../lib/generate/book-entry-plan.js';
import { MUTATION_TITLE } from '../../../lib/generate/render/book/mutation-section.js';
import type { ProductUses, SpecKind } from '../../../lib/model/product/uses.js';
import type { ReaderNotice } from '../../../lib/generate/book-entry-notice.js';

/** DB の宣言(data_table と surface)と保証台帳を採る製品。 */
const WITH_DB: ProductUses = ['actions', 'data_tables', 'surface', 'screens', 'guarantees'];
/** DB の宣言を採らない製品。 */
const WITHOUT_DB: ProductUses = ['actions', 'screens'];

/** 入力の状態に何も無い計画(採った種類はすべて読めた)。 */
const CLEAN: EntryInputPlan = { blocked: [], unselected: [], notAdopted: [], stoppedChapters: [] };

/** 報告の材料(省略した欄は何も無い)。 */
function run(overrides: Partial<BookEntryRun> & Pick<BookEntryRun, 'uses'>): BookEntryRun {
  return { files: [], emptyGenerators: [], plan: CLEAN, stale: [], unplaced: [], notices: [], ...overrides };
}

describe('bookEntryReport: 部分利用の入口が「全部確認済み」に見えない報告', () => {
  it('ファイルは昇順に並べ、DB を採る製品は範囲が縮んだものを未実施 1 件・未検査 2 件で名指しする', () => {
    const report = bookEntryReport(run({ files: ['docs/book/b.html', 'docs/book/a.html'], uses: WITH_DB }));
    expect(report.files).toEqual(['docs/book/a.html', 'docs/book/b.html']);
    expect(report.notes.filter((note) => note.includes(': 未実施 — '))).toHaveLength(1);
    expect(report.notes.filter((note) => note.includes(': 未検査 — '))).toHaveLength(2);
  });

  it('変異の目録は章の節の名前で名指す(節の見出しの綴りを 2 か所に持たない)', () => {
    const note = bookEntryReport(run({ uses: WITH_DB })).notes.find((line) => line.startsWith('変異の目録: '));
    expect(note).toContain(MUTATION_TITLE);
    expect(note).toContain('未実施');
  });

  it('検証の警告の未検査は、実行した範囲と実行していない範囲を分けて言い、完走していない V 群(action_spec / data_table に依るもの)を名指す', () => {
    const note = bookEntryReport(run({ uses: WITH_DB })).notes.find((line) => line.startsWith('検証の警告: '));
    expect(note).toContain('未検査');
    expect(note).toContain('生成を止める error の判定');
    expect(note).toContain('V16・V17・V18・V19 の判定は完走していない');
    expect(note).toContain('action_spec と data_table を渡さずに回す');
    for (const word of ['読み込みの診断', '他の種類の検査', '種類どうしの関係', '実装の木との接地', 'V21(到達性)', '未集計']) {
      expect(note, word).toContain(word);
    }
  });

  it('DB への接地は DB に関わる節を名指しする', () => {
    const db = bookEntryReport(run({ uses: WITH_DB })).notes.find((line) => line.startsWith('DB への接地: '));
    expect(db).toContain('未検査');
    for (const word of ['テーブル仕様', '索引', '結果表']) expect(db).toContain(word);
  });

  it('DB への接地の行は、DB に接地する種類(data_tables / surface のどちらか)を採る製品にだけ出す。採っていないものは事実として無い', () => {
    const grounded = (uses: ProductUses): boolean => bookEntryReport(run({ uses })).notes.some((line) => line.startsWith('DB への接地: '));
    expect(grounded(WITH_DB)).toBe(true);
    expect(grounded(['data_tables'])).toBe(true);
    expect(grounded(['surface'])).toBe(true);
    expect(grounded(WITHOUT_DB)).toBe(false);
    expect(grounded([])).toBe(false);
  });

  it('DB を採らず、保証台帳も採らない製品では、変異の目録の行は出さない(採っていないものは事実として無い)。検証の警告の未検査は製品に依らず名指す', () => {
    const notes = bookEntryReport(run({ uses: WITHOUT_DB })).notes;
    expect(notes.map((line) => line.split(' — ')[0])).toEqual(['検証の警告: 未検査']);
  });

  it('変異の目録の行は、保証台帳を採る製品にだけ出す(目録の節は保証台帳の章にだけある。テーブル仕様だけを採る製品には節が無い。DB への接地の行とは別の基準)', () => {
    const mutation = (uses: ProductUses): boolean => bookEntryReport(run({ uses })).notes.some((line) => line.startsWith('変異の目録: '));
    expect(mutation(['guarantees'])).toBe(true);
    expect(mutation(['guarantees', 'data_tables'])).toBe(true);
    expect(mutation(['data_tables'])).toBe(false);
    expect(mutation(['surface'])).toBe(false);
    expect(mutation(WITHOUT_DB)).toBe(false);
    expect(mutation([])).toBe(false);
    // 順は 変異の目録 → 検証の警告 → DB への接地(従来どおり)
    expect(bookEntryReport(run({ uses: WITH_DB })).notes.map((line) => line.split(' — ')[0])).toEqual(['変異の目録: 未実施', '検証の警告: 未検査', 'DB への接地: 未検査']);
  });
});

describe('bookEntryReport: 入力の状態(未選択 = 未実施 / 阻害 / 読込済み = 行なし)', () => {
  const plan: EntryInputPlan = {
    blocked: [
      { kind: 'jobs', reason: 'missing', stopped: ['docs/book/jobs.html'] },
      { kind: 'queries', reason: 'invalid', stopped: [] },
    ],
    unselected: [
      { kind: 'config', chapter: 'docs/book/config.html' },
      { kind: 'data_tables', chapter: 'docs/book/data.html' },
    ],
    notAdopted: ['config', 'data_tables'],
    stoppedChapters: ['jobs.html', 'config.html', 'data.html'],
  };

  it('阻害は理由と止めた章を名指す。持ち主の章が無い種類は「章は無い」と言い、止めなかった章が読む分の扱いも言う', () => {
    const notes = bookEntryReport(run({ uses: WITH_DB, plan, emptyGenerators: [] })).inputNotes;
    const jobs = notes.find((line) => line.startsWith('jobs: 阻害 — '));
    expect(jobs).toContain('jobs を採っているが章の材料へ渡せない(置き場に仕様が無い');
    expect(jobs).toContain('この種類を材料にする章は生成していない: docs/book/jobs.html');
    expect(jobs).toContain('止めていない章がこの種類を読む箇所は、読めた分だけ(読めなければ無い前提)で出ている');
    expect(jobs).toContain('止めていない章でこの種類を読むものは無い');
    const queries = notes.find((line) => line.startsWith('queries: 阻害 — '));
    expect(queries).toContain('読めなかった仕様があってモデルが欠けている');
    expect(queries).toContain('この種類だけを材料にする章は無い');
  });

  it('未選択は、生成器が何を返したかに依らず未実施と言う(「何も出さなかった」に入っていることを前提にしない)。置き場に仕様が残っていても読まないことも言う', () => {
    const report = bookEntryReport(run({ uses: WITH_DB, plan, emptyGenerators: ['book-examples'] }));
    expect(report.inputNotes.filter((line) => line.includes(': 未実施 — '))).toHaveLength(2);
    const config = report.inputNotes.find((line) => line.startsWith('config: 未実施 — '));
    expect(config).toContain('製品が config を採っていない(product.md の uses に無い)ので、章 docs/book/config.html は出さない');
    expect(config).toContain('置き場に仕様が残っていても読まない');
    expect(report.emptyGenerators).toEqual(['book-examples']);
  });

  it('読込済み(0 件の空も含む)は計画に載らないので、行を出さない。何も出さなかった生成器にはそのまま残る', () => {
    const report = bookEntryReport(run({ uses: WITH_DB, emptyGenerators: ['book-usecases'] }));
    expect(report.inputNotes).toEqual([]);
    expect(report.emptyGenerators).toEqual(['book-usecases']);
  });
});

describe('formatBookEntryReport / formatStaleChapters: 出力の行', () => {
  it('実行したファイルを 1 行ずつ・何も出さなかった生成器・入力の状態・縮んだものを並べる', () => {
    const lines = formatBookEntryReport(bookEntryReport(run({ files: ['docs/book/a.html'], emptyGenerators: ['book-examples', 'book-results-data'], uses: WITH_DB })));
    expect(lines[0]).toBe('実行した章と部品: 1 ファイル');
    expect(lines[1]).toBe('  docs/book/a.html');
    expect(lines).toContain('何も出さなかった生成器(実行したが、出す材料が無かった): book-examples / book-results-data');
    expect(lines.filter((line) => /^ {2}.+: (未実施|未検査) — /.test(line))).toHaveLength(3);
    expect(lines).toContain('この入口で範囲が縮んだもの: 3 件(以外は全部入りの generate と同じ生成器が同じ文脈で出す)');
  });

  it('縮んだものの件数は出す行の数に合う(DB も保証台帳も採らなければ検証の警告の 1 件だけ)', () => {
    const lines = formatBookEntryReport(bookEntryReport(run({ uses: WITHOUT_DB })));
    expect(lines).toContain('この入口で範囲が縮んだもの: 1 件(以外は全部入りの generate と同じ生成器が同じ文脈で出す)');
  });

  it('何も出さなかった生成器が無いときは「なし」と言い、入力の状態に行が無いときは「阻害なし」と言う(空の行にしない)', () => {
    const lines = formatBookEntryReport(bookEntryReport(run({ uses: WITH_DB })));
    expect(lines).toContain('何も出さなかった生成器: なし');
    expect(lines.find((line) => line.startsWith('入力の状態: '))).toContain('阻害なし');
  });

  it('入力の状態の行があれば件数と語の対応(採っていない = 未実施 / 採ったのに使えない = 阻害)を言い、標識が章に出ていないファイルを名指す', () => {
    const plan: EntryInputPlan = { blocked: [{ kind: 'jobs', reason: 'load-failed', stopped: ['docs/book/jobs.html'] }], unselected: [], notAdopted: [], stoppedChapters: ['jobs.html'] };
    const lines = formatBookEntryReport(bookEntryReport(run({ uses: WITH_DB, plan, unplaced: ['docs/specs/backend/jobs.md'] })));
    expect(lines).toContain('入力の状態: 章を出さなかった種類 1 件(採っていない = 未実施 / 採ったのに使えない = 阻害)');
    expect(lines.some((line) => line.includes('読めない・壊れている'))).toBe(true);
    expect(lines.some((line) => line.includes('標識が章に出ていない仕様ファイル(阻害した種類のもの') && line.includes('docs/specs/backend/jobs.md'))).toBe(true);
  });

  it('古い章が残っていれば名指して対処を言い(昇順)、残っていなければ何も言わない', () => {
    expect(formatStaleChapters(bookEntryReport(run({ uses: WITH_DB })))).toEqual([]);
    const lines = formatStaleChapters(bookEntryReport(run({ uses: WITH_DB, stale: ['docs/book/jobs.html', 'docs/book/config.html'] })));
    expect(lines[0]).toBe('古い章が残っている(この実行では生成していない): docs/book/config.html / docs/book/jobs.html');
    expect(lines[1]).toContain('自動では消さない');
  });
});

describe('bookEntryReport: 阻害した種類を読んでいる章を、章の冒頭に名指したことを言う', () => {
  const plan: EntryInputPlan = { blocked: [{ kind: 'jobs', reason: 'missing', stopped: ['docs/book/jobs.html'] }, { kind: 'queries', reason: 'invalid', stopped: [] }], unselected: [], notAdopted: [], stoppedChapters: ['jobs.html'] };
  const notice = (file: string, kind: SpecKind): ReaderNotice => ({ file, kind, reason: 'invalid', sections: ['章立て'] });

  it('種類ごとに、その種類を読む章の数と名前(4 章まで。残りは「ほか N 章」)を挙げる', () => {
    const notices = [
      ...['a', 'b', 'c', 'd', 'e', 'f'].map((name) => notice(`docs/book/${name}.html`, 'jobs')),
      notice('docs/book/q.html', 'queries'),
    ];

    const notes = bookEntryReport(run({ uses: WITH_DB, plan, notices })).inputNotes;

    expect(notes.find((line) => line.startsWith('jobs: 阻害 — '))).toContain('この種類を読む章の冒頭に、どの節が読めた分だけかを名指した(6 章: docs/book/a.html / docs/book/b.html / docs/book/c.html / docs/book/d.html ほか 2 章)');
    expect(notes.find((line) => line.startsWith('queries: 阻害 — '))).toContain('(1 章: docs/book/q.html)');
  });
});

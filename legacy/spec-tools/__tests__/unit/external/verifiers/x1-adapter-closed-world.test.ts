/**
 * X1(アダプタの閉世界)のユニットテスト。
 *
 * 規約網羅(external-spec-writing.md §検証):
 *   - (a) adapter パスの実在と、ファイル内の port 名の実在
 *   - (b) app/src/infrastructure/ 直下のディレクトリの全数が集約名 / supabase /
 *     data_table で internal: true のテーブル名 / 語彙の adapter_root のいずれかに
 *     分類されること(**無宣言ディレクトリの検出**・**③が data_table 由来でハードコードで
 *     ないこと**)
 *   - (c) adapter_root 配下の実装ファイルがいずれかの連携の adapter に宣言されていること
 *     (**無宣言アダプタの検出**)
 *
 * この検証器だけは I/O を伴う(実在を見るのが仕事)ため、fixtures/external-repo-* を
 * リポジトリルートに見立てて回す(job/verifiers/j2-schedule-parity.test.ts と同じ流儀)。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { adapterClosedWorldGaps, verifyAdapterClosedWorld } from '../../../../lib/external/verifiers/x1-adapter-closed-world.js';
import { aggregate, entitySpec, specModel } from '../../../helpers/model-builder.js';
import { externalCatalog, integration } from '../../../helpers/external-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { TEST_LAYOUT } from '../../../helpers/platform.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { blockedInput, loadedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';

/** fixtures 配下を repoRoot に見立てる(共通の親)。 */
const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures');

/** workshop アグリゲート(entity 名 workshop)を持つ最小ドメインモデル。 */
const DOMAIN = specModel([aggregate('workshop', { entity: entitySpec('workshop') })]);

/** fixtures の `jobs/` ディレクトリに対応する data_table(internal: true)。 */
const JOBS_TABLE = loadedInput(dataTableModel([dataTable('jobs', { internal: true })]));

/** data_table が 1 件も無いモデル(internal テーブルの母集合が空)。 */
const NO_TABLES = loadedInput(dataTableModel([]));

/** 語彙(discord のみ)。 */
const SERVICE_VOCAB = [{ id: 'discord', label: 'Discord', adapterRoot: 'app/src/infrastructure/discord', sdkPackages: [], clientUi: [] }];

/** discord_webhook 1 件だけの正しい宣言。 */
function catalog() {
  return externalCatalog(
    [
      integration('discord_webhook', {
        service: 'discord',
        port: 'DeliveryPort',
        adapter: 'app/src/infrastructure/discord/webhook.ts',
      }),
    ],
  );
}

/** vocabulary を discord のみに絞ったカタログを作る(externalCatalog は既定で 3 サービス持つため上書き)。 */
function withDiscordOnlyVocabulary(base: ReturnType<typeof catalog>) {
  return { ...base, vocabulary: { service: SERVICE_VOCAB } };
}

describe('X1: アダプタの閉世界', () => {
  it('宣言どおりに揃っていれば違反なし(jobs は data_table の internal: true から分類される)', () => {
    const repoRoot = path.join(FIXTURES, 'external-repo-valid');
    const findings = verifyAdapterClosedWorld({ roots: TEST_ROOTS, layout: TEST_LAYOUT,
      domain: DOMAIN,
      dataTables: JOBS_TABLE,
      catalog: withDiscordOnlyVocabulary(catalog()),
      repoRoot,
    });

    expect(findings).toEqual([]);
  });

  it('③はハードコードではない — jobs を internal: true として宣言していなければ jobs も未分類として落ちる', () => {
    const repoRoot = path.join(FIXTURES, 'external-repo-valid');
    const findings = verifyAdapterClosedWorld({ roots: TEST_ROOTS, layout: TEST_LAYOUT,
      domain: DOMAIN,
      dataTables: NO_TABLES,
      catalog: withDiscordOnlyVocabulary(catalog()),
      repoRoot,
    });

    expect(
      findings.some(
        (f) => f.verifier === 'X1' && f.message.includes('app/src/infrastructure/jobs') && f.message.includes('分類'),
      ),
    ).toBe(true);
  });

  it('internal: false の data_table(集約テーブル)は分類の根拠にならない', () => {
    const repoRoot = path.join(FIXTURES, 'external-repo-valid');
    const findings = verifyAdapterClosedWorld({ roots: TEST_ROOTS, layout: TEST_LAYOUT,
      domain: DOMAIN,
      dataTables: loadedInput(dataTableModel([dataTable('jobs', { internal: false })])),
      catalog: withDiscordOnlyVocabulary(catalog()),
      repoRoot,
    });

    expect(findings.some((f) => f.message.includes('app/src/infrastructure/jobs'))).toBe(true);
  });

  it('(b) 分類できないディレクトリ(無宣言の外部連携)を検出する', () => {
    const repoRoot = path.join(FIXTURES, 'external-repo-undeclared-dir');
    const findings = verifyAdapterClosedWorld({ roots: TEST_ROOTS, layout: TEST_LAYOUT,
      domain: DOMAIN,
      dataTables: JOBS_TABLE,
      catalog: withDiscordOnlyVocabulary(catalog()),
      repoRoot,
    });

    expect(
      findings.some(
        (f) => f.verifier === 'X1' && f.message.includes('app/src/infrastructure/mystery') && f.message.includes('分類'),
      ),
    ).toBe(true);
  });

  it('(c) adapter に宣言されていない実装ファイル(無宣言アダプタ)を検出する', () => {
    const repoRoot = path.join(FIXTURES, 'external-repo-undeclared-adapter');
    const findings = verifyAdapterClosedWorld({ roots: TEST_ROOTS, layout: TEST_LAYOUT,
      domain: DOMAIN,
      dataTables: JOBS_TABLE,
      catalog: withDiscordOnlyVocabulary(catalog()),
      repoRoot,
    });

    expect(
      findings.some(
        (f) =>
          f.verifier === 'X1' &&
          f.message.includes('app/src/infrastructure/discord/orphan.ts') &&
          f.message.includes('宣言されていません'),
      ),
    ).toBe(true);
  });

  it('(a) adapter パスが実在しなければエラー', () => {
    const repoRoot = path.join(FIXTURES, 'external-repo-empty');
    const findings = verifyAdapterClosedWorld({ roots: TEST_ROOTS, layout: TEST_LAYOUT,
      domain: DOMAIN,
      dataTables: NO_TABLES,
      catalog: {
        ...withDiscordOnlyVocabulary(catalog()),
        integrations: [
          integration('discord_webhook', { adapter: 'app/src/infrastructure/discord/missing.ts' }),
        ],
      },
      repoRoot,
    });

    expect(findings.some((f) => f.message.includes('が実在しません'))).toBe(true);
  });

  it('(a) 実装ファイルに port の名前が無ければエラー', () => {
    const repoRoot = path.join(FIXTURES, 'external-repo-empty');
    const findings = verifyAdapterClosedWorld({ roots: TEST_ROOTS, layout: TEST_LAYOUT,
      domain: DOMAIN,
      dataTables: NO_TABLES,
      catalog: {
        ...withDiscordOnlyVocabulary(catalog()),
        integrations: [
          integration('discord_webhook', { adapter: 'app/some-file.ts', port: 'DeliveryPort' }),
        ],
      },
      repoRoot,
    });

    expect(findings.some((f) => f.message.includes('port DeliveryPort がありません'))).toBe(true);
  });

  it('app/ が無いリポジトリでは (a)(b)(c) を 3 段そろって飛ばす(仕様だけの木も正当)', () => {
    const repoRoot = path.join(FIXTURES, 'samples', 'library');
    const findings = verifyAdapterClosedWorld({ roots: TEST_ROOTS, layout: TEST_LAYOUT,
      domain: DOMAIN,
      dataTables: JOBS_TABLE,
      catalog: withDiscordOnlyVocabulary(catalog()),
      repoRoot,
    });

    expect(findings).toEqual([]);
  });

  it('app/src/infrastructure/ 自体が無い構成では (b)(c) を見ない', () => {
    const repoRoot = path.join(FIXTURES, 'external-repo-empty');
    const findings = verifyAdapterClosedWorld({ roots: TEST_ROOTS, layout: TEST_LAYOUT,
      domain: DOMAIN,
      dataTables: NO_TABLES,
      catalog: {
        ...withDiscordOnlyVocabulary(catalog()),
        integrations: [
          integration('discord_webhook', { adapter: 'app/some-file.ts', port: 'x' }),
        ],
      },
      repoRoot,
    });

    // port 'x' は some-file.ts の中身('export const x = 1;')に literal 一致してしまうため
    // ここでは違反 0 件(= (b)(c) が余計な指摘を積んでいない)ことだけを確かめる。
    expect(findings).toEqual([]);
  });
});

describe('X1(b): テーブル仕様の入力の状態(未選択は事実・阻害は分からない)', () => {
  const repoRoot = path.join(FIXTURES, 'external-repo-valid');
  const input = (dataTables: Parameters<typeof verifyAdapterClosedWorld>[0]['dataTables']) => ({
    roots: TEST_ROOTS, layout: TEST_LAYOUT,
    domain: DOMAIN,
    dataTables,
    catalog: withDiscordOnlyVocabulary(catalog()),
    repoRoot,
  });
  const jobsFinding = (findings: readonly { message: string }[]) => findings.filter((finding) => finding.message.includes('app/src/infrastructure/jobs'));

  it('未選択: 内部テーブルは宣言されていないという事実で判定する(jobs は未分類として落ち、見ていない対象は無い)', () => {
    expect(jobsFinding(verifyAdapterClosedWorld(input(UNSELECTED)))).toHaveLength(1);
    expect(adapterClosedWorldGaps(input(UNSELECTED))).toEqual([]);
  });

  it('阻害: 内部テーブルかもしれないディレクトリの判定は出さず、そのディレクトリを名指して見ていないことを返す', () => {
    const blocked = blockedInput<never>('invalid');

    expect(jobsFinding(verifyAdapterClosedWorld(input(blocked)))).toEqual([]);
    expect(adapterClosedWorldGaps(input(blocked))).toEqual([
      {
        gap: { input: 'data_tables', state: 'blocked', reason: 'invalid' },
        consequence: expect.stringContaining('内部テーブル(internal: true)のリポジトリに当たるか'),
        subjects: ['app/src/infrastructure/jobs'],
      },
    ]);
  });

  it('阻害でも、内部テーブル名に頼らず分類できるディレクトリの判定(集約名・土台・語彙)と (a)(c) は従来どおり出る', () => {
    const findings = verifyAdapterClosedWorld({ ...input(blockedInput<never>('missing')), catalog: externalCatalog([integration('discord_webhook', { service: 'discord', port: 'NoSuchPort', adapter: 'app/src/infrastructure/discord/webhook.ts' })]) });

    expect(findings.some((finding) => finding.message.includes('NoSuchPort'))).toBe(true);
  });

  it('読込済み(0 件も): 見ていないことは無い(内部テーブル名の母集合で判定済み)', () => {
    expect(adapterClosedWorldGaps(input(JOBS_TABLE))).toEqual([]);
    expect(adapterClosedWorldGaps(input(NO_TABLES))).toEqual([]);
  });

  it('阻害でも、判定を出さなかったディレクトリが無ければ(全部分類できる)記録は空', () => {
    const noMystery = { ...input(blockedInput<never>('invalid')), domain: specModel([aggregate('workshop', { entity: entitySpec('workshop') }), aggregate('jobs', { entity: entitySpec('jobs') })]) };

    expect(adapterClosedWorldGaps(noMystery)).toEqual([]);
  });

  it('app/ が無い構成と、接続層が無い構成では、阻害でも記録は空(見る対象が無い)', () => {
    const blocked = blockedInput<never>('invalid');

    expect(adapterClosedWorldGaps({ ...input(blocked), repoRoot: path.join(FIXTURES, 'external-repo-empty') })).toEqual([]);
    expect(adapterClosedWorldGaps({ ...input(blocked), repoRoot: path.join(FIXTURES, 'no-such-repo') })).toEqual([]);
  });
});

describe('X1(b): 接続層の土台は、置き場の配置が宣言する層と土台の表から引く(別の配置の値で読まれる)', () => {
  const repoRoot = path.join(FIXTURES, 'external-repo-valid');
  const nextjsSource = TEST_LAYOUT['source-root'] ?? failMissing();
  const nextjsStructure = nextjsSource.structure ?? failMissing();

  /** 土台の表を差し替えた配置(ほかは Next.js の値のまま)。 */
  const withBaseDirs = (baseDirs: NonNullable<typeof nextjsStructure>['baseDirs']) => ({
    ...TEST_LAYOUT,
    'source-root': { ...nextjsSource, structure: { ...nextjsStructure, baseDirs } },
  });

  const input = (layout: typeof TEST_LAYOUT) => ({ roots: TEST_ROOTS, layout, domain: DOMAIN, dataTables: JOBS_TABLE, catalog: withDiscordOnlyVocabulary(catalog()), repoRoot });

  it('表から接続層(supabase)を外した配置では、supabase が未分類として落ちる(土台の一覧を X1 が持たない)', () => {
    const without = withBaseDirs(nextjsStructure.baseDirs.filter((entry) => !(entry.layer === 'infrastructure' && entry.dir === 'supabase')));
    const findings = verifyAdapterClosedWorld(input(without));

    expect(findings.map((finding) => finding.message)).toEqual([expect.stringContaining('app/src/infrastructure/supabase はどの分類')]);
  });

  it('表に jobs を土台として足した配置では、内部テーブルの宣言が無くても jobs は分類される(未選択のとき落ちていたものが落ちない)', () => {
    const base = nextjsStructure.baseDirs.find((entry) => entry.layer === 'infrastructure' && entry.dir === 'supabase') ?? failMissing();
    const withJobs = withBaseDirs([...nextjsStructure.baseDirs, { ...base, dir: 'jobs' }]);

    expect(jobsFinding(verifyAdapterClosedWorld({ ...input(withJobs), dataTables: UNSELECTED }))).toEqual([]);
    expect(jobsFinding(verifyAdapterClosedWorld({ ...input(TEST_LAYOUT), dataTables: UNSELECTED }))).toHaveLength(1);
  });

  it('基盤の層の役割が配置に無い(空の配置)と、接続層を見る相手が無いので(b)は何も言わない', () => {
    expect(verifyAdapterClosedWorld({ ...input({}), catalog: withDiscordOnlyVocabulary(catalog()) }).filter((finding) => finding.message.includes('どの分類'))).toEqual([]);
  });
});

/** 配置の元の値が足りないテストの書き間違いを知らせる。 */
function failMissing(): never {
  throw new Error('配置に必要な宣言がありません');
}

/** `app/src/infrastructure/jobs` の分類の指摘だけ。 */
function jobsFinding(findings: readonly { message: string }[]) {
  return findings.filter((finding) => finding.message.includes('app/src/infrastructure/jobs'));
}

/**
 * config-body / book-config のユニットテスト。
 *
 * 生成は情報を足さない(カタログのマトリクスのみ)。ここでは差し込み先と、
 * **「無いとどうなるか」が必ず表に出ること**、`used_by` を軸に束ね直した
 * **連携の一覧が出ること**(同じ宣言を別の軸で見た姿であること)、
 * そして雛形に載せない行がその理由つきで出ることを固定する。
 * 置き場(`targets`)については、**名前の数え方(`probe`)がそのまま表に出ること**を固定する ——
 * 「道具が値を読まない」は宣言の形で担保されており、それが人の読む表から辿れる必要がある。
 */

import { describe, expect, it } from 'vitest';
import { configBodyGenerator } from '../../../../lib/generate/render/config-body.js';
import { bookChapterSections, pageText } from '../../../helpers/book-html.js';
import { specModel, stubGuards } from '../../../helpers/model-builder.js';
import { configModel, configVariable } from '../../../helpers/config-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** 設定カタログだけを載せた文脈(設定はドメインモデルを参照しない)。 */
const CTX = (config: ReturnType<typeof configModel>) => ({ guards: stubGuards(), roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, config });

/** 必須 1 本 + 道具のつまみ 1 本の標準的なカタログ。 */
function standard() {
  return configModel([
    configVariable('SUPABASE_URL', {
      kind: 'endpoint',
      summary: 'サーバー側が叩く Supabase API の URL',
      absence: '画面と操作のほぼ全部が例外で落ちる',
    }),
    configVariable('WALK_SEED', {
      kind: 'switch',
      requirement: 'tooling_only',
      usedBy: ['test_harness'],
      summary: 'ランダムウォークの乱数シード',
      absence: 'ランダムなシードで走る',
      notInTemplateReason: '走査のたびにコマンドラインで渡すつまみ',
    }),
  ]);
}

describe('config-body', () => {
  it('カタログがマトリクスに写り、未設定時の挙動まで出る', () => {
    const sections = configBodyGenerator.generate(specModel([]), CTX(standard()));

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('docs/specs/backend/config.md');
    expect(sections[0]?.marker).toBe('config-body');
    const content = sections[0]?.content ?? '';
    expect(content).toContain('`SUPABASE_URL`');
    expect(content).toContain('画面と操作のほぼ全部が例外で落ちる');
    expect(content).toContain('### 語彙(このカタログが宣言する値域)');
  });

  it('置き場の表に「名前の数え方」と読み口が出る(値を読む手は宣言できない)', () => {
    const content = configBodyGenerator.generate(specModel([]), CTX(standard()))[0]?.content ?? '';
    expect(content).toContain('### 置き場(値がどこに要るか。`config:doctor` が名前だけを照合する先)');
    expect(content).toContain('`app/.env.local` のキー名(dotenv)');
    expect(content).toContain('`gh secret list --json name` の出力に名前が出るか(command)');
    expect(content).toContain('`.github/workflows`(workflow_secret)');
  });

  it('置き場の既定(requirement ごと)が表に出る', () => {
    const content = configBodyGenerator.generate(specModel([]), CTX(standard()))[0]?.content ?? '';
    expect(content).toContain('### 置き場の既定(`targets` を書かない行が引く値)');
    expect(content).toContain('(どこにも入れない)');
  });

  it('used_by を軸に束ね直した連携の一覧が出る', () => {
    const content = configBodyGenerator.generate(specModel([]), CTX(standard()))[0]?.content ?? '';
    expect(content).toContain('### 何と繋がっているか');
    expect(content).toContain('Supabase — 業務データ');
    expect(content).toContain('テスト・走査の道具');
  });

  it('雛形に載せない行は理由つきで出る', () => {
    const content = configBodyGenerator.generate(specModel([]), CTX(standard()))[0]?.content ?? '';
    expect(content).toContain('—(走査のたびにコマンドラインで渡すつまみ)');
  });

  it('カタログが無ければ何も生成しない', () => {
    expect(configBodyGenerator.generate(specModel([]), { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards() })).toEqual([]);
  });
});

/** 設定の章(HTML の本)のセクション。 */
const bookConfig = (ctx: unknown) => bookChapterSections(specModel([]), ctx as Parameters<typeof bookChapterSections>[1], 'config.html');

describe('book-config(HTML の本の設定の章)', () => {
  it('章がまるごと生成され、設定の行(上段)と、連携・置き場・雛形との対応の折りたたみ(下段)を持つ', () => {
    const sections = bookConfig(CTX(standard()));

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('docs/book/config.html');
    expect(sections[0]?.wholeFile).toBe(true);
    const html = sections[0]?.content ?? '';
    const content = pageText(html);
    expect(content).toContain('何を設定すると何が変わるか(設定と連携)');
    expect(content).toContain('設定(');
    expect(content).toContain('何と繋がっているか(連携)');
    expect(content).toContain('どこに入れるか(置き場)');
    expect(content).toContain('実装と雛形との対応(設定ごと)');
    expect(html).toContain('data-el="config.summary config.absence"');
  });

  it('置き場の節が「どこの・何が読むか」と本数を出す', () => {
    const content = pageText(bookConfig(CTX(standard()))[0]?.content ?? '');
    expect(content).toContain('開発機');
    expect(content).toContain('npm run config:doctor');
  });

  it('語彙の表示名が併記される(語の内部名だけを読ませない)', () => {
    const content = pageText(bookConfig(CTX(standard()))[0]?.content ?? '');
    expect(content).toContain('tooling_only');
    expect(content).toContain('Supabase — 業務データ');
  });

  it('カタログを読めていなければその旨だけを出す', () => {
    const ctx = { guards: stubGuards(), roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, config: { available: true, catalog: null } };
    const content = pageText(bookConfig(ctx)[0]?.content ?? '');
    expect(content).toContain('まだ設定カタログを読めていない');
  });

  it('カタログが無ければ章そのものを作らない', () => {
    expect(bookConfig({ roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards() })).toEqual([]);
  });
});

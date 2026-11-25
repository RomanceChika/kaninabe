/**
 * テストコードからの @spec / @tc 抽出の規約網羅テスト。
 * 対象の要求: action-spec-writing.md「テストコード側には対応する // @tc {id} を書く」。
 *
 * `@spec` はあるが `@tc` が無い行(片方だけの注釈)は、注釈の名前空間が `@tc` 一本である以上
 * 突合キーを持たない。抽出器がそれを黙って無視すると A12 の視界にも入らなくなるため、
 * ここでは「片方だけの注釈は annotations ではなく halfTags 側に拾われる」ことを固定する
 * (テスト義務の全域化 決定 #3)。
 */

import { describe, expect, it } from 'vitest';
import { extractAnnotations } from '../../../lib/trace/extract-annotations.js';

const FILE = 'app/src/operation/__tests__/entry/submit.test.ts';

describe('extractAnnotations — @tc の注釈', () => {
  it('実物の書式(@spec X @tc Y + it)から ID とテスト名を取る', () => {
    const source = [
      "describe('submitEntry', () => {",
      '  // @spec entry.submit @tc TC-ENTRY-SUBMIT-001',
      "  it('下書きから提出できる', async () => {",
      '  });',
      '});',
    ].join('\n');

    expect(extractAnnotations(source, FILE).annotations).toEqual([
      {
        tcId: 'TC-ENTRY-SUBMIT-001',
        specIds: ['entry.submit'],
        testName: '下書きから提出できる',
        decorates: true,
        file: FILE,
        line: 2,
      },
    ]);
  });

  it('@spec に複数の ID を書ける', () => {
    const source = ['// @spec entry.submit INV-ENTRY-001 @tc TC-A-B-001', "it('x', () => {});"].join('\n');

    expect(extractAnnotations(source, FILE).annotations[0]?.specIds).toEqual([
      'entry.submit',
      'INV-ENTRY-001',
    ]);
  });

  it('@spec を同じ行に繰り返しても、全部の ID を出現順に拾う(生成されるテストの書式)', () => {
    const source = ['// @spec entry.submit @spec INV-ENTRY-001 INV-ENTRY-002 @tc TC-A-B-001', "it('x', () => {});"].join('\n');

    expect(extractAnnotations(source, FILE).annotations[0]?.specIds).toEqual([
      'entry.submit',
      'INV-ENTRY-001',
      'INV-ENTRY-002',
    ]);
  });

  it('片方だけの注釈(@tc 無し)でも、繰り返した @spec の全部を拾う', () => {
    const source = ['// @spec entry.submit @spec INV-ENTRY-001', "it('x', () => {});"].join('\n');

    const { annotations, halfTags } = extractAnnotations(source, FILE);
    expect(annotations).toEqual([]);
    expect(halfTags).toEqual([{ file: FILE, line: 1, specIds: ['entry.submit', 'INV-ENTRY-001'] }]);
  });

  it('@spec が無くても @tc だけで拾う', () => {
    const source = ['// @tc TC-A-B-001', "it('x', () => {});"].join('\n');

    expect(extractAnnotations(source, FILE).annotations[0]).toMatchObject({
      tcId: 'TC-A-B-001',
      specIds: [],
    });
  });

  it('test / it.only / ダブルクォート / バッククォートのテスト名も拾う', () => {
    const source = [
      '// @tc TC-A-B-001',
      'test("ダブルクォート", () => {});',
      '// @tc TC-A-B-002',
      'it.only(`バッククォート`, () => {});',
      '// @tc TC-A-B-003',
      "it.skip('スキップ', () => {});",
    ].join('\n');

    expect(extractAnnotations(source, FILE).annotations.map((a) => a.testName)).toEqual([
      'ダブルクォート',
      'バッククォート',
      'スキップ',
    ]);
  });

  it('アノテーションと it の間に空行やコメントがあっても拾う', () => {
    const source = ['// @tc TC-A-B-001', '', '  // 補足のコメント', "  it('離れたテスト', () => {});"].join('\n');

    expect(extractAnnotations(source, FILE).annotations[0]?.testName).toBe('離れたテスト');
  });

  it('直後にテスト宣言が無ければ testName は null になる', () => {
    const source = ['// @tc TC-A-B-001', 'const x = 1;', 'const y = 2;', 'const z = 3;', 'const w = 4;', 'const v = 5;'].join('\n');

    expect(extractAnnotations(source, FILE).annotations[0]?.testName).toBeNull();
  });

  it('@tc が連続していたら前者はテストを持たないものとして扱う', () => {
    const source = ['// @tc TC-A-B-001', '// @tc TC-A-B-002', "it('後者のテスト', () => {});"].join('\n');
    const found = extractAnnotations(source, FILE).annotations;

    expect(found.map((a) => a.testName)).toEqual([null, '後者のテスト']);
  });

  it('境界: アノテーションが無いファイルは空配列', () => {
    expect(extractAnnotations("it('注釈なし', () => {});", FILE).annotations).toEqual([]);
  });

  it('境界: コメントでない行の @tc は拾わない(文字列リテラル中の誤検出を避ける)', () => {
    const source = ["const message = '@tc TC-A-B-001';", "it('x', () => {});"].join('\n');

    expect(extractAnnotations(source, FILE).annotations).toEqual([]);
  });

  it('境界: ブロックコメント中の @tc も拾う', () => {
    const source = ['/**', ' * @spec entry.submit @tc TC-A-B-001', ' */', "it('ブロック', () => {});"].join('\n');

    expect(extractAnnotations(source, FILE).annotations[0]?.testName).toBe('ブロック');
  });
});

describe('extractAnnotations — @spec だけの片方だけの注釈', () => {
  it('@spec はあるが @tc が無い行は halfTags に拾う(annotations には入れない)', () => {
    const source = ['// @spec entry.submit', "it('x', () => {});"].join('\n');
    const found = extractAnnotations(source, FILE);

    expect(found.annotations).toEqual([]);
    expect(found.halfTags).toEqual([{ file: FILE, line: 1, specIds: ['entry.submit'] }]);
  });

  it('@spec @tc が揃っている行は片方だけの注釈にならない', () => {
    const source = ['// @spec entry.submit @tc TC-A-B-001', "it('x', () => {});"].join('\n');

    expect(extractAnnotations(source, FILE).halfTags).toEqual([]);
  });

  it('@spec も @tc も無ければ片方だけの注釈にもならない', () => {
    expect(extractAnnotations("it('注釈なし', () => {});", FILE).halfTags).toEqual([]);
  });
});

describe('extractAnnotations — 注釈の位置(テスト宣言の直前の行)', () => {
  it('注釈がテスト宣言の直前の行でなければ decorates: false(A12 が error にする)', () => {
    const source = [
      "it('x', () => {",
      '  // @spec entry.submit @tc TC-ENTRY-SUBMIT-001',
      '  const result = run();',
      '});',
    ].join('\n');

    expect(extractAnnotations(source, FILE).annotations[0]?.decorates).toBe(false);
  });

  it('例示の印(#region)の行は挟んでよい(コード例の抜き出しと両立させる)', () => {
    const source = [
      '// @spec entry.submit @tc TC-ENTRY-SUBMIT-001',
      '// #region example:window-canary-test',
      "it('x', () => {});",
    ].join('\n');

    expect(extractAnnotations(source, FILE).annotations[0]?.decorates).toBe(true);
  });
});

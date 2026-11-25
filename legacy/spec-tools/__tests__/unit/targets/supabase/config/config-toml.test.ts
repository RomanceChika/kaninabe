/**
 * `config.toml` の最小リーダーのユニットテスト。
 * 見るのは H5 が使う形 — セクション・真偽値・文字列・文字列の配列(複数行を含む)・コメント — と、読めない値を捨てないこと。
 */

import { describe, expect, it } from 'vitest';
import { parseToml } from '../../../../../lib/targets/supabase/config/config-toml.js';

describe('parseToml', () => {
  it('セクションごとに真偽値・文字列・数・文字列の配列を読む', () => {
    const { doc } = parseToml(['top = "x"', '[a]', 'on = true', 'off = false', 'n = 12', 'name = "v"', 'list = ["p", "q"]', "single = 'z'"].join('\n'));

    expect(doc.get('')?.get('top')).toBe('x');
    expect(doc.get('a')?.get('on')).toBe(true);
    expect(doc.get('a')?.get('off')).toBe(false);
    expect(doc.get('a')?.get('n')).toBe(12);
    expect(doc.get('a')?.get('name')).toBe('v');
    expect(doc.get('a')?.get('list')).toEqual(['p', 'q']);
    expect(doc.get('a')?.get('single')).toBe('z');
  });

  it('入れ子のセクション名をドットでつなぎ、前後の空白を揃える', () => {
    const { doc } = parseToml('[ a . b ]\nk = true\n[a.c.d]\nk = false');

    expect(doc.get('a.b')?.get('k')).toBe(true);
    expect(doc.get('a.c.d')?.get('k')).toBe(false);
  });

  it('コメントを落とし、引用符の中の # は残す', () => {
    const { doc } = parseToml('[s]\n# 全行コメント\nk = true # 行末のコメント\nm = "a#b"');

    expect(doc.get('s')?.get('k')).toBe(true);
    expect(doc.get('s')?.get('m')).toBe('a#b');
  });

  it('複数行にまたがる配列と末尾のカンマを読む', () => {
    const { doc } = parseToml('[s]\nlist = [\n  "a", # 先頭\n  "b",\n]\nafter = true');

    expect(doc.get('s')?.get('list')).toEqual(['a', 'b']);
    expect(doc.get('s')?.get('after')).toBe(true);
  });

  it('空の配列を読む', () => {
    expect(parseToml('[s]\nlist = []').doc.get('s')?.get('list')).toEqual([]);
  });

  it('読めない値は捨てずに unreadable で返す', () => {
    const { doc } = parseToml('[s]\nenv = env(X)\nmixed = ["a", 1]\ntable = { a = 1 }');

    expect(doc.get('s')?.get('env')).toEqual({ unreadable: 'env(X)' });
    expect(doc.get('s')?.get('mixed')).toEqual({ unreadable: '["a", 1]' });
    expect(doc.get('s')?.get('table')).toEqual({ unreadable: '{ a = 1 }' });
  });

  it('配列表 [[...]] は同名の通常セクションと混ざらない', () => {
    const { doc } = parseToml('[s]\nk = true\n[[s]]\nk = false');

    expect(doc.get('s')?.get('k')).toBe(true);
    expect(doc.get('[[s]]')?.get('k')).toBe(false);
  });

  it('空の本文はルートだけを持つ', () => {
    expect([...parseToml('').doc.keys()]).toEqual(['']);
  });
});

describe('parseToml: フルパスに畳めない書き方は値を読まず shapes で返す', () => {
  it('インラインテーブル(ルート・セクションの中)', () => {
    const { shapes } = parseToml('auth = { enable_anonymous_sign_ins = true }\n[auth.external]\ngithub = { enabled = true }');

    expect(shapes).toEqual([
      { section: '', key: 'auth', kind: 'inline_table' },
      { section: 'auth.external', key: 'github', kind: 'inline_table' },
    ]);
  });

  it('ドット付きのキー(ルート・[auth]・[auth.external] の 3 か所)', () => {
    const { shapes } = parseToml('auth.external.github.enabled = true\n[auth]\nexternal.github.enabled = true\n[auth.external]\ngithub.enabled = true');

    expect(shapes.map((shape) => [shape.section, shape.key, shape.kind])).toEqual([
      ['', 'auth.external.github.enabled', 'dotted_key'],
      ['auth', 'external.github.enabled', 'dotted_key'],
      ['auth.external', 'github.enabled', 'dotted_key'],
    ]);
  });

  it('引用符つきでドットを含むセクション名(ドットを含まない引用符つきの名前は普通に読む)', () => {
    const parsed = parseToml('[auth.external."my.prov"]\nenabled = true\n[auth.external."plain"]\nenabled = false');

    expect(parsed.shapes).toEqual([{ section: 'auth.external.my.prov', key: '', kind: 'quoted_dotted_section' }]);
    expect(parsed.doc.get('auth.external.plain')?.get('enabled')).toBe(false);
  });

  it('配列表', () => {
    expect(parseToml('[[remotes.x]]\nk = 1').shapes).toEqual([{ section: 'remotes.x', key: '', kind: 'array_table' }]);
  });

  it('引用符の中のドットはキーを分けない', () => {
    const parsed = parseToml('[s]\n"a.b" = true');

    expect(parsed.shapes).toEqual([]);
    expect(parsed.doc.get('s')?.get('a.b')).toBe(true);
  });

  it('普通の書き方は shapes を返さない', () => {
    expect(parseToml('[auth.external.github]\nenabled = true\nlist = ["a.b"]').shapes).toEqual([]);
  });
});

describe('parseToml: 複数行の文字列は閉じるまで読まない', () => {
  it('中の見出しや キー = 値 に見える行を設定として読まない', () => {
    const { doc, shapes } = parseToml('[auth.email]\nenable_signup = true\n[note]\ntext = """\n[auth.email]\nenable_signup = false\n"""\nafter = true');

    expect(doc.get('auth.email')?.get('enable_signup')).toBe(true);
    expect(doc.get('note')?.get('after')).toBe(true);
    expect(shapes).toEqual([{ section: 'note', key: 'text', kind: 'multiline_string' }]);
  });

  it('リテラルの複数行文字列(\'\'\')・1 行で閉じる 3 連引用符・閉じが後ろの行にある形', () => {
    expect(parseToml("[s]\nk = \'\'\'\nenabled = false\n\'\'\'\nz = 1").doc.get('s')?.get('z')).toBe(1);
    expect(parseToml('[s]\nk = """a"""\nz = 1').shapes.map((shape) => shape.kind)).toEqual(['multiline_string']);
    expect(parseToml('[s]\nk = """\nx\n  """ # c\nz = 1').doc.get('s')?.get('z')).toBe(1);
  });

  it('基本文字列の中のエスケープした引用符では閉じない', () => {
    const { doc } = parseToml('[s]\nk = """\na \\""" b\n[fake]\n"""\nz = 1');

    expect(doc.has('fake')).toBe(false);
    expect(doc.get('s')?.get('z')).toBe(1);
  });

  it('普通の文字列の途中の 3 連引用符は複数行の文字列として扱わない', () => {
    expect(parseToml("[s]\nk = \"it\'s \'\'\' ok\"\nz = 1").shapes).toEqual([]);
  });

  it('配列の中の複数行の文字列も拾う', () => {
    expect(parseToml('[s]\nk = ["""a\nb""", "c"]\nz = 1').shapes.map((shape) => shape.kind)).toEqual(['multiline_string']);
  });
});

describe('parseToml: エスケープを含む名前は復号して読み、shape にも返す', () => {
  it('キーのエスケープ(\\u0073)を復号して読む', () => {
    const { doc, shapes } = parseToml('[auth.email]\n"enable_\\u0073ignup" = true');

    expect(doc.get('auth.email')?.get('enable_signup')).toBe(true);
    expect(shapes).toEqual([{ section: 'auth.email', key: 'enable_signup', kind: 'escaped_name' }]);
  });

  it('セクション名・ドット付きのキーの引用符つきの部分も復号する', () => {
    expect(parseToml('["\\u0061uth".external.github]\nenabled = true').doc.get('auth.external.github')?.get('enabled')).toBe(true);
    expect(parseToml('"\\u0061uth".external.github.enabled = true').shapes.map((shape) => [shape.section, shape.key, shape.kind])).toEqual([
      ['', 'auth.external.github.enabled', 'escaped_name'],
      ['', 'auth.external.github.enabled', 'dotted_key'],
    ]);
  });

  it('エスケープの無い引用符つきの名前は shape にしない', () => {
    expect(parseToml('["auth".external.github]\n"enabled" = true').shapes).toEqual([]);
  });
});

describe('parseToml: 見出しでも キー = 値 でもない行は shape で返す', () => {
  it.each([
    ['見出しの後ろに文字', '[a.b] junk'],
    ['] の無い見出し', '[a.b'],
    ['= の無い行', 'junk'],
    ['見出しと キー = 値 の同居', '[a.b] enabled = true'],
    ['書けないキー', 'bad key = 1'],
  ])('%s', (_name, line) => {
    expect(parseToml(`[s]\n${line}`).shapes.map((shape) => shape.kind)).toEqual(['unrecognized_line']);
  });

  it('読めない行の後ろの行は、前のセクションに属したまま読む', () => {
    expect(parseToml('[s]\n[a.b\nk = true').doc.get('s')?.get('k')).toBe(true);
  });
});


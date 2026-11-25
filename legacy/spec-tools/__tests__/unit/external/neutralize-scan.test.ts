/**
 * アダプタの無害化の部品の呼び出しの走査(`neutralizeCallsIn`)のテスト。
 *
 * 数えるのは、呼び出し先の識別子が `@kaninabe/runtime/neutralize` の値の import に束縛されているものだけ。
 * 同名のローカル関数・隠した名前・別モジュール・型だけの import・default/名前空間 import・呼ばずに参照だけは数えない(負例)。
 */

import { describe, expect, it } from 'vitest';
import { neutralizeCallsIn } from '../../../lib/external/neutralize-scan.js';

const names = (source: string) => neutralizeCallsIn(source, 'adapter.ts').map((call) => call.name);

describe('neutralizeCallsIn: 数える形', () => {
  it('4 つの部品の呼び出し', () => {
    const source = [
      "import { neutralizeDiscordMentions, allowedDiscordMentionsOf, stripControlChars, clampLength } from '@kaninabe/runtime/neutralize';",
      'const a = neutralizeDiscordMentions(t); const b = allowedDiscordMentionsOf(p); const c = stripControlChars(t); const d = clampLength(t, 2000);',
    ].join('\n');
    expect(neutralizeCallsIn(source, 'adapter.ts')).toEqual([
      { name: 'neutralizeDiscordMentions', limit: null },
      { name: 'allowedDiscordMentionsOf', limit: null },
      { name: 'stripControlChars', limit: null },
      { name: 'clampLength', limit: 2000 },
    ]);
  });

  it('別名の import も数える(部品の名前で返す)', () => {
    expect(names("import { stripControlChars as strip } from '@kaninabe/runtime/neutralize'; strip(a);")).toEqual(['stripControlChars']);
  });

  it('clampLength の第 2 引数が数値リテラルなら値を持ち帰る(桁区切りも読む)', () => {
    expect(neutralizeCallsIn("import { clampLength } from '@kaninabe/runtime/neutralize'; clampLength(t, 2_000);", 'a.ts')).toEqual([{ name: 'clampLength', limit: 2000 }]);
  });

  it('clampLength の第 2 引数がリテラルでない・無いときは limit が null', () => {
    const source = "import { clampLength } from '@kaninabe/runtime/neutralize'; clampLength(t, MAX); clampLength(t);";
    expect(neutralizeCallsIn(source, 'a.ts')).toEqual([
      { name: 'clampLength', limit: null },
      { name: 'clampLength', limit: null },
    ]);
  });

  it('TSX のファイルも読める', () => {
    expect(neutralizeCallsIn("import { stripControlChars } from '@kaninabe/runtime/neutralize'; export const a = <p>{stripControlChars(x)}</p>;", 'a.tsx')).toHaveLength(1);
  });
});

describe('neutralizeCallsIn: 数えない形', () => {
  it.each([
    ['import が無い同名のローカル関数', 'function stripControlChars(t: string) { return t; } stripControlChars(a);'],
    ['別モジュールの同名 import', "import { stripControlChars } from './local'; stripControlChars(a);"],
    ['引数で隠した名前', "import { stripControlChars } from '@kaninabe/runtime/neutralize'; const f = (stripControlChars: (t: string) => string) => stripControlChars(a);"],
    ['型だけの import', "import type { stripControlChars } from '@kaninabe/runtime/neutralize'; stripControlChars(a);"],
    ['外部レビュー: if の中の var は関数スコープで隠す', "import { stripControlChars } from '@kaninabe/runtime/neutralize'; export function prepare(text: string) { if (true) { var stripControlChars = (v: string) => v; } return stripControlChars(text); }"],
    ['別名で import して同名の var が入れ子の try の中', "import { stripControlChars as strip } from '@kaninabe/runtime/neutralize'; export function prepare(text: string) { try { var strip = (v: string) => v; } finally { void 0; } return strip(text); }"],
    ['名前空間 import', "import * as n from '@kaninabe/runtime/neutralize'; n.stripControlChars(a);"],
    ['呼ばずに参照だけ', "import { stripControlChars } from '@kaninabe/runtime/neutralize'; const x = stripControlChars;"],
    ['語彙に無い export', "import { somethingElse } from '@kaninabe/runtime/neutralize'; somethingElse(a);"],
    ['import が無い', 'const x = 1;'],
  ])('%s', (_name, source) => {
    expect(names(source)).toEqual([]);
  });
});

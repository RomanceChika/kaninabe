/**
 * 実際に使われている import の指定子(`semantics/used-imports.ts`)のテスト。
 *
 * 起動口の閉包を「呼んでいる束縛」から始めるための目。値打ちは「import しただけ・型にだけ使う・副作用 import は
 * 使われたことにならない」「呼ぶ・値として渡す・再輸出する・動的に読むは使われたことになる」の線である。
 */

import { describe, expect, it } from 'vitest';
import { usedImportSpecifiers } from '../../../lib/semantics/used-imports.js';

/** 使われている指定子の昇順の並び。 */
function used(source: string, fileName = 'route.ts'): readonly string[] {
  return [...usedImportSpecifiers(fileName, source)].sort();
}

describe('usedImportSpecifiers', () => {
  describe('使われたことになる形', () => {
    it('呼び出し・値として渡す・参照・名前空間の参照', () => {
      const source = [
        "import { a } from './a';",
        "import { b } from './b';",
        "import c from './c';",
        "import * as d from './d';",
        'a();',
        'use(b);',
        'c.x;',
        'd.y();',
      ].join('\n');

      expect(used(source)).toEqual(['./a', './b', './c', './d']);
    });

    it('別名の import は、別名の側で使われていれば使われたことになる', () => {
      expect(used("import { a as alias } from './a';\nalias();")).toEqual(['./a']);
    });

    it('`export { A }` と `export { A as B }` は、束縛を外へ渡している(使用)', () => {
      expect(used("import { a } from './a';\nexport { a };")).toEqual(['./a']);
      expect(used("import { a } from './a';\nexport { a as GET };")).toEqual(['./a']);
    });

    it('オブジェクトの短縮記法・JSX のタグ・クラスの extends も使用', () => {
      expect(used("import { a } from './a';\nexport const x = { a };")).toEqual(['./a']);
      expect(used("import { A } from './a';\nexport const x = <A />;", 'route.tsx')).toEqual(['./a']);
      expect(used("import { Base } from './base';\nexport class X extends Base {}")).toEqual(['./base']);
    });

    it('再輸出・動的 import・require は、式そのものが読み込みなので使用', () => {
      const source = ["export { r } from './r';", "export * from './s';", "const m = import('./m');", "const q = require('./q');"].join('\n');

      expect(used(source)).toEqual(['./m', './q', './r', './s']);
    });

    it('`import x = require()` は束縛が使われていれば使用', () => {
      expect(used("import x = require('./x');\nx();")).toEqual(['./x']);
      expect(used("import x = require('./x');\nexport const y = 1;")).toEqual([]);
    });

    it('同じ指定子の 2 本の import のうち、片方が使われていれば指定子は使用', () => {
      expect(used("import { a } from './m';\nimport { b } from './m';\nb();")).toEqual(['./m']);
    });
  });

  describe('使われたことにならない形', () => {
    it('束縛が式に 1 度も現れない import', () => {
      expect(used("import { a } from './a';\nexport const x = 1;")).toEqual([]);
    });

    it('型だけの import(`import type`・全部 `type` の指定子・型の指定子だけ使う混在)', () => {
      expect(used("import type { T } from './t';\nlet x: T;")).toEqual([]);
      expect(used("import { type T } from './t';\nlet x: T;")).toEqual([]);
      expect(used("import { type T, a } from './t';\nlet x: T;\nvoid 0;")).toEqual([]);
    });

    it('副作用 import(束縛が無いので、呼んでいるとは言えない)', () => {
      expect(used("import './side';\nexport const x = 1;")).toEqual([]);
    });

    it('型の位置(注釈・`as`・`typeof` の型・`implements`・interface の extends)にだけ現れる', () => {
      const source = [
        "import { a, b, c, d, e } from './m';",
        'let x: a;',
        'const y = 1 as b;',
        'type T = typeof c;',
        'class K implements d {}',
        'interface I extends e {}',
      ].join('\n');

      expect(used(source)).toEqual([]);
    });

    it('プロパティ名・宣言の名前・分割代入の元の名前は参照ではない', () => {
      const source = [
        "import { a } from './m';",
        'const o = { a: 1 };',
        'o.a;',
        'const { a: renamed } = o;',
        'class K { a = 1; }',
      ].join('\n');

      expect(used(source)).toEqual([]);
    });

    it('`export { x as a }`(別の名前で輸出するだけ)の輸出名側は参照ではない', () => {
      expect(used("import { a } from './m';\nconst x = 1;\nexport { x as a };")).toEqual([]);
    });
  });
});

/**
 * 実装走査(K1 の材料)の抽出規則のユニットテスト。
 *
 * 拾い方の正は config-spec-writing.md §拾える書き方:
 *   - `process.env.NAME` / `process.env['NAME']` / `requireEnv('NAME')` を拾う
 *   - 環境変数の形(SCREAMING_SNAKE)でないものは拾わない
 *   - 変数越しの参照は拾えない(拾えない書き方をしないことを規約が要求する)
 *
 * 置き場の読み口(`vocabulary.target[].read_by`)の走査は**I/O 境界そのもの**なので、
 * 一時ディレクトリに実ファイルを書いて実行する(検証器のテストと違いモデルを組めない)。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractEnvNames, scanTargetReaders } from '../../../lib/config/env-scan.js';

describe('実装からの設定参照の抽出', () => {
  it('ドット記法・添字記法・requireEnv の 3 形を拾う', () => {
    const source = [
      "const a = process.env.CRON_SECRET;",
      "const b = process.env['SUPABASE_URL'];",
      "const c = requireEnv('SUPABASE_ANON_KEY');",
    ].join('\n');
    expect([...extractEnvNames(source)].sort()).toEqual([
      'CRON_SECRET',
      'SUPABASE_ANON_KEY',
      'SUPABASE_URL',
    ]);
  });

  it('同じ名前が複数回出ても 1 つにまとめる', () => {
    const source = "process.env['SUPABASE_URL'] + process.env.SUPABASE_URL";
    expect(extractEnvNames(source)).toEqual(['SUPABASE_URL']);
  });

  it('環境変数の形でないものは拾わない', () => {
    expect(extractEnvNames('process.env.nodeEnv')).toEqual([]);
  });

  it('変数越しの参照は拾えない(名前がその場に無いため)', () => {
    expect(extractEnvNames('const value = process.env[name];')).toEqual([]);
  });

  it('参照が 1 つも無ければ空', () => {
    expect(extractEnvNames('export const answer = 42;')).toEqual([]);
  });
});

describe('置き場の読み口からの設定参照の抽出', () => {
  /** 一時ディレクトリに workflow を 1 本書き、走査してから片付ける。 */
  function withWorkflow<T>(body: string, run: (root: string) => T): T {
    const root = mkdtempSync(join(tmpdir(), 'config-read-by-'));
    try {
      mkdirSync(join(root, '.github/workflows'), { recursive: true });
      writeFileSync(join(root, '.github/workflows/ci.yml'), body);
      return run(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  /** CI の読み口を宣言した置き場(probe はこの走査では使わない)。 */
  const CI_TARGET = {
    id: 'ci',
    probe: { kind: 'command', argv: ['gh', 'secret', 'list'] },
    readBy: { kind: 'workflow_secret', path: '.github/workflows' },
  } as const;

  it('workflow の secrets.NAME を、その置き場の参照として拾う', () => {
    const body = ['env:', '  A: ${{ secrets.SUPABASE_ACCESS_TOKEN }}', '  B: ${{ secrets.SUPABASE_DB_PASSWORD }}'].join(
      '\n',
    );
    const result = withWorkflow(body, (root) => scanTargetReaders(root, [CI_TARGET]));
    expect(result.scanned).toEqual(['ci']);
    expect(result.references.map((reference) => reference.name)).toEqual([
      'SUPABASE_ACCESS_TOKEN',
      'SUPABASE_DB_PASSWORD',
    ]);
    expect(result.references[0]?.target).toBe('ci');
    expect(result.references[0]?.file).toBe('.github/workflows/ci.yml');
  });

  it('read_by を宣言していない置き場は走査しない', () => {
    const target = { id: 'local', probe: { kind: 'dotenv', path: 'app/.env.local' } } as const;
    const result = withWorkflow('env: {}', (root) => scanTargetReaders(root, [target]));
    expect(result).toEqual({ scanned: [], references: [] });
  });

  it('read_by の場所が無い環境では、その置き場を走査済みにしない', () => {
    const root = mkdtempSync(join(tmpdir(), 'config-read-by-'));
    try {
      expect(scanTargetReaders(root, [CI_TARGET])).toEqual({ scanned: [], references: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const GATE_IMPORT = "import { readConfigUrl } from '@kaninabe/runtime/url';";

describe('countUrlReads(URL の設定の読み口の数え上げ)', () => {
  it('関門を通した読みは素の参照 1 回と関門 1 回に数え、素の参照が余れば差が出る', async () => {
    const { countUrlReads } = await import('../../../lib/config/url-read-scan.js');
    const source = [
      GATE_IMPORT,
      "const a = readConfigUrl('HOOK_URL', process.env['HOOK_URL'], 'https');",
      "const b = process.env['HOOK_URL'];",
      "const c = readConfigUrl('API_URL', process.env['API_URL'], 'https_or_loopback');",
      "const d = requireEnv('OTHER_URL');",
    ].join('\n');

    expect(countUrlReads(source, 'x.ts')).toEqual([
      { name: 'HOOK_URL', file: 'x.ts', raw: 2, guarded: ['https'] },
      { name: 'API_URL', file: 'x.ts', raw: 1, guarded: ['https_or_loopback'] },
      { name: 'OTHER_URL', file: 'x.ts', raw: 1, guarded: [] },
    ]);
  });

  it('第 1 引数と環境の名前が食い違う書き方は関門に数えない(素の参照のまま残って K4 が落とす)', async () => {
    const { countUrlReads } = await import('../../../lib/config/url-read-scan.js');
    const source = `${GATE_IMPORT}\nconst a = readConfigUrl('A_URL', process.env['B_URL'], 'https');`;

    expect(countUrlReads(source, 'x.ts')).toEqual([{ name: 'B_URL', file: 'x.ts', raw: 1, guarded: [] }]);
  });

  it('scheme が小文字と下線以外(式)なら関門に数えない', async () => {
    const { countUrlReads } = await import('../../../lib/config/url-read-scan.js');
    const source = `${GATE_IMPORT}\nconst a = readConfigUrl('A_URL', process.env['A_URL'], SCHEME);`;

    expect(countUrlReads(source, 'x.ts')).toEqual([{ name: 'A_URL', file: 'x.ts', raw: 1, guarded: [] }]);
  });

  it.each([
    ['別名の import', "import { readConfigUrl as r } from '@kaninabe/runtime/url';\nconst a = r('A_URL', process.env['A_URL'], 'https');", ['https']],
    ['ドット形の process.env', `${GATE_IMPORT}\nconst a = readConfigUrl('A_URL', process.env.A_URL, 'https_or_loopback');`, ['https_or_loopback']],
    ['改行・末尾カンマ', `${GATE_IMPORT}\nconst a = readConfigUrl(\n  'A_URL',\n  process.env['A_URL'],\n  'https',\n);`, ['https']],
  ])('束縛で関門に数える: %s', async (_name, source, guarded) => {
    const { countUrlReads } = await import('../../../lib/config/url-read-scan.js');
    expect(countUrlReads(source, 'x.ts')).toEqual([{ name: 'A_URL', file: 'x.ts', raw: 1, guarded }]);
  });

  it.each([
    ['外部レビュー 反例: 同名のローカル関数', "function readConfigUrl(_n: string, v: string | undefined, _s: string) { return v; }\nconst a = readConfigUrl('A_URL', process.env['A_URL'], 'https');"],
    ['import が無い(宣言の無い readConfigUrl)', "const a = readConfigUrl('A_URL', process.env['A_URL'], 'https');"],
    ['別モジュールの readConfigUrl', "import { readConfigUrl } from './my-url';\nconst a = readConfigUrl('A_URL', process.env['A_URL'], 'https');"],
    ['正しいモジュールの別の export を別名で偽装', "import { safeHttpUrl as readConfigUrl } from '@kaninabe/runtime/url';\nconst a = readConfigUrl('A_URL', process.env['A_URL'], 'https');"],
    ['型だけの import', "import type { readConfigUrl } from '@kaninabe/runtime/url';\nconst a = readConfigUrl('A_URL', process.env['A_URL'], 'https');"],
    ['関数の引数で隠した readConfigUrl', `${GATE_IMPORT}\nconst f = (readConfigUrl: (...a: unknown[]) => string) => readConfigUrl('A_URL', process.env['A_URL'], 'https');`],
    ['ローカル変数で隠した readConfigUrl', `${GATE_IMPORT}\nfunction g() { const readConfigUrl = (..._a: unknown[]) => 'x'; return readConfigUrl('A_URL', process.env['A_URL'], 'https'); }`],
    ['外部レビュー: 同名の名前つき関数式の中の自己呼び出し', `${GATE_IMPORT}\nconst a = (function readConfigUrl(_n?: string, v?: string, _s?: string): string | undefined { if (arguments.length > 0) return v; return readConfigUrl('A_URL', process.env['A_URL'], 'https'); })();`],
    ['外部レビュー: 入れ子ブロックの var で隠した readConfigUrl', `${GATE_IMPORT}\nfunction g() { if (true) { var readConfigUrl = (..._a: unknown[]) => 'x'; } return readConfigUrl('A_URL', process.env['A_URL'], 'https'); }`],
    ['同名の名前つきクラス式の中', `${GATE_IMPORT}\nconst C = class readConfigUrl { m() { return readConfigUrl; } };\nconst a = process.env['A_URL'];`],
    ['名前空間 import 越し', "import * as u from '@kaninabe/runtime/url';\nconst a = u.readConfigUrl('A_URL', process.env['A_URL'], 'https');"],
    ['第 2 引数を包む(as)', `${GATE_IMPORT}\nconst a = readConfigUrl('A_URL', process.env['A_URL'] as string, 'https');`],
    ['第 2 引数に || で別の値を足す', `${GATE_IMPORT}\nconst a = readConfigUrl('A_URL', process.env['A_URL'] || 'http://evil', 'https');`],
    ['引数が 4 つ', `${GATE_IMPORT}\nconst a = readConfigUrl('A_URL', process.env['A_URL'], 'https', 'extra');`],
    ['第 1 引数が文字列でない', `${GATE_IMPORT}\nconst a = readConfigUrl(NAME, process.env['A_URL'], 'https');`],
    ['コメント・文字列の中の呼び出し', `${GATE_IMPORT}\n// readConfigUrl('A_URL', process.env['A_URL'], 'https')\nconst s = "readConfigUrl('A_URL', process.env['A_URL'], 'https')"; const r = process.env['A_URL'];`],
  ])('束縛できない・形が違う読みは関門に数えない: %s', async (_name, source) => {
    const { countUrlReads } = await import('../../../lib/config/url-read-scan.js');
    const reads = countUrlReads(source, 'x.ts');
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) expect(read.guarded, source).toEqual([]);
  });

  it('設定の参照が無いファイルは空', async () => {
    const { countUrlReads } = await import('../../../lib/config/url-read-scan.js');
    expect(countUrlReads('export const x = 1;', 'x.ts')).toEqual([]);
  });
});

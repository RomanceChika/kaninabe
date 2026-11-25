/**
 * CLI の根の決め方(`requireRepoRoot` と `cli/repo-root.ts`)のテスト。
 *
 * 根は**作業ディレクトリから上へ `product.md` を探して**決め、`--root` で上書きできる。
 * 見つからなければ**黙って別の場所に落ちず**、人に読ませる文言で止まる(束 分離 ②-a)。
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { invocationDir, resolveRepoRoot, withoutRootOption } from '../../../cli/repo-root.js';
import { requireRepoRoot, PRODUCT_DECL_FILE } from '../../../lib/io/paths.js';
import { ROOT_MESSAGES, ROOT_OPTION_HELP } from '../../../lib/io/messages.js';

const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 一時ディレクトリを作る(macOS の `/var` → `/private/var` の別名を畳んだ実パスで返す)。 */
function temp(): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'repo-root-')));
  created.push(dir);
  return dir;
}

/** 宣言ファイルを持つ木と、その奥のディレクトリを作る。 */
function productTree(): { root: string; deep: string } {
  const root = temp();
  writeFileSync(path.join(root, PRODUCT_DECL_FILE), '---\ndoc_type: product_roots\n---\n');
  const deep = path.join(root, 'docs', 'sub');
  mkdirSync(deep, { recursive: true });
  return { root, deep };
}

describe('requireRepoRoot', () => {
  it('起点から上へ宣言を探して、宣言のあるディレクトリを返す', () => {
    const { root, deep } = productTree();

    expect(requireRepoRoot(deep)).toBe(root);
    expect(requireRepoRoot(root)).toBe(root);
  });

  it('見つからなければ投げる(起点の親へ黙って落ちない)。文面は起点と宣言ファイルの名前を示す', () => {
    const empty = temp();

    expect(() => requireRepoRoot(empty)).toThrow(ROOT_MESSAGES.notFound(empty, PRODUCT_DECL_FILE));
    expect(ROOT_MESSAGES.notFound(empty, PRODUCT_DECL_FILE)).toContain('--root');
  });
});

describe('resolveRepoRoot', () => {
  it('引数が無ければ作業ディレクトリから上へ探す', () => {
    const { root, deep } = productTree();

    expect(resolveRepoRoot([], deep)).toEqual({ ok: true, root });
  });

  it('作業ディレクトリの上に宣言が無ければ文言つきで失敗する', () => {
    const empty = temp();

    expect(resolveRepoRoot([], empty)).toEqual({ ok: false, message: ROOT_MESSAGES.notFound(empty, PRODUCT_DECL_FILE) });
  });

  it('--root は作業ディレクトリの探索より優先し、相対パスは作業ディレクトリから解く', () => {
    const { root } = productTree();
    const elsewhere = temp();

    expect(resolveRepoRoot(['--root', root], elsewhere)).toEqual({ ok: true, root });
    expect(resolveRepoRoot(['--root', path.relative(elsewhere, root)], elsewhere)).toEqual({ ok: true, root });
  });

  it('--root が指す場所に宣言が無ければ失敗する(上へは探さない)', () => {
    const { deep } = productTree();

    expect(resolveRepoRoot(['--root', deep], deep)).toEqual({
      ok: false,
      message: ROOT_MESSAGES.noDeclarationAt(deep, PRODUCT_DECL_FILE),
    });
  });

  it('--root=<path>(`=` 区切り)も同じに解く(黙って無視しない)', () => {
    const { root, deep } = productTree();
    const elsewhere = temp();

    expect(resolveRepoRoot([`--root=${root}`], elsewhere)).toEqual({ ok: true, root });
    expect(resolveRepoRoot([`--root=${path.relative(elsewhere, root)}`], elsewhere)).toEqual({ ok: true, root });
    expect(resolveRepoRoot([`--root=${deep}`], deep)).toEqual({
      ok: false,
      message: ROOT_MESSAGES.noDeclarationAt(deep, PRODUCT_DECL_FILE),
    });
  });

  it('--root= に値が無ければ失敗する', () => {
    const { root } = productTree();

    expect(resolveRepoRoot(['--root='], root)).toEqual({ ok: false, message: ROOT_MESSAGES.missingValue });
  });

  it('失敗の文言は末尾に --root の説明(ROOT_OPTION_HELP の 1 本)を添える', () => {
    const { deep } = productTree();
    const empty = temp();

    expect(ROOT_MESSAGES.missingValue).toContain(ROOT_OPTION_HELP);
    expect(ROOT_MESSAGES.noDeclarationAt(deep, PRODUCT_DECL_FILE)).toContain(ROOT_OPTION_HELP);
    expect(ROOT_MESSAGES.notFound(empty, PRODUCT_DECL_FILE)).toContain(ROOT_OPTION_HELP);
  });

  it('--root に値が無ければ失敗する', () => {
    const { root } = productTree();

    expect(resolveRepoRoot(['--root'], root)).toEqual({ ok: false, message: ROOT_MESSAGES.missingValue });
    expect(resolveRepoRoot(['--root', '--check'], root)).toEqual({ ok: false, message: ROOT_MESSAGES.missingValue });
  });
});

describe('invocationDir(呼ばれた場所)', () => {
  it('INIT_CWD(npm が起動された場所)があればそこ、無ければ作業ディレクトリ', () => {
    const { root, deep } = productTree();

    expect(invocationDir({ INIT_CWD: root }, deep)).toBe(root);
    expect(invocationDir({}, deep)).toBe(deep);
  });

  it('INIT_CWD が空文字なら無いものとして扱う', () => {
    const { deep } = productTree();

    expect(invocationDir({ INIT_CWD: '' }, deep)).toBe(deep);
  });

  it('既定の引数は process.env と process.cwd()(INIT_CWD が無ければ作業ディレクトリと一致する)', () => {
    const saved = process.env['INIT_CWD'];
    delete process.env['INIT_CWD'];
    try {
      expect(invocationDir()).toBe(process.cwd());
      process.env['INIT_CWD'] = process.cwd();
      expect(invocationDir()).toBe(path.resolve(process.cwd()));
    } finally {
      if (saved === undefined) delete process.env['INIT_CWD'];
      else process.env['INIT_CWD'] = saved;
    }
  });
});

describe('withoutRootOption', () => {
  it('--root とその値だけを取り除き、ほかの引数は順序ごと残す', () => {
    expect(withoutRootOption(['rooms', '--root', '/x', '--no-restore'])).toEqual(['rooms', '--no-restore']);
    expect(withoutRootOption(['a', 'b'])).toEqual(['a', 'b']);
    // `=` 区切りは 1 つの引数なので、その引数だけが落ちる。
    expect(withoutRootOption(['rooms', '--root=/x', '--no-restore'])).toEqual(['rooms', '--no-restore']);
  });
});

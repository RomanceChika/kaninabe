/**
 * P14: 実装の範囲は広がる向きにしか動かせない(base の宣言と、仕様の id で比べる)。
 *
 * 比べるのは path の増減ではなく**同じ仕様が範囲に残っているか**である。
 *   - 広がった(base の id が全部残っている)→ 通る
 *   - base にあった id が消え、その仕様がまだある → P14(error)
 *   - base にあった id が消え、仕様も無い(廃止・改名)→ 通る。ただし**件数は 1 行に数える**(改名は「仕様から消えた」と見分けがつかない)
 *   - head にキーが無い(範囲が「全部」になる)→ 通る(広がる向き)
 *   - base の file が読めない・YAML が壊れている・`implemented` が壊れている → **error。読み飛ばさない**(比べられないまま通さない)
 *   - base にキーが無い → error ではなく 1 行(キーを入れるのは持ち主が承認する基準の変更。N1)
 *   - **「仕様から消えた」と数えるのは、head でその種類を error なく読めたときだけ**(`unloaded` = 読めなかった種類)。読めなかった種類が
 *     あるとき、owners に居ない base の id は、消えたのか読めないだけなのか分からないので P14(error)にする
 * 1 行の文面に **id は出さない**(公開の log に載りうる。件数だけ)。
 *
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ScopeOwner } from '../../../lib/kernel/scope-owner.js';
import type { ProductImplemented } from '../../../lib/model/product/implemented.js';
import type { SpecKind } from '../../../lib/model/product/uses.js';
import { readBaseScope } from '../../../lib/scope/base.js';
import { verifyNarrowing } from '../../../lib/scope/verifiers/p14-narrowing.js';

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 仕様がいま在る持ち主(head の木から数えた一覧の代わり)。 */
const OWNERS: readonly ScopeOwner[] = [
  { kind: 'action', id: 'room-create-action' },
  { kind: 'action', id: 'room-delete-action' },
  { kind: 'screen', id: 'screen-room-admin' },
];

/** base の product.md を書き、そのパスを返す。 */
function baseFile(frontmatterTail: readonly string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'p14-base-'));
  created.push(dir);
  const file = path.join(dir, 'product.md');
  writeFileSync(
    file,
    ['---', 'doc_type: product_roots', 'scope: common', 'id: product-roots', 'name: test-product', 'roots:', '  specs: spec', '  book: read', '  generated: impl/src/generated', '  migrations: db/migrations', 'uses:', '  - actions', ...frontmatterTail, '---', ''].join('\n'),
  );
  return file;
}

/** base を読んで head と比べる。 */
function narrowing(base: string, head: ProductImplemented, owners: readonly ScopeOwner[] = OWNERS, unloaded: readonly SpecKind[] = [], invariantsUnloaded = false) {
  return verifyNarrowing({ head, base: readBaseScope(base), owners, unloaded, invariantsUnloaded });
}

describe('P14 範囲は広がる向きにしか動かない', () => {
  it('広がった(base の id が全部残り、足された)→ 通る', () => {
    const base = baseFile(['implemented:', '  - room-create-action']);

    const result = narrowing(base, { declared: true, ids: ['room-create-action', 'room-delete-action'] });

    expect(result.findings).toEqual([]);
  });

  it('変わらない → 通る', () => {
    const base = baseFile(['implemented:', '  - room-create-action']);

    expect(narrowing(base, { declared: true, ids: ['room-create-action'] }).findings).toEqual([]);
  });

  it('base の id が消え、その仕様がまだある → P14(消えた id を名指す)', () => {
    const base = baseFile(['implemented:', '  - room-create-action', '  - room-delete-action']);

    const result = narrowing(base, { declared: true, ids: ['room-create-action'] });

    expect(result.findings.map((finding) => [finding.verifier, finding.severity])).toEqual([['P14', 'error']]);
    expect(result.findings[0]?.message).toBe('base の実装の範囲にあった room-delete-action が範囲から消えています(仕様を廃止するときだけ消せます)');
  });

  it('base の id を全部消して `[]` にしても、仕様がまだあれば全部 P14', () => {
    const base = baseFile(['implemented:', '  - room-create-action', '  - screen-room-admin']);

    const result = narrowing(base, { declared: true, ids: [] });

    expect(result.findings.map((finding) => finding.verifier)).toEqual(['P14', 'P14']);
  });

  it('base の id が消え、仕様も無い → 通る。件数(2 件)は 1 行に数え、id は書かない', () => {
    const base = baseFile(['implemented:', '  - room-create-action', '  - room-retired-action', '  - room-renamed-action']);

    const result = narrowing(base, { declared: true, ids: ['room-create-action'] });

    expect(result.findings).toEqual([]);
    expect(result.gone).toBe(2);
    expect(result.note).toContain('2 件');
    expect(result.note).not.toContain('room-retired-action');
    expect(result.note).not.toContain('room-renamed-action');
  });

  it('消えた id が 1 件なら「1 件」と言う(件数と単位が揃う)', () => {
    const base = baseFile(['implemented:', '  - room-create-action', '  - room-retired-action']);

    const result = narrowing(base, { declared: true, ids: ['room-create-action'] });

    expect(result.gone).toBe(1);
    expect(result.note).toContain('1 件');
  });

  it('消えた id が 0 件なら、数える行は出さない(宣言のある base と比べて何も無いときに log を増やさない)', () => {
    const base = baseFile(['implemented:', '  - room-create-action']);

    const result = narrowing(base, { declared: true, ids: ['room-create-action'] });

    expect(result.gone).toBe(0);
    expect(result.note).toBeNull();
  });

  it('head にキーが無い(範囲が全部になる)→ 通る', () => {
    const base = baseFile(['implemented:', '  - room-create-action']);

    expect(narrowing(base, { declared: false }).findings).toEqual([]);
  });

  it('base が `implemented: []` なら、head が何であれ通る(狭めようがない)', () => {
    const base = baseFile(['implemented: []']);

    expect(narrowing(base, { declared: true, ids: [] }).findings).toEqual([]);
  });
});

describe('head で読めなかった種類(unloaded)の id は「仕様から消えた」と数えない', () => {
  it('読めなかった種類があり、base の id が owners に居ない → P14(消えたのか読めないだけなのか分からない)', () => {
    const base = baseFile(['implemented:', '  - room-create-action', '  - room-retired-action']);

    const result = narrowing(base, { declared: true, ids: ['room-create-action'] }, [], ['actions']);

    expect(result.findings.map((finding) => [finding.verifier, finding.severity])).toEqual([['P14', 'error'], ['P14', 'error']]);
    expect(result.gone).toBe(0);
  });

  it('読めなかった種類があっても、head に残っている id は通る(owners が空でも、head の宣言に載っている id は狭まっていない)', () => {
    const base = baseFile(['implemented:', '  - room-create-action']);

    expect(narrowing(base, { declared: true, ids: ['room-create-action'] }, [], ['actions']).findings).toEqual([]);
  });

  it('読めなかった種類があっても、owners に居る id が消えていれば、いつもの P14(消えた id を名指す)', () => {
    const base = baseFile(['implemented:', '  - room-create-action', '  - room-delete-action']);

    const result = narrowing(base, { declared: true, ids: ['room-create-action'] }, OWNERS, ['queries']);

    expect(result.findings.map((finding) => finding.message)).toEqual(['base の実装の範囲にあった room-delete-action が範囲から消えています(仕様を廃止するときだけ消せます)']);
  });

  it('全部の種類を error なく読めていれば(unloaded が空)、owners に居ない id は「仕様から消えた」で通る', () => {
    const base = baseFile(['implemented:', '  - room-create-action', '  - room-retired-action']);

    expect(narrowing(base, { declared: true, ids: ['room-create-action'] }, OWNERS, []).findings).toEqual([]);
  });

  it('head の宣言が無い(範囲が全部)ときは、読めなかった種類があっても通る(広がる向き)', () => {
    const base = baseFile(['implemented:', '  - room-create-action']);

    expect(narrowing(base, { declared: false }, [], ['actions']).findings).toEqual([]);
  });
});

describe('不変条件(ドメイン仕様)の読み込みの失敗(invariantsUnloaded)', () => {
  it('不変条件を読めなかったとき、持ち主に居ない base の id は P14(消えたのか読めないだけなのか分からない)', () => {
    const base = baseFile(['implemented:', '  - room-create-action', '  - INV-ROOM-001']);

    const result = narrowing(base, { declared: true, ids: ['room-create-action'] }, OWNERS, [], true);

    expect(result.findings.map((finding) => finding.verifier)).toEqual(['P14', 'P14']);
    expect(result.gone).toBe(0);
  });

  it('集約の error の文は、読めなかったものを「ドメイン仕様」と呼ぶ(不変条件に限らない読み込みの error なので、欄の名前を言わない)', () => {
    const base = baseFile(['implemented:', '  - INV-ROOM-001']);

    const messages = narrowing(base, { declared: true, ids: [] }, OWNERS, [], true).findings.map((finding) => finding.message);

    expect(messages.some((message) => message.includes('ドメイン仕様'))).toBe(true);
    expect(messages.some((message) => message.includes('invariants'))).toBe(false);
  });

  it('読めていれば(false)、同じ id は「仕様から消えた」で通る', () => {
    const base = baseFile(['implemented:', '  - room-create-action', '  - INV-ROOM-001']);

    const result = narrowing(base, { declared: true, ids: ['room-create-action'] }, OWNERS, [], false);

    expect(result.findings).toEqual([]);
    expect(result.gone).toBe(1);
  });

  it('head の宣言が無ければ(範囲が全部)、読めなくても通る', () => {
    expect(narrowing(baseFile(['implemented:', '  - INV-ROOM-001']), { declared: false }, [], [], true).findings).toEqual([]);
  });
});

describe('比べられない base は error(読み飛ばさない)', () => {
  it('base の file が読めない', () => {
    const missing = path.join(tmpdir(), 'p14-no-such-dir', 'product.md');

    const result = narrowing(missing, { declared: true, ids: ['room-create-action'] });

    expect(result.findings.map((finding) => [finding.verifier, finding.severity])).toEqual([['P14', 'error']]);
  });

  it('base の YAML が壊れている', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'p14-base-'));
    created.push(dir);
    const file = path.join(dir, 'product.md');
    writeFileSync(file, '---\nroots: [unclosed\n---\n');

    const result = narrowing(file, { declared: true, ids: [] });

    expect(result.findings.map((finding) => [finding.verifier, finding.severity])).toEqual([['P14', 'error']]);
  });

  it('base の frontmatter が無い', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'p14-base-'));
    created.push(dir);
    const file = path.join(dir, 'product.md');
    writeFileSync(file, '# 宣言なし\n');

    expect(narrowing(file, { declared: true, ids: [] }).findings.map((finding) => finding.verifier)).toEqual(['P14']);
  });

  it.each([
    ['値が無い', ['implemented:']],
    ['リストでない', ['implemented: room-create-action']],
    ['文字列でない要素', ['implemented:', '  - 1']],
    ['重複', ['implemented:', '  - room-create-action', '  - room-create-action']],
  ])('base の implemented が壊れている(%s)', (_label, tail) => {
    const result = narrowing(baseFile(tail), { declared: true, ids: ['room-create-action'] });

    expect(result.findings.map((finding) => [finding.verifier, finding.severity])).toEqual([['P14', 'error']]);
  });

  it('壊れた base は、head が何であっても(宣言なしでも)通さない', () => {
    const missing = path.join(tmpdir(), 'p14-no-such-dir', 'product.md');

    expect(narrowing(missing, { declared: false }).findings.map((finding) => finding.verifier)).toEqual(['P14']);
  });
});

describe('base にキーが無い', () => {
  it('error にはせず、1 行だけ言う(キーを入れる変更は持ち主が承認する基準の変更)', () => {
    const base = baseFile([]);

    const result = narrowing(base, { declared: true, ids: ['room-create-action'] });

    expect(result.findings).toEqual([]);
    expect(result.note).not.toBeNull();
    expect(result.note).not.toContain('room-create-action');
    // CLI の通しの試験が行を見つける手がかり: base と実装の範囲を名指す 1 行。
    expect(result.note).toContain('base');
    expect(result.note).toContain('実装の範囲');
  });

  it('head にも無ければ、何も言わない', () => {
    const result = narrowing(baseFile([]), { declared: false });

    expect(result.findings).toEqual([]);
    expect(result.note).toBeNull();
  });
});

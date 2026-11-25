/**
 * 読めずに落とした data_table の entity 名(`DataTableSpecModel.droppedEntities`)を、実ローダーで確かめる。
 *
 * 落とした表の ID の名前空間(`TC-EQ-{ENTITY}-…`)は、表名(複数形)ではなく entity 名(単数形)で決まる。
 * 表の宣言は信用しないが、フロントマターの `entity` は名前だけ読む。読めたものだけを載せ、読めなければ載せない
 * (単数形を表名から推測しない)。
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readMatter, stringifyMatter } from '../../helpers/front-matter.js';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDataTableSpecModel } from '../../../lib/model/data/loader.js';

const SAMPLES = path.resolve(import.meta.dirname, '../../fixtures/samples');
const REPO_ROOT = path.resolve(import.meta.dirname, '../../fixtures');

type Data = Record<string, unknown>;

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 題材の表 1 枚の写しを置き場に置いて読む(`edit` で壊す)。 */
function load(edit: (data: Data) => void) {
  const parsed = readMatter(readFileSync(path.join(SAMPLES, 'stores/docs/specs/backend/data/tables/shelves.md'), 'utf8'));
  const data = structuredClone(parsed.data) as Data;
  edit(data);
  const dir = mkdtempSync(path.join(tmpdir(), 'dropped-entities-'));
  created.push(dir);
  mkdirSync(path.join(dir, 'tables'));
  writeFileSync(path.join(dir, 'tables', 'shelves.md'), stringifyMatter('\n# 本文\n', data));
  return loadDataTableSpecModel(path.join(dir, 'tables'), { repoRoot: REPO_ROOT });
}

describe('落とした表の entity 名(droppedEntities)', () => {
  it('正常な表は落とさないので、droppedEntities は無い', () => {
    const loaded = load(() => undefined);

    expect(loaded.dropped).toBe(0);
    expect(loaded.model.droppedTables).toBeUndefined();
    expect(loaded.model.droppedEntities).toBeUndefined();
  });

  it('行を落とした表は、フロントマターの entity 名(単数形)を droppedEntities に載せる', () => {
    const loaded = load((data) => delete (data['triggers'] as Data[])[0]!['name']);

    expect(loaded.model.droppedTables).toEqual(['shelves.md']);
    expect(loaded.model.droppedEntities).toEqual({ 'shelves.md': 'shelf' });
  });

  it('表そのものを読めずに落とした(table が無い)ときも、フロントマターに entity があれば載せる', () => {
    const loaded = load((data) => delete data['table']);

    expect(loaded.model.droppedTables).toEqual(['shelves.md']);
    expect(loaded.model.droppedEntities).toEqual({ 'shelves.md': 'shelf' });
  });

  it('entity が文字列でない・空のときは載せない(単数形を推測しない)', () => {
    for (const entity of [5, '']) {
      const loaded = load((data) => {
        data['entity'] = entity;
        delete data['table'];
      });

      expect(loaded.model.droppedTables).toEqual(['shelves.md']);
      expect(loaded.model.droppedEntities).toBeUndefined();
    }
  });
});

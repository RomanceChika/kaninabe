/**
 * 生成器が置き場の配置から役割の位置を引く口(`layout-placement.ts`)のテスト。
 *
 * 決められなければ空を黙って返さず、前提の失敗(`preconditionFailure`。先に見るべき検査 J2 を示す)で止まる。
 * 失敗の文面は、何の置き場か・どの役割とキーか・配置がその役割を宣言しているか、を名指す。
 */

import { describe, expect, it } from 'vitest';
import { GeneratorPreconditionError } from '../../../lib/kernel/generator-precondition.js';
import { placedModule, placedPath } from '../../../lib/generate/layout-placement.js';
import type { Placement } from '../../../lib/generate/layout-placement.js';
import { EMPTY_LAYOUT } from '../../../lib/model/product/layout.js';
import { FOREIGN_LAYOUT, TEST_LAYOUT } from '../../helpers/platform.js';

const LOCATION = { file: 'docs/specs/backend/external.md', pointer: 'integrations.x' } as const;
const entry: Placement = { role: 'http-entry', key: '/api/x', what: '外部連携 x の受信口', location: LOCATION };

/** 止まったときの例外(止まらなければテストの失敗)。 */
function stopped(act: () => unknown): GeneratorPreconditionError {
  try {
    act();
  } catch (error) {
    if (error instanceof GeneratorPreconditionError) return error;
    throw error;
  }
  throw new Error('止まらなかった');
}

describe('placedPath / placedModule', () => {
  it('配置が決める位置と import の指定を返す(製品の根が空文字なら製品の根からの相対)', () => {
    expect(placedPath(TEST_LAYOUT, { app: 'app' }, entry)).toBe('app/src/app/api/x/route.ts');
    expect(placedPath(TEST_LAYOUT, { app: '' }, entry)).toBe('src/app/api/x/route.ts');
    expect(placedModule(TEST_LAYOUT, entry)).toBe('@/app/api/x/route');
    expect(placedPath(FOREIGN_LAYOUT, { app: 'app' }, entry)).toBe('app/server_code/endpoints/api/x.handler.ts');
    expect(placedModule(FOREIGN_LAYOUT, entry)).toBe('~srv/endpoints/api/x.handler');
  });

  it('決められなければ前提の失敗で止まる: 先に見る検査は J2・出どころの位置・役割とキー・配置の宣言の有無を名指す', () => {
    const error = stopped(() => placedPath(EMPTY_LAYOUT, { app: 'app' }, entry));

    expect(error.findings).toEqual([
      {
        verifier: 'J2',
        severity: 'error',
        message: '外部連携 x の受信口 の置き場を、置き場の配置から決められません(役割 http-entry・キー /api/x)',
        location: LOCATION,
        suggestion: expect.stringContaining('HTTP の入口の置き場の検査 J2'),
        counterexample: { role: 'http-entry', key: '/api/x', declared: 'no' },
      },
    ]);
  });

  it('宣言はあるが決められない(キーの形が合わない・基準が辿れない)ときは declared: yes。キーの無い主張はキー欄が空', () => {
    expect(stopped(() => placedPath(TEST_LAYOUT, { app: 'app' }, { ...entry, key: '/has space' })).findings[0]?.counterexample).toEqual({
      role: 'http-entry',
      key: '/has space',
      declared: 'yes',
    });
    expect(stopped(() => placedPath(TEST_LAYOUT, { app: null }, { role: 'source-root', what: 'ソースの根', location: LOCATION })).findings[0]?.counterexample).toEqual({
      role: 'source-root',
      key: '',
      declared: 'yes',
    });
    expect(stopped(() => placedModule(EMPTY_LAYOUT, { role: 'source-root', what: 'ソースの根', location: LOCATION })).findings[0]?.message).toBe(
      'ソースの根 の import の指定を、置き場の配置から決められません(役割 source-root)',
    );
  });
});

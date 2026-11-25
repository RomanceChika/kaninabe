/**
 * K4(外へ出る URL の設定は `format: url` と `scheme` を宣言し、読み口は関門を通る)のユニットテスト。
 *
 * 規約網羅(config-spec-writing.md §URL の設定):
 *   - `url: true` の種類の行が `format: url` を宣言していなければ落ちること(宣言の側の穴)
 *   - `format: url` の行を実装の木で素の `process.env` のまま読めば落ちること(読み口の側の穴)
 *   - 関門の `scheme` がカタログの宣言と違えば落ちること
 *   - ソースの根の外(道具・E2E)の読みと、`format` の無い行は見ないこと
 */

import { describe, expect, it } from 'vitest';
import { verifyUrlFormat } from '../../../../lib/config/verifiers/k4-url-format.js';
import type { UrlRead, UrlReadScan } from '../../../../lib/config/url-read-scan.js';
import { sourceRootPath } from '../../../../lib/model/product/layout.js';
import type { ConfigSpecModel } from '../../../../lib/model/config/types.js';
import { configCatalog, configVariable } from '../../../helpers/config-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_LAYOUT } from '../../../helpers/platform.js';

const SRC = sourceRootPath(TEST_LAYOUT, TEST_ROOTS) ?? 'src';

/** `endpoint` の種類だけが URL の旗を持つカタログ。 */
function model(variables: ReturnType<typeof configVariable>[]): ConfigSpecModel {
  const catalog = configCatalog(variables);
  return {
    available: true,
    catalog: {
      ...catalog,
      vocabulary: { ...catalog.vocabulary, kind: [{ id: 'secret' }, { id: 'endpoint', url: true }, { id: 'switch' }] },
    },
  };
}

function scan(...reads: readonly UrlRead[]): UrlReadScan {
  return { available: true, reads };
}

function check(config: ConfigSpecModel, urlReads: UrlReadScan) {
  return verifyUrlFormat({ config, urlReads, roots: TEST_ROOTS, layout: TEST_LAYOUT });
}

const HOOK = (opts = {}) => configVariable('HOOK_URL', { kind: 'endpoint', format: 'url', scheme: 'https', ...opts });

describe('K4: 宣言の側', () => {
  it('url: true の種類の行が format: url と scheme を持てば違反なし', () => {
    expect(check(model([HOOK()]), scan())).toEqual([]);
  });

  it('url: true の種類の行が format: url を宣言していなければ落ちる', () => {
    const findings = check(model([configVariable('HOOK_URL', { kind: 'endpoint' })]), scan());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('K4');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toBe('設定 HOOK_URL は種類 endpoint (url: true)なのに format: url と scheme を宣言していません');
    expect(findings[0]?.counterexample).toEqual({ variable: 'HOOK_URL', kind: 'endpoint' });
  });

  it('url の旗の無い種類の行は format が無くてもよい(secret・switch)', () => {
    expect(check(model([configVariable('API_KEY', { kind: 'secret' }), configVariable('MODE', { kind: 'switch' })]), scan())).toEqual([]);
  });

  it('種類を問わず format: url を宣言してよい(URL 自体が秘密の Webhook を secret に置く製品)', () => {
    expect(check(model([configVariable('HOOK_URL', { kind: 'secret', format: 'url', scheme: 'https' })]), scan())).toEqual([]);
  });
});

describe('K4: 読み口の側', () => {
  const read = (over: Partial<UrlRead> = {}): UrlRead => ({ name: 'HOOK_URL', file: `${SRC}/infra/hook.ts`, raw: 1, guarded: ['https'], ...over });

  it('関門を通した読みだけなら違反なし', () => {
    expect(check(model([HOOK()]), scan(read()))).toEqual([]);
  });

  it('素の参照が関門の数より多ければ落ちる(関門を通らない読み口が残っている)', () => {
    const findings = check(model([HOOK()]), scan(read({ raw: 2 })));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toBe(`${SRC}/infra/hook.ts が URL の設定 HOOK_URL を関門(readConfigUrl)を通さずに読んでいます`);
    expect(findings[0]?.suggestion).toContain("readConfigUrl('HOOK_URL', process.env['HOOK_URL'], 'https')");
  });

  it('関門が 1 つも無い素の参照は落ちる', () => {
    expect(check(model([HOOK()]), scan(read({ guarded: [] })))).toHaveLength(1);
  });

  it('関門の scheme がカタログの宣言と違えば落ちる(緩める方向の取り違え)', () => {
    const findings = check(model([HOOK()]), scan(read({ guarded: ['https_or_loopback'] })));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('scheme https_or_loopback がカタログの宣言(https)と違います');
  });

  it('カタログが https_or_loopback を宣言していれば、その綴りで通す', () => {
    const config = model([HOOK({ scheme: 'https_or_loopback' })]);
    expect(check(config, scan(read({ guarded: ['https_or_loopback'] })))).toEqual([]);
    expect(check(config, scan(read({ guarded: ['https'] })))).toHaveLength(1);
  });

  it('同じ scheme の関門が複数あっても指摘は 1 件に畳む', () => {
    const findings = check(model([HOOK()]), scan(read({ raw: 2, guarded: ['https_or_loopback', 'https_or_loopback'] })));
    expect(findings).toHaveLength(1);
  });

  it('ソースの根の外(道具・E2E)の素の参照は見ない', () => {
    expect(check(model([HOOK()]), scan(read({ file: 'outside/tool.mts', guarded: [] })))).toEqual([]);
  });

  it('テストの置き場とテストファイルの素の参照は見ない(出荷物に載らない)', () => {
    for (const file of [`${SRC}/infra/__tests__/seed.ts`, `${SRC}/infra/hook.test.ts`, `${SRC}/infra/hook.spec.tsx`]) {
      expect(check(model([HOOK()]), scan(read({ file, guarded: [] })))).toEqual([]);
    }
    expect(check(model([HOOK()]), scan(read({ file: `${SRC}/infra/hook-test-helper.ts`, guarded: [] })))).toHaveLength(1);
  });

  it('format の無い行(同じ名前でも宣言が無い)は読み口を見ない', () => {
    expect(check(model([configVariable('HOOK_URL', { kind: 'secret' })]), scan(read({ guarded: [] })))).toEqual([]);
  });

  it('走査できなかったとき(木が無い構成)は読み口を見ず、宣言の側だけ見る', () => {
    expect(check(model([HOOK()]), { available: false, reads: [read({ guarded: [] })] })).toEqual([]);
  });

  it('カタログが無ければ何も言わない', () => {
    expect(check({ available: false, catalog: null }, scan())).toEqual([]);
  });
});

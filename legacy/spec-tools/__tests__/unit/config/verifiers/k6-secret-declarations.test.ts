/**
 * K6(秘密の宣言と読み口)のユニットテスト。
 *
 * 規約網羅(config-spec-writing.md §秘密の行):
 *   - `confidential: true` の種類の行が rotation を宣言していなければ落ちる(更新の間の旧い値の行は免除)
 *   - サービスの認証の秘密(`service_auth: true` の使い先の秘密・受信の署名の鍵)が strength を宣言していなければ落ちる
 *   - previous は宣言された行を 1 対 1 で指し、strength のある行だけが持ち、連鎖せず、種類が同じ
 *   - 実装の木の読み口が関門(readServiceSecret)を通っていること・下限がカタログの宣言と同じこと(strength のある行と、その previous の行)
 *   - ソースの根の外・テストの読みと、strength の無い行は見ないこと
 */

import { describe, expect, it } from 'vitest';
import { verifySecretDeclarations } from '../../../../lib/config/verifiers/k6-secret-declarations.js';
import type { SecretRead, SecretReadScan } from '../../../../lib/config/secret-read-scan.js';
import { sourceRootPath } from '../../../../lib/model/product/layout.js';
import type { ConfigSpecModel, ConfigVariableDecl } from '../../../../lib/model/config/types.js';
import { configCatalog, configVariable } from '../../../helpers/config-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_LAYOUT } from '../../../helpers/platform.js';

const SRC = sourceRootPath(TEST_LAYOUT, TEST_ROOTS) ?? 'src';

const ROTATION = { everyCount: 365, everyUnit: 'day', procedure: '作り直す', holders: ['運用担当'] } as const;

/** `secret` の種類が confidential: true、`cron` の使い先が service_auth: true のカタログ。 */
function model(variables: readonly ConfigVariableDecl[]): ConfigSpecModel {
  const catalog = configCatalog(variables);
  return {
    available: true,
    catalog: {
      ...catalog,
      vocabulary: {
        ...catalog.vocabulary,
        kind: [{ id: 'secret', confidential: true }, { id: 'endpoint' }, { id: 'switch' }],
        used_by: [...catalog.vocabulary.used_by, { id: 'cron', serviceAuth: true }],
      },
    },
  };
}

function scan(...reads: readonly SecretRead[]): SecretReadScan {
  return { available: true, reads };
}

function check(config: ConfigSpecModel, secretReads: SecretReadScan = scan(), inboundKeys: readonly string[] = []) {
  return verifySecretDeclarations({ config, inboundKeys, secretReads, roots: TEST_ROOTS, layout: TEST_LAYOUT });
}

const messages = (findings: ReturnType<typeof check>): string[] => findings.map((finding) => finding.message);

/** rotation を持つ秘密の行。 */
const SECRET = (id: string, opts: Partial<Omit<ConfigVariableDecl, 'id' | 'location'>> = {}) => configVariable(id, { kind: 'secret', rotation: ROTATION, ...opts });

describe('K6: rotation(寿命・更新の手順・持つ者)', () => {
  it('secret の種類の行が rotation を持てば違反なし', () => {
    expect(check(model([SECRET('API_KEY')]))).toEqual([]);
  });

  it('secret の種類の行が rotation を持たなければ落ちる', () => {
    const findings = check(model([configVariable('API_KEY', { kind: 'secret' })]));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'K6', severity: 'error' });
    expect(findings[0]?.message).toBe('設定 API_KEY は種類 secret (confidential: true)なのに rotation(寿命・更新の手順・持つ者)を宣言していません');
    expect(findings[0]?.counterexample).toEqual({ variable: 'API_KEY', kind: 'secret' });
    expect(findings[0]?.suggestion).toContain('仮置き');
  });

  it('secret の旗の無い種類(endpoint・switch)は rotation が無くてもよい', () => {
    expect(check(model([configVariable('HOOK', { kind: 'endpoint' }), configVariable('MODE', { kind: 'switch' })]))).toEqual([]);
  });

  it('旗が 1 つも無い語彙(別の製品)では何も求めない', () => {
    const plain = configCatalog([configVariable('API_KEY', { kind: 'secret' })]);
    expect(check({ available: true, catalog: plain })).toEqual([]);
  });

  it('更新の間の旧い値の行(previous に指されている行)は rotation を免除される', () => {
    const rows = [SECRET('CRON_SECRET', { usedBy: ['cron'], strength: { minLength: 32 }, previous: 'CRON_SECRET_PREVIOUS' }), configVariable('CRON_SECRET_PREVIOUS', { kind: 'secret', usedBy: ['cron'] })];
    expect(check(model(rows))).toEqual([]);
  });

  it('カタログが無ければ何も見ない', () => {
    expect(check({ available: false, catalog: null })).toEqual([]);
  });
});

describe('K6: strength(サービスの認証の秘密)', () => {
  it('service_auth の使い先の secret が strength を持てば違反なし', () => {
    expect(check(model([SECRET('CRON_SECRET', { usedBy: ['cron'], strength: { minLength: 32 } })]))).toEqual([]);
  });

  it('service_auth の使い先の secret が strength を持たなければ落ちる', () => {
    const findings = check(model([SECRET('CRON_SECRET', { usedBy: ['cron'] })]));
    expect(messages(findings)).toEqual(['設定 CRON_SECRET はサービスの認証の秘密(共有秘密だけで口を開ける)なのに strength を宣言していません']);
    expect(findings[0]?.suggestion).toContain('strength: { min_length: n }');
  });

  it('service_auth の使い先でも secret でない行(URL・識別子)は求めない', () => {
    expect(check(model([configVariable('CRON_BASE_URL', { kind: 'endpoint', usedBy: ['cron'] })]))).toEqual([]);
  });

  it('secret だが service_auth でない使い先(外部 API の鍵)は求めない', () => {
    expect(check(model([SECRET('API_KEY')]))).toEqual([]);
  });

  it('受信の署名の鍵(inboundKeys)は使い先によらず strength を求める。種類が secret でなくても求める', () => {
    expect(messages(check(model([SECRET('WEBHOOK_SECRET')]), scan(), ['WEBHOOK_SECRET']))).toEqual(['設定 WEBHOOK_SECRET はサービスの認証の秘密(共有秘密だけで口を開ける)なのに strength を宣言していません']);
    expect(messages(check(model([configVariable('WEBHOOK_KEY', { kind: 'switch' })]), scan(), ['WEBHOOK_KEY']))).toHaveLength(1);
    expect(check(model([SECRET('WEBHOOK_SECRET', { strength: { minLength: 32 } })]), scan(), ['WEBHOOK_SECRET'])).toEqual([]);
  });
});

describe('K6: previous(更新の間だけ旧い値も受ける)', () => {
  const owner = (over: Partial<Omit<ConfigVariableDecl, 'id' | 'location'>> = {}) => SECRET('CRON_SECRET', { usedBy: ['cron'], strength: { minLength: 32 }, previous: 'CRON_SECRET_PREVIOUS', ...over });
  const previous = (over: Partial<Omit<ConfigVariableDecl, 'id' | 'location'>> = {}) => configVariable('CRON_SECRET_PREVIOUS', { kind: 'secret', usedBy: ['cron'], ...over });

  it('宣言された行を 1 対 1 で指していれば違反なし', () => {
    expect(check(model([owner(), previous()]))).toEqual([]);
  });

  it.each([
    ['指す先の行が無い', [owner()], 'CRON_SECRET_PREVIOUS という設定の行がありません'],
    ['指す先の種類が違う', [owner(), previous({ kind: 'endpoint' })], '種類 endpoint が CRON_SECRET の種類 secret と違います'],
    ['旧い値の行がさらに previous を持つ(連鎖)', [owner(), previous({ previous: 'CRON_SECRET_OLDER' })], 'さらに previous を持っています'],
    ['strength の無い行が previous を持つ', [SECRET('CRON_SECRET', { usedBy: ['cron'], previous: 'CRON_SECRET_PREVIOUS' }), previous()], 'CRON_SECRET が strength を持っていません'],
    ['2 つの行が同じ旧い値の行を指す', [owner(), SECRET('OTHER_SECRET', { usedBy: ['cron'], strength: { minLength: 32 }, previous: 'CRON_SECRET_PREVIOUS' }), previous()], '複数の行が previous に指しています'],
  ])('落ちる: %s', (_name, rows, expected) => {
    expect(messages(check(model(rows))).join('\n')).toContain(expected);
  });
});

describe('K6: 読み口の側', () => {
  const read = (over: Partial<SecretRead> = {}): SecretRead => ({ name: 'CRON_SECRET', file: `${SRC}/composition/cron-auth.ts`, raw: 1, guarded: [32], ...over });
  const rows = [SECRET('CRON_SECRET', { usedBy: ['cron'], strength: { minLength: 32 }, previous: 'CRON_SECRET_PREVIOUS' }), configVariable('CRON_SECRET_PREVIOUS', { kind: 'secret', usedBy: ['cron'] })];

  it('関門を通した読み(現在の秘密と旧い値の両方)だけなら違反なし', () => {
    expect(check(model(rows), scan(read(), read({ name: 'CRON_SECRET_PREVIOUS' })))).toEqual([]);
  });

  it('素の参照が関門の数より多ければ落ちる(関門を通らない読み口が残っている)', () => {
    const findings = check(model(rows), scan(read({ raw: 2 })));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toBe(`${SRC}/composition/cron-auth.ts がサービスの認証の秘密 CRON_SECRET を関門(readServiceSecret)を通さずに読んでいます`);
    expect(findings[0]?.suggestion).toContain("readServiceSecret('CRON_SECRET', process.env['CRON_SECRET'], 32)");
  });

  it('旧い値の行を素のまま読んでも落ちる(下限は持ち主の strength)', () => {
    const findings = check(model(rows), scan(read({ name: 'CRON_SECRET_PREVIOUS', guarded: [] })));
    expect(messages(findings)).toEqual([`${SRC}/composition/cron-auth.ts がサービスの認証の秘密 CRON_SECRET_PREVIOUS を関門(readServiceSecret)を通さずに読んでいます`]);
    expect(findings[0]?.suggestion).toContain("readServiceSecret('CRON_SECRET_PREVIOUS', process.env['CRON_SECRET_PREVIOUS'], 32)");
  });

  it('関門の下限がカタログの宣言と違えば落ちる(短い下限で緩めない)', () => {
    const findings = check(model(rows), scan(read({ guarded: [8] })));
    expect(messages(findings)).toEqual([`${SRC}/composition/cron-auth.ts の readServiceSecret('CRON_SECRET', …) の下限 8 がカタログの宣言(32)と違います`]);
    expect(findings[0]?.counterexample).toEqual({ variable: 'CRON_SECRET', file: `${SRC}/composition/cron-auth.ts`, written: '8', declared: '32' });
  });

  it('同じ行を複数の場所で読んでいても、場所ごとに見る', () => {
    const findings = check(model(rows), scan(read(), read({ file: `${SRC}/app/api/x/route.ts`, raw: 1, guarded: [] })));
    expect(messages(findings)).toHaveLength(1);
    expect(findings[0]?.message).toContain(`${SRC}/app/api/x/route.ts`);
  });

  it.each([
    ['ソースの根の外(道具・E2E)', { file: 'app/scripts/setup-secrets.mts', raw: 3, guarded: [] }],
    ['テストファイル', { file: `${SRC}/composition/__tests__/cron-auth.test.ts`, raw: 3, guarded: [] }],
    ['.test.ts', { file: `${SRC}/composition/cron-auth.test.ts`, raw: 3, guarded: [] }],
  ])('見ない: %s', (_name, over) => {
    expect(check(model(rows), scan(read(over)))).toEqual([]);
  });

  it('strength の無い行(外部 API の鍵)の読みは見ない', () => {
    expect(check(model([SECRET('API_KEY')]), scan(read({ name: 'API_KEY', raw: 5, guarded: [] })))).toEqual([]);
  });

  it('走査できなかった(実装の木が無い)ときは読み口を見ない。宣言の側は見る', () => {
    const findings = check(model([configVariable('API_KEY', { kind: 'secret' })]), { available: false, reads: [] });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('rotation');
  });
});

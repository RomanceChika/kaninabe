/**
 * K0(設定カタログのスキーマ適合)のユニットテスト。
 *
 * 規約網羅(config-spec-writing.md §共通形式・§1 行が宣言すること):
 *   - 正しいカタログが読めること
 *   - id が config-catalog 固定であること
 *   - 変数名が環境変数の形(SCREAMING_SNAKE)であること・重複しないこと
 *   - **kind / requirement / used_by / provision / targets の値が、同じファイルが宣言した語彙に閉じていること**
 *   - used_by が 1 つ以上あること・重複しないこと
 *   - **provision は任意であること**(省略すると既定の `prompt` になる。`kind` / `requirement` と違い必須ではない)
 *   - **absence が必須であること**(「無いとどうなるか」を書かせる)
 *   - not_in_template_reason は任意であること
 *   - **置き場(targets)が宣言 or requirement からの導出で必ず決まること**(両方向 —— 導出できないのに
 *     宣言が無ければエラー・導出できるのに宣言していてもエラー)
 *   - **probe / read_by は vocabulary.target の語だけが持ち、target の語は probe を必ず持つこと**
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { parseConfigCatalog } from '../../../../lib/model/config/parse-config.js';

/** 最小の語彙(テストごとに上書きする)。 */
const VOCABULARY = {
  kind: [{ id: 'secret', label: '漏らせない秘密' }, { id: 'switch' }],
  requirement: [
    { id: 'required', default_targets: ['local', 'production'] },
    { id: 'tooling_only', default_targets: [] },
  ],
  used_by: [{ id: 'supabase_data', label: 'Supabase — 業務データ' }, { id: 'test_harness' }],
  provision: [{ id: 'prompt', label: '人が値を貼る' }, { id: 'generate', label: '道具が生成する' }],
  target: [
    { id: 'local', label: '開発機の .env.local', probe: { kind: 'dotenv', path: 'app/.env.local' } },
    {
      id: 'production',
      label: '本番',
      probe: { kind: 'command', argv: ['vercel', 'env', 'ls', 'production'], cwd: 'app' },
    },
    {
      id: 'ci',
      label: 'CI の秘密',
      probe: { kind: 'command', argv: ['gh', 'secret', 'list', '--json', 'name'] },
      read_by: { kind: 'workflow_secret', path: '.github/workflows' },
    },
  ],
};

/** 1 行分の正しい宣言。 */
const ROW = {
  id: 'SUPABASE_SERVICE_ROLE_KEY',
  kind: 'secret',
  requirement: 'required',
  used_by: ['supabase_data'],
  summary: 'RLS をバイパスして書き込む経路の鍵',
  absence: '書き込み操作がすべて例外で落ちる',
};

/** 雛形に載せない行(免除つき)。 */
const EXEMPT_ROW = {
  id: 'WALK_SEED',
  kind: 'switch',
  requirement: 'tooling_only',
  used_by: ['test_harness'],
  summary: 'ランダムウォークの乱数シード',
  absence: 'ランダムなシードで走る',
  not_in_template_reason: '走査のたびにコマンドラインで渡すつまみ',
};

/** フロントマター相当のマッピングを組み立てる。 */
function frontmatter(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    doc_type: 'config_spec',
    scope: 'backend',
    id: 'config-catalog',
    vocabulary: VOCABULARY,
    variables: [ROW, EXEMPT_ROW],
    ...overrides,
  };
}

/** パースして (カタログ, 違反) を返す。 */
function parse(data: Readonly<Record<string, unknown>>) {
  const reporter = new SpecReporter('docs/specs/backend/config.md');
  const result = parseConfigCatalog(data, reporter);
  if (result.value === null) throw new Error('カタログを構築できませんでした');
  return { value: result.value, findings: result.findings };
}

/** 違反メッセージだけを取り出す。 */
function messages(data: Readonly<Record<string, unknown>>): string[] {
  return parse(data).findings.map((finding) => finding.message);
}

describe('K0: 設定カタログのスキーマ', () => {
  it('正しいカタログが違反なく読める', () => {
    const { value, findings } = parse(frontmatter());
    expect(findings).toEqual([]);
    expect(value.variables.map((decl) => decl.id)).toEqual(['SUPABASE_SERVICE_ROLE_KEY', 'WALK_SEED']);
    expect(value.variables[0]?.usedBy).toEqual(['supabase_data']);
    expect(value.variables[1]?.notInTemplateReason).toBe('走査のたびにコマンドラインで渡すつまみ');
    expect(value.vocabulary.used_by[0]?.label).toBe('Supabase — 業務データ');
    expect(value.variables[0]?.targets).toEqual(['local', 'production']);
    expect(value.variables[1]?.targets).toEqual([]);
    expect(value.vocabulary.target[0]?.probe).toEqual({ kind: 'dotenv', path: 'app/.env.local' });
    expect(value.vocabulary.target[2]?.readBy).toEqual({
      kind: 'workflow_secret',
      path: '.github/workflows',
    });
  });

  it('targets を書いた行はその置き場になる(既定と違う置き場に要る例外)', () => {
    const { value, findings } = parse(frontmatter({ variables: [{ ...ROW, targets: ['ci'] }] }));
    expect(findings).toEqual([]);
    expect(value.variables[0]?.targets).toEqual(['ci']);
  });

  it('targets が requirement の既定と同じならエラー(導出できる宣言は書かせない)', () => {
    const row = { ...ROW, targets: ['production', 'local'] };
    expect(messages(frontmatter({ variables: [row] }))).toContain(
      '設定 SUPABASE_SERVICE_ROLE_KEY の targets は requirement required の既定と同じです',
    );
  });

  it('宣言していない置き場の語はエラー', () => {
    expect(messages(frontmatter({ variables: [{ ...ROW, targets: ['staging'] }] }))).toContain(
      'target staging は vocabulary.target に宣言されていません',
    );
  });

  it('targets の語が重複すればエラー', () => {
    const row = { ...ROW, targets: ['ci', 'ci'] };
    expect(messages(frontmatter({ variables: [row] }))).toContain(
      '設定 SUPABASE_SERVICE_ROLE_KEY の targets に ci が重複しています',
    );
  });

  it('targets を省略した行の requirement に default_targets が無ければエラー', () => {
    const vocabulary = { ...VOCABULARY, requirement: [{ id: 'required' }, { id: 'tooling_only' }] };
    expect(messages(frontmatter({ vocabulary }))).toContain(
      '設定 SUPABASE_SERVICE_ROLE_KEY の置き場が決まりません(requirement required に default_targets がありません)',
    );
  });

  it('default_targets が宣言していない置き場を指せばエラー', () => {
    const vocabulary = {
      ...VOCABULARY,
      requirement: [{ id: 'required', default_targets: ['staging'] }, { id: 'tooling_only', default_targets: [] }],
    };
    expect(messages(frontmatter({ vocabulary }))).toContain(
      'target staging は vocabulary.target に宣言されていません',
    );
  });

  it('default_targets を requirement 以外の語が持てばエラー', () => {
    const vocabulary = { ...VOCABULARY, kind: [{ id: 'secret', default_targets: ['local'] }, { id: 'switch' }] };
    expect(messages(frontmatter({ vocabulary }))).toContain(
      'kind の語 secret が default_targets を持っています',
    );
  });

  it('置き場の語に probe が無ければエラー(名前を列挙できない置き場は doctor が見られない)', () => {
    const vocabulary = { ...VOCABULARY, target: [{ id: 'local', label: '開発機' }] };
    expect(messages(frontmatter({ vocabulary }))).toContain('置き場 local に probe がありません');
  });

  it('probe を置き場以外の語が持てばエラー', () => {
    const vocabulary = {
      ...VOCABULARY,
      kind: [{ id: 'secret', probe: { kind: 'dotenv', path: 'app/.env.local' } }, { id: 'switch' }],
    };
    expect(messages(frontmatter({ vocabulary }))).toContain('kind の語 secret が probe を持っています');
  });

  it('probe.kind が体系の値域に無ければエラー(値を返す形は宣言できない)', () => {
    const vocabulary = {
      ...VOCABULARY,
      target: [{ id: 'local', probe: { kind: 'read_value', path: 'app/.env.local' } }],
    };
    expect(messages(frontmatter({ vocabulary }))).toContain(
      'probe.kind read_value は体系が持つ値域にありません',
    );
  });

  it('read_by.kind が体系の値域に無ければエラー', () => {
    const vocabulary = {
      ...VOCABULARY,
      target: [
        {
          id: 'local',
          probe: { kind: 'dotenv', path: 'app/.env.local' },
          read_by: { kind: 'grep', path: '.github/workflows' },
        },
      ],
    };
    expect(messages(frontmatter({ vocabulary }))).toContain(
      'read_by.kind grep は体系が持つ値域にありません',
    );
  });

  it('id がカタログの固定値でなければエラー', () => {
    expect(messages(frontmatter({ id: 'configs' }))).toContain('id configs はカタログの id ではありません');
  });

  it('変数名が環境変数の形でなければエラー', () => {
    const found = messages(frontmatter({ variables: [{ ...ROW, id: 'supabaseUrl' }] }));
    expect(found).toContain('設定 supabaseUrl が環境変数名の形(SCREAMING_SNAKE)ではありません');
  });

  it('変数名が重複すればエラー', () => {
    expect(messages(frontmatter({ variables: [ROW, ROW] }))).toContain(
      '設定 SUPABASE_SERVICE_ROLE_KEY が重複しています',
    );
  });

  it('宣言していない kind の語はエラー', () => {
    expect(messages(frontmatter({ variables: [{ ...ROW, kind: 'password' }] }))).toContain(
      'kind password は vocabulary.kind に宣言されていません',
    );
  });

  it('宣言していない used_by の語はエラー', () => {
    expect(messages(frontmatter({ variables: [{ ...ROW, used_by: ['stripe'] }] }))).toContain(
      'used_by stripe は vocabulary.used_by に宣言されていません',
    );
  });

  it('used_by が空ならエラー(何のための設定か分からない行を作らない)', () => {
    expect(messages(frontmatter({ variables: [{ ...ROW, used_by: [] }] }))).toContain('used_by が空です');
  });

  it('used_by の語が重複すればエラー', () => {
    const row = { ...ROW, used_by: ['supabase_data', 'supabase_data'] };
    expect(messages(frontmatter({ variables: [row] }))).toContain(
      '設定 SUPABASE_SERVICE_ROLE_KEY の used_by に supabase_data が重複しています',
    );
  });

  it('provision を省略した行は既定(prompt)になる', () => {
    const { value } = parse(frontmatter());
    expect(value.variables[0]?.provision).toBe('prompt');
  });

  it('provision を明示すればその語になる(generate = 道具が生成する)', () => {
    const { value } = parse(frontmatter({ variables: [{ ...ROW, provision: 'generate' }] }));
    expect(value.variables[0]?.provision).toBe('generate');
  });

  it('宣言していない provision の語はエラー', () => {
    expect(messages(frontmatter({ variables: [{ ...ROW, provision: 'auto' }] }))).toContain(
      'provision auto は vocabulary.provision に宣言されていません',
    );
  });

  it('provision を省略していて vocabulary.provision も空なら既定を決められずエラー', () => {
    const vocabulary = { ...VOCABULARY, provision: [] };
    expect(messages(frontmatter({ vocabulary }))).toContain(
      'provision を省略していますが vocabulary.provision が空で既定の語を決められません',
    );
  });

  it('absence が無ければエラー(未設定時の挙動は必ず宣言させる)', () => {
    const row = { ...ROW };
    delete (row as Record<string, unknown>)['absence'];
    expect(messages(frontmatter({ variables: [row] }))).toContain('absence がありません');
  });

  it('summary が無ければエラー', () => {
    const row = { ...ROW };
    delete (row as Record<string, unknown>)['summary'];
    expect(messages(frontmatter({ variables: [row] }))).toContain('summary がありません');
  });

  it('vocabulary が無ければエラー', () => {
    const found = messages(frontmatter({ vocabulary: undefined }));
    expect(found).toContain('vocabulary がありません');
  });

  it('vocabulary の軸が空ならエラー', () => {
    const found = messages(frontmatter({ vocabulary: { ...VOCABULARY, used_by: [] } }));
    expect(found).toContain('vocabulary.used_by が空です');
  });

  it('語彙の語が重複すればエラー', () => {
    const vocabulary = { ...VOCABULARY, kind: [{ id: 'secret' }, { id: 'secret' }] };
    expect(messages(frontmatter({ vocabulary }))).toContain('kind の語 secret が重複しています');
  });
});

describe('K0: 行の URL の書式(format: url と scheme)と種類の url の旗', () => {
  const URL_VOCABULARY = { ...VOCABULARY, kind: [{ id: 'secret' }, { id: 'endpoint', url: true }, { id: 'switch' }] };
  const URL_ROW = { ...ROW, id: 'HOOK_URL', kind: 'endpoint', format: 'url', scheme: 'https' };

  it('format: url と scheme を読む(種類の url の旗も)', () => {
    const { value, findings } = parse(frontmatter({ vocabulary: URL_VOCABULARY, variables: [URL_ROW] }));
    expect(findings).toEqual([]);
    expect(value.vocabulary.kind.find((term) => term.id === 'endpoint')?.url).toBe(true);
    expect(value.vocabulary.kind.find((term) => term.id === 'secret')).not.toHaveProperty('url');
    expect(value.variables[0]).toMatchObject({ id: 'HOOK_URL', format: 'url', scheme: 'https' });
  });

  it('scheme: https_or_loopback も読める。書かない行には format / scheme のキーが現れない', () => {
    const { value } = parse(frontmatter({ vocabulary: URL_VOCABULARY, variables: [{ ...URL_ROW, scheme: 'https_or_loopback' }, ROW] }));
    expect(value.variables[0]?.scheme).toBe('https_or_loopback');
    expect(value.variables[1]).not.toHaveProperty('format');
    expect(value.variables[1]).not.toHaveProperty('scheme');
  });

  it.each([
    ['scheme の無い format: url(平文の http を黙って許さない)', { ...URL_ROW, scheme: undefined }, 'format: url に scheme がありません'],
    ['format の無い scheme', { ...URL_ROW, format: undefined }, 'scheme だけを書いています'],
    ['語彙の外の format', { ...URL_ROW, format: 'email' }, 'format email は使えません'],
    ['語彙の外の scheme(http を足す口は無い)', { ...URL_ROW, scheme: 'http' }, 'scheme http は使えません'],
  ])('弾く: %s', (_name, row, expected) => {
    const { value, findings } = parse(frontmatter({ vocabulary: URL_VOCABULARY, variables: [row] }));
    expect(findings.map((finding) => finding.message).join('\n')).toContain(expected);
    expect(value.variables).toEqual([]);
  });

  it('url の旗は kind の語だけが持つ(requirement に書くと弾く)', () => {
    const vocabulary = { ...VOCABULARY, requirement: [{ id: 'required', default_targets: ['local', 'production'], url: true }, { id: 'tooling_only', default_targets: [] }] };
    expect(messages(frontmatter({ vocabulary }))).toContain('requirement の語 required が url を持っています');
  });

  it('url の旗は真偽値で書く', () => {
    const vocabulary = { ...VOCABULARY, kind: [{ id: 'secret' }, { id: 'switch', url: 'yes' }] };
    expect(messages(frontmatter({ vocabulary })).join('\n')).toContain('url は true / false で書きます');
  });
});

describe('K0: 秘密の宣言(rotation / strength / previous)と語の旗(secret / service_auth)', () => {
  const SECRET_VOCABULARY = {
    ...VOCABULARY,
    kind: [{ id: 'secret', confidential: true }, { id: 'switch' }],
    used_by: [{ id: 'supabase_data', service_auth: true }, { id: 'test_harness' }],
  };
  const ROTATION = { every: '365 day', procedure: 'ダッシュボードで作り直す', holders: ['運用担当'], reason: '仮置き・運用で決める' };
  const SECRET_ROW = { ...ROW, rotation: ROTATION, strength: { min_length: 32 }, previous: 'SERVICE_KEY_PREVIOUS' };

  it('rotation・strength・previous と、語の旗(secret / service_auth)を読む', () => {
    const { value, findings } = parse(frontmatter({ vocabulary: SECRET_VOCABULARY, variables: [SECRET_ROW] }));
    expect(findings).toEqual([]);
    expect(value.vocabulary.kind[0]?.confidential).toBe(true);
    expect(value.vocabulary.kind[1]).not.toHaveProperty('secret');
    expect(value.vocabulary.used_by[0]?.serviceAuth).toBe(true);
    expect(value.variables[0]).toMatchObject({
      rotation: { everyCount: 365, everyUnit: 'day', procedure: 'ダッシュボードで作り直す', holders: ['運用担当'], reason: '仮置き・運用で決める' },
      strength: { minLength: 32 },
      previous: 'SERVICE_KEY_PREVIOUS',
    });
  });

  it('書かない行には rotation / strength / previous のキーが現れない。reason は任意', () => {
    const { value } = parse(frontmatter({ vocabulary: SECRET_VOCABULARY, variables: [{ ...ROW, rotation: { ...ROTATION, reason: undefined, every: '12 month' } }, EXEMPT_ROW] }));
    expect(value.variables[0]?.rotation).toEqual({ everyCount: 12, everyUnit: 'month', procedure: 'ダッシュボードで作り直す', holders: ['運用担当'] });
    expect(value.variables[1]).not.toHaveProperty('rotation');
    expect(value.variables[1]).not.toHaveProperty('strength');
    expect(value.variables[1]).not.toHaveProperty('previous');
  });

  it.each([
    ['every が 0', { ...ROW, rotation: { ...ROTATION, every: '0 day' } }, 'rotation.every 0 day は書式に合いません'],
    ['every の単位が年', { ...ROW, rotation: { ...ROTATION, every: '1 year' } }, 'rotation.every 1 year は書式に合いません'],
    ['every に数が無い', { ...ROW, rotation: { ...ROTATION, every: 'day' } }, 'rotation.every day は書式に合いません'],
    ['every が小数', { ...ROW, rotation: { ...ROTATION, every: '1.5 day' } }, 'rotation.every 1.5 day は書式に合いません'],
    ['procedure が無い', { ...ROW, rotation: { ...ROTATION, procedure: undefined } }, 'procedure'],
    ['holders が空', { ...ROW, rotation: { ...ROTATION, holders: [] } }, 'holders'],
    ['rotation がマッピングでない', { ...ROW, rotation: '365 day' }, 'rotation がマッピングではありません'],
    ['min_length が 0', { ...ROW, strength: { min_length: 0 } }, 'strength.min_length は正の整数'],
    ['min_length が小数', { ...ROW, strength: { min_length: 8.5 } }, 'strength.min_length は正の整数'],
    ['min_length が無い', { ...ROW, strength: {} }, 'strength.min_length は正の整数'],
    ['previous が自分自身', { ...ROW, previous: ROW.id }, 'previous SUPABASE_SERVICE_ROLE_KEY は別の環境変数名'],
    ['previous が環境変数名の形でない', { ...ROW, previous: 'prev-key' }, 'previous prev-key は別の環境変数名'],
  ])('弾く: %s', (_name, row, expected) => {
    const { value, findings } = parse(frontmatter({ vocabulary: SECRET_VOCABULARY, variables: [row] }));
    expect(findings.map((finding) => finding.message).join('\n')).toContain(expected);
    expect(value.variables).toEqual([]);
  });

  it.each([
    ['rotation', { ...ROW, rotation: { ...ROTATION, owner: 'x' } }, 'rotation に owner は書けません'],
    ['strength', { ...ROW, strength: { min_length: 8, max_length: 9 } }, 'strength に max_length は書けません'],
  ])('知らないキーは綴りの間違いとして違反にする(%s)', (_name, row, expected) => {
    expect(messages(frontmatter({ vocabulary: SECRET_VOCABULARY, variables: [row] })).join('\n')).toContain(expected);
  });

  it('secret の旗は kind の語だけが持つ。service_auth は used_by の語だけが持つ。どちらも真偽値', () => {
    const wrongAxis = { ...VOCABULARY, requirement: [{ id: 'required', default_targets: ['local', 'production'], confidential: true }, { id: 'tooling_only', default_targets: [], service_auth: true }] };
    const text = messages(frontmatter({ vocabulary: wrongAxis })).join('\n');
    expect(text).toContain('requirement の語 required が confidential を持っています');
    expect(text).toContain('requirement の語 tooling_only が service_auth を持っています');
    expect(messages(frontmatter({ vocabulary: { ...VOCABULARY, kind: [{ id: 'secret', confidential: 'yes' }, { id: 'switch' }] } })).join('\n')).toContain('confidential は true / false で書きます');
    expect(messages(frontmatter({ vocabulary: { ...VOCABULARY, used_by: [{ id: 'supabase_data', service_auth: 1 }, { id: 'test_harness' }] } })).join('\n')).toContain('service_auth は true / false で書きます');
  });
});

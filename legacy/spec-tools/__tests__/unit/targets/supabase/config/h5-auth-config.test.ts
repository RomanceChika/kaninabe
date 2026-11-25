/**
 * H5(サインインの方式と公開スキーマの突合 — Supabase の後段が登録する検査)のユニットテスト。
 *
 * 規約網羅(auth-spec-writing.md §`providers`・§検証 H5):
 *   - 宣言に無い方式が開いていればエラー(メールの登録・SMS・匿名・外部プロバイダ・外部の認証基盤・ウォレット)
 *   - 書かれていないキーは Supabase の既定で読む(メールの登録は有効・公開スキーマは既定の 2 つ)
 *   - ローカルでだけ開けてよい方式(local_only)は通る
 *   - 外へ出すスキーマが公開スキーマ(exposedSchema)の 1 つだけ以外ならエラー
 *   - 読めない値はエラー(閉じているとも開いているとも言わない)
 *   - 認証・データ API を動かさない設定はその部分を見ない
 *   - 設定ファイルが無ければ未実施(absent)。緑にしない
 *   - フルパスに畳めない書き方(インラインテーブル・ドット付きのキーの 3 か所・引用符つきでドットを含む名前)は読まずにエラー
 *   - deploy 先(remotes)の設定も同じ規則で見る。許すのは providers だけ(local_only は使えない)
 *   - 認証・データ API を動かさない設定で飛ばした部分は、理由つきで返す(黙らない)
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AuthConfigInput } from '../../../../../lib/auth/platform-config.js';
import { authConfigFindings as authConfigResult, SUPABASE_AUTH_CONFIG } from '../../../../../lib/targets/supabase/config/h5-auth-config.js';
import { stackConfigPath } from '../../../../../lib/model/product/paths.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';

/** 設定ファイルの置き場(製品の宣言から決まる。パスを書き写さない)。 */
const CONFIG_FILE = stackConfigPath(TEST_ROOTS);

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../fixtures');

/** 本文を突き合わせた違反。 */
function authConfigFindings(...args: Parameters<typeof authConfigResult>): ReturnType<typeof authConfigResult>['findings'] {
  return authConfigResult(...args).findings;
}

/** 宣言の既定(外部プロバイダ 1 つだけ)。 */
const LOCAL_EMAIL = { method: 'email', reason: 'ローカルのテスト利用者がパスワードで入る' };

function input(overrides: Partial<AuthConfigInput> = {}): AuthConfigInput {
  return { providers: ['github'], localOnly: [], repoRoot: FIXTURES, roots: TEST_ROOTS, ...overrides };
}

/** 宣言の範囲に収まる設定(メール・SMS・匿名は閉じ、github だけ開き、公開スキーマは api だけ)。 */
const ALIGNED = [
  '[api]',
  'schemas = ["api"]',
  '[auth]',
  'enable_anonymous_sign_ins = false',
  '[auth.email]',
  'enable_signup = false',
  '[auth.sms]',
  'enable_signup = false',
  '[auth.external.github]',
  'enabled = true',
].join('\n');

/** 設定を足した本文。 */
function withExtra(...lines: string[]): string {
  return [ALIGNED, ...lines].join('\n');
}

/** 指摘のメッセージ。 */
function messages(text: string, overrides: Partial<AuthConfigInput> = {}): string[] {
  return authConfigFindings(text, CONFIG_FILE, input(overrides)).map((finding) => finding.message);
}

describe('H5: サインインの方式', () => {
  it('宣言の範囲に収まっていれば違反なし', () => {
    expect(messages(ALIGNED)).toEqual([]);
  });

  it('宣言に無い方式(メールの登録)が開いていればエラーで、直し方を言う', () => {
    const findings = authConfigFindings(ALIGNED.replace('[auth.email]\nenable_signup = false', '[auth.email]\nenable_signup = true'), CONFIG_FILE, input());

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      verifier: 'H5',
      severity: 'error',
      location: { file: CONFIG_FILE, pointer: '[auth.email].enable_signup' },
      counterexample: { method: 'email', setting: '[auth.email] enable_signup', declared: 'github' },
    });
    expect(findings[0]?.message).toBe(
      `${CONFIG_FILE} は email によるサインインの口が開いています([auth.email] enable_signup が true です)が、認証フロー仕様の providers(github)に email がありません`,
    );
    expect(findings[0]?.suggestion).toContain('[auth.email] enable_signup = false にして口を閉じる');
    expect(findings[0]?.suggestion).toContain('local_only');
  });

  it('メールの登録のキーが書かれていなければ既定(有効)で読み、エラーにする', () => {
    const text = ALIGNED.replace('[auth.email]\nenable_signup = false\n', '');

    expect(messages(text)).toEqual([
      `${CONFIG_FILE} は email によるサインインの口が開いています([auth.email] enable_signup が書かれておらず、既定が有効です)が、認証フロー仕様の providers(github)に email がありません`,
    ]);
  });

  it('宣言に無い外部プロバイダが開いていればエラー(宣言した方式は通る)', () => {
    expect(messages(withExtra('[auth.external.apple]', 'enabled = true'))).toEqual([
      `${CONFIG_FILE} は apple によるサインインの口が開いています([auth.external.apple] enabled が true です)が、認証フロー仕様の providers(github)に apple がありません`,
    ]);
  });

  it('外部プロバイダが閉じている(enabled = false)なら宣言に無くても通る', () => {
    expect(messages(withExtra('[auth.external.apple]', 'enabled = false'))).toEqual([]);
  });

  it.each([
    ['SMS の登録', '[auth.sms]\nenable_signup = false', '[auth.sms]\nenable_signup = true', 'phone', '[auth.sms] enable_signup'],
    ['匿名', '[auth]\nenable_anonymous_sign_ins = false', '[auth]\nenable_anonymous_sign_ins = true', 'anonymous_sign_in', '[auth] enable_anonymous_sign_ins'],
  ])('%s が宣言に無いのに開いていればエラー', (_name, closed, open, method, setting) => {
    const findings = authConfigFindings(ALIGNED.replace(closed, open), CONFIG_FILE, input());

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ method, setting });
  });

  it.each([
    ['外部の認証基盤', '[auth.third_party.firebase]', 'firebase'],
    ['ウォレット', '[auth.web3.solana]', 'solana'],
  ])('%s が宣言に無いのに開いていればエラー', (_name, section, method) => {
    expect(authConfigFindings(withExtra(section, 'enabled = true'), CONFIG_FILE, input()).map((finding) => finding.counterexample?.['method'])).toEqual([method]);
  });

  it('providers に載っていれば、メールの登録が開いていても通る(パスワードの守りは ASVS L2 の値に揃える。h5-password.test.ts)', () => {
    const text = ALIGNED.replace('[auth.email]\nenable_signup = false', '[auth.email]\nenable_signup = true\nenable_confirmations = true\nsecure_password_change = true').replace('[auth]\n', '[auth]\nminimum_password_length = 8\n');

    expect(messages(text, { providers: ['github', 'email'] })).toEqual([]);
  });

  it('local_only に載っていれば、メールの登録が開いていても通る(ローカルでだけ開ける方式)', () => {
    const text = ALIGNED.replace('[auth.email]\nenable_signup = false', '[auth.email]\nenable_signup = true');

    expect(messages(text, { localOnly: [LOCAL_EMAIL] })).toEqual([]);
  });

  it('local_only に載っていない別の方式は、local_only があっても止まる', () => {
    const text = withExtra('[auth.external.apple]', 'enabled = true');

    expect(messages(text, { localOnly: [LOCAL_EMAIL] })).toHaveLength(1);
    expect(messages(text, { localOnly: [LOCAL_EMAIL] })[0]).toContain('local_only: email');
  });

  it('開いている口が複数あれば、口ごとに 1 件', () => {
    const text = withExtra('[auth.external.apple]', 'enabled = true', '[auth.web3.solana]', 'enabled = true');

    expect(messages(text)).toHaveLength(2);
  });

  it('真偽値でない値は、開いているとも閉じているとも言わずエラーにする', () => {
    const text = ALIGNED.replace('[auth.email]\nenable_signup = false', '[auth.email]\nenable_signup = "env(X)"');

    expect(messages(text)).toEqual([`${CONFIG_FILE} の [auth.email] enable_signup を読めません(真偽値ではありません)`]);
  });

  it('認証を動かさない設定([auth] enabled = false)ならサインインの口は見ない', () => {
    const text = withExtra('[auth.external.apple]', 'enabled = true').replace('[auth]\n', '[auth]\nenabled = false\n');

    expect(messages(text)).toEqual([]);
  });
});

describe('H5: 外へ出すスキーマ', () => {
  it('公開スキーマだけなら違反なし', () => {
    expect(messages(ALIGNED)).toEqual([]);
  });

  it('宣言に無いスキーマ(GraphQL の口)が外へ出ていればエラー', () => {
    const findings = authConfigFindings(ALIGNED.replace('schemas = ["api"]', 'schemas = ["api", "graphql_public"]'), CONFIG_FILE, input());

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      verifier: 'H5',
      severity: 'error',
      location: { file: CONFIG_FILE, pointer: '[api].schemas' },
      counterexample: { schema: 'graphql_public', allowed: 'api' },
    });
    expect(findings[0]?.message).toBe(
      `${CONFIG_FILE} の [api] schemas で graphql_public が外へ出ています(書かれています)が、外へ出してよいスキーマは仕様の公開面の api だけです`,
    );
    expect(findings[0]?.suggestion).toContain('[api] schemas を ["api"] だけにして graphql_public を外す');
  });

  it('余分なスキーマは 1 つごとに 1 件', () => {
    expect(messages(ALIGNED.replace('schemas = ["api"]', 'schemas = ["public", "api", "graphql_public"]'))).toHaveLength(2);
  });

  it('schemas が書かれていなければ既定(公開スキーマ + GraphQL)で開くのでエラー', () => {
    const findings = authConfigFindings(ALIGNED.replace('schemas = ["api"]\n', ''), CONFIG_FILE, input());

    expect(findings.map((finding) => finding.counterexample?.['schema'])).toEqual(['public', 'graphql_public']);
    expect(findings[0]?.message).toContain('書かれておらず、既定で出ます');
  });

  it('[api] セクションごと無くても既定で開くのでエラー', () => {
    expect(messages('[auth.email]\nenable_signup = false').length).toBeGreaterThan(0);
  });

  it('schemas が配列でなければ読めないとエラー', () => {
    expect(messages(ALIGNED.replace('schemas = ["api"]', 'schemas = "api"'))).toEqual([`${CONFIG_FILE} の [api] schemas を読めません(文字列の配列ではありません)`]);
  });

  it('データ API を動かさない設定([api] enabled = false)ならスキーマは見ない', () => {
    expect(messages(ALIGNED.replace('[api]\n', '[api]\nenabled = false\n').replace('schemas = ["api"]', 'schemas = ["api", "graphql_public"]'))).toEqual([]);
  });
});

describe('H5: 設定ファイル', () => {
  it('設定ファイルが宣言どおりなら checked で違反なし', () => {
    const outcome = SUPABASE_AUTH_CONFIG.verify(input({ repoRoot: path.join(FIXTURES, 'auth-config-repo') }));

    // 帰り道を宣言しない入力なので、戻り先の突合は見ていないと名指す(違反ではない)。
    expect(outcome).toEqual({ status: 'checked', file: CONFIG_FILE, findings: [], skipped: [expect.stringContaining('帰り道(callback)の宣言が無いため')] });
  });

  it('宣言と食い違う実ファイルは、checked で違反を返す', () => {
    const outcome = SUPABASE_AUTH_CONFIG.verify(input({ repoRoot: path.join(FIXTURES, 'auth-config-repo'), providers: ['other'] }));

    expect(outcome.status).toBe('checked');
    expect(outcome.status === 'checked' ? outcome.findings.map((finding) => finding.counterexample?.['method']) : []).toEqual(['github']);
  });

  it('設定ファイルが無ければ absent(未実施。緑にしない)', () => {
    expect(SUPABASE_AUTH_CONFIG.verify(input({ repoRoot: path.join(FIXTURES, 'jobs-repo') }))).toEqual({ status: 'absent', file: CONFIG_FILE });
  });

  it('H5 の登録の ID は H5', () => {
    expect(SUPABASE_AUTH_CONFIG.id).toBe('H5');
  });
});

describe('H5: フルパスに畳めない書き方は読まずにエラー', () => {
  /** 指摘の種類と場所。 */
  function shapes(text: string): string[] {
    return authConfigFindings(text, CONFIG_FILE, input())
      .filter((finding) => finding.counterexample?.['kind'] !== undefined)
      .map((finding) => `${finding.counterexample?.['kind']}@${finding.location.pointer}`);
  }

  it('インラインテーブルで書いた開いている口(セクションの中・ルート)', () => {
    expect(shapes(`${ALIGNED}\n[auth.external]\napple = { enabled = true }`)).toEqual(['inline_table@[auth.external].apple']);
    expect(shapes(`auth = { enable_anonymous_sign_ins = true }\n${ALIGNED}`)).toEqual(['inline_table@auth']);
  });

  it.each([
    ['ルートのドット付きのキー', 'auth.external.apple.enabled = true\n', '', 'dotted_key@auth.external.apple.enabled'],
    ['[auth] の中のドット付きのキー', '', '\n[auth]\nexternal.apple.enabled = true', 'dotted_key@[auth].external.apple.enabled'],
    ['[auth.external] の中のドット付きのキー', '', '\n[auth.external]\napple.enabled = true', 'dotted_key@[auth.external].apple.enabled'],
  ])('%s', (_name, before, after, expected) => {
    expect(shapes(`${before}${ALIGNED}${after}`)).toEqual([expected]);
  });

  it('引用符つきでドットを含むセクション名', () => {
    expect(shapes(`${ALIGNED}\n[auth.external."my.prov"]\nenabled = true`)).toEqual(['quoted_dotted_section@[auth.external.my.prov]']);
  });

  it('メッセージは何が読めないかと、書き直し方を言う', () => {
    const [finding] = authConfigFindings(`${ALIGNED}\n[auth.external]\napple = { enabled = true }`, CONFIG_FILE, input());

    expect(finding?.message).toBe(
      `${CONFIG_FILE} の [auth.external] apple がインラインテーブル({ … })で書かれています。この書き方は開いている口を読み落とすので、閉じているとも開いているとも判定できません`,
    );
    expect(finding?.suggestion).toContain('普通の [セクション] と キー = 値 の形に書き直す');
  });

  it('auth / api / remotes の外の書き方は見ない', () => {
    expect(shapes(`${ALIGNED}\n[storage]\nx = { y = 1 }\ndb.pool = 1`)).toEqual([]);
  });

  it('auth.external の下の真偽値でない値はエラー', () => {
    expect(messages(withExtra('[auth.external.apple]', 'enabled = "true"'))).toEqual([`${CONFIG_FILE} の [auth.external.apple] enabled を読めません(真偽値ではありません)`]);
  });
});

describe('H5: deploy 先(remotes)', () => {
  const REMOTE = '[remotes.prod.auth.external.apple]\nenabled = true';

  it('deploy 先が宣言に無い方式を開けていればエラー(位置は deploy 先のセクション)', () => {
    const findings = authConfigFindings(withExtra(REMOTE), CONFIG_FILE, input());

    expect(findings).toHaveLength(1);
    expect(findings[0]?.location.pointer).toBe('[remotes.prod.auth.external.apple].enabled');
    expect(findings[0]?.message).toContain('([remotes.prod.auth.external.apple] enabled が true です)');
    expect(findings[0]?.message).toContain('local_only');
  });

  it('local_only は deploy 先には使えない: deploy 先が開けると、ローカルで許した方式でもエラー', () => {
    const text = withExtra('[remotes.prod.auth.email]', 'enable_signup = true');

    expect(messages(text, { localOnly: [LOCAL_EMAIL] })).toHaveLength(1);
    expect(messages(text, { localOnly: [LOCAL_EMAIL] })[0]).toContain('[remotes.prod.auth.email] enable_signup が true です');
  });

  it('基の設定で local_only の方式が開いていて deploy 先が上書きしなければ、引き継いで開くので deploy 先の指摘になる', () => {
    const text = `${ALIGNED.replace('[auth.email]\nenable_signup = false', '[auth.email]\nenable_signup = true')}\n[remotes.prod]\nproject_id = "p"\n[remotes.prod.api]\nschemas = ["api"]`;

    const found = messages(text, { localOnly: [LOCAL_EMAIL] });

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('deploy 先は prod の有効な設定で見ています');
  });

  it('deploy 先が閉じる上書きをしていれば通る', () => {
    const text = `${ALIGNED.replace('[auth.email]\nenable_signup = false', '[auth.email]\nenable_signup = true')}\n[remotes.prod.auth.email]\nenable_signup = false`;

    expect(messages(text, { localOnly: [LOCAL_EMAIL] })).toEqual([]);
  });

  it('deploy 先が宣言した方式(providers)を開けるのは通る', () => {
    expect(messages(withExtra('[remotes.prod.auth.external.github]', 'enabled = true'))).toEqual([]);
  });

  it('deploy 先が余分なスキーマを外へ出せばエラー(自分で書いたときだけ。書かなければ基の設定の指摘と重ならない)', () => {
    const found = authConfigFindings(withExtra('[remotes.prod.api]', 'schemas = ["api", "graphql_public"]'), CONFIG_FILE, input());

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('[remotes.prod.api] schemas で graphql_public が外へ出ています');
    expect(messages(withExtra('[remotes.prod]', 'project_id = "p"'))).toEqual([]);
  });

  it('deploy 先のドット付きのキー・インラインテーブル・引用符つきでドットを含む名前・[remotes] 直下のキーはエラー', () => {
    expect(authConfigFindings(withExtra('[remotes.prod]', 'auth.email.enable_signup = true'), CONFIG_FILE, input()).map((finding) => finding.counterexample?.['kind'])).toEqual(['dotted_key']);
    expect(authConfigFindings(withExtra('[remotes.prod.auth]', 'email = { enable_signup = true }'), CONFIG_FILE, input()).map((finding) => finding.counterexample?.['kind'])).toEqual(['inline_table']);
    expect(authConfigFindings(withExtra('[remotes."a.b".auth.email]', 'enable_signup = true'), CONFIG_FILE, input()).map((finding) => finding.counterexample?.['kind'])).toContain('quoted_dotted_section');
    expect(messages(`${ALIGNED}\n[remotes]\nprod = "x"`)).toEqual([`${CONFIG_FILE} の [remotes] 直下にキーがあります。deploy 先の設定として読めません`]);
  });
});

describe('H5: 見なかった部分は理由を返す(黙って飛ばさない)', () => {
  /** 帰り道の宣言が無いときの戻り先の理由(この節の入力は帰り道を宣言しない。戻り先の突合は h5-redirects.test.ts が見る)。 */
  const NO_CALLBACK = '認証フロー仕様に帰り道(callback)の宣言が無いため、戻り先の許可リスト(site_url / additional_redirect_urls)の突合は見ていません';

  /** 見なかった理由(帰り道の宣言が無い理由を除く)。 */
  function skipped(text: string): string[] {
    return authConfigResult(text, CONFIG_FILE, input()).skipped.filter((reason) => reason !== NO_CALLBACK);
  }

  it('帰り道の宣言が無ければ、戻り先の許可リストの突合を見ていないと名指す(認証が動く設定のとき)', () => {
    expect(authConfigResult(ALIGNED, CONFIG_FILE, input()).skipped).toEqual([NO_CALLBACK]);
  });

  it('[auth] enabled = false', () => {
    expect(skipped(ALIGNED.replace('[auth]\n', '[auth]\nenabled = false\n'))).toEqual([`[auth] enabled = false のため、サインインの方式の突合は見ていません`]);
  });

  it('[api] enabled = false', () => {
    expect(skipped(ALIGNED.replace('[api]\n', '[api]\nenabled = false\n'))).toEqual([`[api] enabled = false のため、外へ出すスキーマの突合は見ていません`]);
  });

  it('deploy 先が自分で動かさないと書いたときだけ、その deploy 先の理由を返す(基の設定からの引き継ぎは基の設定の行が言う)', () => {
    expect(skipped(withExtra('[remotes.prod.auth]', 'enabled = false'))).toEqual(['[remotes.prod.auth] enabled = false のため、deploy 先 prod のサインインの方式の突合は見ていません']);
    expect(skipped(ALIGNED.replace('[auth]\n', '[auth]\nenabled = false\n') + '\n[remotes.prod]\nproject_id = "p"')).toEqual([`[auth] enabled = false のため、サインインの方式の突合は見ていません`]);
  });

  it('見なかった部分が無ければ空', () => {
    expect(skipped(ALIGNED)).toEqual([]);
  });
});

describe('H5: 書かれていないキーの既定', () => {
  it('SMS・匿名・ウォレット・外部プロバイダは、キーが書かれていなければ閉じている(既定は無効)', () => {
    const text = ['[api]', 'schemas = ["api"]', '[auth]', '[auth.email]', 'enable_signup = false', '[auth.sms]', '[auth.web3.solana]', '[auth.external.apple]', '[auth.third_party.firebase]'].join('\n');

    expect(messages(text, { providers: [] })).toEqual([]);
  });

  it('[api] が無ければ既定(公開スキーマ + GraphQL)で開く', () => {
    const found = authConfigFindings('[auth.email]\nenable_signup = false', CONFIG_FILE, input());

    expect(found.map((finding) => finding.counterexample?.['schema'])).toEqual(['public', 'graphql_public']);
  });

  it('メールの登録は、キーが書かれていなければ既定で有効', () => {
    expect(messages('[api]\nschemas = ["api"]')).toHaveLength(1);
  });
});

describe('H5: 複数行の文字列・エスケープした名前・読めない行(読み落とし)', () => {
  /** 開いている口(宣言に無い github)がある設定に、別の本文を足したときの指摘のメッセージ。 */
  function open(extra: string, providers: string[] = []): string[] {
    return messages(`${extra}\n[auth.external.github]\nenabled = true\n${ALIGNED.replace('[auth.external.github]\nenabled = true', '')}`, { providers });
  }

  const FAKE = '[note]\ntext = """\n[auth.external.github]\nenabled = false\n[auth.email]\nenable_signup = false\n[api]\nschemas = ["api"]\n"""';

  /** 三連の引用符の指摘だけが返ること(口の突合は出さない)。 */
  function tripleOnly(text: string, providers: string[] = []): string[] {
    const found = authConfigFindings(text, CONFIG_FILE, input({ providers }));
    expect(found.map((finding) => finding.counterexample?.['kind'])).toEqual(['triple_quote']);
    return found.map((finding) => finding.message);
  }

  it('複数行の文字列の中の偽の enabled = false / 偽の見出し / 偽の [api] は、読まずにファイル全体を error にする(本物の口を隠さない)', () => {
    const [message] = tripleOnly(`${FAKE}\n[auth.external.github]\nenabled = true\n${ALIGNED.replace('[auth.external.github]\nenabled = true', '')}`);

    expect(message).toContain('行目に三連の引用符(""" または \'\'\')があります');
    expect(message).toContain('信用できません');
  });

  it('リテラルの三連の引用符・1 行で閉じる三連の引用符・watch 外のセクションの中でも error', () => {
    tripleOnly(withExtra('[auth.external.github]', 'enabled = false', "note = '''", 'enabled = true', "'''"));
    tripleOnly(withExtra('[api]', 'x = """a"""'));
    tripleOnly(withExtra('[storage]', 'x = """a"""'));
  });

  it('再現 1: 1 行の文字列の中の三連の引用符(配列の中)が、後ろの本物の口を飲み込まない', () => {
    const text = `[db]\nx = ["'''"]\n[auth.external.github]\nenabled = true\n${ALIGNED.replace('[auth.external.github]\nenabled = true', '')}`;

    tripleOnly(text);
    tripleOnly(text.replace("'''", '"""'));
  });

  it('再現 2: watch 外のセクションのインラインテーブルの中の複数行の文字列が、本物の口を上書きしない', () => {
    const text = `[db]\nx = { a = """\n[auth.external.github]\nenabled = false\n[db]\n""" }\n[auth.external.github]\nenabled = true\n${ALIGNED.replace('[auth.external.github]\nenabled = true', '')}`;

    tripleOnly(text);
  });

  it('閉じていない複数行の文字列(watch 外のセクション)は、ファイルの最後まで黙って読み飛ばさず error', () => {
    tripleOnly(`${ALIGNED}\n[db]\nx = """\nnever closed\n`);
  });

  it('閉じの後ろに続く内容を捨てない: 閉じの後ろの内容があるファイルも error', () => {
    tripleOnly(`${ALIGNED}\n[db]\nx = """a\nb""" ; [auth.external.apple]\nenabled = true`);
  });

  it('コメントの中の三連の引用符も error(読み違えうるファイルは信用しない。位置は最初の行)', () => {
    const found = authConfigFindings(`${ALIGNED}\n# ''' メモ`, CONFIG_FILE, input());

    expect(found).toHaveLength(1);
    expect(found[0]?.location.pointer).toBe(`line ${ALIGNED.split('\n').length + 1}`);
    expect(found[0]?.counterexample).toMatchObject({ kind: 'triple_quote' });
  });

  it('三連の引用符が無ければ、通常どおり口を突き合わせる', () => {
    expect(messages(ALIGNED)).toEqual([]);
    expect(open('')).toHaveLength(1);
  });

  it('エスケープした名前の開いている口(セクション名・キー・ドット付きのキー)は、口として読み、かつ書き直しを求める', () => {
    const cases = [
      `${ALIGNED}\n[auth.external."\\u0061pple"]\nenabled = true`,
      `${ALIGNED.replace('[auth.email]\nenable_signup = false', '[auth.email]\n"enable_\\u0073ignup" = true')}`,
      `"\\u0061uth".external.apple.enabled = true\n${ALIGNED}`,
      `${ALIGNED}\n["\\u0061uth".external.apple]\nenabled = true`,
    ];
    for (const text of cases) {
      const kinds = authConfigFindings(text, CONFIG_FILE, input()).map((finding) => finding.counterexample?.['kind'] ?? 'door');
      expect(kinds, text).toContain('escaped_name');
    }
    expect(messages(cases[0] ?? '')).toHaveLength(2);
    expect(messages(cases[1] ?? '')).toHaveLength(2);
  });

  it.each([
    ['見出しの後ろに文字', '[auth.external.apple] junk'],
    ['] の無い見出し', '[auth.external.apple'],
    ['見出しと キー = 値 の同居', '[auth.external.apple] enabled = true'],
    ['= の無い行(auth の中)', '[auth]\njunk'],
    ['書けないキー(api の中)', '[api]\nbad key = 1'],
  ])('読めない行はエラー: %s', (_name, line) => {
    const kinds = authConfigFindings(`${ALIGNED}\n${line}`, CONFIG_FILE, input()).map((finding) => finding.counterexample?.['kind']);

    expect(kinds).toContain('unrecognized_line');
  });

  it('読めない行のメッセージは、行と直し方を言う', () => {
    const [finding] = authConfigFindings(`${ALIGNED}\n[auth.external.apple] junk`, CONFIG_FILE, input());

    expect(finding?.message).toContain('の行「[auth.external.apple] junk」が、セクションの見出しでも キー = 値 でもなく、読めません');
    expect(finding?.suggestion).toContain('] を閉じる');
  });

  it('auth / api / remotes の外の読めない行・エスケープは見ない', () => {
    const text = `${ALIGNED}\n[storage]\njunk\n"a\\u0062" = 1`;

    expect(messages(text)).toEqual([]);
  });
});


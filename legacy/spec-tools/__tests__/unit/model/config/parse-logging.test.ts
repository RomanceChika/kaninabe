/**
 * K0(ログの目録 `logging` の形)のユニットテスト。
 *
 * 規約網羅(config-spec-writing.md §ログの目録):
 *   - 正しい宣言が読める(format・sink・retention・readers)
 *   - `logging` が無いことは K0 の違反ではない(K5 が言う)。`loggingDeclared` が偽になる
 *   - format は json_lines だけ
 *   - sink は省略できる(本番を宣言せず、転送先も書かない = 何も言われない)。required_in は省略・空でよく、書くなら置き場の語・重複なし
 *   - 転送先は mode(app_direct / host_drain) / label / off_host(真偽) / configured_in が必須。app_direct は key_env(環境変数名の形)が必須、host_drain は書けない
 *   - exempt(本番でも要らない理由)は転送先の欄と同時には書けず、required_in(本番の宣言)があるときだけ書け、理由は空でない
 *   - retention は days(正の整数)と reason が必須
 *   - readers は 1 つ以上
 *   - 知らないキーは落とす(綴りの間違いが黙って無視されない)
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { parseConfigCatalog } from '../../../../lib/model/config/parse-config.js';

const VOCABULARY = {
  kind: [{ id: 'secret' }],
  requirement: [{ id: 'required', default_targets: ['local', 'production'] }],
  used_by: [{ id: 'supabase_data' }],
  provision: [{ id: 'prompt' }],
  target: [
    { id: 'local', probe: { kind: 'dotenv', path: 'dev/dotenv-local' } },
    { id: 'production', probe: { kind: 'command', argv: ['vercel', 'env', 'ls', 'production'], cwd: 'app' } },
  ],
};

const LOGGING = {
  format: 'json_lines',
  sink: { mode: 'host_drain', label: 'ログドレイン', off_host: true, required_in: ['production'], configured_in: '管理画面' },
  retention: { days: 90, reason: '調査に要る期間' },
  readers: ['運用担当'],
};

function parse(logging: unknown) {
  const reporter = new SpecReporter('spec/config-catalog');
  const data = { doc_type: 'config_spec', scope: 'backend', id: 'config-catalog', vocabulary: VOCABULARY, variables: [], ...(logging === undefined ? {} : { logging }) };
  const result = parseConfigCatalog(data, reporter);
  if (result.value === null) throw new Error('カタログを構築できませんでした');
  return { value: result.value, messages: result.findings.map((finding) => finding.message) };
}

/** 正しい宣言の一部を差し替える。 */
function with_(patch: Record<string, unknown>): unknown {
  return { ...LOGGING, ...patch };
}

describe('K0: logging の形', () => {
  it('正しい宣言が読める', () => {
    const { value, messages } = parse(LOGGING);
    expect(messages).toEqual([]);
    expect(value.loggingDeclared).toBe(true);
    expect(value.logging).toMatchObject({
      format: 'json_lines',
      sink: {
        requiredIn: ['production'],
        destination: { kind: 'forward', mode: 'host_drain', label: 'ログドレイン', offHost: true, keyEnv: null, configuredIn: '管理画面' },
      },
      retention: { days: 90, reason: '調査に要る期間' },
      readers: ['運用担当'],
    });
  });

  const APP_DIRECT = { mode: 'app_direct', label: 'Axiom', off_host: true, key_env: 'AXIOM_TOKEN', required_in: ['production'], configured_in: 'Vercel の環境変数' };

  it('app_direct は key_env を読む', () => {
    const { value, messages } = parse(with_({ sink: APP_DIRECT }));
    expect(messages).toEqual([]);
    expect(value.logging?.sink).toEqual({
      requiredIn: ['production'],
      destination: { kind: 'forward', mode: 'app_direct', label: 'Axiom', offHost: true, keyEnv: 'AXIOM_TOKEN', configuredIn: 'Vercel の環境変数' },
    });
  });

  it('sink を省略すれば、本番を宣言せず転送先も書かない宣言になる(試験環境・趣味の用途)', () => {
    const { value, messages } = parse(with_({ sink: undefined }));
    expect(messages).toEqual([]);
    expect(value.logging?.sink).toEqual({ requiredIn: [], destination: { kind: 'none' } });
  });

  it('required_in だけを書けば、転送先は none(K5 が警告する)', () => {
    const { value, messages } = parse(with_({ sink: { required_in: ['production'] } }));
    expect(messages).toEqual([]);
    expect(value.logging?.sink).toEqual({ requiredIn: ['production'], destination: { kind: 'none' } });
  });

  it('required_in を空にしても読める(本番を宣言しない)', () => {
    const { value, messages } = parse(with_({ sink: { ...APP_DIRECT, required_in: [] } }));
    expect(messages).toEqual([]);
    expect(value.logging?.sink.requiredIn).toEqual([]);
  });

  it('exempt は理由と位置を持つ宣言として読める', () => {
    const { value, messages } = parse(with_({ sink: { required_in: ['production'], exempt: '個人情報を持たない社内ツール' } }));
    expect(messages).toEqual([]);
    expect(value.logging?.sink.destination).toMatchObject({ kind: 'exempt', reason: '個人情報を持たない社内ツール' });
  });

  it('logging が無いことは K0 の違反ではない(K5 が言う)', () => {
    const { value, messages } = parse(undefined);
    expect(messages).toEqual([]);
    expect(value.logging).toBeUndefined();
    expect(value.loggingDeclared).toBe(false);
  });

  const BAD: readonly { readonly name: string; readonly logging: unknown; readonly message: RegExp }[] = [
    { name: 'マッピングでない', logging: 'json', message: /logging はマッピングで書きます/ },
    { name: 'format が値域の外', logging: with_({ format: 'plain_text' }), message: /format plain_text は使えません/ },
    { name: 'format が無い', logging: with_({ format: undefined }), message: /format がありません/ },
    { name: 'sink がマッピングでない', logging: with_({ sink: 'drain' }), message: /sink はマッピングで書きます/ },
    { name: 'sink.mode が無い', logging: with_({ sink: { ...LOGGING.sink, mode: undefined } }), message: /mode がありません/ },
    { name: 'sink.mode が値域の外', logging: with_({ sink: { ...LOGGING.sink, mode: 'syslog' } }), message: /mode syslog は使えません/ },
    { name: 'app_direct に key_env が無い', logging: with_({ sink: { ...APP_DIRECT, key_env: undefined } }), message: /key_env がありません/ },
    { name: 'key_env が環境変数名の形でない', logging: with_({ sink: { ...APP_DIRECT, key_env: 'axiom-token' } }), message: /key_env axiom-token は環境変数名の形/ },
    { name: 'host_drain に key_env', logging: with_({ sink: { ...LOGGING.sink, key_env: 'AXIOM_TOKEN' } }), message: /host_drain に key_env は書けません/ },
    { name: 'exempt と転送先の欄を同時に書く', logging: with_({ sink: { ...APP_DIRECT, exempt: '要らない' } }), message: /exempt は転送先の宣言\(mode \/ label \/ off_host \/ key_env \/ configured_in\)と同時には書けません/ },
    { name: 'exempt の理由が空', logging: with_({ sink: { required_in: ['production'], exempt: '  ' } }), message: /exempt の理由が空です/ },
    { name: 'exempt が文字列でない', logging: with_({ sink: { required_in: ['production'], exempt: true } }), message: /exempt/ },
    { name: 'exempt なのに required_in が無い', logging: with_({ sink: { exempt: '要らない' } }), message: /exempt は required_in\(本番の置き場\)があるときだけ/ },
    { name: 'sink.label が無い', logging: with_({ sink: { ...LOGGING.sink, label: undefined } }), message: /label がありません/ },
    { name: 'sink.off_host が真偽でない', logging: with_({ sink: { ...LOGGING.sink, off_host: 'yes' } }), message: /off_host は true \/ false で書きます/ },
    { name: 'sink.off_host が無い', logging: with_({ sink: { ...LOGGING.sink, off_host: undefined } }), message: /off_host がありません/ },
    { name: '本番を宣言した sink の下で知らせ先の required_in が空(C15-7)', logging: with_({ sink: { ...LOGGING.sink, required_in: ['production'] }, dead_letter_alert: { required_in: [] } }), message: /dead_letter_alert の required_in が空です/ },
    { name: '本番を宣言した sink の下で知らせ先の required_in が無い', logging: with_({ sink: { ...LOGGING.sink, required_in: ['production'] }, dead_letter_alert: { mode: 'host_drain', label: '知らせ', off_host: true, configured_in: '管理画面' } }), message: /dead_letter_alert の required_in が空です/ },
    { name: 'required_in がリストでない', logging: with_({ sink: { ...LOGGING.sink, required_in: 'production' } }), message: /required_in/ },
    { name: 'required_in が置き場の語でない', logging: with_({ sink: { ...LOGGING.sink, required_in: ['staging'] } }), message: /target staging は vocabulary.target に宣言されていません/ },
    { name: 'required_in が重複', logging: with_({ sink: { ...LOGGING.sink, required_in: ['local', 'local'] } }), message: /同じ置き場が重複/ },
    { name: 'configured_in が無い', logging: with_({ sink: { ...LOGGING.sink, configured_in: undefined } }), message: /configured_in がありません/ },
    { name: 'sink に知らないキー', logging: with_({ sink: { ...LOGGING.sink, endpoint: 'https://x' } }), message: /logging\.sink に endpoint は書けません/ },
    { name: 'retention が無い', logging: with_({ retention: undefined }), message: /retention がありません/ },
    { name: 'retention.days が 0', logging: with_({ retention: { days: 0, reason: 'x' } }), message: /days 0 は正の整数ではありません/ },
    { name: 'retention.days が小数', logging: with_({ retention: { days: 1.5, reason: 'x' } }), message: /days 1.5 は正の整数ではありません/ },
    { name: 'retention.days が数値でない', logging: with_({ retention: { days: '90', reason: 'x' } }), message: /days は数値で書きます/ },
    { name: 'retention.days が無い', logging: with_({ retention: { reason: 'x' } }), message: /days がありません/ },
    { name: 'retention.reason が無い', logging: with_({ retention: { days: 90 } }), message: /reason がありません/ },
    { name: 'readers が空', logging: with_({ readers: [] }), message: /readers/ },
    { name: 'readers が無い', logging: with_({ readers: undefined }), message: /readers がありません/ },
    { name: '知らないキー', logging: with_({ sinks: [] }), message: /logging に sinks は書けません/ },
  ];
  for (const { name, logging, message } of BAD) {
    it(`${name}なら K0 が落とす(K5 が二重に言わない)`, () => {
      const { value, messages } = parse(logging);
      expect(messages.some((text) => message.test(text)), `${name}: ${messages.join(' | ')}`).toBe(true);
      expect(value.loggingDeclared).toBe(true);
      // 知らないキーは、残りが正しければ宣言は読む(K0 の違反が verify を止める)。それ以外は宣言を読まない。
      if (!/知らないキー/.test(name)) expect(value.logging).toBeUndefined();
    });
  }
});

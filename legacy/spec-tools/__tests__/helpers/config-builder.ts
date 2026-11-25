/**
 * config_spec(設定カタログ)テスト用の最小ビルダー。
 *
 * 規約(scripts-code-quality.md)により検証器・生成器のテストはファイル I/O を行わず、
 * モデルをテスト内でリテラル構築する。ここではその定型部分(location・語彙の既定)を引き受ける。
 */

import type { ConfigCatalogSpec, ConfigLoggingDecl, ConfigSpecModel, ConfigVariableDecl } from '../../lib/model/config/types.js';
import { loc } from './model-builder.js';

/** カタログの仕様ファイル(location に使う)。 */
const CATALOG_FILE = 'docs/specs/backend/config.md';

/**
 * 設定 1 件を作る。既定は「必須・Supabase が使う・雛形にも載る・人が値を貼る・開発機に要る」。
 */
export function configVariable(
  id: string,
  opts: Partial<Omit<ConfigVariableDecl, 'id' | 'location'>> = {},
): ConfigVariableDecl {
  return {
    id,
    kind: 'secret',
    requirement: 'required',
    usedBy: ['supabase_data'],
    provision: 'prompt',
    targets: ['local'],
    summary: `${id} の説明`,
    absence: `${id} が無いと落ちる`,
    ...opts,
    location: loc(CATALOG_FILE, `variables.${id}`),
  };
}

/**
 * カタログ 1 件を作る。語彙はビルダーの既定値を全部含む。
 *
 * 置き場は 2 本(ファイルのキー名を読む置き場と、コマンドで名前を列挙しリポジトリ側の
 * 読み口も持つ置き場)にしてある —— K3 が見る「読み口を宣言した置き場」の両方の形を
 * テストから実行できるようにするためである。
 */
export function configCatalog(variables: readonly ConfigVariableDecl[], logging?: ConfigLoggingDecl): ConfigCatalogSpec {
  return {
    id: 'config-catalog',
    vocabulary: {
      kind: [{ id: 'secret' }, { id: 'endpoint' }, { id: 'switch' }],
      requirement: [
        { id: 'required', defaultTargets: ['local'] },
        { id: 'optional_degrades', defaultTargets: ['local'] },
        { id: 'tooling_only', defaultTargets: [] },
      ],
      used_by: [
        { id: 'supabase_data', label: 'Supabase — 業務データ' },
        { id: 'test_harness', label: 'テスト・走査の道具' },
      ],
      provision: [
        { id: 'prompt', label: '人が値を貼る' },
        { id: 'generate', label: '道具が生成する' },
      ],
      target: [
        { id: 'local', label: '開発機', probe: { kind: 'dotenv', path: 'app/.env.local' } },
        {
          id: 'ci',
          label: 'CI の秘密',
          probe: { kind: 'command', argv: ['gh', 'secret', 'list', '--json', 'name'] },
          readBy: { kind: 'workflow_secret', path: '.github/workflows' },
        },
      ],
    },
    variables,
    ...(logging === undefined ? {} : { logging }),
    loggingDeclared: logging !== undefined,
    location: loc(CATALOG_FILE),
  };
}

/** ログの目録の宣言を作る(既定は「ホストの外へ転送(配置先のログドレイン)・本番に必須・90 日・運用担当が読む」)。 */
export function loggingDecl(overrides: Partial<Omit<ConfigLoggingDecl, 'location'>> = {}): ConfigLoggingDecl {
  return {
    format: 'json_lines',
    sink: {
      requiredIn: ['ci'],
      destination: { kind: 'forward', mode: 'host_drain', label: 'ログドレイン', offHost: true, keyEnv: null, configuredIn: 'ダッシュボードの設定画面' },
    },
    // 死んだジョブの知らせ先は既定で必須にしない(K5 の個別のテストが欄を渡す)。
    deadLetterAlert: { requiredIn: [], destination: { kind: 'none' } },
    retention: { days: 90, reason: '調査に要る期間' },
    readers: ['運用担当'],
    ...overrides,
    location: loc(CATALOG_FILE, 'logging'),
  };
}

/** ConfigSpecModel を作る(available は既定 true)。 */
export function configModel(
  variables: readonly ConfigVariableDecl[],
  available = true,
  logging?: ConfigLoggingDecl,
): ConfigSpecModel {
  return { available, catalog: configCatalog(variables, logging) };
}

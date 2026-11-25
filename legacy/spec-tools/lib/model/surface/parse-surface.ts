/**
 * surface_spec(SQL の公開面の仕様)のパーサー(スキーマ適合)。
 *
 * スキーマの正: surface-spec-writing.md。ここで見るのは**1 ファイルの中で閉じる形**だけである ——
 * 文書 ID が固定値であること・書けるキーが閉じていること・`hand_written_views` の各行が
 * 表と理由を持つこと。宣言と生成物・data_table との突合(宣言できる表か・連番の前後)は
 * T12 が別に見る(この器は「読めた形」だけを返す)。
 *
 * 旧い綴り(`doc_type: api_spec` / `api_base_migration`)は受けない(二重受けの期間を作らない)。
 * 書き直し先を名指して error にする。
 */

import type { SpecReporter } from '../parse-common.js';
import { optionalMigrationFile } from '../migration-file.js';
import { checkDocType, META_FRONTMATTER_KEYS, type ParseResult } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import type { HandWrittenViewDecl, SurfaceSpec } from './types.js';

/** 文書 ID(1 プロジェクト 1 枚なので導出元が無く固定)。 */
export const SURFACE_SPEC_ID = 'surface';

/** surface_spec のトップレベルに書けるキー。 */
const SPEC_KEYS: readonly string[] = [
  ...META_FRONTMATTER_KEYS,
  'surface_base_migration',
  'grants_migration',
  'hand_written_views',
];

/** `hand_written_views` の 1 要素に書けるキー。 */
const VIEW_KEYS: readonly string[] = ['table', 'reason'];

/** 旧い doc_type と書き直し先。 */
const RETIRED_DOC_TYPE = 'api_spec';

/**
 * 旧いキーと、書き直し先の対応。二重には受けず、名指して error にする。
 * 引くのは自前の `Map` だけ(オブジェクトの添字で引くと継承されたプロパティを拾う)。
 */
const RETIRED_KEYS: ReadonlyMap<string, string> = new Map<string, string>([['api_base_migration', 'surface_base_migration']]);

/** 土台の書き出し先を書くときの直し方。 */
const BASE_SUGGESTION =
  'surface_base_migration に "{14 桁の連番}_{exposedSchema}_base.sql" を書く' +
  '(中身はどのアプリでも同じ 1 枚なので、仕様が宣言するのはファイル名だけである)';

/** 権限の書き出し先を書くときの直し方。 */
const GRANTS_SUGGESTION =
  'grants_migration に "{14 桁の連番}_grants.sql" を書く' +
  '(与える権限はどの表でも同じ 1 組なので、仕様が宣言するのはファイル名だけである。' +
  '連番は表の DDL のどれよりも後にする)';

/** 手書きのビューを宣言するときの直し方。 */
const VIEW_SUGGESTION =
  'hand_written_views の各行に table(internal: true の data_table)と reason(生成物にできない根拠)を書く';

/** 知らないキーを見つけたときに示す共通の直し方。 */
function unknownKeyHint(allowed: readonly string[]): string {
  return `書けるのは ${allowed.join(' / ')} だけ。綴り違いを直す`;
}

/**
 * 旧い綴り(doc_type・キー)を見つけたら、書き直し先を名指して error にする。
 *
 * @returns doc_type が旧い綴りだったか(true なら doc_type の一般の指摘は重ねない)
 */
function rejectRetiredSpellings(data: Readonly<Record<string, unknown>>, root: YamlReader, reporter: SpecReporter): boolean {
  const retiredDocType = data['doc_type'] === RETIRED_DOC_TYPE;
  if (retiredDocType) {
    reporter.error(
      'doc_type',
      `doc_type ${RETIRED_DOC_TYPE} は廃止されました(SQL の公開面の仕様は surface_spec で書きます)`,
      `doc_type: surface_spec に直す。置き場も docs/specs/backend/api.md ではなく docs/specs/backend/surface.md、` +
        `id は ${SURFACE_SPEC_ID} 固定`,
      { actual: RETIRED_DOC_TYPE, expected: 'surface_spec' },
    );
  }
  for (const [retired, renamed] of RETIRED_KEYS) {
    if (!root.has(retired)) continue;
    reporter.error(
      root.pointer(retired),
      `${retired} は廃止されました(書き出し先は ${renamed} で書きます)`,
      `${retired} を ${renamed} に書き直す`,
      { key: retired, expected: renamed },
    );
  }
  return retiredDocType;
}

/**
 * surface_spec 1 ファイル分のフロントマターをパースする。
 *
 * @param data フロントマターのマッピング
 * @param reporter 違反の記録先(Finding の location.file を持つ)
 * @returns 構築した宣言とスキーマ違反
 */
export function parseSurfaceSpec(
  data: Readonly<Record<string, unknown>>,
  reporter: SpecReporter,
): ParseResult<SurfaceSpec> {
  const root = new YamlReader(data, '', reporter);
  if (!rejectRetiredSpellings(data, root, reporter)) checkDocType(data, 'surface_spec', reporter);
  root.rejectUnknownKeys([...SPEC_KEYS, ...RETIRED_KEYS.keys()], 'surface_spec', unknownKeyHint(SPEC_KEYS));

  const id = root.requiredString('id', `id を ${SURFACE_SPEC_ID} と書く(1 プロジェクト 1 枚)`);
  if (id !== null && id !== SURFACE_SPEC_ID) {
    reporter.error('id', `id ${id} は surface_spec の id ではありません`, `id: ${SURFACE_SPEC_ID} に直す`, {
      id,
      expected: SURFACE_SPEC_ID,
    });
  }
  const surfaceBaseMigration = optionalMigrationFile(root, reporter, 'surface_base_migration', BASE_SUGGESTION);
  const grantsMigration = optionalMigrationFile(root, reporter, 'grants_migration', GRANTS_SUGGESTION);

  return {
    value: {
      id: SURFACE_SPEC_ID,
      ...(surfaceBaseMigration === undefined ? {} : { surfaceBaseMigration }),
      ...(grantsMigration === undefined ? {} : { grantsMigration }),
      handWrittenViews: parseHandWrittenViews(root, reporter),
      location: reporter.location(),
    },
    findings: reporter.findings(),
  };
}

/** 手書きのまま残すビューの宣言を読む。 */
function parseHandWrittenViews(root: YamlReader, reporter: SpecReporter): readonly HandWrittenViewDecl[] {
  const items = root.optionalList('hand_written_views', VIEW_SUGGESTION);
  const views: HandWrittenViewDecl[] = [];
  eachRecord(items, 'hand_written_views', reporter, VIEW_SUGGESTION, (reader) => {
    reader.rejectUnknownKeys(VIEW_KEYS, 'hand_written_views[]', unknownKeyHint(VIEW_KEYS));
    const table = reader.requiredString('table', VIEW_SUGGESTION);
    const reason = reader.requiredString('reason', VIEW_SUGGESTION);
    if (table === null || reason === null) return;
    views.push({ table, reason, location: reporter.location(reader.pointer('table')) });
  });
  reporter.settleRows(items.length, views.length);
  return views;
}

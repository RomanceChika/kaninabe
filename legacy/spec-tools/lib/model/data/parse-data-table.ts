/**
 * data_table(テーブル仕様)のパーサー(T0 = スキーマ適合)。
 *
 * スキーマの正: ARCH-SP-BE-0001 §テーブル仕様(data_table)。
 * ここで見るのは 1 ファイルの中で閉じる形式だけであり、entity_spec との突合(実在・
 * テーブル名の一貫性)は T1 が、実 DB との突合は統合テスト(data-table-parity)が行う。
 */

import { COPY_ACCEPT_KEY, parseTriggerCopyAccepts } from '../parse-copy-accept.js';
import { defaultsField, firesField, fragmentField, identifierField, identifierListField, qualifiedField } from '../sql-fields.js';
import type { SpecReporter } from '../parse-common.js';
import { optionalMigrationFile } from '../migration-file.js';
import { checkDocType, type ParseResult } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import { parseTestCases } from '../parse-test-case.js';
import type {
  DataCheckDecl,
  DataForeignKeyDecl,
  DataTableSpec,
  DataTriggerDecl,
  OnDeleteAction,
} from './types.js';
import { ON_DELETE_ACTIONS } from './types.js';
import { parseDerives } from './parse-data-derives.js';
import { erasureFields } from './parse-erasure-accept.js';
import { parseAdvisory, parseCopiesFrom, parseRefuseErased, parseRemembersOwner, parseTriggerLocks } from './parse-lock-decls.js';
import { parseFunctions } from './parse-data-functions.js';
import { parityAcceptsField } from './parse-parity-accept.js';
import { parseResend } from './parse-data-resend.js';
import { parseExclusions, parseIndexes, parseRetentionHours, parseSequences } from './parse-data-shape.js';

/** テーブル名・識別子(スネークケース)。 */
const SNAKE = /^[a-z][a-z0-9_]*$/;

const TABLE_SUGGESTION = 'table に物理テーブル名(スネークケース・複数形)を書く(例: table: entries)';

/** defaults(列の既定値)の書き方。 */
const DEFAULTS_SUGGESTION =
  'defaults は "{列名}: {SQL の式}" のマッピングで書く' +
  "(例: defaults: { code: \"gen_random_uuid()\" })。entity_spec が supplied_by: db を宣言した欄の" +
  '機構のうち、列の既定値で決まるものだけを書く(id / state のような導出の既定値は書かない)';

/** 生成物の書き出し先と、仕組みが自分で持つ表の宣言(トップレベルの任意の宣言)の書き方。 */
const POLICIES_SUGGESTION =
  'policies_migration に RLS の select ポリシーを生成する migration のファイル名を書く(例: 20260912000150_policies_entries.sql)';
const DDL_SUGGESTION =
  'ddl_migration に表の DDL を生成する migration のファイル名を書く(例: 20260922000266_ddl_entries.sql)';
const FRAMEWORK_SUGGESTION = 'framework に仕組みが持つ表の設計図の名前を書く(jobs / domain_events / resend_digests。値域は T12 が見る)';
const SURFACE_SUGGESTION =
  'surface_migration に SQL の公開面(surface)のビューを生成する migration のファイル名を書く(例: 20260923000338_api_view_entries.sql。' +
  '名前の形は T12 が見る)';

/** 旧いキー `api_view_migration`(`surface_migration` の旧い綴り)を書き直す先を名指す対処。 */
const RETIRED_SURFACE_KEY = 'api_view_migration';

/**
 * data_table 1 ファイル分のフロントマターをパースする。
 *
 * @param data フロントマターのマッピング
 * @param relPath specs/backend/data/tables からの相対パス(ファイル名の検査と一覧表用)
 * @param reporter 違反の記録先(Finding の location.file を持つ)
 * @returns 構築した宣言と T0 違反
 */
export function parseDataTableSpec(
  data: Readonly<Record<string, unknown>>,
  relPath: string,
  reporter: SpecReporter,
): ParseResult<DataTableSpec> {
  checkDocType(data, 'data_table', reporter);
  const root = new YamlReader(data, '', reporter);

  const table = root.requiredString('table', TABLE_SUGGESTION);
  if (table !== null && !SNAKE.test(table)) {
    reporter.error('table', `テーブル名 ${table} がスネークケースではありません`, TABLE_SUGGESTION, { table });
  }
  const id = root.requiredString('id', 'id を "table-{テーブル名}" 形式で書く(id_policy)');
  const entity = root.optionalString('entity', 'entity に対応する entity_spec の entity(単数形)を書く');
  const internal = root.optionalBoolean(
    'internal',
    'internal は true / false で書く(ドメイン仕様に現れない内部テーブルだけ true)',
  );
  const policiesMigration = optionalMigrationFile(root, reporter, 'policies_migration', POLICIES_SUGGESTION);
  const ddlMigration = optionalMigrationFile(root, reporter, 'ddl_migration', DDL_SUGGESTION);
  const framework = root.optionalString('framework', FRAMEWORK_SUGGESTION);
  const mirrorOf = root.optionalString('mirror_of', 'mirror_of は添える写しの表の名前を書く(internal: true の表だけ)');
  if (mirrorOf !== undefined && !internal) {
    reporter.error(root.pointer('mirror_of'), 'mirror_of は internal: true の表だけが宣言できます', 'mirror_of を消すか、この表を internal: true にする', { table: table ?? '', mirror_of: mirrorOf });
  }
  const retiredSurfaceKey = root.has(RETIRED_SURFACE_KEY);
  if (retiredSurfaceKey) {
    reporter.error(
      root.pointer(RETIRED_SURFACE_KEY),
      `${RETIRED_SURFACE_KEY} は廃止されました(書き出し先は surface_migration で書きます)`,
      `${RETIRED_SURFACE_KEY} を surface_migration に書き直す(値のファイル名はそのまま)`,
      { key: RETIRED_SURFACE_KEY, expected: 'surface_migration' },
    );
  }
  const surfaceMigration = optionalMigrationFile(root, reporter, 'surface_migration', SURFACE_SUGGESTION);
  const testCases = parseTestCases(root, reporter) ?? [];
  const sequences = parseSequences(root, reporter);
  const resend = parseResend(root, reporter);
  const accepts = { ...erasureFields(root, reporter, internal), ...parityAcceptsField(root, reporter) };

  checkIdentity({ id, table, entity, internal, relPath }, reporter);

  const spec: DataTableSpec | null =
    table === null || id === null
      ? null
      : {
          id,
          table,
          ...(entity === undefined ? {} : { entity }),
          internal,
          indexes: parseIndexes(root, reporter),
          sequences,
          exclusions: parseExclusions(root, reporter),
          foreignKeys: parseForeignKeys(root, reporter),
          triggers: parseTriggers(root, reporter),
          defaults: defaultsField(root, reporter, 'defaults', root.optionalStringMap('defaults', DEFAULTS_SUGGESTION), new Set(sequences.map((sequence) => sequence.name))),
          ...(policiesMigration === undefined ? {} : { policiesMigration }),
          ...(ddlMigration === undefined ? {} : { ddlMigration }),
          ...(framework === undefined ? {} : { framework }),
          ...parseRetentionHours(root, reporter, framework),
          ...(mirrorOf === undefined ? {} : { mirrorOf }),
          ...(surfaceMigration === undefined ? {} : { surfaceMigration }),
          ...(retiredSurfaceKey ? { retiredSurfaceKey: true as const } : {}),
          ...(resend === undefined ? {} : { resend }),
          ...accepts,
          functions: parseFunctions(root, reporter),
          checks: parseChecks(root, reporter),
          testCases,
          location: reporter.location(),
          relPath,
        };
  return { value: spec, findings: reporter.findings() };
}

/** id・ファイル名・entity/internal の排他という「このファイルが何者か」の宣言を検査する。 */
function checkIdentity(
  args: {
    id: string | null;
    table: string | null;
    entity: string | undefined;
    internal: boolean;
    relPath: string;
  },
  reporter: SpecReporter,
): void {
  const { id, table, entity, internal, relPath } = args;
  if (table !== null && id !== null && id !== `table-${table}`) {
    reporter.error(
      'id',
      `id ${id} が table から導かれる形(table-${table})と一致しません`,
      `id: table-${table} に直す(id_policy: data_table の id は対象の名前から機械的に導く)`,
      { id, expected: `table-${table}` },
    );
  }
  if (table !== null && relPath !== `${table}.md`) {
    reporter.error(
      'table',
      `ファイル名 ${relPath} が table(${table})と一致しません`,
      `ファイルを ${table}.md に置くか、table の値を直す(パスと宣言の機械的対応 — PRIN-0008)`,
      { file: relPath, table },
    );
  }
  if (entity !== undefined && internal) {
    reporter.error(
      'internal',
      'entity と internal: true が同時に宣言されています',
      'ドメインの表なら entity だけを、内部テーブルなら internal: true だけを書く(排他)',
      { entity },
    );
  }
  if (entity === undefined && !internal) {
    reporter.error(
      'entity',
      'entity も internal: true もありません',
      '対応する entity_spec があるなら entity を、ドメイン仕様に現れない台帳なら internal: true を書く',
    );
  }
}

/** foreign_keys を読む。 */
function parseForeignKeys(root: YamlReader, reporter: SpecReporter): readonly DataForeignKeyDecl[] {
  const items = root.optionalList(
    'foreign_keys',
    'foreign_keys は "- column / references / on_delete" のリストで書く',
  );
  const keys: DataForeignKeyDecl[] = [];
  eachRecord(items, 'foreign_keys', reporter, 'column / references / on_delete を持つ要素として書く', (reader) => {
    const column = identifierField(reader, reporter, 'column', reader.requiredString('column', 'column にこの表側の列名を書く'));
    const references = qualifiedField(
      reader,
      reporter,
      'references',
      reader.requiredString('references', 'references に参照先テーブルを書く(public 以外は `スキーマ名.表名` の形でスキーマ修飾)'),
    );
    const onDelete = reader.requiredString(
      'on_delete',
      `on_delete を ${ON_DELETE_ACTIONS.join(' / ')} から書く(削除の連鎖は業務上の意味を持つ実装判断)`,
    );
    if (column === null || references === null || onDelete === null) return;
    if (!(ON_DELETE_ACTIONS as readonly string[]).includes(onDelete)) {
      reporter.error(
        reader.pointer('on_delete'),
        `on_delete ${onDelete} は値域(${ON_DELETE_ACTIONS.join(' / ')})にありません`,
        'pg_constraint.confdeltype に対応する 5 語のどれかに直す',
        { on_delete: onDelete },
      );
      return;
    }
    const refuseErased = parseRefuseErased(reader, reporter);
    keys.push({ column, references, onDelete: onDelete as OnDeleteAction, ...(refuseErased === undefined ? {} : { refuseErased }) });
  });
  reporter.settleRows(items.length, keys.length);
  return keys;
}

/** triggers の要素に書けるキー。 */
const TRIGGER_KEYS: readonly string[] = ['name', 'function', 'fires', 'deferred', 'invariant', 'supplies', 'params', 'derives', COPY_ACCEPT_KEY, 'locks', 'copies_from', 'advisory', 'remembers_owner', 'freezes'];

/** triggers を読む。 */
function parseTriggers(root: YamlReader, reporter: SpecReporter): readonly DataTriggerDecl[] {
  const items = root.optionalList('triggers', 'triggers は "- name / function / fires / deferred / supplies / derives / copy_accept" のリストで書く');
  const triggers: DataTriggerDecl[] = [];
  eachRecord(items, 'triggers', reporter, 'name と function を持つ要素として書く', (reader) => {
    const name = identifierField(reader, reporter, 'name', reader.requiredString('name', 'name にトリガの実名を書く'));
    const functionName = identifierField(
      reader,
      reporter,
      'function',
      reader.requiredString('function', 'function に実行する関数名を書く(同じファイルの functions に kind: trigger で載せる)'),
    );
    if (name === null || functionName === null) return;
    const fires = firesField(reader, reporter, 'fires', reader.optionalString('fires', 'fires に発火タイミングを書く(いつ・何で・何ごとに を pg_trigger.tgtype と突き合わせる)'));
    const deferred = reader.optionalBoolean(
      'deferred',
      'コミット時に評価する制約トリガなら deferred: true を書く(deferrable initially deferred。突合される)',
    );
    const invariant = reader.optionalString('invariant', 'invariant に由来する不変条件 ID を書く');
    const derives = parseDerives(reader, reporter);
    const freezes = reader.has('freezes') ? identifierListField(reader, reporter, 'freezes', reader.optionalStringList('freezes', 'freezes に作成の後に変えない列を並べる(fires: after update)')) : null;
    reader.rejectUnknownKeys(TRIGGER_KEYS, 'triggers の要素', `書けるのは ${TRIGGER_KEYS.join(' / ')} だけ。綴り違いなら直す`);
    const accept = parseTriggerCopyAccepts(reader, reporter);
    const locks = parseTriggerLocks(reader, reporter);
    const copiesFrom = parseCopiesFrom(reader, reporter);
    const advisory = parseAdvisory(reader, reporter);
    triggers.push({
      name,
      functionName,
      deferred,
      supplies: identifierListField(
        reader,
        reporter,
        'supplies',
        reader.optionalStringList('supplies', 'supplies にこのトリガが値を供給する列を並べる(entity_spec が supplied_by: db を宣言した欄)'),
      ) ?? [],
      params: reader.optionalStringMap(
        'params',
        'params に "{定数名}: \"{値}\"" のマッピングで書く(値は文字列。仕様に載せるための宣言で突合はしない)',
      ),
      ...(fires === undefined ? {} : { fires }),
      ...(invariant === undefined ? {} : { invariant }),
      ...(derives === undefined ? {} : { derives }),
      ...(freezes === null ? {} : { freezes }),
      ...(accept.length === 0 ? {} : { accept }),
      ...(locks === undefined ? {} : { locks }),
      ...(copiesFrom === undefined ? {} : { copiesFrom }),
      ...(advisory === undefined ? {} : { advisory }),
      ...parseRemembersOwner(reader, reporter),
    });
  });
  reporter.settleRows(items.length, triggers.length);
  return triggers;
}

/** checks を読む。 */
function parseChecks(root: YamlReader, reporter: SpecReporter): readonly DataCheckDecl[] {
  const items = root.optionalList('checks', 'checks は "- name / rule" のリストで書く(entity_spec の導出でないものだけ)');
  const checks: DataCheckDecl[] = [];
  eachRecord(items, 'checks', reporter, 'name を持つ要素として書く', (reader) => {
    const name = identifierField(reader, reporter, 'name', reader.requiredString('name', 'name に CHECK 制約の実名を書く(例: jobs_status_enum)'));
    if (name === null) return;
    const rule = fragmentField(reader, reporter, 'rule', reader.optionalString('rule', 'rule に条件(SQL 断片)を書く(正が invariant_spec にあるものは書かない)'));
    const invariant = reader.optionalString('invariant', 'invariant に由来する不変条件 ID を書く');
    const handwritten = reader.optionalString(
      'handwritten',
      'handwritten に「式を生成せず手書きの migration に残す」理由を書く(空は通らない)',
    );
    checks.push({
      name,
      ...(rule === undefined ? {} : { rule }),
      ...(invariant === undefined ? {} : { invariant }),
      ...(handwritten === undefined ? {} : { handwritten }),
    });
  });
  reporter.settleRows(items.length, checks.length);
  return checks;
}

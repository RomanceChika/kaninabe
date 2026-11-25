/**
 * data_table の `functions`(関数の帰属宣言)のパーサー。
 *
 * 全 data_table の `functions` の和集合が「public スキーマの関数の完全集合」になる(閉世界)。
 * `kind: rpc` は**形**(`shape`)も宣言し、定型 4 形なら本文の期待が生成できる
 * (正: ARCH-SP-BE-0001 §書き込み RPC の形)。
 *
 * **`functions[].handwritten`(本文を生成しないことの、理由つきの宣言)の読み取りも同じ
 * ファイルにある。** 書き方が種別で 2 つに分かれる —— `kind: rpc` は**理由 1 行**、`kind: trigger` は
 * **`{ migration, reason }` のマッピング**である(名指しの誤りを T17 が機械的に捕れるよう、ファイル名を
 * 欄に分けた。束 ㉖ の独立レビュー D1)。ここが見るのは**形**だけで、名指した migration が実在し、
 * その本文に関数名の字面があるかは T17 が見る(パーサーはファイル I/O をしない)。
 *
 * @oversize 超える理由: `functions[]` の 1 要素を読む流れ(種別 → 形 → 手書きの理由)は 1 つの宣言の読み取りで、
 *   手書きの理由の読み取りは `kind` ごとの分岐の中から呼ばれる。宣言 1 つの妥当性を上から下へ追える。
 * @split-review 割る案と結果: 関数の宣言の本体(params / shape / role / actor_field / security)と、手書きの理由の読み取り
 *   (`parseHandwrittenBody` ・`filledReason`。以前の `parse-data-handwritten.ts`)に割る案を検討した。手書きの
 *   理由を読むのは `parseBodyOrigin` だけで、ほかのパーサーは直接読まない。`kind` の分岐(`rpc` は理由 1 行・
 *   `trigger` は migration と理由のマッピング)を `parseBodyOrigin` が持つので、割ると分岐と理由の読み取りを
 *   往復することになる。表の別の欄を読むパーサーは、`parse-data-shape.ts` ほかに既に割ってある。
 */

import { identifierField, typeNameListField } from '../sql-fields.js';
import { asRecord } from '../parse-common.js';
import { optionalMigrationFile } from '../migration-file.js';
import type { SpecReporter } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import { parseEnforces } from './parse-data-enforces.js';
import { parseAlsoWrites } from './parse-also-writes.js';
import { parseEraseVia } from './parse-erasure-accept.js';
import { parseRpcWriteDecls } from './parse-rpc-writes.js';
import { parseSendLimit } from './parse-send-limit.js';
import { DATA_FUNCTION_KINDS, DATA_FUNCTION_RETURNS, DATA_FUNCTION_SECURITY, DATA_FUNCTION_SHAPES } from './types.js';
import type { DataFunctionDecl, DataFunctionReturns, DataFunctionSecurity, DataFunctionShape } from './types.js';

/**
 * `functions[]` の 1 要素に書けるキーの全体(これ以外はエラー)。
 *
 * 綴り違い(`event_write` など)が黙って無視されると、書いたつもりの書き込みの宣言が無いのと同じになり、
 * 操作の属性の導出から危険の表示が落ちる(entity_spec の SPEC_KEYS と同じ理由で allowlist にする)。
 */
const FUNCTION_KEYS: readonly string[] = [
  'name',
  'args',
  'params',
  'kind',
  'shape',
  'returns',
  'migration',
  'handwritten',
  'role',
  'actor_field',
  'security',
  'enforces',
  'lookup',
  'also_writes',
  'scrub_via',
  'self_writes',
  'event_writes',
  'calls',
  'dynamic_sql',
  'send_limit',
];

/** functions を読む。閉世界の割り当てなので、1 ファイル内の重複はここで落とす。 */
export function parseFunctions(root: YamlReader, reporter: SpecReporter): readonly DataFunctionDecl[] {
  const items = root.optionalList('functions', 'functions は "- name / args / kind" のリストで書く');
  const functions: DataFunctionDecl[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  eachRecord(items, 'functions', reporter, 'name / args / kind を持つ要素として書く', (reader, index) => {
    reader.rejectUnknownKeys(FUNCTION_KEYS, 'functions の要素', `書けるのは ${FUNCTION_KEYS.join(' / ')} だけ。綴り違いなら直す`);
    const name = identifierField(reader, reporter, 'name', reader.requiredString('name', 'name に関数名を書く(例: apply_entry_transition)'));
    const args = typeNameListField(
      reader,
      reporter,
      'args',
      reader.requiredStringList('args', 'args に引数型を並べる(pg_catalog の型名。引数なしは [])'),
    );
    const kind = reader.requiredString('kind', `kind を ${DATA_FUNCTION_KINDS.join(' / ')} から書く`);
    if (name === null || args === null || kind === null) return;
    if (!(DATA_FUNCTION_KINDS as readonly string[]).includes(kind)) {
      reporter.error(
        reader.pointer('kind'),
        `kind ${kind} は値域(${DATA_FUNCTION_KINDS.join(' / ')})にありません`,
        'rpc(書き込み RPC)/ trigger(トリガ関数)/ helper(RLS 補助)/ send_limit(送信の上限)のどれかに直す',
        { kind },
      );
      return;
    }
    if (seen.has(name)) {
      reporter.error(`functions[${index}].name`, `関数名 ${name} が重複しています`, '重複した要素を削除する', { name });
      duplicates += 1;
      return;
    }
    seen.add(name);
    const shape = parseShape(reader, kind as DataFunctionDecl['kind'], name, reporter);
    const returns = parseReturns(reader, kind as DataFunctionDecl['kind'], shape, name, reporter);
    const params = parseParams(reader, kind as DataFunctionDecl['kind'], name, reporter);
    const body = parseBodyOrigin(reader, kind as DataFunctionDecl['kind'], name, reporter);
    const role = parseRole(reader, kind as DataFunctionDecl['kind'], name, reporter);
    const actorField = parseActorField(reader, kind as DataFunctionDecl['kind'], { name, role }, reporter);
    const security = parseSecurity(reader, kind as DataFunctionDecl['kind'], name, reporter);
    const enforces = parseEnforces(reader, name, reporter);
    const lookup = parseLookup(reader, name, reporter);
    const composite = kind === 'rpc' && shape === 'composite';
    const alsoWrites = parseAlsoWrites(reader, name, reporter, composite);
    const scrubVia = parseEraseVia(reader, name, reporter);
    const sendLimit = parseSendLimit(reader, kind, name, reporter);
    const writeDecls = parseRpcWriteDecls(
      reader,
      name,
      { kind: kind as DataFunctionDecl['kind'], shape, handwritten: body.handwritten !== undefined },
      reporter,
    );
    functions.push({
      name,
      args,
      params,
      kind: kind as DataFunctionDecl['kind'],
      ...(shape === undefined ? {} : { shape }),
      ...(returns === undefined ? {} : { returns }),
      ...body,
      ...(role === undefined ? {} : { role }),
      ...(actorField === undefined ? {} : { actorField }),
      ...(security === undefined ? {} : { security }),
      ...(enforces === undefined ? {} : { enforces }),
      ...(lookup === undefined ? {} : { lookup }),
      alsoWrites: alsoWrites.tables,
      ...(alsoWrites.tables.length === 0 ? {} : { alsoWriteKinds: alsoWrites.kinds }),
      ...(scrubVia === undefined ? {} : { scrubVia }),
      ...(sendLimit === undefined ? {} : { sendLimit }),
      ...writeDecls,
    });
  });
  reporter.settleRows(items.length, functions.length, duplicates);
  return functions;
}

/** 列名(スネークケース)。 */
const COLUMN_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * 関数 1 本の `lookup`(本文が自表の絞り込み・並びに使う列の並び)を読む。
 *
 * どの種別の関数にも書ける(本文が自表を引くのは種別に依らない)。ここが見るのは**形**だけである —— 空でない・
 * 列名の形・重複なし。索引が宣言されていること(T2)と、実 DB の本文にその列が現れること(data-table-parity)は
 * 別の検査が見る(パーサーはファイル I/O も DB への問い合わせもしない)。
 *
 * @param reader その関数の要素
 * @param name 関数名(反例用)
 * @param reporter 違反の記録先
 * @returns 宣言された列の並び(無ければ undefined。書いたのに読めなければ記録して undefined)
 */
function parseLookup(reader: YamlReader, name: string, reporter: SpecReporter): readonly string[] | undefined {
  if (!reader.has('lookup')) return undefined;
  const columns = reader.optionalStringList('lookup', 'lookup に本文が絞り込み・並べに使う自表の列を並べる(例: [sender_email, created_at])');
  const suggestion = 'lookup は「等値で絞る列 → 範囲・並びの列」の順に、重複なく 1 本以上の列を並べる(例: [sender_email, created_at])';
  if (columns.length === 0) {
    // リストでない値は optionalList が既に報告している(二重に言わない)。
    if (Array.isArray(reader.raw('lookup'))) {
      reporter.error(reader.pointer('lookup'), `${name} の lookup が空です`, suggestion, { function: name });
      reporter.dropRows();
    }
    return undefined;
  }
  const bad = columns.find((column) => !COLUMN_NAME.test(column));
  if (bad !== undefined) {
    reporter.error(reader.pointer('lookup'), `${name} の lookup の列名 ${bad} がスネークケースではありません`, suggestion, {
      function: name,
      column: bad,
    });
    reporter.dropRows();
    return undefined;
  }
  const duplicated = columns.find((column, index) => columns.indexOf(column) !== index);
  if (duplicated !== undefined) {
    reporter.error(reader.pointer('lookup'), `${name} の lookup に列 ${duplicated} が重複しています`, suggestion, {
      function: name,
      column: duplicated,
    });
    reporter.dropRows();
    return undefined;
  }
  return columns;
}

/**
 * 関数 1 本の `params`(引数名の並び)を読む。
 *
 * `kind: rpc` と `kind: send_limit` でだけ宣言できる(トリガ関数・RLS 補助の引数名は呼び出し側から見えないため、
 * 名前に意味が無い。送信の上限は手書きの本文が名前つきで呼ぶので、名前を宣言と突き合わせる = T26)。宣言された名前の**長さ・形式・重複**は T1 が見る —— ここは
 * 「書ける場所かどうか」だけを判定し、値の意味は検証器へ渡す(パーサーの責務の線引き)。
 */
function parseParams(
  reader: YamlReader,
  kind: DataFunctionDecl['kind'],
  name: string,
  reporter: SpecReporter,
): readonly string[] {
  const declared = reader.has('params');
  if (kind !== 'rpc' && kind !== 'send_limit') {
    if (declared) {
      reporter.error(
        reader.pointer('params'),
        `${name} は kind: ${kind} なので params を宣言できません`,
        'params は呼び出し側が名前付きで渡す引数の宣言である(トリガ関数・RLS 補助には呼び出し側が無い)。行を削除する',
        { function: name, kind },
      );
    }
    return [];
  }
  return reader.optionalStringList('params', 'params に引数名を args と同じ順で並べる(例: [p_id, p_actor_id])');
}

/**
 * 関数 1 本の `shape` を読む。
 *
 * `kind: rpc` では必須(定型に乗らないものは `composite` と宣言する)、それ以外では書けない。
 * 「印を付けない」という選択肢を残さないのは、印の無い RPC が突合の母集合から静かに
 * 抜け落ちるのを防ぐためである(免除は宣言としてだけ存在してよい)。
 */
function parseShape(
  reader: YamlReader,
  kind: DataFunctionDecl['kind'],
  name: string,
  reporter: SpecReporter,
): DataFunctionShape | undefined {
  const shape = reader.optionalString('shape', `shape を ${DATA_FUNCTION_SHAPES.join(' / ')} から書く`);
  if (shape !== undefined && !(DATA_FUNCTION_SHAPES as readonly string[]).includes(shape)) {
    reporter.error(
      reader.pointer('shape'),
      `shape ${shape} は値域(${DATA_FUNCTION_SHAPES.join(' / ')})にありません`,
      '定型 4 形のどれかか、定型に乗らないなら composite に直す',
      { shape, function: name },
    );
    reporter.dropRows();
    return undefined;
  }
  if (kind !== 'rpc') {
    if (shape !== undefined) {
      reporter.error(
        reader.pointer('shape'),
        `${name} は kind: ${kind} なので shape を宣言できません`,
        'shape は書き込み RPC の形の宣言である(トリガ関数・RLS 補助には形が無い)。行を削除する',
        { function: name, kind },
      );
    }
    return undefined;
  }
  if (shape === undefined) {
    reporter.error(
      reader.pointer('shape'),
      `${name} は kind: rpc ですが shape の宣言がありません`,
      `shape を ${DATA_FUNCTION_SHAPES.join(' / ')} から書く(定型なら本文が仕様から決まるので統合テストが突き合わせ、定型に乗らないなら composite と宣言する)`,
      { function: name },
    );
    return undefined;
  }
  return shape as DataFunctionShape;
}

/**
 * 関数 1 本の `returns`(書き込み RPC の戻り値の形)を読む。
 *
 * `kind: rpc` かつ `shape: composite` では**必須**(省略を行の列とみなして署名の表に黙って書かない)、
 * 定型 4 形とそれ以外の種別では書けない(定型は常に行の列を返す)。値の意味は実 DB の戻り値の型との
 * 突合が見る —— ここは**書ける場所か・値域か・書き忘れていないか**だけを見る。
 *
 * @param reader その関数の要素
 * @param kind 関数の種別
 * @param shape 読み終えた形(rpc 以外・読めなかったときは undefined)
 * @param name 関数名(反例用)
 * @param reporter 違反の記録先
 * @returns 宣言された戻り値の形(無ければ undefined)
 */
function parseReturns(
  reader: YamlReader,
  kind: DataFunctionDecl['kind'],
  shape: DataFunctionShape | undefined,
  name: string,
  reporter: SpecReporter,
): DataFunctionReturns | undefined {
  const returns = reader.optionalString('returns', `returns を ${DATA_FUNCTION_RETURNS.join(' / ')} から書く`);
  const composite = kind === 'rpc' && shape === 'composite';
  if (returns === undefined) {
    if (composite) {
      reporter.error(
        reader.pointer('returns'),
        `${name} は定型に乗らない書き込み RPC(composite)ですが returns の宣言がありません`,
        `returns を ${DATA_FUNCTION_RETURNS.join(' / ')} から書く(行の列を返すなら rows、消した件数のような単一の値なら scalar)。省略を rows とみなさない`,
        { function: name },
      );
      reporter.dropRows();
    }
    return undefined;
  }
  if (!composite) {
    reporter.error(
      reader.pointer('returns'),
      `${name} は ${kind === 'rpc' ? `定型の形(${shape ?? ''})の書き込み RPC` : `kind: ${kind}`} なので returns を宣言できません`,
      'returns は定型に乗らない書き込み RPC(composite)だけが書く(定型 4 形は常に行の列を返す)。行を削除する',
      { function: name, kind },
    );
    reporter.dropRows();
    return undefined;
  }
  if (!(DATA_FUNCTION_RETURNS as readonly string[]).includes(returns)) {
    reporter.error(
      reader.pointer('returns'),
      `returns ${returns} は値域(${DATA_FUNCTION_RETURNS.join(' / ')})にありません`,
      '行の列を返すなら rows、行でも文書でもない単一の値なら scalar に直す',
      { returns, function: name },
    );
    reporter.dropRows();
    return undefined;
  }
  return returns as DataFunctionReturns;
}

/**
 * 関数 1 本の `role`(その補助関数が判定するロール)を読む。
 *
 * `kind: helper` でだけ宣言できる。宣言されていれば「本文は生成物」という意味になり、
 * ロールの実在・関数名との一致・`migration` と対であることは T7 が見る ——
 * ここは**書ける場所かどうか**だけを判定する(shape / params と同じ線引き)。
 *
 * @param reader その関数の要素
 * @param kind 関数の種別
 * @param name 関数名(反例用)
 * @param reporter 違反の記録先
 * @returns 宣言されたロール ID(無ければ undefined)
 */
function parseRole(
  reader: YamlReader,
  kind: DataFunctionDecl['kind'],
  name: string,
  reporter: SpecReporter,
): string | undefined {
  const role = reader.optionalString('role', 'role にその補助関数が判定するロール ID を書く(例: role: member)');
  if (kind === 'helper') return role;
  if (role !== undefined) {
    reporter.error(
      reader.pointer('role'),
      `${name} は kind: ${kind} なので role を宣言できません`,
      'role は RLS 補助関数がどのロールを判定するかの宣言である(書き込み RPC・トリガ関数には無い)。行を削除する',
      { function: name, kind },
    );
  }
  return undefined;
}

/**
 * 関数 1 本の `actor_field`(その補助関数が返す実行者の欄。テナント境界の右辺)を読む。
 *
 * `kind: helper` でだけ宣言でき、`role` とは同時に書けない —— 1 本の補助関数が「役が立つか」と
 * 「実行者の欄の値」の両方を答えると、本文の正が 2 つになる。欄の実在・関数名との一致・`migration` と
 * 対であることは T7 が見る(`parseRole` と同じ線引き)。
 *
 * @param reader その関数の要素
 * @param kind 関数の種別
 * @param fn 関数名と、同じ要素に書かれた role(反例と排他の判定に使う)
 * @param reporter 違反の記録先
 * @returns 宣言された欄(無ければ undefined)
 */
function parseActorField(
  reader: YamlReader,
  kind: DataFunctionDecl['kind'],
  fn: { readonly name: string; readonly role: string | undefined },
  reporter: SpecReporter,
): string | undefined {
  const field = reader.optionalString(
    'actor_field',
    'actor_field にその補助関数が返す実行者の欄を書く(例: actor_field: company_id)',
  );
  if (field === undefined) return undefined;
  if (kind !== 'helper') {
    reporter.error(
      reader.pointer('actor_field'),
      `${fn.name} は kind: ${kind} なので actor_field を宣言できません`,
      'actor_field はテナント境界の補助関数がどの実行者の欄を返すかの宣言である(書き込み RPC・トリガ関数には無い)。行を削除する',
      { function: fn.name, kind },
    );
    return undefined;
  }
  if (fn.role !== undefined) {
    reporter.error(
      reader.pointer('actor_field'),
      `${fn.name} は role と actor_field を両方宣言しています`,
      '補助関数 1 本が答えるのは「役が立つか」(role)か「実行者の欄の値」(actor_field)のどちらか一方である。関数を分ける',
      { function: fn.name, role: fn.role, actor_field: field },
    );
    return undefined;
  }
  return field;
}

/**
 * 関数 1 本の `security`(誰の権限で実行するか)を読む。
 *
 * `kind: trigger` でだけ宣言できる —— `rpc` / `helper` は必ず `definer` であり(それが種別の
 * 意味そのもので、`data-table-parity` が無条件に要求する)、宣言できる余地が無い。
 * 「本文が生成物のトリガ関数には書けない」(正が 2 つになる)は T17 が見る ——
 * ここは shape / params / role と同じく**書ける場所かどうか**だけを判定する。
 *
 * @param reader その関数の要素
 * @param kind 関数の種別
 * @param name 関数名(反例用)
 * @param reporter 違反の記録先
 * @returns 宣言された権限(無ければ undefined = 既定の invoker)
 */
function parseSecurity(
  reader: YamlReader,
  kind: DataFunctionDecl['kind'],
  name: string,
  reporter: SpecReporter,
): DataFunctionSecurity | undefined {
  const security = reader.optionalString(
    'security',
    `security を ${DATA_FUNCTION_SECURITY.join(' / ')} から書く(省略は invoker)`,
  );
  if (security === undefined) return undefined;
  if (kind !== 'trigger') {
    reporter.error(
      reader.pointer('security'),
      `${name} は kind: ${kind} なので security を宣言できません`,
      'rpc / helper は必ず security definer である(種別の意味そのもので、突合が無条件に要求する)。行を削除する',
      { function: name, kind },
    );
    return undefined;
  }
  if (!(DATA_FUNCTION_SECURITY as readonly string[]).includes(security)) {
    reporter.error(
      reader.pointer('security'),
      `security ${security} は値域(${DATA_FUNCTION_SECURITY.join(' / ')})にありません`,
      'definer(定義者の権限)か invoker(呼び出し主体の権限)に直す',
      { security, function: name },
    );
    reporter.dropRows();
    return undefined;
  }
  return security as DataFunctionSecurity;
}

/**
 * 関数 1 本の**本文の出どころ**(`migration` = 生成物 / `handwritten` = 理由つきの手書き)を読む。
 *
 * `kind: rpc`(定型 5 形の本文)と `kind: helper`(RLS 補助関数の本文)が宣言できる。
 * 「どちらか一方が必ず要る」「名前の形式と一意性」「生成の対象と一致すること」は T6 が見る ——
 * ここは**書ける場所かどうか**と**書いたのに空でないか**だけを判定する
 * (パーサーの責務の線引きは shape / params と同じ)。
 */
function parseBodyOrigin(
  reader: YamlReader,
  kind: DataFunctionDecl['kind'],
  name: string,
  reporter: SpecReporter,
): {
  readonly migration?: string;
  readonly handwritten?: string;
  readonly handwrittenMigration?: string;
} {
  const migration = optionalMigrationFile(reader, reporter, 'migration', 'migration に生成先の migration ファイル名を書く');
  if (kind === 'rpc') {
    const handwritten = reader.optionalString('handwritten', HANDWRITTEN_SUGGESTION);
    return {
      ...(migration === undefined ? {} : { migration }),
      ...(handwritten === undefined || !filledReason(reader, handwritten, name, reporter) ? {} : { handwritten }),
    };
  }
  // RLS 補助関数の本文も宣言(`role`)から決まるので生成する(束 ⑳-4a)。理由つきの手書き
  // (`handwritten`)は持たない —— 生成できない補助関数は `role` を宣言しなければよい。
  if (kind === 'helper') {
    if (reader.has('handwritten')) {
      reporter.error(
        reader.pointer('handwritten'),
        `${name} は kind: helper なので handwritten を宣言できません`,
        'handwritten は定型 RPC の免除の宣言である。生成しない補助関数は role を書かなければよい(migration も要らない)',
        { function: name, kind },
      );
    }
    return { ...(migration === undefined ? {} : { migration }) };
  }
  // 送信の上限の本文も宣言(`send_limit`)から決まるので生成する。手書きの理由は持たない(書き出し先の名指しが要ることは T26 が見る)。
  if (kind === 'send_limit') {
    if (reader.has('handwritten')) {
      reporter.error(
        reader.pointer('handwritten'),
        `${name} は kind: send_limit なので handwritten を宣言できません`,
        '送信の上限の本文は宣言から生成する(数え・掴む順・拒否の語を手で書くと、宣言と本文の正が 2 つになる)。行を削除する',
        { function: name, kind },
      );
    }
    return { ...(migration === undefined ? {} : { migration }) };
  }
  // トリガ関数の本文も宣言から決まるものは生成する(束 ㉖。祖先の列の写し / 条件を課すもの)。
  // 書き出し先は**その表の `ddl_migration`** なので `migration` は宣言できない —— 宣言できるのは
  // 「本文は手書きの migration にある」という宣言(`handwritten`)だけで、**こちらはマッピング**
  // である(名指しの誤りを機械が見られるように、ファイル名を欄に分けてある。T17)。
  if (kind === 'trigger') {
    if (reader.has('migration')) {
      reporter.error(
        reader.pointer('migration'),
        `${name} は kind: trigger なので migration を宣言できません`,
        'トリガ関数の本文の書き出し先はその表の ddl_migration である(関数ごとのファイルは持たない)。' +
          '本文が手書きの migration にあるなら handwritten の migration にそのファイル名を書く',
        { function: name, kind },
      );
    }
    return parseHandwrittenBody(reader, name, reporter);
  }
  // 種別が増えた日の受け皿(いまの値域 rpc / helper / trigger はすべて上で答えている)。
  for (const key of ['migration', 'handwritten'] as const) {
    if (!reader.has(key)) continue;
    reporter.error(
      reader.pointer(key),
      `${name} は kind: ${kind} なので ${key} を宣言できません`,
      `${key} は本文の出どころの宣言である。行を削除する`,
      { function: name, kind },
    );
  }
  return {};
}

/** `kind: rpc` の `handwritten` の書き方(欄の存在意義が理由そのものなので、空は通さない)。 */
const HANDWRITTEN_SUGGESTION =
  'handwritten に本文を手で書く理由を書く(「定型の形だが、仕様から導けない手順が本文にある」ことの説明。' +
  '理由の無い免除は、理由文つきの免除リストへの退化そのものである)';

/**
 * 手書きの理由が**実際に書かれている**ことを見る(空文字・空白だけは「宣言あり」にしない)。
 *
 * `optionalLabel`(yaml-reader)と同じ規則である —— 書いたのに中身が無い宣言はモデルに
 * 載せず、キーごと書かなかった場合と同じ扱いに倒す。ここを通すと `handwritten: ""` が
 * T6 の「どちらか一方」を満たしてしまい、**理由の無い免除**が黙って成立する。
 *
 * @param reader その関数の要素
 * @param reason 読んだ値
 * @param name 関数名(反例用)
 * @param reporter 違反の記録先
 * @returns 理由として通るなら true
 */
function filledReason(reader: YamlReader, reason: string, name: string, reporter: SpecReporter): boolean {
  if (reason.trim() !== '') return true;
  reporter.error(reader.pointer('handwritten'), 'handwritten が空です', HANDWRITTEN_SUGGESTION, { function: name });
  reporter.dropRows();
  return false;
}

/** `kind: trigger` の `handwritten` の書き方(名指しを機械が見られるようにマッピングで書く)。 */
const TRIGGER_HANDWRITTEN_SUGGESTION =
  'handwritten に "migration: {その本文を作っている migration のファイル名}" と ' +
  '"reason: {生成しない理由}" を書く(kind: trigger だけマッピングである。' +
  'ファイル名を欄に分けてあるのは、名指しの誤りを T17 が機械的に捕るためである)';

/**
 * `kind: trigger` の `handwritten`(マッピング)を読む。
 *
 * ここが見るのは**形**だけである —— 名指した migration が実在し、その本文に関数名の字面が
 * あるかは T17 が見る(パーサーはファイル I/O をしない)。
 *
 * @param reader その関数の要素
 * @param name 関数名(反例用)
 * @param reporter 違反の記録先
 * @returns 読めた宣言(読めなければ空)
 */
function parseHandwrittenBody(
  reader: YamlReader,
  name: string,
  reporter: SpecReporter,
): { readonly handwritten?: string; readonly handwrittenMigration?: string } {
  if (!reader.has('handwritten')) return {};
  const record = asRecord(reader.raw('handwritten'));
  if (record === null) {
    reporter.error(
      reader.pointer('handwritten'),
      `${name} の handwritten はマッピングで書きます`,
      TRIGGER_HANDWRITTEN_SUGGESTION,
      { function: name },
    );
    reporter.dropRows();
    return {};
  }
  const inner = new YamlReader(record, reader.pointer('handwritten'), reporter);
  const migration = inner.requiredString('migration', TRIGGER_HANDWRITTEN_SUGGESTION);
  const reason = inner.requiredString('reason', TRIGGER_HANDWRITTEN_SUGGESTION);
  if (migration === null || reason === null) {
    reporter.dropRows();
    return {};
  }
  if (reason.trim() === '' || migration.trim() === '') {
    reporter.error(
      reader.pointer('handwritten'),
      `${name} の handwritten の migration / reason が空です`,
      TRIGGER_HANDWRITTEN_SUGGESTION,
      { function: name },
    );
    reporter.dropRows();
    return {};
  }
  return { handwritten: reason, handwrittenMigration: migration };
}

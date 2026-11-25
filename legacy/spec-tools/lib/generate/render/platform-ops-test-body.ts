/**
 * 認証基盤の操作(`platform_ops`)の生成テストの**静的な本体**(場面の試験の道具と、権限表・現在の端末・偽造 ID・接続・結果の写し・多要素認証・入力・入口の試験)。
 *
 * 宣言から導く表(各操作の場面の関数・許す実行者・変種・入口のファイル)は `code-platform-ops-tests.ts` が書き、ここは**表を回す側**の字面である。
 * 表を回す側に業務の判断は無い —— 期待はすべて表(宣言の写し)から来る。アプリの語彙は 1 語も持たない(W1)。
 */

/** 道具の定義(型・配線先の記録・対象の選び方)。 */
export function toolLines(options: { readonly leakKeys: readonly string[] }): readonly string[] {
  const leak = ['unexpectedExtra', ...options.leakKeys].map((key) => `${JSON.stringify(key)}: LEAK_MARKER`).join(', ');
  return [
    '/** 場面の試験の対象の選び方(own = 実行者自身の持ち物・foreign = 別のメンバーの持ち物・unlisted = 一覧に無い ID・malformed = 形の壊れた ID)。 */',
    "type Mode = 'own' | 'foreign' | 'unlisted' | 'malformed';",
    '',
    'interface ProbeOptions {',
    '  readonly mode?: Mode;',
    '  /** 型つきの入力の値(省略は宣言の既定)。 */',
    '  readonly variant?: Readonly<Record<string, unknown>>;',
    '  /** 配線先の応答に余分な欄を足す(宣言より多くを返した場面)。 */',
    '  readonly leak?: boolean;',
    '  /** セッションが多要素認証を済ませているか(省略は済ませている)。要求する製品でだけ意味がある。 */',
    '  readonly mfa?: boolean;',
    '}',
    '',
    'interface Call {',
    '  readonly method: string;',
    '  readonly args: readonly unknown[];',
    '}',
    '',
    'interface Probe {',
    '  /** 結果。呼び出しが例外で終わった場面は null(壊れた ID の直呼びでだけ許される)。 */',
    '  readonly result: PlatformOpResult<unknown> | null;',
    '  readonly world: PlatformScenarioWorld<unknown>;',
    '  /** 配線先が受けた呼び出し。 */',
    '  readonly calls: readonly Call[];',
    '  /** 宣言した対応表から導いた、配線先が受けるはずの呼び出し。 */',
    '  readonly expected: readonly Call[];',
    '}',
    '',
    'interface OpCase {',
    '  readonly id: PlatformOpId;',
    "  readonly kind: 'read' | 'do';",
    '  /** 実行できる実行者。 */',
    '  readonly allowed: readonly ActorName[];',
    '  readonly needsCurrentSession: boolean;',
    '  /** 行から受ける引数の出どころが、本人の読みか(偽造 ID の試験の対象)。 */',
    '  readonly selfRows: boolean;',
    '  /** 権限表の試験が選ぶ対象(ロールの操作の対象は別のメンバーの持ち物)。 */',
    '  readonly defaultMode: Mode;',
    '  readonly variants: readonly Readonly<Record<string, unknown>>[];',
    '  readonly probe: (spec: PlatformScenarioSpec, options?: ProbeOptions) => Promise<Probe>;',
    '}',
    '',
    '/** 配線先が結果に載せてはいけない余分な欄(秘密の語を含む名前)。画面の値に残らないことを確かめる。 */',
    `const LEAK: Readonly<Record<string, string>> = { ${leak} };`,
    '',
    '/** 配線先を包み、呼び出しを記録する。`leak` なら、行の配列の結果の各行に余分な欄を足して返す。 */',
    'function record<P extends object>(port: P, leak: boolean, union: { readonly ok: string; readonly value: string }): { readonly port: P; readonly calls: Call[] } {',
    '  const calls: Call[] = [];',
    '  const wrapped = new Proxy(port, {',
    '    get(target, key, receiver) {',
    '      const value: unknown = Reflect.get(target, key, receiver);',
    "      if (typeof value !== 'function') return value;",
    '      return async (...args: unknown[]) => {',
    '        calls.push({ method: String(key), args });',
    '        const out: unknown = await (value as (...rest: unknown[]) => unknown).apply(target, args);',
    '        return leak ? withLeak(out, union) : out;',
    '      };',
    '    },',
    '  });',
    '  return { port: wrapped, calls };',
    '}',
    '',
    'function withLeak(out: unknown, union: { readonly ok: string; readonly value: string }): unknown {',
    "  if (typeof out !== 'object' || out === null) return out;",
    '  const result = out as Readonly<Record<string, unknown>>;',
    '  const rows = result[union.value];',
    '  if (result[union.ok] !== true || !Array.isArray(rows)) return out;',
    '  return { ...result, [union.value]: rows.map((row: unknown) => ({ ...(row as object), ...LEAK })) };',
    '}',
    '',
    '/** 試験の対象の ID を選ぶ(場面の中の出どころ `of` の持ち物から。無ければ一覧に無い ID)。 */',
    'function targetOf(world: PlatformScenarioWorld<unknown>, of: string, mode: Mode): string {',
    "  if (mode === 'malformed') return 'not an id';",
    '  const targets = world.targets[of];',
    "  const picked = mode === 'own' ? targets?.own[0] : mode === 'foreign' ? targets?.foreign[0] : undefined;",
    '  return picked ?? UNLISTED_ID;',
    '}',
    '',
    '/** 場面の持ち物が全部手つかずか(拒否された呼び出し・偽造した ID の呼び出しの後に確かめる)。 */',
    'function everythingIntact(world: PlatformScenarioWorld<unknown>): boolean {',
    '  return Object.values(world.targets).every((targets) => [...targets.own, ...targets.foreign].every((id) => targets.intact(id)));',
    '}',
    '',
    '/** 結果が、その操作の宣言した理由の拒否か。 */',
    'function refusedWith(result: PlatformOpResult<unknown> | null, op: PlatformOpId): boolean {',
    "  return result !== null && !result.ok && result.refusal.kind === 'refused' && Object.keys(platformOpRefusals[op]).includes(result.refusal.reason);",
    '}',
    '',
    '/** 例外で終わる呼び出しを null の結果にする(壊れた ID の直呼びの試験)。 */',
    'async function settle(run: () => Promise<PlatformOpResult<unknown>>): Promise<PlatformOpResult<unknown> | null> {',
    '  try {',
    '    return await run();',
    '  } catch {',
    '    return null;',
    '  }',
    '}',
  ];
}

/** 生成テストの試験の題(`it` の第 1 引数。仕様の `test_cases` の `implementation` が `::` の後ろでこの題を指す)。 */
export const PLATFORM_TEST_TITLES = {
  matrix: '認証基盤の操作: 権限表のとおり、許す実行者だけが実行でき、ほかは宣言した理由で拒まれて何も変わらない',
  currentSession: '認証基盤の操作: 現在の端末が不明なら、自分を締め出さずに拒み、本人の持ち物は何も変わらない',
  forged: '認証基盤の操作: 偽造した別のメンバーの ID・一覧に無い ID・形の壊れた ID の直呼びは、誰の持ち物も変えない',
  connection: '認証基盤の操作: 配線先を宣言した対応表どおりに呼ぶ(引数の名前・値・型つきの入力の渡し値)',
  projection: '認証基盤の操作: 読みの結果は宣言した欄だけを対応表どおりに写し、配線先の余分な欄は画面の値に残らない',
  mfa: '認証基盤の操作: 多要素認証を済ませていないセッションは、配線先を呼ぶ前に拒まれる',
  schema: '認証基盤の操作: 入力のスキーマは宣言した引数だけを受け、余剰の鍵と壊れた識別子を弾く',
  gates: '認証基盤の操作: 入口と組み立ての根は、生成の関門を決まった順序で持ち、パースした値だけを渡す',
} as const;

/** 試験の題の鍵。 */
export type PlatformTestKey = keyof typeof PLATFORM_TEST_TITLES;

/** `it` 1 つの先頭(注釈の行 + `it(題, 本体)`)。注釈は仕様の `test_cases` が題を指しているときだけ付く。 */
function itLines(key: PlatformTestKey, tag: (key: PlatformTestKey) => string | null, body: readonly string[]): readonly string[] {
  const annotation = tag(key);
  return [
    ...(annotation === null ? [] : [`  // ${annotation}`]),
    `  it(${JSON.stringify(PLATFORM_TEST_TITLES[key])}, ${body.some((line) => /(^|[\s(])await /u.test(line.replace(/'[^']*'|`[^`]*`/gu, ''))) ? 'async ' : ''}() => {`,
    ...body.map((line) => (line === '' ? '' : `    ${line}`)),
    '  });',
    '',
  ];
}

/**
 * 試験の本体(表を回す側)。
 *
 * @param options 多要素認証を要求する製品か・題 → 注釈(`@spec … @tc …`。仕様が題を指しているときだけ)
 * @returns ソースの行
 */
export function testLines(options: {
  readonly mfa: boolean;
  /** 現在の端末を要る操作・本人の読みの行から受ける識別子を持つ操作・読みの操作があるか(無ければ、その試験は書かない —— 母集合が空の試験は黙って緑になる)。 */
  readonly has: { readonly currentSession: boolean; readonly selfRows: boolean; readonly reads: boolean };
  readonly tag: (key: PlatformTestKey) => string | null;
}): readonly string[] {
  const { tag, has } = options;
  return [
    "describe('認証基盤の操作(platform_ops。配線先の本物の組み立てに偽の部品を渡した場面)', () => {",
    ...itLines('matrix', tag, [
      'expect(CASES).not.toHaveLength(0);',
      'for (const op of CASES) {',
      '  for (const actor of ACTOR_NAMES) {',
      '    const allowed = op.allowed.includes(actor);',
      '    const probe = await op.probe({ actor: ACTORS[actor] }, { mode: op.defaultMode, variant: op.variants[0] ?? {} });',
      '    const label = `${op.id} / ${actor}`;',
      '',
      '    expect(probe.result, label).not.toBeNull();',
      '    if (allowed) {',
      '      expect(probe.result?.ok, label).toBe(true);',
      '    } else {',
      '      expect(refusedWith(probe.result, op.id), label).toBe(true);',
      '      expect(everythingIntact(probe.world), label).toBe(true);',
      '    }',
      '  }',
      '}',
    ]),
    ...(!has.currentSession
      ? []
      : itLines('currentSession', tag, [
      'const cases = CASES.filter((candidate) => candidate.needsCurrentSession);',
      'expect(cases).not.toHaveLength(0);',
      'for (const op of cases) {',
      "  const probe = await op.probe({ actor: ACTORS.signed_in, currentSession: 'unknown' }, { variant: op.variants[0] ?? {} });",
      '',
      '  expect(refusedWith(probe.result, op.id), op.id).toBe(true);',
      '  expect(everythingIntact(probe.world), op.id).toBe(true);',
      '}',
    ])),
    ...(!has.selfRows
      ? []
      : itLines('forged', tag, [
      'const cases = CASES.filter((candidate) => candidate.selfRows);',
      'expect(cases).not.toHaveLength(0);',
      'for (const op of cases) {',
      "  for (const mode of ['foreign', 'unlisted', 'malformed'] as const) {",
      '    const probe = await op.probe({ actor: ACTORS.signed_in }, { mode, variant: op.variants[0] ?? {} });',
      '',
      '    expect(everythingIntact(probe.world), `${op.id} / ${mode}`).toBe(true);',
      '  }',
      '}',
    ])),
    ...itLines('connection', tag, [
      'expect(CASES).not.toHaveLength(0);',
      'for (const op of CASES) {',
      '  for (const variant of op.variants) {',
      '    const actor = ACTOR_NAMES.find((name) => op.allowed.includes(name)) ?? ACTOR_NAMES[0] ?? "logged_out";',
      '    const probe = await op.probe({ actor: ACTORS[actor] }, { mode: op.defaultMode, variant });',
      '',
      '    expect(probe.calls, `${op.id} ${JSON.stringify(variant)}`).toEqual(probe.expected);',
      '  }',
      '}',
    ]),
    ...(!has.reads
      ? []
      : itLines('projection', tag, [
      "const cases = CASES.filter((candidate) => candidate.kind === 'read');",
      'expect(cases).not.toHaveLength(0);',
      'for (const op of cases) {',
      '  const plain = await op.probe({ actor: ACTORS.signed_in });',
      '  const leaky = await op.probe({ actor: ACTORS.signed_in }, { leak: true });',
      '',
      '  if (plain.result === null || !plain.result.ok || leaky.result === null || !leaky.result.ok) throw new Error(`${op.id} が成功しませんでした`);',
      '  expect(leaky.result.value, op.id).toEqual(plain.result.value);',
      '  expect(JSON.stringify(leaky.result), op.id).not.toContain(LEAK_MARKER);',
      '  const rows = plain.result.value as readonly Readonly<Record<string, unknown>>[];',
      '  const fields = SHAPE_FIELDS[op.id] ?? [];',
      '  const raw = plain.world.rows[op.id] ?? [];',
      '  expect(rows.length, op.id).toBe(raw.length);',
      '  rows.forEach((row, index) => {',
      '    expect(Object.keys(row).sort(), op.id).toEqual(fields.map((field) => field.prop).sort());',
      '    for (const field of fields) expect(row[field.prop], `${op.id} ${field.field} ← ${field.from}`).toEqual(raw[index]?.[field.from]);',
      '  });',
      '}',
    ])),
    ...(options.mfa
      ? itLines('mfa', tag, [
          'expect(CASES).not.toHaveLength(0);',
          'for (const op of CASES) {',
          '  const actor = ACTOR_NAMES.find((name) => op.allowed.includes(name)) ?? ACTOR_NAMES[0] ?? "logged_out";',
          '  const probe = await op.probe({ actor: ACTORS[actor] }, { mode: op.defaultMode, variant: op.variants[0] ?? {}, mfa: false });',
          '',
          "  expect(probe.result !== null && !probe.result.ok && probe.result.refusal.kind, op.id).toBe('mfa_required');",
          '  expect(probe.calls, op.id).toEqual([]);',
          '}',
        ])
      : []),
    ...itLines('schema', tag, [
      'expect(SCHEMA_CHECKS).not.toHaveLength(0);',
      'for (const check of SCHEMA_CHECKS) {',
      '  expect(Object.keys(check.schema.shape).sort(), check.id).toEqual([...check.props].sort());',
      '  expect(check.schema.safeParse(check.valid).success, check.id).toBe(true);',
      "  expect(check.schema.safeParse({ ...check.valid, memberId: 'someone-else' }).success, check.id).toBe(false);",
      "  expect(check.schema.safeParse({ ...check.valid, actorId: 'someone-else' }).success, check.id).toBe(false);",
      '  for (const prop of check.rowProps) {',
      "    expect(check.schema.safeParse({ ...check.valid, [prop]: '' }).success, `${check.id} ${prop}`).toBe(false);",
      "    expect(check.schema.safeParse({ ...check.valid, [prop]: 'x'.repeat(129) }).success, `${check.id} ${prop}`).toBe(false);",
      '    expect(check.schema.safeParse({ ...check.valid, [prop]: 1 }).success, `${check.id} ${prop}`).toBe(false);',
      '  }',
      '}',
    ]),
    ...itLines('gates', tag, [
      'expect(ENTRIES).not.toHaveLength(0);',
      'for (const entry of ENTRIES) {',
      "  const source = readFileSync(new URL(entry.entryFile, import.meta.url), 'utf8');",
      '  const at = (needle: string, from = 0): number => source.indexOf(needle, from);',
      '  const call = at(`await ${entry.compose}(`);',
      '',
      "  expect(at('await resolveActorId()'), entry.id).toBeGreaterThan(-1);",
      "  expect(at('await resolveActorId()'), entry.id).toBeLessThan(at('.safeParse('));",
      "  expect(at('.safeParse('), entry.id).toBeLessThan(call);",
      "  expect(call, entry.id).toBeLessThan(at('recordActionRefusal(', call));",
      '  expect(source, entry.id).toContain(entry.callText);',
      "  expect(source, entry.id).not.toMatch(/\\binput\\./u);",
      '  if (entry.mfa) {',
      "    expect(at('await resolveSessionMfa()'), entry.id).toBeGreaterThan(at('.safeParse('));",
      "    expect(at('await resolveSessionMfa()'), entry.id).toBeLessThan(call);",
      '  }',
      "  const composition = readFileSync(new URL(entry.compositionFile, import.meta.url), 'utf8');",
      "  expect(composition, entry.id).toContain('await port.');",
      "  if (entry.mfa) expect(composition.indexOf('mfaRefusal('), entry.id).toBeLessThan(composition.indexOf('await port.'));",
      '}',
    ]),
    '});',
  ];
}

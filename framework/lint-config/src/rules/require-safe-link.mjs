/**
 * 手書きの画面が **リンクとフォームの送り先に出す値を、`safeHttpUrl`(`@kaninabe/runtime/url`)か宣言された経路だけから作らせる**(ASVS V1.2.2)。
 *
 * **対象は要素の名前でなく束縛で決める**(点検 10 回目 B10-4)。同じ `<a href>` / `<form action>` を出す部品は全部見る:
 *   - `<a>` / `<area>` の `href`・Next.js の `Link` 部品(モジュールの既定の export。別名の import・名前空間の `L.default` も)の `href`
 *   - `<form>` の `action`・Next.js の `Form` 部品(モジュールの既定の export)の `action`・どの素の要素でも `formAction`(`<button>` / `<input>`)
 * 送り先には、下の「置いてよい式」か、**Server Action の関数**(関数の式・同じファイルの関数・`_actions` のモジュールからの import・
 * `useActionState` の 2 つ目の要素)を置ける。props で受けた関数は辿れないので違反(送り先の部品が自分で import する)。
 *
 * **値で選ぶ要素も同じに見る**(点検 11 回目 B11-2・B11-5)。大文字の JSX の名前は宣言まで辿る: `const Tag: ElementType = …`(注釈が `ElementType`)・
 * `const Tag = href ? 'a' : 'button'`・`{ as: Tag = 'a' }`・`const Back = cond ? Link : 'a'`・`memo(Link)` は、辿り着いた要素の属性を見る。辿れない大文字の
 * 部品(props で受けた部品・別の部品)は対象外のまま。同じファイルの表引き・関数の戻り値(`const T = Tags[k]`・`const U = getTag()`・`<Tags.a />`)は辿れない値として素の `<a>` / `<form>` の属性を全部見る(12 回目 B12-3)。部品を値として持ち回る形(再輸出・`export { Link }`・`memo(Link)`・`component={Link}`・`createElement(Link, …)`)は
 * 束縛が消えるので、その場で赤(`const` に選ぶ形だけ通す)。`createElement('a', props)` / `cloneElement(<a />, props)` の props は属性と同じに見る。
 * `Link` の `as`・`<a>` の `xlinkHref` も送り先である。
 *
 * **部品は行き先で分ける**(点検 11 回目 B11-1): 自サイトの遷移は `safeReturnPath` / `screenPath`、外部 URL の表示は `<a>` と `safeHttpUrl`。`safeHttpUrl` は
 * 絶対の http / https を通す部品なので、`?next=` に使うと外を指す。`Link` / `Form`(自サイトの遷移の部品)に `safeHttpUrl` の値を置く形は赤にする。
 * `<a href={safeHttpUrl(next)}>` は、外部 URL の表示と字面で区別できないので規則の外に残る(出どころの推測はしない)。
 *
 * 外へのリンクになる文字列(`format: url` の欄・運営が入れた設定の URL)を `href` にそのまま置くと、`javascript:` / `data:` が
 * 公開ページで実行される。生成する画面の部品は `format: url` の欄を `safeHttpUrl` を通したリンクにしてあるので、
 * 手書きの部品にも同じ関門を要求する。**名前(`url` を含む欄名)では決めない** —— 値の作り方で決める。
 *
 * `<a>` / `<area>` の `href` に置いてよい式(静的に確かめられるものだけ):
 *   - 文字列リテラル・式を持たないテンプレート・`null` / `undefined`(書いた人が決めた値)
 *   - `safeHttpUrl(…)` の呼び出し(`<a>` / `<area>` / `<form>` だけ)・`safeReturnPath(…)` の呼び出し
 *   - `screenPath(r, …)` の呼び出し(**第 1 引数 `r` は `screenRoutes.….route` の参照かそれで初期化した `const` だけ**。動的な区画の無い
 *     route は値をそのまま返すので、利用者の値を置くと外を指す — 点検 10 回目 B10-5)と、`screenRoutes.…` / `AUTH_ENTRY_PATHS.…` の参照
 *     (生成物の自サイトの遷移先と認証の口)
 *   - 上のどれかで初期化した `const` の識別子(何段でも。引数・`let`・分割代入は辿れないので許さない)
 *   - 上のものを `??` / `||` / 三項 / `!` / `as` で組み合わせたもの
 * それ以外(props の値・`row.ticketUrl`・テンプレートに式を埋めたもの・`{...spread}`)は違反。
 * **名前でなく束縛で見る**: `safeHttpUrl` / `screenPath` / `screenRoutes` は、スコープ解析でその識別子が本物のモジュールからの
 * import に解決できたときだけ安全とする(props の分割代入・引数・ローカル宣言・同名の別モジュールの import は違反。別名の import は可)。
 *   - `safeHttpUrl` / `safeReturnPath` ← `@kaninabe/runtime/url`   - `screenPath` ← `@/components/screen-path`   - `screenRoutes` ← `@/domain/generated/screens`
 *   - `AUTH_ENTRY_PATHS` ← `@/domain/generated/auth`   - `Link` / `Form` ← Next.js の部品のモジュールの既定(表 `COMPONENT_TARGETS`)
 * 免除の口は作らない(`no-eslint-disable-comment` が止める)。props で受け取った URL は、受け取った側で `safeHttpUrl` を通す。
 *
 * @oversize 1 本の規則が「送り先の属性の全部」を閉じる(式の許可表・Server Action の関数・要素の解決・部品の値の持ち回り・createElement)。訪問も判定も同じ表を共有する。
 * @split-review 要素の解決(`guardedTarget` と宣言の辿り)は別ファイルに出せるが、`importOf` と表を規則と共有し、ほかに使い手が無い。分けると表が 2 か所に割れるので 1 本のままにした。
 */

/** 素の要素ごとの、関門を要求する属性(送り先が URL になるもの)。 */
const INTRINSIC_TARGETS = new Map([
  ['a', ['href', 'xlinkHref', 'xlink:href']],
  ['area', ['href']],
  ['form', ['action']],
]);

/** どの素の要素でも関門を要求する属性(`<button formAction>` / `<input formAction>`)。 */
const INTRINSIC_ANY = ['formAction', 'formaction'];

/** 既定の export が同じ送り先を出す部品のモジュールと、関門を要求する属性。 */
const COMPONENT_TARGETS = new Map([
  ['next/link', ['href', 'as']],
  ['next/form', ['action']],
]);

/** 送り先に関数(Server Action)を置ける属性。 */
const ACTION_ATTRIBUTES = new Set(['action', 'formAction', 'formaction']);

/** 自サイトの遷移に呼んでよい関数: import 元のモジュール → そこでの export 名。 */
const SAME_SITE_CALLEES = [
  { module: '@kaninabe/runtime/url', imported: 'safeReturnPath' },
  { module: '@/components/screen-path', imported: 'screenPath' },
];

/** 素の要素に呼んでよい関数(外部 URL の `safeHttpUrl` も)。 */
const SAFE_CALLEES = [...SAME_SITE_CALLEES, { module: '@kaninabe/runtime/url', imported: 'safeHttpUrl' }];

/** 辿ってよい参照の根: import 元のモジュール → そこでの export 名。 */
const SAFE_ROOTS = [
  { module: '@/domain/generated/screens', imported: 'screenRoutes' },
  { module: '@/domain/generated/auth', imported: 'AUTH_ENTRY_PATHS' },
];

/** `screenPath` の第 1 引数の根(生成した route だけ)。 */
const ROUTE_ROOTS = [{ module: '@/domain/generated/screens', imported: 'screenRoutes' }];

/** `screenPath` の import。 */
const SCREEN_PATH = [{ module: '@/components/screen-path', imported: 'screenPath' }];

/** 値を変えずに包むだけの TS のラッパ。 */
const WRAPPERS = new Set(['TSAsExpression', 'TSNonNullExpression', 'TSSatisfiesExpression', 'TSTypeAssertion', 'ChainExpression']);

/**
 * 識別子を宣言まで辿る。
 *
 * @param {import("eslint").Scope.Scope | null} scope - 参照の位置のスコープ
 * @param {string} name - 識別子の名前
 * @returns {import("eslint").Scope.Variable | null} 見つかった変数
 */
export function findVariable(scope, name) {
  for (let current = scope; current !== null; current = current.upper) {
    const found = current.set.get(name);
    if (found !== undefined) return found;
  }
  return null;
}

/**
 * 識別子が、与えた import(モジュール・export 名)の束縛に解決できるか(別名の import も可)。
 *
 * @param {import("eslint").Scope.Scope} scope - 参照の位置のスコープ
 * @param {string} name - 識別子の名前
 * @param {readonly { module: string, imported: string }[]} allowed - 許す import
 * @returns {boolean} 本物の import に束縛されていれば true
 */
export function boundToImport(scope, name, allowed) {
  const definition = findVariable(scope, name)?.defs[0];
  if (definition === undefined || definition.type !== 'ImportBinding') return false;
  const specifier = definition.node;
  if (specifier.type !== 'ImportSpecifier' || specifier.importKind === 'type' || definition.parent?.importKind === 'type') return false;
  const imported = specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value;
  const source = definition.parent?.source?.value;
  return allowed.some((entry) => entry.module === source && entry.imported === imported);
}

/**
 * 識別子の import の束縛(モジュールと、既定 / 名前つき / 名前空間の別と元の名前)。import でなければ null。
 *
 * @param {import("eslint").Scope.Scope} scope - 位置のスコープ
 * @param {string} name - 識別子の名前
 * @returns {{ module: string, kind: "default" | "named" | "namespace", imported: string | null } | null} 束縛
 */
export function importOf(scope, name) {
  const definition = findVariable(scope, name)?.defs[0];
  if (definition === undefined || definition.type !== 'ImportBinding' || definition.parent?.importKind === 'type') return null;
  const specifier = definition.node;
  const module = definition.parent?.source?.value;
  if (typeof module !== 'string' || specifier.importKind === 'type') return null;
  if (specifier.type === 'ImportDefaultSpecifier') return { module, kind: 'default', imported: 'default' };
  if (specifier.type === 'ImportNamespaceSpecifier') return { module, kind: 'namespace', imported: null };
  const imported = specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value;
  return { module, kind: imported === 'default' ? 'default' : 'named', imported };
}

/**
 * @typedef {{ label: string, attributes: readonly string[], sameSite: boolean }} Target 関門の対象(表示名・属性・自サイトの遷移の部品か)
 */

/**
 * 素の要素の対象。
 *
 * @param {string} name - 要素の名前
 * @returns {Target} 対象
 */
function intrinsicTarget(name) {
  return { label: name, attributes: [...(INTRINSIC_TARGETS.get(name) ?? []), ...INTRINSIC_ANY], sameSite: false };
}

/**
 * import の束縛が指す部品の対象(既定の export だけ)。
 *
 * @param {string} name - 識別子の名前
 * @param {import("eslint").Scope.Scope} scope - 位置のスコープ
 * @returns {Target | null} 対象
 */
function componentTarget(name, scope) {
  const binding = importOf(scope, name);
  const attributes = binding?.kind === 'default' ? COMPONENT_TARGETS.get(binding.module) : undefined;
  return attributes === undefined ? null : { label: `${name}(${binding?.module} の既定)`, attributes, sameSite: true };
}

/**
 * 型の注釈が `ElementType`(`React.ElementType` も)か。何の要素でも入るので、素の `<a>` と `<form>` の属性を全部見る。
 *
 * @param {import("estree").Node & { typeAnnotation?: { typeAnnotation?: { type: string, typeName?: { type: string, name?: string, right?: { name: string } } } } }} node - 宣言の識別子
 * @returns {boolean} 注釈が `ElementType` なら true
 */
function annotatedElementType(node) {
  const annotation = node.typeAnnotation?.typeAnnotation;
  if (annotation?.type !== 'TSTypeReference') return false;
  const typeName = annotation.typeName;
  return (typeName?.type === 'TSQualifiedName' ? typeName.right?.name : typeName?.name) === 'ElementType';
}

/**
 * 値で選ぶ要素の式が指しうる対象を集める(文字列・`Link` の束縛・三項 / 論理・`memo(…)` の引数・`const` と既定値の宣言)。
 *
 * @param {import("estree").Node | null | undefined} node - 式
 * @param {import("eslint").Scope.Scope} scope - 位置のスコープ
 * @param {number} depth - 辿った段数
 * @returns {readonly Target[]} 対象(辿れなければ空)
 */
function elementTargets(node, scope, depth) {
  if (node === null || node === undefined || depth > 8) return [];
  if (WRAPPERS.has(node.type)) return elementTargets(node.expression, scope, depth);
  switch (node.type) {
    case 'Literal':
      return typeof node.value === 'string' && /^[a-z]/u.test(node.value) ? [intrinsicTarget(node.value)] : [];
    case 'ConditionalExpression':
      return [...elementTargets(node.consequent, scope, depth), ...elementTargets(node.alternate, scope, depth)];
    case 'LogicalExpression':
      return [...elementTargets(node.left, scope, depth), ...elementTargets(node.right, scope, depth)];
    case 'CallExpression':
      return node.arguments.flatMap((argument) => elementTargets(argument, scope, depth));
    case 'Identifier':
      return nameTargets(node.name, scope, depth);
    default:
      return [];
  }
}

/**
 * 識別子が指しうる対象を宣言まで辿る(import の束縛・`ElementType` の注釈・初期化子・分割代入の既定値)。
 *
 * @param {string} name - 識別子の名前
 * @param {import("eslint").Scope.Scope} scope - 位置のスコープ
 * @param {number} depth - 辿った段数
 * @returns {readonly Target[]} 対象(辿れなければ空)
 */
function nameTargets(name, scope, depth) {
  const component = componentTarget(name, scope);
  if (component !== null) return [component];
  const variable = findVariable(scope, name);
  const definition = variable?.defs[0];
  if (variable === null || definition === undefined) return [];
  if (annotatedElementType(definition.name)) return [{ label: `${name}(ElementType)`, attributes: [...INTRINSIC_TARGETS.values(), INTRINSIC_ANY].flat(), sameSite: false }];
  const parent = definition.name.parent;
  if (parent?.type === 'AssignmentPattern' && parent.left === definition.name) return elementTargets(parent.right, variable.scope, depth + 1);
  if (definition.type !== 'Variable' || definition.node.id !== definition.name) return [];
  const targets = elementTargets(definition.node.init, variable.scope, depth + 1);
  return targets.length === 0 && opaqueChoice(definition.node.init, variable.scope) ? [opaqueTarget(name)] : targets;
}

/**
 * 何の要素でも入る値の対象(素の `<a>` と `<form>` の属性を全部見る)。
 *
 * @param {string} name - 表示名
 * @returns {Target} 対象
 */
function opaqueTarget(name) {
  return { label: `${name}(値で選ぶ要素)`, attributes: [...INTRINSIC_TARGETS.values(), INTRINSIC_ANY].flat(), sameSite: false };
}

/**
 * 同じファイルの `const` の初期化子が、要素を辿れない値か(表引き `Tags[k]` / `Tags.a`・関数の戻り値 `getTag()`。点検 12 回目 B12-3)。
 * `memo` / `forwardRef` で包んだ部品は部品なので除く。
 *
 * @param {import("estree").Node | null | undefined} init - 初期化子
 * @param {import("eslint").Scope.Scope} scope - 位置のスコープ
 * @returns {boolean} 辿れない値なら true
 */
function opaqueChoice(init, scope) {
  if (init === null || init === undefined) return false;
  if (WRAPPERS.has(init.type)) return opaqueChoice(init.expression, scope);
  if (init.type === 'MemberExpression') return true;
  if (init.type !== 'CallExpression') return false;
  const binding = init.callee.type === 'Identifier' ? importOf(scope, init.callee.name) : null;
  return !(binding?.module === 'react' && (binding.imported === 'memo' || binding.imported === 'forwardRef'));
}

/**
 * 要素の式が指しうる素の要素の名前(`layer/no-dom-assembly` が読む)。部品(import・関数・`memo`)は名前を持たないので空。
 *
 * @param {import("estree").Node | null | undefined} node - 要素の式
 * @param {import("eslint").Scope.Scope} scope - 位置のスコープ
 * @param {number} [depth] - 辿った段数
 * @returns {readonly string[] | null} 名前の一覧(字句でも部品でもなく辿れなければ null)
 */
export function elementChoices(node, scope, depth = 0) {
  if (node === null || node === undefined || depth > 8) return null;
  if (WRAPPERS.has(node.type)) return elementChoices(node.expression, scope, depth);
  if (node.type === 'Literal') return typeof node.value === 'string' ? [node.value] : null;
  if (node.type === 'TemplateLiteral') return node.expressions.length === 0 ? [node.quasis[0]?.value.cooked ?? ''] : null;
  if (node.type === 'ConditionalExpression') return joinChoices(elementChoices(node.consequent, scope, depth), elementChoices(node.alternate, scope, depth));
  if (node.type === 'LogicalExpression') return joinChoices(elementChoices(node.left, scope, depth), elementChoices(node.right, scope, depth));
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') return [];
  if (node.type === 'CallExpression') return opaqueChoice(node, scope) ? null : [];
  if (node.type !== 'Identifier') return null;
  const variable = findVariable(scope, node.name);
  const definition = variable?.defs[0];
  if (definition === undefined || variable === null) return null;
  if (definition.type === 'ImportBinding' || definition.type === 'FunctionName' || definition.type === 'ClassName') return [];
  if (definition.type !== 'Variable' || definition.node.id !== definition.name || annotatedElementType(definition.name)) return null;
  return elementChoices(definition.node.init, variable.scope, depth + 1);
}

/**
 * 2 つの選択を合わせる(どちらかが辿れなければ辿れない)。
 *
 * @param {readonly string[] | null} first - 1 つ目
 * @param {readonly string[] | null} second - 2 つ目
 * @returns {readonly string[] | null} 和
 */
function joinChoices(first, second) {
  return first === null || second === null ? null : [...first, ...second];
}

/**
 * 集めた対象を 1 つに畳む(属性は和。どれかが自サイトの部品なら自サイトの判定)。
 *
 * @param {readonly Target[]} targets - 対象
 * @param {string} label - 表示名
 * @returns {Target | null} 畳んだ対象
 */
function mergeTargets(targets, label) {
  if (targets.length === 0) return null;
  return { label, attributes: [...new Set(targets.flatMap((target) => target.attributes))], sameSite: targets.some((target) => target.sameSite) };
}

/**
 * JSX の要素の名前から、関門を要求する属性を決める(**束縛で見る**。点検 10 回目 B10-4)。大文字の名前は宣言まで辿る(11 回目 B11-2)。
 *
 * @param {import("estree-jsx").JSXOpeningElement["name"]} name - 要素の名前
 * @param {import("eslint").Scope.Scope} scope - 位置のスコープ
 * @returns {Target | null} 対象(対象でなければ null)
 */
export function guardedTarget(name, scope) {
  if (name.type === 'JSXIdentifier') {
    if (/^[a-z]/u.test(name.name)) return intrinsicTarget(name.name);
    return mergeTargets(nameTargets(name.name, scope, 0), name.name);
  }
  if (name.type === 'JSXMemberExpression') {
    let root = name.object;
    while (root.type === 'JSXMemberExpression') root = root.object;
    if (root.type !== 'JSXIdentifier') return null;
    const binding = importOf(scope, root.name);
    // 同じファイルの表(`const Tags = { a: 'a' }`)から選ぶ要素は辿れない(点検 12 回目 B12-3)。import した部品の箱は対象外のまま。
    if (binding === null) return findVariable(scope, root.name)?.defs[0]?.type === 'Variable' ? opaqueTarget(`${root.name}.…`) : null;
    const attributes = COMPONENT_TARGETS.get(binding.module);
    return attributes === undefined ? null : { label: `${root.name}.…(${binding.module})`, attributes, sameSite: true };
  }
  return null;
}

/**
 * 部品の値の参照が「`const` や既定値で要素を選ぶ」形か(`const Tag = cond ? Link : 'a'`。export しない)。ほかの値の使い方は束縛を消す。
 *
 * @param {import("estree").Node} node - 参照
 * @returns {boolean} 選ぶ形なら true
 */
function choosesElement(node) {
  let child = node;
  let parent = node.parent;
  while (parent !== undefined && (WRAPPERS.has(parent.type) || parent.type === 'LogicalExpression' || (parent.type === 'ConditionalExpression' && parent.test !== child))) {
    child = parent;
    parent = parent.parent;
  }
  if (parent?.type === 'AssignmentPattern') return parent.right === child;
  if (parent?.type !== 'VariableDeclarator' || parent.init !== child || parent.id.type !== 'Identifier') return false;
  return parent.parent.kind === 'const' && parent.parent.parent?.type !== 'ExportNamedDeclaration';
}

/**
 * React の要素を作る呼び出しの種類(`createElement` / `cloneElement`。`React.createElement` も)。
 *
 * @param {import("estree").CallExpression} node - 呼び出し
 * @param {import("eslint").Scope.Scope} scope - 位置のスコープ
 * @returns {"createElement" | "cloneElement" | null} 種類
 */
function elementFactory(node, scope) {
  const callee = node.callee;
  if (callee.type === 'Identifier') {
    const binding = importOf(scope, callee.name);
    return binding?.module === 'react' && (binding.imported === 'createElement' || binding.imported === 'cloneElement') ? binding.imported : null;
  }
  if (callee.type !== 'MemberExpression' || callee.computed || callee.object.type !== 'Identifier' || importOf(scope, callee.object.name)?.module !== 'react') return null;
  return callee.property.name === 'createElement' || callee.property.name === 'cloneElement' ? callee.property.name : null;
}

/**
 * JSX の属性の名前(`xlink:href` の形も)。
 *
 * @param {import("estree-jsx").JSXAttribute["name"]} name - 属性の名前
 * @returns {string} 綴り
 */
function attributeName(name) {
  return name.type === 'JSXNamespacedName' ? `${name.namespace.name}:${name.name.name}` : name.name;
}

/**
 * メンバー参照の根の識別子の名前。
 *
 * @param {import("estree").Node} node - メンバー参照
 * @returns {string | null} 根の名前
 */
function rootOf(node) {
  let current = node;
  while (current.type === 'MemberExpression') current = current.object;
  return current.type === 'Identifier' ? current.name : null;
}

/**
 * spread を見る。素の要素の spread は、送り先の属性を持つ要素だけを止める(formAction は字面に現れる属性だけを見る)。
 *
 * @param {import("eslint").Rule.RuleContext} context - 文脈
 * @param {import("estree").Node} site - 報告の位置
 * @param {Target} target - 対象
 */
function checkSpread(context, site, target) {
  if (target.attributes.some((name) => !INTRINSIC_ANY.includes(name))) context.report({ node: site, messageId: 'spread', data: { element: target.label } });
}

/**
 * 部品の既定の import(と名前空間)の値の参照を見る。JSX の中と型の位置と、要素を選ぶ `const` だけが通る(点検 11 回目 B11-2)。
 *
 * @param {import("eslint").Rule.RuleContext} context - 文脈
 * @param {import("estree").ImportDeclaration} node - import
 */
function checkComponentValues(context, node) {
  for (const variable of context.sourceCode.getDeclaredVariables(node)) {
    const specifier = variable.defs[0]?.node;
    const named = specifier?.type === 'ImportSpecifier' && (specifier.imported.name ?? specifier.imported.value) !== 'default';
    if (named || specifier?.importKind === 'type' || node.importKind === 'type') continue;
    for (const reference of variable.references) {
      const identifier = reference.identifier;
      if (identifier.type === 'JSXIdentifier' || identifier.parent?.type === 'TSTypeQuery' || reference.isValueReference === false) continue;
      if (!choosesElement(identifier)) context.report({ node: identifier, messageId: 'component', data: { module: node.source.value } });
    }
  }
}

/**
 * 部品のモジュールの再輸出を止める。
 *
 * @param {import("eslint").Rule.RuleContext} context - 文脈
 * @param {import("estree").ExportNamedDeclaration | import("estree").ExportAllDeclaration} node - export
 */
function checkReexport(context, node) {
  if (node.exportKind === 'type' || typeof node.source?.value !== 'string' || !COMPONENT_TARGETS.has(node.source.value)) return;
  context.report({ node, messageId: 'component', data: { module: node.source.value } });
}

/** @type {import("eslint").Rule.RuleModule} */
export const requireSafeLink = {
  meta: {
    type: 'problem',
    docs: {
      description: 'リンクとフォームの送り先(<a href>・Next.js の Link・<form action>・Next.js の Form・formAction)に置く値は safeReturnPath / safeHttpUrl(@kaninabe/runtime/url)か宣言された遷移先の経路から作らせる',
    },
    schema: [],
    messages: {
      unsafe:
        '<{{element}}> の {{attribute}} に静的に安全と確かめられない値を置いています。自サイトの遷移先は `screenPath(screenRoutes.x.route, …)`、`?next=` などの戻り先は `safeReturnPath`(@kaninabe/runtime/url)で作る(同じオリジンの相対パスだけを通す)。外部 URL の表示は `safeHttpUrl`(@kaninabe/runtime/url)で作る(`javascript:` / `data:` を公開ページで実行させない。ASVS V1.2.2。絶対 URL を通すので `?next=` には使わない)。props で受けた URL は受けた側で通す。フォームの送り先には Server Action の関数(`_actions` からの import・同じファイルの関数・useActionState の 2 つ目)も置ける。',
      sameSite:
        '<{{element}}> は自サイトの遷移の部品で、{{attribute}} に静的に安全と確かめられない値を置いています。遷移先は `screenPath(screenRoutes.x.route, …)`、`?next=` などの戻り先は `safeReturnPath`(@kaninabe/runtime/url)で作る。`safeHttpUrl` は絶対 URL を通すのでここには置けない(外部 URL の表示は `<a>` に `safeHttpUrl`)。フォームの送り先には Server Action の関数も置ける。',
      spread:
        '<{{element}}> に {...spread} は使えません(送り先を静的に確かめられない)。送り先を明示し、値は `safeReturnPath`(自サイトの戻り先)か `safeHttpUrl`(外部 URL)を通して作る。',
      component:
        '{{module}} の部品を値として持ち回っています(再輸出・`memo` などへの受け渡し・props)。行き先の検査が使う束縛が消えるので、部品の外から使えません。使う場所で import して JSX に書く(要素を選ぶなら `const Tag = cond ? Link : \'a\'`)。',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    /**
     * 式が静的に安全と確かめられるか。
     *
     * @param {import("estree").Node | null | undefined} node - 式
     * @param {import("eslint").Scope.Scope} scope - 式の位置のスコープ
     * @param {number} depth - 識別子を辿った段数(循環の打ち切り)
     * @param {readonly { module: string, imported: string }[]} callees - 呼んでよい関数の表
     * @returns {boolean} 安全と確かめられれば true
     */
    function safe(node, scope, depth, callees) {
      if (node === null || node === undefined || depth > 8) return false;
      if (WRAPPERS.has(node.type)) return safe(node.expression, scope, depth, callees);
      switch (node.type) {
        case 'Literal':
          return true;
        case 'TemplateLiteral':
          return node.expressions.length === 0;
        case 'LogicalExpression':
          return safe(node.left, scope, depth, callees) && safe(node.right, scope, depth, callees);
        case 'ConditionalExpression':
          return safe(node.consequent, scope, depth, callees) && safe(node.alternate, scope, depth, callees);
        case 'Identifier':
          return node.name === 'undefined' || identifierSafe(node, scope, depth, callees);
        case 'CallExpression':
          if (node.callee.type !== 'Identifier' || !boundToImport(scope, node.callee.name, callees)) return false;
          return !boundToImport(scope, node.callee.name, SCREEN_PATH) || routeArgument(node.arguments[0], scope, depth);
        case 'MemberExpression': {
          const root = rootOf(node);
          return root !== null && boundToImport(scope, root, SAFE_ROOTS);
        }
        default:
          return false;
      }
    }

    /**
     * `screenPath` の第 1 引数が生成した route か(`screenRoutes.….route` の参照・それで初期化した `const`)。
     *
     * @param {import("estree").Node | undefined} node - 第 1 引数
     * @param {import("eslint").Scope.Scope} scope - 位置のスコープ
     * @param {number} depth - 辿った段数
     * @returns {boolean} 生成した route なら true
     */
    function routeArgument(node, scope, depth) {
      if (node === undefined || depth > 8) return false;
      if (WRAPPERS.has(node.type)) return routeArgument(node.expression, scope, depth);
      if (node.type === 'MemberExpression') {
        const root = rootOf(node);
        return root !== null && boundToImport(scope, root, ROUTE_ROOTS);
      }
      if (node.type !== 'Identifier') return false;
      const definition = findVariable(scope, node.name)?.defs[0];
      if (definition?.type !== 'Variable' || definition.parent?.kind !== 'const' || definition.node.id.type !== 'Identifier') return false;
      return routeArgument(definition.node.init ?? undefined, sourceCode.getScope(definition.node), depth + 1);
    }

    /**
     * フォームの送り先に置いた式が Server Action の関数か(関数の式・同じファイルの関数・`_actions` のモジュールからの import・
     * `useActionState(…)` の分割代入の 2 つ目)。
     *
     * @param {import("estree").Node} node - 式
     * @param {import("eslint").Scope.Scope} scope - 位置のスコープ
     * @returns {boolean} Server Action の関数なら true
     */
    function actionFunction(node, scope) {
      if (WRAPPERS.has(node.type)) return actionFunction(node.expression, scope);
      if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') return true;
      if (node.type !== 'Identifier') return false;
      const binding = importOf(scope, node.name);
      if (binding !== null) return binding.kind === 'named' && /(?:^|\/)_actions\//u.test(binding.module);
      const definition = findVariable(scope, node.name)?.defs[0];
      if (definition?.type === 'FunctionName') return true;
      if (definition?.type !== 'Variable' || definition.parent?.kind !== 'const') return false;
      const init = definition.node.init;
      if (definition.node.id.type === 'Identifier') return init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression';
      const pattern = definition.node.id;
      const fromActionState = init?.type === 'CallExpression' && init.callee.type === 'Identifier' && importOf(sourceCode.getScope(definition.node), init.callee.name)?.imported === 'useActionState';
      return fromActionState && pattern.type === 'ArrayPattern' && pattern.elements[1]?.type === 'Identifier' && pattern.elements[1].name === node.name;
    }

    /**
     * 識別子が、安全な式で初期化した `const` を指すか。
     *
     * @param {import("estree").Identifier} node - 識別子
     * @param {import("eslint").Scope.Scope} scope - 位置のスコープ
     * @param {number} depth - 辿った段数
     * @param {readonly { module: string, imported: string }[]} callees - 呼んでよい関数の表
     * @returns {boolean} 安全なら true
     */
    function identifierSafe(node, scope, depth, callees) {
      const variable = findVariable(scope, node.name);
      const definition = variable?.defs[0];
      if (definition === undefined || definition.type !== 'Variable') return false;
      if (definition.parent?.kind !== 'const' || definition.node.id.type !== 'Identifier') return false;
      return safe(definition.node.init, sourceCode.getScope(definition.node), depth + 1, callees);
    }

    /**
     * 送り先の属性に置いた値を見る(JSX の属性と `createElement` の props で共通)。
     *
     * @param {import("estree").Node | null} expression - 値の式(読めなければ null)
     * @param {import("estree").Node} site - 報告の位置
     * @param {string} name - 属性の名前
     * @param {Target} target - 対象
     * @param {import("eslint").Scope.Scope} scope - 値の位置のスコープ
     */
    function checkValue(expression, site, name, target, scope) {
      const callees = target.sameSite ? SAME_SITE_CALLEES : SAFE_CALLEES;
      if (expression !== null && (safe(expression, scope, 0, callees) || (ACTION_ATTRIBUTES.has(name) && actionFunction(expression, scope)))) return;
      context.report({ node: site, messageId: target.sameSite ? 'sameSite' : 'unsafe', data: { element: target.label, attribute: name } });
    }

    /**
     * `createElement` / `cloneElement` の props を属性と同じに見る(点検 11 回目 B11-5)。
     *
     * @param {import("estree").Node | undefined} props - 第 2 引数
     * @param {Target} target - 対象
     * @param {import("eslint").Scope.Scope} scope - 位置のスコープ
     */
    function checkProps(props, target, scope) {
      if (props === undefined || (props.type === 'Literal' && props.value === null)) return;
      if (props.type !== 'ObjectExpression') return checkSpread(context, props, target);
      for (const property of props.properties) {
        if (property.type !== 'Property') {
          checkSpread(context, property, target);
          continue;
        }
        const name = property.computed ? null : property.key.name ?? property.key.value;
        if (name === null) checkSpread(context, property, target);
        else if (target.attributes.includes(name)) checkValue(property.value, property, name, target, scope);
      }
      return undefined;
    }

    return {
      ImportDeclaration(node) {
        if (COMPONENT_TARGETS.has(node.source.value)) checkComponentValues(context, node);
      },
      ExportNamedDeclaration: (node) => checkReexport(context, node),
      ExportAllDeclaration: (node) => checkReexport(context, node),
      CallExpression(node) {
        const scope = sourceCode.getScope(node);
        const factory = elementFactory(node, scope);
        if (factory === null) return;
        const element = node.arguments[0];
        const target = factory === 'cloneElement' ? (element?.type === 'JSXElement' ? guardedTarget(element.openingElement.name, scope) : null) : mergeTargets(elementTargets(element, scope, 0), factory);
        if (target !== null) checkProps(node.arguments[1], target, scope);
      },
      JSXOpeningElement(node) {
        const scope = sourceCode.getScope(node);
        const target = guardedTarget(node.name, scope);
        if (target === null) return;
        for (const attribute of node.attributes) {
          if (attribute.type === 'JSXSpreadAttribute') {
            checkSpread(context, attribute, target);
            continue;
          }
          const name = attributeName(attribute.name);
          if (!target.attributes.includes(name)) continue;
          const value = attribute.value;
          if (value === null || value.type === 'Literal') continue;
          checkValue(value.type === 'JSXExpressionContainer' ? value.expression : null, attribute, name, target, sourceCode.getScope(value));
        }
      },
    };
  },
};

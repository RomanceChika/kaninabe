/**
 * 単発の操作の実行計画の組み立て(`lib/usecase/operation-plan.ts`。束 ⑰)。
 *
 * 確かめるのは「1 操作 = 手順が 1 つの保存点」という写しが成立していること
 * ——保存点と同じ導出器を通り、**状態を予測せず読む**形になり、定型 RPC の引数が規約で決まり、
 * 決まらない操作は理由つきで落ちること(A15 が出す一覧そのもの)。
 */

import { describe, expect, it } from "vitest";
import {
  buildOperationPlans,
  operationProblemText,
} from "../../../lib/usecase/operation-plan.js";
import {
  accessSpec,
  aggregate,
  createRule,
  entitySpec,
  event,
  field,
  machine,
  role,
  writeRule,
  specModel,
  stubContext,
} from "../../helpers/model-builder-v8plus.js";
import { actionSpec } from "../../helpers/trace-builder.js";
import { dataTable, dataTableModel } from "../../helpers/data-builder.js";
import { jobModel, outboxJob } from "../../helpers/job-builder.js";
import type { ActionSpec, ActionSpecModel } from "../../../lib/model/trace/types.js";

/** 遷移 1 本を持つ widget 集約を組み立てる(状態列 + 遷移だけが書く欄)。 */
function modelWith(clears: readonly string[] = []) {
  return specModel({
    roles: [role("anonymous"), role("member"), role("system")],
    aggregates: [
      aggregate({
        name: "widget",
        entity: entitySpec("widget", [
          field(
            "state",
            { kind: "state", machine: "widget" },
            { required: true },
          ),
          field("amount", { kind: "integer" }),
          field("score", { kind: "integer" }),
        ]),
        stateMachines: [
          {
            ...machine({
              machine: "widget",
              states: ["draft", "sent"],
              initial: "draft",
              events: [
                event({
                  id: "send",
                  from: ["draft"],
                  to: "sent",
                  by: ["member"],
                  ...(clears.length === 0 ? {} : { clears }),
                }),
              ],
            }),
            // 副作用は state_spec の `effects` 行が持つ(イベントの宣言ではない)。
            effects: [
              {
                on: "send",
                do: ["notify"],
                location: { file: "docs/specs/domain/widget/states.md" },
              },
            ],
          },
        ],
        // `amount` は遷移だけが書く列(transition_writes)。以前は writes の by: system の行で近似していたが、
        // その行は内部実行の編集の許可であって「遷移が書く列」の印ではない。
        access: accessSpec("widget", { transitionWrites: ["amount"] }),
      }),
    ],
  });
}

/** 既定のモデル(`clears` を宣言していない)。 */
const MODEL = modelWith();

/** 遷移 RPC 1 本を持つ data_table(引数名は呼び側が渡す口)。 */
function tables(params: readonly string[]) {
  return dataTableModel([
    dataTable("widgets", {
      entity: "widget",
      functions: [
        {
          name: "apply_widget_transition",
          args: params.map(() => "text"),
          params,
          kind: "rpc",
          shape: "transition",
          alsoWrites: [],
        },
      ],
    }),
  ]);
}

/** 汎用の遷移 RPC の引数(規約に載る 6 本)。 */
const GENERIC = [
  "p_widget_id",
  "p_expected_state",
  "p_next_state",
  "p_effects",
  "p_event_id",
  "p_actor_id",
];

/** action_spec 1 本だけを持つモデル。 */
function actions(...specs: readonly ActionSpec[]): ActionSpecModel {
  return {
    actions: [...specs],
    unhandled: [],
    scans: [],
    unscanned: [],
    testTagBaseline: [],
  };
}

/** 組み立てを実行する(ジョブカタログは既定で「キューに積む」1 本)。 */
function build(init: {
  action?: ActionSpec;
  params?: readonly string[];
  jobKind?: string;
  /** その種類は書き込みと同じトランザクションで実現される(語の `in_transaction` を写した行の宣言)。 */
  inTransaction?: boolean;
  clears?: readonly string[];
}) {
  const { guards } = stubContext();
  return buildOperationPlans({
    domain: init.clears === undefined ? MODEL : modelWith(init.clears),
    guards,
    actions: actions(
      init.action ??
        actionSpec({ handles: "widget.send", input: ["widget.id"] }),
    ),
    dataTables: tables(init.params ?? GENERIC),
    jobs: jobModel([
      outboxJob("notify", {
        kind: init.jobKind ?? "notification",
        ...(init.inTransaction === true ? { inTransaction: true } : {}),
      }),
    ]),
  });
}

describe("単発の操作の実行計画", () => {
  it("規約に載る引数だけの遷移は計画になり、状態は予測せず読む", () => {
    const built = build({});

    expect(built.problems).toEqual([]);
    expect(built.operations).toHaveLength(1);
    const operation = built.operations[0];
    expect(operation?.plan.single).toBe(true);
    expect(operation?.plan.rpcName).toBe("apply_widget_transition");
    // 予測しない = `literal` が null(呼び側が読んだ値を渡す)。
    expect(
      operation?.params.find((param) => param.name === "p_expected_state")
        ?.source,
    ).toEqual({
      kind: "expected_state",
      entity: "widget",
      field: "state",
      literal: null,
    });
    // 対象の行は入力の id で読む。
    expect(operation?.facts.reads).toEqual([
      {
        entity: "widget",
        table: "widgets",
        idFrom: { kind: "input", step: 0, field: "id" },
        fields: ["state"],
      },
    ]);
  });

  it("runner: manual を宣言した操作は生成物に載らず、理由つきで一覧に載る", () => {
    const built = build({
      action: actionSpec({
        handles: "widget.send",
        input: ["widget.id"],
        runner: { reason: "定型に乗らない RPC" },
      }),
    });

    expect(built.operations).toEqual([]);
    expect(built.problems).toEqual([]);
    // 宣言した操作も**導出は試みる**。ここは導出できてしまう形なので `derivable: true` になり、
    // A15 が「runner を外すこと」と逆向きに指摘する(宣言された例外が免除リストに退化しない)。
    expect(built.manual).toEqual([
      { op: "widget.send", reason: "定型に乗らない RPC", derivable: true },
    ]);
  });

  it("導出できない操作の runner は逆向きに指摘されない(derivable: false)", () => {
    const built = build({
      jobKind: "transaction_effect",
      inTransaction: true,
      action: actionSpec({
        handles: "widget.send",
        input: ["widget.id"],
        runner: { reason: "同一 tx の副作用" },
      }),
    });

    expect(built.manual).toEqual([
      { op: "widget.send", reason: "同一 tx の副作用", derivable: false },
    ]);
  });

  it("同一トランザクションで実現される副作用を持つ操作は定型では組み立てられない", () => {
    const built = build({ jobKind: "transaction_effect", inTransaction: true });

    expect(built.operations).toEqual([]);
    expect(built.problems).toHaveLength(1);
    expect(built.problems[0]?.stage).toBe("effects");
    expect(built.problems[0]?.problem.message).toContain(
      "定型 RPC apply_widget_transition では組み立てられません",
    );
  });

  it("規約に載らない引数名を持つ RPC は理由つきで落ちる", () => {
    const built = build({ params: [...GENERIC, "p_whatever"] });

    expect(built.operations).toEqual([]);
    expect(built.problems[0]?.stage).toBe("params");
    expect(operationProblemText(built.problems)).toContain("p_whatever");
  });

  it("入力に無い欄を要求する引数は computes の宣言で埋まる", () => {
    // `score` は `transition_writes` に載っていない欄である —— 載っている欄
    // (`amount`)は「この遷移は書かない」として空になるので、宣言の要否が見えない。
    const withoutComputes = build({ params: [...GENERIC, "p_score"] });
    const withComputes = build({
      params: [...GENERIC, "p_score"],
      action: actionSpec({
        handles: "widget.send",
        input: ["widget.id"],
        computes: { "widget.score": "widgetScore" },
      }),
    });

    expect(withoutComputes.problems[0]?.problem.message).toContain(
      "仕様のどこにもありません",
    );
    expect(withComputes.problems).toEqual([]);
    expect(
      withComputes.operations[0]?.params.find(
        (param) => param.name === "p_score",
      )?.source,
    ).toEqual({
      kind: "computed",
      field: "score",
      ref: "widgetScore",
    });
  });

  it("遷移が書くと宣言された欄(transition_writes)を供給する宣言が無ければ、その遷移は触れない", () => {
    const built = build({ params: [...GENERIC, "p_amount"] });

    expect(built.problems).toEqual([]);
    expect(
      built.operations[0]?.params.find((param) => param.name === "p_amount")
        ?.source,
    ).toEqual({
      kind: "not_written",
      field: "amount",
      contract: "untouched",
    });
  });

  it("clears を宣言した遷移は、同じ空でも「空にする」を RPC に要求する", () => {
    const built = build({
      params: [...GENERIC, "p_amount"],
      clears: ["amount"],
    });

    expect(built.problems).toEqual([]);
    expect(
      built.operations[0]?.params.find((param) => param.name === "p_amount")
        ?.source,
    ).toEqual({
      kind: "not_written",
      field: "amount",
      contract: "cleared",
    });
  });

  it("ジョブカタログが阻害のとき、副作用を持つ操作は判定を出さず undecided に載る(カタログを空と読まない)", () => {
    const { guards } = stubContext();
    const base = {
      domain: MODEL,
      guards,
      actions: actions(
        actionSpec({ handles: "widget.send", input: ["widget.id"] }),
      ),
      dataTables: tables(GENERIC),
      jobs: undefined,
    };

    const blocked = buildOperationPlans({ ...base, jobsBlocked: true });
    const unselected = buildOperationPlans(base);

    expect(blocked.operations).toEqual([]);
    expect(blocked.problems).toEqual([]);
    expect(blocked.undecided).toEqual([
      { op: "widget.send", manual: false, effects: ["notify"] },
    ]);
    // 阻害でなければ(ジョブが無いという事実どおり)計画が組める。
    expect(unselected.operations).toHaveLength(1);
    expect(unselected.undecided).toEqual([]);
  });

  it("阻害のとき runner: manual の操作は undecided(manual: true)に載り、導出できるとは言わない", () => {
    const { guards } = stubContext();
    const built = buildOperationPlans({
      domain: MODEL,
      guards,
      actions: actions(
        actionSpec({ handles: "widget.send", input: ["widget.id"], runner: { reason: "定型に乗らない" } }),
      ),
      dataTables: tables(GENERIC),
      jobs: undefined,
      jobsBlocked: true,
    });

    expect(built.undecided).toEqual([{ op: "widget.send", manual: true, effects: ["notify"] }]);
    expect(built.manual).toEqual([{ op: "widget.send", reason: "定型に乗らない", derivable: false }]);
  });

  it("data_table を読めない構成では何も組み立てない(読めない環境で壊れない)", () => {
    const { guards } = stubContext();
    const built = buildOperationPlans({
      domain: MODEL,
      guards,
      actions: actions(
        actionSpec({ handles: "widget.send", input: ["widget.id"] }),
      ),
      dataTables: dataTableModel([], false),
      jobs: undefined,
    });

    expect(built).toEqual({ operations: [], problems: [], manual: [], undecided: [] });
  });
  /**
   * 実行者の属性(`actor.{欄}`)は、**対象の行とは別の事実**として供給されなければならない。
   *
   * 対象の集約が実行者の集約でもあるとき(自分の会社の行しか触れない、という形)、「実行者の行を
   * 1 行読む」に畳むと、その読みは `targetRowIdSourceOf` によって**入力が名指した行**に解決される
   * —— `{対象}.{列} == actor.{列}` の両辺が同じ 1 つの事実になり、境界のガードが宣言も警告も
   * 無しに恒真になる(束 ⑲-2a のレビューが実測)。
   */
  it("実行者の属性は対象の行と別の事実として供給される(境界のガードが恒真にならない)", () => {
    const { guards } = stubContext();
    const domain = specModel({
      roles: [role("anonymous"), role("member"), role("system")],
      aggregates: [
        aggregate({
          name: "widget",
          entity: entitySpec("widget", [
            field("state", { kind: "state", machine: "widget" }, { required: true }),
            // 実行者の集約でもある(セッションに載る欄を持つ)= 穴が開く形。
            field("tenant_id", { kind: "string" }, { required: true, session: true }),
          ]),
          stateMachines: [
            machine({
              machine: "widget",
              states: ["draft", "sent"],
              initial: "draft",
              events: [
                event({
                  id: "send",
                  from: ["draft"],
                  to: "sent",
                  by: ["member"],
                  guard: "widget.tenant_id == actor.tenant_id",
                }),
              ],
            }),
          ],
          access: accessSpec("widget", {}),
        }),
      ],
    });
    const built = buildOperationPlans({
      domain,
      guards,
      actions: actions(actionSpec({ handles: "widget.send", input: ["widget.id"] })),
      dataTables: tables(GENERIC),
      jobs: undefined,
    });

    expect(built.problems).toEqual([]);
    const facts = built.operations[0]?.facts;
    // 対象の行の列は読んだ事実、実行者の属性はセッションの欄 —— 供給元が違う。
    expect(facts?.steps[0]?.guardFacts).toEqual([
      { variable: "widget.tenant_id", source: { kind: "external", ref: "widget.tenant_id" } },
      { variable: "actor.tenant_id", source: { kind: "session", field: "tenant_id" } },
    ]);
    // 読むのは入力が指した対象の行だけ(実行者の行を読む予約は積まない)。
    expect(facts?.reads).toEqual([
      {
        entity: "widget",
        table: "widgets",
        idFrom: { kind: "input", step: 0, field: "id" },
        fields: ["state", "tenant_id"],
      },
    ]);
  });
});

describe("作成の入力が親を指す欄で、親の列を条件に読む計画(テナント境界の書き込み)", () => {
  /** 親(テナントを持つ)と子(親を入力で受ける)。子の作成は親の列を実行者の属性と結ぶ。 */
  function childDomain(init: { readonly second?: boolean; readonly context?: Readonly<Record<string, string>> } = {}) {
    return specModel({
      roles: [role("anonymous"), role("member"), role("system")],
      aggregates: [
        aggregate({
          name: "member",
          entity: entitySpec("member", [field("tenant_id", { kind: "string" }, { required: true, session: true })]),
        }),
        aggregate({
          name: "parent",
          entity: entitySpec("parent", [field("tenant_id", { kind: "string" }, { required: true })]),
        }),
        aggregate({
          name: "child",
          entity: entitySpec(
            "child",
            [
              field("parent_id", { kind: "ref", entity: "parent" }, { required: true }),
              ...(init.second === true ? [field("other_parent_id", { kind: "ref", entity: "parent" }, { required: true })] : []),
              field("name", { kind: "string" }, { required: true }),
            ],
            init.context ?? { parent: "child.parent_id" },
          ),
          access: accessSpec("child", { creates: [createRule("member", "parent.tenant_id == actor.tenant_id")] }),
        }),
      ],
    });
  }

  function createTables(params: readonly string[]) {
    return dataTableModel([
      dataTable("childs", {
        entity: "child",
        functions: [{ name: "insert_child", args: params.map(() => "text"), params, kind: "rpc", shape: "create", alsoWrites: [] }],
      }),
    ]);
  }

  it("p_values でまとめて受ける親の参照の欄から、親の行を読む id が決まる(実行者の属性と結ぶ条件を書ける)", () => {
    const { guards } = stubContext();
    const built = buildOperationPlans({
      domain: childDomain(),
      guards,
      actions: actions(actionSpec({ handles: "child.create", input: ["child.parent_id", "child.name"] })),
      dataTables: createTables(["p_id", "p_actor_id", "p_values", "p_actor_roles"]),
      jobs: undefined,
    });

    expect(built.problems).toEqual([]);
    expect(built.operations[0]?.facts.reads).toEqual([
      { entity: "parent", table: "parents", idFrom: { kind: "input", step: 0, field: "parent_id" }, fields: ["tenant_id"] },
    ]);
  });

  it("別の引数(p_parent_id)で受ける親の参照の欄は従来どおり(先に見つかる)", () => {
    const { guards } = stubContext();
    const built = buildOperationPlans({
      domain: childDomain(),
      guards,
      actions: actions(actionSpec({ handles: "child.create", input: ["child.parent_id", "child.name"] })),
      dataTables: createTables(["p_id", "p_actor_id", "p_parent_id", "p_values", "p_actor_roles"]),
      jobs: undefined,
    });

    expect(built.problems).toEqual([]);
    expect(built.operations[0]?.facts.reads[0]?.idFrom).toEqual({ kind: "input", step: 0, field: "parent_id" });
  });

  /** 親を指す欄が 2 本ある子の作成を組み立てる(入力は両方受ける)。 */
  function twoRefs(context: Readonly<Record<string, string>>, params: readonly string[] = ["p_id", "p_actor_id", "p_values", "p_actor_roles"]) {
    const { guards } = stubContext();
    return buildOperationPlans({
      domain: childDomain({ second: true, context }),
      guards,
      actions: actions(actionSpec({ handles: "child.create", input: ["child.parent_id", "child.other_parent_id", "child.name"] })),
      dataTables: createTables(params),
      jobs: undefined,
    });
  }

  it("同じ親を指す欄が複数あるとき、context が親へ届く欄として名指した欄を選ぶ(型が同じ先頭の欄ではない)", () => {
    const built = twoRefs({ parent: "child.other_parent_id" });

    expect(built.problems).toEqual([]);
    expect(built.operations[0]?.facts.reads[0]?.idFrom).toEqual({ kind: "input", step: 0, field: "other_parent_id" });
  });

  it("名指しが先頭の欄なら先頭の欄(名指しは宣言の順序に依らない)", () => {
    const built = twoRefs({ parent: "child.parent_id" });

    expect(built.problems).toEqual([]);
    expect(built.operations[0]?.facts.reads[0]?.idFrom).toEqual({ kind: "input", step: 0, field: "parent_id" });
  });

  it("同じ親を指す欄が複数あって context が選ばなければ、黙って先頭を取らず計画を止める", () => {
    const built = twoRefs({});

    expect(built.operations).toEqual([]);
    expect(built.problems.length).toBeGreaterThan(0);
  });

  it("別の引数(p_parent_id)と p_values の欄が別の欄で同じ親を指すとき、context の名指しで決める", () => {
    const built = twoRefs({ parent: "child.other_parent_id" }, ["p_id", "p_actor_id", "p_parent_id", "p_values", "p_actor_roles"]);

    expect(built.problems).toEqual([]);
    expect(built.operations[0]?.facts.reads[0]?.idFrom).toEqual({ kind: "input", step: 0, field: "other_parent_id" });
  });

  it("入力に親の参照の欄が無ければ、親の行は読めない(黙って別の行を指さない)", () => {
    const { guards } = stubContext();
    const built = buildOperationPlans({
      domain: childDomain(),
      guards,
      actions: actions(actionSpec({ handles: "child.create", input: ["child.name"] })),
      dataTables: createTables(["p_id", "p_actor_id", "p_values", "p_actor_roles"]),
      jobs: undefined,
    });

    expect(built.operations).toEqual([]);
    expect(built.problems.length).toBeGreaterThan(0);
  });
});

describe("編集の入力が親を指す欄でも、親の行は現在の対象の行から辿る(テナント境界の書き込み。外部レビュー P2-1)", () => {
  /** 子は会社の列を持たず、親(会社を持つ)へ context で届く。編集は親の参照の欄も書ける。 */
  function editDomain() {
    return specModel({
      roles: [role("anonymous"), role("member"), role("system")],
      aggregates: [
        aggregate({
          name: "member",
          entity: entitySpec("member", [field("company_id", { kind: "string" }, { required: true, session: true })]),
        }),
        aggregate({
          name: "parent",
          entity: entitySpec("parent", [field("company_id", { kind: "string" }, { required: true })]),
        }),
        aggregate({
          name: "child",
          entity: entitySpec(
            "child",
            [field("parent_id", { kind: "ref", entity: "parent" }, { required: true }), field("name", { kind: "string" }, { required: true })],
            { parent: "child.parent_id" },
          ),
          access: accessSpec("child", {
            creates: [createRule("member", "parent.company_id == actor.company_id")],
            writes: [writeRule("member", ["parent_id", "name"], "parent.company_id == actor.company_id")],
          }),
        }),
      ],
    });
  }

  function tables(fn: string, params: readonly string[], shape: "create" | "update") {
    return dataTableModel([
      dataTable("childs", {
        entity: "child",
        functions: [{ name: fn, args: params.map(() => "text"), params, kind: "rpc", shape, alsoWrites: [] }],
      }),
    ]);
  }

  it("編集: 入力の新しい親(parent_id)ではなく、現在の行の child.parent_id から親を読む(他社の親を指す行を自社の親へ付け替える入力が通らない)", () => {
    const { guards } = stubContext();
    const built = buildOperationPlans({
      domain: editDomain(),
      guards,
      actions: actions(actionSpec({ handles: "child.update", input: ["child.id", "child.parent_id", "child.name"] })),
      dataTables: tables("update_child", ["p_child_id", "p_actor_id", "p_values", "p_actor_roles"], "update"),
      jobs: undefined,
    });

    expect(built.problems.length ? operationProblemText(built.problems) : '').toBe('');
    const reads = built.operations[0]?.facts.reads ?? [];
    expect(reads.find((read) => read.entity === "parent")?.idFrom).toEqual({ kind: "context", ref: "child.parent_id" });
    expect(reads.find((read) => read.entity === "child")?.idFrom).toEqual({ kind: "input", step: 0, field: "id" });
  });

  it("編集: 親の参照が別の引数(p_parent_id)で渡されても、現在の行の context が先(新しい入力の親は権限の事実に使わない)", () => {
    const { guards } = stubContext();
    const built = buildOperationPlans({
      domain: editDomain(),
      guards,
      actions: actions(actionSpec({ handles: "child.update", input: ["child.id", "child.parent_id", "child.name"] })),
      dataTables: tables("update_child", ["p_child_id", "p_actor_id", "p_parent_id", "p_values", "p_actor_roles"], "update"),
      jobs: undefined,
    });

    expect(built.problems.length ? operationProblemText(built.problems) : "").toBe("");
    expect(built.operations[0]?.facts.reads.find((read) => read.entity === "parent")?.idFrom).toEqual({ kind: "context", ref: "child.parent_id" });
  });

  it("編集: context が親へ届かないなら、入力の参照の欄から読まず生成を止める(fail-closed)", () => {
    const { guards } = stubContext();
    const domain = specModel({
      roles: [role("anonymous"), role("member"), role("system")],
      aggregates: [
        aggregate({
          name: "member",
          entity: entitySpec("member", [field("company_id", { kind: "string" }, { required: true, session: true })]),
        }),
        aggregate({ name: "parent", entity: entitySpec("parent", [field("company_id", { kind: "string" }, { required: true })]) }),
        aggregate({
          name: "child",
          entity: entitySpec("child", [field("parent_id", { kind: "ref", entity: "parent" }, { required: true }), field("name", { kind: "string" }, { required: true })]),
          access: accessSpec("child", { writes: [writeRule("member", ["parent_id", "name"], "parent.company_id == actor.company_id")] }),
        }),
      ],
    });
    const built = buildOperationPlans({
      domain,
      guards,
      actions: actions(actionSpec({ handles: "child.update", input: ["child.id", "child.parent_id", "child.name"] })),
      dataTables: tables("update_child", ["p_child_id", "p_actor_id", "p_parent_id", "p_values", "p_actor_roles"], "update"),
      jobs: undefined,
    });

    expect(built.operations).toEqual([]);
    const text = operationProblemText(built.problems);
    expect(text).toContain("parent.company_id");
    expect(text).toContain("context");
  });

  it("作成: 対象の行がまだ無いので、入力の親(parent_id)から読む(従来どおり)", () => {
    const { guards } = stubContext();
    const built = buildOperationPlans({
      domain: editDomain(),
      guards,
      actions: actions(actionSpec({ handles: "child.create", input: ["child.parent_id", "child.name"] })),
      dataTables: tables("insert_child", ["p_id", "p_actor_id", "p_values", "p_actor_roles"], "create"),
      jobs: undefined,
    });

    expect(built.problems).toEqual([]);
    expect(built.operations[0]?.facts.reads.find((read) => read.entity === "parent")?.idFrom).toEqual({
      kind: "input",
      step: 0,
      field: "parent_id",
    });
  });
});

describe("行の条件(claim)を宣言した計画(ADR-0018)", () => {
  /** 有効なメンバーだけが立つ既定のログインロール。 */
  const member = { ...role("member", undefined, undefined, "authenticated_default"), claim: "person.status", claimValues: ["active"] };
  const staff = { ...role("staff", undefined, ["member"]), claim: "person.is_staff" };
  const paused = { ...role("paused"), claim: "person.status", claimValues: ["suspended", "lapsed"] };

  function conditioned(roles: ReturnType<typeof role>[]) {
    const { guards } = stubContext();
    const domain = specModel({
      roles: [role("anonymous"), ...roles, role("system")],
      aggregates: [
        aggregate({
          name: "person",
          entity: entitySpec("person", [
            field("nickname", { kind: "string" }, { session: true, required: true }),
            field("is_staff", { kind: "boolean" }, { session: true }),
            field("status", { kind: "enum", values: ["guest", "active", "suspended", "lapsed"] }, { session: true, required: true }),
          ]),
        }),
        aggregate({
          name: "widget",
          entity: entitySpec("widget", [field("state", { kind: "state", machine: "widget" }, { required: true })]),
          stateMachines: [
            machine({
              machine: "widget",
              states: ["draft", "sent"],
              initial: "draft",
              events: [event({ id: "send", from: ["draft"], to: "sent", by: ["member", "staff", "paused"] })],
            }),
          ],
        }),
      ],
    });
    return buildOperationPlans({
      domain,
      guards,
      actions: actions(actionSpec({ handles: "widget.send", input: ["widget.id"] })),
      dataTables: tables(GENERIC),
      jobs: jobModel([outboxJob("notify", { kind: "notification" })]),
    });
  }

  it("値の集合の claim は values つきで計画に出る(boolean の claim は values を持たない)", () => {
    const facts = conditioned([member, staff, paused]).operations[0]?.facts.steps[0];

    expect(facts?.claimFacts).toEqual([
      { role: "staff", field: "is_staff" },
      { role: "paused", field: "status", values: ["suspended", "lapsed"] },
    ]);
    expect(facts?.claimFacts[0]).not.toHaveProperty("values");
  });

  it("既定のログインロールは claim の根拠ではない(配列の照合と行の条件の両方が要る)ので claimFacts に載らない", () => {
    const facts = conditioned([member, staff, paused]).operations[0]?.facts.steps[0];

    expect(facts?.claimFacts.map((fact) => fact.role)).not.toContain("member");
  });

  it("手順が認めるロールごとに、併せて満たす行の条件が出る(ログイン自身の条件と、含意の先の条件)", () => {
    const facts = conditioned([member, staff, paused]).operations[0]?.facts.steps[0];

    expect(facts?.roleGates).toEqual({
      member: [{ field: "status", values: ["active"] }],
      staff: [{ field: "status", values: ["active"] }],
    });
  });

  it("条件を宣言していなければ roleGates ごと持たない(宣言しなければ計画は変わらない)", () => {
    const facts = conditioned([role("member", undefined, undefined, "authenticated_default"), staff, paused]).operations[0]
      ?.facts.steps[0];

    expect(facts).not.toHaveProperty("roleGates");
  });
});

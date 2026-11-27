# kaninabe

A spec-driven framework for building web apps with a small team and AI. The specs under `docs/specs/` are the source of truth. Verification, documents, implementation parts and tests are derived from them.

Status: pre-1.0 (0.1.3). The spec DSL, the checks and the shape of generated output can still change.

## Layout

| path | what it is |
|---|---|
| `bin/kaninabe.mjs` | the one command-line entry (`verify`, `generate`, ...). It decides the product root and passes it explicitly |
| `legacy/spec-tools` | spec parser, verifiers and generators (`verify`, `generate`) |
| `framework/runtime`, `framework/adapters/*` | runtime packages used by generated code |
| `framework/lint-config` | lint rules for generated and hand-written code |
| `docs/rules` | rules, principles and ADRs |
| `docs/specs`, `product.md`, `supabase/migrations` | the sample product (a small library app): specs and generated SQL only, no `app/` tree (declared in `product.md`, not carried). Replace them with your product's. |

## Commands

Node 24 is required (`.nvmrc`).

```
npm ci && npm --prefix legacy/spec-tools ci
npm run verify -- --fail-on-unclassified
npm run test:unit
npm run test:spec-tools
npm run check:fence && npm run test:bin

# from a product that mounts kaninabe as ./kaninabe
node kaninabe/bin/kaninabe.mjs verify
node kaninabe/bin/kaninabe.mjs generate
```

`scripts/check-import-fence.mjs` checks who may import whom (see its header for the rules).

## Secret safety

No real key goes into this repository; samples use dummy values only. Run `npm run hooks:install` once (it runs `scripts/setup-dev-env.sh`, which installs pinned `gitleaks` and `actionlint` and sets the hook path) to enable the pre-commit secret scan and the pre-push gate (`scripts/push-gate.sh`; see AGENTS.md). The setup script supports linux x64 only and needs git 2.40 or newer; on another platform, install the pinned versions of `gitleaks` and `actionlint` by hand and set `core.hooksPath` to `.githooks` before any push. CI scans the whole tree and history on every push and pull request, including pushes to `main`.

## Disclaimer

Provided as-is, with no warranty. There is no commitment to maintain it or to give support, and this repository may not stay public forever. Use it at your own risk. Forks are welcome.

## License

MIT (see `LICENSE`).

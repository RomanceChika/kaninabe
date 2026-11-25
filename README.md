# kaninabe

A spec-driven framework for building web apps with a small team and AI. The specs under `docs/specs/` are the source of truth. Verification, documents, implementation parts and tests are derived from them.

Status: pre-1.0 (0.1.0). The spec DSL, the checks and the shape of generated output can still change.

## Layout

| path | what it is |
|---|---|
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
```

## Secret safety

No real key goes into this repository; samples use dummy values only. Run `npm run hooks:install` once to enable the pre-commit secret scan (needs `gitleaks`). CI scans the whole tree and history on every push and pull request, including pushes to `main`.

## Disclaimer

Provided as-is, with no warranty. There is no commitment to maintain it or to give support, and this repository may not stay public forever. Use it at your own risk. Forks are welcome.

## License

MIT (see `LICENSE`).

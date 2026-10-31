# HexaBlock Suite

Four puzzle games on hexagonal boards, built on one generic engine, with a REST backend.

HexaBlock Suite is a semester course project. One mobile app holds the four games: Hexa Lines, Hexa Fit, Hexa Sort and Hexa Merge. One API stores users, progress, leaderboards and level definitions. The engine is the point of the project: all four games share one board, one rules contract and one turn cycle, and each game adds only its own rules.

## Status

The project is in the design phase. Requirements and architecture diagrams exist. Game code does not exist yet.

What exists today:

- The requirements, with assumptions, team decisions and open questions: [canonical file in hexablock-app](https://github.com/Hexablock-Suite/hexablock-app/blob/main/docs/REQUIREMENTS.md) and the [backend view in hexablock-api](https://github.com/Hexablock-Suite/hexablock-api/blob/main/docs/REQUIREMENTS.md).
- Draft architecture diagrams, still under team review: the client [layers](https://github.com/Hexablock-Suite/hexablock-app/blob/main/docs/architecture/layers.md) and [class diagram](https://github.com/Hexablock-Suite/hexablock-app/blob/main/docs/architecture/classes.md), and the backend [layers](https://github.com/Hexablock-Suite/hexablock-api/blob/main/docs/architecture/layers.md).
- Two repository skeletons with their quality gates: Clean Architecture folders, lint, layer rules, contract tests and CI.
- The app shows a home screen with the suite name. The API serves a health endpoint and holds the database wiring, which no module uses yet.

What does not exist yet: the engine, the four games, the use cases, the API endpoints for accounts, progress, leaderboards and levels, and a published release.

## The four games

| Game       | Cell content           | Board                        | Move                                          |
| ---------- | ---------------------- | ---------------------------- | --------------------------------------------- |
| Hexa Lines | Color                  | Hexagon, radius 4 (61 cells) | Place a piece from a tray of 3 (1 to 5 cells) |
| Hexa Fit   | Piece id               | Arbitrary figure per level   | Place, remove or rotate a piece (60° steps)   |
| Hexa Sort  | Stack of colored tiles | Hexagon, radius 2 (19 cells) | Place the offered stack on an empty cell      |
| Hexa Merge | Integer (power of 2)   | Hexagon, radius 2 (19 cells) | Slide all tiles in one of 6 directions        |

The full comparison, with resolution, piece source, end of game, progress and undo per game, is in [`docs/REQUIREMENTS.md` §1](https://github.com/Hexablock-Suite/hexablock-app/blob/main/docs/REQUIREMENTS.md#1-product).

## Repositories

| Repository                                                         | What it is                                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| [hexablock-app](https://github.com/Hexablock-Suite/hexablock-app) | Mobile client: the four games on one generic engine. Expo, React Native, TypeScript.                         |
| [hexablock-api](https://github.com/Hexablock-Suite/hexablock-api) | REST backend: users, progress, leaderboards and level definitions. NestJS, Drizzle, Postgres, OpenAPI docs. |

Both repositories are public and use the MIT License.

## Where to read

- [hexablock-app `docs/REQUIREMENTS.md`](https://github.com/Hexablock-Suite/hexablock-app/blob/main/docs/REQUIREMENTS.md): the canonical requirements for both repositories. The [hexablock-api copy](https://github.com/Hexablock-Suite/hexablock-api/blob/main/docs/REQUIREMENTS.md) holds the backend view and links back to it.
- [hexablock-app `docs/architecture/layers.md`](https://github.com/Hexablock-Suite/hexablock-app/blob/main/docs/architecture/layers.md): the Clean layers of the client and the component in each layer (draft).
- [hexablock-app `docs/architecture/classes.md`](https://github.com/Hexablock-Suite/hexablock-app/blob/main/docs/architecture/classes.md): the class diagram, from the generic engine and the four games out to the use cases, adapters and drivers (draft).
- [hexablock-api `docs/architecture/layers.md`](https://github.com/Hexablock-Suite/hexablock-api/blob/main/docs/architecture/layers.md): the Clean layers of the API (draft).
- [hexablock-app `docs/EXTENSIBILITY.md`](https://github.com/Hexablock-Suite/hexablock-app/blob/main/docs/EXTENSIBILITY.md): how a fifth game is added without a change to the engine. Today it is a placeholder.
- `AI_USAGE.md` in [hexablock-app](https://github.com/Hexablock-Suite/hexablock-app/blob/main/AI_USAGE.md) and [hexablock-api](https://github.com/Hexablock-Suite/hexablock-api/blob/main/AI_USAGE.md): the log of AI use per task.
- `AGENTS.md` in [hexablock-app](https://github.com/Hexablock-Suite/hexablock-app/blob/main/AGENTS.md) and [hexablock-api](https://github.com/Hexablock-Suite/hexablock-api/blob/main/AGENTS.md): the contributor rules. Each rule names its gate or says "no gate".

## How the team works

- **Conventional Commits, in English.** The `commit-msg` hook runs commitlint. Gates: `test/gates/commit-message-gate.test.ts` (app) and `test/gates/commit-message.gate.spec.ts` (api). The api CI also runs commitlint on each pull request.
- **`pnpm verify` in CI.** The `pre-push` hook runs its fast part: lint, typecheck and the layer rules. CI runs the whole command in the `verify` job on every pull request and on every push to `main` (`.github/workflows/ci.yml` in each repository). In the app it runs lint, format check, typecheck, tests, the pact check and the layer rules. In the api it runs lint, format check, typecheck, tests, the layer rules and the OpenAPI drift check.
- **Architecture gates.** `pnpm arch` runs the dependency-cruiser layer rules in `.dependency-cruiser.cjs`. Domain code imports only domain code and no framework. In the app, the engine never imports a game, and a game never imports another game. Gates: `test/gates/architecture-gate.test.ts` (app) and `test/gates/architecture.gate.spec.ts` (api).
- **Deterministic core.** Domain code receives time and randomness by injection, so a game is reproducible with a seed. Gates: `test/gates/domain-purity-gate.test.ts` (app) and `test/gates/determinism.gate.spec.ts` (api).
- **Contract tests.** The app writes a [Pact](https://docs.pact.io/) contract. The CI `contract` job in each repository verifies it against the API.
- **Test names.** Every test is named `should_<expected_result>_when_<condition>`. The linter rejects other names.
- **Pull requests.** Every change reaches `main` through a pull request with a green `verify` job (api rule `R-protected-main`, no gate).
- **AI usage log.** Each task logs its AI use in `AI_USAGE.md` (rule `R-ai-usage-log`, no gate).

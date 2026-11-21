# Class model of the draw.io generator

One JSON file per repository holds the class model.
`extract.mjs` reads the code, `views.mjs` reads the class views, and `merge.mjs` joins both into the model.
`gen.mjs` reads the model and writes one multi-page `.drawio` file.
`check.mjs` reads the `.drawio` file and checks the notation rules.
This file is the contract between those scripts. Change it before you change the shape of the model.

## Top level

```json
{ "repo": "hexablock-app", "head": "64dee55", "parts": [], "types": [], "edges": [] }
```

`parts` lists the parts in page order. Each part is `{ "id": "engine", "title": "Engine" }`.

| Repository | Part ids, in page order |
|---|---|
| `hexablock-app` | `engine`, `variants`, `usecases`, `adapters` |
| `hexablock-api` | `domain`, `usecases`, `adapters` |

## Type

| Field | Value |
|---|---|
| `id` | Unique in the model. The type name, or `Name@path` when two types share a name. |
| `name` | The name in the code or in the view. |
| `kind` | `class`, `interface`, `union`, `type`, `enum` or `const` (an `export const` object that a view draws as a class). |
| `abstract` | `true` for an abstract class. |
| `status` | `code` when the type exists in `src/` at `head`. `planned` when only a view draws it. |
| `sprint` | `"Sprint N"` when a view marks a planned type with that stereotype, else `null`. A type with `status: code` always has `null`. |
| `stereotypes` | Stereotype names without guillemets, for example `["Strategy"]`, `["port"]`, `["aggregate root"]`. The generator adds `planned` for a planned type. |
| `layer` | Clean layer, `1` (entities) to `4` (frameworks and drivers). |
| `part` | One part id of the top level. |
| `file`, `line` | Repository-relative source path and line. `null` for a planned type. |
| `typeParams` | `[{ "name", "constraint", "default" }]`, the UML template parameters. |
| `attrs` | `[{ "vis", "name", "type", "static", "readonly", "optional" }]`. `vis` is `+`, `-` or `#`. |
| `ops` | `[{ "vis", "name", "typeParams", "params", "ret", "abstract", "static" }]`. `typeParams` holds the operation's own type parameters in the shape of the type's `typeParams`, and is `[]` when it has none. `params` is a list of `"name: Type"`. `ret` is `null` only for a constructor. |
| `values` | The literals of a `union` or the members of an `enum`. |
| `alias` | The aliased type text of a `type` that is not an object or a literal union, else `null`. |
| `views` | The view files that draw the type, for example `["engine-1-turn"]`. |
| `requirement` | The requirement ID that a view prints under a use case, for example `"APP-FR-02"`, else `null`. |

A type with `status: code` takes its members from the code.
A planned type takes its members from the views.
A view can also plan one member of a type that exists, for example `GameEngine.undoable()`.
That member keeps its place in `attrs` or `ops` and adds `"planned": true` and `"sprint": "Sprint N"` or `null`.
The generator prints it with its «Sprint N», or with «planned» when the view gives no sprint.

## Edge

| Field | Value |
|---|---|
| `from`, `to` | Type ids. `from` is the holder, the caller or the subtype. |
| `kind` | `use`, `implements`, `extends`, `aggregation` or `composition`. |
| `label` | Text next to the line. An attribute use carries its name and multiplicity (`games 1`, `history 0..1`, `cells *`). A `new` carries `«create»`. Any other use carries the operation that uses the type, for example `execute()`. A type argument of a heritage clause carries `«bind»`. `null` for `implements`, `extends`, and a use that comes only from a type alias. |
| `pattern` | The GoF pattern that a diamond makes visible, for example `Strategy`. Required for `aggregation` and `composition`, else `null`. |
| `status` | `code` when the code has the dependency at `head`. `planned` when only a view draws it. |
| `views` | The view files that draw the edge. Empty for an edge that only the code has. |

## Layout file

The layout file is optional. It fixes the order of the class diagram across generations.
`gen.mjs --layout <layout.json>` reads it, and `pin.mjs` writes it from a `.drawio` file that a person edited in draw.io.
Each repository keeps it at `docs/architecture/classes.layout.json`, next to `classes.config.json`.

```json
{
  "pages": {
    "all-classes": {
      "1": [
        { "group": "core|src/domain/engine", "types": ["Rules", "Engine", "Phase", "Outcome"] },
        { "group": "core|planned", "types": ["MoveHistory"] }
      ]
    },
    "part-core": {
      "4": [{ "group": "ref|shell", "types": ["WebServer"] }]
    }
  }
}
```

| Field | Value |
|---|---|
| `pages` | One entry per page, by page id: `all-classes` for page 1, `part-<part id>` for a part page. |
| page entry | One entry per layer band, by layer `"1"` to `"4"`. |
| band entry | The groups of the band, in order. Each group is `{ "group", "types" }`. |
| `group` | The group key of `gen.mjs`: `<part>|<source folder>` for code types, `<part>|planned` for planned types, `ref|<part>` for the reference boxes of a part page. A key is unique inside one band of one page. |
| `types` | Type ids of the group, in order. `gen.mjs` places them left to right and wraps them into rows. |

Rules:

1. The layout fixes order only. It fixes no position, no gap, no row break and no line route. `gen.mjs` computes them again in each generation.
2. A page, group or type that the layout names and the model does not have is skipped. `gen.mjs` prints one warning line for each.
3. A group that the model has and the layout does not name comes after the named groups of its band, in the computed order.
   A type that the model has and the layout does not name comes after the named types of its group, in the computed order.
4. The model decides the group of a type. A layout entry cannot move a type to another group.
5. With no layout file, `gen.mjs` writes the same bytes as before the layout option existed.

## Invariants

1. Every `from` and `to` is the `id` of a type in the model.
2. An `aggregation` or a `composition` joins two types of the same layer and names its `pattern` (rule 11 of `classes.md`, «How to read it»). Every other attribute is a `use`.
3. The model has at most one edge for each pair of `from`, `to` and `kind`. A pair with `implements` or `extends` has no `use` edge too.
4. Types sort by `layer` from 4 to 1, then `part`, `file` and `name`. Edges sort by `from`, `to` and `kind`.
5. The model has no timestamp, so the same commits always give the same bytes.

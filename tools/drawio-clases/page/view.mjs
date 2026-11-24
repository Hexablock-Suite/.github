// view.mjs gives the build and the tests the view rules of the page.
// The rules come from src/view.js, the same file that the page runs.
import { readFileSync } from 'node:fs';

export const VIEW_RULES = readFileSync(new URL('src/view.js', import.meta.url), 'utf8');

// viewMath runs view.js in its own scope and gives its functions.
export const viewMath = new Function(VIEW_RULES + '\nreturn { DRAW_MS, drawsNow, previewOf };')();

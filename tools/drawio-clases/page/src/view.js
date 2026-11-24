// view.js holds the rules of the two views of the canvas.
// The asked view is the scale and the offset that the reader wants: k, tx and ty.
// The drawn view is the scale and the offset that the SVG holds.
// A change of the scale makes the browser lay out every text again and draw every shape again.
// So the page does not draw each step of a zoom. Between two draws it shows a preview:
// it scales and moves the picture that the SVG already holds, which needs no layout and no drawing.
// It is a plain script with no DOM access and no module syntax.
// The build puts it into the page as it is, and the tests run it with its own scope.

// DRAW_MS is the shortest time between two draws while the scale changes, in milliseconds.
const DRAW_MS = 120;

// drawsNow tells if a change of the asked view draws the SVG at once.
// sinceDraw is the time since the last draw, in milliseconds.
// A pan keeps the scale, and the browser moves the drawn picture with no new layout. So a pan draws at once.
function drawsNow(asked, drawn, sinceDraw) {
  if (!(drawn.k > 0)) return true;
  if (asked.k === drawn.k) return true;
  return sinceDraw >= DRAW_MS;
}

// previewOf gives the scale r and the move x, y that put the drawn picture where the asked view puts the diagram.
// The picture scales from its top left corner and then moves.
function previewOf(asked, drawn) {
  const r = asked.k / drawn.k;
  return { r, x: asked.tx - drawn.tx * r, y: asked.ty - drawn.ty * r };
}

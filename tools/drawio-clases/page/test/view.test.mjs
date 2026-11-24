// view.test.mjs checks the view rules of the page: when a change draws the SVG, and where the preview puts the drawn picture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewMath } from '../view.mjs';

const { DRAW_MS, drawsNow, previewOf } = viewMath;

test('zoom: a scale change draws at most once in DRAW_MS, and the page shows a preview between two draws', () => {
  const drawn = { k: 0.5, tx: 40, ty: -20 };
  const asked = { k: 0.6, tx: 10, ty: -60 };
  assert.equal(drawsNow(asked, drawn, 0), false);
  assert.equal(drawsNow(asked, drawn, DRAW_MS - 1), false);
  assert.equal(drawsNow(asked, drawn, DRAW_MS), true);
});

test('zoom: the first change draws, because the SVG holds no view yet', () => {
  assert.equal(drawsNow({ k: 0.6, tx: 10, ty: -60 }, { k: 0, tx: 0, ty: 0 }, 0), true);
});

test('pan: a change that keeps the scale draws at once, as before', () => {
  const drawn = { k: 0.5, tx: 40, ty: -20 };
  assert.equal(drawsNow({ k: 0.5, tx: 90, ty: 15 }, drawn, 0), true);
});

test('zoom: the preview puts each point of the drawn picture where the asked view puts it', () => {
  const drawn = { k: 0.5, tx: 40, ty: -20 };
  for (const asked of [{ k: 0.8, tx: -310, ty: 95 }, { k: 0.21, tx: 400, ty: 12.5 }, { k: 0.5, tx: 0, ty: 0 }]) {
    const { r, x, y } = previewOf(asked, drawn);
    for (const [px, py] of [[0, 0], [1200, 340], [-75, 8000]]) {
      // The SVG draws the point at dx, dy. The preview scales the picture from its top left corner and then moves it.
      const dx = drawn.k * px + drawn.tx, dy = drawn.k * py + drawn.ty;
      assert.ok(Math.abs(r * dx + x - (asked.k * px + asked.tx)) < 1e-9);
      assert.ok(Math.abs(r * dy + y - (asked.k * py + asked.ty)) < 1e-9);
    }
  }
});

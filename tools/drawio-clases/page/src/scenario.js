// scenario.js lays one extensibility scenario over the model of its repository.
// The build lays out the copy that it gives. The page draws the same copy, so the line indexes of both agree.
// It is a plain script with no DOM access and no module syntax.
// The build puts it into the page as it is, and runs it with its own scope.

// scenarioModel gives a copy of the model with the added boxes of one scenario.
// An added box is a class of the code with no member. It carries the flag added.
// Its lines come after the edges of the model, in the order of the adds: implements first, then extends.
// The scenario gives the layer and the part of each added box, as scenarios.mjs writes them.
function scenarioModel(model, scenario) {
  const types = scenario.adds.map((a) => ({
    id: a.name, name: a.name, kind: a.kind, abstract: false, status: 'code', sprint: null, stereotypes: a.stereotypes.slice(),
    layer: a.layer, part: a.part, file: a.file, line: null, typeParams: [], attrs: [], ops: [], values: [], alias: null,
    views: [], requirement: null, added: true,
  }));
  const edges = [];
  for (const a of scenario.adds) {
    for (const kind of ['implements', 'extends']) {
      if (a[kind]) edges.push({ from: a.name, to: a[kind], kind, label: null, pattern: null, status: 'code', views: [] });
    }
  }
  return { ...model, types: [...model.types, ...types], edges: [...model.edges, ...edges] };
}

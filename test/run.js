#!/usr/bin/env node
// Test runner for all converters.
// Shims `window` so the browser-targeted IIFEs can register their globals,
// then exercises each converter against a shared fixture.

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, msg) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(msg);
    console.error(`  FAIL: ${msg}`);
  }
}

function assertIncludes(haystack, needle, msg) {
  assert(
    typeof haystack === 'string' && haystack.includes(needle),
    msg || `Expected output to include "${needle}"`
  );
}

function assertNotIncludes(haystack, needle, msg) {
  assert(
    typeof haystack === 'string' && !haystack.includes(needle),
    msg || `Expected output NOT to include "${needle}"`
  );
}

function assertMatch(str, regex, msg) {
  assert(
    typeof str === 'string' && regex.test(str),
    msg || `Expected output to match ${regex}`
  );
}

function section(name) {
  console.log(`\n── ${name} ${'─'.repeat(60 - name.length)}`);
}

// ── Load converters into a shared sandbox ────────────────────────────────────

const sandbox = { window: {}, console };
vm.createContext(sandbox);

const converterFiles = [
  'converter-drawio.js',
  'converter-mermaid.js',
  'converter-klaxoon.js',
  'converter-penpot.js',
];

for (const file of converterFiles) {
  const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf-8');
  try {
    vm.runInContext(code, sandbox, { filename: file });
  } catch (err) {
    console.error(`Failed to load ${file}: ${err.message}`);
    process.exit(1);
  }
}

const { ExcDrawio, ExcMermaid, ExcKlaxoon, ExcPenpot } = sandbox.window;

// ── Load fixture ─────────────────────────────────────────────────────────────

const fixture = fs.readFileSync(path.join(__dirname, 'fixture.json'), 'utf-8');
const fixtureObj = JSON.parse(fixture);

// ═══════════════════════════════════════════════════════════════════════════════
// DRAW.IO TESTS
// ═══════════════════════════════════════════════════════════════════════════════
section('draw.io converter');

const drawioOut = ExcDrawio.convertExcalidrawToDrawio(fixture);

// Basic structure
assert(typeof drawioOut === 'string', 'drawio: returns a string');
assertIncludes(drawioOut, '<mxfile', 'drawio: contains <mxfile root');
assertIncludes(drawioOut, '<mxGraphModel', 'drawio: contains <mxGraphModel');
assertIncludes(drawioOut, '<root>', 'drawio: contains <root>');
assertIncludes(drawioOut, '</mxfile>', 'drawio: closes <mxfile>');
assertIncludes(drawioOut, 'id="0"', 'drawio: has root cell id=0');
assertIncludes(drawioOut, 'id="1"', 'drawio: has layer cell id=1');

// Shapes present
assertMatch(drawioOut, /shape=rect/, 'drawio: rectangle mapped to shape=rect');
assertMatch(drawioOut, /shape=ellipse/, 'drawio: ellipse mapped');
assertMatch(drawioOut, /shape=rhombus/, 'drawio: diamond mapped to rhombus');

// Styling
assertIncludes(drawioOut, 'fillColor=#a5d8ff', 'drawio: rectangle fill color preserved');
assertIncludes(drawioOut, 'fillColor=#b2f2bb', 'drawio: ellipse fill color preserved');
assertIncludes(drawioOut, 'rounded=1', 'drawio: rounded rectangle flag');

// Edges
assertMatch(drawioOut, /shape=filledEdge/, 'drawio: arrows produce filledEdge');
assertIncludes(drawioOut, 'dashed=1', 'drawio: dashed arrow style');

// Text
assertIncludes(drawioOut, 'Start', 'drawio: container text "Start" present');
assertIncludes(drawioOut, 'End', 'drawio: container text "End" present');
assertIncludes(drawioOut, 'Check?', 'drawio: container text "Check?" present');
assertIncludes(drawioOut, 'Yes', 'drawio: edge label "Yes" present');
assertIncludes(drawioOut, 'A standalone note', 'drawio: standalone text present');

// Deleted elements should be excluded
assertNotIncludes(drawioOut, '999', 'drawio: deleted element excluded');

// Accepts object input (not just string)
const drawioOut2 = ExcDrawio.convertExcalidrawToDrawio(fixtureObj);
assert(typeof drawioOut2 === 'string' && drawioOut2.includes('<mxfile'), 'drawio: accepts object input');

// ═══════════════════════════════════════════════════════════════════════════════
// MERMAID TESTS
// ═══════════════════════════════════════════════════════════════════════════════
section('Mermaid converter');

const mermaidOut = ExcMermaid.convertExcalidrawToMermaid(fixture);

// Basic structure
assert(typeof mermaidOut === 'string', 'mermaid: returns a string');
assertIncludes(mermaidOut, 'flowchart TD', 'mermaid: starts with flowchart TD');

// Node shapes
assertMatch(mermaidOut, /n_rect1\("Start"\)/, 'mermaid: rounded rect uses () syntax');
assertMatch(mermaidOut, /n_ell1\(\["End"\]\)/, 'mermaid: ellipse uses ([]) syntax');
assertMatch(mermaidOut, /n_dia1\{"Check\?"\}/, 'mermaid: diamond uses {} syntax');

// Edges
assertMatch(mermaidOut, /n_rect1\s+-->\s+n_dia1/, 'mermaid: arrow1 rect->diamond');
assertMatch(mermaidOut, /n_dia1\s+-\.->\|"Yes"\|\s+n_ell1/, 'mermaid: dashed arrow2 with label "Yes"');

// Standalone text
assertIncludes(mermaidOut, 'A standalone note', 'mermaid: standalone text present');

// Styling section
assertMatch(mermaidOut, /style\s+n_rect1/, 'mermaid: style directive for rect');
assertIncludes(mermaidOut, 'fill:#a5d8ff', 'mermaid: rect fill color in style');

// Deleted elements excluded
assertNotIncludes(mermaidOut, 'rect_deleted', 'mermaid: deleted element excluded');

// Accepts object input
const mermaidOut2 = ExcMermaid.convertExcalidrawToMermaid(fixtureObj);
assert(typeof mermaidOut2 === 'string' && mermaidOut2.includes('flowchart'), 'mermaid: accepts object input');

// ═══════════════════════════════════════════════════════════════════════════════
// KLAXOON TESTS (vector SVG output)
// ═══════════════════════════════════════════════════════════════════════════════
section('Klaxoon converter (SVG)');

const klaxoonOut = ExcKlaxoon.convertExcalidrawToKlaxoon(fixture);

// Valid SVG
assert(typeof klaxoonOut === 'string', 'klaxoon: returns a string');
assertIncludes(klaxoonOut, '<svg', 'klaxoon: contains <svg');
assertIncludes(klaxoonOut, '</svg>', 'klaxoon: closes </svg>');
assertIncludes(klaxoonOut, 'xmlns="http://www.w3.org/2000/svg"', 'klaxoon: has SVG namespace');
assertIncludes(klaxoonOut, 'viewBox=', 'klaxoon: has viewBox');

// Shapes present
assertMatch(klaxoonOut, /<rect\s/, 'klaxoon: has rect elements');
assertMatch(klaxoonOut, /<ellipse\s/, 'klaxoon: has ellipse elements');
assertMatch(klaxoonOut, /<polygon\s/, 'klaxoon: has polygon (diamond)');

// Colors preserved
assertIncludes(klaxoonOut, '#a5d8ff', 'klaxoon: rect fill color preserved');
assertIncludes(klaxoonOut, '#b2f2bb', 'klaxoon: ellipse fill color preserved');
assertIncludes(klaxoonOut, '#ffec99', 'klaxoon: diamond fill color preserved');

// Stroke colors
assertIncludes(klaxoonOut, '#1e1e1e', 'klaxoon: stroke color preserved');

// Rounded rectangle
assertMatch(klaxoonOut, /rx="12"/, 'klaxoon: rounded rectangle has rx');

// Text rendered
assertIncludes(klaxoonOut, '>Start<', 'klaxoon: text "Start" rendered');
assertIncludes(klaxoonOut, '>End<', 'klaxoon: text "End" rendered');
assertIncludes(klaxoonOut, '>Check?<', 'klaxoon: text "Check?" rendered');

// Arrow markers
assertMatch(klaxoonOut, /<marker\s/, 'klaxoon: has arrow markers');
assertIncludes(klaxoonOut, 'marker-end="url(#arrowEnd)"', 'klaxoon: arrow has marker-end');
assertIncludes(klaxoonOut, 'arrowEnd', 'klaxoon: arrowEnd marker defined');

// Arrow with dashed stroke
assertMatch(klaxoonOut, /stroke-dasharray/, 'klaxoon: dashed line has dasharray');

// Edge label
assertIncludes(klaxoonOut, '>Yes<', 'klaxoon: edge label "Yes" rendered');

// Standalone text
assertIncludes(klaxoonOut, '>A standalone note<', 'klaxoon: standalone text rendered');

// Freedraw as path
assertMatch(klaxoonOut, /<path\s/, 'klaxoon: has path elements (freedraw/arrows)');

// Deleted elements excluded
assertNotIncludes(klaxoonOut, '999', 'klaxoon: deleted element excluded');

// Accepts object input
const klaxoonOut2 = ExcKlaxoon.convertExcalidrawToKlaxoon(fixtureObj);
assert(typeof klaxoonOut2 === 'string' && klaxoonOut2.includes('<svg'), 'klaxoon: accepts object input');

// ═══════════════════════════════════════════════════════════════════════════════
// PENPOT TESTS
// ═══════════════════════════════════════════════════════════════════════════════
section('Penpot converter');

const penpotOut = ExcPenpot.convertExcalidrawToPenpot(fixture);

// Valid JSON
let ppObj;
try {
  ppObj = JSON.parse(penpotOut);
  assert(true, 'penpot: output is valid JSON');
} catch (e) {
  assert(false, 'penpot: output is valid JSON - ' + e.message);
}

if (ppObj) {
  // Top-level preview structure
  assert(ppObj._info && ppObj._info.includes('penpot'), 'penpot: has _info preview note');
  assert(ppObj.manifest && ppObj.manifest.type === 'penpot/export-files', 'penpot: manifest type correct');
  assert(ppObj.manifest.version === 1, 'penpot: manifest version 1');
  assert(ppObj.file && ppObj.file.name === 'Excalidraw Import', 'penpot: file name set');
  assert(ppObj.file.version === 67, 'penpot: file version 67');
  assert(ppObj.file.isShared === false, 'penpot: camelCase isShared');
  assert(ppObj.page && ppObj.page.name === 'Page 1', 'penpot: page named "Page 1"');
  assert(ppObj.page.index === 0, 'penpot: page index 0');

  // Shapes are in a flat object map (id -> shape)
  const shapes = ppObj.shapes;
  assert(typeof shapes === 'object' && shapes !== null, 'penpot: has shapes map');
  const shapeList = Object.values(shapes);

  // Root frame (uuid zero)
  const rootFrame = shapes['00000000-0000-0000-0000-000000000000'];
  assert(!!rootFrame, 'penpot: has root frame at uuid zero');
  assert(rootFrame.type === 'frame', 'penpot: root frame type is frame');
  assert(rootFrame.parentId === '00000000-0000-0000-0000-000000000000', 'penpot: root frame self-referencing parentId');
  assert(Array.isArray(rootFrame.shapes) && rootFrame.shapes.length > 0, 'penpot: root frame has children');

  // User frame (child of root)
  const userFrame = shapeList.find(s => s.type === 'frame' && s.name === 'Frame 1');
  assert(!!userFrame, 'penpot: has user frame "Frame 1"');
  if (userFrame) {
    assert(Array.isArray(userFrame.shapes) && userFrame.shapes.length > 0, 'penpot: user frame has children');
    assert(userFrame.parentId === '00000000-0000-0000-0000-000000000000', 'penpot: user frame parent is root');
  }

  // Rectangle shape
  const rectShape = shapeList.find(s => s.type === 'rect' && s.name && s.name.startsWith('rectangle_'));
  assert(!!rectShape, 'penpot: rectangle shape present');
  if (rectShape) {
    assert(rectShape.x === 100, 'penpot: rect x=100');
    assert(rectShape.y === 50, 'penpot: rect y=50');
    assert(rectShape.width === 200, 'penpot: rect width=200');
    assert(rectShape.height === 100, 'penpot: rect height=100');
    assert(rectShape.r1 === 12, 'penpot: rounded rect has r1');
    assert(rectShape.fills && rectShape.fills.length > 0, 'penpot: rect has fills');
    assert(rectShape.fills[0].fillColor === '#a5d8ff', 'penpot: rect fill color (camelCase)');
    assert(rectShape.strokes && rectShape.strokes.length > 0, 'penpot: rect has strokes');
    assert(rectShape.strokes[0].strokeColor === '#1e1e1e', 'penpot: rect stroke color (camelCase)');
    // Geometry fields
    assert(rectShape.selrect && rectShape.selrect.x1 === 100, 'penpot: rect has selrect');
    assert(Array.isArray(rectShape.points) && rectShape.points.length === 4, 'penpot: rect has 4 corner points');
    assert(rectShape.transform && rectShape.transform.a === 1, 'penpot: rect has identity transform');
    assert(rectShape.transformInverse, 'penpot: rect has transformInverse (camelCase)');
    assert(rectShape.parentId, 'penpot: rect has parentId (camelCase)');
    assert(rectShape.frameId, 'penpot: rect has frameId (camelCase)');
    // Bound text is stored directly on the shape (not as child — avoids Penpot stack overflow)
    assert(rectShape.content && rectShape.content.type === 'root', 'penpot: rect has text content directly');
    assert(rectShape.growType === 'fixed', 'penpot: rect with text has growType fixed');
  }

  // Ellipse shape (Penpot calls it "circle")
  const ellShape = shapeList.find(s => s.type === 'circle');
  assert(!!ellShape, 'penpot: ellipse mapped to circle type');

  // Diamond as path
  const diaShape = shapeList.find(s => s.type === 'path' && s.name && s.name.startsWith('diamond_'));
  assert(!!diaShape, 'penpot: diamond as path');
  if (diaShape) {
    assert(Array.isArray(diaShape.content) && diaShape.content.length > 0, 'penpot: diamond has path content');
  }

  // Arrows as paths
  const arrowPaths = shapeList.filter(s => s.type === 'path' && s.name && s.name.startsWith('arrow_'));
  assert(arrowPaths.length >= 2, `penpot: at least 2 arrow paths (got ${arrowPaths.length})`);

  // Arrow stroke caps (arrowheads)
  const arrowWithCap = arrowPaths.find(p => p.strokes && p.strokes[0] && p.strokes[0].strokeCapEnd);
  assert(!!arrowWithCap, 'penpot: arrow has strokeCapEnd');

  // Edge label as sibling text shape (not child of arrow)
  const labelTexts = shapeList.filter(s => s.type === 'text' && s.name && s.name.startsWith('label_'));
  assert(labelTexts.length > 0, 'penpot: edge label exists as sibling text');
  if (labelTexts.length > 0) {
    assert(labelTexts[0].parentId === userFrame.id, 'penpot: edge label parent is frame, not arrow');
  }

  // Standalone text
  const standaloneTexts = shapeList.filter(s => s.type === 'text' && s.content &&
    s.content.children && s.content.children[0] &&
    s.content.children[0].children.some(p =>
      p.children && p.children.some(c => c.text === 'A standalone note')));
  assert(standaloneTexts.length > 0, 'penpot: standalone text present');

  // Freedraw as path
  const fdPath = shapeList.find(s => s.type === 'path' && s.name && s.name.startsWith('freedraw_'));
  assert(!!fdPath, 'penpot: freedraw as path');
  if (fdPath) {
    assert(Array.isArray(fdPath.content) && fdPath.content.length > 0, 'penpot: freedraw has path content');
  }

  // Deleted elements excluded
  const allNames = shapeList.map(s => s.name || '').join(' ');
  assertNotIncludes(allNames, 'rect_deleted', 'penpot: deleted element excluded');

  // Manifest has file ID matching file data
  assert(ppObj.manifest.files[0].id === ppObj.file.id, 'penpot: manifest file ID matches file data ID');
  assert(Array.isArray(ppObj.manifest.files[0].features), 'penpot: manifest includes features');
}

// Accepts object input
const penpotOut2 = ExcPenpot.convertExcalidrawToPenpot(fixtureObj);
let ppObj2;
try { ppObj2 = JSON.parse(penpotOut2); } catch {}
assert(ppObj2 && ppObj2.manifest && ppObj2.manifest.type === 'penpot/export-files', 'penpot: accepts object input');

// ═══════════════════════════════════════════════════════════════════════════════
// EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════
section('Edge cases');

// Empty elements
const emptyInput = JSON.stringify({ type: 'excalidraw', version: 2, elements: [], files: {} });
assert(typeof ExcDrawio.convertExcalidrawToDrawio(emptyInput) === 'string', 'edge: drawio handles empty elements');
assert(typeof ExcMermaid.convertExcalidrawToMermaid(emptyInput) === 'string', 'edge: mermaid handles empty elements');
assert(typeof ExcKlaxoon.convertExcalidrawToKlaxoon(emptyInput) === 'string', 'edge: klaxoon handles empty elements');
assert(typeof ExcPenpot.convertExcalidrawToPenpot(emptyInput) === 'string', 'edge: penpot handles empty elements');

// Missing optional fields
const minimalRect = JSON.stringify({
  type: 'excalidraw', version: 2,
  elements: [{ type: 'rectangle', id: 'mr1', x: 0, y: 0, width: 100, height: 50 }],
  files: {}
});
assert(typeof ExcDrawio.convertExcalidrawToDrawio(minimalRect) === 'string', 'edge: drawio handles minimal element');
assert(typeof ExcMermaid.convertExcalidrawToMermaid(minimalRect) === 'string', 'edge: mermaid handles minimal element');
assert(typeof ExcKlaxoon.convertExcalidrawToKlaxoon(minimalRect) === 'string', 'edge: klaxoon handles minimal element');
assert(typeof ExcPenpot.convertExcalidrawToPenpot(minimalRect) === 'string', 'edge: penpot handles minimal element');

// Negative coordinates
const negCoords = JSON.stringify({
  type: 'excalidraw', version: 2,
  elements: [
    { type: 'rectangle', id: 'neg1', x: -200, y: -100, width: 80, height: 40, strokeColor: '#000' },
    { type: 'text', id: 'neg_txt', x: -190, y: -90, width: 60, height: 20, text: 'Neg', fontSize: 14 }
  ],
  files: {}
});
const negDrawio = ExcDrawio.convertExcalidrawToDrawio(negCoords);
// Drawio converter shifts coordinates to positive quadrant
assertNotIncludes(negDrawio, 'x="-', 'edge: drawio no negative x in geometry');
assert(typeof ExcMermaid.convertExcalidrawToMermaid(negCoords) === 'string', 'edge: mermaid handles negative coords');
assert(typeof ExcKlaxoon.convertExcalidrawToKlaxoon(negCoords) === 'string', 'edge: klaxoon handles negative coords');
assert(typeof ExcPenpot.convertExcalidrawToPenpot(negCoords) === 'string', 'edge: penpot handles negative coords');

// Special characters in text
const specialText = JSON.stringify({
  type: 'excalidraw', version: 2,
  elements: [
    { type: 'text', id: 'sp1', x: 0, y: 0, width: 200, height: 30, text: 'Hello <world> & "friends"', fontSize: 16, strokeColor: '#000' }
  ],
  files: {}
});
const spDrawio = ExcDrawio.convertExcalidrawToDrawio(specialText);
assertNotIncludes(spDrawio, '<world>', 'edge: drawio escapes < > in text');
// Value is double-encoded: encodeXml in buildPlainTextValue then again in the attribute
assertMatch(spDrawio, /&amp;lt;world&amp;gt;/, 'edge: drawio XML-escapes text in attribute');

const spMermaid = ExcMermaid.convertExcalidrawToMermaid(specialText);
assert(typeof spMermaid === 'string', 'edge: mermaid handles special chars');

// ═══════════════════════════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(65)}`);
if (failed === 0) {
  console.log(`ALL ${passed} TESTS PASSED`);
} else {
  console.log(`${passed} passed, ${failed} FAILED:`);
  for (const f of failures) console.log(`  - ${f}`);
}
console.log('═'.repeat(65));

process.exit(failed > 0 ? 1 : 0);

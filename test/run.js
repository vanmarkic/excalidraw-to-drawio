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
// KLAXOON TESTS
// ═══════════════════════════════════════════════════════════════════════════════
section('Klaxoon converter');

const klaxoonOut = ExcKlaxoon.convertExcalidrawToKlaxoon(fixture);

// Valid JSON
let klaxObj;
try {
  klaxObj = JSON.parse(klaxoonOut);
  assert(true, 'klaxoon: output is valid JSON');
} catch (e) {
  assert(false, 'klaxoon: output is valid JSON - ' + e.message);
}

if (klaxObj) {
  // Top-level structure
  assert(klaxObj.type === 'klaxoon-board', 'klaxoon: type is klaxoon-board');
  assert(klaxObj.metadata && klaxObj.metadata.source === 'excalidraw-converter', 'klaxoon: metadata.source set');
  assert(Array.isArray(klaxObj.items), 'klaxoon: has items array');
  assert(Array.isArray(klaxObj.connectors), 'klaxoon: has connectors array');

  // Items count: rect1, ell1, dia1, fd1 (shapes) + txt_standalone (standalone text) = 5
  // deleted element and container texts should not be separate items
  const cards = klaxObj.items.filter(i => i.type === 'card');
  assert(cards.length === 3, `klaxoon: 3 card items (got ${cards.length})`);

  // Shape types
  const rectCard = klaxObj.items.find(i => i.shape === 'rectangle' && i.content === 'Start');
  assert(!!rectCard, 'klaxoon: rectangle card with content "Start"');
  const ellCard = klaxObj.items.find(i => i.shape === 'ellipse' && i.content === 'End');
  assert(!!ellCard, 'klaxoon: ellipse card with content "End"');
  const diaCard = klaxObj.items.find(i => i.shape === 'diamond' && i.content === 'Check?');
  assert(!!diaCard, 'klaxoon: diamond card with content "Check?"');

  // Positions preserved
  if (rectCard) {
    assert(rectCard.position.x === 100, 'klaxoon: rect x=100');
    assert(rectCard.position.y === 50, 'klaxoon: rect y=50');
    assert(rectCard.size.width === 200, 'klaxoon: rect width=200');
  }

  // Styling
  if (rectCard) {
    assert(rectCard.style.backgroundColor === '#a5d8ff', 'klaxoon: rect backgroundColor');
    assert(rectCard.style.borderColor === '#1e1e1e', 'klaxoon: rect borderColor');
    assert(rectCard.style.borderWidth === 2, 'klaxoon: rect borderWidth');
  }

  // Standalone text
  const standaloneText = klaxObj.items.find(i => i.type === 'text' && i.content === 'A standalone note');
  assert(!!standaloneText, 'klaxoon: standalone text item present');

  // Connectors
  assert(klaxObj.connectors.length >= 2, `klaxoon: at least 2 connectors (got ${klaxObj.connectors.length})`);

  // Arrow with label
  const labeledConn = klaxObj.connectors.find(c => c.label === 'Yes');
  assert(!!labeledConn, 'klaxoon: connector with label "Yes"');
  if (labeledConn) {
    assert(labeledConn.style.strokeStyle === 'dashed', 'klaxoon: dashed connector');
    assert(labeledConn.style.endArrow === 'arrow', 'klaxoon: end arrow type');
  }

  // Connectors have source/target bindings
  const boundConn = klaxObj.connectors.find(c => c.sourceId && c.targetId);
  assert(!!boundConn, 'klaxoon: at least one connector has sourceId + targetId');

  // Deleted elements excluded
  const deletedItem = klaxObj.items.find(i => i.position && i.position.x === 999);
  assert(!deletedItem, 'klaxoon: deleted element excluded');
}

// Accepts object input
const klaxoonOut2 = ExcKlaxoon.convertExcalidrawToKlaxoon(fixtureObj);
let klaxObj2;
try { klaxObj2 = JSON.parse(klaxoonOut2); } catch {}
assert(klaxObj2 && klaxObj2.type === 'klaxoon-board', 'klaxoon: accepts object input');

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
  // Top-level structure
  assert(ppObj.type === 'penpot-file', 'penpot: type is penpot-file');
  assert(ppObj.version === '2.0', 'penpot: version 2.0');
  assert(Array.isArray(ppObj.pages) && ppObj.pages.length === 1, 'penpot: has 1 page');

  const page = ppObj.pages[0];
  assert(page.name === 'Page 1', 'penpot: page named "Page 1"');
  assert(page.options && page.options.background === '#ffffff', 'penpot: page background from appState');
  assert(Array.isArray(page.objects) && page.objects.length > 0, 'penpot: has objects');

  // Root frame
  const frame = page.objects.find(o => o.type === 'frame');
  assert(!!frame, 'penpot: has root frame');
  if (frame) {
    assert(Array.isArray(frame.children) && frame.children.length > 0, 'penpot: frame has children');
  }

  // Rectangle shape
  const rectShape = page.objects.find(o => o.type === 'rect' && o.name && o.name.startsWith('rectangle_'));
  assert(!!rectShape, 'penpot: rectangle shape present');
  if (rectShape) {
    assert(rectShape.x === 100, 'penpot: rect x=100');
    assert(rectShape.y === 50, 'penpot: rect y=50');
    assert(rectShape.width === 200, 'penpot: rect width=200');
    assert(rectShape.height === 100, 'penpot: rect height=100');
    assert(rectShape.rx === 12, 'penpot: rounded rect has rx');
    assert(rectShape.fills && rectShape.fills.length > 0, 'penpot: rect has fills');
    assert(rectShape.fills[0].fillColor === '#a5d8ff', 'penpot: rect fill color');
    assert(rectShape.strokes && rectShape.strokes.length > 0, 'penpot: rect has strokes');
    assert(rectShape.strokes[0].strokeColor === '#1e1e1e', 'penpot: rect stroke color');
    // Text attached
    assert(rectShape.text && rectShape.text.content === 'Start', 'penpot: rect has text "Start"');
  }

  // Ellipse shape (Penpot calls it "circle")
  const ellShape = page.objects.find(o => o.type === 'circle');
  assert(!!ellShape, 'penpot: ellipse mapped to circle type');
  if (ellShape) {
    assert(ellShape.text && ellShape.text.content === 'End', 'penpot: ellipse has text "End"');
  }

  // Diamond as path
  const diaShape = page.objects.find(o => o.type === 'path' && o.name && o.name.startsWith('diamond_'));
  // Diamond may exist as a path or rect depending on implementation
  // The converter should create it as a path with svgPath
  if (diaShape) {
    assert(!!diaShape.svgPath, 'penpot: diamond has svgPath');
    assert(diaShape.text && diaShape.text.content === 'Check?', 'penpot: diamond has text "Check?"');
  }

  // Arrow as path
  const arrowPaths = page.objects.filter(o => o.type === 'path' && o.name && o.name.startsWith('arrow_'));
  assert(arrowPaths.length >= 2, `penpot: at least 2 arrow paths (got ${arrowPaths.length})`);

  // Arrow markers
  const arrowWithMarker = arrowPaths.find(p => p.markers && p.markers.end);
  assert(!!arrowWithMarker, 'penpot: arrow has end marker');

  // Arrow bindings
  const arrowWithBinding = arrowPaths.find(p => p.startBinding && p.endBinding);
  assert(!!arrowWithBinding, 'penpot: arrow preserves bindings');

  // Edge label
  const arrowWithLabel = arrowPaths.find(p => p.text && p.text.content === 'Yes');
  assert(!!arrowWithLabel, 'penpot: arrow with label "Yes"');

  // Standalone text
  const standaloneText = page.objects.find(o => o.type === 'text' && o.text && o.text.content === 'A standalone note');
  assert(!!standaloneText, 'penpot: standalone text present');

  // Freedraw as path
  const fdPath = page.objects.find(o => o.type === 'path' && o.name && o.name.startsWith('freedraw_'));
  assert(!!fdPath, 'penpot: freedraw as path');
  if (fdPath) {
    assert(!!fdPath.svgPath, 'penpot: freedraw has svgPath');
  }

  // Deleted elements excluded
  const allNames = page.objects.map(o => o.name || '').join(' ');
  assertNotIncludes(allNames, 'rect_deleted', 'penpot: deleted element excluded');
}

// Accepts object input
const penpotOut2 = ExcPenpot.convertExcalidrawToPenpot(fixtureObj);
let ppObj2;
try { ppObj2 = JSON.parse(penpotOut2); } catch {}
assert(ppObj2 && ppObj2.type === 'penpot-file', 'penpot: accepts object input');

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

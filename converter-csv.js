// Excalidraw -> CSV / Excel (.xlsx) converter
//
// Flattens an Excalidraw scene into a tabular representation suitable for
// cyclical, many-to-many diagrams. Produces the following tabs/files:
//
//   Nodes       — one row per shape (or standalone text) with geometry & degrees
//   Edges       — one row per arrow/line with source, target, label, style
//   Adjacency   — N x N directed matrix of edge counts between nodes
//   Summary     — node/edge counts, cycle detection, isolated nodes
//
// Produces three outputs:
//   - A plaintext preview (multi-section CSV) for the on-page textarea
//   - A ZIP of separate CSV files (one per tab) for the "CSV" download
//   - A real .xlsx workbook (OOXML) for the "Excel" download
//
// Requires JSZip (loaded via <script> in index.html).

(function(global){
  'use strict';

  // Workshop semantics: colours encode personas, stroke width + style encode
  // rank (1 = most important), freedraw scribbles are dot votes (grouped via
  // groupIds or bounded inside the target sticky).
  var PERSONA_BY_COLOR = {
    '#ffec99': 'Yellow',
    '#ffc9c9': 'Pink'
  };

  function personaFromColor(bg){
    if(!bg) return '';
    return PERSONA_BY_COLOR[String(bg).toLowerCase()] || '';
  }

  function rankFromStroke(sw, ss){
    // fat (4) -> 1, medium (2) -> 2, normal (1) solid/dashed/dotted -> 3/4/5
    if(sw === 4) return 1;
    if(sw === 2) return 2;
    if(sw === 1){
      if(ss === 'dotted') return 5;
      if(ss === 'dashed') return 4;
      return 3;
    }
    return '';
  }

  function shareGroup(a, b){
    if(!a || !b) return false;
    for(var i = 0; i < a.length; i++) if(b.indexOf(a[i]) >= 0) return true;
    return false;
  }

  function rectArea(r){ return (r.width || 0) * (r.height || 0); }

  function centroidInside(fd, r){
    var cx = (fd.x || 0) + (fd.width || 0) / 2;
    var cy = (fd.y || 0) + (fd.height || 0) / 2;
    return cx >= r.x && cx <= r.x + r.width &&
           cy >= r.y && cy <= r.y + r.height;
  }

  function assignVotes(rectangles, freedraws){
    // Returns array of { freedrawId, targetId, method } and fills votes[rectId].
    var votes = {};
    var assignments = [];
    for(var i = 0; i < rectangles.length; i++) votes[rectangles[i].id] = 0;

    for(var f = 0; f < freedraws.length; f++){
      var fd = freedraws[f];
      var target = null, method = null;

      // Prefer shared groupId match
      for(var g = 0; g < rectangles.length; g++){
        if(shareGroup(fd.groupIds, rectangles[g].groupIds)){
          target = rectangles[g]; method = 'group'; break;
        }
      }
      // Fallback: centroid inside the smallest containing rectangle
      if(!target){
        var smallest = null;
        for(var b = 0; b < rectangles.length; b++){
          if(!centroidInside(fd, rectangles[b])) continue;
          if(!smallest || rectArea(rectangles[b]) < rectArea(smallest)) smallest = rectangles[b];
        }
        if(smallest){ target = smallest; method = 'bounds'; }
      }

      if(target){
        votes[target.id]++;
        assignments.push({ freedrawId: fd.id, targetId: target.id, method: method });
      }
    }
    return { votes: votes, assignments: assignments };
  }

  // ── Graph extraction ───────────────────────────────────────────────────────

  function extractGraph(excalidata){
    var data = (typeof excalidata === 'string') ? JSON.parse(excalidata) : excalidata;
    var elements = (data.elements || []).filter(function(e){ return !e.isDeleted; });

    var byId = {};
    for(var i = 0; i < elements.length; i++) byId[elements[i].id] = elements[i];

    // Sticky-producing shape types (rectangle/ellipse/diamond/image). Freedraws
    // are treated as votes, not as nodes.
    var stickyTypes = ['rectangle','ellipse','diamond','image'];
    var shapes = elements.filter(function(e){ return stickyTypes.indexOf(e.type) >= 0; });
    var freedraws = elements.filter(function(e){ return e.type === 'freedraw'; });
    var edges  = elements.filter(function(e){ return e.type === 'arrow' || e.type === 'line'; });
    var texts  = elements.filter(function(e){ return e.type === 'text'; });

    // Text bound to a shape becomes that shape's label
    var shapeLabel = {};
    var edgeLabel  = {};
    for(var j = 0; j < texts.length; j++){
      var t = texts[j];
      if(t.containerId && byId[t.containerId]){
        var c = byId[t.containerId];
        if(c.type === 'arrow' || c.type === 'line') edgeLabel[t.containerId] = t.text || '';
        else shapeLabel[t.containerId] = t.text || '';
      }
    }

    // Standalone text becomes its own "node" so it isn't silently dropped
    var standaloneTexts = texts.filter(function(t){ return !t.containerId; });

    // Assign freedraw votes to rectangles (prefer groupId, fall back to bounds)
    var voteResult = assignVotes(shapes, freedraws);

    // Build node list
    var nodes = [];
    for(var k = 0; k < shapes.length; k++){
      var s = shapes[k];
      nodes.push({
        id: s.id,
        label: shapeLabel[s.id] || '',
        kind: 'shape',
        type: s.type,
        persona: personaFromColor(s.backgroundColor),
        rank: rankFromStroke(s.strokeWidth, s.strokeStyle),
        votes: voteResult.votes[s.id] || 0,
        groupIds: (s.groupIds || []).join('|'),
        x: s.x, y: s.y, width: s.width, height: s.height,
        backgroundColor: s.backgroundColor || '',
        strokeColor: s.strokeColor || '',
        strokeWidth: s.strokeWidth || 1,
        strokeStyle: s.strokeStyle || 'solid',
        opacity: typeof s.opacity === 'number' ? s.opacity : 100,
        angle: s.angle || 0,
        inDegree: 0,
        outDegree: 0
      });
    }
    for(var m = 0; m < standaloneTexts.length; m++){
      var st = standaloneTexts[m];
      nodes.push({
        id: st.id,
        label: st.text || '',
        kind: 'text',
        type: 'text',
        persona: '',
        rank: '',
        votes: 0,
        groupIds: (st.groupIds || []).join('|'),
        x: st.x, y: st.y, width: st.width, height: st.height,
        backgroundColor: '',
        strokeColor: st.strokeColor || '',
        strokeWidth: 0,
        strokeStyle: '',
        opacity: typeof st.opacity === 'number' ? st.opacity : 100,
        angle: st.angle || 0,
        inDegree: 0,
        outDegree: 0
      });
    }

    var nodeIndex = {};
    for(var n = 0; n < nodes.length; n++) nodeIndex[nodes[n].id] = n;

    // Build edge list from arrow/line bindings
    var edgeRows = [];
    for(var p = 0; p < edges.length; p++){
      var e = edges[p];
      var startId = e.startBinding && e.startBinding.elementId;
      var endId   = e.endBinding && e.endBinding.elementId;
      if(!startId || !endId) continue;
      if(!(startId in nodeIndex) || !(endId in nodeIndex)) continue;

      var hasStart = e.startArrowhead && e.startArrowhead !== 'none';
      var hasEnd   = (e.endArrowhead && e.endArrowhead !== 'none') || e.type === 'arrow';
      var directed = hasStart || hasEnd;
      var bidirectional = hasStart && hasEnd;

      edgeRows.push({
        id: e.id,
        source: startId,
        sourceLabel: nodes[nodeIndex[startId]].label,
        target: endId,
        targetLabel: nodes[nodeIndex[endId]].label,
        label: edgeLabel[e.id] || '',
        type: e.type,
        strokeStyle: e.strokeStyle || 'solid',
        strokeColor: e.strokeColor || '',
        strokeWidth: e.strokeWidth || 1,
        startArrowhead: e.startArrowhead || '',
        endArrowhead: e.endArrowhead || (e.type === 'arrow' ? 'arrow' : ''),
        directed: directed,
        bidirectional: bidirectional
      });

      nodes[nodeIndex[startId]].outDegree++;
      nodes[nodeIndex[endId]].inDegree++;
      if(bidirectional){
        nodes[nodeIndex[startId]].inDegree++;
        nodes[nodeIndex[endId]].outDegree++;
      }
    }

    return {
      nodes: nodes,
      edges: edgeRows,
      nodeIndex: nodeIndex,
      voteAssignments: voteResult.assignments
    };
  }

  // ── Adjacency matrix & cycle detection ─────────────────────────────────────

  function buildAdjacency(graph){
    var n = graph.nodes.length;
    var matrix = [];
    for(var i = 0; i < n; i++){
      var row = new Array(n);
      for(var j = 0; j < n; j++) row[j] = 0;
      matrix.push(row);
    }
    for(var k = 0; k < graph.edges.length; k++){
      var e = graph.edges[k];
      var si = graph.nodeIndex[e.source];
      var ti = graph.nodeIndex[e.target];
      if(si === undefined || ti === undefined) continue;
      matrix[si][ti] += 1;
      if(e.bidirectional) matrix[ti][si] += 1;
      // Undirected lines: also fill the reverse cell so adjacency reflects reachability
      else if(!e.directed) matrix[ti][si] += 1;
    }
    return matrix;
  }

  function detectCycles(graph){
    // DFS-based detection; reports whether any cycle exists and node ids on cycles.
    var n = graph.nodes.length;
    var adj = [];
    for(var i = 0; i < n; i++) adj.push([]);
    for(var k = 0; k < graph.edges.length; k++){
      var e = graph.edges[k];
      var si = graph.nodeIndex[e.source];
      var ti = graph.nodeIndex[e.target];
      if(si === undefined || ti === undefined) continue;
      adj[si].push(ti);
      if(e.bidirectional) adj[ti].push(si);
    }
    var WHITE = 0, GRAY = 1, BLACK = 2;
    var color = new Array(n); for(var c = 0; c < n; c++) color[c] = WHITE;
    var onCycle = new Array(n); for(var d = 0; d < n; d++) onCycle[d] = false;
    var cycleCount = 0;

    function dfs(u, stack){
      color[u] = GRAY;
      stack.push(u);
      for(var x = 0; x < adj[u].length; x++){
        var v = adj[u][x];
        if(color[v] === GRAY){
          cycleCount++;
          var idx = stack.indexOf(v);
          for(var y = idx; y < stack.length; y++) onCycle[stack[y]] = true;
        } else if(color[v] === WHITE){
          dfs(v, stack);
        }
      }
      stack.pop();
      color[u] = BLACK;
    }

    for(var s = 0; s < n; s++) if(color[s] === WHITE) dfs(s, []);

    var cycleNodeIds = [];
    for(var z = 0; z < n; z++) if(onCycle[z]) cycleNodeIds.push(graph.nodes[z].id);
    return { hasCycle: cycleCount > 0, cycleEdgeCount: cycleCount, nodesOnCycles: cycleNodeIds };
  }

  // ── Sheet builders (returns { name, headers, rows }) ───────────────────────

  function buildSheets(excalidata){
    var graph = extractGraph(excalidata);
    var matrix = buildAdjacency(graph);
    var cycles = detectCycles(graph);

    var nodesSheet = {
      name: 'Nodes',
      headers: ['id','label','persona','rank','votes','kind','type',
                'groupIds','x','y','width','height',
                'backgroundColor','strokeColor','strokeWidth','strokeStyle',
                'opacity','angle','inDegree','outDegree'],
      rows: graph.nodes.map(function(n){
        return [n.id, n.label, n.persona, n.rank, n.votes, n.kind, n.type,
                n.groupIds, n.x, n.y, n.width, n.height,
                n.backgroundColor, n.strokeColor, n.strokeWidth, n.strokeStyle,
                n.opacity, n.angle, n.inDegree, n.outDegree];
      })
    };

    var edgesSheet = {
      name: 'Edges',
      headers: ['id','source','sourceLabel','target','targetLabel','label',
                'type','strokeStyle','strokeColor','strokeWidth',
                'startArrowhead','endArrowhead','directed','bidirectional'],
      rows: graph.edges.map(function(e){
        return [e.id, e.source, e.sourceLabel, e.target, e.targetLabel, e.label,
                e.type, e.strokeStyle, e.strokeColor, e.strokeWidth,
                e.startArrowhead, e.endArrowhead, e.directed, e.bidirectional];
      })
    };

    // Adjacency matrix with node labels as row/column headers
    var adjHeaders = ['from \\ to'].concat(graph.nodes.map(function(n){
      return n.label ? (n.label + ' [' + n.id + ']') : n.id;
    }));
    var adjRows = [];
    for(var r = 0; r < graph.nodes.length; r++){
      var row = [graph.nodes[r].label ? (graph.nodes[r].label + ' [' + graph.nodes[r].id + ']') : graph.nodes[r].id];
      for(var cc = 0; cc < graph.nodes.length; cc++) row.push(matrix[r][cc]);
      adjRows.push(row);
    }
    var adjSheet = { name: 'Adjacency', headers: adjHeaders, rows: adjRows };

    var isolated = graph.nodes.filter(function(n){
      return n.inDegree === 0 && n.outDegree === 0;
    }).map(function(n){ return n.id; });

    var nodeLabelById = {};
    for(var nl = 0; nl < graph.nodes.length; nl++){
      nodeLabelById[graph.nodes[nl].id] = graph.nodes[nl].label;
    }
    var votesSheet = {
      name: 'Votes',
      headers: ['freedrawId','targetId','targetLabel','method'],
      rows: (graph.voteAssignments || []).map(function(v){
        return [v.freedrawId, v.targetId, nodeLabelById[v.targetId] || '', v.method];
      })
    };

    var personaCounts = {};
    var rankCounts = {};
    var totalVotes = 0;
    for(var pc = 0; pc < graph.nodes.length; pc++){
      var nn = graph.nodes[pc];
      if(nn.persona) personaCounts[nn.persona] = (personaCounts[nn.persona] || 0) + 1;
      if(nn.rank !== '' && nn.rank != null) rankCounts['rank' + nn.rank] = (rankCounts['rank' + nn.rank] || 0) + 1;
      totalVotes += nn.votes || 0;
    }

    var summaryRows = [
      ['nodeCount', graph.nodes.length],
      ['edgeCount', graph.edges.length],
      ['totalVotes', totalVotes],
      ['hasCycle', cycles.hasCycle],
      ['cycleBackEdges', cycles.cycleEdgeCount],
      ['nodesOnCycles', cycles.nodesOnCycles.join('; ')],
      ['isolatedNodes', isolated.join('; ')]
    ];
    Object.keys(personaCounts).sort().forEach(function(p){
      summaryRows.push(['persona:' + p, personaCounts[p]]);
    });
    Object.keys(rankCounts).sort().forEach(function(r){
      summaryRows.push([r, rankCounts[r]]);
    });

    var summarySheet = { name: 'Summary', headers: ['metric','value'], rows: summaryRows };

    return [nodesSheet, edgesSheet, adjSheet, votesSheet, summarySheet];
  }

  // ── CSV helpers ────────────────────────────────────────────────────────────

  function csvCell(v){
    if(v === null || v === undefined) return '';
    var s = String(v);
    if(/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function sheetToCsv(sheet){
    var lines = [sheet.headers.map(csvCell).join(',')];
    for(var i = 0; i < sheet.rows.length; i++){
      lines.push(sheet.rows[i].map(csvCell).join(','));
    }
    return lines.join('\r\n');
  }

  function convertToPreview(excalidata){
    var sheets = buildSheets(excalidata);
    var parts = [];
    for(var i = 0; i < sheets.length; i++){
      parts.push('### ' + sheets[i].name + ' ###');
      parts.push(sheetToCsv(sheets[i]));
      parts.push('');
    }
    return parts.join('\r\n');
  }

  async function convertToCsvZipBlob(excalidata){
    if(typeof JSZip === 'undefined') throw new Error('JSZip is required for CSV ZIP generation');
    var sheets = buildSheets(excalidata);
    var zip = new JSZip();
    for(var i = 0; i < sheets.length; i++){
      zip.file(sheets[i].name + '.csv', sheetToCsv(sheets[i]));
    }
    return zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  }

  // ── XLSX (OOXML) helpers ───────────────────────────────────────────────────

  function xmlEscape(s){
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function colLetter(n){
    // 1 -> A, 27 -> AA
    var s = '';
    while(n > 0){
      var r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function isNumericCell(v){
    if(typeof v === 'number' && isFinite(v)) return true;
    if(typeof v === 'boolean') return false;
    return false;
  }

  function cellXml(value, colIdx, rowIdx){
    var ref = colLetter(colIdx) + rowIdx;
    if(value === null || value === undefined || value === '') return '';
    if(typeof value === 'boolean'){
      return '<c r="' + ref + '" t="b"><v>' + (value ? 1 : 0) + '</v></c>';
    }
    if(isNumericCell(value)){
      return '<c r="' + ref + '"><v>' + value + '</v></c>';
    }
    return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' +
           xmlEscape(value) + '</t></is></c>';
  }

  function buildSheetXml(sheet){
    var rowsXml = [];
    // Header row
    var headerCells = [];
    for(var i = 0; i < sheet.headers.length; i++){
      headerCells.push(cellXml(sheet.headers[i], i + 1, 1));
    }
    rowsXml.push('<row r="1">' + headerCells.join('') + '</row>');

    for(var r = 0; r < sheet.rows.length; r++){
      var rowNum = r + 2;
      var cells = [];
      for(var c = 0; c < sheet.rows[r].length; c++){
        var v = sheet.rows[r][c];
        var cx = cellXml(v, c + 1, rowNum);
        if(cx) cells.push(cx);
      }
      rowsXml.push('<row r="' + rowNum + '">' + cells.join('') + '</row>');
    }

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
           '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
           '<sheetData>' + rowsXml.join('') + '</sheetData>' +
           '</worksheet>';
  }

  function sanitizeSheetName(name){
    // Excel sheet names: max 31 chars, cannot contain : \ / ? * [ ]
    return String(name).replace(/[:\\\/\?\*\[\]]/g, '_').slice(0, 31) || 'Sheet';
  }

  async function convertToXlsxBlob(excalidata){
    if(typeof JSZip === 'undefined') throw new Error('JSZip is required for XLSX generation');
    var sheets = buildSheets(excalidata);
    var zip = new JSZip();

    zip.file('[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map(function(_, i){
        return '<Override PartName="/xl/worksheets/sheet' + (i + 1) +
               '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      }).join('') +
      '</Types>');

    zip.file('_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>');

    zip.file('xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' +
      sheets.map(function(s, i){
        return '<sheet name="' + xmlEscape(sanitizeSheetName(s.name)) +
               '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      }).join('') +
      '</sheets></workbook>');

    zip.file('xl/_rels/workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function(_, i){
        return '<Relationship Id="rId' + (i + 1) +
               '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"' +
               ' Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      }).join('') +
      '</Relationships>');

    for(var i = 0; i < sheets.length; i++){
      zip.file('xl/worksheets/sheet' + (i + 1) + '.xml', buildSheetXml(sheets[i]));
    }

    return zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  global.ExcTabular = {
    convertExcalidrawToTabular: convertToPreview,
    convertExcalidrawToCsvZipBlob: convertToCsvZipBlob,
    convertExcalidrawToXlsxBlob: convertToXlsxBlob,
    _extractGraph: extractGraph,
    _buildSheets: buildSheets,
    _sheetToCsv: sheetToCsv
  };
})(typeof window !== 'undefined' ? window : globalThis);

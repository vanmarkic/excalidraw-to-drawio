// Excalidraw -> Penpot (.penpot) converter
// Produces a real .penpot file (ZIP archive) matching the structure from
// Penpot's library/src/lib/export.cljs and backend/src/app/binfile/v3.clj:
//
//   manifest.json                                        — file list & version
//   files/{fileId}.json                                  — file metadata
//   files/{fileId}/pages/{pageId}.json                   — page metadata
//   files/{fileId}/pages/{pageId}/{shapeId}.json         — one JSON per shape
//
// All JSON keys are camelCase (Penpot's Clojure kebab-case is converted via
// cuerdas/camel on export). Shape types and fields match:
//   common/src/app/common/types/shape.cljc
//
// Requires JSZip (loaded via CDN in index.html).

(function(global){
  'use strict';

  var ROOT_UUID = '00000000-0000-0000-0000-000000000000';
  var IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

  function uuid(){
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){
      var r = Math.random()*16|0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function mapColor(c){
    if(!c || c === 'transparent') return null;
    return c;
  }

  function mapShapeType(elType){
    switch(elType){
      case 'rectangle': return 'rect';
      case 'ellipse':   return 'circle';
      case 'diamond':   return 'path';
      case 'freedraw':  return 'path';
      case 'image':     return 'image';
      case 'text':      return 'text';
      case 'arrow':
      case 'line':      return 'path';
      default:          return 'rect';
    }
  }

  function buildFills(el){
    var bg = mapColor(el.backgroundColor);
    if(!bg) return [];
    return [{ fillColor: bg, fillOpacity: typeof el.opacity === 'number' ? el.opacity / 100 : 1 }];
  }

  function buildStrokes(el){
    var color = mapColor(el.strokeColor) || '#000000';
    var width = Math.max(1, Math.round(el.strokeWidth || 1));
    var style = 'solid';
    if(el.strokeStyle === 'dashed') style = 'dashed';
    else if(el.strokeStyle === 'dotted') style = 'dotted';
    return [{
      strokeColor: color,
      strokeWidth: width,
      strokeOpacity: typeof el.opacity === 'number' ? el.opacity / 100 : 1,
      strokeAlignment: 'center',
      strokeStyle: style
    }];
  }

  function buildTransform(el){
    if(!el || !el.angle) return IDENTITY;
    var cos = Math.cos(el.angle), sin = Math.sin(el.angle);
    var cx = (el.width || 0) / 2, cy = (el.height || 0) / 2;
    return { a: cos, b: sin, c: -sin, d: cos, e: cx - cos*cx + sin*cy, f: cy - sin*cx - cos*cy };
  }

  function buildTransformInverse(el){
    if(!el || !el.angle) return IDENTITY;
    var cos = Math.cos(-el.angle), sin = Math.sin(-el.angle);
    var cx = (el.width || 0) / 2, cy = (el.height || 0) / 2;
    return { a: cos, b: sin, c: -sin, d: cos, e: cx - cos*cx + sin*cy, f: cy - sin*cx - cos*cy };
  }

  function buildPathContent(pts, closed){
    if(!pts || pts.length < 2) return [];
    var segs = [];
    for(var i = 0; i < pts.length; i++){
      segs.push({ command: i === 0 ? 'move-to' : 'line-to', params: { x: pts[i][0], y: pts[i][1] } });
    }
    if(closed) segs.push({ command: 'close-path', params: {} });
    return segs;
  }

  function selrect(x, y, w, h){
    return { x: x, y: y, width: w, height: h, x1: x, y1: y, x2: x + w, y2: y + h };
  }

  function corners(x, y, w, h){
    return [{ x: x, y: y }, { x: x+w, y: y }, { x: x+w, y: y+h }, { x: x, y: y+h }];
  }

  function mapFontFamily(code){
    switch(code){
      case 1: return 'sourcesanspro';
      case 2: return 'merriweather';
      case 3: return 'sourcecodepro';
      default: return 'sourcesanspro';
    }
  }

  function buildTextContent(text, fontSize, fontFamily, textAlign, color){
    var lines = (text || '').split('\n');
    return {
      type: 'root',
      children: [{ type: 'paragraph-set', children: lines.map(function(line){
        return { type: 'paragraph', children: [{
          text: line,
          fontSize: String(fontSize || 16),
          fontFamily: fontFamily || 'sourcesanspro',
          fontWeight: '400',
          fontStyle: 'normal',
          fillColor: color || '#000000',
          fillOpacity: 1,
          textAlign: textAlign || 'left'
        }]};
      })}]
    };
  }

  function makeShape(id, type, name, x, y, w, h, el){
    var s = {
      id: id, type: type, name: name,
      x: x, y: y, width: w, height: h,
      rotation: el && el.angle ? (el.angle * 180 / Math.PI) % 360 : 0,
      transform: buildTransform(el),
      transformInverse: buildTransformInverse(el),
      selrect: selrect(x, y, w, h),
      points: corners(x, y, w, h),
      proportionLock: false,
      hidden: false,
      blocked: false
    };
    if(el && typeof el.opacity === 'number' && el.opacity !== 100){
      s.opacity = el.opacity / 100;
    }
    return s;
  }

  // ── Main convert ────────────────────────────────────────────────────────────

  function convert(excalidata){
    var data = (typeof excalidata === 'string') ? JSON.parse(excalidata) : excalidata;
    var elements = (data.elements || []).filter(function(e){ return !e.isDeleted; });

    var byId = {};
    for(var i = 0; i < elements.length; i++) byId[elements[i].id] = elements[i];

    var containerText = {};
    var allTexts = elements.filter(function(e){ return e.type === 'text'; });
    for(var ti = 0; ti < allTexts.length; ti++){
      var t = allTexts[ti];
      if(t.containerId && byId[t.containerId]) containerText[t.containerId] = t;
    }

    var fileId = uuid(), pageId = uuid(), userFrameId = uuid();

    // Bounding box
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for(var bi = 0; bi < elements.length; bi++){
      var bel = elements[bi];
      var bx = bel.x||0, by = bel.y||0, bw = bel.width||0, bh = bel.height||0;
      if(bx < minX) minX = bx; if(by < minY) minY = by;
      if(bx+bw > maxX) maxX = bx+bw; if(by+bh > maxY) maxY = by+bh;
    }
    if(!isFinite(minX)){ minX = 0; minY = 0; maxX = 800; maxY = 600; }

    var shapeObjects = {};
    var childIds = [];

    // User-visible frame (child of root)
    var fx = Math.floor(minX)-50, fy = Math.floor(minY)-50;
    var fw = Math.ceil(maxX-minX)+100, fh = Math.ceil(maxY-minY)+100;
    var userFrame = makeShape(userFrameId, 'frame', 'Frame 1', fx, fy, fw, fh, null);
    userFrame.fills = [{ fillColor: '#ffffff', fillOpacity: 1 }];
    userFrame.strokes = [];
    userFrame.hideFillOnExport = false;
    userFrame.showContent = true;
    userFrame.r1 = 0; userFrame.r2 = 0; userFrame.r3 = 0; userFrame.r4 = 0;

    // Process shapes
    var shapeTypes = ['rectangle','ellipse','diamond','freedraw','image'];
    for(var si = 0; si < elements.length; si++){
      var el = elements[si];
      if(shapeTypes.indexOf(el.type) === -1) continue;

      var sx = Math.round(el.x||0), sy = Math.round(el.y||0);
      var sw = Math.max(1, Math.round(el.width||100)), sh = Math.max(1, Math.round(el.height||50));
      var sid = uuid();
      var shape = makeShape(sid, mapShapeType(el.type), el.type+'_'+el.id.slice(0,6), sx, sy, sw, sh, el);
      shape.fills = buildFills(el);
      shape.strokes = buildStrokes(el);
      shape.parentId = userFrameId;
      shape.frameId = userFrameId;

      if(el.type === 'rectangle' && el.roundness && el.roundness.type > 0){
        shape.r1 = 12; shape.r2 = 12; shape.r3 = 12; shape.r4 = 12;
      }
      if(el.type === 'diamond'){
        var dcx = sx+sw/2, dcy = sy+sh/2;
        shape.content = buildPathContent([[dcx,sy],[sx+sw,dcy],[dcx,sy+sh],[sx,dcy]], true);
      }
      if(el.type === 'freedraw' && el.points && el.points.length > 1){
        var fpts = el.points.map(function(p){ return [el.x+p[0], el.y+p[1]]; });
        var fcl = el.points.length > 2 &&
          Math.abs(el.points[0][0]-el.points[el.points.length-1][0]) < 1 &&
          Math.abs(el.points[0][1]-el.points[el.points.length-1][1]) < 1;
        shape.content = buildPathContent(fpts, fcl);
      }

      var boundText = containerText[el.id];
      shapeObjects[sid] = shape;
      childIds.push(sid);

      // All bound text becomes a sibling text shape at the frame level.
      // Penpot crashes if rect/circle have content (text) or if text shapes are
      // children of non-frame shapes. Safest approach: always create a separate
      // text shape positioned on top of the container.
      if(boundText){
        var btid = uuid();
        var bts = makeShape(btid, 'text', 'label_'+boundText.id.slice(0,6), sx, sy, sw, sh, boundText);
        bts.fills = []; bts.strokes = [];
        bts.parentId = userFrameId; bts.frameId = userFrameId;
        bts.content = buildTextContent(boundText.text, boundText.fontSize,
          mapFontFamily(boundText.fontFamily), boundText.textAlign,
          mapColor(boundText.strokeColor)||'#000000');
        bts.growType = 'auto-width';
        shapeObjects[btid] = bts;
        childIds.push(btid);
      }
    }

    // Arrows and lines
    for(var ai = 0; ai < elements.length; ai++){
      var ael = elements[ai];
      if(ael.type !== 'arrow' && ael.type !== 'line') continue;

      var apts;
      if(ael.points && ael.points.length > 1){
        apts = ael.points.map(function(p){ return [ael.x+p[0], ael.y+p[1]]; });
      } else {
        apts = [[ael.x||0, ael.y||0], [(ael.x||0)+(ael.width||0), (ael.y||0)+(ael.height||0)]];
      }

      var ax = Math.round(ael.x||0), ay = Math.round(ael.y||0);
      var aw = Math.max(1, Math.round(Math.abs(ael.width||1)));
      var ah = Math.max(1, Math.round(Math.abs(ael.height||1)));
      var aid = uuid();

      var ps = makeShape(aid, 'path', ael.type+'_'+ael.id.slice(0,6), ax, ay, aw, ah, ael);
      ps.fills = []; ps.strokes = buildStrokes(ael);
      ps.content = buildPathContent(apts, false);
      ps.parentId = userFrameId; ps.frameId = userFrameId;

      if(ael.type === 'arrow'){
        var endH = ael.endArrowhead || 'arrow';
        if(endH && endH !== 'none') ps.strokes[0].strokeCapEnd = 'triangle-arrow';
        if(ael.startArrowhead && ael.startArrowhead !== 'none') ps.strokes[0].strokeCapStart = 'triangle-arrow';
      }

      // Edge label as a sibling text shape at frame level (not child of arrow)
      var edgeText = containerText[ael.id];
      if(edgeText){
        var etid = uuid();
        var midPt = apts[Math.floor(apts.length/2)];
        var ets = makeShape(etid, 'text', 'label_'+edgeText.id.slice(0,6),
          Math.round(midPt[0])-30, Math.round(midPt[1])-10, 60, 20, edgeText);
        ets.fills = []; ets.strokes = [];
        ets.parentId = userFrameId; ets.frameId = userFrameId;
        ets.content = buildTextContent(edgeText.text, edgeText.fontSize,
          mapFontFamily(edgeText.fontFamily), 'center',
          mapColor(edgeText.strokeColor)||'#000000');
        ets.growType = 'auto-width';
        shapeObjects[etid] = ets;
        childIds.push(etid);
      }

      shapeObjects[aid] = ps;
      childIds.push(aid);
    }

    // Standalone text
    for(var sti = 0; sti < allTexts.length; sti++){
      var st = allTexts[sti];
      if(st.containerId) continue;
      var stid = uuid();
      var sts = makeShape(stid, 'text', 'text_'+st.id.slice(0,6),
        Math.round(st.x||0), Math.round(st.y||0),
        Math.max(1, Math.round(st.width||100)), Math.max(1, Math.round(st.height||30)), st);
      sts.fills = []; sts.strokes = [];
      sts.parentId = userFrameId; sts.frameId = userFrameId;
      sts.content = buildTextContent(st.text, st.fontSize,
        mapFontFamily(st.fontFamily), st.textAlign,
        mapColor(st.strokeColor)||'#000000');
      sts.growType = 'auto-height';
      shapeObjects[stid] = sts;
      childIds.push(stid);
    }

    userFrame.shapes = childIds;

    // ── Assemble page objects ─────────────────────────────────────────────────

    var pageObjects = {};

    // Penpot root frame: uuid zero, self-referencing
    pageObjects[ROOT_UUID] = {
      id: ROOT_UUID, type: 'frame', name: 'Root Frame',
      parentId: ROOT_UUID, frameId: ROOT_UUID,
      x: 0, y: 0, width: 0.01, height: 0.01, rotation: 0,
      transform: IDENTITY, transformInverse: IDENTITY,
      selrect: selrect(0, 0, 0.01, 0.01),
      points: corners(0, 0, 0.01, 0.01),
      shapes: [userFrameId],
      fills: [], strokes: [],
      hideFillOnExport: false
    };

    userFrame.parentId = ROOT_UUID;
    userFrame.frameId = userFrameId;
    pageObjects[userFrameId] = userFrame;

    var allIds = Object.keys(shapeObjects);
    for(var oi = 0; oi < allIds.length; oi++){
      pageObjects[allIds[oi]] = shapeObjects[allIds[oi]];
    }

    return {
      fileId: fileId, pageId: pageId,
      manifest: {
        type: 'penpot/export-files',
        version: 1,
        generatedBy: 'excalidraw-converter',
        files: [{ id: fileId, name: 'Excalidraw Import',
                   features: ['components/v2', 'styles/v2', 'fdata/pointer-map',
                              'fdata/objects-map', 'fdata/shape-data-type'] }]
      },
      fileData: {
        id: fileId, name: 'Excalidraw Import',
        isShared: false, version: 67,
        features: ['components/v2', 'styles/v2', 'fdata/pointer-map',
                    'fdata/objects-map', 'fdata/shape-data-type']
      },
      pageData: { id: pageId, name: 'Page 1', index: 0 },
      shapeEntries: pageObjects
    };
  }

  // Build a JSZip archive from the structured result
  async function buildZip(result){
    var zip = new JSZip();
    var fid = result.fileId, pid = result.pageId;

    zip.file('manifest.json', JSON.stringify(result.manifest, null, 2));
    zip.file('files/' + fid + '.json', JSON.stringify(result.fileData, null, 2));

    var pageMeta = Object.assign({}, result.pageData);
    pageMeta.objects = Object.keys(result.shapeEntries);
    zip.file('files/' + fid + '/pages/' + pid + '.json', JSON.stringify(pageMeta, null, 2));

    var sids = Object.keys(result.shapeEntries);
    for(var i = 0; i < sids.length; i++){
      zip.file('files/' + fid + '/pages/' + pid + '/' + sids[i] + '.json',
        JSON.stringify(result.shapeEntries[sids[i]], null, 2));
    }

    return zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  }

  async function convertToBlob(excalidata){
    return buildZip(convert(excalidata));
  }

  function convertToJSON(excalidata){
    var result = convert(excalidata);
    return JSON.stringify({
      _info: 'Preview of .penpot ZIP contents (download for the real file)',
      manifest: result.manifest,
      file: result.fileData,
      page: result.pageData,
      shapes: result.shapeEntries
    }, null, 2);
  }

  global.ExcPenpot = {
    convertExcalidrawToPenpot: convertToJSON,
    convertExcalidrawToPenpotBlob: convertToBlob
  };
})(window);

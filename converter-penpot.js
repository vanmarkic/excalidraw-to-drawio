// Excalidraw -> Penpot converter
// Produces a Penpot-compatible JSON representation of the design.
// Penpot is an open-source design tool that uses SVG-based internal
// representations. This converter maps Excalidraw primitives to
// Penpot shape objects with position, geometry, fills, strokes,
// and text content preserved.

(function(global){
  'use strict';

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

  function mapPenpotShapeType(elType){
    switch(elType){
      case 'rectangle': return 'rect';
      case 'ellipse':   return 'circle'; // Penpot uses "circle" for ellipses
      case 'diamond':   return 'rect';   // rotated rect, with transform
      case 'freedraw':  return 'path';
      case 'image':     return 'image';
      case 'text':      return 'text';
      case 'arrow':
      case 'line':      return 'path';
      default:          return 'rect';
    }
  }

  function buildFill(el){
    const bg = mapColor(el.backgroundColor);
    if(!bg) return [];
    return [{
      fillColor: bg,
      fillOpacity: typeof el.opacity === 'number' ? el.opacity / 100 : 1
    }];
  }

  function buildStroke(el){
    const color = mapColor(el.strokeColor) || '#000000';
    const width = Math.max(1, Math.round(el.strokeWidth || 1));
    let type = 'solid';
    if(el.strokeStyle === 'dashed') type = 'dashed';
    else if(el.strokeStyle === 'dotted') type = 'dotted';
    return [{
      strokeColor: color,
      strokeWidth: width,
      strokeOpacity: typeof el.opacity === 'number' ? el.opacity / 100 : 1,
      strokeAlignment: 'center',
      strokeType: type
    }];
  }

  function buildTransform(el){
    // Penpot uses a 2D affine transform matrix [a,b,c,d,e,f]
    // Default is identity [1,0,0,1,0,0]
    if(!el.angle) return null;
    const cos = Math.cos(el.angle);
    const sin = Math.sin(el.angle);
    // Rotation around element center
    const cx = (el.width || 0) / 2;
    const cy = (el.height || 0) / 2;
    return {
      a: cos, b: sin, c: -sin, d: cos,
      e: cx - cos * cx + sin * cy,
      f: cy - sin * cx - cos * cy
    };
  }

  function buildPathContent(points, closed){
    if(!points || points.length < 2) return [];
    const segments = [];
    for(var i = 0; i < points.length; i++){
      segments.push({
        command: i === 0 ? 'move-to' : 'line-to',
        params: { x: points[i][0], y: points[i][1] }
      });
    }
    if(closed){
      segments.push({ command: 'close-path', params: {} });
    }
    return segments;
  }

  function buildSVGPathD(points, closed){
    if(!points || points.length < 2) return '';
    var d = points.map(function(p, i){
      return (i === 0 ? 'M' : 'L') + p[0].toFixed(2) + ' ' + p[1].toFixed(2);
    }).join(' ');
    if(closed) d += ' Z';
    return d;
  }

  function mapFontFamily(code){
    switch(code){
      case 1: return 'sourcesanspro';
      case 2: return 'merriweather';
      case 3: return 'sourcecodepro';
      case 5: return 'sourcesanspro';
      default: return 'sourcesanspro';
    }
  }

  function convert(excalidata){
    const data = (typeof excalidata === 'string') ? JSON.parse(excalidata) : excalidata;
    const elements = (data.elements || []).filter(function(e){ return !e.isDeleted; });

    const byId = {};
    for(const el of elements) byId[el.id] = el;

    // Collect text bindings
    const containerText = {};
    const texts = elements.filter(function(e){ return e.type === 'text'; });
    for(const t of texts){
      if(t.containerId && byId[t.containerId]){
        containerText[t.containerId] = t;
      }
    }

    const pageId = uuid();
    const frameId = uuid();

    const penpot = {
      version: '2.0',
      type: 'penpot-file',
      metadata: {
        name: 'Excalidraw Import',
        createdAt: new Date().toISOString(),
        source: 'excalidraw-converter'
      },
      pages: [{
        id: pageId,
        name: 'Page 1',
        options: {
          background: (data.appState && data.appState.viewBackgroundColor) || '#ffffff'
        },
        objects: []
      }]
    };

    const objects = penpot.pages[0].objects;

    // Compute bounding box for frame
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for(const el of elements){
      const ex = el.x || 0;
      const ey = el.y || 0;
      const ew = el.width || 0;
      const eh = el.height || 0;
      if(ex < minX) minX = ex;
      if(ey < minY) minY = ey;
      if(ex + ew > maxX) maxX = ex + ew;
      if(ey + eh > maxY) maxY = ey + eh;
    }
    if(!isFinite(minX)) { minX = 0; minY = 0; maxX = 800; maxY = 600; }

    // Add a root frame
    objects.push({
      id: frameId,
      type: 'frame',
      name: 'Frame 1',
      x: Math.floor(minX) - 50,
      y: Math.floor(minY) - 50,
      width: Math.ceil(maxX - minX) + 100,
      height: Math.ceil(maxY - minY) + 100,
      fills: [{ fillColor: '#ffffff', fillOpacity: 1 }],
      strokes: [],
      children: []
    });

    const frame = objects[0];

    // Process shape elements
    const shapeTypes = ['rectangle','ellipse','diamond','freedraw','image'];
    for(const el of elements){
      if(!shapeTypes.includes(el.type)) continue;

      const shape = {
        id: uuid(),
        type: mapPenpotShapeType(el.type),
        name: (el.type) + '_' + el.id.slice(0,6),
        x: Math.round(el.x || 0),
        y: Math.round(el.y || 0),
        width: Math.max(1, Math.round(el.width || 100)),
        height: Math.max(1, Math.round(el.height || 50)),
        fills: buildFill(el),
        strokes: buildStroke(el)
      };

      // Rotation
      const transform = buildTransform(el);
      if(transform) shape.transform = transform;

      // Diamond is a rect rotated 45deg in Penpot, or we use SVG path
      if(el.type === 'diamond'){
        var w = shape.width, h = shape.height;
        var cx = shape.x + w/2, cy = shape.y + h/2;
        shape.type = 'path';
        shape.content = buildPathContent([
          [cx, shape.y],
          [shape.x + w, cy],
          [cx, shape.y + h],
          [shape.x, cy]
        ], true);
        shape.svgPath = buildSVGPathD([
          [cx, shape.y],
          [shape.x + w, cy],
          [cx, shape.y + h],
          [shape.x, cy]
        ], true);
      }

      // Rounded corners
      if(el.type === 'rectangle' && el.roundness && el.roundness.type > 0){
        shape.rx = 12;
        shape.ry = 12;
      }

      // Freedraw as path
      if(el.type === 'freedraw' && el.points && el.points.length > 1){
        var pts = el.points.map(function(p){ return [el.x + p[0], el.y + p[1]]; });
        var isClosed = el.points.length > 2 &&
          Math.abs(el.points[0][0]-el.points[el.points.length-1][0]) < 1 &&
          Math.abs(el.points[0][1]-el.points[el.points.length-1][1]) < 1;
        shape.content = buildPathContent(pts, isClosed);
        shape.svgPath = buildSVGPathD(pts, isClosed);
      }

      // Image
      if(el.type === 'image' && data.files && el.fileId){
        var f = data.files[el.fileId];
        if(f){
          shape.imageData = f.dataURL || f.data || null;
          shape.mimeType = f.mimeType || 'image/png';
        }
      }

      // Attached text content
      var textEl = containerText[el.id];
      if(textEl){
        shape.text = {
          content: textEl.text || '',
          fontSize: textEl.fontSize || 16,
          fontFamily: mapFontFamily(textEl.fontFamily),
          textAlign: textEl.textAlign || 'left',
          verticalAlign: textEl.verticalAlign || 'top',
          color: mapColor(textEl.strokeColor) || '#000000'
        };
      }

      frame.children.push(shape.id);
      objects.push(shape);
    }

    // Process arrows and lines as paths
    for(const el of elements){
      if(el.type !== 'arrow' && el.type !== 'line') continue;

      var pts = [];
      if(el.points && el.points.length > 1){
        pts = el.points.map(function(p){ return [el.x + p[0], el.y + p[1]]; });
      } else {
        pts = [
          [el.x || 0, el.y || 0],
          [(el.x || 0) + (el.width || 0), (el.y || 0) + (el.height || 0)]
        ];
      }

      var pathShape = {
        id: uuid(),
        type: 'path',
        name: el.type + '_' + el.id.slice(0,6),
        x: Math.round(el.x || 0),
        y: Math.round(el.y || 0),
        width: Math.max(1, Math.round(el.width || 1)),
        height: Math.max(1, Math.round(el.height || 1)),
        fills: [],
        strokes: buildStroke(el),
        content: buildPathContent(pts, false),
        svgPath: buildSVGPathD(pts, false)
      };

      // Arrow markers
      if(el.type === 'arrow'){
        pathShape.markers = {};
        if(el.startArrowhead && el.startArrowhead !== 'none'){
          pathShape.markers.start = el.startArrowhead;
        }
        pathShape.markers.end = el.endArrowhead || 'arrow';
      }

      // Edge label
      var edgeLabelEl = containerText[el.id];
      if(edgeLabelEl){
        pathShape.text = {
          content: edgeLabelEl.text || '',
          fontSize: edgeLabelEl.fontSize || 16,
          fontFamily: mapFontFamily(edgeLabelEl.fontFamily),
          color: mapColor(edgeLabelEl.strokeColor) || '#000000'
        };
      }

      // Bindings
      if(el.startBinding && el.startBinding.elementId){
        pathShape.startBinding = el.startBinding.elementId;
      }
      if(el.endBinding && el.endBinding.elementId){
        pathShape.endBinding = el.endBinding.elementId;
      }

      frame.children.push(pathShape.id);
      objects.push(pathShape);
    }

    // Standalone text elements
    for(const t of texts){
      if(t.containerId) continue;

      var textShape = {
        id: uuid(),
        type: 'text',
        name: 'text_' + t.id.slice(0,6),
        x: Math.round(t.x || 0),
        y: Math.round(t.y || 0),
        width: Math.max(1, Math.round(t.width || 100)),
        height: Math.max(1, Math.round(t.height || 30)),
        fills: [],
        strokes: [],
        text: {
          content: t.text || '',
          fontSize: t.fontSize || 16,
          fontFamily: mapFontFamily(t.fontFamily),
          textAlign: t.textAlign || 'left',
          verticalAlign: t.verticalAlign || 'top',
          color: mapColor(t.strokeColor) || '#000000',
          lineHeight: 1.2
        }
      };

      var txtTransform = buildTransform(t);
      if(txtTransform) textShape.transform = txtTransform;

      if(typeof t.opacity === 'number' && t.opacity !== 100){
        textShape.opacity = t.opacity / 100;
      }

      frame.children.push(textShape.id);
      objects.push(textShape);
    }

    return JSON.stringify(penpot, null, 2);
  }

  global.ExcPenpot = { convertExcalidrawToPenpot: convert };
})(window);

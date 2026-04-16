// Excalidraw -> SVG converter (for Klaxoon import)
// Generates a standalone vector SVG that preserves shapes, text, colors,
// and positions. This SVG can be opened in a browser, printed to PDF,
// and imported into Klaxoon via Import > Files as an editable vector PDF.
//
// Klaxoon does not have a native file format for import. Their documented
// import path is: upload a vector-quality PDF (or image). A vector PDF
// produced from this SVG will give editable elements in the Klaxoon board.

(function(global){
  'use strict';

  function esc(text){
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function mapFontFamily(code){
    switch(code){
      case 1: return 'Helvetica, Arial, sans-serif';
      case 2: return 'Georgia, Times New Roman, serif';
      case 3: return 'Courier New, monospace';
      case 5: return 'Comic Sans MS, cursive';
      default: return 'Helvetica, Arial, sans-serif';
    }
  }

  function dashArray(el){
    var sw = Math.max(1, Math.round(el.strokeWidth || 1));
    if(el.strokeStyle === 'dashed') return (sw * 4) + ' ' + (sw * 3);
    if(el.strokeStyle === 'dotted') return sw + ' ' + (sw * 2);
    return '';
  }

  function commonAttrs(el){
    var parts = [];
    var fill = (el.backgroundColor && el.backgroundColor !== 'transparent')
      ? el.backgroundColor : 'none';
    var stroke = el.strokeColor || '#000000';
    var sw = Math.max(1, Math.round(el.strokeWidth || 1));

    parts.push('fill="' + esc(fill) + '"');
    parts.push('stroke="' + esc(stroke) + '"');
    parts.push('stroke-width="' + sw + '"');
    parts.push('stroke-linecap="round"');
    parts.push('stroke-linejoin="round"');

    var da = dashArray(el);
    if(da) parts.push('stroke-dasharray="' + da + '"');

    if(typeof el.opacity === 'number' && el.opacity !== 100){
      parts.push('opacity="' + (el.opacity / 100).toFixed(2) + '"');
    }
    return parts.join(' ');
  }

  function rotationAttr(el){
    if(!el.angle) return '';
    var deg = (el.angle * 180 / Math.PI);
    var cx = (el.x || 0) + (el.width || 0) / 2;
    var cy = (el.y || 0) + (el.height || 0) / 2;
    return ' transform="rotate(' + deg.toFixed(2) + ' ' + cx.toFixed(2) + ' ' + cy.toFixed(2) + ')"';
  }

  function arrowMarkerDefs(elements){
    var hasStart = false, hasEnd = false;
    for(var i = 0; i < elements.length; i++){
      var e = elements[i];
      if(e.type !== 'arrow') continue;
      if(e.startArrowhead && e.startArrowhead !== 'none') hasStart = true;
      var end = e.endArrowhead || 'arrow';
      if(end && end !== 'none') hasEnd = true;
    }
    var defs = [];
    if(hasEnd){
      defs.push('<marker id="arrowEnd" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto" markerUnits="strokeWidth">');
      defs.push('  <polygon points="0 0, 10 3.5, 0 7" fill="context-stroke"/>');
      defs.push('</marker>');
    }
    if(hasStart){
      defs.push('<marker id="arrowStart" markerWidth="10" markerHeight="7" refX="1" refY="3.5" orient="auto" markerUnits="strokeWidth">');
      defs.push('  <polygon points="10 0, 0 3.5, 10 7" fill="context-stroke"/>');
      defs.push('</marker>');
    }
    return defs.length ? '<defs>\n' + defs.join('\n') + '\n</defs>' : '';
  }

  function convert(excalidata){
    var data = (typeof excalidata === 'string') ? JSON.parse(excalidata) : excalidata;
    var elements = (data.elements || []).filter(function(e){ return !e.isDeleted; });

    var byId = {};
    for(var i = 0; i < elements.length; i++) byId[elements[i].id] = elements[i];

    // Text bindings
    var containerText = {};
    var allTexts = elements.filter(function(e){ return e.type === 'text'; });
    for(var ti = 0; ti < allTexts.length; ti++){
      var t = allTexts[ti];
      if(t.containerId && byId[t.containerId]) containerText[t.containerId] = t;
    }

    // Bounding box
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for(var bi = 0; bi < elements.length; bi++){
      var bel = elements[bi];
      var bx = bel.x || 0, by = bel.y || 0;
      var bw = Math.abs(bel.width || 0), bh = Math.abs(bel.height || 0);
      // For lines/arrows, also consider points
      if(bel.points && bel.points.length > 0){
        for(var pi = 0; pi < bel.points.length; pi++){
          var px = bel.x + bel.points[pi][0], py = bel.y + bel.points[pi][1];
          if(px < minX) minX = px; if(py < minY) minY = py;
          if(px > maxX) maxX = px; if(py > maxY) maxY = py;
        }
      }
      if(bx < minX) minX = bx; if(by < minY) minY = by;
      if(bx + bw > maxX) maxX = bx + bw;
      if(by + bh > maxY) maxY = by + bh;
    }
    if(!isFinite(minX)){ minX = 0; minY = 0; maxX = 800; maxY = 600; }

    var pad = 20;
    var vx = Math.floor(minX) - pad;
    var vy = Math.floor(minY) - pad;
    var vw = Math.ceil(maxX - minX) + pad * 2;
    var vh = Math.ceil(maxY - minY) + pad * 2;

    var svgParts = [];
    svgParts.push('<?xml version="1.0" encoding="UTF-8"?>');
    svgParts.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vx + ' ' + vy + ' ' + vw + ' ' + vh + '" width="' + vw + '" height="' + vh + '">');

    // Background
    var bg = (data.appState && data.appState.viewBackgroundColor) || '#ffffff';
    if(bg && bg !== 'transparent'){
      svgParts.push('<rect x="' + vx + '" y="' + vy + '" width="' + vw + '" height="' + vh + '" fill="' + esc(bg) + '"/>');
    }

    // Arrow markers
    var defs = arrowMarkerDefs(elements);
    if(defs) svgParts.push(defs);

    // Render shapes (non-text, non-arrow/line)
    var shapeTypes = ['rectangle', 'ellipse', 'diamond', 'freedraw', 'image'];
    for(var si = 0; si < elements.length; si++){
      var el = elements[si];
      if(shapeTypes.indexOf(el.type) === -1) continue;

      var x = el.x || 0, y = el.y || 0;
      var w = Math.max(1, Math.abs(el.width || 100));
      var h = Math.max(1, Math.abs(el.height || 50));
      var rot = rotationAttr(el);

      if(el.type === 'rectangle'){
        var rx = (el.roundness && el.roundness.type > 0) ? 12 : 0;
        svgParts.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '"' +
          (rx ? ' rx="' + rx + '" ry="' + rx + '"' : '') +
          ' ' + commonAttrs(el) + rot + '/>');
      } else if(el.type === 'ellipse'){
        var cx = x + w/2, cy = y + h/2;
        svgParts.push('<ellipse cx="' + cx.toFixed(2) + '" cy="' + cy.toFixed(2) +
          '" rx="' + (w/2).toFixed(2) + '" ry="' + (h/2).toFixed(2) +
          '" ' + commonAttrs(el) + rot + '/>');
      } else if(el.type === 'diamond'){
        var dcx = x + w/2, dcy = y + h/2;
        var pts = (dcx)+','+y + ' ' + (x+w)+','+dcy + ' ' + dcx+','+(y+h) + ' ' + x+','+dcy;
        svgParts.push('<polygon points="' + pts + '" ' + commonAttrs(el) + rot + '/>');
      } else if(el.type === 'freedraw' && el.points && el.points.length > 1){
        var d = el.points.map(function(p, idx){
          return (idx === 0 ? 'M' : 'L') + (el.x + p[0]).toFixed(2) + ' ' + (el.y + p[1]).toFixed(2);
        }).join(' ');
        svgParts.push('<path d="' + d + '" ' + commonAttrs(el) + '/>');
      }
      // Image: render placeholder rect
      if(el.type === 'image'){
        svgParts.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h +
          '" fill="#eeeeee" stroke="#999999" stroke-width="1"' + rot + '/>');
        svgParts.push('<text x="' + (x+w/2) + '" y="' + (y+h/2+5) + '" text-anchor="middle" font-size="12" fill="#666666">IMG</text>');
      }

      // Render text bound to this shape
      var bt = containerText[el.id];
      if(bt) renderText(svgParts, bt, x, y, w, h);
    }

    // Render arrows and lines
    for(var ai = 0; ai < elements.length; ai++){
      var ael = elements[ai];
      if(ael.type !== 'arrow' && ael.type !== 'line') continue;

      var apts;
      if(ael.points && ael.points.length > 1){
        apts = ael.points.map(function(p){ return [ael.x + p[0], ael.y + p[1]]; });
      } else {
        apts = [[ael.x||0, ael.y||0], [(ael.x||0)+(ael.width||0), (ael.y||0)+(ael.height||0)]];
      }

      var pathD = apts.map(function(p, idx){
        return (idx === 0 ? 'M' : 'L') + p[0].toFixed(2) + ' ' + p[1].toFixed(2);
      }).join(' ');

      var markerAttr = '';
      if(ael.type === 'arrow'){
        var endH = ael.endArrowhead || 'arrow';
        if(endH && endH !== 'none') markerAttr += ' marker-end="url(#arrowEnd)"';
        if(ael.startArrowhead && ael.startArrowhead !== 'none') markerAttr += ' marker-start="url(#arrowStart)"';
      }

      svgParts.push('<path d="' + pathD + '" fill="none" stroke="' + esc(ael.strokeColor||'#000000') +
        '" stroke-width="' + Math.max(1, Math.round(ael.strokeWidth||1)) + '"' +
        ' stroke-linecap="round" stroke-linejoin="round"' +
        (dashArray(ael) ? ' stroke-dasharray="' + dashArray(ael) + '"' : '') +
        (typeof ael.opacity === 'number' && ael.opacity !== 100 ? ' opacity="' + (ael.opacity/100).toFixed(2) + '"' : '') +
        markerAttr + '/>');

      // Edge label
      var eLabel = containerText[ael.id];
      if(eLabel){
        var midIdx = Math.floor(apts.length / 2);
        var mx = apts[midIdx][0], my = apts[midIdx][1];
        renderTextAt(svgParts, eLabel, mx, my);
      }
    }

    // Standalone text
    for(var sti = 0; sti < allTexts.length; sti++){
      var st = allTexts[sti];
      if(st.containerId) continue;
      renderText(svgParts, st, st.x||0, st.y||0, st.width||100, st.height||30);
    }

    svgParts.push('</svg>');
    return svgParts.join('\n');
  }

  function renderText(parts, el, cx, cy, cw, ch){
    var text = el.text || '';
    var lines = text.split('\n');
    var fontSize = el.fontSize || 16;
    var fontFamily = mapFontFamily(el.fontFamily);
    var color = el.strokeColor || '#000000';
    var align = el.textAlign || 'left';
    var vAlign = el.verticalAlign || 'top';

    var anchor = align === 'center' ? 'middle' : (align === 'right' ? 'end' : 'start');
    var tx = align === 'center' ? cx + cw/2 : (align === 'right' ? cx + cw : cx + 4);

    var lineH = fontSize * 1.2;
    var totalH = lines.length * lineH;
    var startY;
    if(vAlign === 'middle') startY = cy + (ch - totalH) / 2 + fontSize;
    else if(vAlign === 'bottom') startY = cy + ch - totalH + fontSize;
    else startY = cy + fontSize + 2;

    var opacity = '';
    if(typeof el.opacity === 'number' && el.opacity !== 100){
      opacity = ' opacity="' + (el.opacity/100).toFixed(2) + '"';
    }

    for(var li = 0; li < lines.length; li++){
      parts.push('<text x="' + tx.toFixed(2) + '" y="' + (startY + li * lineH).toFixed(2) +
        '" font-size="' + fontSize + '" font-family="' + esc(fontFamily) +
        '" fill="' + esc(color) + '" text-anchor="' + anchor + '"' + opacity + '>' +
        esc(lines[li]) + '</text>');
    }
  }

  function renderTextAt(parts, el, mx, my){
    var text = el.text || '';
    var fontSize = el.fontSize || 14;
    var fontFamily = mapFontFamily(el.fontFamily);
    var color = el.strokeColor || '#000000';

    // Background for readability
    var tw = text.length * fontSize * 0.6;
    parts.push('<rect x="' + (mx - tw/2 - 4) + '" y="' + (my - fontSize - 2) +
      '" width="' + (tw + 8) + '" height="' + (fontSize + 8) +
      '" fill="white" fill-opacity="0.85" rx="3" stroke="none"/>');
    parts.push('<text x="' + mx.toFixed(2) + '" y="' + my.toFixed(2) +
      '" font-size="' + fontSize + '" font-family="' + esc(fontFamily) +
      '" fill="' + esc(color) + '" text-anchor="middle">' + esc(text) + '</text>');
  }

  global.ExcKlaxoon = { convertExcalidrawToKlaxoon: convert };
})(window);

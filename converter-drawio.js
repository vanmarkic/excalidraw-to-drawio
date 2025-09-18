// Excalidraw -> draw.io (mxGraph) minimal client-side converter
// NOTE: This is a heuristic lightweight mapping for common primitive shapes
// (rectangle, ellipse, diamond, text, line/arrow). Images and freedraw are
// embedded as data URIs (images) or paths (simplified) inside a shape.
// draw.io file format is an XML <mxfile> containing <diagram> with a base64
// compressed/zlib+base64 encoded mxGraphModel by default. For simplicity
// here we output a plain (uncompressed) <mxfile><diagram> containing raw
// mxGraphModel XML; draw.io will still import it.
// We assign incremental IDs; parent layer is id=0, default layer = 1.

(function(global){
  'use strict';

  function encodeXml(text){
    return String(text)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&apos;');
  }

  function styleForElement(el, extra){
    const stroke = el.strokeColor || '#000000';
    const fill = (el.backgroundColor && el.backgroundColor !== 'transparent') ? el.backgroundColor : 'none';
    const strokeWidth = Math.max(1, Math.round(el.strokeWidth || 1));
    let shape = 'rect'; // use "rect" to allow arcSize
    if(el.type === 'ellipse') shape = 'ellipse';
    else if(el.type === 'diamond') shape = 'rhombus';
    else if(el.type === 'freedraw') shape = 'process'; // generic fallback
    else if(el.type === 'image') shape = 'image';

    // Roundness & arc
    let rounded = 0; let arcSize = 0;
    if(el.type === 'rectangle' && el.roundness && el.roundness.type > 0){
      rounded = 1; arcSize = 15; // heuristic; could map based on type
    }

    // Build base style array
    const parts = [];
    // If extra already sets shape=image (freedraw/image override) don't duplicate base shape
    if(!(extra && /(^|;)shape=image(;|$)/.test(extra))){
      parts.push(`shape=${shape}`);
    }
    if(shape === 'ellipse') parts.push('perimeter=ellipsePerimeter');
    if(shape === 'rhombus') parts.push('perimeter=rhombusPerimeter');
    if(rounded){
      parts.push('rounded=1');
      parts.push('absoluteArcSize=1');
      parts.push(`arcSize=${arcSize}`);
    }

    // Fill & stroke
    if(fill === 'none') parts.push('fillColor=none'); else parts.push(`fillColor=${fill}`);
    parts.push(`strokeColor=${stroke}`);
    parts.push(`strokeWidth=${strokeWidth}`);

    // Dashing (strokeStyle) & hachure approximations
    if(el.strokeStyle === 'dashed') parts.push('dashed=1');
    else if(el.strokeStyle === 'dotted') parts.push('dashed=1;dashPattern=2 2');

    // Hand-drawn feel: draw.io supports sketch=1; we add it for hachure/cross-hatch or higher roughness.
    if(['hachure','cross-hatch'].includes(el.fillStyle) || (typeof el.roughness === 'number' && el.roughness > 1)){
      parts.push('sketch=1');
      // optional: tweak factor (draw.io: sketchFactor default 0.5) map roughness ~ [0,2]
      if(typeof el.roughness === 'number'){
        const factor = Math.min(2, Math.max(0.1, el.roughness / 2)).toFixed(2);
        parts.push(`sketchFactor=${factor}`);
      }
    }

    // Opacity (draw.io expects 0-100, can be decimal)
    if(typeof el.opacity === 'number' && el.opacity !== 100){
      parts.push(`opacity=${Number(el.opacity).toFixed(1)}`);
    }

    // Rotation
    if(el.angle){
      const deg = (el.angle * 180 / Math.PI) % 360;
      parts.push(`rotation=${deg}`);
    }

    // Text handled separately by styleForTextElement

    if(extra) parts.push(extra);
    return parts.join(';');
  }

  function mapFontFamily(code){
    // Extend mapping beyond simplistic earlier approach
    switch(code){
      case 1: return 'Helvetica';
      case 2: return 'Times New Roman';
      case 3: return 'Courier New';
      case 5: return 'Comic Sans MS';
      case 6: return 'Helvetica';
      case 7: return 'Georgia';
      case 8: return 'Courier New'; // assume code 8 = code font
      default: return 'Helvetica';
    }
  }

  // Slight downscale to reduce text size so it fits boxes closer to original Excalidraw rendering.
  const FONT_SCALE = 0.90;
  function scaleFont(size){ return Math.max(4, Math.round(size * FONT_SCALE)); }

  function mapArrow(head){
    // Returns object {shape, fill} where fill is 1 or 0 for start/endFill flags.
    switch(head){
      case 'arrow': // default arrow in Excalidraw (hollow or filled?). Prefer filled block.
      case 'triangle':
        return { shape: 'block', fill: 1 };
      case 'dot':
        return { shape: 'oval', fill: 1 };
      case 'diamond':
        return { shape: 'diamond', fill: 1 };
      case 'bar': // no direct bar, approximate with a short dash (draw.io lacks bar arrowhead). Use open for visibility.
        return { shape: 'open', fill: 0 };
      case 'none':
      case undefined:
      case null:
        return { shape: 'none', fill: 0 };
      default:
        return { shape: 'open', fill: 0 };
    }
  }

  function resolveImageDataURL(data, el){
    if(!data.files || !el.fileId) return null;
    const f = data.files[el.fileId];
    if(!f) return null;
    // Excalidraw file objects sometimes store under .dataURL or .data or base64
    if(f.dataURL) return sanitizeDataUrl(f.dataURL);
    if(f.data) return sanitizeDataUrl(f.data); // assume already dataURL or base64 (we won't attempt to guess mime)
    if(f.base64){
      const mime = f.mimeType || 'image/png';
      return sanitizeDataUrl(`data:${mime};base64,${f.base64}`);
    }
    return null;
  }

  function sanitizeDataUrl(url){
    if(typeof url !== 'string') return url;
    // draw.io exports often omit ';base64' even when data is base64 encoded.
    // We strip it to maximize compatibility: data:image/png;base64,XXXX -> data:image/png,XXXX
    // Only do this for common image mime types to avoid altering other embedded formats.
    return url.replace(/^(data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml));base64,/i, '$1,');
  }

  function lineStyle(el){
    const stroke = el.strokeColor || '#000000';
    const strokeWidth = Math.max(1, Math.round(el.strokeWidth || 1));
    const dash = el.strokeStyle === 'dashed' ? 'dashed=1' : (el.strokeStyle === 'dotted' ? 'dashed=1;dashPattern=2 2' : '');
    const startArrowObj = mapArrow(el.startArrowhead);
    const endArrowObj = mapArrow(el.endArrowhead || el.arrowhead);
    // Heuristic curved detection: multi-point + explicit curve flags or roundness
    let curved = false;
    if(el.points && el.points.length > 3){
      if(el.curve === true || el.isCurve === true) curved = true;
      else if(el.roundness && (el.roundness.type >= 2 || el.roundness.type === 'curve')) curved = true;
      // fallback: if any point is not collinear we could also mark curved, but keep simple for now
    }
    const arr = [ 'shape=filledEdge' ];
    arr.push(`strokeWidth=${strokeWidth}`);
    arr.push(`strokeColor=${stroke}`);
    arr.push('fillColor=none');
  arr.push(`startArrow=${startArrowObj.shape}`);
  arr.push(`startFill=${startArrowObj.fill}`);
    arr.push('startSize=6');
  arr.push(`endArrow=${endArrowObj.shape}`);
  arr.push(`endFill=${endArrowObj.fill}`);
    arr.push('endSize=6');
    if(curved){
      arr.push('edgeStyle=none'); // don't orthogonally route
      arr.push('curved=1');
    }
    else{
      arr.push('rounded=1');
   }
    if(dash) arr.push(dash + ';fixDash=1'); else arr.push('fixDash=1');
    return arr.join(';');
  }

  function convert(excalidata){
    const data = (typeof excalidata === 'string') ? JSON.parse(excalidata) : excalidata;
    const elements = data.elements || [];

    // Compute bounding box offsets so we don't get negative coords
    let minX = 0, minY = 0;
  for(const el of elements){
      if(el.x < minX) minX = el.x;
      if(el.y < minY) minY = el.y;
    }
    if(minX > 0) minX = 0; if(minY > 0) minY = 0;
    // We'll build structured cell objects first to allow a second pass for container text & edge labels
    let idCounter = 2; // 0=root,1=layer
    function nextId(){ return (idCounter++).toString(); }

    const cellObjs = [];
    const elementToCell = {}; // excalidraw element id -> mx cell id
    const deferredText = [];  // store text elements for second pass

    // Helper to push a vertex
    function addVertex(el, style, value, parentId, x, y, w, h){
      const id = nextId();
      cellObjs.push({ id, value: value||'', style, vertex:1, parent: parentId||'1', geom:{x,y,w,h} });
      elementToCell[el.id] = id;
      return id;
    }
    // Helper to push edge
    function addEdge(el, style, value, sourcePoint, targetPoint){
      const id = nextId();
      cellObjs.push({ id, value: value||'', style, edge:1, parent:'1', sourcePoint, targetPoint });
      elementToCell[el.id] = id;
      return id;
    }

    for(const el of elements){
      if(el.isDeleted) continue;
      if(el.type === 'text'){
        // process later (to attach to container / edge if needed)
        deferredText.push(el);
        continue;
      }
      if(['rectangle','ellipse','diamond','freedraw','image'].includes(el.type)){
        const x = (el.x - minX) || 0;
        const y = (el.y - minY) || 0;
        const w = Math.max(1, Math.round(el.width || 100));
        const h = Math.max(1, Math.round(el.height || 50));
        let extraStyle = '';
        if(el.type === 'image'){
          const dataUrl = resolveImageDataURL(data, el);
          if(dataUrl){
            extraStyle = 'shape=image;verticalLabelPosition=bottom;labelBackgroundColor=none;imageAspect=1;aspect=fixed;image=' + dataUrl;
          } else {
            const placeholder = encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='64' height='64' fill='#eee' stroke='#999'/><text x='32' y='36' font-size='10' text-anchor='middle' fill='#666'>IMG?</text></svg>");
            extraStyle = 'shape=image;image=data:image/svg+xml,'+placeholder;
          }
        }
        let geomX = x, geomY = y, geomW = w, geomH = h;
        if(el.type === 'freedraw'){
          const payload = freedrawImagePayload(el);
          if(payload){
            extraStyle = 'shape=image;image=' + payload.dataUri;
            // adjust geometry to bounding box top-left (x + minX/minY) if offsets differ
            geomX = (el.x + payload.offsetX) - minX;
            geomY = (el.y + payload.offsetY) - minY;
            geomW = payload.width; geomH = payload.height;
          }
        }
        const style = styleForElement(el, extraStyle);
        addVertex(el, style, '', '1', geomX, geomY, geomW, geomH);
      } else if(['line','arrow'].includes(el.type)){
        const style = lineStyle(el);
        let x1 = el.x, y1 = el.y;
        let x2 = el.x + (el.width || 0), y2 = el.y + (el.height || 0);
        let waypoints = [];
        if(el.points && el.points.length > 1){
          x1 = el.x + el.points[0][0]; y1 = el.y + el.points[0][1];
          const lp = el.points[el.points.length - 1];
            x2 = el.x + lp[0]; y2 = el.y + lp[1];
          if(el.points.length > 2){
            for(let i=1;i<el.points.length-1;i++){
              const p = el.points[i];
              waypoints.push({x: (el.x + p[0]) - minX, y: (el.y + p[1]) - minY});
            }
          }
        }
        x1 -= minX; y1 -= minY; x2 -= minX; y2 -= minY;
        const edgeId = addEdge(el, style, '', {x:x1,y:y1}, {x:x2,y:y2});
        if(waypoints.length){
          const edgeObj = cellObjs.find(c => c.id === edgeId);
          if(edgeObj) edgeObj.points = waypoints; // store for serialization
        }
      }
    }

    // Second pass: text elements
    for(const el of deferredText){
      const rawValue = buildPlainTextValue(el); // simpler value (preserve line breaks & special chars)
      const style = styleForTextElement(el);
      const w = Math.max(1, Math.round(el.width || (el.fontSize?el.fontSize*6:100)));
      const h = Math.max(1, Math.round(el.height || (el.fontSize?el.fontSize*1.2:40)));
      const x = (el.x - minX) || 0;
      const y = (el.y - minY) || 0;

      if(el.containerId && elementToCell[el.containerId]){
        const containerEl = elements.find(e => e.id === el.containerId);
        const parentCellId = elementToCell[el.containerId];
        // If the container is an edge, attach as label to edge cell
        if(containerEl && ['arrow','line'].includes(containerEl.type)){
          // Find edge cell object and update its value/style
            const edgeObj = cellObjs.find(c => c.id === parentCellId);
            if(edgeObj){
              edgeObj.value = rawValue; // draw.io will render HTML since html=1 in style
              // ensure html=1 present
              if(!/html=1/.test(edgeObj.style)) edgeObj.style += ';html=1';
              // Add font styling if absent
              const edgeAdditions = [];
              if(el.fontSize && !/fontSize=/.test(edgeObj.style)) edgeAdditions.push(`fontSize=${scaleFont(el.fontSize)}`);
              if(el.fontFamily && !/fontFamily=/.test(edgeObj.style)) edgeAdditions.push(`fontFamily=${mapFontFamily(el.fontFamily)}`);
              if(edgeAdditions.length) edgeObj.style += ';' + edgeAdditions.join(';');
            }
            continue;
        }
        // If container is a shape (rectangle/ellipse/diamond/image/freedraw), merge text into parent shape cell
        if(containerEl && ['rectangle','ellipse','diamond','image','freedraw'].includes(containerEl.type)){
          const parentObj = cellObjs.find(c => c.id === parentCellId);
          if(parentObj){
            // Build richer HTML value using container width, not auto-resized text width
            const htmlValue = buildContainerTextValue(el, Math.round(containerEl.width || w));
            parentObj.value = htmlValue;
            // Augment style with text properties
            const additions = [];
            if(!/html=1/.test(parentObj.style)) additions.push('html=1');
            // Align
            if(!/;align=/.test(parentObj.style)) additions.push(`align=${el.textAlign||'left'}`);
            const vAlign = el.verticalAlign === 'middle' ? 'middle' : (el.verticalAlign === 'bottom' ? 'bottom' : 'top');
            if(!/verticalAlign=/.test(parentObj.style)) additions.push(`verticalAlign=${vAlign}`);
            if(el.fontSize && !/fontSize=/.test(parentObj.style)) additions.push(`fontSize=${Math.round(el.fontSize)}`);
            if(el.fontFamily && !/fontFamily=/.test(parentObj.style)) additions.push(`fontFamily=${mapFontFamily(el.fontFamily)}`);
            if(!/whiteSpace=/.test(parentObj.style)) additions.push('whiteSpace=wrap');
            // ensure text color approximated via strokeColor (already present) so skip explicit
            if(additions.length) parentObj.style += ';' + additions.join(';');
          }
          continue;
        }
        // Fallback: treat as child vertex
        const relX = el.x - (containerEl ? containerEl.x : 0);
        const relY = el.y - (containerEl ? containerEl.y : 0);
        addVertex(el, style, rawValue, parentCellId, relX, relY, w, h);
      } else {
        // standalone text
        addVertex(el, style, rawValue, '1', x, y, w, h);
      }
    }

    // Root and layer
    const rootXml = ['<mxCell id="0"/>','<mxCell id="1" parent="0"/>'];
    const cellXml = cellObjs.map(c => {
      if(c.vertex){
        return `<mxCell id="${c.id}" value="${encodeXml(c.value)}" style="${encodeXml(c.style)}" vertex="1" parent="${c.parent}"><mxGeometry x="${c.geom.x}" y="${c.geom.y}" width="${c.geom.w}" height="${c.geom.h}" as="geometry"/></mxCell>`;
      } else if(c.edge){
        let pointsXml = '';
        if(c.points && c.points.length){
          pointsXml = '<Array as="points">' + c.points.map(p => `<mxPoint x="${p.x}" y="${p.y}"/>`).join('') + '</Array>';
        }
        return `<mxCell id="${c.id}" value="${encodeXml(c.value)}" style="${encodeXml(c.style)}" edge="1" parent="${c.parent}" source="" target=""><mxGeometry relative="1" as="geometry">${pointsXml}<mxPoint x="${c.sourcePoint.x}" y="${c.sourcePoint.y}" as="sourcePoint"/><mxPoint x="${c.targetPoint.x}" y="${c.targetPoint.y}" as="targetPoint"/></mxGeometry></mxCell>`;
      }
      return '';
    });

    const diagramName = 'Page-1';
    // Pretty-print with 2-space indentation
    const IND = '  ';
    const lines = [];
    lines.push(`<mxfile host="app.diagrams.net" modified="${new Date().toISOString()}" agent="excalidraw-converter" version="20.6.3" type="device">`);
    lines.push(`${IND}<diagram id="d1" name="${diagramName}">`);
    lines.push(`${IND}${IND}<mxGraphModel dx="1024" dy="1024" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">`);
    lines.push(`${IND}${IND}${IND}<root>`);
    for(const c of rootXml){ lines.push(`${IND}${IND}${IND}${IND}${c}`); }
    for(const c of cellXml){ lines.push(`${IND}${IND}${IND}${IND}${c}`); }
    lines.push(`${IND}${IND}${IND}</root>`);
    lines.push(`${IND}${IND}</mxGraphModel>`);
    lines.push(`${IND}</diagram>`);
    lines.push(`</mxfile>`);
    return lines.join('\n');
  }

  function buildTextValue(el){
    const raw = el.text || '';
    const lines = raw.split(/\n/).map(l => encodeXml(l));
    const align = el.textAlign || 'left';
    const fontSize = scaleFont(el.fontSize || 16);
    const color = el.strokeColor || '#000000';
    const outerWidth = (el.width || (fontSize * 6)).toFixed(3);
    return `<div style="width: ${outerWidth}px;height:auto;word-break: break-word;line-height:1em;"><div align="${align}"><span style="font-size: ${fontSize}px; line-height: 0;"><span style="line-height: 0;"><span style="color: ${color}; font-size: ${fontSize}px; line-height: 16.5px;">${lines.join('<br>')}</span><br></span></span></div></div>`;
  }

  function styleForTextElement(el){
    const parts = ['text','html=1','nl2Br=0'];
    const align = el.textAlign || 'left';
    const vAlign = el.verticalAlign === 'middle' ? 'middle' : (el.verticalAlign === 'bottom' ? 'bottom' : 'top');
    parts.push(`align=${align}`);
    parts.push(`verticalAlign=${vAlign}`);
    if(el.fontSize) parts.push(`fontSize=${scaleFont(el.fontSize)}`);
    if(el.fontFamily) parts.push(`fontFamily=${mapFontFamily(el.fontFamily)}`);
    parts.push('spacingLeft=0');
    parts.push('spacingRight=0');
    parts.push('spacingTop=0');
    parts.push('spacingBottom=0');
    parts.push('whiteSpace=wrap');
    parts.push('strokeColor=none');
    parts.push('fillColor=none');
    if(el.angle){
      const deg = (el.angle * 180 / Math.PI) % 360;
      parts.push(`rotation=${deg}`);
    }
    if(typeof el.opacity === 'number' && el.opacity !== 100){
      parts.push(`opacity=${Number(el.opacity).toFixed(1)}`);
    }
    return parts.join(';');
  }

  // Simpler plain text value (allow < & > etc), multi-line via <br>
  function buildPlainTextValue(el){
    const raw = el.text || '';
    return raw.split(/\n/).map(line => encodeXml(line)).join('<br>');
  }

  function buildContainerTextValue(el, containerWidth){
    const raw = el.text || '';
    const lines = raw.split(/\n/).map(l => encodeXml(l));
    const align = el.textAlign || 'left';
    const fontSize = scaleFont(el.fontSize || 16);
    const color = el.strokeColor || '#000000';
    const outerWidth = (containerWidth || fontSize * 6).toFixed(1);
    return `<div style="width: ${outerWidth}px;height:auto;word-break: break-word;line-height:1em;"><div align="${align}"><span style="font-size: ${fontSize}px; line-height: 0;"><span style="line-height: 0;"><span style="color: ${color}; font-size: ${fontSize}px; line-height: 16.5px;">${lines.join('<br>')}</span><br></span></span></div></div>`;
  }

  function freedrawImagePayload(el){
    if(!el.points || el.points.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for(const [px,py] of el.points){
      if(px < minX) minX = px; if(py < minY) minY = py;
      if(px > maxX) maxX = px; if(py > maxY) maxY = py;
    }
    if(!isFinite(minX) || !isFinite(minY)) return null;
    // normalized path
    const normPts = el.points.map(([px,py]) => [px - minX, py - minY]);
    const width = Math.max(1, Math.round(maxX - minX));
    const height = Math.max(1, Math.round(maxY - minY));
    const stroke = el.strokeColor || '#000000';
    const strokeWidth = Math.max(1, Math.round(el.strokeWidth || 1));
    const hasFill = el.backgroundColor && el.backgroundColor !== 'transparent';
    const fillColor = hasFill ? el.backgroundColor : 'none';
    const isClosed = el.points.length > 2 && Math.abs(el.points[0][0]-el.points[el.points.length-1][0]) < 0.01 && Math.abs(el.points[0][1]-el.points[el.points.length-1][1]) < 0.01;
    const d = normPts.map((p,i)=> (i===0?`M${p[0].toFixed(2)} ${p[1].toFixed(2)}`:`L${p[0].toFixed(2)} ${p[1].toFixed(2)}`)).join(' ') + (isClosed? ' Z':'');
    const fillOpacity = (typeof el.opacity === 'number' && el.opacity !== 100) ? (el.opacity/100).toFixed(2) : (hasFill ? '1' : '0');
    const strokeOpacity = (typeof el.opacity === 'number' && el.opacity !== 100) ? (el.opacity/100).toFixed(2) : '1';
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}'><path d='${d}' stroke='${stroke}' stroke-width='${strokeWidth}' stroke-linecap='round' stroke-linejoin='round' fill='${fillColor}' fill-opacity='${fillOpacity}' stroke-opacity='${strokeOpacity}'/></svg>`;
    return { dataUri: 'data:image/svg+xml,' + encodeURIComponent(svg), offsetX: minX, offsetY: minY, width, height };
  }

  global.ExcDrawio = { convertExcalidrawToDrawio: convert };
})(window);

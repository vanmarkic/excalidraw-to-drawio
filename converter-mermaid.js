// Excalidraw -> Mermaid flowchart converter
// Maps Excalidraw shapes to Mermaid flowchart nodes and edges.
// Mermaid auto-layouts so position information is lost; connections
// are preserved via Excalidraw arrow bindings.

(function(global){
  'use strict';

  function sanitizeId(id){
    // Mermaid node IDs must be alphanumeric (with underscores)
    return 'n_' + String(id).replace(/[^a-zA-Z0-9_]/g, '_');
  }

  function escapeLabel(text){
    if(!text) return ' ';
    // Mermaid uses quotes for labels with special chars
    return text.replace(/\\/g, '\\\\').replace(/"/g, "'").replace(/\n/g, '<br/>');
  }

  function nodeShape(el, label){
    const id = sanitizeId(el.id);
    const lbl = escapeLabel(label);
    switch(el.type){
      case 'ellipse':
        return `${id}(["${lbl}"])`;
      case 'diamond':
        return `${id}{"${lbl}"}`;
      case 'rectangle':
      default:
        if(el.roundness && el.roundness.type > 0){
          return `${id}("${lbl}")`;
        }
        return `${id}["${lbl}"]`;
    }
  }

  function edgeArrow(el){
    const hasDash = el.strokeStyle === 'dashed' || el.strokeStyle === 'dotted';
    const hasStart = el.startArrowhead && el.startArrowhead !== 'none';
    const hasEnd = (el.endArrowhead && el.endArrowhead !== 'none') ||
                   (el.type === 'arrow'); // arrows have implicit end arrowhead

    if(hasDash){
      if(hasStart && hasEnd) return '<-.->';
      if(hasEnd) return '-.->';
      if(hasStart) return '<-.-';
      return '-.-';
    }
    if(hasStart && hasEnd) return '<-->';
    if(hasEnd) return '-->';
    if(hasStart) return '<--';
    return '---';
  }

  function colorToHex(c){
    if(!c || c === 'transparent' || c === 'none') return null;
    if(/^#[0-9a-fA-F]{3,8}$/.test(c)) return c;
    return c;
  }

  function convert(excalidata){
    const data = (typeof excalidata === 'string') ? JSON.parse(excalidata) : excalidata;
    const elements = (data.elements || []).filter(e => !e.isDeleted);

    // Index elements by id
    const byId = {};
    for(const el of elements) byId[el.id] = el;

    // Collect shape elements (nodes) and their labels from bound text
    const shapeTypes = ['rectangle','ellipse','diamond','freedraw','image'];
    const shapes = elements.filter(e => shapeTypes.includes(e.type));
    const edges = elements.filter(e => e.type === 'arrow' || e.type === 'line');
    const texts = elements.filter(e => e.type === 'text');

    // Build a map: containerId -> text content (for labels inside shapes)
    const containerText = {};
    for(const t of texts){
      if(t.containerId && byId[t.containerId]){
        containerText[t.containerId] = t.text || '';
      }
    }

    // Build a map: edge id -> label text (text bound to arrow/line)
    const edgeLabels = {};
    for(const t of texts){
      if(t.containerId && byId[t.containerId]){
        const container = byId[t.containerId];
        if(container.type === 'arrow' || container.type === 'line'){
          edgeLabels[t.containerId] = t.text || '';
        }
      }
    }

    // Track which shapes are referenced by at least one edge
    const connectedShapes = new Set();

    // Build edge lines
    const edgeLines = [];
    for(const e of edges){
      const startId = e.startBinding && e.startBinding.elementId;
      const endId = e.endBinding && e.endBinding.elementId;
      if(!startId || !endId) continue; // skip unbound edges
      if(!byId[startId] || !byId[endId]) continue;

      connectedShapes.add(startId);
      connectedShapes.add(endId);

      const arrow = edgeArrow(e);
      const label = edgeLabels[e.id];
      const src = sanitizeId(startId);
      const tgt = sanitizeId(endId);

      if(label){
        edgeLines.push(`    ${src} ${arrow}|"${escapeLabel(label)}"| ${tgt}`);
      } else {
        edgeLines.push(`    ${src} ${arrow} ${tgt}`);
      }
    }

    // Build node declarations (declare all shapes, even disconnected ones)
    const nodeLines = [];
    for(const s of shapes){
      const label = containerText[s.id] || '';
      nodeLines.push(`    ${nodeShape(s, label)}`);
    }

    // Standalone text elements (not bound to any shape/edge)
    const standaloneTexts = texts.filter(t => !t.containerId);
    const standaloneLines = [];
    for(const t of standaloneTexts){
      const id = sanitizeId(t.id);
      const lbl = escapeLabel(t.text || '');
      standaloneLines.push(`    ${id}["${lbl}"]:::textNode`);
    }

    // Build style lines for nodes with colors
    const styleLines = [];
    for(const s of shapes){
      const id = sanitizeId(s.id);
      const fill = colorToHex(s.backgroundColor);
      const stroke = colorToHex(s.strokeColor);
      const parts = [];
      if(fill) parts.push(`fill:${fill}`);
      if(stroke) parts.push(`stroke:${stroke}`);
      if(s.strokeWidth && s.strokeWidth !== 1) parts.push(`stroke-width:${Math.round(s.strokeWidth)}px`);
      if(typeof s.opacity === 'number' && s.opacity !== 100){
        parts.push(`opacity:${(s.opacity / 100).toFixed(2)}`);
      }
      if(parts.length) styleLines.push(`    style ${id} ${parts.join(',')}`);
    }

    // Assemble output
    const lines = [];
    lines.push('flowchart TD');

    if(nodeLines.length){
      lines.push('    %% Nodes');
      lines.push(...nodeLines);
    }
    if(standaloneLines.length){
      lines.push('    %% Standalone text');
      lines.push(...standaloneLines);
    }
    if(edgeLines.length){
      lines.push('');
      lines.push('    %% Edges');
      lines.push(...edgeLines);
    }
    if(styleLines.length){
      lines.push('');
      lines.push('    %% Styling');
      lines.push(...styleLines);
    }
    if(standaloneLines.length){
      lines.push('');
      lines.push('    classDef textNode fill:none,stroke:none');
    }

    return lines.join('\n');
  }

  global.ExcMermaid = { convertExcalidrawToMermaid: convert };
})(window);

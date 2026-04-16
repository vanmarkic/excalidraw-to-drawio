// Excalidraw -> Klaxoon board JSON converter
// Produces a structured JSON representation compatible with Klaxoon's
// board data model: cards (sticky notes / shapes), connectors, and
// text annotations with position, dimensions, and styling preserved.

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

  function mapShapeType(elType){
    switch(elType){
      case 'rectangle': return 'card';
      case 'ellipse':   return 'card';
      case 'diamond':   return 'card';
      case 'freedraw':  return 'drawing';
      case 'image':     return 'image';
      default:          return 'card';
    }
  }

  function mapCardShape(elType){
    switch(elType){
      case 'rectangle': return 'rectangle';
      case 'ellipse':   return 'ellipse';
      case 'diamond':   return 'diamond';
      default:          return 'rectangle';
    }
  }

  function mapStrokeStyle(s){
    if(s === 'dashed') return 'dashed';
    if(s === 'dotted') return 'dotted';
    return 'solid';
  }

  function mapArrowHead(head){
    switch(head){
      case 'arrow':
      case 'triangle': return 'arrow';
      case 'dot':      return 'circle';
      case 'diamond':  return 'diamond';
      case 'bar':      return 'bar';
      case 'none':     return 'none';
      default:         return 'none';
    }
  }

  function convert(excalidata){
    const data = (typeof excalidata === 'string') ? JSON.parse(excalidata) : excalidata;
    const elements = (data.elements || []).filter(e => !e.isDeleted);

    const byId = {};
    for(const el of elements) byId[el.id] = el;

    // Collect text bindings
    const containerText = {};
    const edgeLabels = {};
    const texts = elements.filter(e => e.type === 'text');
    for(const t of texts){
      if(t.containerId && byId[t.containerId]){
        const container = byId[t.containerId];
        if(container.type === 'arrow' || container.type === 'line'){
          edgeLabels[t.containerId] = t.text || '';
        } else {
          containerText[t.containerId] = t.text || '';
        }
      }
    }

    const board = {
      version: '1.0',
      type: 'klaxoon-board',
      metadata: {
        title: 'Excalidraw Import',
        createdAt: new Date().toISOString(),
        source: 'excalidraw-converter'
      },
      items: [],
      connectors: []
    };

    // Map excalidraw IDs to klaxoon IDs
    const idMap = {};

    // Process shapes
    const shapeTypes = ['rectangle','ellipse','diamond','freedraw','image'];
    for(const el of elements){
      if(!shapeTypes.includes(el.type)) continue;

      const klxId = uuid();
      idMap[el.id] = klxId;

      const item = {
        id: klxId,
        type: mapShapeType(el.type),
        shape: mapCardShape(el.type),
        position: {
          x: Math.round(el.x || 0),
          y: Math.round(el.y || 0)
        },
        size: {
          width: Math.max(1, Math.round(el.width || 100)),
          height: Math.max(1, Math.round(el.height || 50))
        },
        content: containerText[el.id] || '',
        style: {
          backgroundColor: mapColor(el.backgroundColor) || null,
          borderColor: mapColor(el.strokeColor) || '#000000',
          borderWidth: Math.max(1, Math.round(el.strokeWidth || 1)),
          borderStyle: mapStrokeStyle(el.strokeStyle),
          opacity: typeof el.opacity === 'number' ? el.opacity / 100 : 1
        }
      };

      if(el.angle){
        item.rotation = Math.round((el.angle * 180 / Math.PI) % 360);
      }

      if(el.roundness && el.roundness.type > 0){
        item.style.borderRadius = 12;
      }

      if(el.type === 'image' && data.files && el.fileId){
        const f = data.files[el.fileId];
        if(f){
          item.imageData = f.dataURL || f.data || null;
          item.mimeType = f.mimeType || 'image/png';
        }
      }

      board.items.push(item);
    }

    // Standalone text elements
    for(const t of texts){
      if(t.containerId) continue;
      const klxId = uuid();
      idMap[t.id] = klxId;

      board.items.push({
        id: klxId,
        type: 'text',
        position: {
          x: Math.round(t.x || 0),
          y: Math.round(t.y || 0)
        },
        size: {
          width: Math.max(1, Math.round(t.width || 100)),
          height: Math.max(1, Math.round(t.height || 30))
        },
        content: t.text || '',
        style: {
          fontSize: t.fontSize || 16,
          fontFamily: t.fontFamily || 1,
          textAlign: t.textAlign || 'left',
          color: mapColor(t.strokeColor) || '#000000',
          opacity: typeof t.opacity === 'number' ? t.opacity / 100 : 1
        }
      });
    }

    // Process edges (arrows and lines)
    for(const el of elements){
      if(el.type !== 'arrow' && el.type !== 'line') continue;

      const connector = {
        id: uuid(),
        type: 'connector',
        style: {
          strokeColor: mapColor(el.strokeColor) || '#000000',
          strokeWidth: Math.max(1, Math.round(el.strokeWidth || 1)),
          strokeStyle: mapStrokeStyle(el.strokeStyle),
          opacity: typeof el.opacity === 'number' ? el.opacity / 100 : 1,
          startArrow: mapArrowHead(el.startArrowhead),
          endArrow: el.type === 'arrow'
            ? mapArrowHead(el.endArrowhead || 'arrow')
            : mapArrowHead(el.endArrowhead)
        },
        label: edgeLabels[el.id] || null
      };

      // Bindings
      if(el.startBinding && el.startBinding.elementId && idMap[el.startBinding.elementId]){
        connector.sourceId = idMap[el.startBinding.elementId];
      }
      if(el.endBinding && el.endBinding.elementId && idMap[el.endBinding.elementId]){
        connector.targetId = idMap[el.endBinding.elementId];
      }

      // Points (absolute positions)
      if(el.points && el.points.length > 0){
        connector.points = el.points.map(function(p){
          return {
            x: Math.round(el.x + p[0]),
            y: Math.round(el.y + p[1])
          };
        });
      } else {
        connector.points = [
          { x: Math.round(el.x), y: Math.round(el.y) },
          { x: Math.round(el.x + (el.width || 0)), y: Math.round(el.y + (el.height || 0)) }
        ];
      }

      board.connectors.push(connector);
    }

    return JSON.stringify(board, null, 2);
  }

  global.ExcKlaxoon = { convertExcalidrawToKlaxoon: convert };
})(window);

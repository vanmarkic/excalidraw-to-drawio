(function(){
  const fileInput = document.getElementById('fileInput');
  const inputText = document.getElementById('inputText');
  const downloadBtn = document.getElementById('downloadBtn');
  const outputText = document.getElementById('outputText');
  const info = document.getElementById('info');
  const sampleBtn = document.getElementById('sampleBtn');

  let lastOutput = '';
  let fileBaseName = 'diagram';

  async function performConversion(){
    info.textContent = '';
    outputText.value = '';
    downloadBtn.disabled = true;
    try {
      const data = inputText.value.trim();
      if(!data) return;
      const out = window.ExcDrawio.convertExcalidrawToDrawio(data);
      outputText.value = out;
      lastOutput = out;
      downloadBtn.disabled = false;
      info.textContent = `Conversion successful. Ready to download ${fileBaseName}.drawio`;
    } catch(err){
      console.error(err);
      info.textContent = 'Error: ' + (err && err.message ? err.message : String(err));
    }
  }

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if(!file) return;
    let rawText = await file.text();

    let extracted = false;
    if(/\.svg$/i.test(file.name) || /<svg[\s>]/i.test(rawText.slice(0, 500))){
      try {
        const sceneJSON = await extractExcalidrawFromSVG(rawText);
        if(sceneJSON){
          rawText = sceneJSON; extracted = true;
          info.textContent = `Extracted embedded Excalidraw scene from SVG (${file.name}). Converting...`;
        } else {
          info.textContent = `No embedded Excalidraw scene found in SVG (${file.name}).`;
        }
      } catch(ex){
        console.warn('SVG extraction failed:', ex);
        info.textContent = `Failed to extract Excalidraw data from SVG: ${ex.message}`;
      }
    }

    inputText.value = rawText;
    const base = file.name.replace(/(\.excalidraw|\.json|\.svg)$/i,'') || 'diagram';
    fileBaseName = base;
    if(!info.textContent)
      info.textContent = `Loaded file: ${file.name} (${file.size} bytes). Converting...`;
    if(extracted || /^[\s\r\n]*\{/.test(rawText)){
      await performConversion();
    } else {
      downloadBtn.disabled = true;
    }
  });

  // Advanced SVG extraction (ported from web-excalidraw-convert)
  async function extractExcalidrawFromSVG(svgText){
    let doc;
    try {
      doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      const parserErr = doc.querySelector('parsererror');
      if(parserErr) throw new Error('Invalid SVG');
    } catch(err){
      console.warn('DOMParser failed, continuing with regex fallbacks', err);
    }

    // 1. <excalidraw> tag via DOM
    if(doc){
      const excali = doc.querySelector('excalidraw');
      if(excali){
        const t = decodeHTMLEntities(excali.textContent || '').trim();
        if(isLikelyExcalidrawJSON(t)) return prettyIfJSON(t);
      }
    }

    // 2. <script type="application/json" id="excalidraw"> or data-excalidraw
    if(doc){
      const script = doc.querySelector('script#excalidraw[type="application/json"],script[type="application/json"][data-excalidraw]');
      if(script){
        const t = script.textContent || '';
        if(isLikelyExcalidrawJSON(t)) return prettyIfJSON(t);
      }
    }

    // 3. metadata payload-start/payload-end base64 encoded structure
    if(doc){
      const metaEl2 = doc.querySelector('metadata');
      if(metaEl2){
        const metaHTML = metaEl2.innerHTML || '';
        const payloadMatch = metaHTML.match(/<!--\s*payload-start\s*-->([A-Za-z0-9+/=]+)<!--\s*payload-end\s*-->/i);
        if(payloadMatch){
          try {
            const decodedMeta = await decodeEmbeddedExcalidrawPayload(payloadMatch[1]);
            if(decodedMeta) return decodedMeta;
          } catch(ex){ console.warn('Failed to decode payload-start block', ex); }
        }
      }
    }

    // 4. <metadata> plain JSON or base64 blobs
    if(doc){
      const metaEl = doc.querySelector('metadata');
      if(metaEl){
        const metaText = metaEl.textContent || '';
        const jsonCandidate = findFirstJSON(metaText, /"type"\s*:\s*"excalidraw"/);
        if(jsonCandidate && isLikelyExcalidrawJSON(jsonCandidate)) return prettyIfJSON(jsonCandidate);
        const maybeBase64 = metaText.match(/[A-Za-z0-9+/=]{200,}/g) || [];
        for(const chunk of maybeBase64){
          try {
            const decoded = atob(chunk.replace(/\s+/g,''));
            if(isLikelyExcalidrawJSON(decoded)) return prettyIfJSON(decoded);
          } catch{/* ignore */}
        }
      }
    }

    // 5. Regex <excalidraw> tag fallback
    const excaliTagMatch = svgText.match(/<excalidraw>([\s\S]*?)<\/excalidraw>/i);
    if(excaliTagMatch){
      const inner = decodeHTMLEntities(excaliTagMatch[1].trim());
      if(isLikelyExcalidrawJSON(inner)) return prettyIfJSON(inner);
    }

    // 6. Regex metadata fallback
    const metadataMatch = svgText.match(/<metadata[\s\S]*?>[\s\S]*?<\/metadata>/i);
    if(metadataMatch){
      const meta = metadataMatch[0];
      const jsonCandidate = findFirstJSON(meta, /"type"\s*:\s*"excalidraw"/);
      if(jsonCandidate && isLikelyExcalidrawJSON(jsonCandidate)) return prettyIfJSON(jsonCandidate);
    }

    // 7. Global JSON scan last resort
    const globalJSON = findFirstJSON(svgText, /"type"\s*:\s*"excalidraw"/);
    if(globalJSON && isLikelyExcalidrawJSON(globalJSON)) return prettyIfJSON(globalJSON);

    return null;
  }

  async function decodeEmbeddedExcalidrawPayload(base64Str){
    const jsonStr = atob(base64Str);
    let meta;
    try { meta = JSON.parse(jsonStr); } catch{ return null; }
    if(meta && meta.compressed && meta.encoded){
      const bytes = new Uint8Array(meta.encoded.split('').map(c => c.charCodeAt(0) & 0xff));
      const txt = await decompressBytes(bytes);
      if(!txt) return null;
      if(isLikelyExcalidrawJSON(txt)) return prettyIfJSON(txt);
      try {
        const inner = JSON.parse(txt);
        if(inner && (inner.type === 'excalidraw' || Array.isArray(inner.elements))){
          return JSON.stringify(inner, null, 2);
        }
      } catch{/* ignore */}
      return null;
    }
    if(meta && meta.data){
      const dataStr = typeof meta.data === 'string' ? meta.data : JSON.stringify(meta.data);
      if(isLikelyExcalidrawJSON(dataStr)) return prettyIfJSON(dataStr);
    }
    return null;
  }

  function decompressBytes(bytes){
    if(typeof DecompressionStream !== 'undefined'){
      const attempt = (format) => {
        try {
          const ds = new DecompressionStream(format);
          const blob = new Blob([bytes]);
          const stream = blob.stream().pipeThrough(ds);
          return new Response(stream).arrayBuffer().then(buf => new TextDecoder('utf-8').decode(buf)).catch(()=>null);
        } catch{ return Promise.resolve(null); }
      };
      return attempt('deflate').then(res => res || attempt('deflate-raw')).then(res => res || attempt('gzip'));
    }
    console.warn('No DecompressionStream support; cannot decompress embedded Excalidraw scene.');
    return Promise.resolve(null);
  }

  function decodeHTMLEntities(str){
    return str
      .replaceAll(/&quot;/g, '"')
      .replaceAll(/&#39;/g, "'")
      .replaceAll(/&lt;/g, '<')
      .replaceAll(/&gt;/g, '>')
      .replaceAll(/&amp;/g, '&');
  }
  function isLikelyExcalidrawJSON(str){
    try { const obj = JSON.parse(str); return obj && (obj.type === 'excalidraw' || Array.isArray(obj.elements)); } catch{ return false; }
  }
  function prettyIfJSON(str){ try { return JSON.stringify(JSON.parse(str), null, 2); } catch{ return str; } }

  function findFirstJSON(haystack, requiredPattern){
    const idxs = [];
    for(let i=0;i<haystack.length;i++) if(haystack[i] === '{') idxs.push(i);
    for(const start of idxs){
      let depth = 0;
      for(let end=start; end < haystack.length; end++){
        const ch = haystack[end];
        if(ch === '{') depth++; else if(ch === '}') depth--;
        if(depth === 0){
          const snippet = haystack.slice(start, end+1);
          if(!requiredPattern || requiredPattern.test(snippet)){
            try { JSON.parse(snippet); return snippet; } catch{}
          }
          break;
        }
      }
    }
    return null;
  }

  sampleBtn.addEventListener('click', async () => {
    const tiny = JSON.stringify({
      type: 'excalidraw', version: 2, source: 'web',
      appState: { viewBackgroundColor: '#ffffff', gridSize: 10 },
      elements: [
        { type: 'rectangle', id: 'r1', x: 50, y: 50, width: 120, height: 60, strokeColor: '#1f2937', backgroundColor: 'transparent', strokeWidth: 2, strokeStyle: 'solid', opacity: 100, angle: 0, roundness: { type: 0 } },
        { type: 'text', id: 't1', x: 60, y: 60, width: 100, height: 20, text: 'Hello', fontSize: 18, fontFamily: 1, textAlign: 'left', verticalAlign: 'top', strokeColor: '#111827', opacity: 100 }
      ],
      files: {}
    }, null, 2);
    inputText.value = tiny; fileBaseName = 'sample';
    info.textContent = 'Loaded tiny inline sample. Converting...';
    await performConversion();
  });

  let debounceTimer;
  inputText.addEventListener('input', () => {
    if(debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if(!fileInput.files?.length) fileBaseName = 'diagram';
      performConversion();
    }, 500);
  });

  downloadBtn.addEventListener('click', () => {
    if(!lastOutput) return;
    const blob = new Blob([lastOutput], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${fileBaseName}.drawio`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
})();

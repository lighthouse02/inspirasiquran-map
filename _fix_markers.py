import pathlib

fp = pathlib.Path(r'c:\Users\muadz\inspirasiquran-map\index.html')
src = fp.read_text(encoding='utf-8')

# Find the block by searching for the unique anchor lines
start_anchor = "          if(it.lat!=null && it.lng!=null){\n            // Distinctive marker: green for distributions, red for other activity types"
end_anchor   = "            markersById[it.id] = m;\n          }"

si = src.find(start_anchor)
ei = src.find(end_anchor, si) + len(end_anchor)

if si == -1 or ei <= len(end_anchor):
    print("ERROR: could not find markers block")
    exit(1)

old_block = src[si:ei]
print("Found block, length:", len(old_block))

new_block = r"""          if(it.lat!=null && it.lng!=null){
            var typeKey = typeKeyFromItem(it);
            var isDistribution = (typeKey === 'distribution');

            // Build DivIcon — type-keyed colour dot with pulsing ring for distribution
            var markerClass = 'lf-marker lf-marker--' + (typeKey || 'other');
            var ringHtml = isDistribution ? '<span class="lf-marker__ring"></span>' : '';
            var icon = L.divIcon({
              className: '',
              html: '<div class="' + markerClass + '">' + ringHtml + '<span class="lf-marker__dot"></span></div>',
              iconSize:   isDistribution ? [30, 30] : [20, 20],
              iconAnchor: isDistribution ? [15, 15] : [10, 10],
              popupAnchor:[0, isDistribution ? -15 : -10]
            });
            const m = L.marker([it.lat, it.lng], { icon: icon });
            // try to add to markerLayer, fallback to map if markerLayer isn't a proper LayerGroup
            try{ if(markerLayer && typeof markerLayer.addLayer === 'function'){ markerLayer.addLayer(m); } else { m.addTo(map); } }catch(e){ try{ m.addTo(map); }catch(_){ console.warn('Failed to add marker to any layer', _); } }

            // Build popup
            const popupTitle   = escapeHtml(it.title || '');
            const popupLoc     = escapeHtml(it.location || '');
            const popupNote    = escapeHtml(it.note || '');
            const popupCount   = it.count ? escapeHtml(String(it.count) + ' Mushaf') : '';
            const popupMission = String(it.mission || '').trim();
            const popupHighlights = String(it.highlights || '').trim();
            const typeLabel = String(it.activity_type || '').trim();

            var typeColor = isDistribution ? '#BEAA8D' : (typeKey==='program'?'#6fa8dc':typeKey==='meeting'?'#93c47d':typeKey==='media'?'#c27ba0':typeKey==='logistics'?'#f6b26b':'#aaa');

            const typePill = typeLabel ? `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:${typeColor};margin-bottom:10px;">${escapeHtml(typeLabel)}</span>` : '';
            const missionRow = popupMission ? `<div style="display:flex;align-items:flex-start;gap:6px;margin-top:6px;font-size:12px;color:#9a9288;"><span style="flex-shrink:0;opacity:.6;">Mission</span><span style="color:#e0dbd0;font-weight:600;">${escapeHtml(popupMission)}</span></div>` : '';
            const noteRow = popupNote ? `<div style="margin-top:6px;font-size:12px;color:#9a9288;line-height:1.45;">${popupNote}</div>` : '';
            const highlightsTextHtml = popupHighlights ? escapeHtml(popupHighlights).replace(/\r?\n/g,'<br>') : '';
            const highlightsRow = popupHighlights ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.06);font-size:12px;color:#c8c0b4;font-style:italic;line-height:1.5;">&ldquo;${highlightsTextHtml}&rdquo;</div>` : '';
            const countRow = popupCount ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.06);"><span style="font-size:18px;font-weight:800;color:#BEAA8D;">${escapeHtml(popupCount)}</span></div>` : '';

            m.bindPopup(
              `<div style="font-family:Inter,system-ui,Arial;color:#f4f2ee;">`
              + typePill
              + `<div style="font-weight:800;font-size:14px;line-height:1.35;margin-bottom:4px;">${popupTitle}</div>`
              + (popupLoc ? `<div style="font-size:12px;color:#7a7268;">${popupLoc}</div>` : '')
              + missionRow + noteRow + highlightsRow + countRow
              + `</div>`,
              { maxWidth: 280, minWidth: 200 }
            );
            m._ts = it.date.getTime();
            markersById[it.id] = m;
          }"""

result = src[:si] + new_block + src[ei:]
fp.write_text(result, encoding='utf-8')
print("Done — file updated, new block length:", len(new_block))

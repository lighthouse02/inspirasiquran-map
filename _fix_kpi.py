content = open('index.html', encoding='utf-8').read()

new_html = (
'<div class="kpi-wrap">\n'
'  <div class="kpi-card">\n'
'    <div class="kpi-header">\n'
'      <div class="kpi-title-block">\n'
'        <div class="kpi-eyebrow">Global Progress</div>\n'
'        <div class="kpi-title">Naskhah Al-Qur\u2019an Telah Diedarkan<br>Seluruh Dunia</div>\n'
'      </div>\n'
'      <div class="kpi-stats">\n'
'        <div class="kpi-stat kpi-stat--my">\n'
'          <div class="kpi-stat__label">Malaysia</div>\n'
'          <div class="kpi-stat__value" id="kpi-local-count">31,230</div>\n'
'        </div>\n'
'        <div class="kpi-stat kpi-stat--all">\n'
'          <div class="kpi-stat__label">All</div>\n'
'          <div class="kpi-stat__value" id="kpi-all-count">1,453,456</div>\n'
'        </div>\n'
'        <div class="kpi-stat kpi-stat--tgt">\n'
'          <div class="kpi-stat__label">Target</div>\n'
'          <div class="kpi-stat__value" id="kpi-target">10,000,000</div>\n'
'        </div>\n'
'      </div>\n'
'    </div>\n'
'\n'
'    <div class="progress-outer" aria-label="Global distribution progress" role="progressbar"\n'
'         aria-valuemin="0" aria-valuemax="100" aria-valuenow="14.53">\n'
'      <div id="progressInner" class="progress-inner" style="width:14.53%;"></div>\n'
'    </div>\n'
'    <div class="progress-meta">\n'
'      <span class="progress-meta__pct" id="progressPercent">14.53%</span>\n'
'      <span class="progress-meta__mid">of target reached</span>\n'
'      <span class="progress-meta__tgt">Target: <span id="progressTarget">10,000,000</span></span>\n'
'    </div>\n'
'\n'
'    <div class="kpi-sparkline-row">\n'
'      <span class="kpi-sparkline-row__label">This year</span>\n'
'      <svg id="kpi-sparkline" width="200" height="36" viewBox="0 0 200 36" preserveAspectRatio="none" style="flex:1;max-width:400px"></svg>\n'
'    </div>\n'
'  </div>\n'
'</div>'
)

old_html = (
'<div class="kpi-wrap">\n'
'  <div class="kpi-card">\n'
'    <div class="kpi-row">\n'
'      <div class="kpi-title">Naskhah Al-Qur\u2019an Telah Diedarkan<br>Seluruh Dunia</div>\n'
'      <div class="kpi-numbers">\n'
'        <div class="item">\n'
'          <small>Malaysia</small>\n'
'          <b id="kpi-local-count">31,230</b>\n'
'        </div>\n'
'        <div class="item">\n'
'          <small>All</small>\n'
'          <b id="kpi-all-count">1,453,456</b>\n'
'        </div>\n'
'        <div class="item">\n'
'          <small>Target</small>\n'
'          <b id="kpi-target">10,000,000</b>\n'
'        </div>\n'
'      </div>\n'
'    </div>\n'
'\n'
'    <div class="progress-outer" aria-label="Year progress" role="progressbar" \n'
'         aria-valuemin="0" aria-valuemax="100" aria-valuenow="14.53">\n'
'      <div id="progressInner" class="progress-inner" style="width:14.53%;"></div>\n'
'    </div>\n'
'    <div class="progress-foot">\n'
'      <span id="progressPercent">14.53%</span><span id="progressTarget">10,000,000</span>\n'
'    </div>\n'
'    <div id="kpi-sparkline-wrap" style="margin-top:10px;display:flex;align-items:center;gap:12px;">\n'
'      <div style="font-size:12px;opacity:.85;min-width:92px">Yearly distribution</div>\n'
'      <svg id="kpi-sparkline" width="200" height="40" viewBox="0 0 200 40" preserveAspectRatio="none" style="flex:1;max-width:360px"></svg>\n'
'    </div>\n'
'  </div>\n'
'</div>'
)

if old_html in content:
    result = content.replace(old_html, new_html, 1)
    open('index.html', 'w', encoding='utf-8').write(result)
    print('SUCCESS: KPI card HTML updated')
else:
    print('NOT FOUND')
    # debug: find the closest match
    import difflib
    idx = content.find('<div class="kpi-wrap">')
    if idx >= 0:
        snippet = content[idx:idx+len(old_html)]
        for i,(a,b) in enumerate(zip(old_html, snippet)):
            if a != b:
                print(f'First diff at char {i}: expected {repr(a)} got {repr(b)}')
                print('Context around diff:', repr(old_html[max(0,i-20):i+20]))
                break
        else:
            print('Lengths differ:', len(old_html), 'vs', len(snippet))

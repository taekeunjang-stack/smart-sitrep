/*
 * GIS 디지털 상황판 (ATAK 유사)
 * ---------------------------------------------------------------------------
 * · 전체화면 지도 + 오버레이 구성 (ATAK 관례: 카드형 대시보드가 아니라 지도 위에 얹는다)
 * · 레이어 4종(작전상황 / 훈련·작전 부대 / 차량 GPS / 차량 BMTS)을 켜고 끌 수 있다
 * · 마커나 목록 항목을 누르면 상세 정보를 조회한다
 *
 * 🔴 좌표계 함정 (참고 프로젝트 분석에서 확인)
 *   참고 원본은 마커를 지도 컨테이너 기준 %로 두고 이미지에 object-fit:cover 를 걸었다.
 *   컨테이너 비율이 바뀌면 이미지가 잘려 마커와 지형이 어긋난다.
 *   → 여기서는 **지도 이미지와 마커를 같은 캔버스(.gisx-canvas)의 자식**으로 두고
 *     캔버스째로 확대/이동시킨다. 어떤 배율에서도 마커가 지형에 붙어 있다.
 *
 * 🔴 참고 원본의 확대/축소 버튼은 실제로 동작하지 않는다(aria-label 만 바꿈).
 *   여기서는 transform scale 로 실제 확대/축소와 드래그 이동을 구현했다.
 */
(function (global) {
  "use strict";

  var MAP_SRC = 'smart.biz.code/static/images/gis/vehicle-location-map.png';

  var ZOOM_MIN = 1;
  var ZOOM_MAX = 3;
  var ZOOM_STEP = 0.5;

  /* ---------------------------------------------------------------- 상태 */
  var scenarioIdx = 0;
  var layerOn = { ops: true, units: true, gps: true, bmts: true };
  var zoom = 1;
  var panX = 0;
  var panY = 0;
  var selectedId = null;
  var listOpen = false;
  var booted = false;

  var el = {};   // 자주 쓰는 DOM 참조

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function scenario() { return (global.GIS_SCENARIOS || [])[scenarioIdx] || null; }
  function layers() { return global.GIS_LAYERS || []; }

  /* 레이어별 개체 배열 */
  function entitiesOf(layerKey) {
    var sc = scenario();
    if (!sc) return [];
    var def = layers().find(function (l) { return l.key === layerKey; });
    if (!def) return [];
    return sc[def.field] || [];
  }

  /* 개체 표시 이름 */
  function entityName(layerKey, e) {
    return (layerKey === 'gps' || layerKey === 'bmts') ? e.plate : e.name;
  }

  /* 상태 → 색 계열 (운행중/진행중 = 정상, 준비/대기 = 보류, 종료/정비 = 비활성) */
  function statusTone(status) {
    if (status === '진행중' || status === '운행중') return 'live';
    if (status === '준비' || status === '대기') return 'hold';
    return 'done';
  }

  /* ------------------------------------------------------------ 지도 렌더 */

  function applyTransform() {
    if (!el.canvas) return;
    el.canvas.style.setProperty('--gz', zoom);
    el.canvas.style.transform =
      'translate(calc(-50% + ' + panX + 'px), calc(-50% + ' + panY + 'px)) scale(' + zoom + ')';
    if (el.zoomLabel) el.zoomLabel.textContent = '×' + zoom.toFixed(1);
  }

  function clampPan() {
    // 확대할수록 더 많이 움직일 수 있게 (배율에 비례한 여유)
    var stage = el.stage ? el.stage.getBoundingClientRect() : { width: 360, height: 400 };
    var maxX = (stage.width * (zoom - 1)) / 2 + 10;
    var maxY = (stage.height * (zoom - 1)) / 2 + 10;
    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
  }

  function setZoom(next) {
    zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(next * 10) / 10));
    if (zoom === ZOOM_MIN) { panX = 0; panY = 0; }
    clampPan();
    applyTransform();
  }

  function resetView() { zoom = 1; panX = 0; panY = 0; applyTransform(); }

  /* 마커 그리기 */
  function renderMarkers() {
    if (!el.markers) return;
    var html = '';

    layers().forEach(function (def) {
      var on = layerOn[def.key];
      var rows = entitiesOf(def.key);

      // 차량 항적(breadcrumbs) — 지나온 경로를 점선으로
      if (on && (def.key === 'gps' || def.key === 'bmts')) {
        rows.forEach(function (e) {
          if (!e.trail || e.trail.length < 2) return;
          var pts = e.trail.concat([[e.x, e.y]])
            .map(function (p) { return p[0] + ',' + p[1]; }).join(' ');
          html += '<svg class="gisx-trail gisx-trail--' + def.key + '" viewBox="0 0 100 100" ' +
                  'preserveAspectRatio="none" aria-hidden="true">' +
                  '<polyline points="' + pts + '" /></svg>';
        });
      }

      if (!on) return;

      rows.forEach(function (e) {
        var name = entityName(def.key, e);
        var tone = statusTone(e.status);
        var isSel = selectedId === e.id;
        html += '<button class="gisx-point gisx-point--' + def.key +
                  (isSel ? ' is-selected' : '') + ' is-' + tone + '" type="button" ' +
                  'style="left:' + e.x + '%; top:' + e.y + '%;" ' +
                  'data-gis-entity="' + esc(e.id) + '" data-gis-layer="' + def.key + '" ' +
                  'aria-label="' + esc(name) + ' 상세 보기">' +
                  (def.key === 'units' && e.echelon
                    ? '<span class="gisx-echelon" aria-hidden="true">' + echelonMark(e.echelon) + '</span>' : '') +
                  '<span class="gisx-sym">' + esc(def.glyph) + '</span>' +
                  '<span class="gisx-label">' + esc(name) + '</span>' +
                '</button>';
      });
    });

    el.markers.innerHTML = html;
  }

  /* 제대 기호 — 소대 │ / 중대 ││ / 대대 │││ / 연대 ⦀ */
  function echelonMark(ech) {
    return { '분대': '●', '소대': 'Ⅰ', '중대': 'Ⅱ', '대대': 'Ⅲ', '연대': 'Ⅲ', '여단': 'X', '사단': 'XX' }[ech] || '';
  }

  /* --------------------------------------------------------- 상단 상황 바 */
  function renderStatusBar() {
    var sc = scenario();
    if (!sc || !el.dtg) return;
    el.dtg.textContent = sc.dtg;
    el.readiness.textContent = sc.readiness;
    el.readiness.className = 'gisx-readiness gisx-readiness--' + sc.readinessLevel;
    el.situation.textContent = sc.situation;
    if (el.scenarioSel && el.scenarioSel.selectedIndex !== scenarioIdx) {
      el.scenarioSel.selectedIndex = scenarioIdx;
    }
  }

  /* --------------------------------------------------- 자가 데이터박스 */
  function renderSelfBox() {
    var sc = scenario();
    if (!sc || !el.selfBox) return;
    var s = sc.self;
    el.selfBox.innerHTML =
      '<div class="gisx-self-row gisx-self-row--head">' +
        '<span class="gisx-self-dot" aria-hidden="true"></span>' + esc(s.callsign) +
      '</div>' +
      '<div class="gisx-self-row gisx-self-mgrs">' + esc(s.mgrs) + '</div>' +
      '<div class="gisx-self-row">' + esc(s.alt) + ' · ' + esc(s.bearing) + ' · ' + esc(s.speed) + '</div>' +
      '<div class="gisx-self-row gisx-self-ce">GPS ' + esc(s.ce) + '</div>';
  }

  /* ------------------------------------------------------- 레이어 칩/패널 */
  function renderLayerChips() {
    if (!el.chips) return;
    el.chips.innerHTML = layers().map(function (d) {
      var n = entitiesOf(d.key).length;
      return '<button class="gisx-chip gisx-chip--' + d.key + (layerOn[d.key] ? ' is-on' : '') + '" ' +
             'type="button" data-gis-toggle="' + d.key + '" aria-pressed="' + (layerOn[d.key] ? 'true' : 'false') + '">' +
             esc(d.short) + '<span class="gisx-chip-n">' + n + '</span></button>';
    }).join('');
  }

  function renderLayerPanel() {
    var body = document.getElementById('gisLayerBody');
    if (!body) return;
    body.innerHTML = layers().map(function (d) {
      var n = entitiesOf(d.key).length;
      return '<label class="gisx-lyr">' +
        '<input class="gisx-lyr-check" type="checkbox" data-gis-toggle="' + d.key + '"' + (layerOn[d.key] ? ' checked' : '') + '>' +
        '<span class="gisx-lyr-key gisx-lyr-key--' + d.key + '" aria-hidden="true">' + esc(d.glyph) + '</span>' +
        '<span class="gisx-lyr-meta">' +
          '<span class="gisx-lyr-name">' + esc(d.label) + '</span>' +
          '<span class="gisx-lyr-desc">' + esc(d.desc) + '</span>' +
        '</span>' +
        '<span class="gisx-lyr-n">' + n + '</span>' +
      '</label>';
    }).join('');
  }

  /* ------------------------------------------------------------ 개체 목록 */
  function renderList() {
    if (!el.list) return;
    var html = '';
    var total = 0;

    layers().forEach(function (d) {
      if (!layerOn[d.key]) return;
      var rows = entitiesOf(d.key);
      if (!rows.length) return;
      total += rows.length;
      html += '<div class="gisx-list-group"><p class="gisx-list-head">' +
                '<span class="gisx-lyr-key gisx-lyr-key--' + d.key + '" aria-hidden="true">' + esc(d.glyph) + '</span>' +
                esc(d.label) + '<span class="gisx-list-n">' + rows.length + '</span></p>';
      rows.forEach(function (e) {
        var tone = statusTone(e.status);
        html += '<button class="gisx-item" type="button" data-gis-entity="' + esc(e.id) + '" data-gis-layer="' + d.key + '">' +
            '<span class="gisx-item-main">' +
              '<span class="gisx-item-name">' + esc(entityName(d.key, e)) + '</span>' +
              '<span class="gisx-item-sub">' + esc(e.type || e.kind || e.vtype || '') +
                (e.unit ? ' · ' + esc(e.unit) : '') + '</span>' +
            '</span>' +
            (e.status ? '<span class="gisx-tone gisx-tone--' + tone + '">' + esc(e.status) + '</span>' : '') +
          '</button>';
      });
      html += '</div>';
    });

    el.list.innerHTML = html || '<p class="gisx-list-empty">표시할 레이어가 없습니다. 레이어를 켜 주세요.</p>';
    if (el.listCount) el.listCount.textContent = total;
  }

  /* ------------------------------------------------------------ 상세 조회 */
  function findEntity(id) {
    var found = null;
    layers().forEach(function (d) {
      if (found) return;
      var hit = entitiesOf(d.key).find(function (e) { return e.id === id; });
      if (hit) found = { layer: d, entity: hit };
    });
    return found;
  }

  function row(k, v) {
    if (!v) return '';
    return '<tr><th scope="row">' + esc(k) + '</th><td>' + esc(v) + '</td></tr>';
  }

  function openDetail(id) {
    var hit = findEntity(id);
    if (!hit) return;
    var d = hit.layer, e = hit.entity;
    var name = entityName(d.key, e);
    var tone = statusTone(e.status);

    selectedId = id;
    renderMarkers();

    var titleEl = document.getElementById('gisDetailTitle');
    var bodyEl = document.getElementById('gisDetailBody');
    if (titleEl) titleEl.textContent = d.label + ' 상세';

    var table = '';
    if (d.key === 'ops') {
      table = row('작전명', e.name) + row('구분', e.type) + row('상태', e.status) +
              row('담당부대', e.unit) + row('지휘관', e.commander) + row('투입인원', e.personnel) +
              row('기간', e.period) + row('좌표(MGRS)', e.mgrs) + row('최종보고', e.dtg);
    } else if (d.key === 'units') {
      table = row('부대명', e.name) + row('제대', e.echelon) + row('구분', e.kind) +
              row('병력', e.strength) + row('지휘관', e.commander) + row('임무', e.mission) +
              row('통신망', e.comms) + row('좌표(MGRS)', e.mgrs) + row('최종수신', e.dtg);
    } else {
      table = row('차량번호', e.plate) + row('차종', e.vtype) + row('상태', e.status) +
              row('운전병', e.driver) + row('임무', e.mission) + row('현재속도', e.speed) +
              row('위치출처', d.key === 'gps' ? 'GPS 단말' : 'BMTS (전장이동추적체계)') +
              row('전송주기', e.cycle) + row('좌표(MGRS)', e.mgrs) + row('최종수신', e.updated);
    }

    if (bodyEl) {
      bodyEl.innerHTML =
        '<div class="gisx-detail">' +
          '<div class="gisx-detail-head">' +
            '<span class="gisx-lyr-key gisx-lyr-key--' + d.key + '" aria-hidden="true">' + esc(d.glyph) + '</span>' +
            '<span class="gisx-detail-title">' + esc(name) + '</span>' +
            (e.status ? '<span class="gisx-tone gisx-tone--' + tone + '">' + esc(e.status) + '</span>' : '') +
          '</div>' +
          '<table class="info-table">' + table + '</table>' +
          '<div class="gisx-detail-note">' + esc(e.detail) + '</div>' +
          '<button class="btn gisx-focus-btn" type="button" data-gis-focus="' + esc(e.id) + '">' +
            '<i class="bp-icon bp-icon-locate" aria-hidden="true"></i> 지도에서 위치 확인' +
          '</button>' +
        '</div>';
    }

    var ov = document.getElementById('gisDetailOverlay');
    if (ov) ov.classList.add('active');
  }

  function closeDetail() {
    var ov = document.getElementById('gisDetailOverlay');
    if (ov) ov.classList.remove('active');
  }

  /* 특정 개체를 화면 중앙으로 (확대 + 이동) */
  function focusEntity(id) {
    var hit = findEntity(id);
    if (!hit || !el.stage) return;
    closeDetail();
    var e = hit.entity;
    zoom = 2;
    var stage = el.stage.getBoundingClientRect();
    // 캔버스는 stage 를 꽉 채우므로 % → px 로 환산 후 중심에서의 편차만큼 반대로 민다
    panX = -((e.x - 50) / 100) * stage.width * zoom;
    panY = -((e.y - 50) / 100) * stage.height * zoom;
    clampPan();
    applyTransform();
    selectedId = id;
    renderMarkers();
  }

  /* ------------------------------------------------------------ 전체 렌더 */
  function renderAll() {
    renderStatusBar();
    renderSelfBox();
    renderLayerChips();
    renderLayerPanel();
    renderMarkers();
    renderList();
  }

  /* ------------------------------------------------------------ 이벤트 */
  function bind() {
    if (booted) return;
    booted = true;

    el.stage = document.getElementById('gisStage');
    el.canvas = document.getElementById('gisCanvas');
    el.markers = document.getElementById('gisMarkers');
    el.chips = document.getElementById('gisChips');
    el.list = document.getElementById('gisList');
    el.listCount = document.getElementById('gisListCount');
    el.selfBox = document.getElementById('gisSelfBox');
    el.dtg = document.getElementById('gisDtg');
    el.readiness = document.getElementById('gisReadiness');
    el.situation = document.getElementById('gisSituation');
    el.scenarioSel = document.getElementById('gisScenarioSelect');
    el.zoomLabel = document.getElementById('gisZoomLabel');
    el.listPanel = document.getElementById('gisListPanel');

    // 시나리오 콤보 채우기
    if (el.scenarioSel) {
      el.scenarioSel.innerHTML = (global.GIS_SCENARIOS || []).map(function (s, i) {
        return '<option value="' + i + '">' + esc(s.name) + '</option>';
      }).join('');
      el.scenarioSel.addEventListener('change', function () {
        scenarioIdx = Number(this.value) || 0;
        selectedId = null;
        resetView();
        renderAll();
      });
    }

    // 지도 이미지
    var img = document.getElementById('gisMapImg');
    if (img && !img.getAttribute('src')) img.setAttribute('src', MAP_SRC);

    // 확대/축소/초기화
    document.addEventListener('click', function (ev) {
      var z = ev.target.closest('[data-gis-zoom]');
      if (z) {
        var k = z.dataset.gisZoom;
        if (k === 'in') setZoom(zoom + ZOOM_STEP);
        else if (k === 'out') setZoom(zoom - ZOOM_STEP);
        else resetView();
        return;
      }

      // 레이어 토글 (칩 + 패널 체크박스 공용)
      var t = ev.target.closest('[data-gis-toggle]');
      if (t) {
        var key = t.dataset.gisToggle;
        if (t.tagName === 'INPUT') layerOn[key] = t.checked;
        else layerOn[key] = !layerOn[key];
        renderLayerChips();
        renderLayerPanel();
        renderMarkers();
        renderList();
        return;
      }

      // 개체 선택 (지도 마커 · 목록 항목)
      var ent = ev.target.closest('[data-gis-entity]');
      if (ent) { openDetail(ent.dataset.gisEntity); return; }

      // 상세에서 위치 확인
      var f = ev.target.closest('[data-gis-focus]');
      if (f) { focusEntity(f.dataset.gisFocus); return; }

      // 레이어 패널 열기/닫기
      if (ev.target.closest('[data-gis-layer-open]')) {
        var lo = document.getElementById('gisLayerOverlay');
        if (lo) lo.classList.add('active');
        return;
      }
      if (ev.target.closest('[data-gis-layer-close]')) {
        var lc = document.getElementById('gisLayerOverlay');
        if (lc) lc.classList.remove('active');
        return;
      }
      if (ev.target.closest('[data-gis-detail-close]')) { closeDetail(); return; }

      // 개체 목록 접기/펼치기
      if (ev.target.closest('[data-gis-list-toggle]')) {
        listOpen = !listOpen;
        if (el.listPanel) el.listPanel.classList.toggle('is-open', listOpen);
        var tg = document.querySelector('[data-gis-list-toggle]');
        if (tg) tg.setAttribute('aria-expanded', listOpen ? 'true' : 'false');
        return;
      }
    });

    // 지도 드래그 이동
    if (el.stage) {
      var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0, moved = false;
      el.stage.addEventListener('pointerdown', function (ev) {
        if (ev.target.closest('.gisx-point') || ev.target.closest('.gisx-overlay-ui')) return;
        dragging = true; moved = false;
        sx = ev.clientX; sy = ev.clientY; ox = panX; oy = panY;
        el.stage.setPointerCapture(ev.pointerId);
        el.stage.classList.add('is-dragging');
      });
      el.stage.addEventListener('pointermove', function (ev) {
        if (!dragging) return;
        var dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
        panX = ox + dx; panY = oy + dy;
        clampPan(); applyTransform();
      });
      ['pointerup', 'pointercancel'].forEach(function (t) {
        el.stage.addEventListener(t, function (ev) {
          if (!dragging) return;
          dragging = false;
          el.stage.classList.remove('is-dragging');
          try { el.stage.releasePointerCapture(ev.pointerId); } catch (ignore) {}
        });
      });
      // 휠 확대/축소
      el.stage.addEventListener('wheel', function (ev) {
        ev.preventDefault();
        setZoom(zoom + (ev.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
      }, { passive: false });
    }
  }

  /* ------------------------------------------------------------ 공개 API */
  function open() {          // 화면 진입 시
    bind();
    renderAll();
    applyTransform();
  }

  function reset() {         // 무입력 자동 초기화에서 호출
    scenarioIdx = 0;
    layerOn = { ops: true, units: true, gps: true, bmts: true };
    selectedId = null;
    listOpen = false;
    resetView();
    var lo = document.getElementById('gisLayerOverlay');
    if (lo) lo.classList.remove('active');
    closeDetail();
    if (el.listPanel) el.listPanel.classList.remove('is-open');
    var tg = document.querySelector('[data-gis-list-toggle]');
    if (tg) tg.setAttribute('aria-expanded', 'false');
    if (el.scenarioSel) el.scenarioSel.selectedIndex = 0;
    if (booted) renderAll();
  }

  /* 초기 상태인가? (무입력 초기화 판정에 쓰인다) */
  function isPristine() {
    return scenarioIdx === 0 &&
      layerOn.ops && layerOn.units && layerOn.gps && layerOn.bmts &&
      selectedId === null && listOpen === false &&
      zoom === 1 && panX === 0 && panY === 0;
  }

  global.GisBoard = { open: open, reset: reset, isPristine: isPristine };
})(window);

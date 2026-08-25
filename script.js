/* ===========================================================================
   Smart Unit 시연 앱 — 애플리케이션 로직
   ---------------------------------------------------------------------------
   [2026-08-25]
    · 아이콘 Font Awesome → Blueprint(bp-icon)로 교체 (smart.biz.code 형식)
    · 생성 마크업의 인라인 px → rem / 토큰 색상으로 정리
    · RAG 시뮬레이션 제어부(runSimulation) 추가 및 오류 수정
   =========================================================================== */

/* ---------------------------------------------------------------------------
   초기 데이터 (INITIAL_*) — 무입력 자동 초기화 때 이 값으로 되돌린다.
   실제 사용하는 배열은 아래에서 복제해 만든다. 원본은 절대 수정하지 않는다.
   --------------------------------------------------------------------------- */
const INITIAL_REQUESTS = [
  { id: 82, type: '외출', user: '일병 홍길동', code: '25-912301', date: '2026.09.05 (09:00~18:00)', dest: '부산광역시 남구', reason: '포상외출', status: 'REVIEW', rejectReason: '' },
  { id: 81, type: '휴가', user: '상병 임꺽정', code: '25-710239', date: '2026.09.10 ~ 2026.09.14', dest: '서울특별시 마포구', reason: '정기휴가', status: 'APPROVAL', rejectReason: '' },
  { id: 80, type: '외박', user: '병장 이순신', code: '24-110293', date: '2026.09.12 ~ 2026.09.13', dest: '강원도 춘천시', reason: '성과제 외박', status: 'SUCCESS', rejectReason: '' }
];

const INITIAL_MEDICAL = [
  { id: 101, user: '이병 이몽룡', code: '26-992101', medicalType: '초진', hospital: '국군수도병원', dept: '정형외과', date: '2026.08.28', symptom: '훈련 중 우측 발목 통증', status: 'SUBMITTED' },
  { id: 102, user: '상병 강감찬', code: '25-330192', medicalType: '재진', hospital: '대전지구병원', dept: '이비인후과', date: '2026.08.26', symptom: '비염 치료 지속', status: 'CONFIRMED' }
];

const INITIAL_FR_HISTORY = [
  {
    id: 1,
    title: '[비상] 거수자 식별 발생',
    location: '위조초소 부근',
    eventTime: '2026.08.24 09:10:00',
    departTime: '2026.08.24 09:11:15',
    arriveTime: '2026.08.24 09:14:30',
    completeTime: '2026.08.24 09:22:10',
    actionType: '현장수색 및 신원확인 완료',
    actionDetail: '위조초소 부근 수색 결과 인근 부대 협조 차량 단속요원으로 확인됨. 신원확인 후 상황 해제함.'
  }
];

/* 얕은 복제(객체 배열) — 데이터가 1뎁스라 이걸로 충분하다 */
function cloneRows(src) { return src.map(function (o) { return Object.assign({}, o); }); }

let requests = cloneRows(INITIAL_REQUESTS);
let medicalRequests = cloneRows(INITIAL_MEDICAL);
let frHistoryList = cloneRows(INITIAL_FR_HISTORY);

/* RAG 분석 결과 이력 — 시뮬레이션을 돌릴 때마다 쌓인다 (초기값은 비어 있음) */
let ragHistory = [];
let currentRagFilter = 'ALL';

let currentRole = 'ADMIN';
let currentFilter = 'ALL';
let currentMedicalFilter = 'ALL';
let selectedReqId = null;
let selectedMedicalId = null;
let pendingAction = null;
let activeChart = null;

let currentEvent = null;
let frCurrentStep = 0; // 0: 대기, 1: 출발, 2: 도착, 3: 완료

/* HTML 이스케이프 — 사용자 입력(반려 사유/조치 내용)이 마크업으로 섞이지 않도록 */
function escapeHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function getFormattedTime() {
  const now = new Date();
  return now.getFullYear() + '.' + String(now.getMonth()+1).padStart(2,'0') + '.' + String(now.getDate()).padStart(2,'0') + ' ' +
         String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0') + ':' + String(now.getSeconds()).padStart(2,'0');
}

// PUSH 배너 숨김 함수
function dismissPushBanner() {
  const pushBanner = document.getElementById('pushBanner');
  if(pushBanner) {
    pushBanner.classList.remove('active');
  }
}

/* ---------------------------------------------------------------------------
   권한(행정보급관 / 중대장)
   ---------------------------------------------------------------------------
   권한이 실제로 갈리는 업무는 **출타 결재 하나뿐**이다.
   그래서 모든 화면 상단에 드롭다운을 띄우지 않고
     · 헤더·홈    = 현재 권한을 읽기 전용 배지로만 표시
     · 출타 화면  = 결재선(신청→검토→승인)과 함께 세그먼트로 전환
   구조로 정리했다. (사용자 요청 2026-08-25)
   --------------------------------------------------------------------------- */

const UNIT_NAME = '제31보병사단 제103연대 3대대 9중대';

const ROLE_INFO = {
  ADMIN:     { name: '행정보급관', person: '상사 김도윤',  unit: UNIT_NAME, pending: 'REVIEW',   label: '내 검토 대기' },
  COMMANDER: { name: '중대장',     person: '대위 박승현',  unit: UNIT_NAME, pending: 'APPROVAL', label: '내 결재 대기' }
};

/* 권한 전환 진입점 */
function setRole(role) {
  if(!ROLE_INFO[role]) return;
  currentRole = role;
  applyRoleUI();
  renderList();
  renderMedicalList();
  renderHomeNotif();
}

/* 권한에 따른 화면 표시 갱신 */
function applyRoleUI() {
  const info = ROLE_INFO[currentRole];

  // 헤더 배지 · 홈 인사말
  const badge = document.getElementById('roleBadgeText');
  if(badge) badge.innerText = info.name;
  const wRole = document.getElementById('welcomeRole');
  if(wRole) wRole.innerHTML = '<i class="bp-icon bp-icon-shield" aria-hidden="true"></i> ' + escapeHtml(info.name);
  const wText = document.getElementById('welcomeText');
  if(wText) wText.innerText = info.person;     // 계급 + 성명
  const wSub = document.getElementById('welcomeSub');
  if(wSub) wSub.innerText = info.unit;         // 소속부대 (작은 글씨)

  // 출타 화면 : 결재선 · 세그먼트 · 대기 라벨
  document.querySelectorAll('.appr-role-btn').forEach(function (b) {
    const on = b.dataset.role === currentRole;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const sAdmin = document.getElementById('apprStepAdmin');
  const sCmd = document.getElementById('apprStepCmd');
  if(sAdmin) sAdmin.classList.toggle('is-me', currentRole === 'ADMIN');
  if(sCmd) sCmd.classList.toggle('is-me', currentRole === 'COMMANDER');

  const lab = document.getElementById('statReviewLabel');
  if(lab) lab.innerText = info.label;
}

/* 결재선 단계별 대기 건수 */
function renderApprovalFlow() {
  const a = document.getElementById('apprCntAdmin');
  const c = document.getElementById('apprCntCmd');
  if(a) a.innerText = requests.filter(r => r.status === 'REVIEW').length;
  if(c) c.innerText = requests.filter(r => r.status === 'APPROVAL').length;
}

function switchNav(target) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.view-page').forEach(v => v.classList.remove('active'));

  const headerTitle = document.getElementById('headerTitle');

  if(target === 'home') {
    document.getElementById('navHome').classList.add('active');
    document.getElementById('viewHome').classList.add('active');
    headerTitle.innerHTML = `<span class="brand-mark" aria-hidden="true"></span> 스마트부대`;
  } else if(target === 'approval') {
    document.getElementById('navApproval').classList.add('active');
    document.getElementById('viewApproval').classList.add('active');
    headerTitle.innerHTML = `<i class="bp-icon bp-icon-walk" aria-hidden="true"></i> 용사 출타 검토 및 결재`;
  } else if(target === 'hospital') {
    document.getElementById('navHospital').classList.add('active');
    document.getElementById('viewHospital').classList.add('active');
    headerTitle.innerHTML = `<i class="bp-icon bp-icon-diagnosis" aria-hidden="true"></i> 용사 진료 신청 확인`;
  } else if(target === 'dashboard') {
    document.getElementById('navDashboard').classList.add('active');
    document.getElementById('viewDashboard').classList.add('active');
    headerTitle.innerHTML = `<i class="bp-icon bp-icon-dashboard" aria-hidden="true"></i> 미니상황판 현황`;
    switchDashCategory('overview');   // 기본 = 전체현황
  } else if(target === 'firstResponse') {
    dismissPushBanner(); // 초동조치 화면 진입 시 PUSH 배너 숨김
    document.getElementById('navFirstResponse').classList.add('active');
    document.getElementById('viewFirstResponse').classList.add('active');
    headerTitle.innerHTML = `<i class="bp-icon bp-icon-feed" aria-hidden="true"></i> 초동조치 수신 및 이력`;
    renderFrActiveSection();
  } else if(target === 'ragReport') {
    // 하단바에는 없는 화면(홈 타일 · RAG 제어부 버튼으로 진입)
    document.getElementById('viewRagReport').classList.add('active');
    headerTitle.innerHTML = `<i class="bp-icon bp-icon-clipboard" aria-hidden="true"></i> AI 현장 분석 결과`;
    renderRagReportList();
  } else if(target === 'gisBoard') {
    // GIS 디지털 상황판 (홈 타일 · 미니상황판에서 진입)
    document.getElementById('viewGisBoard').classList.add('active');
    headerTitle.innerHTML = `<i class="bp-icon bp-icon-area-of-interest" aria-hidden="true"></i> GIS 디지털 상황판`;
    if(window.GisBoard) GisBoard.open();
  }

  // 화면 전환 시 스크롤 최상단
  const content = document.querySelector('.app-content');
  if(content) content.scrollTop = 0;
}

function switchFrTab(tab) {
  document.getElementById('frTabActive').classList.toggle('active', tab === 'ACTIVE');
  document.getElementById('frTabHistory').classList.toggle('active', tab === 'HISTORY');

  if(tab === 'ACTIVE') {
    document.getElementById('frActiveSection').style.display = 'block';
    document.getElementById('frHistorySection').style.display = 'none';
    renderFrActiveSection();
  } else {
    document.getElementById('frActiveSection').style.display = 'none';
    document.getElementById('frHistorySection').style.display = 'block';
    renderFrHistoryList();
  }
}

function triggerEvent(type) {
  const timeStr = getFormattedTime();

  if(type === 'SUSPECT') {
    currentEvent = { title: '[비상] 거수자 식별 발생', loc: '부대 북서쪽 외곽 펜스 부근', time: timeStr, code: 'SUSPECT' };
  } else if(type === 'MEDICAL') {
    currentEvent = { title: '[응급] 환자 발생 보고', loc: '연병장 연하대 인근', time: timeStr, code: 'MEDICAL' };
  } else if(type === 'FIRE') {
    currentEvent = { title: '[화재] 부대 내 화재 발생', loc: '수송대대 유류고 입구', time: timeStr, code: 'FIRE' };
  }

  currentEvent.departTime = null;
  currentEvent.arriveTime = null;
  currentEvent.completeTime = null;

  const pushBanner = document.getElementById('pushBanner');
  document.getElementById('pushTitle').innerText = currentEvent.title;
  document.getElementById('pushBody').innerText = `위치: ${currentEvent.loc} (터치하여 초동조치 시작)`;
  pushBanner.classList.add('active');

  frCurrentStep = 0;
  resetFirstResponseUI();
}

function openFirstResponseFromPush() {
  dismissPushBanner();
  switchNav('firstResponse');
  switchFrTab('ACTIVE');
}

function resetFirstResponseUI() {
  if(!currentEvent) return;

  document.getElementById('frTitle').innerText = currentEvent.title;
  document.getElementById('frTime').innerText = `발생 시각: ${currentEvent.time}`;
  document.getElementById('frLocation').innerText = `발생 위치: ${currentEvent.loc}`;

  document.getElementById('step1').className = 'step-item active';
  document.getElementById('step1Status').innerText = '대기중';
  document.getElementById('step1Time').innerText = '시각: 미진행';

  document.getElementById('step2').className = 'step-item';
  document.getElementById('step2Status').innerText = '대기';
  document.getElementById('step2Time').innerText = '시각: 미진행';

  document.getElementById('step3').className = 'step-item';
  document.getElementById('step3Status').innerText = '대기';
  document.getElementById('step3Time').innerText = '시각: 미진행';

  document.getElementById('btnDepart').disabled = false;
  document.getElementById('btnArrive').disabled = true;
  document.getElementById('btnComplete').disabled = true;
}

function renderFrActiveSection() {
  const noData = document.getElementById('frNoActiveMsg');
  const activeContent = document.getElementById('frActiveContent');

  if(!currentEvent || frCurrentStep === 3) {
    noData.style.display = 'block';
    activeContent.style.display = 'none';
  } else {
    noData.style.display = 'none';
    activeContent.style.display = 'block';
  }
}

function handleFirstResponseStep(step) {
  dismissPushBanner();
  const nowTime = getFormattedTime();

  if(step === 'DEPART') {
    frCurrentStep = 1;
    currentEvent.departTime = nowTime;

    document.getElementById('step1').className = 'step-item done';
    document.getElementById('step1Status').innerText = '출발 완료';
    document.getElementById('step1Time').innerText = `시각: ${nowTime}`;

    document.getElementById('step2').className = 'step-item active';
    document.getElementById('step2Status').innerText = '이동 중';

    document.getElementById('btnDepart').disabled = true;
    document.getElementById('btnArrive').disabled = false;
    alert(`[상황판 PUSH 전송]\n- 현장 출발 시각: ${nowTime}`);

  } else if(step === 'ARRIVE') {
    frCurrentStep = 2;
    currentEvent.arriveTime = nowTime;

    document.getElementById('step2').className = 'step-item done';
    document.getElementById('step2Status').innerText = '도착 완료';
    document.getElementById('step2Time').innerText = `시각: ${nowTime}`;

    document.getElementById('step3').className = 'step-item active';
    document.getElementById('step3Status').innerText = '조치 중';

    document.getElementById('btnArrive').disabled = true;
    document.getElementById('btnComplete').disabled = false;
    alert(`[상황판 PUSH 전송]\n- 현장 도착 시각: ${nowTime}`);

  } else if(step === 'COMPLETE') {
    document.getElementById('frCompleteSummary').innerText = `상황: ${currentEvent.title} / 위치: ${currentEvent.loc}`;
    document.getElementById('frActionDetail').value = '';
    document.getElementById('frCompleteOverlay').classList.add('active');
  }
}

function closeFrCompletePopup() {
  document.getElementById('frCompleteOverlay').classList.remove('active');
}

function submitFrComplete() {
  const typeVal = document.getElementById('frActionType').value;
  const detailVal = document.getElementById('frActionDetail').value.trim();

  if(!detailVal) {
    alert('조치 세부 내용을 입력해 주세요.');
    return;
  }

  const completeTime = getFormattedTime();
  frCurrentStep = 3;
  dismissPushBanner();

  document.getElementById('step3').className = 'step-item done';
  document.getElementById('step3Status').innerText = '조치 완료';
  document.getElementById('step3Time').innerText = `시각: ${completeTime}`;
  document.getElementById('btnComplete').disabled = true;

  const newHistory = {
    id: Date.now(),
    title: currentEvent.title,
    location: currentEvent.loc,
    eventTime: currentEvent.time,
    departTime: currentEvent.departTime,
    arriveTime: currentEvent.arriveTime,
    completeTime: completeTime,
    actionType: typeVal,
    actionDetail: detailVal
  };
  frHistoryList.unshift(newHistory);

  closeFrCompletePopup();
  alert(`[상황판 PUSH 전송 성공]\n- 조치 완료 시각: ${completeTime}\n- 조치 결과: ${typeVal}\n\n상황판으로 최종 전송되어 초동조치 이력에 저장되었습니다.`);
  switchFrTab('HISTORY');
}

function renderFrHistoryList() {
  const container = document.getElementById('frHistoryList');
  container.innerHTML = '';

  if(frHistoryList.length === 0) {
    container.innerHTML = `<div class="no-data-card">저장된 초동조치 이력이 없습니다.</div>`;
    return;
  }

  frHistoryList.forEach(item => {
    const card = document.createElement('div');
    card.className = 'req-card';
    card.onclick = () => openFrHistoryDetail(item.id);
    card.innerHTML = `
      <div class="card-header">
        <strong class="card-title">${escapeHtml(item.title)}</strong>
        <span class="badge badge-success">조치완료</span>
      </div>
      <div class="card-meta">위치: ${escapeHtml(item.location)}</div>
      <div class="card-meta">발생시각: ${escapeHtml(item.eventTime)}</div>
      <div class="card-meta card-meta--accent">결과: ${escapeHtml(item.actionType)}</div>
    `;
    container.appendChild(card);
  });
}

function openFrHistoryDetail(id) {
  const item = frHistoryList.find(h => h.id === id);
  if(!item) return;

  const bodyEl = document.getElementById('frHistoryDetailBody');
  bodyEl.innerHTML = `
    <table class="info-table">
      <tr><th>상황명</th><td>${escapeHtml(item.title)}</td></tr>
      <tr><th>발생 위치</th><td>${escapeHtml(item.location)}</td></tr>
      <tr><th>상황 발생 시각</th><td>${escapeHtml(item.eventTime)}</td></tr>
      <tr><th>현장 출발 시각</th><td>${escapeHtml(item.departTime || '-')}</td></tr>
      <tr><th>현장 도착 시각</th><td>${escapeHtml(item.arriveTime || '-')}</td></tr>
      <tr><th>조치 완료 시각</th><td>${escapeHtml(item.completeTime)}</td></tr>
      <tr><th>조치 결과 구분</th><td>${escapeHtml(item.actionType)}</td></tr>
      <tr><th>세부 조치 내역</th><td>${escapeHtml(item.actionDetail)}</td></tr>
    </table>
  `;

  document.getElementById('frHistoryDetailOverlay').classList.add('active');
}

function closeFrHistoryDetailPopup() {
  document.getElementById('frHistoryDetailOverlay').classList.remove('active');
}

/* 전체현황용 미니 가로 바 한 줄 */
function ovBar(label, value, total) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  const color = pct >= 80 ? 'var(--app-primary)' : (pct >= 60 ? 'var(--color-complete)' : 'var(--app-alert)');
  return '<div class="ov-bar">' +
      '<span class="ov-bar-label">' + escapeHtml(label) + '</span>' +
      '<span class="ov-bar-track"><i style="width:' + pct + '%; background:' + color + ';"></i></span>' +
      '<span class="ov-bar-val">' + value.toLocaleString() + '/' + total.toLocaleString() + '</span>' +
    '</div>';
}

function switchDashCategory(cat) {
  document.querySelectorAll('.dash-menu-btn').forEach(b => b.classList.remove('active'));
  const area = document.getElementById('dashContentArea');
  area.innerHTML = '';

  if(activeChart) {
    activeChart.destroy();
    activeChart = null;
  }

  if(cat === 'overview') {
    /* ------------------------------------------------------------------
       전체현황 — 모든 분야를 한 화면에 압축해서 보여준다.
       화면이 늘어지지 않도록 차트 대신 요약 타일 · 미니 바 · 칩으로 구성하고,
       각 카드를 누르면 해당 분야 탭으로 넘어간다.
       ------------------------------------------------------------------ */
    document.getElementById('btnDashOverview').classList.add('active');
    area.innerHTML = `
      <div class="ov-tiles">
        <div class="ov-tile">
          <div class="ov-tile-label"><i class="bp-icon bp-icon-people" aria-hidden="true"></i> 현재원</div>
          <div class="ov-tile-val">118<small>/ 125명</small></div>
          <div class="ov-tile-sub ov-ok">상주율 94.4%</div>
        </div>
        <div class="ov-tile">
          <div class="ov-tile-label"><i class="bp-icon bp-icon-walk" aria-hidden="true"></i> 출타·유동</div>
          <div class="ov-tile-val">7<small>명</small></div>
          <div class="ov-tile-sub">휴가 3 · 외출입 2 · 외진 2</div>
        </div>
        <div class="ov-tile">
          <div class="ov-tile-label"><i class="bp-icon bp-icon-bullet" aria-hidden="true"></i> 총기 불출</div>
          <div class="ov-tile-val">10<small>/ 130정</small></div>
          <div class="ov-tile-sub ov-ok">수량 이상 없음</div>
        </div>
        <div class="ov-tile">
          <div class="ov-tile-label"><i class="bp-icon bp-icon-fuel" aria-hidden="true"></i> 유류 보유</div>
          <div class="ov-tile-val">4,700<small>L</small></div>
          <div class="ov-tile-sub ov-warn">가용률 67%</div>
        </div>
      </div>

      <article class="ov-card" onclick="switchDashCategory('forces')">
        <header class="ov-head">
          <span class="ov-head-title"><i class="bp-icon bp-icon-people" aria-hidden="true"></i> 부대원 현황</span>
          <span class="ov-head-more">자세히 <i class="bp-icon bp-icon-chevron-right" aria-hidden="true"></i></span>
        </header>
        <div class="ov-bars">
          ${ovBar('본부', 25, 25)}
          ${ovBar('1소대', 31, 33)}
          ${ovBar('2소대', 31, 33)}
          ${ovBar('3소대', 31, 34)}
        </div>
      </article>

      <article class="ov-card" onclick="switchDashCategory('movement')">
        <header class="ov-head">
          <span class="ov-head-title"><i class="bp-icon bp-icon-locate" aria-hidden="true"></i> 위치별 유동병력</span>
          <span class="ov-head-more">자세히 <i class="bp-icon bp-icon-chevron-right" aria-hidden="true"></i></span>
        </header>
        <div class="ov-chips">
          <div class="ov-chip"><span class="ov-chip-val">78</span><span class="ov-chip-label">생활관</span></div>
          <div class="ov-chip"><span class="ov-chip-val">15</span><span class="ov-chip-label">병영식당</span></div>
          <div class="ov-chip"><span class="ov-chip-val">12</span><span class="ov-chip-label">체육관</span></div>
          <div class="ov-chip"><span class="ov-chip-val">13</span><span class="ov-chip-label">연병장</span></div>
        </div>
      </article>

      <article class="ov-card" onclick="switchDashCategory('armory')">
        <header class="ov-head">
          <span class="ov-head-title"><i class="bp-icon bp-icon-shield" aria-hidden="true"></i> 무기 · 탄약</span>
          <span class="ov-head-more">자세히 <i class="bp-icon bp-icon-chevron-right" aria-hidden="true"></i></span>
        </header>
        <div class="ov-stats">
          <div class="ov-stat"><span class="ov-stat-val">110<small> / 120</small></span><span class="ov-stat-label">K2 소총</span></div>
          <div class="ov-stat"><span class="ov-stat-val">10<small> / 10</small></span><span class="ov-stat-label">K1A</span></div>
          <div class="ov-stat"><span class="ov-stat-val">15,000</span><span class="ov-stat-label">탄약(발)</span></div>
        </div>
      </article>

      <article class="ov-card" onclick="switchDashCategory('fuel')">
        <header class="ov-head">
          <span class="ov-head-title"><i class="bp-icon bp-icon-fuel" aria-hidden="true"></i> 유류 보유량</span>
          <span class="ov-head-more">자세히 <i class="bp-icon bp-icon-chevron-right" aria-hidden="true"></i></span>
        </header>
        <div class="ov-bars">
          ${ovBar('휘발유', 1700, 2000)}
          ${ovBar('경유1', 2000, 3000)}
          ${ovBar('경유2', 1000, 2000)}
        </div>
      </article>

      <button class="btn ov-gis-btn" type="button" onclick="switchNav('gisBoard')">
        <i class="bp-icon bp-icon-area-of-interest" aria-hidden="true"></i> GIS 디지털 상황판 열기
      </button>

      <p class="ov-updated"><i class="bp-icon bp-icon-time" aria-hidden="true"></i> 기준 시각 ${escapeHtml(getFormattedTime())}</p>
    `;

  } else if(cat === 'forces') {
    document.getElementById('btnDashForces').classList.add('active');
    area.innerHTML = `
      <div class="kpi-row">
        <div class="kpi-card" onclick="openDashDetail('forces_total')">
          <div class="kpi-title">부대 총원 <i class="bp-icon bp-icon-chevron-right" aria-hidden="true"></i></div>
          <div class="kpi-val">125명</div>
          <div class="kpi-sub">편제 기준 100%</div>
        </div>
        <div class="kpi-card" onclick="openDashDetail('forces_present')">
          <div class="kpi-title">현재원 <i class="bp-icon bp-icon-chevron-right" aria-hidden="true"></i></div>
          <div class="kpi-val" style="color:var(--color-approval)">118명</div>
          <div class="kpi-sub">상주율 94.4%</div>
        </div>
      </div>
      <div class="chart-card">
        <div class="chart-card-header">
          <span><i class="bp-icon bp-icon-timeline-bar-chart" aria-hidden="true"></i> 소대별 현재원 현황</span>
        </div>
        <div class="chart-container">
          <canvas id="forcesChart"></canvas>
        </div>
      </div>
    `;
    setTimeout(() => renderForcesChart(), 50);

  } else if(cat === 'movement') {
    document.getElementById('btnDashMovement').classList.add('active');
    area.innerHTML = `
      <div class="section-title">
        <span><i class="bp-icon bp-icon-locate" aria-hidden="true"></i> 부대 내 위치별 유동병력 현황</span>
      </div>
      <div class="loc-grid">
        <div class="loc-card" onclick="openDashDetail('loc_dorm')">
          <div class="loc-header"><span>생활관</span> <i class="bp-icon bp-icon-home" style="color:var(--app-primary)" aria-hidden="true"></i></div>
          <div class="loc-count">78명</div>
          <div class="loc-sub">휴식 및 개인정비</div>
        </div>
        <div class="loc-card" onclick="openDashDetail('loc_mess')">
          <div class="loc-header"><span>병영식당</span> <i class="bp-icon bp-icon-people" style="color:var(--color-complete)" aria-hidden="true"></i></div>
          <div class="loc-count">15명</div>
          <div class="loc-sub">식사 및 취사지원</div>
        </div>
        <div class="loc-card" onclick="openDashDetail('loc_gym')">
          <div class="loc-header"><span>체육관</span> <i class="bp-icon bp-icon-walk" style="color:var(--color-approval)" aria-hidden="true"></i></div>
          <div class="loc-count">12명</div>
          <div class="loc-sub">체력단련 중</div>
        </div>
        <div class="loc-card" onclick="openDashDetail('loc_ground')">
          <div class="loc-header"><span>연병장/작업</span> <i class="bp-icon bp-icon-projects" style="color:var(--app-alert)" aria-hidden="true"></i></div>
          <div class="loc-count">13명</div>
          <div class="loc-sub">부대 정비 및 작업</div>
        </div>
      </div>
    `;

  } else if(cat === 'armory') {
    document.getElementById('btnDashArmory').classList.add('active');
    area.innerHTML = `
      <div class="kpi-row">
        <div class="kpi-card" onclick="openDashDetail('armory_k2')">
          <div class="kpi-title">K2 소총 불출 <i class="bp-icon bp-icon-chevron-right" aria-hidden="true"></i></div>
          <div class="kpi-val" style="color:var(--app-alert)">10정</div>
          <div class="kpi-sub">총원 120정 중 불출</div>
        </div>
        <div class="kpi-card" onclick="openDashDetail('armory_ammo')">
          <div class="kpi-title">탄약 재고 <i class="bp-icon bp-icon-chevron-right" aria-hidden="true"></i></div>
          <div class="kpi-val">15,000발</div>
          <div class="kpi-sub">5.56mm 보통탄 (이상무)</div>
        </div>
      </div>
      <div class="chart-card">
        <div class="chart-card-header">
          <span><i class="bp-icon bp-icon-timeline-bar-chart" aria-hidden="true"></i> 총기 보유 대 불출 현황</span>
        </div>
        <div class="chart-container">
          <canvas id="armoryChart"></canvas>
        </div>
      </div>
    `;
    setTimeout(() => renderArmoryChart(), 50);

  } else if(cat === 'fuel') {
    document.getElementById('btnDashFuel').classList.add('active');
    area.innerHTML = `
      <div class="kpi-row">
        <div class="kpi-card" onclick="openDashDetail('fuel_total')">
          <div class="kpi-title">전체 유류 보유총량 <i class="bp-icon bp-icon-chevron-right" aria-hidden="true"></i></div>
          <div class="kpi-val">4,700 L</div>
          <div class="kpi-sub">총 저장용량 7,000L (67%)</div>
        </div>
        <div class="kpi-card" onclick="openDashDetail('fuel_history')">
          <div class="kpi-title">최근 수불 내역 <i class="bp-icon bp-icon-chevron-right" aria-hidden="true"></i></div>
          <div class="kpi-val" style="color:var(--app-primary-dark)">2건</div>
          <div class="kpi-sub">오늘 입출고 이상 없음</div>
        </div>
      </div>

      <div class="section-title"><span><i class="bp-icon bp-icon-fuel" aria-hidden="true"></i> 탱크별 잔량 및 보유 현황</span></div>

      <div class="tank-box" onclick="openDashDetail('fuel_tank_g1')">
        <div class="tank-header">
          <span>휘발유 1호 탱크 (메인)</span>
          <span style="color:var(--app-primary-dark);">1,700L / 2,000L (85%)</span>
        </div>
        <div class="fuel-bar-bg"><div class="fuel-bar-fill" style="width: 85%; background: var(--app-primary);"></div></div>
        <div class="tank-sub">상태: 정상 / 차량 수송용</div>
      </div>

      <div class="tank-box" onclick="openDashDetail('fuel_tank_d1')">
        <div class="tank-header">
          <span>경유 1호 탱크 (대형차량용)</span>
          <span style="color:var(--color-complete);">2,000L / 3,000L (66%)</span>
        </div>
        <div class="fuel-bar-bg"><div class="fuel-bar-fill" style="width: 66%; background: var(--color-complete);"></div></div>
        <div class="tank-sub">상태: 정상 / 중장비 및 대형버스용</div>
      </div>

      <div class="tank-box" onclick="openDashDetail('fuel_tank_d2')">
        <div class="tank-header">
          <span>경유 2호 탱크 (비상발전용)</span>
          <span style="color:var(--color-approval);">1,000L / 2,000L (50%)</span>
        </div>
        <div class="fuel-bar-bg"><div class="fuel-bar-fill" style="width: 50%; background: var(--color-approval);"></div></div>
        <div class="tank-sub">상태: 정상 / 비상발전기 전용</div>
      </div>
    `;
  }
}

/* Chart.js 는 CDN 로드 — 오프라인 등으로 실패하면 안내 문구로 대체한다. */
function chartUnavailable(canvasId, label) {
  const canvas = document.getElementById(canvasId);
  if(!canvas || !canvas.parentElement) return true;
  if(typeof Chart === 'undefined') {
    canvas.parentElement.innerHTML = `<div class="chart-fallback">${label} 차트를 불러오지 못했습니다.<br>(네트워크 연결 확인)</div>`;
    return true;
  }
  return false;
}

function renderForcesChart() {
  if(chartUnavailable('forcesChart', '소대별 현재원')) return;
  const ctx = document.getElementById('forcesChart').getContext('2d');
  activeChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['본부소대', '1소대', '2소대', '3소대'],
      datasets: [{
        label: '현재원 (명)',
        data: [25, 31, 31, 31],
        backgroundColor: '#2d72d2',
        borderRadius: 4
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 35 } } }
  });
}

function renderArmoryChart() {
  if(chartUnavailable('armoryChart', '총기 보유/불출')) return;
  const ctx = document.getElementById('armoryChart').getContext('2d');
  activeChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['K2 소총', 'K1A 기관단총'],
      datasets: [
        { label: '보유', data: [110, 10], backgroundColor: '#238551' },
        { label: '불출', data: [10, 0], backgroundColor: '#cd4246' }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } } }
  });
}

function openDashDetail(key) {
  const titleEl = document.getElementById('dashDetailTitle');
  const bodyEl = document.getElementById('dashDetailBody');

  if(key === 'forces_total' || key === 'forces_present') {
    titleEl.innerText = "부대 소대별 상세 명부";
    bodyEl.innerHTML = `
      <table class="info-table">
        <tr><th>소대</th><th>정원</th><th>현재원</th><th>비고</th></tr>
        <tr><td>본부소대</td><td>25명</td><td>25명</td><td>이상 없음</td></tr>
        <tr><td>1소대</td><td>33명</td><td>31명</td><td>휴가 2명</td></tr>
        <tr><td>2소대</td><td>33명</td><td>31명</td><td>외진 2명</td></tr>
        <tr><td>3소대</td><td>34명</td><td>31명</td><td>외출1/외박1/휴가1</td></tr>
      </table>
    `;
  } else if(key === 'loc_dorm') {
    titleEl.innerText = "생활관 상주 용사 명단 (78명)";
    bodyEl.innerHTML = `
      <table class="info-table">
        <tr><th>계급/성명</th><th>소속</th><th>상태</th></tr>
        <tr><td>병장 김민우</td><td>1소대 1분대</td><td>개인정비</td></tr>
        <tr><td>상병 이찬희</td><td>2소대 2분대</td><td>휴식</td></tr>
        <tr><td>일병 박준형</td><td>본부소대</td><td>학습</td></tr>
        <tr><td colspan="3" style="text-align:center; color:var(--app-muted);">외 75명 생활관 상주 중</td></tr>
      </table>
    `;
  } else if(key === 'loc_mess') {
    titleEl.innerText = "병영식당 위치 용사 명단 (15명)";
    bodyEl.innerHTML = `
      <table class="info-table">
        <tr><th>계급/성명</th><th>소속</th><th>임무/사유</th></tr>
        <tr><td>상병 최재혁</td><td>본부소대</td><td>취사지원</td></tr>
        <tr><td>일병 윤성민</td><td>3소대 1분대</td><td>식당 청소</td></tr>
        <tr><td colspan="3" style="text-align:center; color:var(--app-muted);">외 13명 식사 및 불출 지원 중</td></tr>
      </table>
    `;
  } else if(key === 'loc_gym') {
    titleEl.innerText = "체육관 위치 용사 명단 (12명)";
    bodyEl.innerHTML = `
      <table class="info-table">
        <tr><th>계급/성명</th><th>소속</th><th>운동 항목</th></tr>
        <tr><td>병장 장성호</td><td>2소대 3분대</td><td>웨이트 트레이닝</td></tr>
        <tr><td>상병 정현우</td><td>1소대 2분대</td><td>탁구</td></tr>
        <tr><td colspan="3" style="text-align:center; color:var(--app-muted);">외 10명 체육관 이용 중</td></tr>
      </table>
    `;
  } else if(key === 'loc_ground') {
    titleEl.innerText = "연병장/작업 위치 용사 명단 (13명)";
    bodyEl.innerHTML = `
      <table class="info-table">
        <tr><th>계급/성명</th><th>소속</th><th>작업 내용</th></tr>
        <tr><td>상병 한상진</td><td>본부소대</td><td>배수로 정비</td></tr>
        <tr><td>일병 김태양</td><td>3소대 2분대</td><td>연병장 제초 작업</td></tr>
        <tr><td colspan="3" style="text-align:center; color:var(--app-muted);">외 11명 부대정비 작업 중</td></tr>
      </table>
    `;
  } else if(key === 'armory_k2' || key === 'armory_ammo') {
    titleEl.innerText = "무기 및 탄약 불출 상세 기록";
    bodyEl.innerHTML = `
      <table class="info-table">
        <tr><th>구분</th><th>총번/품목</th><th>사용자</th><th>목적</th></tr>
        <tr><td>K2 소총</td><td>#502911</td><td>병장 김유신</td><td>당직근무</td></tr>
        <tr><td>K2 소총</td><td>#502912</td><td>상병 척준경</td><td>당직근무</td></tr>
        <tr><td>K2 소총</td><td>#503001~8</td><td>1소대 1분대</td><td>주간 경계근무</td></tr>
        <tr><td>탄약</td><td>5.56mm (300발)</td><td>탄약고 관리관</td><td>탄약 수불 이상무</td></tr>
      </table>
    `;
  } else if(key.startsWith('fuel_tank')) {
    titleEl.innerText = "선택 유류탱크 상세 점검 기록";
    bodyEl.innerHTML = `
      <table class="info-table">
        <tr><th>항목</th><th>상세 정보</th></tr>
        <tr><td>최초 검사일</td><td>2026.01.10</td></tr>
        <tr><td>최종 점검자</td><td>원사 이진성 (수송관)</td></tr>
        <tr><td>수분 센서 반응</td><td>정상 (침전물 없음)</td></tr>
        <tr><td>최근 보충일</td><td>2026.08.18 (500L 보충)</td></tr>
      </table>
    `;
  } else {
    titleEl.innerText = "유류 전체 수불 및 재고 세부 기록";
    bodyEl.innerHTML = `
      <table class="info-table">
        <tr><th>일자</th><th>탱크명</th><th>수수량</th><th>잔량</th></tr>
        <tr><td>2026.08.20</td><td>휘발유 1호</td><td>+500 L (입고)</td><td>1,700 L</td></tr>
        <tr><td>2026.08.22</td><td>경유 1호</td><td>-100 L (배차)</td><td>2,000 L</td></tr>
      </table>
    `;
  }

  document.getElementById('dashDetailOverlay').classList.add('active');
}

function closeDashDetailPopup() { document.getElementById('dashDetailOverlay').classList.remove('active'); }

function renderList() {
  const listEl = document.getElementById('requestList');
  listEl.innerHTML = '';
  const filtered = requests.filter(r => currentFilter === 'ALL' || r.status === currentFilter);

  if(filtered.length === 0) {
    listEl.innerHTML = `<div class="empty-msg">해당 안건이 없습니다.</div>`;
  } else {
    filtered.forEach(item => {
      let badgeHtml = '';
      if(item.status === 'REVIEW') badgeHtml = `<span class="badge badge-review">검토대기</span>`;
      else if(item.status === 'APPROVAL') badgeHtml = `<span class="badge badge-approval">결재대기</span>`;
      else if(item.status === 'SUCCESS') badgeHtml = `<span class="badge badge-success">최종승인</span>`;
      else if(item.status === 'REJECT') badgeHtml = `<span class="badge badge-reject">반려</span>`;

      const card = document.createElement('div');
      card.className = 'req-card';
      card.onclick = () => openPopup(item.id);
      card.innerHTML = `
        <div class="card-header">
          <strong class="card-title">(${escapeHtml(item.type)}) ${escapeHtml(item.user)}</strong>
          ${badgeHtml}
        </div>
        <div class="card-meta">일정: ${escapeHtml(item.date)}</div>
        <div class="card-meta">사유: ${escapeHtml(item.reason)}</div>
      `;
      listEl.appendChild(card);
    });
  }

  // 내 권한이 처리할 단계의 대기 건수 (행보관=검토대기 / 중대장=결재대기)
  const myPending = ROLE_INFO[currentRole].pending;
  document.getElementById('statReview').innerText = requests.filter(r => r.status === myPending).length + '건';
  renderApprovalFlow();
}

function renderMedicalList() {
  const listEl = document.getElementById('medicalList');
  listEl.innerHTML = '';
  const filtered = medicalRequests.filter(m => currentMedicalFilter === 'ALL' || m.status === currentMedicalFilter);

  if(filtered.length === 0) {
    listEl.innerHTML = `<div class="empty-msg">진료 신청 내역이 없습니다.</div>`;
  } else {
    filtered.forEach(item => {
      let badgeHtml = item.status === 'SUBMITTED'
        ? `<span class="badge badge-review">확인대기</span>`
        : `<span class="badge badge-success">확인완료</span>`;

      const card = document.createElement('div');
      card.className = 'req-card';
      card.onclick = () => openMedicalPopup(item.id);
      card.innerHTML = `
        <div class="card-header">
          <strong class="card-title">[진료확인] ${escapeHtml(item.user)} (${escapeHtml(item.medicalType)})</strong>
          ${badgeHtml}
        </div>
        <div class="card-meta">병원/과: ${escapeHtml(item.hospital)} (${escapeHtml(item.dept)})</div>
        <div class="card-meta">희망일: ${escapeHtml(item.date)}</div>
      `;
      listEl.appendChild(card);
    });
  }

  document.getElementById('statMedicalPending').innerText = medicalRequests.filter(m => m.status === 'SUBMITTED').length + '건';
}

function renderHomeNotif() {
  const notifContainer = document.getElementById('recentNotifList');
  notifContainer.innerHTML = '';

  const recentItems = [
    ...requests.map(r => ({ ...r, category: '출타' })),
    ...medicalRequests.map(m => ({ id: m.id, type: '진료', user: m.user, reason: `${m.hospital} (${m.dept})`, category: '진료' }))
  ].slice(0, 3);

  recentItems.forEach(req => {
    const item = document.createElement('div');
    item.className = 'notif-item';
    item.onclick = () => {
      if(req.category === '출타') { switchNav('approval'); openPopup(req.id); }
      else { switchNav('hospital'); openMedicalPopup(req.id); }
    };
    item.innerHTML = `
      <div>
        <strong>[${escapeHtml(req.type)}] ${escapeHtml(req.user)}</strong>
        <div class="notif-sub">${escapeHtml(req.reason)}</div>
      </div>
      <i class="bp-icon bp-icon-chevron-right" aria-hidden="true"></i>
    `;
    notifContainer.appendChild(item);
  });
}

/* 필터 탭 — 클릭한 버튼에 active 표시까지 처리 */
function setActiveTab(btn) {
  if(!btn || !btn.parentElement) return;
  btn.parentElement.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}
function filterList(filterType, btn) { currentFilter = filterType; setActiveTab(btn); renderList(); }
function filterMedical(filterType, btn) { currentMedicalFilter = filterType; setActiveTab(btn); renderMedicalList(); }

function openPopup(id) {
  selectedReqId = id;
  const req = requests.find(r => r.id === id);
  if(!req) return;

  document.getElementById('mType').innerText = req.type;
  document.getElementById('mUser').innerText = req.user;
  document.getElementById('mCode').innerText = req.code;
  document.getElementById('mDate').innerText = req.date;
  document.getElementById('mDestination').innerText = req.dest;
  document.getElementById('mReason').innerText = req.reason;

  const actionGroup = document.getElementById('actionBtnGroup');
  const approveBtn = document.getElementById('approveBtnText');
  const rejectRow = document.getElementById('rejectReasonRow');

  let statusTxt = req.status === 'REVIEW' ? '행정보급관 검토 대기 중' : (req.status === 'APPROVAL' ? '중대장 결재 대기 중' : (req.status === 'SUCCESS' ? '최종 승인 완료' : '반려 처리됨'));
  document.getElementById('mStatus').innerText = statusTxt;

  if(req.status === 'REJECT') {
    rejectRow.style.display = 'table-row';
    document.getElementById('mRejectReason').innerText = req.rejectReason || '사유 미기재';
  } else {
    rejectRow.style.display = 'none';
  }

  if(currentRole === 'ADMIN' && req.status === 'REVIEW') {
    actionGroup.style.display = 'flex';
    approveBtn.innerText = '검토 후 결재 상신';
  } else if(currentRole === 'COMMANDER' && req.status === 'APPROVAL') {
    actionGroup.style.display = 'flex';
    approveBtn.innerText = '최종 결재 승인';
  } else {
    actionGroup.style.display = 'none';
  }

  document.getElementById('layerOverlay').classList.add('active');
}

function closePopup() { document.getElementById('layerOverlay').classList.remove('active'); }

function openMedicalPopup(id) {
  selectedMedicalId = id;
  const med = medicalRequests.find(m => m.id === id);
  if(!med) return;

  document.getElementById('medUser').innerText = med.user;
  document.getElementById('medCode').innerText = med.code;
  document.getElementById('medMedicalType').innerText = med.medicalType;
  document.getElementById('medHospital').innerText = med.hospital;
  document.getElementById('medDept').innerText = med.dept;
  document.getElementById('medDate').innerText = med.date;
  document.getElementById('medSymptom').innerText = med.symptom;
  document.getElementById('medStatus').innerText = med.status === 'SUBMITTED' ? '확인 대기 중' : '간부 확인 완료';

  const confirmBtn = document.getElementById('medConfirmBtn');
  confirmBtn.style.display = med.status === 'SUBMITTED' ? 'inline-flex' : 'none';

  document.getElementById('medicalLayerOverlay').classList.add('active');
}

function closeMedicalPopup() { document.getElementById('medicalLayerOverlay').classList.remove('active'); }

function openRejectPopup() {
  const rejectInput = document.getElementById('rejectInput');
  if(rejectInput) rejectInput.value = '';
  document.getElementById('rejectOverlay').classList.add('active');
}

function closeRejectPopup() { document.getElementById('rejectOverlay').classList.remove('active'); }

function openConfirmModal(msg, actionFn) {
  document.getElementById('confirmMessage').innerText = msg;
  pendingAction = actionFn;
  document.getElementById('confirmOverlay').classList.add('active');
}

function closeConfirmPopup() {
  document.getElementById('confirmOverlay').classList.remove('active');
  pendingAction = null;
}

function executePendingAction() {
  const fn = pendingAction;
  pendingAction = null;
  document.getElementById('confirmOverlay').classList.remove('active');
  if(typeof fn === 'function') fn();
}

function requestMedicalConfirm() {
  openConfirmModal('진료 신청 내역을 확인 처리하시겠습니까?', () => {
    const med = medicalRequests.find(m => m.id === selectedMedicalId);
    if(med) med.status = 'CONFIRMED';
    closeMedicalPopup();
    renderMedicalList();
    renderHomeNotif();
  });
}

function requestRejectConfirm() {
  const reasonText = document.getElementById('rejectInput').value.trim();
  if(!reasonText) return alert('반려 사유를 입력하세요.');

  openConfirmModal('입력한 사유로 반려하시겠습니까?', () => {
    const req = requests.find(r => r.id === selectedReqId);
    if(req) {
      req.status = 'REJECT';
      req.rejectReason = reasonText;
    }
    closeRejectPopup();
    closePopup();
    renderList();
    renderHomeNotif();
  });
}

function requestApproveConfirm() {
  const actionTxt = currentRole === 'ADMIN' ? '검토 완료 후 상신하시겠습니까?' : '최종 결재 승인하시겠습니까?';
  openConfirmModal(actionTxt, () => {
    const req = requests.find(r => r.id === selectedReqId);
    if(req) {
      if(currentRole === 'ADMIN') req.status = 'APPROVAL';
      else if(currentRole === 'COMMANDER') req.status = 'SUCCESS';
    }
    closePopup();
    renderList();
    renderHomeNotif();
  });
}

/* ===========================================================================
   RAG 기반 AI 현장 분석 시뮬레이션
   ---------------------------------------------------------------------------
   [수정 2026-08-25] 종전 구현의 문제와 조치
     ① index.html 의 <script type="module"> 안에서 window.runSimulation 을 정의했다.
        → file:// 로 열면 모듈 import 가 CORS 로 차단돼 함수가 아예 정의되지 않았다.
        → 일반 스크립트(ragScenarios.js · ragSimulator.js)로 바꾸고 여기로 옮겼다.
     ② 진행 팝업(#ragModalPopup)이 .modal 클래스만 있고 CSS 정의가 없어
        시뮬레이션은 돌지만 화면에 아무것도 보이지 않았다.
        → 앱 공통 .overlay/.popup 구조로 통일(style.css).
     ③ 완료 결과를 alert 로만 띄웠다 → 리포트 팝업으로 렌더링.
     ④ 중복 클릭 가드가 없었다 → 버튼 비활성화 + 시뮬레이터 내부 가드.
   =========================================================================== */

/* ------------------------- 현장 사진 첨부 (분석 전 단계) --------------------
   흐름 : 시나리오 선택 → 현장에서 촬영된 사진 첨부 → AI 분석 시작
   시나리오별 실제 현장 사진(images/scenes/*.jpg)만 사용한다.
   [수정 2026-08-25] 기기에서 이미지 선택 기능 제거 —
     시연용 시뮬레이션이라 임의 사진을 넣어도 분석 결과가 달라지지 않아
     오히려 혼동만 준다는 판단(사용자 지시).
   --------------------------------------------------------------------------- */

let ragAttached = null;   // { src, name, sub } — 확정 첨부본
let ragPicking = null;    // 팝업에서 고르는 중인 후보

function getSelectedScenario() {
  const sel = document.getElementById('scenarioSelect');
  const list = window.RAG_SCENARIOS || [];
  return list.find(s => s.id === (sel ? sel.value : '')) || list[0] || null;
}

function openRagAttach() {
  const sc = getSelectedScenario();
  if(!sc) { alert('시나리오 데이터를 불러오지 못했습니다.'); return; }

  document.getElementById('ragAttachScenario').innerText = sc.title;
  const img = document.getElementById('ragPickImg');
  img.src = sc.sceneImage;
  img.alt = sc.sceneAlt || sc.title;
  document.getElementById('ragPickName').innerText = sc.location + ' 현장 촬영본';
  document.getElementById('ragPickSub').innerText = sc.capturedBy || '현장 촬영';

  // 이미 첨부돼 있으면 그 상태를 그대로 보여준다
  ragPicking = ragAttached ? Object.assign({}, ragAttached) : null;
  syncRagPickUI();

  document.getElementById('ragAttachOverlay').classList.add('active');
}

function closeRagAttach() {
  document.getElementById('ragAttachOverlay').classList.remove('active');
  ragPicking = null;
}

function syncRagPickUI() {
  const sc = getSelectedScenario();
  const sampleSelected = !!(ragPicking && sc && ragPicking.src === sc.sceneImage);
  document.getElementById('ragPickSample').classList.toggle('is-selected', sampleSelected);
}

/* 현장 촬영본 선택 */
function pickRagSample() {
  const sc = getSelectedScenario();
  if(!sc) return;
  ragPicking = { src: sc.sceneImage, name: sc.location + ' 현장 촬영본', sub: sc.capturedBy || '현장 촬영' };
  syncRagPickUI();
}

/* 첨부 확정 */
function confirmRagAttach() {
  if(!ragPicking) {
    alert('사진을 선택해 주세요.');
    return;
  }
  ragAttached = Object.assign({}, ragPicking);
  renderRagAttachState();
  closeRagAttach();
}

/* 첨부 상태를 제어부에 반영 */
function renderRagAttachState() {
  const box = document.getElementById('ragAttach');
  const thumb = document.getElementById('ragAttachThumb');
  const title = document.getElementById('ragAttachTitle');
  const desc = document.getElementById('ragAttachDesc');
  if(!box) return;

  if(ragAttached) {
    box.classList.add('is-attached');
    thumb.innerHTML = '<img src="' + escapeHtml(ragAttached.src) + '" alt="">';
    title.innerText = ragAttached.name;
    desc.innerText = '첨부 완료 · AI 분석 준비됨';
  } else {
    box.classList.remove('is-attached');
    thumb.innerHTML = '<i class="bp-icon bp-icon-presentation" aria-hidden="true"></i>';
    title.innerText = '현장 사진 미첨부';
    desc.innerText = '촬영된 현장 사진을 확인하고 첨부하세요.';
  }
}

/* 시나리오를 바꾸면 첨부본을 비운다 (이미지와 시나리오가 어긋나지 않도록) */
function onScenarioChange() {
  ragAttached = null;
  ragPicking = null;
  renderRagAttachState();
}

function setRagStepState(currentStep) {
  document.querySelectorAll('#ragStepList .rag-step').forEach(function (li) {
    const step = Number(li.dataset.step);
    li.classList.toggle('is-done', step < currentStep);
    li.classList.toggle('is-active', step === currentStep);
  });
}

function runSimulation() {
  const selectEl = document.getElementById('scenarioSelect');
  const startBtn = document.getElementById('btnStartSimulation');
  const modal = document.getElementById('ragModalPopup');
  const progressText = document.getElementById('popupProgressText');
  const progressBar = document.getElementById('popupProgressBar');

  if(!selectEl || !modal || !progressText || !progressBar) {
    console.error('RAG 시뮬레이션 UI 요소를 찾을 수 없습니다.');
    return;
  }
  // 시뮬레이터 로드 확인 (스크립트 순서/경로 문제를 조용히 넘기지 않는다)
  if(typeof startRagSimulation !== 'function') {
    alert('시뮬레이터를 불러오지 못했습니다.\nragScenarios.js · ragSimulator.js 로드를 확인하세요.');
    return;
  }
  // 중복 실행 가드
  if(typeof isRagSimulationRunning === 'function' && isRagSimulationRunning()) return;

  // 현장 사진이 있어야 AI 멀티모달 분석을 시작할 수 있다
  if(!ragAttached) {
    alert('현장 사진을 먼저 첨부해 주세요.');
    openRagAttach();
    return;
  }

  const selectedId = selectEl.value;
  if(startBtn) startBtn.disabled = true;

  // 진행 팝업 상단에 첨부한 이미지를 띄운다
  const thumb = document.getElementById('ragProgressThumb');
  if(thumb) { thumb.src = ragAttached.src; thumb.hidden = false; }
  const attachedSnapshot = Object.assign({}, ragAttached);

  startRagSimulation(
    selectedId,
    // 진행상황 콜백
    function (progress) {
      if(progress.isOpen) {
        modal.classList.add('active');
        progressText.innerHTML =
          '<strong>' + progress.currentStep + ' / ' + progress.totalSteps + ' 단계</strong>' + escapeHtml(progress.message);
        progressBar.style.width = progress.percent + '%';
        setRagStepState(progress.currentStep);
      } else {
        modal.classList.remove('active');
      }
    },
    // 완료 콜백 — 이력에 쌓고 리포트 팝업 렌더링
    function (report) {
      if(startBtn) startBtn.disabled = false;
      const saved = Object.assign({}, report, {
        historyId: Date.now(),
        attachedImage: attachedSnapshot.src,
        attachedName: attachedSnapshot.name
      });
      ragHistory.unshift(saved);   // 최신순
      updateRagCount();
      renderRagReportList();
      renderRagReport(saved);
    },
    // 오류 콜백
    function (err) {
      if(startBtn) startBtn.disabled = false;
      modal.classList.remove('active');
      console.error('RAG 시뮬레이션 오류:', err);
      alert('분석 중 오류가 발생했습니다.\n' + (err && err.message ? err.message : ''));
    }
  );
}

function renderRagReport(report) {
  const bodyEl = document.getElementById('ragReportBody');
  if(!bodyEl) return;

  const riskClass = { LOW: 'rag-risk--low', MODERATE: 'rag-risk--moderate', HIGH: 'rag-risk--high' }[report.riskLevel] || 'rag-risk--moderate';
  const riskIcon  = { LOW: 'small-tick', MODERATE: 'warning-sign', HIGH: 'warning-sign' }[report.riskLevel] || 'warning-sign';
  const sources = (report.ragSources || []).map(function (s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('');

  // 분석에 사용된 현장 사진 (없으면 시나리오 기본 사진)
  const imgSrc = report.attachedImage || report.sceneImage || '';
  const imgBlock = imgSrc
    ? '<div>' +
        '<img class="rag-report-image" src="' + escapeHtml(imgSrc) + '" alt="' + escapeHtml(report.sceneAlt || report.title) + '">' +
        '<p class="rag-report-caption"><i class="bp-icon bp-icon-clip" aria-hidden="true"></i> 분석 대상 사진 · ' +
          escapeHtml(report.attachedName || '현장 촬영본') + '</p>' +
      '</div>'
    : '';

  // AI 비전 분석 결과 (사진에서 무엇을 읽어냈는지)
  const visionItems = (report.aiVision || []).map(function (v) {
    return '<li>' + escapeHtml(v) + '</li>';
  }).join('');
  const visionBlock = visionItems
    ? '<div class="rag-ai-box">' +
        '<div class="rag-ai-head">' +
          '<span class="rag-ai-title"><i class="bp-icon bp-icon-ai" aria-hidden="true"></i> AI 비전 분석 결과</span>' +
          (report.aiConfidence != null
            ? '<span class="rag-ai-conf">신뢰도 ' + escapeHtml(String(report.aiConfidence)) + '%</span>' : '') +
        '</div>' +
        '<ul class="rag-ai-list">' + visionItems + '</ul>' +
        (report.aiModel ? '<p class="rag-ai-model">분석 모델 · ' + escapeHtml(report.aiModel) + '</p>' : '') +
      '</div>'
    : '';

  bodyEl.innerHTML =
    '<div class="rag-report">' +
      '<div class="rag-report-head">' +
        '<div class="rag-report-title">' + escapeHtml(report.title) + '</div>' +
        '<div class="rag-report-tags">' +
          '<span class="rag-risk ' + riskClass + '"><i class="bp-icon bp-icon-' + riskIcon + '" aria-hidden="true"></i> 위협수준 ' + escapeHtml(report.riskText) + '</span>' +
          '<span class="rag-chip">' + escapeHtml(report.category) + '</span>' +
        '</div>' +
      '</div>' +
      imgBlock +
      '<table class="info-table">' +
        '<tr><th>발생 위치</th><td>' + escapeHtml(report.location) + '</td></tr>' +
        '<tr><th>확보 증거</th><td>' + escapeHtml(report.evidence) + '</td></tr>' +
        '<tr><th>촬영 경위</th><td>' + escapeHtml(report.capturedBy || '현장 촬영') + '</td></tr>' +
        '<tr><th>분석 시각</th><td>' + escapeHtml(formatIsoTime(report.analyzedAt)) + '</td></tr>' +
      '</table>' +
      visionBlock +
      '<div>' +
        '<div class="rag-sub-label" style="margin-bottom:.6rem;">AI 종합 판단</div>' +
        '<div class="rag-report-result">' + escapeHtml(report.analysisResult) + '</div>' +
      '</div>' +
      '<div>' +
        '<div class="rag-sub-label" style="margin-bottom:.6rem;">RAG 참조 지식 출처</div>' +
        '<ul class="rag-sources">' + sources + '</ul>' +
      '</div>' +
    '</div>';

  document.getElementById('ragReportOverlay').classList.add('active');
}

function formatIsoTime(iso) {
  const d = new Date(iso);
  if(isNaN(d.getTime())) return String(iso || '-');
  return d.getFullYear() + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + String(d.getDate()).padStart(2,'0') + ' ' +
         String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
}

function closeRagReport() {
  document.getElementById('ragReportOverlay').classList.remove('active');
}

/* ------------------------- RAG 분석 결과 조회 화면 ------------------------- */

const RAG_RISK_META = {
  LOW:      { cls: 'rag-risk--low',      badge: 'badge-success',  label: '낮음' },
  MODERATE: { cls: 'rag-risk--moderate', badge: 'badge-approval', label: '보통' },
  HIGH:     { cls: 'rag-risk--high',     badge: 'badge-reject',   label: '높음' }
};

function updateRagCount() {
  const n = ragHistory.length;
  const badge = document.getElementById('ragCountBadge');
  const stat = document.getElementById('statRagCount');
  if(badge) badge.innerText = n;
  if(stat) stat.innerText = n + '건';
}

function filterRag(level, btn) {
  currentRagFilter = level;
  setActiveTab(btn);
  renderRagReportList();
}

function renderRagReportList() {
  const listEl = document.getElementById('ragReportList');
  if(!listEl) return;
  listEl.innerHTML = '';
  updateRagCount();

  const rows = ragHistory.filter(r => currentRagFilter === 'ALL' || r.riskLevel === currentRagFilter);

  if(rows.length === 0) {
    listEl.innerHTML = ragHistory.length === 0
      ? `<div class="empty-msg">아직 분석 결과가 없습니다.<br>위에서 시나리오와 현장 사진을 선택한 뒤 &lsquo;AI 분석 시작&rsquo;을 누르세요.</div>`
      : `<div class="empty-msg">해당 위협수준의 분석 결과가 없습니다.</div>`;
    return;
  }

  rows.forEach(item => {
    const meta = RAG_RISK_META[item.riskLevel] || RAG_RISK_META.MODERATE;
    const card = document.createElement('div');
    card.className = 'req-card';
    card.onclick = () => openRagHistory(item.historyId);
    card.innerHTML = `
      <div class="card-header">
        <strong class="card-title">${escapeHtml(item.title)}</strong>
        <span class="badge ${meta.badge}">${escapeHtml(meta.label)}</span>
      </div>
      <div class="card-meta">구분: ${escapeHtml(item.category)} / 위치: ${escapeHtml(item.location)}</div>
      <div class="card-meta">분석시각: ${escapeHtml(formatIsoTime(item.analyzedAt))}</div>
      <div class="card-meta card-meta--accent">위협수준: ${escapeHtml(item.riskText)}</div>
    `;
    listEl.appendChild(card);
  });
}

function openRagHistory(historyId) {
  const item = ragHistory.find(r => r.historyId === historyId);
  if(item) renderRagReport(item);
}

/* 권한 세그먼트 (출타 결재 화면) */
document.addEventListener('click', function (e) {
  const rb = e.target.closest('.appr-role-btn');
  if(rb) setRole(rb.dataset.role);
});

/* 오버레이 배경 클릭 / ESC 로 닫기 (진행 중 팝업은 제외) */
document.addEventListener('click', function (e) {
  if(e.target.classList && e.target.classList.contains('overlay') && e.target.id !== 'ragModalPopup') {
    e.target.classList.remove('active');
    if(e.target.id === 'confirmOverlay') pendingAction = null;
  }
});
document.addEventListener('keydown', function (e) {
  if(e.key !== 'Escape') return;
  const open = Array.from(document.querySelectorAll('.overlay.active')).filter(function (o) { return o.id !== 'ragModalPopup'; });
  if(!open.length) return;
  const top = open[open.length - 1];
  top.classList.remove('active');
  if(top.id === 'confirmOverlay') pendingAction = null;
});

/* ===========================================================================
   무입력 자동 초기화 (데모/키오스크용)
   ---------------------------------------------------------------------------
   1분 동안 입력이 없으면 그 사이 입력·수정된 모든 내용을 되돌리고
   첫 화면(홈)으로 복귀한다. 남은 10초부터는 하단에 안내를 띄운다.

   🔴 이미 초기 상태(= 바뀐 내용이 하나도 없음)라면 카운트하지 않는다.
      되돌릴 게 없는데 안내가 반복해서 뜨고 재초기화되는 것을 막기 위함.
      (사용자 지시 2026-08-25)
   =========================================================================== */

const IDLE_LIMIT_MS = 60000;   // 무입력 제한 시간 (1분)
const IDLE_WARN_MS  = 10000;   // 남은 시간이 이보다 적으면 안내 노출

let idleLastInput = Date.now();
let idleTickTimer = null;

/* 지금 화면/데이터가 '처음 상태 그대로'인가? — 참이면 초기화가 불필요하다 */
function isPristine() {
  // 1) 데이터가 초기값 그대로인가
  if(JSON.stringify(requests) !== JSON.stringify(INITIAL_REQUESTS)) return false;
  if(JSON.stringify(medicalRequests) !== JSON.stringify(INITIAL_MEDICAL)) return false;
  if(JSON.stringify(frHistoryList) !== JSON.stringify(INITIAL_FR_HISTORY)) return false;
  if(ragHistory.length !== 0) return false;

  // 2) 선택/진행 상태
  if(currentRole !== 'ADMIN') return false;
  if(currentFilter !== 'ALL' || currentMedicalFilter !== 'ALL' || currentRagFilter !== 'ALL') return false;
  if(currentEvent || frCurrentStep !== 0) return false;

  // 3) 화면이 첫 화면(홈)인가 · 열린 팝업/배너가 없는가
  const activeView = document.querySelector('.view-page.active');
  if(!activeView || activeView.id !== 'viewHome') return false;
  if(document.querySelectorAll('.overlay.active').length > 0) return false;
  const push = document.getElementById('pushBanner');
  if(push && push.classList.contains('active')) return false;

  // 4) 입력 폼이 비어 있는가
  const rejectInput = document.getElementById('rejectInput');
  if(rejectInput && rejectInput.value.trim() !== '') return false;
  const frDetail = document.getElementById('frActionDetail');
  if(frDetail && frDetail.value.trim() !== '') return false;
  const scenarioSel = document.getElementById('scenarioSelect');
  if(scenarioSel && scenarioSel.selectedIndex !== 0) return false;
  if(ragAttached) return false;   // 현장 사진을 첨부했으면 변경된 상태다
  const demo = document.getElementById('demoTools');
  if(demo && demo.open) return false;   // 시연 도구를 펼쳐 뒀으면 변경된 상태다

  // 5) GIS 상황판(시나리오·레이어·확대·선택)도 초기 상태여야 한다
  if(window.GisBoard && !GisBoard.isPristine()) return false;

  return true;
}

/* 전체 상태를 초기값으로 되돌린다 */
function resetAppState() {
  // 1) 데이터 원복
  requests = cloneRows(INITIAL_REQUESTS);
  medicalRequests = cloneRows(INITIAL_MEDICAL);
  frHistoryList = cloneRows(INITIAL_FR_HISTORY);
  ragHistory = [];

  // 2) 선택/진행 상태 원복
  currentRole = 'ADMIN';
  currentFilter = 'ALL';
  currentMedicalFilter = 'ALL';
  currentRagFilter = 'ALL';
  selectedReqId = null;
  selectedMedicalId = null;
  pendingAction = null;
  currentEvent = null;
  frCurrentStep = 0;

  // 3) 열려 있는 팝업 전부 닫기
  document.querySelectorAll('.overlay.active').forEach(function (o) { o.classList.remove('active'); });
  dismissPushBanner();

  // 4) 입력 폼 원복
  const scenarioSel = document.getElementById('scenarioSelect');
  if(scenarioSel) scenarioSel.selectedIndex = 0;
  const rejectInput = document.getElementById('rejectInput');
  if(rejectInput) rejectInput.value = '';
  const frDetail = document.getElementById('frActionDetail');
  if(frDetail) frDetail.value = '';
  const frType = document.getElementById('frActionType');
  if(frType) frType.selectedIndex = 0;
  const startBtn = document.getElementById('btnStartSimulation');
  if(startBtn) startBtn.disabled = false;
  // 첨부한 현장 사진도 비운다
  ragAttached = null;
  ragPicking = null;
  renderRagAttachState();
  const progThumb = document.getElementById('ragProgressThumb');
  if(progThumb) { progThumb.hidden = true; progThumb.src = ''; }
  // 시연 도구 접기
  const demo = document.getElementById('demoTools');
  if(demo) demo.open = false;

  // 5) 필터 탭 전부 첫 번째(전체)로
  document.querySelectorAll('.filter-tabs').forEach(function (group) {
    const tabs = group.querySelectorAll('.tab-btn');
    tabs.forEach(function (t, i) { t.classList.toggle('active', i === 0); });
  });

  // 6) 초동조치 탭 원복 + 진행 카드 숨김
  const frTabA = document.getElementById('frTabActive');
  const frTabH = document.getElementById('frTabHistory');
  if(frTabA && frTabH) {
    frTabA.classList.add('active');
    frTabH.classList.remove('active');
    document.getElementById('frActiveSection').style.display = 'block';
    document.getElementById('frHistorySection').style.display = 'none';
  }

  // 7) 차트 정리 · GIS 상황판 원복
  if(activeChart) { activeChart.destroy(); activeChart = null; }
  if(window.GisBoard) GisBoard.reset();

  // 8) 다시 그리기 + 첫 화면으로
  setRole('ADMIN');      // applyRoleUI / renderList / renderMedicalList / renderHomeNotif 포함
  renderRagReportList();
  switchNav('home');
}

function showIdleNotice(secondsLeft) {
  const el = document.getElementById('idleNotice');
  if(!el) return;
  const sec = document.getElementById('idleSeconds');
  if(sec) sec.innerText = secondsLeft;
  el.classList.add('is-show');
}

function hideIdleNotice() {
  const el = document.getElementById('idleNotice');
  if(el) el.classList.remove('is-show');
}

/* 입력이 있을 때마다 타이머를 되감는다 */
function markUserInput() {
  idleLastInput = Date.now();
  hideIdleNotice();
}

function idleTick() {
  // RAG 시뮬레이션이 도는 중에는 초기화하지 않는다 (진행 중 상태가 깨진다)
  if(typeof isRagSimulationRunning === 'function' && isRagSimulationRunning()) {
    markUserInput();
    return;
  }

  // 이미 초기 상태면 되돌릴 게 없다 → 카운트하지 않는다
  if(isPristine()) {
    hideIdleNotice();
    markUserInput();   // 타이머를 계속 되감아 둔다
    return;
  }

  const elapsed = Date.now() - idleLastInput;
  const remain = IDLE_LIMIT_MS - elapsed;

  if(remain <= 0) {
    hideIdleNotice();
    resetAppState();
    idleLastInput = Date.now();
    return;
  }
  if(remain <= IDLE_WARN_MS) {
    showIdleNotice(Math.ceil(remain / 1000));
  }
}

function startIdleWatch() {
  ['pointerdown', 'mousedown', 'click', 'keydown', 'input', 'change', 'wheel', 'touchstart', 'scroll']
    .forEach(function (evt) {
      document.addEventListener(evt, markUserInput, { capture: true, passive: true });
    });

  // 프레임 내부 스크롤도 입력으로 인정
  const content = document.querySelector('.app-content');
  if(content) content.addEventListener('scroll', markUserInput, { passive: true });

  if(idleTickTimer) clearInterval(idleTickTimer);
  idleTickTimer = setInterval(idleTick, 500);
  markUserInput();
}

// 초기화 실행
setRole('ADMIN');
renderRagReportList();
renderRagAttachState();
startIdleWatch();

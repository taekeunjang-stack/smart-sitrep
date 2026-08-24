// 1. 지도 생성 (초기 위치: 서울 광화문)
const map = L.map('map').setView([37.5759, 126.9768], 15);

// 어두운 테마 지도 레이어 적용 (CartoDB Dark Matter)
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap © CARTO'
}).addTo(map);

// 2. 가상 자원 객체
let unitMarker = L.marker([37.5759, 126.9768]).addTo(map).bindPopup("수색 1팀 (Blue-1)");
let dangerZone = null;

// 시나리오 타임라인 데이터
const scenarioData = [
  { time: 0, act: () => updateLog("상황판 가동 완료.") },
  { time: 2, act: () => {
      unitMarker.setLatLng([37.5765, 126.9775]);
      updateLog("Blue-1 팀 이동 개시");
  }},
  { time: 4, act: () => {
      unitMarker.setLatLng([37.5772, 126.9782]);
      dangerZone = L.circle([37.5780, 126.9790], {
        color: '#f85149', fillColor: '#f85149', fillOpacity: 0.3, radius: 150
      }).addTo(map);
      updateLog("⚠️ 경고: 미상 위험 요소 감지!");
  }},
  { time: 6, act: () => {
      unitMarker.setLatLng([37.5775, 126.9785]);
      updateLog("위험 구역 우회 경로 진입");
  }},
  { time: 8, act: () => {
      updateLog("수색 완료 및 상황 종료.");
      pauseScenario();
  }}
];

// 3. 타이머 제어 변수
let currentTime = 0;
let timerId = null;

function startScenario() {
  if (timerId) return;
  document.getElementById('system-status').innerText = "RUNNING";
  document.getElementById('system-status').style.background = "#238636";

  timerId = setInterval(() => {
    document.getElementById('timer').innerText = `T+0${currentTime}s`;
    
    // 해당 시간에 맞는 동작 실행
    const currentAct = scenarioData.find(item => item.time === currentTime);
    if (currentAct) currentAct.act();

    currentTime++;
  }, 1000);
}

function pauseScenario() {
  clearInterval(timerId);
  timerId = null;
  document.getElementById('system-status').innerText = "PAUSED";
  document.getElementById('system-status').style.background = "#d29922";
}

function resetScenario() {
  pauseScenario();
  currentTime = 0;
  document.getElementById('timer').innerText = "T+00s";
  document.getElementById('system-status').innerText = "STANDBY";
  document.getElementById('system-status').style.background = "#21262d";
  
  unitMarker.setLatLng([37.5759, 126.9768]);
  if (dangerZone) map.removeLayer(dangerZone);
  updateLog("시나리오 대기 중...");
}

function updateLog(text) {
  document.getElementById('log-text').innerText = text;
}
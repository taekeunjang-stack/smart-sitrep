/*
 * RAG 시나리오 데이터
 * ---------------------------------------------------------------------------
 * [수정 2026-08-25] ES 모듈(export) → 일반 스크립트로 변경.
 *   사유: type="module" 은 file:// 로 열면 CORS 정책에 막혀 import 가 실패하고,
 *         그 결과 window.runSimulation 이 정의되지 않아 버튼이 동작하지 않았다.
 *         일반 스크립트로 두면 file:// · http:// 양쪽에서 모두 동작한다.
 *
 * [수정 2026-08-25] 현장 이미지를 자체 제작 SVG → **실제 사진**으로 교체.
 *   흐름이 "현장에서 사진을 촬영 → AI 가 분석" 이므로 사진이 맞다.
 *   사진 출처는 Unsplash (무료 이용 라이선스), 파일은 images/scenes/ 에 로컬 보관.
 *   각 시나리오에 AI 비전 분석 결과(aiVision · aiConfidence · aiModel)를 추가했다.
 */
(function (global) {
  "use strict";

  var RAG_SCENARIOS = [
    {
      id: "SCN-001",
      category: "대공분석",
      title: "대공혐의점 유실물 분석",
      location: "강원도 고성 해안가",
      evidence: "해안 순찰 중 수거한 휴대형 무선 송수신기 1점 (안테나 결합 상태)",
      capturedBy: "해안 경계병 현장 촬영",
      sceneImage: "images/scenes/scn-001.jpg",
      sceneAlt: "수거한 휴대형 무선 송수신기를 촬영한 현장 사진",

      aiModel: "Vision-LLM 멀티모달 분석",
      aiConfidence: 96.2,
      aiVision: [
        "휴대형 무선 수신기(스캐너) 식별 — 신뢰도 96.2%",
        "제조사 각인 'Uniden' · 모델 'EZI33XLT' 판독",
        "BNC 결합형 고무 안테나 — 민수용 규격",
        "군용 주파수 대역 전용 부품 미검출"
      ],

      ragSources: [
        "국내 전자기기 인증(KC) DB",
        "대공침투장비 카탈로그(2020-2025)",
        "민간 아마추어 무선기기 Registry"
      ],
      riskLevel: "LOW", // LOW, MODERATE, HIGH
      riskText: "낮음",
      analysisResult: "AI 비전 분석으로 판독한 제조사·모델명을 지식DB와 대조한 결과, 국내에 정식 시판된 민수용 아마추어 무선 수신기(KC인증 완료)로 확인되었습니다. 군용 개조 흔적이 없어 대공혐의점은 낮은 것으로 판단됩니다."
    },
    {
      id: "SCN-002",
      category: "시설보안",
      title: "국가중요시설 드론 침입 분석",
      location: "세종 정부청사 외곽 3구역",
      evidence: "청사 상공 무단 비행 중 포착된 소형 회전익 무인기 1대",
      capturedBy: "외곽 경비초소 현장 촬영",
      sceneImage: "images/scenes/scn-002.jpg",
      sceneAlt: "청사 상공에서 포착된 소형 촬영용 드론 사진",

      aiModel: "Vision-LLM 멀티모달 분석",
      aiConfidence: 93.8,
      aiVision: [
        "소형 접이식 쿼드콥터 식별 — 신뢰도 93.8%",
        "하단 3축 짐벌 카메라 장착 확인",
        "상용 소비자용 기체 형상과 형태 일치",
        "무장·투하 장치 등 군사 개조 흔적 미검출"
      ],

      ragSources: [
        "항공안전기술원 기체등록 DB",
        "미인증 해외 직구 드론 패턴 DB",
        "테러위해물품 규제 목록"
      ],
      riskLevel: "MODERATE",
      riskText: "보통 (위법 비행)",
      analysisResult: "AI 가 식별한 기체 형상을 등록 DB와 대조한 결과 미등록 상용 드론으로 확인되었습니다. 군사 개조 흔적은 없고 촬영 목적으로 추정되나, 국가중요시설 상공 무단 비행은 항공안전법 위반에 해당합니다."
    },
    {
      id: "SCN-003",
      category: "폭발물위협",
      title: "다중이용시설 의심 방치물 분석",
      location: "서울역 2층 대합실",
      evidence: "장시간 방치된 서류가방 1점 (소유자 미확인)",
      capturedBy: "역사 순찰요원 현장 촬영",
      sceneImage: "images/scenes/scn-003.jpg",
      sceneAlt: "대합실 선반에 방치된 서류가방을 촬영한 현장 사진",

      aiModel: "Vision-LLM 멀티모달 분석",
      aiConfidence: 88.5,
      aiVision: [
        "하드케이스형 서류가방 식별 — 신뢰도 88.5%",
        "외부 배선·타이머·안테나 등 기폭 의심 구조물 미검출",
        "표면 제조사 라벨 1개 확인 (판독 가능)",
        "가방 주변 인적 접촉 흔적 없음 — 방치 시간 42분 추정"
      ],

      ragSources: [
        "EOD 사설 폭발물 구조 DB",
        "시중 판매 타이머/스위치 모듈 DB",
        "최근 오인 신고 및 소품 이력"
      ],
      riskLevel: "LOW",
      riskText: "낮음 (단순 유실물 추정)",
      analysisResult: "AI 외형 분석에서 기폭장치로 볼 만한 외부 구조물이 확인되지 않았고, 최근 유사 신고 이력과 대조한 결과 단순 유실물일 가능성이 높습니다. 다만 내용물은 확인되지 않았으므로 EOD 정밀 검색 후 최종 판단이 필요합니다."
    },
    {
      id: "SCN-004",
      category: "해안경계",
      title: "서해안 부유물 표류 분석",
      location: "인천 옹진군 백령도 해안",
      evidence: "해안으로 밀려온 목재 구조물 및 부유 잔해물 다수",
      capturedBy: "해안 경계병 현장 촬영",
      sceneImage: "images/scenes/scn-004.jpg",
      sceneAlt: "백령도 해안으로 밀려온 목재 잔해물을 촬영한 현장 사진",

      aiModel: "Vision-LLM 멀티모달 분석",
      aiConfidence: 81.4,
      aiVision: [
        "목재 선체 구조물 추정 잔해 식별 — 신뢰도 81.4%",
        "인공 가공흔(절단면·결합부) 확인",
        "정탐·통신 장비로 볼 만한 금속 구조물 미검출",
        "표면 부착 해양생물로 표류 기간 2주 이상 추정"
      ],

      ragSources: [
        "북한 민간 어선 구조 및 자재 DB",
        "서해 해류 분석 및 이동 경로 모델 DB",
        "최근 표류 조난 이력"
      ],
      riskLevel: "MODERATE",
      riskText: "보통",
      analysisResult: "AI 가 식별한 목재 가공 방식과 해류 역추적 모델을 대조한 결과, 접경 해역 민간 어선의 파편일 가능성이 높습니다. 정탐 또는 침투 장비는 발견되지 않았으나 조난 선박 여부에 대한 추가 확인이 필요합니다."
    },
    {
      id: "SCN-005",
      category: "사이버/신호",
      title: "군사보호구역 불법 통신장비 분석",
      location: "경기 파주 군사기지 외곽 펜스",
      evidence: "펜스 인근 은닉 상태로 발견된 소형 단일보드 컴퓨터 및 무선 모듈",
      capturedBy: "외곽 수색조 현장 촬영",
      sceneImage: "images/scenes/scn-005.jpg",
      sceneAlt: "펜스 인근에서 발견된 소형 단일보드 컴퓨터 기판 근접 촬영 사진",

      aiModel: "Vision-LLM 멀티모달 분석",
      aiConfidence: 97.1,
      aiVision: [
        "단일보드 컴퓨터(Raspberry Pi) 기판 식별 — 신뢰도 97.1%",
        "보드 실크스크린 'Raspberry Pi' 각인 판독",
        "외장 무선 모듈 및 USB 포트 연결 흔적 확인",
        "장시간 무인 구동을 위한 외부 전원 결선 확인"
      ],

      ragSources: [
        "불법 도청/감청 장비 규격 DB",
        "해외 해킹 툴킷 HW 가이드",
        "군 통신 신호 주파수 간섭 DB"
      ],
      riskLevel: "HIGH",
      riskText: "매우 높음",
      analysisResult: "AI 가 판독한 보드 구성과 외부 전원·무선 모듈 결선을 해킹 툴킷 하드웨어 가이드와 대조한 결과, 무인 상태로 신호를 수집(스니핑)하도록 구성된 장비로 확인되었습니다. 즉시 장비 회수 및 통신 보안 점검이 필요한 심각한 보안위협 상황입니다."
    }
  ];

  global.RAG_SCENARIOS = RAG_SCENARIOS;
})(window);

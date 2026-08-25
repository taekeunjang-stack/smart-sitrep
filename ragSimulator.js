/*
 * RAG 분석 시뮬레이터
 * ---------------------------------------------------------------------------
 * [수정 2026-08-25]
 *  1) ES 모듈(import/export) → 일반 스크립트. file:// 로 열어도 동작하도록 변경.
 *  2) 중복 실행 가드 추가 — 진행 중 재호출 시 무시(팝업이 겹쳐 진행률이 뒤엉키던 문제).
 *  3) 예외 처리 추가 — 중간에 오류가 나도 팝업이 열린 채로 멈추지 않도록 정리.
 *  4) JSDoc 을 실제 콜백 시그니처(객체 전달)에 맞게 수정.
 */
(function (global) {
  "use strict";

  var isRunning = false;

  /**
   * RAG 분석 시뮬레이션 실행
   * @param {string} scenarioId - 실행할 시나리오 ID (예: 'SCN-001')
   * @param {function(Object):void} onProgress - 진행상황 콜백.
   *        { isOpen, currentStep, totalSteps, message, percent } 객체를 전달한다.
   * @param {function(Object):void} onComplete - 완료 콜백. 시나리오 + 분석 메타를 전달한다.
   * @param {function(Error):void} [onError] - 오류 콜백(선택).
   * @returns {Promise<void>}
   */
  async function startRagSimulation(scenarioId, onProgress, onComplete, onError) {
    // 2) 중복 실행 방지 — 진행 중이면 새 실행을 시작하지 않는다.
    if (isRunning) return;

    var scenarios = global.RAG_SCENARIOS;
    if (!scenarios || !scenarios.length) {
      var err = new Error("RAG_SCENARIOS 데이터를 찾을 수 없습니다. ragScenarios.js 로드를 확인하세요.");
      if (typeof onError === "function") onError(err);
      else console.error(err);
      return;
    }

    var scenario = scenarios.find(function (s) { return s.id === scenarioId; }) || scenarios[0];

    var steps = [
      { step: 1, text: "현장 촬영 사진 AI 비전 분석 중... 객체 식별 및 멀티모달 임베딩(Vectorization)" },
      { step: 2, text: "식별 결과로 Vector DB 검색 중... [참조: " + scenario.ragSources[0] + "]" },
      { step: 3, text: "검색된 지식 기반 Context Augmentation(문맥 증강) 구성 완료" },
      { step: 4, text: "LLM 추론 중... 위협수준 판정 및 분석 리포트 작성" }
    ];

    isRunning = true;

    try {
      // 단계별 진행 시뮬레이션 (각 단계 1초)
      for (var i = 0; i < steps.length; i++) {
        onProgress({
          isOpen: true,
          currentStep: steps[i].step,
          totalSteps: steps.length,
          message: steps[i].text,
          percent: ((i + 1) / steps.length) * 100
        });
        await new Promise(function (resolve) { setTimeout(resolve, 1000); });
      }

      // 완료 — 팝업 닫기 신호 후 리포트 전달
      onProgress({ isOpen: false, currentStep: steps.length, totalSteps: steps.length, message: "", percent: 100 });

      onComplete(Object.assign({}, scenario, {
        analyzedAt: new Date().toISOString(),
        status: "SUCCESS"
      }));
    } catch (e) {
      // 3) 오류가 나도 팝업은 반드시 닫는다.
      try { onProgress({ isOpen: false, currentStep: 0, totalSteps: steps.length, message: "", percent: 0 }); } catch (ignore) {}
      if (typeof onError === "function") onError(e);
      else console.error("RAG 시뮬레이션 오류:", e);
    } finally {
      isRunning = false;
    }
  }

  /** 현재 시뮬레이션 진행 여부 */
  function isRagSimulationRunning() { return isRunning; }

  global.startRagSimulation = startRagSimulation;
  global.isRagSimulationRunning = isRagSimulationRunning;
})(window);

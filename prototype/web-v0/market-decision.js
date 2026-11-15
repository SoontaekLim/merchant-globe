(function (global) {
  'use strict';

  // Pure UI interpretation of prices the player has actually observed locally.
  // These labels describe the past; they are not a profitability recommendation.
  const MODES = Object.freeze(['default', 'range-low', 'day-drop']);
  const MIN_RANGE_DAYS = 3;

  function signal(trend) {
    if (!trend || !Number.isFinite(trend.currentPrice) || !Number.isFinite(trend.minPrice) ||
        !Number.isFinite(trend.maxPrice) || trend.minPrice <= 0 ||
        trend.maxPrice < trend.minPrice || !Number.isInteger(trend.observedDays) ||
        trend.observedDays < MIN_RANGE_DAYS) {
      return { eligible: false, position: null, label: '관측 3일 미만 · 비교 보류' };
    }
    const span = trend.maxPrice - trend.minPrice;
    if (span === 0) {
      return { eligible: false, position: null, label: '관측 시세 동일 · 구간 비교 불가' };
    }
    const position = Math.min(100, Math.max(0,
      (trend.currentPrice - trend.minPrice) / span * 100));
    const label = position <= 25 ? '관측 저가권'
      : position >= 75 ? '관측 고가권' : '관측 중간권';
    return { eligible: true, position, label };
  }

  function sortRows(rows, mode) {
    if (!Array.isArray(rows)) throw new Error('상품 목록이 올바르지 않습니다.');
    if (!MODES.includes(mode)) throw new Error('지원하지 않는 시세 정렬 방식입니다.');
    if (mode === 'default') return rows.slice();
    const decorated = rows.map((row, index) => {
      const trend = row.trend;
      const summary = signal(trend);
      const value = mode === 'range-low'
        ? summary.position
        : trend && Number.isFinite(trend.previousDayPercent) ? trend.previousDayPercent : null;
      return { row, index, value };
    });
    decorated.sort((a, b) => {
      if (a.value == null && b.value != null) return 1;
      if (a.value != null && b.value == null) return -1;
      if (a.value != null && b.value != null && a.value !== b.value) return a.value - b.value;
      return a.index - b.index;
    });
    return decorated.map((entry) => entry.row);
  }

  const api = { MODES, MIN_RANGE_DAYS, signal, sortRows };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MerchantGlobeMarketDecision = api;
})(typeof window !== 'undefined' ? window : globalThis);

(() => {
  'use strict';

  const { Game, PRODUCTS, CITIES, ROUTES, INTEL_LEVELS } = window.MerchantGlobeCore;
  const SaveSystem = window.MerchantGlobeSave;
  const ReportSystem = window.MerchantGlobeReport;
  const TradeUX = window.MerchantGlobeTradeUX;
  const SAVE_KEY = 'merchant-globe.mvp.save.v1';
  const INTEL_VIEW_KEY = 'merchant-globe.mvp.intel-views.v1';
  const TRADE_CONTROL_KEY = 'merchant-globe.mvp.trade-controls.v1';

  let gameSeed = Date.now();
  let actionHistory = [];
  let game = new Game({ maxDay: 30, seed: gameSeed });
  let playReport = null;
  let intelViews = [];
  let tradeControls = [];
  let selectedQuantityMode = 'preset_1';
  let plannedDestinationId = null;
  let selectedIntelCity = 'busan';
  let toastTimer = null;

  const el = (id) => document.getElementById(id);
  const money = (n) => `₩${Math.round(Number(n) || 0).toLocaleString('ko-KR')}`;
  const signedMoney = (n) => `${n >= 0 ? '+' : '-'}${money(Math.abs(n))}`;
  const pct = (n) => `${n >= 0 ? '+' : ''}${Math.round(n)}%`;

  function productNames(ids) {
    return ids.map((id) => PRODUCTS.find((p) => p.id === id)?.name || id).join('·');
  }

  function cityProfileText(city) {
    const producers = Object.keys(city.production || {}).filter((id) => city.production[id] > 1.15);
    const consumers = Object.keys(city.consumption || {}).filter((id) => city.consumption[id] > 1.15);
    const parts = [];
    if (producers.length) parts.push(`생산 ${productNames(producers)}`);
    if (consumers.length) parts.push(`소비 ${productNames(consumers)}`);
    return parts.join(' · ');
  }

  function showToast(message, isError = false) {
    const node = el('toast');
    node.textContent = message;
    node.className = `toast show${isError ? ' error' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.className = 'toast'; node.textContent = ''; }, 2600);
  }

  function updateSaveStatus(hasSave) {
    const node = el('saveStatus');
    if (!node) return;
    node.textContent = hasSave ? `저장됨 · Day ${game.day}` : '저장 없음';
  }

  function storeIntelViews() {
    try {
      localStorage.setItem(INTEL_VIEW_KEY, JSON.stringify({ seed: gameSeed, views: intelViews }));
    } catch (error) {
      console.warn('Merchant Globe market-view log save failed:', error);
    }
  }

  function restoreIntelViews() {
    intelViews = [];
    try {
      const raw = localStorage.getItem(INTEL_VIEW_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (String(saved.seed) === String(gameSeed) && Array.isArray(saved.views)) {
        intelViews = saved.views.slice(-500);
      }
    } catch (error) {
      console.warn('Merchant Globe market-view log restore failed:', error);
    }
  }

  function trackIntelView(targetCityId) {
    const entry = ReportSystem.captureIntelView(game, targetCityId);
    entry.viewedAt = new Date().toISOString();
    intelViews.push(entry);
    intelViews = intelViews.slice(-500);
    storeIntelViews();
  }

  function storeTradeControls() {
    try {
      localStorage.setItem(TRADE_CONTROL_KEY, JSON.stringify({ seed: gameSeed, entries: tradeControls }));
    } catch (error) {
      console.warn('Merchant Globe trade-control log save failed:', error);
    }
  }

  function restoreTradeControls() {
    tradeControls = [];
    try {
      const saved = localStorage.getItem(TRADE_CONTROL_KEY);
      if (!saved) return;
      const data = JSON.parse(saved);
      if (String(data.seed) === String(gameSeed) && Array.isArray(data.entries)) {
        tradeControls = TradeUX.summarizeControls(actionHistory, data.entries.slice(-2000)).entries;
      }
    } catch (error) {
      console.warn('Merchant Globe trade-control log restore failed:', error);
    }
  }

  function trackTradeControl(side, productId, quantity, control, surface = 'market') {
    const entry = TradeUX.createControlEntry({
      actionIndex: actionHistory.length + 1,
      day: game.day,
      cityId: game.cityId,
      side, productId, quantity, control, surface
    });
    entry.clickedAt = new Date().toISOString();
    tradeControls.push(entry);
    tradeControls = tradeControls.slice(-2000);
    storeTradeControls();
  }

  function refreshPlayReport() {
    try {
      playReport = ReportSystem.buildReport({
        seed: gameSeed,
        maxDay: game.maxDay,
        actions: actionHistory
      }, Game, SaveSystem);
    } catch (error) {
      console.error('Merchant Globe report generation failed:', error);
      playReport = null;
    }
  }

  function exportPlayLog() {
    if (!playReport) {
      showToast('플레이 기록을 생성하지 못했습니다.', true);
      return;
    }

    try {
      const payload = {
        exportVersion: 1,
        exportedAt: new Date().toISOString(),
        report: playReport,
        actions: actionHistory,
        intelViews,
        tradeControls: TradeUX.summarizeControls(actionHistory, tradeControls).entries,
        tradeControlSummary: (() => {
          const summary = TradeUX.summarizeControls(actionHistory, tradeControls);
          return { totalTrades: summary.totalTrades, trackedTrades: summary.trackedTrades,
            untrackedTrades: summary.untrackedTrades, counts: summary.counts };
        })()
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeSeed = String(gameSeed).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
      link.href = url;
      link.download = 'merchant-globe-' + safeSeed + '-day-' + game.day + '.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      showToast('플레이 기록을 JSON 파일로 내보냈습니다.');
    } catch (error) {
      showToast(error.message || '기록 내보내기에 실패했습니다.', true);
    }
  }

  function saveGame(showMessage = false) {
    try {
      const payload = SaveSystem.createSavePayload({
        seed: gameSeed,
        maxDay: game.maxDay,
        selectedIntelCity,
        actions: actionHistory
      });
      localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
      updateSaveStatus(true);
      if (showMessage) showToast(`Day ${game.day} 진행을 저장했습니다.`);
      return true;
    } catch (error) {
      updateSaveStatus(false);
      if (showMessage) showToast(error.message || '저장하지 못했습니다.', true);
      return false;
    }
  }

  function recordAction(action) {
    actionHistory.push(JSON.parse(JSON.stringify(action)));
    refreshPlayReport();
    saveGame(false);
    render();
  }

  function loadSavedGame() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) {
        updateSaveStatus(false);
        return false;
      }

      const restored = SaveSystem.restoreGame(JSON.parse(raw), Game);
      game = restored.game;
      gameSeed = restored.seed;
      actionHistory = restored.actions;
      selectedIntelCity = CITIES[restored.selectedIntelCity] ? restored.selectedIntelCity : 'busan';
      updateSaveStatus(true);
      return true;
    } catch (error) {
      console.warn('Merchant Globe save restore failed:', error);
      try { localStorage.removeItem(SAVE_KEY); } catch (_) { /* ignore storage cleanup errors */ }
      updateSaveStatus(false);
      showToast('저장 데이터가 손상되었거나 현재 버전과 맞지 않아 새 게임으로 시작합니다.', true);
      return false;
    }
  }

  function deleteSavedGame() {
    try {
      localStorage.removeItem(SAVE_KEY);
      localStorage.removeItem(INTEL_VIEW_KEY);
      localStorage.removeItem(TRADE_CONTROL_KEY);
      intelViews = [];
      tradeControls = [];
      updateSaveStatus(false);
      showToast('저장 데이터를 삭제했습니다. 다음 거래부터 다시 자동저장됩니다.');
    } catch (error) {
      showToast('저장 데이터를 삭제하지 못했습니다.', true);
    }
  }

  function safeAction(fn) {
    try {
      return fn();
    } catch (error) {
      showToast(error.message || '처리 중 오류가 발생했습니다.', true);
      return null;
    }
  }

  function executeTrade(productId, side, qty, control, surface = 'market') {
    if (!Number.isInteger(qty) || qty < 1) return null;
    const product = game.getProduct(productId);
    if (!product) return null;

    const result = safeAction(() => side === 'buy'
      ? game.buy(productId, qty)
      : game.sell(productId, qty));
    if (!result) return null;

    trackTradeControl(side, productId, qty, control, surface);
    recordAction({ type: side, productId, qty });

    if (side === 'buy') {
      showToast(product.name + ' ' + qty + '개 매입 ' + money(result.total) +
        ' · 매입 후 현금 ' + money(game.cash));
      el('newsTitle').textContent = product.name + ' 매입 완료';
      el('newsText').textContent = '거래량이 시장 재고와 다음 체결가격에 반영되었습니다.';
    } else {
      showToast(product.name + ' ' + qty + '개 판매 ' + money(result.revenue) +
        ' · 실현손익 ' + signedMoney(result.profit) + ' · 판매 후 현금 ' + money(game.cash));
      el('newsTitle').textContent = product.name + ' 판매 완료';
      el('newsText').textContent = '판매 물량이 현지 시장 재고에 반영되었습니다.';
    }
    return result;
  }

  function tradeQuantity() {
    const input = el('tradeQty');
    const qty = TradeUX.normalizeQuantity(input.value);
    input.value = String(qty);
    return qty;
  }

  function setTradeQuantity(qty) {
    const amount = TradeUX.normalizeQuantity(qty);
    selectedQuantityMode = [1, 5, 10].includes(amount) ? 'preset_' + amount : 'custom';
    el('tradeQty').value = String(amount);
    refreshTradeQuotes();
  }

  function renderRouteBudget() {
    const routes = Object.keys(CITIES)
      .filter((id) => id !== game.cityId)
      .map((id) => ({ cityId: id, route: game.routeInfo(game.cityId, id) }))
      .filter((row) => Boolean(row.route))
      .sort((a, b) => a.route.cost - b.route.cost || a.cityId.localeCompare(b.cityId));

    if (!routes.some((row) => row.cityId === plannedDestinationId)) {
      plannedDestinationId = routes.length ? routes[0].cityId : null;
    }
    const select = el('routeBudgetCity');
    select.replaceChildren();
    routes.forEach(({ cityId, route }) => {
      const option = document.createElement('option');
      option.value = cityId;
      option.textContent = CITIES[cityId].name + ' · ' + money(route.cost);
      select.appendChild(option);
    });
    select.disabled = !routes.length;
    if (plannedDestinationId) select.value = plannedDestinationId;

    const chosen = routes.find((row) => row.cityId === plannedDestinationId);
    const description = el('routeBudgetSummary');
    if (!chosen) {
      description.textContent = '현재 이동 가능한 항로가 없습니다.';
      return;
    }
    const remaining = game.cash - chosen.route.cost;
    description.textContent = '현재 현금 ' + money(game.cash) + ' · ' + CITIES[chosen.cityId].name +
      ' 운송비 ' + money(chosen.route.cost) + ' (' + chosen.route.days + '일) · ' +
      (remaining >= 0 ? '이동비 제외 매입 예산 ' + money(remaining) : '이동비 부족 ' + money(-remaining));
    description.classList.toggle('insufficient', remaining < 0);
  }

  function refreshTradeQuotes() {
    const qty = TradeUX.normalizeQuantity(el('tradeQty').value);
    const reserve = el('keepTravelCost').checked;
    [['qtyOneBtn', 1], ['qtyFiveBtn', 5], ['qtyTenBtn', 10]].forEach(([id, amount]) => {
      const button = el(id);
      const active = selectedQuantityMode === 'preset_' + amount && amount === qty;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('active', active);
    });

    el('marketBody').querySelectorAll('.market-product-card[data-product-id]').forEach((card) => {
      const productId = card.dataset.productId;
      const product = game.getProduct(productId);
      const plan = TradeUX.tradeBudget(game, productId, qty, plannedDestinationId);
      const maxQty = reserve ? plan.maxWithTransport : plan.maxWithoutTransport;
      const buy = card.querySelector('.buy-button');
      const maxBuy = card.querySelector('.buy-max-button');
      const sell = card.querySelector('.sell-button');
      const sellAll = card.querySelector('.sell-all-button');
      const buyPreview = card.querySelector('.buy-preview');
      const buyBalance = card.querySelector('.buy-balance');
      const buyTravel = card.querySelector('.buy-travel');
      const maxPreview = card.querySelector('.max-preview');
      const sellPreview = card.querySelector('.sell-preview');
      const sellBalance = card.querySelector('.sell-balance');
      const sellAllPreview = card.querySelector('.sell-all-preview');

      buy.disabled = !plan.buy.allowed;
      sell.disabled = !plan.sell.allowed;
      maxBuy.disabled = maxQty <= 0;
      sellAll.disabled = plan.sell.maxQuantity <= 0;

      buy.textContent = '매입 ' + qty + '개';
      sell.textContent = '판매 ' + qty + '개';
      maxBuy.textContent = (reserve ? '이동비 확보 최대 ' : '최대 매입 ') + maxQty + '개';
      sellAll.textContent = '전량 판매 ' + plan.sell.maxQuantity + '개';
      maxBuy.setAttribute('aria-label', product.name + ' ' + (reserve ? '이동비 확보 최대 ' : '최대 ') + maxQty + '개 매입');
      sellAll.setAttribute('aria-label', product.name + ' 전량 ' + plan.sell.maxQuantity + '개 판매');

      function setTravelLabel(element, afterTravel) {
        if (afterTravel == null) {
          element.textContent = '';
          element.className = 'trade-preview-line';
          return;
        }
        element.textContent = afterTravel >= 0
          ? CITIES[plannedDestinationId].name + ' 이동 후 ' + money(afterTravel)
          : CITIES[plannedDestinationId].name + ' 운송비 부족 ' + money(-afterTravel);
        element.className = 'trade-preview-line ' + (afterTravel >= 0 ? 'positive' : 'negative');
      }

      if (plan.buy.allowed) {
        buyPreview.textContent = '매입 예상 ' + money(plan.buy.total) +
          ' · 평균 ' + money(plan.buy.unitPrice) + '/개';
        buyPreview.className = 'trade-preview-line buy-preview';
        buyBalance.textContent = '매입 후 현금 ' + money(plan.buy.cashAfter);
        setTravelLabel(buyTravel, plan.buy.cashAfterTransport);
      } else {
        buyPreview.textContent = '매입 불가 · ' + (plan.buy.reason || '수량 초과');
        buyPreview.className = 'trade-preview-line buy-preview unavailable';
        buyBalance.textContent = '';
        setTravelLabel(buyTravel, null);
      }

      if (maxQty > 0) {
        const maxQuote = TradeUX.quote(game, productId, maxQty).buy;
        const afterBuy = game.cash - maxQuote.total;
        const afterTravel = afterBuy - plan.route.cost;
        maxPreview.textContent = maxQty + '개 매입 ' + money(maxQuote.total) +
          ' → 현금 ' + money(afterBuy) +
          (afterTravel >= 0 ? ' → 이동 후 ' + money(afterTravel)
            : ' → 이동비 부족 ' + money(-afterTravel));
        maxPreview.className = 'trade-preview-line max-preview ' + (afterTravel >= 0 ? '' : 'negative');
        maxBuy.title = maxPreview.textContent;
      } else {
        maxPreview.textContent = reserve && plan.maxWithoutTransport > 0
          ? '이동비를 확보하면서 살 수 있는 수량이 없습니다. 목적지 또는 확보 옵션을 변경하세요.'
          : '매입 가능한 수량이 없습니다.';
        maxPreview.className = 'trade-preview-line max-preview unavailable';
        maxBuy.title = maxPreview.textContent;
      }

      if (plan.sell.allowed) {
        sellPreview.textContent = '판매 예상 ' + money(plan.sell.revenue) +
          ' · 실현손익 ' + signedMoney(plan.sell.profit);
        sellPreview.className = 'trade-preview-line sell-preview';
        sellBalance.textContent = '판매 후 현금 ' + money(plan.sell.cashAfter) +
          ' · ' + CITIES[plannedDestinationId].name + ' 이동 후 ' +
          (plan.sell.cashAfterTransport >= 0 ? money(plan.sell.cashAfterTransport)
            : '운송비 부족 ' + money(-plan.sell.cashAfterTransport));
        sellBalance.className = 'trade-preview-line sell-balance ' +
          (plan.sell.cashAfterTransport >= 0 ? '' : 'negative');
      } else {
        sellPreview.textContent = '판매 불가 · ' + (plan.sell.reason || '보유 수량 부족');
        sellPreview.className = 'trade-preview-line sell-preview unavailable';
        sellBalance.textContent = '';
      }

      if (plan.sell.maxQuantity > 0) {
        const allQuote = TradeUX.quote(game, productId, plan.sell.maxQuantity).sell;
        const after = game.cash + allQuote.revenue;
        const afterTravel = after - plan.route.cost;
        sellAllPreview.textContent = '전량 ' + plan.sell.maxQuantity + '개 판매 ' +
          money(allQuote.revenue) + ' → 현금 ' + money(after) +
          (afterTravel >= 0 ? ' → 이동 후 ' + money(afterTravel)
            : ' → 이동비 부족 ' + money(-afterTravel));
        sellAllPreview.className = 'trade-preview-line sell-all-preview ' + (afterTravel >= 0 ? '' : 'negative');
        sellAll.title = sellAllPreview.textContent;
      } else {
        sellAllPreview.textContent = '전량 판매할 재고가 없습니다.';
        sellAllPreview.className = 'trade-preview-line sell-all-preview unavailable';
        sellAll.title = '판매할 재고가 없습니다';
      }
    });
  }

  function stateClass(label) {
    if (['매우 부족', '부족', '매우 높음', '높음'].includes(label)) return 'market-hot';
    if (['과잉', '넉넉', '매우 낮음', '낮음'].includes(label)) return 'market-cool';
    return 'market-normal';
  }

  function renderHeader() {
    const city = CITIES[game.cityId];
    el('currentCity').textContent = city.name;
    el('cityCountry').textContent = city.country;
    el('day').textContent = `${game.day} / ${game.maxDay}`;
    el('cash').textContent = money(game.cash);
    el('assets').textContent = money(game.totalAssets());
  }

  function renderMarket() {
    const city = CITIES[game.cityId];
    el('marketCity').textContent = city.name;
    const profile = cityProfileText(city);
    el('marketSummary').textContent = city.summary +
      (profile ? ' · ' + profile : '') +
      ' · 재고와 수요는 실제 생산·소비 성향에 따라 회복됩니다.';

    renderRouteBudget();
    const body = el('marketBody');
    body.replaceChildren();

    PRODUCTS.forEach((product) => {
      const info = game.marketInfo(game.cityId, product.id);
      const baseline = product.basePrice * city.modifiers[product.id];
      const deviation = ((info.price / baseline) - 1) * 100;
      const item = game.inventory[product.id];
      const heldUnitValue = info.price * game.freshnessMultiplier(product.id);
      const heldProfitRate = item.qty > 0 ? ((heldUnitValue / item.avgCost) - 1) * 100 : null;
      const stockPct = Math.round(info.stockRatio * 100);
      const demandPct = Math.round(info.demandRatio * 100);
      const heldClass = heldProfitRate == null ? 'neutral' : heldProfitRate > 0 ? 'positive' : heldProfitRate < 0 ? 'negative' : 'neutral';
      const deviationClass = deviation > 1 ? 'positive' : deviation < -1 ? 'negative' : 'neutral';

      const card = document.createElement('article');
      card.className = 'market-product-card';
      card.dataset.productId = product.id;
      card.setAttribute('aria-label', product.name + ' 시세와 거래');
      card.innerHTML = `
        <div class="market-product-header">
          <div class="market-product-identity">
            <div><strong class="product-name">${product.name}</strong><span class="trait-chip trait-${product.trait}">${product.traitLabel}</span></div>
            <span class="price-note">기본가 ${money(product.basePrice)} · 화물 ${product.cargoSize || 1}칸${product.trait === 'perishable' ? ' · 운송 시 신선도 하락' : ''}</span>
          </div>
          <div class="market-product-price">
            <span>현재 시세</span>
            <strong>${money(info.price)}</strong>
            <span class="${deviationClass}">도시 기준가 대비 ${pct(deviation)}</span>
          </div>
        </div>

        <div class="market-product-metrics">
          <div class="market-metric"><span>시장 재고</span><strong>${info.stock}개 · ${info.stockLabel}</strong><small>평시 ${info.targetStock}개 (${stockPct}%)</small></div>
          <div class="market-metric"><span>수요</span><strong>${info.demandLabel}</strong><small>평시 대비 ${demandPct}%</small></div>
          <div class="market-metric"><span>보유 수량</span><strong>${item.qty}개</strong></div>
          <div class="market-metric"><span>평균 매입가</span><strong>${item.qty ? money(item.avgCost) : '—'}</strong></div>
          <div class="market-metric"><span>보유 손익 (시세 기준)</span><strong class="${heldClass}">${heldProfitRate == null ? '—' : pct(heldProfitRate)}</strong></div>
        </div>

        <div class="market-product-trades">
          <div class="market-trade-side">
            <div class="trade-action-side">
              <button class="buy-button" type="button">매입</button>
              <button class="buy-max-button" type="button">최대 매입</button>
            </div>
            <div class="trade-preview">
              <span class="trade-preview-line buy-preview"></span>
              <span class="trade-preview-line buy-balance"></span>
              <span class="trade-preview-line buy-travel"></span>
              <span class="trade-preview-line max-preview"></span>
            </div>
          </div>
          <div class="market-trade-side">
            <div class="trade-action-side">
              <button class="sell-button" type="button">판매</button>
              <button class="sell-all-button" type="button">전량 판매</button>
            </div>
            <div class="trade-preview">
              <span class="trade-preview-line sell-preview"></span>
              <span class="trade-preview-line sell-balance"></span>
              <span class="trade-preview-line sell-all-preview"></span>
            </div>
          </div>
        </div>`;

      card.querySelector('.buy-button').addEventListener('click', () =>
        executeTrade(product.id, 'buy', tradeQuantity(), selectedQuantityMode));
      card.querySelector('.sell-button').addEventListener('click', () =>
        executeTrade(product.id, 'sell', tradeQuantity(), selectedQuantityMode));
      card.querySelector('.buy-max-button').addEventListener('click', () => {
        const budget = TradeUX.tradeBudget(game, product.id, 1, plannedDestinationId);
        const reserve = el('keepTravelCost').checked;
        const qty = reserve ? budget.maxWithTransport : budget.maxWithoutTransport;
        executeTrade(product.id, 'buy', qty, reserve ? 'reserve_max_buy' : 'max_buy');
      });
      card.querySelector('.sell-all-button').addEventListener('click', () => {
        const qty = TradeUX.quote(game, product.id, 1).sell.maxQuantity;
        executeTrade(product.id, 'sell', qty, 'sell_all');
      });
      body.appendChild(card);
    });
    refreshTradeQuotes();
  }

  function renderCargo() {
    const used = game.cargoUsed();
    el('cargoCount').textContent = used + ' / ' + game.capacity;
    el('cargoBar').style.width = Math.min(100, (used / game.capacity) * 100) + '%';
    el('upgradeCost').textContent = money(game.cargoUpgradeCost());
    el('upgradeCargoBtn').disabled = game.gameOver;

    const list = el('inventoryList');
    list.replaceChildren();
    const items = PRODUCTS.filter((p) => game.inventory[p.id].qty > 0);
    if (!items.length) {
      list.innerHTML = '<div class="empty-state">아직 보유한 상품이 없습니다.</div>';
      return;
    }

    items.forEach((product) => {
      const item = game.inventory[product.id];
      const freshness = game.freshnessMultiplier(product.id);
      const current = game.price(game.cityId, product.id) * freshness;
      const rate = ((current / item.avgCost) - 1) * 100;
      const slots = item.qty * (product.cargoSize || 1);
      const freshnessText = product.trait === 'perishable'
        ? ' · 신선도 ' + Math.round(freshness * 100) + '%' : '';

      const card = document.createElement('article');
      card.className = 'cargo-item';
      card.dataset.productId = product.id;
      card.innerHTML = `
        <div class="cargo-item-heading">
          <div>
            <strong class="cargo-product-name">${product.name} × ${item.qty}</strong>
            <small>화물 ${slots}칸${freshnessText}</small>
            <small>평균 매입가 ${money(item.avgCost)} · 시세 대비 <span class="${rate >= 0 ? 'positive' : 'negative'}">${pct(rate)}</span></small>
          </div>
        </div>
        <div class="cargo-sale-form">
          <label class="cargo-qty-label">판매 수량
            <input class="cargo-sale-qty" type="number" min="1" max="${item.qty}" step="1" value="1" inputmode="numeric" />
          </label>
          <div class="cargo-sale-buttons">
            <button class="cargo-sell-selected sell-button" type="button">선택 1개 판매</button>
            <button class="cargo-sell-all secondary-button" type="button">전량 ${item.qty}개 판매</button>
          </div>
        </div>
        <div class="cargo-sale-quotes" aria-live="off">
          <div class="cargo-sale-selected-quote"></div>
          <div class="cargo-sale-all-quote"></div>
        </div>`;

      const input = card.querySelector('.cargo-sale-qty');
      const selectedButton = card.querySelector('.cargo-sell-selected');
      const allButton = card.querySelector('.cargo-sell-all');
      const selectedText = card.querySelector('.cargo-sale-selected-quote');
      const allText = card.querySelector('.cargo-sale-all-quote');
      const route = plannedDestinationId && game.routeInfo(game.cityId, plannedDestinationId);
      const routeCost = route ? route.cost : 0;
      const routeName = route ? CITIES[plannedDestinationId].name : null;
      const routeHint = (cashAfter) => routeName
        ? routeName + ' 이동 후 ' +
          (cashAfter >= routeCost ? money(cashAfter - routeCost) : '운송비 부족 ' + money(routeCost - cashAfter))
        : '이동 예정 항로 없음';

      function renderCargoSellPreview() {
        const requested = TradeUX.normalizeQuantity(input.value);
        const selected = TradeUX.quote(game, product.id, requested).sell;
        const all = TradeUX.quote(game, product.id, item.qty).sell;
        selectedButton.disabled = !selected.allowed;
        allButton.disabled = !all.allowed;
        selectedButton.textContent = '선택 ' + requested + '개 판매';

        if (selected.allowed) {
          const after = game.cash + selected.revenue;
          selectedText.textContent = '선택 판매 예상 ' + money(selected.revenue) +
            ' · 실현손익 ' + signedMoney(selected.profit) +
            ' · 판매 후 현금 ' + money(after) + ' · ' + routeHint(after);
          selectedText.className = 'cargo-sale-selected-quote';
        } else {
          selectedText.textContent = '선택 판매 불가 · 보유량 ' + item.qty + '개 이내로 입력하세요.';
          selectedText.className = 'cargo-sale-selected-quote unavailable';
        }

        if (all.allowed) {
          const after = game.cash + all.revenue;
          allText.textContent = '전량 판매 예상 ' + money(all.revenue) +
            ' · 실현손익 ' + signedMoney(all.profit) +
            ' · 판매 후 현금 ' + money(after) + ' · ' + routeHint(after);
        } else {
          allText.textContent = '전량 판매할 상품이 없습니다.';
        }
      }

      input.addEventListener('input', renderCargoSellPreview);
      input.addEventListener('change', () => {
        input.value = String(Math.min(item.qty, TradeUX.normalizeQuantity(input.value)));
        renderCargoSellPreview();
      });
      selectedButton.addEventListener('click', () => {
        const qty = TradeUX.normalizeQuantity(input.value);
        if (qty > item.qty) return;
        executeTrade(product.id, 'sell', qty, 'custom', 'cargo');
      });
      allButton.addEventListener('click', () => {
        executeTrade(product.id, 'sell', game.inventory[product.id].qty, 'sell_all', 'cargo');
      });
      renderCargoSellPreview();
      list.appendChild(card);
    });
  }

  function renderRoutes() {
    const list = el('routeList');
    list.innerHTML = '';
    Object.keys(CITIES).filter((id) => id !== game.cityId).forEach((dest) => {
      const route = game.routeInfo(game.cityId, dest);
      const city = CITIES[dest];
      const button = document.createElement('button');
      button.className = 'route-button';
      button.type = 'button';
      button.disabled = game.gameOver;
      const notice = route.events[0];
      const changed = route.cost !== route.baseCost || route.days !== route.baseDays;
      const routeStatus = notice
        ? `${notice.kind === 'congestion' ? '⚠ 혼잡' : '↗ 순풍'} · ${route.days}일`
        : `${route.days}일 · 정상`;
      button.innerHTML = `<strong>${city.name}</strong><span class="route-cost ${changed ? 'route-changed' : ''}">${money(route.cost)}</span><span>${routeStatus} · ${city.country}</span>${notice ? `<small>${notice.description}</small>` : ''}`;
      button.addEventListener('click', () => {
        const result = safeAction(() => game.travel(dest));
        if (result) {
          selectedIntelCity = result.from;
          recordAction({ type: 'travel', destinationId: dest });
          showToast(`${city.name} 도착 · ${result.days}일 경과 · 운송비 ${money(result.cost)}`);
          updateNews(result.event);
        }
      });
      list.appendChild(button);
    });
  }

  function renderIntel() {
    const level = game.intelLevelInfo();
    const nextLevel = INTEL_LEVELS[game.intelLevel + 1];
    const cost = game.intelUpgradeCost();
    el('intelLevelText').textContent = `${level.name} Lv.${game.intelLevel}`;
    el('intelLevelDetail').textContent = game.intelLevel === 0
      ? '방문한 도시의 마지막 시세만 기록'
      : `원격 도시 핵심 상품 ${level.coverage}개 · ${level.refreshDays}일마다 갱신`;
    el('upgradeIntelBtn').textContent = nextLevel ? `확장 ${money(cost)}` : '최고 단계';
    el('upgradeIntelBtn').disabled = !nextLevel || game.gameOver;

    const tabs = el('intelCityTabs');
    tabs.innerHTML = '';
    Object.values(CITIES).forEach((city) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `intel-city-button${city.id === selectedIntelCity ? ' active' : ''}${city.id === game.cityId ? ' current' : ''}`;
      button.innerHTML = `<strong>${city.name}</strong><span>${city.id === game.cityId ? '현재 · 실시간' : '원격'}</span>`;
      button.addEventListener('click', () => {
        selectedIntelCity = city.id;
        trackIntelView(city.id);
        renderIntel();
        saveGame(false);
      });
      tabs.appendChild(button);
    });

    const intel = game.remoteIntel(selectedIntelCity);
    const city = CITIES[selectedIntelCity];
    el('intelSummary').textContent = intel.live
      ? `${city.name}은 현재 머무는 도시이므로 모든 시장 정보가 실시간입니다.`
      : `${city.name} 원격 정보입니다. 오래된 보고는 도착할 때 실제 시세와 달라질 수 있습니다.`;

    const empty = el('intelEmpty');
    const tableWrap = el('intelTableWrap');
    if (!intel.entries.length) {
      empty.hidden = false;
      tableWrap.hidden = true;
      empty.innerHTML = `<strong>${city.name} 시세 정보가 없습니다.</strong><span>직접 방문하면 전체 시세가 기록됩니다. 정보망을 확장하면 원격 핵심 상품 보고서를 받을 수 있습니다.</span>`;
      return;
    }
    empty.hidden = true;
    tableWrap.hidden = false;

    el('intelBody').innerHTML = intel.entries.map((entry) => {
      const product = PRODUCTS.find((p) => p.id === entry.productId);
      const trend = entry.trend === 'up' ? '↑ 상승' : entry.trend === 'down' ? '↓ 하락' : '→ 유지';
      const trendClass = entry.trend === 'up' ? 'positive' : entry.trend === 'down' ? 'negative' : 'neutral';
      const timing = intel.live ? '실시간' : entry.age === 0 ? `Day ${entry.capturedDay} · 오늘` : `Day ${entry.capturedDay} · ${entry.age}일 전`;
      return `<tr><td><span class="product-name">${product.name}</span></td><td class="number"><strong>${money(entry.price)}</strong></td><td><span class="market-chip ${stateClass(entry.stockLabel)}">${entry.stockLabel}</span></td><td><span class="market-chip ${stateClass(entry.demandLabel)}">${entry.demandLabel}</span></td><td class="${trendClass}">${trend}</td><td class="number"><span class="intel-age${entry.age >= 3 ? ' stale' : ''}">${timing}</span></td></tr>`;
    }).join('');
  }

  function renderEvents() {
    const list = el('eventList');
    const active = [...game.marketRumors(), ...game.routeNotices()].sort((a, b) => b.createdDay - a.createdDay);
    if (!active.length) {
      list.innerHTML = '<div class="empty-state">현재 특별한 시장 사건이 없습니다.</div>';
      return;
    }
    list.innerHTML = active.slice(0, 6).map((event) => {
      let effect = '정보 불확실';
      let cls = 'neutral';
      if (event.type === 'route') {
        effect = event.kind === 'congestion' ? '운송비 +25% · +1일' : '운송비 -12% · 시간 단축';
        cls = event.kind === 'congestion' ? 'negative' : 'positive';
      } else if (event.impact != null && event.kind === 'demand') {
        effect = `수요 +${event.impact}%`;
        cls = 'positive';
      } else if (event.impact != null && event.kind === 'shortage') {
        effect = `재고 ${event.impact}개`;
        cls = 'negative';
      } else if (event.impact != null) {
        effect = `재고 +${event.impact}개`;
        cls = 'market-cool-text';
      }
      const until = event.expiresDay == null ? '' : ` · ${event.expiresDay}일차까지`;
      return `<div class="event-row"><strong>${event.title} <span class="${cls}">${effect}</span></strong><span>${event.description}${until}</span></div>`;
    }).join('');
  }

  function describePlayEntry(entry) {
    if (entry.type === 'event') return '시장 소식 · ' + entry.title;
    if (entry.type === 'buy') {
      return CITIES[entry.cityId].name + ' · ' + productNames([entry.productId]) + ' ' + entry.quantity + '개 매입 ' + money(entry.total);
    }
    if (entry.type === 'sell') {
      return CITIES[entry.cityId].name + ' · ' + productNames([entry.productId]) + ' ' + entry.quantity + '개 판매 · 손익 ' + signedMoney(entry.profit);
    }
    if (entry.type === 'travel') {
      return CITIES[entry.from].name + ' → ' + CITIES[entry.to].name + ' · ' + entry.days + '일 / ' + money(entry.cost);
    }
    if (entry.type === 'upgradeCargo') return '화물칸 확장 · ' + money(entry.cost);
    if (entry.type === 'upgradeIntel') return '정보망 확장 · ' + money(entry.cost);
    return '행동 기록';
  }

  function renderLog() {
    const list = el('tradeLog');
    list.replaceChildren();

    const entries = playReport ? playReport.timeline.slice(-10).reverse() : [];
    if (!entries.length) {
      list.innerHTML = '<div class="empty-state">아직 기록된 행동이 없습니다. 첫 거래를 시작해 보세요.</div>';
      return;
    }
    entries.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'log-row';
      const label = document.createElement('b');
      label.textContent = 'Day ' + entry.day;
      row.append(label, document.createTextNode(describePlayEntry(entry)));
      list.appendChild(row);
    });
  }

  function updateNews(event) {
    if (event) {
      const visible = event.type === 'route' ? event : (game.marketRumors().find((row) => row.id === event.id) || event);
      el('newsTitle').textContent = visible.title;
      el('newsText').textContent = visible.description;
      return;
    }
    const city = CITIES[game.cityId];
    el('newsTitle').textContent = `${city.name} 시장 도착`;
    el('newsText').textContent = `${city.summary}. 재고와 수요를 함께 보고 다음 거래를 결정하세요.`;
  }

  function renderAssetHistory() {
    const svg = el('assetHistoryChart');
    svg.replaceChildren();
    if (!playReport || !playReport.dailyAssets.length) return;

    const svgNs = 'http://www.w3.org/2000/svg';
    const values = playReport.dailyAssets;
    const minValue = Math.min(0, ...values.map((row) => row.assets));
    const maxValue = Math.max(1, ...values.map((row) => row.assets));
    const left = 70;
    const top = 14;
    const width = 624;
    const height = 163;
    const maxDay = Math.max(2, playReport.maxDay);
    const x = (day) => left + ((day - 1) / (maxDay - 1)) * width;
    const y = (assets) => top + height * (1 - (assets - minValue) / (maxValue - minValue));

    function element(tag, attributes, content) {
      const node = document.createElementNS(svgNs, tag);
      Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
      if (content != null) node.textContent = String(content);
      svg.appendChild(node);
      return node;
    }

    [0, 0.5, 1].forEach((ratio) => {
      const value = minValue + (maxValue - minValue) * ratio;
      const lineY = y(value);
      element('line', { x1: left, y1: lineY, x2: left + width, y2: lineY, stroke: '#30445e', 'stroke-width': 1 });
      element('text', { x: left - 8, y: lineY + 4, fill: '#91a4bf', 'font-size': 11, 'text-anchor': 'end' }, money(value));
    });

    element('text', { x: left, y: 203, fill: '#91a4bf', 'font-size': 12 }, 'Day 1');
    element('text', { x: left + width, y: 203, fill: '#91a4bf', 'font-size': 12, 'text-anchor': 'end' }, 'Day ' + playReport.maxDay);

    const points = values.map((row) => x(row.day) + ',' + y(row.assets)).join(' ');
    element('polyline', {
      points,
      fill: 'none',
      stroke: '#42d6b2',
      'stroke-width': 3,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round'
    });
    values.forEach((row) => {
      const circle = element('circle', { cx: x(row.day), cy: y(row.assets), r: 3.5, fill: '#42d6b2' });
      const title = document.createElementNS(svgNs, 'title');
      title.textContent = 'Day ' + row.day + ' · 자산 ' + money(row.assets) + ' · 현금 ' + money(row.cash);
      circle.appendChild(title);
    });
    svg.setAttribute('aria-label', '자산 변화: ' + values.map((row) => 'Day ' + row.day + ' ' + money(row.assets)).join(', '));
  }

  function renderGameOver() {
    const panel = el('gameOverPanel');
    panel.hidden = !game.gameOver;
    if (!game.gameOver) return;

    const report = playReport;
    if (!report) {
      el('gameOverSummary').textContent = '결과 리포트를 생성하지 못했습니다. 저장된 플레이 기록을 확인해 주세요.';
      return;
    }

    const stats = report.stats;
    const controls = TradeUX.summarizeControls(actionHistory, tradeControls);
    const costs = report.investmentCosts;
    el('gameOverSummary').textContent =
      '30일 동안 ' + stats.trips + '번 이동하고 ' + (stats.buys + stats.sells) + '번 거래했습니다. 방문한 도시는 ' +
      Object.keys(report.cityVisits).length + '곳입니다.';

    el('resultStats').innerHTML =
      '<div><span>시작 자산</span><strong>' + money(report.startingAssets) + '</strong></div>' +
      '<div><span>최종 자산</span><strong>' + money(report.finalAssets) + '</strong></div>' +
      '<div><span>자산 증감</span><strong class="' + (report.netAssetsChange >= 0 ? 'positive' : 'negative') + '">' + signedMoney(report.netAssetsChange) + '</strong></div>' +
      '<div><span>판매 실현손익</span><strong class="' + (stats.realizedProfit >= 0 ? 'positive' : 'negative') + '">' + signedMoney(stats.realizedProfit) + '</strong></div>' +
      '<div><span>총 운송비</span><strong>' + money(stats.transportCost) + '</strong></div>' +
      '<div><span>운송비 차감 실현손익</span><strong class="' + (report.realizedAfterTransport >= 0 ? 'positive' : 'negative') + '">' + signedMoney(report.realizedAfterTransport) + '</strong></div>' +
      '<div><span>화물칸 투자비</span><strong>' + money(costs.cargo) + '</strong></div>' +
      '<div><span>정보망 투자비</span><strong>' + money(costs.intel) + '</strong></div>' +
      '<div><span>투자비 차감 후 실현손익</span><strong class="' + (report.realizedAfterExpenses >= 0 ? 'positive' : 'negative') + '">' + signedMoney(report.realizedAfterExpenses) + '</strong></div>' +
      '<div><span>매입·판매 물량</span><strong>' + (stats.unitsBought + stats.unitsSold) + '개</strong></div>' +
      '<div><span>도시 방문</span><strong>' + Object.keys(report.cityVisits).length + '곳</strong></div>' +
      '<div><span>업그레이드</span><strong>화물 ' + report.upgrades.cargo + ' · 정보 ' + report.upgrades.intel + '</strong></div>' +
      '<div><span>원격 시장 조회</span><strong>' + intelViews.filter((row) => row.targetCityId !== row.fromCityId).length + '회</strong></div>' +
      '<div><span>거래 버튼 기록</span><strong>' + controls.trackedTrades + ' / ' + controls.totalTrades +
        '회 (기존 기록 ' + controls.untrackedTrades + '회)</strong></div>' +
      '<div><span>빠른 수량 선택</span><strong>1개 ' + controls.counts.preset_1 +
        ' · 5개 ' + controls.counts.preset_5 + ' · 10개 ' + controls.counts.preset_10 + '회</strong></div>' +
      '<div><span>기타 거래 입력</span><strong>직접 ' + controls.counts.custom + ' · 최대 매입 ' +
        controls.counts.max_buy + ' · 전량 판매 ' + controls.counts.sell_all + '회</strong></div>';

    const best = report.bestSale;
    const worst = report.worstSale;
    const topProduct = report.leadingProduct && report.leadingProduct.realizedProfit > 0
      ? productNames([report.leadingProduct.productId]) + ' ' + signedMoney(report.leadingProduct.realizedProfit)
      : '이익을 낸 상품 없음';
    const topRoute = report.busiestRoute
      ? report.busiestRoute.route.split('<->').map((id) => CITIES[id].name).join(' ↔ ') + ' ' + report.busiestRoute.count + '회'
      : '이동 없음';

    function saleDescription(sale) {
      if (!sale) return '판매 기록 없음';
      return CITIES[sale.cityId].name + ' · ' + productNames([sale.productId]) +
        ' ' + sale.quantity + '개 / ' + signedMoney(sale.profit);
    }

    el('resultHighlights').replaceChildren();
    [
      ['최고 수익 상품', topProduct],
      ['가장 많이 이용한 항로', topRoute],
      ['최고 판매 손익', saleDescription(best)],
      ['최악 판매 손익', saleDescription(worst)]
    ].forEach(([name, value]) => {
      const item = document.createElement('div');
      const heading = document.createElement('span');
      heading.textContent = name;
      const detail = document.createElement('strong');
      detail.textContent = value;
      item.append(heading, detail);
      el('resultHighlights').appendChild(item);
    });

    const products = Object.entries(report.productTotals)
      .filter(([, totals]) => totals.sold > 0)
      .sort((a, b) => b[1].realizedProfit - a[1].realizedProfit);
    el('resultProducts').innerHTML = products.length
      ? '<table class="report-table"><thead><tr><th>상품</th><th class="number">판매량</th><th class="number">실현손익</th></tr></thead><tbody>' +
        products.map(([id, item]) => '<tr><td>' + productNames([id]) + '</td><td class="number">' + item.sold + '개</td><td class="number ' +
          (item.realizedProfit >= 0 ? 'positive' : 'negative') + '">' + signedMoney(item.realizedProfit) + '</td></tr>').join('') +
        '</tbody></table>'
      : '<p class="muted">판매한 상품이 없습니다.</p>';

    const routes = Object.entries(report.routePairCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    el('resultRoutes').innerHTML = routes.length
      ? '<table class="report-table"><thead><tr><th>항로</th><th class="number">이동</th></tr></thead><tbody>' +
        routes.map(([route, count]) => '<tr><td>' +
          route.split('<->').map((id) => CITIES[id].name).join(' ↔ ') +
          '</td><td class="number">' + count + '회</td></tr>').join('') +
        '</tbody></table>'
      : '<p class="muted">이동한 항로가 없습니다.</p>';

    renderAssetHistory();
  }

  function render() {
    renderHeader();
    renderMarket();
    renderCargo();
    renderRoutes();
    renderIntel();
    renderEvents();
    renderLog();
    renderGameOver();
  }

  function newGame(skipConfirm = false) {
    let hasSave = false;
    try { hasSave = Boolean(localStorage.getItem(SAVE_KEY)); } catch (_) { /* ignore */ }
    if (!skipConfirm && hasSave && !window.confirm('현재 저장을 덮어쓰고 새 게임을 시작할까요?')) return;

    gameSeed = Date.now();
    actionHistory = [];
    game = new Game({ maxDay: 30, seed: gameSeed });
    selectedIntelCity = 'busan';
    intelViews = [];
    tradeControls = [];
    selectedQuantityMode = 'preset_1';
    setTradeQuantity(1);
    storeIntelViews();
    storeTradeControls();
    refreshPlayReport();
    el('newsTitle').textContent = '시장 정보';
    el('newsText').textContent = '도시 생산·소비, 상품 특성, 항로 상태를 함께 보세요. 같은 가격 차이도 상황에 따라 수익성이 달라집니다.';
    saveGame(false);
    render();
    showToast('새로운 30일 무역을 시작했습니다.');
  }

  el('tradeQty').addEventListener('input', () => {
    selectedQuantityMode = 'custom';
    refreshTradeQuotes();
  });
  el('routeBudgetCity').addEventListener('change', (event) => {
    plannedDestinationId = event.target.value;
    renderRouteBudget();
    refreshTradeQuotes();
  });
  el('keepTravelCost').addEventListener('change', refreshTradeQuotes);
  el('tradeQty').addEventListener('change', () => {
    tradeQuantity();
    refreshTradeQuotes();
  });
  el('qtyOneBtn').addEventListener('click', () => setTradeQuantity(1));
  el('qtyFiveBtn').addEventListener('click', () => setTradeQuantity(5));
  el('qtyTenBtn').addEventListener('click', () => setTradeQuantity(10));
  el('upgradeCargoBtn').addEventListener('click', () => {
    const result = safeAction(() => game.upgradeCargo());
    if (result) {
      recordAction({ type: 'upgradeCargo' });
      showToast(`화물칸이 ${result.capacity}칸으로 늘었습니다.`);
    }
  });
  el('upgradeIntelBtn').addEventListener('click', () => {
    const result = safeAction(() => game.upgradeIntel());
    if (result) {
      recordAction({ type: 'upgradeIntel' });
      showToast(`정보망이 ${result.info.name} Lv.${result.level}로 확장되었습니다.`);
    }
  });
  el('saveGameBtn').addEventListener('click', () => saveGame(true));
  el('exportPlayLogBtn').addEventListener('click', exportPlayLog);
  el('exportResultBtn').addEventListener('click', exportPlayLog);
  el('deleteSaveBtn').addEventListener('click', deleteSavedGame);
  el('newGameBtn').addEventListener('click', () => newGame(false));
  el('restartBtn').addEventListener('click', () => newGame(true));

  const restored = loadSavedGame();
  if (!restored) saveGame(false);
  restoreIntelViews();
  restoreTradeControls();
  refreshPlayReport();
  render();

  if (restored) {
    el('newsTitle').textContent = `${CITIES[game.cityId].name}에서 이어하기`;
    el('newsText').textContent = `Day ${game.day} 저장 상태를 복원했습니다. 시장·이벤트·난수 흐름도 저장 시점과 동일하게 이어집니다.`;
    showToast(`저장된 Day ${game.day} 게임을 불러왔습니다.`);
  }
})();

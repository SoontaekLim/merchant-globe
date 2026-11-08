(function () {
  'use strict';

  const { Game, CITIES, PRODUCTS, INTEL_LEVELS } = window.MerchantGlobeCore;
  const TradeUX = window.MerchantGlobeTradeUX;
  const Realtime = window.MerchantGlobeRealtime;
  const SAVE_KEY = 'merchant-globe.realtime.save.v1';
  const el = (id) => document.getElementById(id);
  const money = (value) => '₩' + Math.round(Number(value) || 0).toLocaleString('ko-KR');
  const signed = (value) => (value >= 0 ? '+' : '-') + money(Math.abs(value));
  const pct = (value) => (value >= 0 ? '+' : '') + Number(value).toFixed(1) + '%';
  const formatSeconds = (ms) => {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(seconds / 60) + '분 ' + String(seconds % 60).padStart(2, '0') + '초';
  };
  const escapeText = (input) => String(input).replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  let session = null;
  let selectedIntelCity = 'busan';
  let plannedCityId = null;
  let quantityMode = 'preset_5';
  let saveEnabled = true;
  let lastNotice = '';
  const cargoQty = Object.create(null);

  function notify(text, error = false) {
    const node = el('toast');
    node.textContent = text;
    node.className = 'toast show' + (error ? ' error' : '');
    // Toast is replaced or cleared during the next timed update.
    lastNotice = text;
  }

  function store(silent = true) {
    if (!saveEnabled || !session) return false;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(session.toSave()));
      el('saveStatus').textContent = '자동저장됨';
      if (!silent) notify('현재 실시간 진행 상태를 저장했습니다.');
      return true;
    } catch (error) {
      el('saveStatus').textContent = '저장 오류';
      if (!silent) notify('저장 실패: ' + error.message, true);
      return false;
    }
  }

  function buildNewSession(speed) {
    const now = Date.now();
    session = new Realtime.RealtimeSession({
      GameClass: Game, seed: now, startedAtMs: now, msPerDay: speed
    });
    selectedIntelCity = 'busan';
    plannedCityId = null;
    quantityMode = 'preset_5';
    el('tradeQty').value = '5';
    el('speedSelect').value = String(speed);
    Object.keys(cargoQty).forEach((key) => delete cargoQty[key]);
  }

  function restore() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      session = Realtime.restoreSave(JSON.parse(raw), Game, Date.now());
      el('speedSelect').value = String(session.msPerDay);
      return true;
    } catch (error) {
      saveEnabled = false;
      el('saveStatus').textContent = '복원 실패 · 저장 보존';
      notify('실시간 저장을 복구하지 못했습니다. 저장 데이터는 지우지 않았습니다. 새 게임을 선택하면 다시 시작합니다. (' + error.message + ')', true);
      return false;
    }
  }

  function renderClock() {
    if (!session) return;
    const game = session.game;
    el('speedSelect').value = String(session.msPerDay);
    el('day').textContent = 'Day ' + game.day + ' · 무제한';
    el('nextTick').textContent = '다음 시장 갱신 ' + formatSeconds(session.nextTickAtMs() - session.nowMs);
    const place = CITIES[game.cityId];
    const transit = session.transit;
    el('currentCity').textContent = transit ? place.name + ' → ' + CITIES[transit.to].name : place.name;
    el('cityDetail').textContent = transit ? '운송 중 · 현지 거래 불가' : place.country;
    el('cash').textContent = money(game.cash);
    el('assets').textContent = money(game.totalAssets());
    el('clockState').textContent = transit ? '운송 중 — 경제는 계속 진행됩니다' : '거래하지 않아도 경제는 흐릅니다';
    el('clockDescription').textContent = '현재 속도: 현실 ' + formatSeconds(session.msPerDay) +
      '마다 게임 1일 · 시장 가격·재고·이벤트 자동 변동';
    const panel = el('transitPanel');
    panel.hidden = !transit;
    if (transit) {
      el('transitTitle').textContent = CITIES[transit.from].name + ' → ' + CITIES[transit.to].name +
        ' · ' + transit.days + '일 / ' + money(transit.cost);
      el('transitCountdown').textContent = '도착까지 ' + formatSeconds(session.remainingMs());
      const duration = transit.arriveAtMs - transit.departedAtMs;
      const passed = session.nowMs - transit.departedAtMs;
      el('transitBar').style.width = Math.max(0, Math.min(100, passed / duration * 100)) + '%';
    }
    el('liveNotice').textContent = transit
      ? '운송 중에는 시장 거래·업그레이드가 잠깁니다. 귀환 전에도 시세는 변동합니다.'
      : '경제 갱신은 매매나 도시 이동 없이 계속 진행됩니다. 재접속 시 오프라인 시간도 반영됩니다.';
  }

  function act(type, data) {
    try {
      const result = session.perform(type, data, Date.now());
      store();
      render();
      if (type === 'buy') notify(PRODUCTS.find((p) => p.id === data.productId).name +
        ' ' + data.qty + '개 매입 ' + money(result.total) + ' · 현금 ' + money(session.game.cash));
      if (type === 'sell') notify(PRODUCTS.find((p) => p.id === data.productId).name +
        ' ' + data.qty + '개 판매 ' + money(result.revenue) +
        ' · 실현손익 ' + signed(result.profit) + ' · 현금 ' + money(session.game.cash));
      if (type === 'startTravel') notify(CITIES[result.to].name + ' 출발 · 도착까지 ' + formatSeconds(session.remainingMs()));
      if (type === 'upgradeCargo') notify('화물칸 ' + result.capacity + '칸으로 확장했습니다.');
      if (type === 'upgradeIntel') notify('정보망 Lv.' + result.level + '로 확장했습니다.');
      return result;
    } catch (error) {
      notify(error.message || '거래할 수 없습니다.', true);
      render();
      return null;
    }
  }

  function drawQtyPresets() {
    const requested = TradeUX.normalizeQuantity(el('tradeQty').value);
    document.querySelectorAll('.quantity-preset').forEach((button) => {
      const active = quantityMode === 'preset_' + button.dataset.qty && Number(button.dataset.qty) === requested;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    return requested;
  }

  function renderRouteBudget() {
    const game = session.game;
    const select = el('routeBudgetCity');
    const routes = Object.keys(CITIES).filter((id) => id !== game.cityId)
      .map((id) => ({ id, route: game.routeInfo(game.cityId, id) }))
      .filter((item) => item.route)
      .sort((a, b) => a.route.cost - b.route.cost);
    if (!routes.some((item) => item.id === plannedCityId)) plannedCityId = routes[0] ? routes[0].id : null;
    select.replaceChildren();
    for (const item of routes) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = CITIES[item.id].name + ' · ' + money(item.route.cost);
      select.appendChild(option);
    }
    if (plannedCityId) select.value = plannedCityId;
    select.disabled = Boolean(session.transit);
    const active = routes.find((item) => item.id === plannedCityId);
    if (!active) return;
    const budget = game.cash - active.route.cost;
    el('routeBudgetSummary').textContent = '현재 현금 ' + money(game.cash) +
      ' · 이동비 ' + money(active.route.cost) +
      ' → 이동비 제외 예산 ' + money(Math.max(0, budget)) +
      (budget < 0 ? ' (이동비 부족 ' + money(-budget) + ')' : '');
  }

  function renderMarket() {
    const game = session.game;
    el('marketCity').textContent = CITIES[game.cityId].name;
    el('marketSummary').textContent = CITIES[game.cityId].summary;
    renderRouteBudget();
    const body = el('marketList');
    body.replaceChildren();
    const requested = drawQtyPresets();
    if (session.transit) {
      body.innerHTML = '<p class="rt-disabled-note">운송 중에는 현재 도시 시장을 이용할 수 없습니다. 도착 후 새로운 시세로 거래하세요.</p>';
      return;
    }
    const keepCost = el('keepTravelCost').checked;
    PRODUCTS.forEach((product) => {
      const info = game.marketInfo(game.cityId, product.id);
      const item = game.inventory[product.id];
      const baseline = product.basePrice * CITIES[game.cityId].modifiers[product.id];
      const deviation = 100 * (info.price / baseline - 1);
      const rate = item.qty ? 100 * (info.price * game.freshnessMultiplier(product.id) / item.avgCost - 1) : null;
      const quote = TradeUX.quote(game, product.id, requested);
      const plan = TradeUX.tradeBudget(game, product.id, requested, plannedCityId);
      const max = keepCost ? plan.maxWithTransport : plan.maxWithoutTransport;
      const maxQuote = max ? TradeUX.quote(game, product.id, max).buy : null;
      const all = item.qty ? TradeUX.quote(game, product.id, item.qty).sell : null;
      const goBalance = (cash) => {
        const route = game.routeInfo(game.cityId, plannedCityId);
        const result = cash - route.cost;
        return result >= 0 ? CITIES[plannedCityId].name + ' 이동 후 ' + money(result)
          : '이동비 부족 ' + money(-result);
      };
      const card = document.createElement('article');
      card.className = 'rt-product-card';
      card.innerHTML =
        '<div class="rt-product-head"><div><strong>' + escapeText(product.name) + '</strong>' +
        '<small>화물 ' + (product.cargoSize || 1) + '칸 · ' + escapeText(product.traitLabel) + '</small></div>' +
        '<div class="rt-product-price"><strong>' + money(info.price) + '</strong><small class="' +
        (deviation >= 0 ? 'positive' : 'negative') + '">기준가 대비 ' + pct(deviation) + '</small></div></div>' +
        '<div class="rt-metrics"><span>재고 <strong>' + Math.floor(info.stock) + '</strong></span>' +
        '<span>수요 <strong>' + escapeText(info.demandLabel) + '</strong></span>' +
        '<span>보유 <strong>' + item.qty + '</strong></span>' +
        '<span>평균 매입 <strong>' + (item.qty ? money(item.avgCost) : '—') + '</strong></span>' +
        '<span>보유 손익 <strong class="' + (rate == null ? '' : rate >= 0 ? 'positive' : 'negative') +
        '">' + (rate == null ? '—' : pct(rate)) + '</strong></span></div>' +
        '<div class="rt-pair"><button class="rt-buy buy-button" type="button">매입 ' + requested + '개</button>' +
        '<button class="rt-max secondary-button" type="button">' +
        (keepCost ? '이동비 확보 ' : '최대 ') + max + '개</button></div>' +
        '<p class="rt-quote rt-buy-quote">' +
        (quote.buy.allowed ? '매입 ' + money(quote.buy.total) + ' → 현금 ' +
          money(plan.buy.cashAfter) + ' · ' + goBalance(plan.buy.cashAfter) :
          '매입 불가 · ' + escapeText(quote.buy.reason || '수량 부족')) +
        '</p><p class="rt-quote">' +
        (maxQuote ? '최대 ' + max + '개 ' + money(maxQuote.total) + ' → ' +
          goBalance(game.cash - maxQuote.total) : '최대 매입 불가') +
        '</p><div class="rt-pair"><button class="rt-sell sell-button" type="button">판매 ' + requested + '개</button>' +
        '<button class="rt-sell-all secondary-button" type="button">전량 ' + item.qty + '개</button></div>' +
        '<p class="rt-quote">' +
        (quote.sell.allowed ? '판매 ' + money(quote.sell.revenue) + ' · 실현손익 ' +
          signed(quote.sell.profit) + ' → 현금 ' + money(plan.sell.cashAfter) :
          '선택 판매 불가 · 보유량 ' + item.qty + '개') +
        '</p><p class="rt-quote">' +
        (all ? '전량 판매 후 ' + money(game.cash + all.revenue) +
          ' · ' + goBalance(game.cash + all.revenue) : '판매할 재고 없음') + '</p>';

      const buy = card.querySelector('.rt-buy');
      const buyMax = card.querySelector('.rt-max');
      const sell = card.querySelector('.rt-sell');
      const sellAll = card.querySelector('.rt-sell-all');
      buy.disabled = !quote.buy.allowed;
      buyMax.disabled = max === 0;
      sell.disabled = !quote.sell.allowed;
      sellAll.disabled = item.qty === 0;
      buy.addEventListener('click', () => act('buy', { productId: product.id, qty: requested, surface: 'market', control: quantityMode }));
      buyMax.addEventListener('click', () => act('buy', {
        productId: product.id, qty: max, surface: 'market', control: keepCost ? 'reserve_max_buy' : 'max_buy'
      }));
      sell.addEventListener('click', () => act('sell', { productId: product.id, qty: requested, surface: 'market', control: quantityMode }));
      sellAll.addEventListener('click', () => act('sell', { productId: product.id, qty: item.qty, surface: 'market', control: 'sell_all' }));
      body.appendChild(card);
    });
  }

  function renderCargo() {
    const game = session.game;
    const used = game.cargoUsed();
    el('cargoCount').textContent = used + ' / ' + game.capacity;
    el('cargoBar').style.width = Math.min(100, used * 100 / game.capacity) + '%';
    el('upgradeCost').textContent = money(game.cargoUpgradeCost());
    el('upgradeCargoBtn').disabled = Boolean(session.transit);
    const body = el('inventoryList');
    body.replaceChildren();
    const owned = PRODUCTS.filter((product) => game.inventory[product.id].qty > 0);
    if (!owned.length) {
      body.innerHTML = '<p class="empty-state">보유한 상품이 없습니다.</p>';
      return;
    }
    for (const product of owned) {
      const item = game.inventory[product.id];
      const card = document.createElement('div');
      card.className = 'cargo-item';
      const value = game.price(game.cityId, product.id) * game.freshnessMultiplier(product.id);
      const diff = 100 * (value / item.avgCost - 1);
      const startingQty = Math.min(item.qty, cargoQty[product.id] || 1);
      card.innerHTML =
        '<div class="cargo-item-heading"><div><strong>' + escapeText(product.name) + ' × ' + item.qty + '</strong>' +
        '<small>평균 ' + money(item.avgCost) + ' · 보유 손익 <span class="' + (diff >= 0 ? 'positive' : 'negative') + '">' +
        pct(diff) + '</span></small></div></div>' +
        '<div class="cargo-sale-form"><label class="cargo-qty-label">판매 수량 ' +
        '<input class="cargo-sale-qty" type="number" min="1" max="' + item.qty + '" step="1" value="' + startingQty + '" /></label>' +
        '<div class="cargo-sale-buttons"><button class="cargo-sell-selected sell-button" type="button">선택 판매</button>' +
        '<button class="cargo-sell-all secondary-button" type="button">전량 판매</button></div></div>' +
        '<p class="rt-quote rt-cargo-preview"></p>';
      const input = card.querySelector('input');
      const preview = card.querySelector('.rt-cargo-preview');
      const selected = card.querySelector('.cargo-sell-selected');
      const all = card.querySelector('.cargo-sell-all');
      function renderPreview() {
        const qty = TradeUX.normalizeQuantity(input.value);
        cargoQty[product.id] = qty;
        const selectedQuote = TradeUX.quote(game, product.id, qty).sell;
        const allQuote = TradeUX.quote(game, product.id, item.qty).sell;
        selected.disabled = Boolean(session.transit) || !selectedQuote.allowed;
        all.disabled = Boolean(session.transit);
        selected.textContent = '선택 ' + qty + '개';
        all.textContent = '전량 ' + item.qty + '개';
        preview.textContent = selectedQuote.allowed
          ? '선택 판매 ' + money(selectedQuote.revenue) + ' · 실현손익 ' + signed(selectedQuote.profit) +
            ' · 판매 후 ' + money(game.cash + selectedQuote.revenue) +
            ' / 전량 판매 후 ' + money(game.cash + allQuote.revenue)
          : '선택 수량 초과 · 전량 판매 후 ' + money(game.cash + allQuote.revenue);
        if (session.transit) preview.textContent = '운송 중 판매 불가 · 도착 후 시세로 계산합니다.';
      }
      input.addEventListener('input', renderPreview);
      input.addEventListener('change', () => {
        input.value = String(Math.min(item.qty, TradeUX.normalizeQuantity(input.value)));
        renderPreview();
      });
      selected.addEventListener('click', () => {
        const qty = TradeUX.normalizeQuantity(input.value);
        if (qty <= item.qty) act('sell', { productId: product.id, qty, surface: 'cargo', control: 'custom' });
      });
      all.addEventListener('click', () => act('sell', {
        productId: product.id, qty: game.inventory[product.id].qty, surface: 'cargo', control: 'sell_all'
      }));
      renderPreview();
      body.appendChild(card);
    }
  }

  function renderRoutes() {
    const game = session.game;
    const body = el('routeList');
    body.replaceChildren();
    Object.keys(CITIES).filter((id) => id !== game.cityId).forEach((cityId) => {
      const route = game.routeInfo(game.cityId, cityId);
      if (!route) return;
      const button = document.createElement('button');
      button.className = 'route-button';
      button.type = 'button';
      button.disabled = Boolean(session.transit) || game.cash < route.cost;
      button.innerHTML = '<strong>' + CITIES[cityId].name + '</strong>' +
        '<span class="route-cost">' + money(route.cost) + '</span>' +
        '<span>' + route.days + '일 · 도착까지 ' + formatSeconds(route.days * session.msPerDay) + '</span>';
      button.addEventListener('click', () => act('startTravel', { destinationId: cityId }));
      body.appendChild(button);
    });
  }

  function renderIntel() {
    const game = session.game;
    const level = game.intelLevelInfo();
    el('intelLevelText').textContent = level.name + ' Lv.' + game.intelLevel;
    const next = INTEL_LEVELS[game.intelLevel + 1];
    const button = el('upgradeIntelBtn');
    button.disabled = Boolean(session.transit) || !next || game.cash < game.intelUpgradeCost();
    button.textContent = next ? '확장 ' + money(game.intelUpgradeCost()) : '최고 단계';
    const dropdown = el('intelCity');
    dropdown.replaceChildren();
    Object.keys(CITIES).forEach((cityId) => {
      const option = document.createElement('option');
      option.value = cityId;
      option.textContent = CITIES[cityId].name;
      dropdown.appendChild(option);
    });
    if (!CITIES[selectedIntelCity]) selectedIntelCity = 'busan';
    dropdown.value = selectedIntelCity;
    const area = el('intelList');
    if (session.transit && selectedIntelCity === game.cityId) {
      area.textContent = '운송 중에는 출발 도시의 실시간 시세를 확인할 수 없습니다.';
      return;
    }
    const info = game.remoteIntel(selectedIntelCity);
    if (!info.entries.length) {
      area.textContent = '이 도시의 시세 정보가 없습니다. 방문하거나 정보망을 확장하세요.';
      return;
    }
    area.replaceChildren();
    const title = document.createElement('p');
    title.className = 'rt-intel-label';
    title.textContent = info.live ? '현재 도시 실시간 정보' : '방문 기록·정보망 시세 (과거 정보 포함)';
    area.appendChild(title);
    info.entries.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'rt-intel-row';
      const product = PRODUCTS.find((p) => p.id === row.productId);
      item.textContent = product.name + ' · ' + money(row.price) +
        (info.live ? ' · 지금' : ' · ' + row.age + '일 전') +
        ' · ' + (row.trend === 'up' ? '↗' : row.trend === 'down' ? '↘' : '→');
      area.appendChild(item);
    });
  }

  function renderPerformanceHistory() {
    const period = el('performancePeriod').value === 'week' ? 'week' : 'day';
    const rows = session.recentPerformance(period, period === 'day' ? 14 : 8);
    const container = el('performanceHistory');
    container.replaceChildren();
    rows.slice().reverse().forEach((item) => {
      const line = document.createElement('div');
      line.className = 'rt-history-row';
      const label = document.createElement('strong');
      label.className = 'rt-history-period';
      label.textContent = period === 'day'
        ? 'Day ' + item.index
        : item.index + '주차 · Day ' + item.startDay + '–' + item.endDay;
      const details = document.createElement('span');
      details.className = 'rt-history-detail';
      details.textContent = '판매손익 ' + signed(item.realizedProfit) +
        ' · 운송 ' + money(item.transportCost) +
        ' · 투자 ' + money(item.investmentCost) +
        ' · 매입/판매 ' + item.buys + '/' + item.sells + '회';
      const net = document.createElement('strong');
      net.className = 'rt-history-net ' + (item.netProfit >= 0 ? 'positive' : 'negative');
      net.textContent = signed(item.netProfit);
      line.append(label, details, net);
      container.appendChild(line);
    });
  }

  function renderEventsAndLog() {
    const game = session.game;
    const events = game.marketRumors();
    const routes = game.routeNotices();
    const body = el('eventList');
    body.replaceChildren();
    const notices = events.map((event) => ({
      title: event.title, detail: event.description
    })).concat(routes.map((event) => ({
      title: event.title, detail: event.description
    })));
    if (!notices.length) body.innerHTML = '<p class="empty-state">현재 알려진 시장 사건이 없습니다.</p>';
    notices.slice(-8).reverse().forEach((event) => {
      const element = document.createElement('div');
      element.className = 'event-row';
      element.innerHTML = '<strong>' + escapeText(event.title) + '</strong><span>' + escapeText(event.detail) + '</span>';
      body.appendChild(element);
    });

    const stats = game.stats;
    const totals = session.performanceTotals();
    el('performance').textContent = '매입 ' + stats.buys + '회 · 판매 ' + stats.sells +
      '회 · 이동 ' + stats.trips + '회 · 판매 실현손익 ' + signed(totals.realizedProfit) +
      ' · 운송비 ' + money(totals.transportCost) +
      ' · 성장 투자비 ' + money(totals.investmentCost) +
      ' · 비용 차감 후 실현손익 ' + signed(totals.netProfit) +
      ' · 압축된 옛 행동 ' + session.archivedActions + '건';
    renderPerformanceHistory();
    const log = el('tradeLog');
    log.replaceChildren();
    game.logs.slice(0, 10).forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'log-row';
      row.textContent = 'Day ' + entry.day + ' · ' + entry.text;
      log.appendChild(row);
    });
  }

  function render() {
    renderClock();
    renderMarket();
    renderCargo();
    renderRoutes();
    renderIntel();
    renderEventsAndLog();
  }

  function sync() {
    if (!session) return;
    try {
      const progress = session.advanceTo(Date.now());
      if (progress.ticks || progress.arrived) {
        store();
        render();
        if (progress.arrived) notify(CITIES[session.game.cityId].name + ' 도착! 이제 거래할 수 있습니다.');
      } else {
        renderClock();
      }
    } catch (error) {
      el('liveNotice').textContent = '오프라인 복구 오류: ' + error.message;
      el('saveStatus').textContent = '진행 일시 중단';
    }
  }

  function exportLog() {
    try {
      session.advanceTo(Date.now());
      const game = session.game;
      const save = session.toSave();
      // Telemetry export is intentionally not a restorable checkpoint:
      // copying the full state would leak private remote market prices.
      const payload = {
        exportVersion: 2, exportedAt: new Date().toISOString(),
        session: {
          seed: save.seed, startedAtMs: save.startedAtMs,
          observedAtMs: save.observedAtMs,
          msPerDay: save.msPerDay, activeMsPerDay: save.activeMsPerDay,
          archivedActionCount: save.archivedActionCount,
          lastCheckpointDay: save.checkpoint ? save.checkpoint.economy.day : null,
          recentActions: save.actions
        },
        summary: {
          economicDay: game.day, cityId: game.cityId,
          transit: session.transit, cash: game.cash,
          totalAssets: game.totalAssets(), cargoUsed: game.cargoUsed(),
          inventory: game.inventory, stats: game.stats,
          performance: session.performanceTotals()
        },
        recentDailyPerformance: session.recentPerformance('day', 14),
        recentWeeklyPerformance: session.recentPerformance('week', 8)
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'merchant-globe-realtime-' + String(session.seed).replace(/[^0-9a-zA-Z_-]/g, '_') + '.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      notify('실시간 플레이 기록 JSON을 내보냈습니다.');
    } catch (error) {
      notify('내보내기 오류: ' + error.message, true);
    }
  }

  el('performancePeriod').addEventListener('change', renderPerformanceHistory);
  el('speedSelect').addEventListener('change', () => {
    const nextSpeed = Number(el('speedSelect').value);
    try {
      const result = session.perform('setSpeed', { msPerDay: nextSpeed }, Date.now());
      store();
      render();
      notify('시간 속도가 ' + formatSeconds(result.msPerDay) +
        '/일로 변경됐습니다. 현재 게임과 운송 진행을 유지합니다.');
    } catch (error) {
      el('speedSelect').value = String(session.msPerDay);
      notify('시간 속도를 변경하지 못했습니다: ' + error.message, true);
    }
  });
  el('tradeQty').addEventListener('input', () => { quantityMode = 'custom'; renderMarket(); });
  document.querySelectorAll('.quantity-preset').forEach((button) => {
    button.addEventListener('click', () => {
      el('tradeQty').value = button.dataset.qty;
      quantityMode = 'preset_' + button.dataset.qty;
      renderMarket();
    });
  });
  el('keepTravelCost').addEventListener('change', renderMarket);
  el('routeBudgetCity').addEventListener('change', () => {
    plannedCityId = el('routeBudgetCity').value;
    renderMarket();
  });
  el('intelCity').addEventListener('change', () => {
    selectedIntelCity = el('intelCity').value;
    renderIntel();
  });
  el('upgradeCargoBtn').addEventListener('click', () => act('upgradeCargo', {}));
  el('upgradeIntelBtn').addEventListener('click', () => act('upgradeIntel', {}));
  el('saveBtn').addEventListener('click', () => { session.advanceTo(Date.now()); store(false); render(); });
  el('exportBtn').addEventListener('click', exportLog);
  el('newGameBtn').addEventListener('click', () => {
    if (session && session.actions.length &&
        !window.confirm('현재 실시간 게임 저장을 새 게임으로 덮어쓸까요?')) return;
    saveEnabled = true;
    buildNewSession(Number(el('speedSelect').value));
    store();
    render();
    notify('새로운 실시간 무역을 시작했습니다.');
  });
  el('deleteSaveBtn').addEventListener('click', () => {
    if (!window.confirm('실시간 저장을 삭제하고 새 게임을 시작할까요? (기존 30일 저장은 유지됩니다)')) return;
    try { localStorage.removeItem(SAVE_KEY); } catch (_) { /* storage may be disabled */ }
    saveEnabled = true;
    buildNewSession(Number(el('speedSelect').value));
    store();
    render();
    notify('실시간 저장을 초기화하고 새 게임을 시작했습니다.');
  });

  const loaded = restore();
  if (!loaded) buildNewSession(Number(el('speedSelect').value));
  if (saveEnabled) store();
  render();
  window.setInterval(sync, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
})();

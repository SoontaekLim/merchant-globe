(() => {
  'use strict';

  const { Game, PRODUCTS, CITIES, ROUTES, INTEL_LEVELS } = window.MerchantGlobeCore;
  let game = new Game({ maxDay: 30 });
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

  function safeAction(fn) {
    try {
      const result = fn();
      render();
      return result;
    } catch (error) {
      showToast(error.message || '처리 중 오류가 발생했습니다.', true);
      return null;
    }
  }

  function tradeQuantity() {
    const input = el('tradeQty');
    let q = Math.floor(Number(input.value) || 1);
    q = Math.max(1, Math.min(99, q));
    input.value = String(q);
    return q;
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
    el('marketSummary').textContent = `${city.summary}${profile ? ` · ${profile}` : ''} · 재고와 수요가 실제 생산·소비 성향에 따라 회복됩니다.`;
    const body = el('marketBody');
    body.innerHTML = '';

    PRODUCTS.forEach((product) => {
      const info = game.marketInfo(game.cityId, product.id);
      const baseline = product.basePrice * city.modifiers[product.id];
      const deviation = ((info.price / baseline) - 1) * 100;
      const item = game.inventory[product.id];
      const heldUnitValue = info.price * game.freshnessMultiplier(product.id);
      const heldProfitRate = item.qty > 0 ? ((heldUnitValue / item.avgCost) - 1) * 100 : null;
      const stockPct = Math.round(info.stockRatio * 100);
      const demandPct = Math.round(info.demandRatio * 100);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="product-name">${product.name}</span><span class="trait-chip trait-${product.trait}">${product.traitLabel}</span><span class="price-note">기준 ${money(product.basePrice)} · 화물 ${product.cargoSize || 1}칸${product.trait === 'perishable' ? ' · 이동 시 신선도 하락' : ''}</span></td>
        <td class="number"><strong>${money(info.price)}</strong></td>
        <td class="number"><span class="market-chip ${stateClass(info.stockLabel)}">${info.stock}개 · ${info.stockLabel}</span><span class="price-note">평시 ${info.targetStock}개 (${stockPct}%)</span></td>
        <td class="number"><span class="market-chip ${stateClass(info.demandLabel)}">${info.demandLabel}</span><span class="price-note">평시 대비 ${demandPct}%</span></td>
        <td class="number ${deviation > 1 ? 'positive' : deviation < -1 ? 'negative' : 'neutral'}">${pct(deviation)}</td>
        <td class="number">${item.qty}</td>
        <td class="number">${item.qty ? money(item.avgCost) : '—'}</td>
        <td class="number ${heldProfitRate != null && heldProfitRate > 0 ? 'positive' : heldProfitRate != null && heldProfitRate < 0 ? 'negative' : 'neutral'}">${heldProfitRate == null ? '—' : pct(heldProfitRate)}</td>
        <td><div class="trade-actions"><button class="buy-button" type="button" ${info.stock < 1 ? 'disabled' : ''}>매입</button><button class="sell-button" type="button" ${item.qty ? '' : 'disabled'}>판매</button></div></td>`;

      tr.querySelector('.buy-button').addEventListener('click', () => {
        const q = tradeQuantity();
        const result = safeAction(() => game.buy(product.id, q));
        if (result) {
          showToast(`${product.name} ${q}개 매입 · 평균 체결 ${money(result.unitPrice)} · 다음 시세 ${money(result.nextPrice)}`);
          el('newsTitle').textContent = `${product.name} 재고 감소`;
          el('newsText').textContent = `대량 매입은 현지 재고를 줄여 같은 도시의 다음 거래 가격을 올릴 수 있습니다.`;
        }
      });
      tr.querySelector('.sell-button').addEventListener('click', () => {
        const q = tradeQuantity();
        const result = safeAction(() => game.sell(product.id, q));
        if (result) {
          showToast(`${product.name} 평균 체결 ${money(result.unitPrice)} · 손익 ${signedMoney(result.profit)} · 다음 시세 ${money(result.nextPrice)}`);
          el('newsTitle').textContent = `${product.name} 재고 증가`;
          el('newsText').textContent = `판매한 물량이 현지 시장에 공급되어 재고가 늘고 가격 하락 압력이 생겼습니다.`;
        }
      });
      body.appendChild(tr);
    });
  }

  function renderCargo() {
    const used = game.cargoUsed();
    el('cargoCount').textContent = `${used} / ${game.capacity}`;
    el('cargoBar').style.width = `${Math.min(100, (used / game.capacity) * 100)}%`;
    el('upgradeCost').textContent = money(game.cargoUpgradeCost());
    el('upgradeCargoBtn').disabled = game.gameOver;

    const list = el('inventoryList');
    const items = PRODUCTS.filter((p) => game.inventory[p.id].qty > 0);
    if (!items.length) {
      list.innerHTML = '<div class="empty-state">아직 보유한 상품이 없습니다.</div>';
      return;
    }
    list.innerHTML = items.map((p) => {
      const item = game.inventory[p.id];
      const freshness = game.freshnessMultiplier(p.id);
      const current = game.price(game.cityId, p.id) * freshness;
      const rate = ((current / item.avgCost) - 1) * 100;
      const slots = item.qty * (p.cargoSize || 1);
      const freshnessText = p.trait === 'perishable' ? ` · 신선도 ${Math.round(freshness * 100)}%` : '';
      return `<div class="inventory-row"><span><b>${p.name}</b> × ${item.qty}<small>${slots}칸${freshnessText}</small></span><span>평균 ${money(item.avgCost)} · <span class="${rate >= 0 ? 'positive' : 'negative'}">${pct(rate)}</span></span></div>`;
    }).join('');
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
          showToast(`${city.name} 도착 · ${result.days}일 경과 · 운송비 ${money(result.cost)}`);
          selectedIntelCity = result.from;
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
      button.addEventListener('click', () => { selectedIntelCity = city.id; renderIntel(); });
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

  function renderLog() {
    const list = el('tradeLog');
    list.innerHTML = game.logs.slice(0, 8).map((row) => `<div class="log-row"><b>Day ${row.day}</b>${row.text}</div>`).join('');
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

  function renderGameOver() {
    const panel = el('gameOverPanel');
    panel.hidden = !game.gameOver;
    if (!game.gameOver) return;
    const s = game.stats;
    el('gameOverSummary').textContent = `30일 동안 ${s.trips}번 이동하고 ${s.buys + s.sells}번 거래했습니다.`;
    el('resultStats').innerHTML = `
      <div><span>최종 자산</span><strong>${money(game.totalAssets())}</strong></div>
      <div><span>실현 손익</span><strong class="${s.realizedProfit >= 0 ? 'positive' : 'negative'}">${signedMoney(s.realizedProfit)}</strong></div>
      <div><span>거래 물량</span><strong>${s.unitsBought + s.unitsSold}개</strong></div>
      <div><span>운송비</span><strong>${money(s.transportCost)}</strong></div>`;
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

  function newGame() {
    game = new Game({ maxDay: 30 });
    selectedIntelCity = 'busan';
    el('newsTitle').textContent = '시장 정보';
    el('newsText').textContent = '도시 생산·소비, 상품 특성, 항로 상태를 함께 보세요. 같은 가격 차이도 상황에 따라 수익성이 달라집니다.';
    render();
    showToast('새로운 30일 무역을 시작했습니다.');
  }

  el('tradeQty').addEventListener('change', tradeQuantity);
  el('upgradeCargoBtn').addEventListener('click', () => {
    const result = safeAction(() => game.upgradeCargo());
    if (result) showToast(`화물칸이 ${result.capacity}칸으로 늘었습니다.`);
  });
  el('upgradeIntelBtn').addEventListener('click', () => {
    const result = safeAction(() => game.upgradeIntel());
    if (result) showToast(`정보망이 ${result.info.name} Lv.${result.level}로 확장되었습니다.`);
  });
  el('newGameBtn').addEventListener('click', newGame);
  el('restartBtn').addEventListener('click', newGame);

  render();
})();

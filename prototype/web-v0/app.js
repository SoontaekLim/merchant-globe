(() => {
  'use strict';

  const { Game, PRODUCTS, CITIES, ROUTES } = window.MerchantGlobeCore;
  let game = new Game({ maxDay: 30 });
  let toastTimer = null;

  const el = (id) => document.getElementById(id);
  const money = (n) => `₩${Math.round(Number(n) || 0).toLocaleString('ko-KR')}`;
  const signedMoney = (n) => `${n >= 0 ? '+' : '-'}${money(Math.abs(n))}`;
  const pct = (n) => `${n >= 0 ? '+' : ''}${Math.round(n)}%`;

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
    el('marketSummary').textContent = `${city.summary} · 재고가 줄거나 수요가 오르면 가격 상승 압력이 생깁니다.`;
    const body = el('marketBody');
    body.innerHTML = '';

    PRODUCTS.forEach((product) => {
      const info = game.marketInfo(game.cityId, product.id);
      const baseline = product.basePrice * city.modifiers[product.id];
      const deviation = ((info.price / baseline) - 1) * 100;
      const item = game.inventory[product.id];
      const heldProfitRate = item.qty > 0 ? ((info.price / item.avgCost) - 1) * 100 : null;
      const stockPct = Math.round(info.stockRatio * 100);
      const demandPct = Math.round(info.demandRatio * 100);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="product-name">${product.name}</span><span class="price-note">기준 ${money(product.basePrice)}</span></td>
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
      const current = game.price(game.cityId, p.id);
      const rate = ((current / item.avgCost) - 1) * 100;
      return `<div class="inventory-row"><span><b>${p.name}</b> × ${item.qty}</span><span>평균 ${money(item.avgCost)} · <span class="${rate >= 0 ? 'positive' : 'negative'}">${pct(rate)}</span></span></div>`;
    }).join('');
  }

  function renderRoutes() {
    const list = el('routeList');
    list.innerHTML = '';
    Object.keys(CITIES).filter((id) => id !== game.cityId).forEach((dest) => {
      const [cost, days] = ROUTES[game.cityId][dest];
      const city = CITIES[dest];
      const button = document.createElement('button');
      button.className = 'route-button';
      button.type = 'button';
      button.disabled = game.gameOver;
      button.innerHTML = `<strong>${city.name}</strong><span class="route-cost">${money(cost)}</span><span>${days}일 · ${city.country}</span>`;
      button.addEventListener('click', () => {
        const result = safeAction(() => game.travel(dest));
        if (result) {
          showToast(`${city.name} 도착 · ${result.days}일 경과`);
          updateNews(result.event);
        }
      });
      list.appendChild(button);
    });
  }

  function renderEvents() {
    const list = el('eventList');
    const active = game.events.filter((e) => e.expiresDay >= game.day).slice().reverse();
    if (!active.length) {
      list.innerHTML = '<div class="empty-state">현재 특별한 시장 사건이 없습니다.</div>';
      return;
    }
    list.innerHTML = active.slice(0, 6).map((event) => {
      const effect = event.kind === 'demand'
        ? `수요 +${event.impact}%`
        : `재고 +${event.impact}개`;
      const cls = event.kind === 'demand' ? 'positive' : 'market-cool-text';
      return `<div class="event-row"><strong>${event.title} <span class="${cls}">${effect}</span></strong><span>${event.description} · ${event.expiresDay}일차까지</span></div>`;
    }).join('');
  }

  function renderLog() {
    const list = el('tradeLog');
    list.innerHTML = game.logs.slice(0, 8).map((row) => `<div class="log-row"><b>Day ${row.day}</b>${row.text}</div>`).join('');
  }

  function updateNews(event) {
    if (event) {
      el('newsTitle').textContent = event.title;
      el('newsText').textContent = event.description;
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
    renderEvents();
    renderLog();
    renderGameOver();
  }

  function newGame() {
    game = new Game({ maxDay: 30 });
    el('newsTitle').textContent = '시장 정보';
    el('newsText').textContent = '가격뿐 아니라 재고와 수요를 함께 보세요. 같은 도시에서 대량 거래하면 시세가 움직입니다.';
    render();
    showToast('새로운 30일 무역을 시작했습니다.');
  }

  el('tradeQty').addEventListener('change', tradeQuantity);
  el('upgradeCargoBtn').addEventListener('click', () => {
    const result = safeAction(() => game.upgradeCargo());
    if (result) showToast(`화물칸이 ${result.capacity}칸으로 늘었습니다.`);
  });
  el('newGameBtn').addEventListener('click', newGame);
  el('restartBtn').addEventListener('click', newGame);

  render();
})();

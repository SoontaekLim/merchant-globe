(function (global) {
  'use strict';

  const PRODUCTS = [
    { id: 'rice', name: '쌀', basePrice: 620, volatility: 0.07, trait: 'stable', traitLabel: '안정형', cargoSize: 1, eventSensitivity: 0.90 },
    { id: 'tea', name: '차', basePrice: 880, volatility: 0.10, trait: 'volatile', traitLabel: '변동형', cargoSize: 1, eventSensitivity: 1.08 },
    { id: 'silk', name: '비단', basePrice: 1500, volatility: 0.12, trait: 'volatile', traitLabel: '변동형', cargoSize: 1, eventSensitivity: 1.12 },
    { id: 'ceramic', name: '도자기', basePrice: 1250, volatility: 0.10, trait: 'bulky', traitLabel: '중량품', cargoSize: 2, eventSensitivity: 1.00 },
    { id: 'ginseng', name: '인삼', basePrice: 1900, volatility: 0.14, trait: 'volatile', traitLabel: '변동형', cargoSize: 1, eventSensitivity: 1.18 },
    { id: 'timber', name: '목재', basePrice: 720, volatility: 0.08, trait: 'bulky', traitLabel: '중량품', cargoSize: 2, eventSensitivity: 0.95 },
    { id: 'iron', name: '철', basePrice: 1050, volatility: 0.09, trait: 'bulky', traitLabel: '중량품', cargoSize: 2, eventSensitivity: 0.95 },
    { id: 'spice', name: '향신료', basePrice: 1650, volatility: 0.16, trait: 'volatile', traitLabel: '고변동', cargoSize: 1, eventSensitivity: 1.25 },
    { id: 'fish', name: '수산물', basePrice: 540, volatility: 0.12, trait: 'perishable', traitLabel: '신선품', cargoSize: 1, spoilageRate: 0.07, freshnessFloor: 0.55, eventSensitivity: 1.12 },
    { id: 'paper', name: '종이', basePrice: 760, volatility: 0.07, trait: 'stable', traitLabel: '안정형', cargoSize: 1, eventSensitivity: 0.90 },
    { id: 'cotton', name: '면직물', basePrice: 980, volatility: 0.09, trait: 'stable', traitLabel: '안정형', cargoSize: 1, eventSensitivity: 0.95 },
    { id: 'copper', name: '구리', basePrice: 1180, volatility: 0.10, trait: 'bulky', traitLabel: '중량품', cargoSize: 2, eventSensitivity: 1.00 }
  ];

  const CITIES = {
    seoul: {
      id: 'seoul', name: '서울', country: '대한민국',
      summary: '인삼·종이 생산과 향신료 소비가 두드러지는 균형형 시장',
      production: { ginseng: 1.40, paper: 1.25, rice: 1.10 },
      consumption: { spice: 1.28, tea: 1.10, copper: 1.08 },
      modifiers: { rice: 0.82, tea: 1.08, silk: 1.05, ceramic: 0.88, ginseng: 0.68, timber: 1.05, iron: 1.08, spice: 1.24, fish: 1.02, paper: 0.86, cotton: 1.04, copper: 1.12 }
    },
    busan: {
      id: 'busan', name: '부산', country: '대한민국',
      summary: '수산물 생산이 빠르고 비단 소비가 강한 항구 시장',
      production: { fish: 1.55, timber: 1.10 },
      consumption: { silk: 1.18, spice: 1.12, cotton: 1.10 },
      modifiers: { rice: 0.94, tea: 1.02, silk: 1.11, ceramic: 1.02, ginseng: 0.94, timber: 0.96, iron: 0.98, spice: 1.10, fish: 0.67, paper: 1.01, cotton: 1.06, copper: 1.00 }
    },
    fukuoka: {
      id: 'fukuoka', name: '후쿠오카', country: '일본',
      summary: '차·목재 생산과 인삼 소비가 뚜렷한 근거리 교역 시장',
      production: { tea: 1.30, timber: 1.28, fish: 1.12 },
      consumption: { ginseng: 1.22, silk: 1.12 },
      modifiers: { rice: 1.06, tea: 0.86, silk: 1.16, ceramic: 0.92, ginseng: 1.22, timber: 0.90, iron: 1.02, spice: 1.13, fish: 0.76, paper: 0.93, cotton: 1.08, copper: 1.04 }
    },
    osaka: {
      id: 'osaka', name: '오사카', country: '일본',
      summary: '공업품 생산과 인삼·쌀 소비가 강한 대형 시장',
      production: { iron: 1.35, ceramic: 1.30, copper: 1.25 },
      consumption: { ginseng: 1.42, rice: 1.15, timber: 1.10 },
      modifiers: { rice: 1.11, tea: 0.93, silk: 0.94, ceramic: 0.82, ginseng: 1.38, timber: 1.07, iron: 0.87, spice: 1.04, fish: 0.91, paper: 0.88, cotton: 0.91, copper: 0.86 }
    },
    shanghai: {
      id: 'shanghai', name: '상하이', country: '중국',
      summary: '차·비단·면직물 공급이 풍부하고 목재 소비가 강한 생산시장',
      production: { tea: 1.50, silk: 1.45, cotton: 1.40, ceramic: 1.20 },
      consumption: { timber: 1.28, ginseng: 1.16, iron: 1.10 },
      modifiers: { rice: 0.96, tea: 0.66, silk: 0.69, ceramic: 0.76, ginseng: 1.27, timber: 1.13, iron: 1.12, spice: 0.83, fish: 1.08, paper: 0.79, cotton: 0.78, copper: 1.08 }
    }
  };

  const INTEL_LEVELS = [
    { level: 0, name: '현지 장부', coverage: 0, refreshDays: null, cost: 6000 },
    { level: 1, name: '지역 정보망', coverage: 3, refreshDays: 3, cost: 14000 },
    { level: 2, name: '광역 정보망', coverage: 6, refreshDays: 2, cost: 28000 },
    { level: 3, name: '글로벌 정보망', coverage: 12, refreshDays: 1, cost: null }
  ];

  const ROUTES = {
    seoul: { busan: [380, 1], fukuoka: [620, 2], osaka: [760, 2], shanghai: [980, 3] },
    busan: { seoul: [380, 1], fukuoka: [320, 1], osaka: [470, 1], shanghai: [730, 2] },
    fukuoka: { seoul: [620, 2], busan: [320, 1], osaka: [350, 1], shanghai: [690, 2] },
    osaka: { seoul: [760, 2], busan: [470, 1], fukuoka: [350, 1], shanghai: [820, 2] },
    shanghai: { seoul: [980, 3], busan: [730, 2], fukuoka: [690, 2], osaka: [820, 2] }
  };

  function hashSeed(value) {
    let h = 2166136261 >>> 0;
    const str = String(value == null ? 'merchant-globe' : value);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function createRng(seed) {
    let state = hashSeed(seed) || 1;
    return function rng() {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return state / 4294967296;
    };
  }

  function round10(n) { return Math.max(10, Math.round(n / 10) * 10); }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function deepClone(value) { return JSON.parse(JSON.stringify(value)); }

  class Game {
    constructor(options) {
      const opts = options || {};
      this.rng = createRng(opts.seed || Date.now());
      this.maxDay = opts.maxDay || 30;
      this.reset();
    }

    reset() {
      this.day = 1;
      this.cityId = 'seoul';
      this.cash = 10000;
      this.capacity = 20;
      this.cargoUpgradeLevel = 0;
      this.intelLevel = 0;
      this.intelSnapshots = {};
      this.inventory = {};
      this.market = {};
      this.marketDynamics = {};
      this.events = [];
      this.routeEvents = [];
      this.logs = [];
      this.gameOver = false;
      this.stats = {
        buys: 0,
        sells: 0,
        trips: 0,
        revenue: 0,
        realizedProfit: 0,
        transportCost: 0,
        unitsBought: 0,
        unitsSold: 0
      };
      PRODUCTS.forEach((p) => { this.inventory[p.id] = { qty: 0, avgCost: 0, freshness: 1 }; });
      this.initializeMarkets();
      this.captureIntel(this.cityId, PRODUCTS.map((p) => p.id));
      this.addLog('서울에서 작은 상인으로 거래를 시작했습니다.');
      return this.snapshot();
    }

    initializeMarkets() {
      Object.keys(CITIES).forEach((cityId) => {
        this.market[cityId] = {};
        this.marketDynamics[cityId] = {};
        PRODUCTS.forEach((p) => {
          const city = CITIES[cityId];
          const modifier = city.modifiers[p.id];
          const productionFactor = (city.production && city.production[p.id]) || 1;
          const consumptionFactor = (city.consumption && city.consumption[p.id]) || 1;
          const base = p.basePrice * modifier;
          const priceJitter = 1 + (this.rng() - 0.5) * p.volatility * 1.2;
          const targetStock = Math.round(clamp((62 / modifier) * productionFactor, 34, 128));
          const targetDemand = Math.round(clamp(90 * modifier * consumptionFactor, 55, 150));
          const initialStock = Math.round(targetStock * (0.88 + this.rng() * 0.24));
          const initialDemand = Math.round(targetDemand * (0.92 + this.rng() * 0.16));

          this.market[cityId][p.id] = round10(base * priceJitter);
          this.marketDynamics[cityId][p.id] = {
            stock: initialStock,
            targetStock,
            demand: initialDemand,
            targetDemand,
            productionFactor,
            consumptionFactor
          };
        });
      });
    }

    snapshot() {
      return {
        day: this.day,
        maxDay: this.maxDay,
        cityId: this.cityId,
        cash: this.cash,
        capacity: this.capacity,
        cargoUpgradeLevel: this.cargoUpgradeLevel,
        intelLevel: this.intelLevel,
        intelSnapshots: deepClone(this.intelSnapshots),
        inventory: deepClone(this.inventory),
        marketDynamics: deepClone(this.marketDynamics),
        events: this.events.map((e) => ({ ...e })),
        routeEvents: this.routeEvents.map((e) => ({ ...e })),
        logs: this.logs.slice(),
        gameOver: this.gameOver,
        stats: { ...this.stats },
        totalAssets: this.totalAssets(),
        cargoUsed: this.cargoUsed()
      };
    }

    getProduct(id) { return PRODUCTS.find((p) => p.id === id); }
    getCity(id) { return CITIES[id]; }
    getRoute(from, to) { return ROUTES[from] && ROUTES[from][to] ? ROUTES[from][to] : null; }

    routeKey(from, to) {
      return [from, to].sort().join(':');
    }

    routeInfo(from, to) {
      const base = this.getRoute(from, to);
      if (!base) return null;
      const [baseCost, baseDays] = base;
      const key = this.routeKey(from, to);
      const active = this.routeEvents.filter((event) => event.routeKey === key && event.expiresDay >= this.day);
      let costMultiplier = 1;
      let daysDelta = 0;
      active.forEach((event) => {
        costMultiplier *= event.costMultiplier || 1;
        daysDelta += event.daysDelta || 0;
      });
      return {
        from, to, baseCost, baseDays,
        cost: Math.max(0, Math.round((baseCost * costMultiplier) / 10) * 10),
        days: Math.max(1, baseDays + daysDelta),
        costMultiplier,
        daysDelta,
        events: active.map((event) => ({ ...event }))
      };
    }

    routeNotices() {
      return this.routeEvents
        .filter((event) => event.expiresDay >= this.day)
        .map((event) => ({ ...event }));
    }

    intelLevelInfo() {
      return INTEL_LEVELS[this.intelLevel];
    }

    intelUpgradeCost() {
      const next = INTEL_LEVELS[this.intelLevel + 1];
      return next ? INTEL_LEVELS[this.intelLevel].cost : null;
    }

    distinctiveProducts(cityId, count) {
      const city = CITIES[cityId];
      return PRODUCTS
        .slice()
        .sort((a, b) => {
          const da = Math.abs(Math.log(city.modifiers[a.id] || 1));
          const db = Math.abs(Math.log(city.modifiers[b.id] || 1));
          if (db !== da) return db - da;
          return a.id.localeCompare(b.id);
        })
        .slice(0, count)
        .map((p) => p.id);
    }

    captureIntel(cityId, productIds) {
      if (!this.intelSnapshots[cityId]) this.intelSnapshots[cityId] = {};
      const ids = productIds || PRODUCTS.map((p) => p.id);
      ids.forEach((productId) => {
        const info = this.marketInfo(cityId, productId);
        const previous = this.intelSnapshots[cityId][productId];
        this.intelSnapshots[cityId][productId] = {
          productId,
          price: info.price,
          stockLabel: info.stockLabel,
          demandLabel: info.demandLabel,
          capturedDay: this.day,
          previousPrice: previous ? previous.price : null
        };
      });
    }

    refreshRemoteIntel(force) {
      const level = this.intelLevelInfo();
      if (!level || level.coverage <= 0) return;
      Object.keys(CITIES).forEach((cityId) => {
        if (cityId === this.cityId) return;
        const productIds = this.distinctiveProducts(cityId, level.coverage);
        productIds.forEach((productId) => {
          const current = this.intelSnapshots[cityId] && this.intelSnapshots[cityId][productId];
          const age = current ? this.day - current.capturedDay : Infinity;
          if (force || !current || age >= level.refreshDays) this.captureIntel(cityId, [productId]);
        });
      });
    }

    remoteIntel(cityId) {
      if (!CITIES[cityId]) throw new Error('존재하지 않는 도시입니다.');
      if (cityId === this.cityId) {
        return {
          cityId,
          live: true,
          level: this.intelLevel,
          entries: PRODUCTS.map((p) => {
            const info = this.marketInfo(cityId, p.id);
            return { productId: p.id, price: info.price, stockLabel: info.stockLabel, demandLabel: info.demandLabel, capturedDay: this.day, age: 0, trend: 'same' };
          })
        };
      }
      const snapshots = this.intelSnapshots[cityId] || {};
      const entries = Object.values(snapshots)
        .map((entry) => ({
          ...entry,
          age: Math.max(0, this.day - entry.capturedDay),
          trend: entry.previousPrice == null ? 'same' : entry.price > entry.previousPrice ? 'up' : entry.price < entry.previousPrice ? 'down' : 'same'
        }))
        .sort((a, b) => {
          const pa = PRODUCTS.findIndex((p) => p.id === a.productId);
          const pb = PRODUCTS.findIndex((p) => p.id === b.productId);
          return pa - pb;
        });
      return { cityId, live: false, level: this.intelLevel, entries };
    }

    marketRumors() {
      return this.events
        .filter((e) => e.expiresDay >= this.day)
        .map((event) => {
          const local = event.cityId === this.cityId;
          if (local || this.intelLevel >= 2) return { ...event, precision: 'full' };
          if (this.intelLevel === 1) {
            return {
              ...event,
              impact: null,
              description: `${CITIES[event.cityId].name}에서 ${this.getProduct(event.productId).name} 시장의 ${event.kind === 'demand' ? '수요가 강해지고' : event.kind === 'shortage' ? '공급이 불안정해지고' : '공급이 늘고'} 있다는 보고가 들어왔습니다.`,
              precision: 'partial'
            };
          }
          return {
            ...event,
            title: `${CITIES[event.cityId].name} ${this.getProduct(event.productId).name} 시장 소문`,
            impact: null,
            expiresDay: null,
            description: `${CITIES[event.cityId].name}의 ${this.getProduct(event.productId).name} 시장에 평소와 다른 움직임이 있다는 소문입니다.`,
            precision: 'rumor'
          };
        });
    }

    upgradeIntel() {
      this.ensureActive();
      if (this.intelLevel >= INTEL_LEVELS.length - 1) throw new Error('정보망이 이미 최고 단계입니다.');
      const cost = this.intelUpgradeCost();
      if (this.cash < cost) throw new Error('정보망 업그레이드 비용이 부족합니다.');
      this.cash -= cost;
      this.intelLevel += 1;
      this.refreshRemoteIntel(true);
      const info = this.intelLevelInfo();
      this.addLog(`정보망 업그레이드 · ${info.name} Lv.${this.intelLevel}`);
      return { cost, level: this.intelLevel, info: { ...info } };
    }

    getMarketState(cityId, productId) {
      if (!this.marketDynamics[cityId] || !this.marketDynamics[cityId][productId]) {
        throw new Error('시장 정보를 찾을 수 없습니다.');
      }
      return this.marketDynamics[cityId][productId];
    }

    activeEventTargets(cityId, productId) {
      let stockTargetMultiplier = 1;
      let demandTargetMultiplier = 1;
      this.events
        .filter((e) => e.cityId === cityId && e.productId === productId && e.expiresDay >= this.day)
        .forEach((e) => {
          stockTargetMultiplier *= e.stockTargetMultiplier || 1;
          demandTargetMultiplier *= e.demandTargetMultiplier || 1;
        });
      return { stockTargetMultiplier, demandTargetMultiplier };
    }

    marketInfo(cityId, productId) {
      const state = this.getMarketState(cityId, productId);
      const stockRatio = state.stock / state.targetStock;
      const demandRatio = state.demand / state.targetDemand;
      const price = this.price(cityId, productId);
      return {
        price,
        stock: Math.max(0, Math.floor(state.stock)),
        targetStock: state.targetStock,
        stockRatio,
        stockLabel: this.stockLabel(stockRatio),
        demand: state.demand,
        targetDemand: state.targetDemand,
        demandRatio,
        demandLabel: this.demandLabel(demandRatio)
      };
    }

    stockLabel(ratio) {
      if (ratio <= 0.55) return '매우 부족';
      if (ratio <= 0.78) return '부족';
      if (ratio >= 1.45) return '과잉';
      if (ratio >= 1.18) return '넉넉';
      return '보통';
    }

    demandLabel(ratio) {
      if (ratio >= 1.24) return '매우 높음';
      if (ratio >= 1.08) return '높음';
      if (ratio <= 0.76) return '매우 낮음';
      if (ratio <= 0.92) return '낮음';
      return '보통';
    }

    priceFromState(cityId, productId, stock, demand) {
      const anchor = this.market[cityId][productId];
      const state = this.getMarketState(cityId, productId);
      const stockPressure = clamp(Math.pow(state.targetStock / Math.max(1, stock), 0.38), 0.72, 1.38);
      const demandPressure = clamp(Math.pow(demand / Math.max(1, state.targetDemand), 0.52), 0.78, 1.30);
      return round10(anchor * stockPressure * demandPressure);
    }

    price(cityId, productId) {
      const state = this.getMarketState(cityId, productId);
      return this.priceFromState(cityId, productId, state.stock, state.demand);
    }

    executionPrice(cityId, productId, quantity, side) {
      const state = this.getMarketState(cityId, productId);
      const qty = Math.max(1, Math.floor(Number(quantity) || 1));
      const startPrice = this.priceFromState(cityId, productId, state.stock, state.demand);
      const maxStock = state.targetStock * 2.5;
      const endStock = side === 'buy'
        ? Math.max(0.01, state.stock - qty)
        : Math.min(maxStock, state.stock + qty);
      const endPrice = this.priceFromState(cityId, productId, endStock, state.demand);
      const midpoint = (startPrice + endPrice) / 2;
      const spread = side === 'buy' ? 1.015 : 0.985;
      const quality = side === 'sell' ? this.freshnessMultiplier(productId) : 1;
      return round10(midpoint * spread * quality);
    }

    freshnessMultiplier(productId) {
      const product = this.getProduct(productId);
      const item = this.inventory[productId];
      if (!product || !item || product.trait !== 'perishable') return 1;
      return clamp(item.freshness == null ? 1 : item.freshness, product.freshnessFloor || 0.5, 1);
    }

    ageCargoOneDay() {
      PRODUCTS.forEach((product) => {
        if (product.trait !== 'perishable') return;
        const item = this.inventory[product.id];
        if (!item || item.qty <= 0) return;
        item.freshness = clamp(
          (item.freshness == null ? 1 : item.freshness) - (product.spoilageRate || 0),
          product.freshnessFloor || 0.5,
          1
        );
      });
    }

    cargoUsed() {
      return PRODUCTS.reduce((sum, p) => sum + this.inventory[p.id].qty * (p.cargoSize || 1), 0);
    }

    totalAssets() {
      return this.cash + PRODUCTS.reduce((sum, p) => sum + this.inventory[p.id].qty * this.price(this.cityId, p.id) * this.freshnessMultiplier(p.id), 0);
    }

    buy(productId, quantity) {
      this.ensureActive();
      const product = this.getProduct(productId);
      const qty = Math.max(1, Math.floor(Number(quantity) || 1));
      if (!product) throw new Error('존재하지 않는 상품입니다.');

      const marketState = this.getMarketState(this.cityId, productId);
      const available = Math.max(0, Math.floor(marketState.stock));
      if (available < qty) throw new Error(`시장 재고가 부족합니다. 현재 ${available}개 구매할 수 있습니다.`);

      const unitPrice = this.executionPrice(this.cityId, productId, qty, 'buy');
      const total = unitPrice * qty;
      const cargoNeed = qty * (product.cargoSize || 1);
      if (this.cargoUsed() + cargoNeed > this.capacity) throw new Error(`화물칸이 부족합니다. ${product.name} ${qty}개에는 ${cargoNeed}칸이 필요합니다.`);
      if (this.cash < total) throw new Error('현금이 부족합니다.');

      const item = this.inventory[productId];
      const previousQty = item.qty;
      const previousValue = previousQty * item.avgCost;
      const previousFreshness = item.freshness == null ? 1 : item.freshness;
      item.qty += qty;
      item.avgCost = (previousValue + total) / item.qty;
      if (product.trait === 'perishable') {
        item.freshness = ((previousQty * previousFreshness) + qty) / item.qty;
      }
      this.cash -= total;
      marketState.stock = Math.max(0, marketState.stock - qty);
      this.stats.buys += 1;
      this.stats.unitsBought += qty;
      this.addLog(`${product.name} ${qty}개 매입 · 평균 체결 ${this.money(unitPrice)}/개 · 시장 재고 ${Math.floor(marketState.stock)}개`);
      return {
        type: 'buy', productId, qty, unitPrice, total,
        stockAfter: Math.floor(marketState.stock),
        nextPrice: this.price(this.cityId, productId)
      };
    }

    sell(productId, quantity) {
      this.ensureActive();
      const product = this.getProduct(productId);
      const qty = Math.max(1, Math.floor(Number(quantity) || 1));
      if (!product) throw new Error('존재하지 않는 상품입니다.');
      const item = this.inventory[productId];
      if (item.qty < qty) throw new Error('보유 수량이 부족합니다.');

      const marketState = this.getMarketState(this.cityId, productId);
      const unitPrice = this.executionPrice(this.cityId, productId, qty, 'sell');
      const revenue = unitPrice * qty;
      const profit = (unitPrice - item.avgCost) * qty;
      item.qty -= qty;
      if (item.qty === 0) { item.avgCost = 0; item.freshness = 1; }
      this.cash += revenue;
      marketState.stock = Math.min(marketState.targetStock * 2.5, marketState.stock + qty);
      this.stats.sells += 1;
      this.stats.unitsSold += qty;
      this.stats.revenue += revenue;
      this.stats.realizedProfit += profit;
      this.addLog(`${product.name} ${qty}개 판매 · 평균 체결 ${this.money(unitPrice)}/개 · ${profit >= 0 ? '+' : ''}${this.money(profit)} 손익 · 시장 재고 ${Math.floor(marketState.stock)}개`);
      return {
        type: 'sell', productId, qty, unitPrice, revenue, profit,
        stockAfter: Math.floor(marketState.stock),
        nextPrice: this.price(this.cityId, productId)
      };
    }

    travel(destinationId) {
      this.ensureActive();
      if (!CITIES[destinationId]) throw new Error('존재하지 않는 도시입니다.');
      if (destinationId === this.cityId) throw new Error('이미 현재 도시에 있습니다.');
      const route = this.routeInfo(this.cityId, destinationId);
      if (!route) throw new Error('이동 가능한 항로가 없습니다.');
      const { cost, days } = route;
      if (this.cash < cost) throw new Error('운송비가 부족합니다.');

      const from = this.cityId;
      this.captureIntel(from, PRODUCTS.map((p) => p.id));
      this.cash -= cost;
      this.stats.transportCost += cost;
      this.stats.trips += 1;
      const newEvents = this.advanceEconomy(days);
      this.cityId = destinationId;
      this.captureIntel(destinationId, PRODUCTS.map((p) => p.id));
      this.addLog(`${CITIES[from].name} → ${CITIES[destinationId].name} 이동 · ${days}일 / ${this.money(cost)}`);

      if (this.day >= this.maxDay) {
        this.day = this.maxDay;
        this.gameOver = true;
        this.addLog(`30일 거래가 종료되었습니다. 최종 자산 ${this.money(this.totalAssets())}`);
      }
      return { type: 'travel', from, to: destinationId, cost, days, route, event: newEvents[newEvents.length - 1] || null };
    }

    advanceEconomy(days) {
      const createdEvents = [];
      for (let step = 0; step < days; step++) {
        this.day += 1;
        this.events = this.events.filter((e) => e.expiresDay >= this.day);
        this.routeEvents = this.routeEvents.filter((e) => e.expiresDay >= this.day);
        this.ageCargoOneDay();

        Object.keys(CITIES).forEach((cityId) => {
          PRODUCTS.forEach((p) => {
            const baseline = p.basePrice * CITIES[cityId].modifiers[p.id];
            const oldAnchor = this.market[cityId][p.id];
            const noise = (this.rng() - 0.5) * 2 * p.volatility;
            const candidate = oldAnchor * 0.72 + baseline * (1 + noise) * 0.28;
            this.market[cityId][p.id] = round10(clamp(candidate, baseline * 0.72, baseline * 1.34));

            const state = this.getMarketState(cityId, p.id);
            const activeTargets = this.activeEventTargets(cityId, p.id);
            const effectiveStockTarget = state.targetStock * activeTargets.stockTargetMultiplier;
            const effectiveDemandTarget = state.targetDemand * activeTargets.demandTargetMultiplier;

            const stockRecoveryRate = clamp(0.20 + (state.productionFactor - 1) * 0.18, 0.16, 0.34);
            const stockRecovery = (effectiveStockTarget - state.stock) * stockRecoveryRate;
            const stockNoise = (this.rng() - 0.5) * 3.2;
            state.stock = clamp(state.stock + stockRecovery + stockNoise, 1, state.targetStock * 2.5);

            const demandRecoveryRate = clamp(0.27 + (state.consumptionFactor - 1) * 0.10, 0.24, 0.34);
            const demandRecovery = (effectiveDemandTarget - state.demand) * demandRecoveryRate;
            const demandNoise = (this.rng() - 0.5) * (6 + p.volatility * 28);
            state.demand = clamp(state.demand + demandRecovery + demandNoise, state.targetDemand * 0.55, state.targetDemand * 1.65);
          });
        });

        if (this.rng() < 0.38) {
          const event = this.createEvent();
          createdEvents.push(event);
        }
        if (this.rng() < 0.16) {
          const routeEvent = this.createRouteEvent();
          createdEvents.push(routeEvent);
        }
        this.refreshRemoteIntel(false);
      }
      return createdEvents;
    }

    createEvent(forcedType) {
      const cityIds = Object.keys(CITIES);
      const cityId = cityIds[Math.floor(this.rng() * cityIds.length)];
      const product = PRODUCTS[Math.floor(this.rng() * PRODUCTS.length)];
      const duration = 2 + Math.floor(this.rng() * 3);
      const state = this.getMarketState(cityId, product.id);
      const sensitivity = product.eventSensitivity || 1;
      const roll = this.rng();
      const type = forcedType || (roll < 0.28 ? 'festival' : roll < 0.52 ? 'trend' : roll < 0.78 ? 'surplus' : 'shortage');
      let event;

      if (type === 'festival' || type === 'trend') {
        const baseBoost = type === 'festival' ? 0.24 : 0.16;
        const extra = type === 'festival' ? 0.12 : 0.10;
        const demandBoost = 1 + (baseBoost + this.rng() * extra) * sensitivity;
        state.demand = clamp(state.demand * demandBoost, state.targetDemand * 0.55, state.targetDemand * 1.75);
        event = {
          id: `evt-${this.day}-${Math.floor(this.rng() * 100000)}`,
          type: 'market',
          scenario: type,
          kind: 'demand',
          cityId,
          productId: product.id,
          demandTargetMultiplier: type === 'festival' ? 1.22 : 1.14,
          stockTargetMultiplier: 1,
          impact: Math.round((demandBoost - 1) * 100),
          createdDay: this.day,
          expiresDay: Math.min(this.maxDay, this.day + duration),
          title: type === 'festival'
            ? `${CITIES[cityId].name} 축제 · ${product.name} 특수`
            : `${CITIES[cityId].name} ${product.name} 유행`,
          description: `${CITIES[cityId].name}에서 ${product.name} 소비가 급증했습니다. 수요가 유지되는 동안 가격 상승 압력이 생깁니다.`
        };
      } else if (type === 'surplus') {
        const supplyBoost = (0.26 + this.rng() * 0.20) * sensitivity;
        const addedStock = Math.max(8, Math.round(state.targetStock * supplyBoost));
        state.stock = clamp(state.stock + addedStock, 1, state.targetStock * 2.7);
        event = {
          id: `evt-${this.day}-${Math.floor(this.rng() * 100000)}`,
          type: 'market',
          scenario: type,
          kind: 'supply',
          cityId,
          productId: product.id,
          demandTargetMultiplier: 1,
          stockTargetMultiplier: 1.26,
          impact: addedStock,
          createdDay: this.day,
          expiresDay: Math.min(this.maxDay, this.day + duration),
          title: `${CITIES[cityId].name} ${product.name} 증산`,
          description: `${CITIES[cityId].name}에 ${product.name} 물량 ${addedStock}개가 추가 유입되었습니다. 재고가 많은 동안 가격 하락 압력이 생깁니다.`
        };
      } else {
        const shortageRate = clamp((0.20 + this.rng() * 0.18) * sensitivity, 0.16, 0.48);
        const removedStock = Math.max(5, Math.round(state.stock * shortageRate));
        state.stock = Math.max(1, state.stock - removedStock);
        event = {
          id: `evt-${this.day}-${Math.floor(this.rng() * 100000)}`,
          type: 'market',
          scenario: 'shortage',
          kind: 'shortage',
          cityId,
          productId: product.id,
          demandTargetMultiplier: 1,
          stockTargetMultiplier: 0.82,
          impact: -removedStock,
          createdDay: this.day,
          expiresDay: Math.min(this.maxDay, this.day + duration),
          title: `${CITIES[cityId].name} ${product.name} 공급 차질`,
          description: `${CITIES[cityId].name}에서 ${product.name} 공급에 차질이 생겨 재고 ${removedStock}개가 시장에서 사라졌습니다.`
        };
      }

      this.events.push(event);
      return event;
    }

    createRouteEvent(options) {
      const opts = options || {};
      const pairs = [];
      Object.keys(ROUTES).forEach((from) => {
        Object.keys(ROUTES[from]).forEach((to) => {
          if (from < to) pairs.push([from, to]);
        });
      });
      const pair = opts.from && opts.to
        ? [opts.from, opts.to]
        : pairs[Math.floor(this.rng() * pairs.length)];
      const from = pair[0];
      const to = pair[1];
      const key = this.routeKey(from, to);
      const kind = opts.kind || (this.rng() < 0.62 ? 'congestion' : 'tailwind');
      const duration = 2 + Math.floor(this.rng() * 3);
      const event = kind === 'congestion'
        ? {
            id: `route-${this.day}-${Math.floor(this.rng() * 100000)}`,
            type: 'route', kind, routeKey: key, from, to,
            costMultiplier: 1.25, daysDelta: 1,
            createdDay: this.day, expiresDay: Math.min(this.maxDay, this.day + duration),
            title: `${CITIES[from].name}–${CITIES[to].name} 항로 혼잡`,
            description: `항만 적체로 운송비가 25% 오르고 이동 시간이 1일 늘어납니다.`
          }
        : {
            id: `route-${this.day}-${Math.floor(this.rng() * 100000)}`,
            type: 'route', kind, routeKey: key, from, to,
            costMultiplier: 0.88, daysDelta: -1,
            createdDay: this.day, expiresDay: Math.min(this.maxDay, this.day + duration),
            title: `${CITIES[from].name}–${CITIES[to].name} 순풍`,
            description: `항해 여건이 좋아 운송비가 12% 줄고 이동 시간이 최대 1일 단축됩니다.`
          };
      this.routeEvents = this.routeEvents.filter((row) => row.routeKey !== key || row.expiresDay < this.day);
      this.routeEvents.push(event);
      return event;
    }

    latestEvent() {
      if (!this.events.length) return null;
      return this.events[this.events.length - 1];
    }

    upgradeCargo() {
      this.ensureActive();
      const cost = this.cargoUpgradeCost();
      if (this.cash < cost) throw new Error('업그레이드 비용이 부족합니다.');
      this.cash -= cost;
      this.capacity += 5;
      this.cargoUpgradeLevel += 1;
      this.addLog(`화물칸 확장 · ${this.capacity}칸으로 증가`);
      return { cost, capacity: this.capacity };
    }

    cargoUpgradeCost() {
      return 8000 + this.cargoUpgradeLevel * 7000;
    }

    ensureActive() {
      if (this.gameOver) throw new Error('이번 거래 기간이 종료되었습니다. 새 게임을 시작하세요.');
    }

    addLog(text) {
      this.logs.unshift({ day: this.day, text });
      this.logs = this.logs.slice(0, 16);
    }

    money(value) {
      const n = Math.round(Number(value) || 0);
      return `₩${n.toLocaleString('ko-KR')}`;
    }
  }

  const api = { Game, PRODUCTS, CITIES, ROUTES, INTEL_LEVELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MerchantGlobeCore = api;
})(typeof window !== 'undefined' ? window : globalThis);

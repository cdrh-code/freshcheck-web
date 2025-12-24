/**
 * Auto-FreshCheck v6.0 (IoT Edition)
 * API Freshwater Master Test Kit
 * 7 Pumps (PCA9685 x2) + 7 Optical Sensors
 * + 웹 기반 색상 분석 (ColorAnalyzer)
 * + WiFi STA/AP + OTA + mDNS
 * 
 * v6.0 IoT 기능:
 * - WiFi STA 모드: 공유기 연결 (인터넷 접근)
 * - WiFi AP 모드: 설정용 핫스팟
 * - mDNS: http://freshcheck.local
 * - OTA: 무선 펌웨어 업데이트
 * 
 * v5.0 아키텍처 (유지):
 * - Master: 카메라 + WiFi + Vib(GPIO2) + LED(GPIO4)
 * - Slave: PCA9685 x2 + OLED + 광센서 7개 + 누수센서
 */

// =========================================================================
// 🎨 색상 분석 모듈 - API Freshwater Kit 전용
// =========================================================================

class ColorAnalyzer {
  constructor() {
    // ROI 설정 (이미지 중앙 영역)
    this.roiRatio = 0.25;  // 중앙 25%
    
    // 기준점 색상 (색종이 스티커용)
    this.referenceColor = { r: 255, g: 255, b: 255 };  // 기본: 흰색
    this.referenceCalibrated = false;
    
    // pH 색상 테이블 (6.0 - 7.6) - HSV 기준
    // API pH Test: 노란색(6.0) → 초록(7.0) → 파란색(7.6+)
    this.phTable = [
      { value: 6.0, h: 50,  s: 85, v: 95 },   // 밝은 노랑
      { value: 6.4, h: 60,  s: 75, v: 90 },   // 노랑
      { value: 6.8, h: 80,  s: 65, v: 85 },   // 연두
      { value: 7.0, h: 120, s: 55, v: 80 },   // 초록
      { value: 7.2, h: 150, s: 60, v: 75 },   // 청록
      { value: 7.4, h: 180, s: 65, v: 70 },   // 시안
      { value: 7.6, h: 210, s: 70, v: 65 },   // 파랑
      { value: 8.0, h: 230, s: 75, v: 60 },   // 진파랑
    ];
    
    // Ammonia 색상 테이블 (0 - 8 ppm)
    // API NH3 Test: 노랑(0) → 초록(0.5) → 청록(2) → 파랑(4+)
    this.nh3Table = [
      { value: 0,    h: 50,  s: 90, v: 95 },   // 밝은 노랑
      { value: 0.25, h: 70,  s: 80, v: 90 },   // 노랑-연두
      { value: 0.5,  h: 100, s: 65, v: 85 },   // 연두
      { value: 1.0,  h: 140, s: 55, v: 80 },   // 초록
      { value: 2.0,  h: 170, s: 60, v: 75 },   // 청록
      { value: 4.0,  h: 195, s: 70, v: 70 },   // 청색
      { value: 8.0,  h: 220, s: 75, v: 65 },   // 진청
    ];
    
    // Nitrite 색상 테이블 (0 - 5 ppm)
    // API NO2 Test: 하늘(0) → 연보라(0.25) → 보라(0.5) → 분홍(2) → 자홍(5)
    this.no2Table = [
      { value: 0,    h: 195, s: 25, v: 90 },   // 연하늘
      { value: 0.25, h: 250, s: 35, v: 85 },   // 연보라
      { value: 0.5,  h: 280, s: 45, v: 80 },   // 보라
      { value: 1.0,  h: 310, s: 55, v: 75 },   // 분홍
      { value: 2.0,  h: 330, s: 65, v: 70 },   // 자홍
      { value: 5.0,  h: 345, s: 75, v: 65 },   // 진분홍
    ];
    
    // 캔버스 (재사용)
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }
  
  /**
   * 이미지에서 색상 분석
   * @param {HTMLImageElement|string} imgOrUrl - 분석할 이미지 또는 URL
   * @param {string} testType - 'ph', 'nh3', 'no2'
   * @returns {Promise<Object>} { value, confidence, hsv, rgb, warnings }
   */
  async analyze(imgOrUrl, testType) {
    const img = await this.loadImage(imgOrUrl);
    
    // 캔버스 설정
    this.canvas.width = img.width;
    this.canvas.height = img.height;
    this.ctx.drawImage(img, 0, 0);
    
    // ROI 추출 (중앙 영역)
    const roiData = this.extractROI(img.width, img.height);
    
    // 평균 색상 계산
    const avgRGB = this.calculateAverageColor(roiData);
    
    // 기준점 보정 (색종이 스티커)
    const correctedRGB = this.applyReferenceCorrection(avgRGB);
    
    // HSV 변환
    const avgHSV = this.rgbToHsv(correctedRGB.r, correctedRGB.g, correctedRGB.b);
    
    // 테이블에서 값 보간
    const table = this.getTable(testType);
    const result = this.interpolateValue(avgHSV, table);
    
    // 경고 체크
    const warnings = this.checkWarnings(avgHSV, avgRGB, testType);
    
    return {
      value: result.value,
      confidence: result.confidence,
      hsv: avgHSV,
      rgb: correctedRGB,
      rawRgb: avgRGB,
      warnings
    };
  }
  
  /**
   * 이미지 로드 (URL 또는 Element)
   */
  loadImage(imgOrUrl) {
    return new Promise((resolve, reject) => {
      if (imgOrUrl instanceof HTMLImageElement && imgOrUrl.complete) {
        resolve(imgOrUrl);
        return;
      }
      
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = typeof imgOrUrl === 'string' ? imgOrUrl : imgOrUrl.src;
    });
  }
  
  /**
   * ROI 영역 픽셀 데이터 추출 (중앙)
   */
  extractROI(w, h) {
    const roiW = Math.floor(w * this.roiRatio);
    const roiH = Math.floor(h * this.roiRatio);
    const x = Math.floor((w - roiW) / 2);
    const y = Math.floor((h - roiH) / 2);
    
    return this.ctx.getImageData(x, y, roiW, roiH);
  }
  
  /**
   * 기준점(색종이) ROI 추출 (우측 하단)
   */
  extractReferenceROI(w, h) {
    const refSize = Math.floor(Math.min(w, h) * 0.1);
    const x = w - refSize - 10;
    const y = h - refSize - 10;
    
    return this.ctx.getImageData(x, y, refSize, refSize);
  }
  
  /**
   * 기준점 색상 캘리브레이션
   */
  async calibrateReference(imgOrUrl) {
    const img = await this.loadImage(imgOrUrl);
    
    this.canvas.width = img.width;
    this.canvas.height = img.height;
    this.ctx.drawImage(img, 0, 0);
    
    const refData = this.extractReferenceROI(img.width, img.height);
    this.referenceColor = this.calculateAverageColor(refData);
    this.referenceCalibrated = true;
    
    console.log('[ColorAnalyzer] Reference calibrated:', this.referenceColor);
    return this.referenceColor;
  }
  
  /**
   * 기준점 보정 적용
   */
  applyReferenceCorrection(rgb) {
    if (!this.referenceCalibrated) {
      return rgb;  // 보정 없이 원본 반환
    }
    
    // 흰색(255,255,255) 기준으로 보정 비율 계산
    const scaleR = 255 / Math.max(this.referenceColor.r, 1);
    const scaleG = 255 / Math.max(this.referenceColor.g, 1);
    const scaleB = 255 / Math.max(this.referenceColor.b, 1);
    
    return {
      r: Math.min(255, Math.round(rgb.r * scaleR)),
      g: Math.min(255, Math.round(rgb.g * scaleG)),
      b: Math.min(255, Math.round(rgb.b * scaleB))
    };
  }
  
  /**
   * 평균 RGB 계산 (노이즈 필터링 포함)
   */
  calculateAverageColor(imageData) {
    const data = imageData.data;
    const pixels = [];
    
    // 픽셀 수집
    for (let i = 0; i < data.length; i += 4) {
      pixels.push({
        r: data[i],
        g: data[i + 1],
        b: data[i + 2]
      });
    }
    
    // 극단값 제거 (상위/하위 10%)
    const sorted = pixels.slice().sort((a, b) => 
      (a.r + a.g + a.b) - (b.r + b.g + b.b)
    );
    
    const trimStart = Math.floor(sorted.length * 0.1);
    const trimEnd = Math.floor(sorted.length * 0.9);
    const trimmed = sorted.slice(trimStart, trimEnd);
    
    // 평균 계산
    let r = 0, g = 0, b = 0;
    for (const p of trimmed) {
      r += p.r;
      g += p.g;
      b += p.b;
    }
    
    const count = trimmed.length;
    return {
      r: Math.round(r / count),
      g: Math.round(g / count),
      b: Math.round(b / count)
    };
  }
  
  /**
   * RGB → HSV 변환
   */
  rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    
    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;
    
    if (max !== min) {
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h *= 60;
    }
    
    return {
      h: Math.round(h),
      s: Math.round(s * 100),
      v: Math.round(v * 100)
    };
  }
  
  /**
   * HSV 기반 값 보간
   */
  interpolateValue(hsv, table) {
    // 가장 가까운 두 색상 찾기
    let closestIdx = 0;
    let minDist = Infinity;
    
    for (let i = 0; i < table.length; i++) {
      const dist = this.colorDistance(hsv, table[i]);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = i;
      }
    }
    
    const closest = table[closestIdx];
    
    // 다음/이전 항목과 선형 보간
    let value = closest.value;
    
    if (closestIdx < table.length - 1) {
      const next = table[closestIdx + 1];
      const distToClosest = this.colorDistance(hsv, closest);
      const distToNext = this.colorDistance(hsv, next);
      const totalDist = distToClosest + distToNext;
      
      if (totalDist > 0) {
        const t = distToClosest / totalDist;
        value = closest.value + t * (next.value - closest.value);
      }
    } else if (closestIdx > 0) {
      const prev = table[closestIdx - 1];
      const distToClosest = this.colorDistance(hsv, closest);
      const distToPrev = this.colorDistance(hsv, prev);
      const totalDist = distToClosest + distToPrev;
      
      if (totalDist > 0) {
        const t = distToClosest / totalDist;
        value = closest.value - t * (closest.value - prev.value);
      }
    }
    
    // 신뢰도 계산 (거리 기반)
    const maxDist = 100;  // 최대 허용 거리
    const confidence = Math.max(0, Math.round((1 - minDist / maxDist) * 100));
    
    return { 
      value: Math.round(value * 100) / 100, 
      confidence 
    };
  }
  
  /**
   * HSV 색상 거리 계산
   */
  colorDistance(hsv1, hsv2) {
    // Hue 거리 (원형)
    const hDiff = Math.min(
      Math.abs(hsv1.h - hsv2.h),
      360 - Math.abs(hsv1.h - hsv2.h)
    );
    
    // S, V 거리
    const sDiff = Math.abs(hsv1.s - hsv2.s);
    const vDiff = Math.abs(hsv1.v - hsv2.v);
    
    // 가중 거리 (Hue가 가장 중요)
    return (hDiff * 0.6) + (sDiff * 0.25) + (vDiff * 0.15);
  }
  
  /**
   * 경고 체크
   */
  checkWarnings(hsv, rgb, testType) {
    const warnings = [];
    
    // 채도 너무 낮음 (흐릿한 색)
    if (hsv.s < 20) {
      warnings.push('낮은 채도 - 시약 부족 또는 희석 확인');
    }
    
    // 밝기 너무 낮음 (어두움)
    if (hsv.v < 30) {
      warnings.push('낮은 밝기 - 조명 확인');
    }
    
    // 밝기 너무 높음 (과노출)
    if (hsv.v > 95 && hsv.s < 15) {
      warnings.push('과노출 - 조명 줄이기');
    }
    
    // 기준점 미보정
    if (!this.referenceCalibrated) {
      warnings.push('기준점 미보정 - 정확도 저하 가능');
    }
    
    return warnings;
  }
  
  /**
   * 테이블 선택
   */
  getTable(type) {
    switch (type) {
      case 'ph': return this.phTable;
      case 'nh3': return this.nh3Table;
      case 'no2': return this.no2Table;
      default: return this.phTable;
    }
  }
  
  /**
   * RGB → CSS 색상 문자열
   */
  rgbToString(rgb) {
    return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  }
  
  /**
   * 테스트 결과 해석
   */
  interpret(testType, value) {
    switch (testType) {
      case 'ph':
        if (value < 6.5) return { status: 'danger', text: '산성 (위험)' };
        if (value < 6.8) return { status: 'warning', text: '약산성 (주의)' };
        if (value <= 7.4) return { status: 'ok', text: '정상' };
        if (value <= 7.6) return { status: 'warning', text: '약알칼리 (주의)' };
        return { status: 'danger', text: '알칼리 (위험)' };
        
      case 'nh3':
        if (value === 0) return { status: 'ok', text: '안전' };
        if (value <= 0.25) return { status: 'ok', text: '안전' };
        if (value <= 0.5) return { status: 'warning', text: '주의' };
        if (value <= 1.0) return { status: 'warning', text: '스트레스' };
        return { status: 'danger', text: '위험! 즉시 물갈이' };
        
      case 'no2':
        if (value === 0) return { status: 'ok', text: '안전' };
        if (value <= 0.25) return { status: 'ok', text: '안전' };
        if (value <= 0.5) return { status: 'warning', text: '주의' };
        if (value <= 1.0) return { status: 'warning', text: '스트레스' };
        return { status: 'danger', text: '위험! 즉시 물갈이' };
        
      default:
        return { status: 'unknown', text: '알 수 없음' };
    }
  }
}

// =========================================================================
// 🐟 메인 애플리케이션
// =========================================================================

class AutoFreshCheck {
  constructor() {
    // v6.0: 자동 API URL 탐지
    // 1. localStorage에 저장된 URL
    // 2. mDNS (freshcheck.local)
    // 3. AP 모드 기본값 (192.168.4.1)
    this.apiUrl = localStorage.getItem('apiUrl') || '';
    this.pollInterval = null;
    this.connected = false;
    this.currentTab = 'measure';
    this.primeMode = 'smart';  // 'smart' or 'blind'
    
    // 시스템 정보 (v6.0)
    this.systemInfo = null;
    this.wifiMode = 'unknown';
    
    // 🎨 색상 분석기
    this.colorAnalyzer = new ColorAnalyzer();
    this.lastAnalysis = null;
    
    this.init();
  }

  async init() {
    this.bindEvents();
    this.loadSettings();
    
    // v6.0: 자동 API URL 탐지
    if (!this.apiUrl) {
      this.showMessage('장치 연결 중...', 'info');
      await this.autoDetectDevice();
    }
    
    this.startPolling();
    this.updateApiUrlDisplay();
    
    // v6.0: 시스템 정보 로드
    this.loadSystemInfo();
  }
  
  // v6.0: 자동 장치 탐지
  async autoDetectDevice() {
    const candidates = [
      'http://freshcheck.local',       // mDNS (STA 모드)
      'http://192.168.4.1',            // AP 모드 기본값
      window.location.origin,          // 같은 서버
    ];
    
    for (const url of candidates) {
      try {
        console.log(`[AutoDetect] Trying ${url}...`);
        const response = await fetch(`${url}/api/status`, { 
          method: 'GET',
          mode: 'cors',
          signal: AbortSignal.timeout(3000)  // 3초 타임아웃
        });
        
        if (response.ok) {
          this.apiUrl = url;
          localStorage.setItem('apiUrl', url);
          console.log(`[AutoDetect] ✓ Found device at ${url}`);
          this.showMessage(`장치 연결됨: ${url}`, 'success');
          return;
        }
      } catch (e) {
        console.log(`[AutoDetect] ✗ ${url} failed`);
      }
    }
    
    // 탐지 실패 시 AP 모드 기본값 사용
    this.apiUrl = 'http://192.168.4.1';
    this.showMessage('장치를 찾을 수 없음. AP 모드(192.168.4.1)로 시도합니다.', 'warning');
  }
  
  // v6.0: 시스템 정보 로드
  async loadSystemInfo() {
    try {
      const [system, wifi] = await Promise.all([
        this.api('/system'),
        this.api('/wifi')
      ]);
      
      this.systemInfo = system;
      this.wifiMode = wifi.mode;
      
      // 푸터에 시스템 정보 표시
      const footer = document.querySelector('.footer-info');
      if (footer) {
        footer.innerHTML = `v${system.version} | ${wifi.mode} | ${wifi.ip || wifi.ap_ip}`;
      }
    } catch (e) {
      console.warn('[SystemInfo] Failed to load:', e);
    }
  }

  // ========== API Communication ==========
  
  async api(endpoint, method = 'GET', body = null) {
    const url = `${this.apiUrl}/api${endpoint}`;
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
      mode: 'cors'
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      }
      return response;
    } catch (error) {
      console.error(`API Error [${endpoint}]:`, error);
      throw error;
    }
  }

  // ========== Polling ==========
  
  startPolling() {
    this.poll();
    this.pollInterval = setInterval(() => this.poll(), 2000);
  }

  async poll() {
    try {
      const status = await this.api('/status');
      this.updateStatus(status);
      this.setConnected(true);
    } catch (error) {
      this.setConnected(false);
    }
  }

  setConnected(connected) {
    this.connected = connected;
    const el = document.getElementById('connection-status');
    el.className = 'connection-status ' + (connected ? 'connected' : 'error');
    el.querySelector('.status-text').textContent = connected ? '연결됨' : '연결 끊김';
  }

  // ========== Status Updates ==========
  
  updateStatus(data) {
    // 상태
    document.getElementById('current-state').textContent = data.state;
    
    // 채널
    const channelEl = document.getElementById('current-channel');
    if (data.channel > 0) {
      const names = ['', 'pH', 'NH3#1', 'NH3#2', 'NO2'];
      channelEl.textContent = `채널 ${data.channel} (${names[data.channel]})`;
    } else {
      channelEl.textContent = '';
    }
    
    // 타이머
    const timerCard = document.getElementById('timer-card');
    if (data.state === 'MIXING' && data.remaining > 0) {
      timerCard.style.display = 'block';
      const min = Math.floor(data.remaining / 60);
      const sec = data.remaining % 60;
      document.getElementById('timer-value').textContent = 
        `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    } else {
      timerCard.style.display = 'none';
    }
    
    // 측정값 (담수용: pH, NH3, NO2)
    if (data.ph > 0) document.getElementById('val-ph').textContent = data.ph.toFixed(1);
    if (data.nh3 >= 0) document.getElementById('val-nh3').textContent = data.nh3.toFixed(2);
    if (data.no2 >= 0) document.getElementById('val-no2').textContent = data.no2.toFixed(2);
    // NO3는 Phase2 (확장 예정)
    if (data.no3 >= 0) document.getElementById('val-no3').textContent = data.no3.toFixed(1);
    
    // 버튼 상태 (바쁜 상태면 비활성화)
    const busy = !['IDLE', 'READY', 'ERROR'].includes(data.state);
    document.querySelectorAll('.measure-btn, .prime-btn').forEach(btn => {
      btn.disabled = busy;
      btn.style.opacity = busy ? 0.5 : 1;
    });
  }

  // ========== Actions ==========
  
  async measure(channel) {
    try {
      this.showLoading();
      await this.api('/measure', 'POST', { channel });
      this.showMessage(`채널 ${channel} 측정 시작`);
    } catch (error) {
      this.showMessage('측정 시작 실패', 'error');
    } finally {
      this.hideLoading();
    }
  }

  async measureAll() {
    this.showMessage('전체 측정 기능은 준비 중입니다');
  }

  async prime(pump) {
    try {
      this.showLoading();
      
      // 모드에 따라 다른 API 호출
      const endpoint = this.primeMode === 'smart' ? '/sprime' : '/prime';
      const response = await this.api(endpoint, 'POST', { pump });
      
      if (response.error === 'empty_bottle') {
        this.showMessage(`펌프 ${pump}: 시약 고갈! 보충 필요`, 'error');
      } else if (response.type === 'fallback') {
        this.showMessage(`펌프 ${pump}: 광센서 미보정 → 블라인드 모드`, 'warning');
      } else {
        const modeText = this.primeMode === 'smart' ? '스마트' : '블라인드';
        this.showMessage(`펌프 ${pump} ${modeText} 프라이밍 완료`);
      }
      
      // 통계 업데이트
      setTimeout(() => this.updateStats(), 5000);
    } catch (error) {
      this.showMessage('프라이밍 실패', 'error');
    } finally {
      this.hideLoading();
    }
  }

  async primeAll() {
    const modeText = this.primeMode === 'smart' ? '스마트' : '블라인드';
    this.showMessage(`전체 ${modeText} 프라이밍: 순차 실행`);
    for (let i = 1; i <= 4; i++) {
      await this.prime(i);
      await this.delay(this.primeMode === 'smart' ? 15000 : 35000);
    }
  }

  // ========== 🔬 Optical Sensor ==========
  
  async fetchOpticalStatus() {
    try {
      const data = await this.api('/optical');
      
      if (data.sensors && data.sensors.length === 4) {
        data.sensors.forEach((value, idx) => {
          const el = document.getElementById(`opt-${idx + 1}`);
          if (el) {
            el.textContent = value;
            // 임계값 2250 기준으로 색상 표시
            el.className = 'optical-value ' + (value < 2250 ? 'liquid' : 'air');
          }
        });
      }
    } catch (error) {
      console.error('Optical fetch failed:', error);
    }
  }

  setPrimeMode(mode) {
    this.primeMode = mode;
    
    // 버튼 상태 업데이트
    document.getElementById('mode-smart').classList.toggle('active', mode === 'smart');
    document.getElementById('mode-blind').classList.toggle('active', mode === 'blind');
    
    // 설명 업데이트
    const desc = document.getElementById('mode-description');
    if (mode === 'smart') {
      desc.textContent = '광센서로 액체 감지 시 자동 정지 (시약 절약!)';
    } else {
      desc.textContent = '튜브 부피만큼 무조건 배출 (광센서 미사용)';
    }
  }

  async pumpControl(type, options = {}) {
    try {
      const body = { type };
      Object.assign(body, options);
      await this.api('/pump', 'POST', body);
      this.showMessage(`${type} 실행 완료`);
    } catch (error) {
      this.showMessage(`${type} 실패`, 'error');
    }
  }

  async emergencyStop() {
    try {
      await this.api('/stop', 'POST');
      this.showMessage('긴급 정지 실행됨', 'warning');
    } catch (error) {
      this.showMessage('정지 명령 전송 실패', 'error');
    }
  }

  async capture() {
    try {
      const img = document.getElementById('camera-img');
      const url = `${this.apiUrl}/api/capture?t=${Date.now()}`;
      
      img.onload = () => {
        this.showMessage('촬영 완료');
        // 분석 버튼 활성화
        const analyzeBtn = document.getElementById('btn-analyze');
        if (analyzeBtn) analyzeBtn.disabled = false;
      };
      
      img.src = url;
    } catch (error) {
      this.showMessage('촬영 실패', 'error');
    }
  }
  
  /**
   * 🎨 촬영 이미지 색상 분석
   */
  async analyzeColor(testType) {
    try {
      this.showLoading();
      
      const img = document.getElementById('camera-img');
      if (!img.src || img.src === '') {
        this.showMessage('먼저 이미지를 촬영하세요', 'warning');
        return null;
      }
      
      // 색상 분석 실행
      const result = await this.colorAnalyzer.analyze(img, testType);
      this.lastAnalysis = result;
      
      // 결과 해석
      const interpretation = this.colorAnalyzer.interpret(testType, result.value);
      
      // UI 업데이트
      this.displayAnalysisResult(testType, result, interpretation);
      
      // 경고 표시
      if (result.warnings.length > 0) {
        result.warnings.forEach(w => this.showMessage(w, 'warning'));
      }
      
      return result;
    } catch (error) {
      console.error('Color analysis error:', error);
      this.showMessage('색상 분석 실패', 'error');
      return null;
    } finally {
      this.hideLoading();
    }
  }
  
  /**
   * 분석 결과 UI 표시
   */
  displayAnalysisResult(testType, result, interpretation) {
    // 측정값 업데이트
    const valueMap = {
      'ph': 'val-ph',
      'nh3': 'val-nh3',
      'no2': 'val-no2'
    };
    
    const elId = valueMap[testType];
    if (elId) {
      const el = document.getElementById(elId);
      if (el) {
        el.textContent = result.value.toFixed(testType === 'ph' ? 1 : 2);
        
        // 상태에 따른 색상
        el.className = 'measurement-value ' + interpretation.status;
      }
    }
    
    // 분석 패널 업데이트
    const analysisPanel = document.getElementById('analysis-result');
    if (analysisPanel) {
      const testNames = { ph: 'pH', nh3: '암모니아', no2: '아질산' };
      
      analysisPanel.innerHTML = `
        <div class="analysis-header">
          <h4>${testNames[testType]} 분석 결과</h4>
          <span class="analysis-confidence">신뢰도 ${result.confidence}%</span>
        </div>
        <div class="analysis-value ${interpretation.status}">
          <span class="value">${result.value.toFixed(testType === 'ph' ? 1 : 2)}</span>
          <span class="unit">${testType === 'ph' ? '' : 'ppm'}</span>
        </div>
        <div class="analysis-status ${interpretation.status}">
          ${interpretation.text}
        </div>
        <div class="analysis-color">
          <span class="color-swatch" style="background: ${this.colorAnalyzer.rgbToString(result.rgb)}"></span>
          <span class="color-info">RGB(${result.rgb.r}, ${result.rgb.g}, ${result.rgb.b})</span>
          <span class="color-info">HSV(${result.hsv.h}°, ${result.hsv.s}%, ${result.hsv.v}%)</span>
        </div>
      `;
      analysisPanel.style.display = 'block';
    }
    
    this.showMessage(`${testType.toUpperCase()}: ${result.value} - ${interpretation.text}`);
  }
  
  /**
   * 기준점(색종이) 캘리브레이션
   */
  async calibrateReference() {
    try {
      const img = document.getElementById('camera-img');
      if (!img.src || img.src === '') {
        this.showMessage('먼저 이미지를 촬영하세요', 'warning');
        return;
      }
      
      await this.colorAnalyzer.calibrateReference(img);
      this.showMessage('기준점 보정 완료');
    } catch (error) {
      this.showMessage('기준점 보정 실패', 'error');
    }
  }

  async updateStats() {
    try {
      const stats = await this.api('/stats');
      document.getElementById('stat-dispenses').textContent = stats.totalDispenses || 0;
      document.getElementById('stat-success').textContent = stats.successfulMeasures || 0;
    } catch (error) {
      console.error('Stats update failed:', error);
    }
  }

  async loadHistory() {
    try {
      const history = await this.api('/history');
      const list = document.getElementById('history-list');
      
      if (history.length === 0) {
        list.innerHTML = '<div class="history-empty">기록 없음</div>';
        return;
      }
      
      list.innerHTML = history.map(item => `
        <div class="history-item">
          <span class="history-time">${this.formatTime(item.timestamp)}</span>
          <div class="history-values">
            <span>pH ${item.ph ? item.ph.toFixed(1) : '--'}</span>
            <span>NH3 ${item.nh3 ? item.nh3.toFixed(2) : '--'}</span>
            <span>NO2 ${item.no2 ? item.no2.toFixed(2) : '--'}</span>
            <span class="phase2">NO3 ${item.no3 ? item.no3.toFixed(1) : '⏳'}</span>
          </div>
        </div>
      `).join('');
    } catch (error) {
      console.error('History load failed:', error);
    }
  }

  // ========== Settings ==========
  
  loadSettings() {
    const apiUrl = localStorage.getItem('apiUrl');
    if (apiUrl) {
      this.apiUrl = apiUrl;
      document.getElementById('set-api-url').value = apiUrl;
    }
    
    this.loadServerConfig();
  }

  async loadServerConfig() {
    try {
      const config = await this.api('/calibration');
      
      document.getElementById('set-mix-time').value = Math.floor(config.mixingTime / 1000);
      document.getElementById('set-sample-time').value = config.samplePumpTime;
      document.getElementById('set-auto-prime').checked = config.autoPrimeOnStart;
      
      if (config.reagentSteps) {
        config.reagentSteps.forEach((steps, i) => {
          const el = document.getElementById(`set-steps-${i + 1}`);
          if (el) el.value = steps;
        });
      }
    } catch (error) {
      console.error('Config load failed:', error);
    }
  }

  async saveSettings() {
    try {
      const apiUrl = document.getElementById('set-api-url').value;
      localStorage.setItem('apiUrl', apiUrl);
      this.apiUrl = apiUrl;
      
      const config = {
        mixingTime: parseInt(document.getElementById('set-mix-time').value) * 1000,
        sampleTime: parseInt(document.getElementById('set-sample-time').value),
        autoPrime: document.getElementById('set-auto-prime').checked
      };
      
      await this.api('/calibration', 'POST', config);
      this.showMessage('설정 저장 완료');
    } catch (error) {
      this.showMessage('설정 저장 실패', 'error');
    }
  }

  updateApiUrlDisplay() {
    document.getElementById('set-api-url').value = this.apiUrl;
  }

  // ========== Event Binding ==========
  
  bindEvents() {
    // 탭 전환
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
    });
    
    // 측정 버튼
    document.querySelectorAll('.measure-btn').forEach(btn => {
      btn.addEventListener('click', () => this.measure(parseInt(btn.dataset.channel)));
    });
    document.getElementById('btn-measure-all').addEventListener('click', () => this.measureAll());
    
    // 프라이밍 버튼
    document.querySelectorAll('.prime-btn').forEach(btn => {
      btn.addEventListener('click', () => this.prime(parseInt(btn.dataset.pump)));
    });
    document.getElementById('btn-prime-all').addEventListener('click', () => this.primeAll());
    
    // 🔬 프라이밍 모드 토글
    document.getElementById('mode-smart').addEventListener('click', () => this.setPrimeMode('smart'));
    document.getElementById('mode-blind').addEventListener('click', () => this.setPrimeMode('blind'));
    
    // 🔬 광센서 새로고침
    document.getElementById('btn-refresh-optical').addEventListener('click', () => this.fetchOpticalStatus());
    
    // 수동 제어
    document.getElementById('btn-sample').addEventListener('click', () => {
      this.pumpControl('sample');
    });
    document.getElementById('btn-waste').addEventListener('click', () => {
      this.pumpControl('waste');
    });
    document.getElementById('btn-reagent-fwd').addEventListener('click', () => {
      const pump = document.getElementById('reagent-pump').value;
      const steps = document.getElementById('reagent-steps').value;
      this.pumpControl('reagent', { id: parseInt(pump), steps: parseInt(steps) });
    });
    document.getElementById('btn-reagent-rev').addEventListener('click', () => {
      const pump = document.getElementById('reagent-pump').value;
      const steps = document.getElementById('reagent-steps').value;
      this.pumpControl('reagent', { id: parseInt(pump), steps: -parseInt(steps) });
    });
    
    // 토글 버튼
    document.getElementById('btn-mixer').addEventListener('click', (e) => {
      const btn = e.target;
      const isActive = btn.classList.toggle('active');
      btn.textContent = isActive ? '교반 모터 ON' : '교반 모터 OFF';
      this.pumpControl('mixer', { on: isActive });
    });
    document.getElementById('btn-led').addEventListener('click', (e) => {
      const btn = e.target;
      const isActive = btn.classList.toggle('active');
      btn.textContent = isActive ? 'LED ON' : 'LED OFF';
      this.pumpControl('led', { on: isActive });
    });
    
    // 카메라
    document.getElementById('btn-capture').addEventListener('click', () => this.capture());
    
    // 🎨 색상 분석
    document.getElementById('btn-analyze')?.addEventListener('click', () => {
      const testSelect = document.getElementById('analyze-test-type');
      const testType = testSelect ? testSelect.value : 'ph';
      this.analyzeColor(testType);
    });
    
    document.getElementById('btn-calibrate-ref')?.addEventListener('click', () => {
      this.calibrateReference();
    });
    
    // 긴급 정지
    document.getElementById('btn-emergency').addEventListener('click', () => this.emergencyStop());
    
    // 설정 저장
    document.getElementById('btn-save-settings').addEventListener('click', () => this.saveSettings());
  }

  switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `tab-${tabId}`);
    });
    
    this.currentTab = tabId;
    
    if (tabId === 'priming') {
      this.updateStats();
      this.fetchOpticalStatus();  // 🔬 광센서 상태 조회
    }
  }

  // ========== Utilities ==========
  
  showMessage(text, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${text}`);
    
    const el = document.createElement('div');
    el.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      padding: 12px 24px;
      background: ${type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#22c55e'};
      color: white;
      border-radius: 8px;
      font-size: 14px;
      z-index: 1000;
      animation: fadeIn 0.3s ease;
    `;
    el.textContent = text;
    document.body.appendChild(el);
    
    setTimeout(() => el.remove(), 3000);
  }

  showLoading() {
    document.body.classList.add('loading');
  }

  hideLoading() {
    document.body.classList.remove('loading');
  }

  formatTime(timestamp) {
    if (!timestamp || timestamp < 1000000) {
      return '--:--';
    }
    const now = Date.now();
    const elapsed = now - timestamp;
    
    if (elapsed < 60000) {
      return '방금 전';
    } else if (elapsed < 3600000) {
      return `${Math.floor(elapsed / 60000)}분 전`;
    } else {
      return `${Math.floor(elapsed / 3600000)}시간 전`;
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ========== Initialize ==========
document.addEventListener('DOMContentLoaded', () => {
  window.app = new AutoFreshCheck();
  
  setTimeout(() => window.app.loadHistory(), 1000);
  setTimeout(() => window.app.updateStats(), 2000);
});

// ========== CSS Animation ==========
const style = document.createElement('style');
style.textContent = `
  @keyframes fadeIn {
    from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
`;
document.head.appendChild(style);

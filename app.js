(function () {
  'use strict';

  const DATA_URL = './national_university.json';
  const MODE_VALUES = ['bar', 'scatter', 'line'];
  const LINE_TOTAL_VALUE = '合計';
  const BAR_LIMIT_VALUES = ['all', '10', '20', '50'];
  const BAR_RANK_VALUES = ['value', 'diffUp', 'diffDown', 'rateUp', 'rateDown'];
  const METRIC_CATEGORY_ORDER = ['基本', '職員', '蔵書', '受入', '雑誌', '利用', '相互協力', '経費', 'その他'];
  const CHART_COLORS = [
    '#4A90E2',
    '#D94F70',
    '#28A17A',
    '#F2A93B',
    '#6F63D9',
    '#8A6A45',
    '#3D8D99',
    '#C95C2E',
    '#607D3B',
    '#A24B8F'
  ];

  let chart = null;
  let chartMode = 'bar';
  let years = [];
  let materials = [];
  let universities = [];
  let metrics = {};
  let controlsDiv = null;
  let suppressUrlUpdate = true;
  let universityPickerConfigs = {};
  let shareStatusTimer = null;
  let suppressEmbeddedChartText = false;

  const footerPlugin = {
    id: 'footerPlugin',
    afterDraw: chartInstance => {
      if (suppressEmbeddedChartText) return;

      const ctx = chartInstance.ctx;
      const area = chartInstance.chartArea;
      if (!area) return;

      const text = getSourceText();
      ctx.save();
      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#666';
      const width = ctx.measureText(text).width;
      const x = Math.max(area.left, chartInstance.width - width - 16);
      ctx.fillText(text, x, chartInstance.height - 10);
      ctx.restore();
    }
  };

  const quadrantPlugin = {
    id: 'quadrantPlugin',
    beforeDatasetsDraw: chartInstance => {
      const options = chartInstance.options.plugins?.quadrant;
      if (!options?.enabled) return;

      const area = chartInstance.chartArea;
      const xScale = chartInstance.scales.x;
      const yScale = chartInstance.scales.y;
      if (!area || !xScale || !yScale) return;
      if (!Number.isFinite(options.xMedian) || !Number.isFinite(options.yMedian)) return;

      const x = xScale.getPixelForValue(options.xMedian);
      const y = yScale.getPixelForValue(options.yMedian);
      const ctx = chartInstance.ctx;

      ctx.save();
      ctx.strokeStyle = 'rgba(80, 80, 80, 0.48)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 5]);
      if (x >= area.left && x <= area.right) {
        ctx.beginPath();
        ctx.moveTo(x, area.top);
        ctx.lineTo(x, area.bottom);
        ctx.stroke();
      }
      if (y >= area.top && y <= area.bottom) {
        ctx.beginPath();
        ctx.moveTo(area.left, y);
        ctx.lineTo(area.right, y);
        ctx.stroke();
      }
      ctx.restore();
    },
    afterDraw: chartInstance => {
      const options = chartInstance.options.plugins?.quadrant;
      if (!options?.enabled) return;

      const area = chartInstance.chartArea;
      if (!area) return;

      const ctx = chartInstance.ctx;
      const labels = options.labels || {};
      const positions = [
        { text: labels.topLeft, x: area.left + 10, y: area.top + 20, align: 'left' },
        { text: labels.topRight, x: area.right - 10, y: area.top + 20, align: 'right' },
        { text: labels.bottomLeft, x: area.left + 10, y: area.bottom - 10, align: 'left' },
        { text: labels.bottomRight, x: area.right - 10, y: area.bottom - 10, align: 'right' }
      ];

      ctx.save();
      ctx.font = 'bold 12px sans-serif';
      ctx.textBaseline = 'middle';
      positions.forEach(position => {
        if (!position.text) return;

        const metrics = ctx.measureText(position.text);
        const paddingX = 6;
        const paddingY = 4;
        const width = metrics.width + paddingX * 2;
        const height = 20;
        const boxX = position.align === 'right' ? position.x - width : position.x;
        const boxY = position.y - height / 2;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
        ctx.fillRect(boxX, boxY, width, height);
        ctx.strokeStyle = 'rgba(80, 80, 80, 0.18)';
        ctx.strokeRect(boxX, boxY, width, height);
        ctx.fillStyle = 'rgba(60, 60, 60, 0.9)';
        ctx.textAlign = position.align;
        ctx.fillText(position.text, position.x + (position.align === 'right' ? -paddingX : paddingX), position.y);
      });
      ctx.restore();
    }
  };

  function ready(fn) {
    if (document.readyState !== 'loading') {
      fn();
      return;
    }
    document.addEventListener('DOMContentLoaded', fn);
  }

  ready(() => {
    controlsDiv = document.getElementById('controls');

    if (typeof Chart === 'undefined') {
      showDataError(new Error('Chart.jsを読み込めませんでした。ネットワーク接続またはCDNの読み込み設定を確認してください。'));
      return;
    }

    showLoading();
    fetch(DATA_URL)
      .then(response => {
        if (!response.ok) {
          throw new Error(`データファイルを取得できませんでした（HTTP ${response.status}）。`);
        }
        return response.json();
      })
      .then(rawData => {
        const urlState = parseUrlState();
        prepareData(rawData);
        setupModeSwitchListeners();
        switchMode(urlState.mode, urlState);
        suppressUrlUpdate = false;
        updateUrlFromControls();
      })
      .catch(showDataError);
  });

  function showLoading() {
    controlsDiv.innerHTML = '<p class="status-message">データを読み込んでいます。</p>';
  }

  function showDataError(error) {
    if (!controlsDiv) return;
    const localFileHint = window.location.protocol === 'file:'
      ? ' ローカルで確認する場合は、HTMLファイルを直接開くのではなく、HTTPサーバー経由で開いてください。GitHub Pagesではそのまま動作します。'
      : '';
    controlsDiv.innerHTML = `<p class="status-message error">${escapeHtml((error.message || 'データの読み込みに失敗しました。') + localFileHint)}</p>`;
  }

  function prepareData(rawData) {
    const labels = Array.isArray(rawData.labels) ? rawData.labels.map(String) : [];
    const labelIndexByYear = new Map(labels.map((label, index) => [label, index]));

    years = labels.slice().sort((a, b) => Number(a) - Number(b));
    materials = Array.isArray(rawData.materials) ? rawData.materials.slice() : Object.keys(rawData.data || {});
    universities = Array.isArray(rawData.universities) ? rawData.universities.slice() : [];
    metrics = {};

    materials.forEach(key => {
      metrics[key] = {};
      universities.forEach(university => {
        const series = rawData.data?.[key]?.[university] || [];
        metrics[key][university] = years.map(year => {
          const index = labelIndexByYear.get(year);
          return index === undefined ? null : series[index];
        });
      });
    });
  }

  function parseUrlState() {
    const params = new URLSearchParams(window.location.search);
    const mode = MODE_VALUES.includes(params.get('mode')) ? params.get('mode') : 'bar';
    const lineUniversities = splitParamList(params.get('unis') || params.get('lineUnis'));

    return {
      mode,
      year: params.get('year') || '',
      metric: params.get('metric') || '',
      x: params.get('x') || '',
      y: params.get('y') || '',
      highlight: params.get('highlight') || '',
      showReg: params.get('reg') === '1',
      showMedian: params.get('median') !== '0',
      xMax: params.get('xMax') || '',
      yMax: params.get('yMax') || '',
      top: BAR_LIMIT_VALUES.includes(params.get('top')) ? params.get('top') : 'all',
      rank: normalizeBarRankParam(params.get('rank')),
      lineUniversities
    };
  }

  function splitParamList(value) {
    if (!value) return [];
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }

  function normalizeBarRankParam(value) {
    if (value === 'diff') return 'diffUp';
    if (value === 'rate') return 'rateUp';
    return BAR_RANK_VALUES.includes(value) ? value : 'value';
  }

  function setupModeSwitchListeners() {
    document.querySelectorAll('#modeSwitch input[name="mode"]').forEach(input => {
      input.onchange = () => {
        if (input.checked) switchMode(input.value);
      };
    });
  }

  function setModeActive() {
    document.querySelectorAll('#modeSwitch label').forEach(label => {
      label.classList.remove('active');
    });

    const activeInput = document.querySelector(`#modeSwitch input[value="${chartMode}"]`);
    if (activeInput) activeInput.parentElement.classList.add('active');
  }

  function renderControls(mode) {
    controlsDiv.innerHTML = '';

    if (mode === 'bar') {
      controlsDiv.innerHTML = `
        <div class="control-layout control-layout-bar">
          <section class="control-panel control-panel-primary">
            <h2 class="control-panel-title">表示条件</h2>
            <div class="control-field">
              <label for="barMetric">項目</label>
              <select id="barMetric" class="metric-select"></select>
            </div>
            <div class="control-row">
              <div class="control-field">
                <label for="barRank">表示内容</label>
                <select id="barRank">
                  <option value="value">値</option>
                  <option value="diffUp">前年差（増加）</option>
                  <option value="diffDown">前年差（減少）</option>
                  <option value="rateUp">増減率（増加）</option>
                  <option value="rateDown">増減率（減少）</option>
                </select>
              </div>
              <div class="control-field">
                <label for="barLimit">表示範囲</label>
                <select id="barLimit">
                  <option value="all">全件</option>
                  <option value="10">上位10件</option>
                  <option value="20">上位20件</option>
                  <option value="50">上位50件</option>
                </select>
              </div>
            </div>
            <div class="control-field year-field bar-year-field">
              <label for="yearSlider">年</label>
              <div class="year-control">
                <input id="yearSlider" type="range">
                <span id="yearLabel"></span>
              </div>
            </div>
          </section>
          <section class="control-panel control-panel-secondary">
            <h2 class="control-panel-title">大学</h2>
            <input type="hidden" id="barUniSelect" value="">
            <input id="barUniSearch" class="university-search" type="search" placeholder="大学名を検索">
            <div id="barUniList" class="university-checklist"></div>
            <div id="barUniSummary" class="selection-summary"></div>
          </section>
          <section class="control-panel control-actions-panel control-panel-output">
            <h2 class="control-panel-title">出力</h2>
            <div class="control-actions">
              <button type="button" id="shareUrl" class="secondary-button">URL共有</button>
              <button type="button" id="savePng">PNG保存</button>
            </div>
            <p id="shareUrlStatus" class="share-status" role="status" aria-live="polite"></p>
          </section>
        </div>
      `;
      return;
    }

    if (mode === 'scatter') {
      controlsDiv.innerHTML = `
        <div class="control-layout control-layout-scatter">
          <section class="control-panel control-panel-primary">
            <h2 class="control-panel-title">軸</h2>
            <div class="control-field">
              <label for="xSelect">X軸</label>
              <select id="xSelect" class="metric-select"></select>
            </div>
            <div class="control-field">
              <label for="ySelect">Y軸</label>
              <select id="ySelect" class="metric-select"></select>
            </div>
            <div class="control-row">
              <div class="control-field">
                <label for="xMax">X最大値</label>
                <input id="xMax" type="number" placeholder="自動">
              </div>
              <div class="control-field">
                <label for="yMax">Y最大値</label>
                <input id="yMax" type="number" placeholder="自動">
              </div>
            </div>
          </section>
          <section class="control-panel control-panel-compact">
            <h2 class="control-panel-title">表示</h2>
            <div class="control-field year-field">
              <label for="yearSlider">年</label>
              <div class="year-control">
                <input id="yearSlider" type="range">
                <span id="yearLabel"></span>
              </div>
            </div>
            <label class="inline-checkbox" for="showReg"><input id="showReg" type="checkbox"> 回帰直線</label>
            <label class="inline-checkbox" for="showMedian"><input id="showMedian" type="checkbox"> 中央値ライン</label>
            <div id="corrDisplay">相関係数: N/A</div>
          </section>
          <section class="control-panel control-panel-secondary">
            <h2 class="control-panel-title">大学</h2>
            <input type="hidden" id="uniSelect" value="">
            <input id="uniSearch" class="university-search" type="search" placeholder="大学名を検索">
            <div id="uniList" class="university-checklist"></div>
            <div id="uniSummary" class="selection-summary"></div>
          </section>
          <section class="control-panel control-actions-panel control-panel-output">
            <h2 class="control-panel-title">出力</h2>
            <div class="control-actions">
              <button type="button" id="resetZoom">リセット</button>
              <button type="button" id="shareUrl" class="secondary-button">URL共有</button>
              <button type="button" id="savePng">PNG保存</button>
            </div>
            <p id="shareUrlStatus" class="share-status" role="status" aria-live="polite"></p>
          </section>
        </div>
      `;
      return;
    }

    if (mode === 'line') {
      controlsDiv.innerHTML = `
        <div class="control-layout control-layout-line">
          <section class="control-panel control-panel-primary">
            <h2 class="control-panel-title">表示条件</h2>
            <div class="control-field">
              <label for="lineMetric">項目</label>
              <select id="lineMetric" class="metric-select"></select>
            </div>
          </section>
          <section class="control-panel control-panel-secondary">
            <h2 class="control-panel-title">大学</h2>
            <input type="hidden" id="lineUni" value="">
            <input id="lineUniSearch" class="university-search" type="search" placeholder="大学名を検索">
            <div class="picker-toolbar">
              <button type="button" class="secondary-button" id="lineClearUniversities">選択解除</button>
            </div>
            <div id="lineUniList" class="university-checklist university-checklist-multi"></div>
            <div id="lineUniSummary" class="selection-summary"></div>
          </section>
          <section class="control-panel control-actions-panel control-panel-output">
            <h2 class="control-panel-title">出力</h2>
            <div class="control-actions">
              <button type="button" id="shareUrl" class="secondary-button">URL共有</button>
              <button type="button" id="savePng">PNG保存</button>
            </div>
            <p id="shareUrlStatus" class="share-status" role="status" aria-live="polite"></p>
          </section>
        </div>
      `;
    }
  }

  function drawBar() {
    const metricKey = document.getElementById('barMetric').value;
    const yearIndex = Number(document.getElementById('yearSlider').value);
    const year = years[yearIndex];
    const selectedUniversity = document.getElementById('barUniSelect').value;
    const barLimit = getBarLimit();
    const rankType = getBarRankType();
    const rankInfo = getBarRankInfo(rankType, yearIndex);

    const dataArr = universities
      .map(university => getBarRankItem(metricKey, university, yearIndex, rankType))
      .filter(item => Number.isFinite(item.value))
      .sort((a, b) => rankInfo.sortDirection * (b.value - a.value));
    dataArr.forEach((item, index) => {
      item.rank = index + 1;
    });
    const displayDataArr = barLimit === null ? dataArr : dataArr.slice(0, barLimit);

    const labels = displayDataArr.map(item => item.uni);
    const values = displayDataArr.map(item => item.value);
    const minValue = values.length ? Math.min(...values, 0) : 0;
    const maxValue = values.length ? Math.max(...values, 0) : 0;
    const valueRange = Math.max(1, maxValue - minValue);
    const suggestedMin = minValue < 0 ? minValue - valueRange * 0.08 : 0;
    const suggestedMax = maxValue > 0 ? maxValue + valueRange * 0.08 : 1;
    const comparisonText = rankType === 'value'
      ? ''
      : (rankInfo.previousYear ? `${year}年 - ${rankInfo.previousYear}年` : '前年データなし');
    const subtitleParts = [
      `${year}年`,
      rankInfo.label,
      comparisonText,
      getBarLimitLabel(),
      selectedUniversity ? `強調: ${selectedUniversity}` : '全大学'
    ].filter(Boolean);

    const normalBg = 'rgba(74,144,226,0.7)';
    const normalBd = 'rgba(74,144,226,1)';
    const positiveBg = 'rgba(40,161,122,0.72)';
    const positiveBd = 'rgba(40,161,122,1)';
    const negativeBg = 'rgba(217,79,112,0.72)';
    const negativeBd = 'rgba(217,79,112,1)';
    const fadedBg = 'rgba(74,144,226,0.2)';
    const fadedBd = 'rgba(74,144,226,0.3)';
    const highBg = 'rgba(255,205,56,0.8)';
    const highBd = 'rgba(255,205,56,1)';
    const bgColors = displayDataArr.map(item => {
      if (selectedUniversity) return item.uni === selectedUniversity ? highBg : fadedBg;
      if (rankType === 'value') return normalBg;
      return item.value >= 0 ? positiveBg : negativeBg;
    });
    const bdColors = displayDataArr.map(item => {
      if (selectedUniversity) return item.uni === selectedUniversity ? highBd : fadedBd;
      if (rankType === 'value') return normalBd;
      return item.value >= 0 ? positiveBd : negativeBd;
    });
    const bdWidths = displayDataArr.map(item => !selectedUniversity ? 1 : (item.uni === selectedUniversity ? 2 : 1));

    const ctx = document.getElementById('chart').getContext('2d');
    destroyChart();

    chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: `${metricKey}（${rankInfo.label}）`,
          data: values,
          details: displayDataArr,
          backgroundColor: bgColors,
          borderColor: bdColors,
          borderWidth: bdWidths
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 24, bottom: 36 } },
        plugins: {
          ...getTitlePluginOptions(
            `国立大学別 ${metricKey}`,
            subtitleParts.join(' / ')
          ),
          legend: { display: false },
          datalabels: {
            color: context => {
              const detail = context.dataset.details?.[context.dataIndex];
              if (!detail) return 'rgba(74,144,226,1)';
              if (rankType === 'value') return 'rgba(74,144,226,1)';
              return detail.value >= 0 ? 'rgba(40,161,122,1)' : 'rgba(217,79,112,1)';
            },
            font: { size: 10 },
            anchor: 'end',
            align: context => {
              const value = context.dataset.data?.[context.dataIndex];
              return Number(value) < 0 ? 'start' : 'end';
            },
            formatter: value => formatBarRankValue(value, rankType)
          },
          tooltip: {
            callbacks: {
              title: items => items[0].label,
              label: item => {
                const detail = item.dataset.details?.[item.dataIndex];
                return `${rankInfo.label}: ${formatBarRankValue(item.parsed.y, rankType)}${detail?.rank ? `（${detail.rank}位）` : ''}`;
              },
              afterLabel: item => {
                const detail = item.dataset.details?.[item.dataIndex];
                if (!detail || rankType === 'value') return '';
                return [
                  `${year}年: ${formatNumber(detail.current)}`,
                  `${rankInfo.previousYear}年: ${formatNumber(detail.previous)}`
                ];
              }
            }
          }
        },
        scales: {
          x: {
            type: 'category',
            offset: true,
            bounds: 'data',
            grid: { offset: true },
            title: {
              display: true,
              text: rankInfo.axisLabel,
              align: 'center',
              font: { size: 12 }
            },
            ticks: {
              align: 'center',
              callback: function (value, index) { return this.getLabelForValue(index); },
              font: { size: 10 },
              autoSkip: false,
              labelOffset: -5,
              padding: -2,
              maxRotation: 90,
              minRotation: 90
            }
          },
          y: {
            beginAtZero: true,
            suggestedMin,
            suggestedMax,
            ticks: {
              callback: value => formatBarRankValue(Number(value), rankType)
            }
          }
        }
      },
      plugins: getChartPlugins()
    });

    updateUrlFromControls();
  }

  function drawScatter() {
    const xKey = document.getElementById('xSelect').value;
    const yKey = document.getElementById('ySelect').value;
    const yearIndex = Number(document.getElementById('yearSlider').value);
    const year = years[yearIndex];
    const selectedUniversity = document.getElementById('uniSelect').value;
    const showRegression = document.getElementById('showReg').checked;
    const showMedian = document.getElementById('showMedian').checked;
    const xMax = parsePositiveNumber(document.getElementById('xMax').value);
    const yMax = parsePositiveNumber(document.getElementById('yMax').value);

    const points = universities
      .map(university => ({
        x: getMetricNumber(xKey, university, yearIndex),
        y: getMetricNumber(yKey, university, yearIndex),
        uni: university
      }))
      .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));

    const xScale = {
      grid: { color: '#F0F0F0' },
      min: 0,
      title: { display: true, text: xKey, align: 'center', padding: { top: 10 } }
    };
    const yScale = {
      grid: { color: '#F0F0F0' },
      min: 0,
      title: { display: true, text: yKey, align: 'center', padding: { left: 10 }, rotation: -90 }
    };
    if (xMax !== null) xScale.max = xMax;
    if (yMax !== null) yScale.max = yMax;

    const regressionData = showRegression ? getRegressionLine(points, xScale.max) : [];
    const canShowRegression = regressionData.length > 0;
    const quadrant = showMedian ? getQuadrantOptions(points, xKey, yKey) : null;

    const ctx = document.getElementById('chart').getContext('2d');
    destroyChart();

    chart = new Chart(ctx, {
      type: 'scatter',
      data: {
        datasets: [
          {
            data: points,
            pointRadius: points.map(point => !selectedUniversity ? 5 : (point.uni === selectedUniversity ? 7 : 5)),
            backgroundColor: points.map(point => !selectedUniversity
              ? 'rgba(74,144,226,0.7)'
              : (point.uni === selectedUniversity ? 'rgba(255,205,56,0.8)' : 'rgba(74,144,226,0.2)')
            ),
            borderColor: points.map(point => !selectedUniversity
              ? 'rgba(74,144,226,1)'
              : (point.uni === selectedUniversity ? 'rgba(255,205,56,1)' : 'rgba(74,144,226,0.3)')
            )
          },
          {
            type: 'line',
            label: '回帰直線',
            data: regressionData,
            fill: false,
            borderColor: 'rgba(0,128,0,0.7)',
            borderWidth: 1,
            borderDash: [4, 4],
            pointRadius: 0,
            hidden: !canShowRegression,
            datalabels: { display: false }
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 12, right: 32, bottom: 36 } },
        scales: {
          x: xScale,
          y: yScale
        },
        plugins: {
          ...getTitlePluginOptions(
            `${yKey} と ${xKey} の散布図`,
            `${year}年 / ${selectedUniversity ? `強調: ${selectedUniversity}` : '全大学'}${showRegression ? ' / 回帰直線あり' : ''}${showMedian ? ' / 中央値ラインあり' : ''}`
          ),
          legend: { display: false },
          quadrant: {
            enabled: Boolean(quadrant),
            xMedian: quadrant?.xMedian,
            yMedian: quadrant?.yMedian,
            labels: quadrant?.labels
          },
          zoom: {
            limits: { x: { min: 0 }, y: { min: 0 } },
            pan: { enabled: true, mode: 'xy' },
            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' }
          },
          tooltip: {
            callbacks: {
              label: context => {
                const point = context.dataset.data[context.dataIndex];
                return point.uni
                  ? `${point.uni}: (${formatNumber(context.parsed.x)}, ${formatNumber(context.parsed.y)})`
                  : '';
              }
            }
          },
          datalabels: {
            align: 'end',
            anchor: 'end',
            font: { size: 10 },
            color: context => {
              const point = context.dataset.data[context.dataIndex];
              if (!point || !point.uni) return 'rgba(74,144,226,0)';
              return !selectedUniversity || point.uni === selectedUniversity
                ? 'rgba(74,144,226,1)'
                : 'rgba(74,144,226,0.3)';
            },
            formatter: value => value.uni || ''
          }
        }
      },
      plugins: getChartPlugins()
    });

    updateCorrelation(points);
    updateUrlFromControls();
  }

  function drawLine() {
    const selectedUniversities = getSelectedLineUniversities();
    const metric = document.getElementById('lineMetric').value;
    const datasets = selectedUniversities.map((university, index) => {
      const color = CHART_COLORS[index % CHART_COLORS.length];
      return {
        label: university === LINE_TOTAL_VALUE ? `合計（全大学）` : university,
        data: getLineSeries(metric, university),
        borderColor: color,
        backgroundColor: toTransparentColor(color, 0.12),
        pointBackgroundColor: color,
        pointRadius: 4,
        borderWidth: 2,
        spanGaps: true,
        tension: 0.15
      };
    });

    const finiteValues = datasets
      .flatMap(dataset => dataset.data)
      .filter(value => Number.isFinite(value));
    const maxValue = finiteValues.length ? Math.max(...finiteValues) : 0;
    const suggestedMax = maxValue > 0 ? Math.ceil(maxValue * 1.15) : 1;

    const ctx = document.getElementById('chart').getContext('2d');
    destroyChart();

    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: years,
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 72, bottom: 36 } },
        plugins: {
          ...getTitlePluginOptions(
            `${metric}の推移`,
            summarizeList(selectedUniversities.map(formatLineUniversityLabel), 5)
          ),
          legend: {
            display: true,
            position: 'top',
            labels: { boxWidth: 18 }
          },
          datalabels: {
            color: context => context.dataset.borderColor,
            font: { size: 10 },
            anchor: 'end',
            align: 'top',
            formatter: (value, context) => {
              if (context.dataIndex !== years.length - 1) return '';
              return Number.isFinite(value) ? formatNumber(value) : '';
            }
          },
          tooltip: {
            callbacks: {
              label: context => {
                const value = Number.isFinite(context.parsed.y) ? formatNumber(context.parsed.y) : '－';
                return `${context.dataset.label}: ${value}`;
              }
            }
          }
        },
        scales: {
          x: { title: { display: true, text: '年度' } },
          y: {
            beginAtZero: true,
            suggestedMax,
            title: { display: true, text: metric }
          }
        }
      },
      plugins: getChartPlugins()
    });

    updateUrlFromControls();
  }

  function getLineSeries(metric, university) {
    if (university === LINE_TOTAL_VALUE) return getTotalSeries(metric);
    return years.map((year, index) => {
      const value = getMetricNumber(metric, university, index);
      return Number.isFinite(value) ? value : null;
    });
  }

  function setupListeners(mode) {
    setupShareUrlButton();

    if (mode === 'bar') {
      document.getElementById('barMetric').onchange = drawBar;
      document.getElementById('barRank').onchange = drawBar;
      document.getElementById('barLimit').onchange = drawBar;
      document.getElementById('yearSlider').oninput = function () {
        document.getElementById('yearLabel').textContent = years[this.value];
        drawBar();
      };
      document.getElementById('savePng').onclick = () => {
        saveChart(`bar_${document.getElementById('barMetric').value}_${getBarRankType()}_${document.getElementById('yearLabel').textContent}.png`);
      };
      return;
    }

    if (mode === 'scatter') {
      ['xSelect', 'ySelect', 'xMax', 'yMax', 'showReg', 'showMedian'].forEach(id => {
        document.getElementById(id).onchange = drawScatter;
      });
      document.getElementById('yearSlider').oninput = function () {
        document.getElementById('yearLabel').textContent = years[this.value];
        drawScatter();
      };
      document.getElementById('resetZoom').onclick = resetScatterView;
      document.getElementById('savePng').onclick = () => {
        saveChart(`scatter_${document.getElementById('yearLabel').textContent}.png`);
      };
      return;
    }

    if (mode === 'line') {
      document.getElementById('lineMetric').onchange = drawLine;
      document.getElementById('lineClearUniversities').onclick = () => {
        setUniversityPickerValues('lineUni', [LINE_TOTAL_VALUE]);
        drawLine();
      };
      document.getElementById('savePng').onclick = () => {
        saveChart(`line_${document.getElementById('lineMetric').value}_${getSelectedLineUniversities().join('_')}.png`);
      };
    }
  }

  function switchMode(newMode, state = {}) {
    state = {
      year: '',
      metric: '',
      x: '',
      y: '',
      highlight: '',
      showReg: false,
      showMedian: true,
      xMax: '',
      yMax: '',
      top: 'all',
      rank: 'value',
      lineUniversities: [],
      ...state
    };
    if (!Array.isArray(state.lineUniversities)) state.lineUniversities = [];

    chartMode = MODE_VALUES.includes(newMode) ? newMode : 'bar';
    window.chartMode = chartMode;
    renderControls(chartMode);

    if (chartMode === 'bar') {
      const barMetricSelect = document.getElementById('barMetric');
      const barRankSelect = document.getElementById('barRank');
      const barLimitSelect = document.getElementById('barLimit');
      populateMetricSelect(barMetricSelect, materials);
      setSelectValue(barMetricSelect, state.metric);
      setSelectValue(barRankSelect, state.rank, 'value');
      setSelectValue(barLimitSelect, state.top, 'all');
      setupUniversityPicker({
        key: 'barUni',
        mode: 'single',
        values: universities,
        selectedValues: state.highlight ? [state.highlight] : [],
        allowNone: true,
        onChange: drawBar
      });
      setupYearSlider(state.year);
      setupListeners('bar');
      drawBar();
    } else if (chartMode === 'scatter') {
      const xSelect = document.getElementById('xSelect');
      const ySelect = document.getElementById('ySelect');
      const showReg = document.getElementById('showReg');
      const showMedian = document.getElementById('showMedian');

      populateMetricSelect(xSelect, materials);
      populateMetricSelect(ySelect, materials);
      setSelectValue(xSelect, state.x);
      setSelectValue(ySelect, state.y, getDefaultScatterYMetric(xSelect.value, state.year));
      document.getElementById('xMax').value = state.xMax || '';
      document.getElementById('yMax').value = state.yMax || '';
      showReg.checked = Boolean(state.showReg);
      showMedian.checked = state.showMedian !== false;
      setupUniversityPicker({
        key: 'uni',
        mode: 'single',
        values: universities,
        selectedValues: state.highlight ? [state.highlight] : [],
        allowNone: true,
        onChange: drawScatter
      });
      setupYearSlider(state.year);
      setupListeners('scatter');
      drawScatter();
    } else if (chartMode === 'line') {
      const metricSelect = document.getElementById('lineMetric');
      populateMetricSelect(metricSelect, materials);
      setSelectValue(metricSelect, state.metric);
      setupUniversityPicker({
        key: 'lineUni',
        mode: 'multiple',
        values: [LINE_TOTAL_VALUE].concat(universities),
        selectedValues: state.lineUniversities.length ? state.lineUniversities : [LINE_TOTAL_VALUE],
        allowNone: false,
        onChange: drawLine
      });
      setupListeners('line');
      drawLine();
    }

    setupShareUrlButton();

    const activeInput = document.querySelector(`#modeSwitch input[value="${chartMode}"]`);
    if (activeInput) activeInput.checked = true;
    setModeActive();
  }

  function resetScatterView() {
    const xMax = document.getElementById('xMax');
    const yMax = document.getElementById('yMax');
    if (xMax) xMax.value = '';
    if (yMax) yMax.value = '';

    if (chart && typeof chart.resetZoom === 'function') {
      chart.resetZoom();
    }

    drawScatter();
  }

  function setupYearSlider(preferredYear = '') {
    const yearSlider = document.getElementById('yearSlider');
    const defaultIndex = getYearIndex(preferredYear);
    yearSlider.min = 0;
    yearSlider.max = Math.max(0, years.length - 1);
    yearSlider.value = defaultIndex;
    document.getElementById('yearLabel').textContent = years[defaultIndex] || '';
  }

  function populateMetricSelect(select, values) {
    const grouped = new Map(METRIC_CATEGORY_ORDER.map(category => [category, []]));
    values.forEach(value => {
      const category = getMetricCategory(value);
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push(value);
    });

    grouped.forEach((categoryValues, category) => {
      if (!categoryValues.length) return;
      const group = document.createElement('optgroup');
      group.label = category;
      categoryValues.forEach(value => appendOption(group, value, value));
      select.appendChild(group);
    });
  }

  function getMetricCategory(metric) {
    if (/決算額|図書館費|資料費|図書費|新聞/.test(metric)) return '経費';
    if (/相互協力/.test(metric)) return '相互協力';
    if (/入館者|貸出|文献複写|開館|参考/.test(metric)) return '利用';
    if (/雑誌/.test(metric)) return '雑誌';
    if (/受入図書/.test(metric)) return '受入';
    if (/蔵書|洋書|開架/.test(metric)) return '蔵書';
    if (/専従|兼任|非常勤|臨時/.test(metric)) return '職員';
    if (/総数|奉仕対象|学生/.test(metric)) return '基本';
    return 'その他';
  }

  function appendOption(select, value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }

  function setSelectValue(select, value, fallbackValue) {
    const optionValues = Array.from(select.options).map(option => option.value);
    if (value && optionValues.includes(value)) {
      select.value = value;
      return;
    }

    if (fallbackValue !== undefined && optionValues.includes(fallbackValue)) {
      select.value = fallbackValue;
      return;
    }

    if (select.options.length > 0) select.selectedIndex = 0;
  }

  function getPickerIds(key) {
    return {
      barUni: {
        hiddenId: 'barUniSelect',
        searchId: 'barUniSearch',
        listId: 'barUniList',
        summaryId: 'barUniSummary'
      },
      uni: {
        hiddenId: 'uniSelect',
        searchId: 'uniSearch',
        listId: 'uniList',
        summaryId: 'uniSummary'
      },
      lineUni: {
        hiddenId: 'lineUni',
        searchId: 'lineUniSearch',
        listId: 'lineUniList',
        summaryId: 'lineUniSummary'
      }
    }[key];
  }

  function setupUniversityPicker({ key, mode, values, selectedValues, allowNone, onChange }) {
    const ids = getPickerIds(key);
    const hidden = document.getElementById(ids.hiddenId);
    const search = document.getElementById(ids.searchId);
    const validValues = new Set(values);
    const normalized = selectedValues.filter(value => validValues.has(value));
    const initialValues = normalized.length ? normalized : (allowNone ? [] : [LINE_TOTAL_VALUE]);

    hidden.dataset.pickerKey = key;
    hidden.dataset.pickerMode = mode;
    hidden.value = initialValues.join(',');
    universityPickerConfigs[key] = { key, mode, values, allowNone, onChange };

    const render = () => {
      renderUniversityPickerOptions({ key, mode, values, allowNone, onChange });
      renderUniversitySummary(key);
    };

    search.oninput = render;
    render();
  }

  function renderUniversityPickerOptions({ key, mode, values, allowNone, onChange }) {
    const ids = getPickerIds(key);
    const hidden = document.getElementById(ids.hiddenId);
    const search = document.getElementById(ids.searchId);
    const list = document.getElementById(ids.listId);
    const query = normalizeSearchText(search.value);
    const selectedValues = new Set(splitParamList(hidden.value));
    const options = [];

    if (allowNone) options.push({ value: '', label: '選択なし' });
    values.forEach(value => options.push({ value, label: formatLineUniversityLabel(value) }));

    list.innerHTML = '';
    options
      .filter(option => !query || normalizeSearchText(option.label).includes(query))
      .forEach(option => {
        const label = document.createElement('label');
        label.className = 'checklist-option';

        const input = document.createElement('input');
        input.type = mode === 'single' ? 'radio' : 'checkbox';
        input.name = `${key}Option`;
        input.value = option.value;
        input.checked = mode === 'single'
          ? (option.value === '' ? selectedValues.size === 0 : selectedValues.has(option.value))
          : selectedValues.has(option.value);

        input.onchange = () => {
          if (mode === 'single') {
            hidden.value = input.value;
          } else {
            const nextValues = new Set(splitParamList(hidden.value));
            if (input.checked) nextValues.add(input.value);
            else nextValues.delete(input.value);
            if (!nextValues.size) nextValues.add(LINE_TOTAL_VALUE);
            hidden.value = Array.from(nextValues).filter(Boolean).join(',');
          }
          renderUniversityPickerOptions({ key, mode, values, allowNone, onChange });
          renderUniversitySummary(key);
          onChange();
        };

        const text = document.createElement('span');
        text.textContent = option.label;
        label.appendChild(input);
        label.appendChild(text);
        list.appendChild(label);
      });

    if (!list.children.length) {
      const empty = document.createElement('p');
      empty.className = 'checklist-empty';
      empty.textContent = '該当なし';
      list.appendChild(empty);
    }
  }

  function renderUniversitySummary(key) {
    const ids = getPickerIds(key);
    const hidden = document.getElementById(ids.hiddenId);
    const summary = document.getElementById(ids.summaryId);
    const values = splitParamList(hidden.value);

    summary.innerHTML = '';
    if (!values.length) {
      summary.textContent = '強調: なし';
      return;
    }

    values.forEach(value => {
      const chip = document.createElement('span');
      chip.className = 'selection-chip';
      chip.textContent = formatLineUniversityLabel(value);
      summary.appendChild(chip);
    });
  }

  function setUniversityPickerValues(key, values) {
    const ids = getPickerIds(key);
    const hidden = document.getElementById(ids.hiddenId);
    const config = universityPickerConfigs[key];
    hidden.value = values.join(',');
    document.getElementById(ids.searchId).value = '';
    if (config) renderUniversityPickerOptions(config);
    renderUniversitySummary(key);
  }

  function normalizeSearchText(value) {
    return String(value).toLowerCase().replace(/\s+/g, '');
  }

  function getYearIndex(preferredYear = '') {
    const requestedIndex = years.indexOf(String(preferredYear));
    if (requestedIndex >= 0) return requestedIndex;
    return Math.max(0, years.length - 1);
  }

  function getDefaultScatterYMetric(xMetric, preferredYear = '') {
    const yearIndex = getYearIndex(preferredYear);
    const metricWithData = materials.find(metric => metric !== xMetric && hasMetricData(metric, yearIndex));
    return metricWithData || materials.find(metric => metric !== xMetric) || materials[0];
  }

  function hasMetricData(metric, yearIndex) {
    return universities.some(university => Number.isFinite(getMetricNumber(metric, university, yearIndex)));
  }

  function getBarLimit() {
    const value = document.getElementById('barLimit')?.value || 'all';
    return value === 'all' ? null : Number(value);
  }

  function getBarLimitLabel() {
    const limit = getBarLimit();
    return limit === null ? '全件' : `上位${limit}件`;
  }

  function getBarRankType() {
    const value = document.getElementById('barRank')?.value || 'value';
    return BAR_RANK_VALUES.includes(value) ? value : 'value';
  }

  function getBarRankInfo(rankType, yearIndex) {
    const previousYear = yearIndex > 0 ? years[yearIndex - 1] : '';
    const info = {
      value: {
        label: '値',
        axisLabel: '値',
        sortDirection: 1,
        previousYear
      },
      diffUp: {
        label: '前年差（増加順）',
        axisLabel: '前年差',
        sortDirection: 1,
        previousYear
      },
      diffDown: {
        label: '前年差（減少順）',
        axisLabel: '前年差',
        sortDirection: -1,
        previousYear
      },
      rateUp: {
        label: '増減率（増加順）',
        axisLabel: '増減率',
        sortDirection: 1,
        previousYear
      },
      rateDown: {
        label: '増減率（減少順）',
        axisLabel: '増減率',
        sortDirection: -1,
        previousYear
      }
    };

    return info[rankType] || info.value;
  }

  function getBarRankItem(metric, university, yearIndex, rankType) {
    const current = getMetricNumber(metric, university, yearIndex);
    if (!Number.isFinite(current)) {
      return { uni: university, value: NaN, current, previous: NaN };
    }

    if (rankType === 'value') {
      return { uni: university, value: current, current, previous: NaN };
    }

    const previous = yearIndex > 0 ? getMetricNumber(metric, university, yearIndex - 1) : NaN;
    if (!Number.isFinite(previous)) {
      return { uni: university, value: NaN, current, previous };
    }

    const diff = current - previous;
    if (rankType === 'diffUp' || rankType === 'diffDown') {
      return { uni: university, value: diff, current, previous };
    }

    if (previous === 0) {
      return { uni: university, value: NaN, current, previous };
    }

    return { uni: university, value: (diff / previous) * 100, current, previous };
  }

  function getMetricNumber(metric, university, yearIndex) {
    const value = metrics[metric]?.[university]?.[yearIndex];
    const numberValue = parseFloat(value);
    return Number.isFinite(numberValue) ? numberValue : NaN;
  }

  function getTotalSeries(metric) {
    return years.map((year, yearIndex) => {
      let sum = 0;
      let count = 0;

      universities.forEach(university => {
        const value = getMetricNumber(metric, university, yearIndex);
        if (Number.isFinite(value)) {
          sum += value;
          count += 1;
        }
      });

      return count === 0 ? null : sum;
    });
  }

  function getSelectedLineUniversities() {
    const input = document.getElementById('lineUni');
    if (!input) return [LINE_TOTAL_VALUE];
    const selected = splitParamList(input.value);
    return selected.length ? selected : [LINE_TOTAL_VALUE];
  }

  function updateCorrelation(points) {
    const display = document.getElementById('corrDisplay');
    const correlation = getCorrelation(points);
    display.textContent = Number.isFinite(correlation)
      ? `相関係数: ${correlation.toFixed(2)}`
      : '相関係数: N/A';
  }

  function getCorrelation(points) {
    if (points.length < 2) return NaN;

    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    const n = points.length;
    const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
    const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
    const covSum = xs.reduce((sum, value, index) => sum + (value - meanX) * (ys[index] - meanY), 0);
    const varX = xs.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
    const varY = ys.reduce((sum, value) => sum + (value - meanY) ** 2, 0);

    if (varX === 0 || varY === 0) return NaN;
    return (covSum / n) / (Math.sqrt(varX / n) * Math.sqrt(varY / n));
  }

  function getRegressionLine(points, requestedMaxX) {
    if (points.length < 2) return [];

    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    const n = points.length;
    const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
    const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
    const covSum = xs.reduce((sum, value, index) => sum + (value - meanX) * (ys[index] - meanY), 0);
    const varSum = xs.reduce((sum, value) => sum + (value - meanX) ** 2, 0);

    if (varSum === 0) return [];

    const slope = covSum / varSum;
    const intercept = meanY - slope * meanX;
    const maxX = Number.isFinite(requestedMaxX) ? requestedMaxX : Math.max(...xs);

    return [
      { x: 0, y: intercept },
      { x: maxX, y: intercept + slope * maxX }
    ];
  }

  function getQuadrantOptions(points) {
    if (points.length < 2) return null;

    const xMedian = getMedian(points.map(point => point.x));
    const yMedian = getMedian(points.map(point => point.y));
    if (!Number.isFinite(xMedian) || !Number.isFinite(yMedian)) return null;

    return {
      xMedian,
      yMedian,
      labels: {
        topLeft: 'X低・Y高',
        topRight: 'X高・Y高',
        bottomLeft: 'X低・Y低',
        bottomRight: 'X高・Y低'
      }
    };
  }

  function getMedian(values) {
    const sortedValues = values
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const length = sortedValues.length;
    if (!length) return NaN;

    const center = Math.floor(length / 2);
    if (length % 2) return sortedValues[center];
    return (sortedValues[center - 1] + sortedValues[center]) / 2;
  }

  function updateUrlFromControls() {
    if (suppressUrlUpdate) return;

    const params = new URLSearchParams();
    params.set('mode', chartMode);

    if (chartMode === 'bar') {
      params.set('metric', document.getElementById('barMetric').value);
      params.set('year', document.getElementById('yearLabel').textContent);
      const rank = document.getElementById('barRank').value;
      const top = document.getElementById('barLimit').value;
      const highlight = document.getElementById('barUniSelect').value;
      if (rank !== 'value') params.set('rank', rank);
      if (top !== 'all') params.set('top', top);
      if (highlight) params.set('highlight', highlight);
    } else if (chartMode === 'scatter') {
      params.set('x', document.getElementById('xSelect').value);
      params.set('y', document.getElementById('ySelect').value);
      params.set('year', document.getElementById('yearLabel').textContent);
      const highlight = document.getElementById('uniSelect').value;
      const xMax = document.getElementById('xMax').value;
      const yMax = document.getElementById('yMax').value;
      if (highlight) params.set('highlight', highlight);
      if (document.getElementById('showReg').checked) params.set('reg', '1');
      if (!document.getElementById('showMedian').checked) params.set('median', '0');
      if (xMax) params.set('xMax', xMax);
      if (yMax) params.set('yMax', yMax);
    } else if (chartMode === 'line') {
      params.set('metric', document.getElementById('lineMetric').value);
      params.set('unis', getSelectedLineUniversities().join(','));
    }

    const base = window.location.href.split('#')[0].split('?')[0];
    const hash = window.location.hash || '';
    window.history.replaceState(null, '', `${base}?${params.toString()}${hash}`);
  }

  function setupShareUrlButton() {
    const button = document.getElementById('shareUrl');
    if (!button) return;
    if (button.dataset.shareReady === '1') return;

    button.dataset.shareReady = '1';
    button.addEventListener('click', handleShareUrl);
  }

  async function handleShareUrl() {
    const button = document.getElementById('shareUrl');
    if (!button) return;

    updateUrlFromControls();
    button.disabled = true;
    setShareStatus('URLをコピーしています。', false, 0);

    try {
      await copyTextToClipboard(window.location.href);
      setShareStatus('URLをコピーしました。');
    } catch (error) {
      setShareStatus('URLをコピーできませんでした。アドレスバーからコピーしてください。', true);
    } finally {
      button.disabled = false;
    }
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.select();

    try {
      if (!document.execCommand('copy')) {
        throw new Error('Copy command was not accepted.');
      }
    } finally {
      textarea.remove();
    }
  }

  function setShareStatus(message, isError = false, clearAfter = 3000) {
    const status = document.getElementById('shareUrlStatus');
    if (!status) return;

    status.textContent = message;
    status.classList.toggle('error', isError);

    clearTimeout(shareStatusTimer);
    if (!clearAfter) return;

    shareStatusTimer = window.setTimeout(() => {
      status.textContent = '';
      status.classList.remove('error');
    }, clearAfter);
  }

  function getTitlePluginOptions(title, subtitle) {
    return {
      title: {
        display: true,
        text: title,
        color: '#222',
        font: { size: 17, weight: 'bold' },
        padding: { top: 4, bottom: 4 }
      },
      subtitle: {
        display: Boolean(subtitle),
        text: subtitle || '',
        color: '#555',
        font: { size: 12 },
        padding: { bottom: 12 }
      }
    };
  }

  function getSourceText() {
    if (chartMode === 'line') {
      return '出典: 「日本の図書館 統計と名簿」（日本図書館協会）を加工して作成';
    }

    const yearLabel = document.getElementById('yearLabel');
    const yearText = yearLabel ? yearLabel.textContent : '';
    return `出典: 「日本の図書館 統計と名簿 ${yearText}年版」（日本図書館協会）を加工して作成`;
  }

  function getExportDetails() {
    if (chartMode === 'bar') {
      const metric = document.getElementById('barMetric').value;
      const year = document.getElementById('yearLabel').textContent;
      const highlight = document.getElementById('barUniSelect').value;
      const rankType = getBarRankType();
      const rankInfo = getBarRankInfo(rankType, Number(document.getElementById('yearSlider').value));
      return {
        title: `国立大学別 ${metric}`,
        conditions: [
          `表示形式: 棒グラフ`,
          `年度: ${year}年`,
          `表示内容: ${rankInfo.label}`,
          rankType === 'value' || !rankInfo.previousYear ? '' : `比較: ${year}年 - ${rankInfo.previousYear}年`,
          `表示範囲: ${getBarLimitLabel()}`,
          highlight ? `強調: ${highlight}` : '強調: なし'
        ].filter(Boolean),
        source: getSourceText()
      };
    }

    if (chartMode === 'scatter') {
      const year = document.getElementById('yearLabel').textContent;
      const highlight = document.getElementById('uniSelect').value;
      const xMax = document.getElementById('xMax').value;
      const yMax = document.getElementById('yMax').value;
      return {
        title: `${document.getElementById('ySelect').value} と ${document.getElementById('xSelect').value} の散布図`,
        conditions: [
          `表示形式: 散布図`,
          `年度: ${year}年`,
          `X軸: ${document.getElementById('xSelect').value}`,
          `Y軸: ${document.getElementById('ySelect').value}`,
          highlight ? `強調: ${highlight}` : '強調: なし',
          document.getElementById('showReg').checked ? '回帰直線: 表示' : '回帰直線: 非表示',
          document.getElementById('showMedian').checked ? '中央値ライン: 表示' : '中央値ライン: 非表示',
          xMax ? `X最大値: ${xMax}` : '',
          yMax ? `Y最大値: ${yMax}` : '',
          document.getElementById('corrDisplay').textContent
        ].filter(Boolean),
        source: getSourceText()
      };
    }

    const selectedUniversities = getSelectedLineUniversities().map(formatLineUniversityLabel);
    return {
      title: `${document.getElementById('lineMetric').value}の推移`,
      conditions: [
        `表示形式: 折れ線グラフ`,
        `大学: ${selectedUniversities.join('、')}`,
        `項目: ${document.getElementById('lineMetric').value}`
      ],
      source: getSourceText()
    };
  }

  function saveChart(filename) {
    if (!chart) return;

    const exportCanvas = createExportCanvas(getExportDetails());
    const link = document.createElement('a');
    link.href = exportCanvas.toDataURL('image/png');
    link.download = sanitizeFileName(filename);
    link.click();
  }

  function createExportCanvas(details) {
    const chartCanvas = chart.canvas;
    const exportWidth = 1600;
    const margin = 56;
    const chartWidth = exportWidth - margin * 2;
    const chartHeight = Math.round(chartCanvas.height * (chartWidth / chartCanvas.width));
    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');

    measureCtx.font = 'bold 30px sans-serif';
    const titleLines = wrapText(measureCtx, details.title, chartWidth);
    measureCtx.font = '18px sans-serif';
    const conditionLines = details.conditions.flatMap(line => wrapText(measureCtx, line, chartWidth));
    measureCtx.font = '16px sans-serif';
    const sourceLines = wrapText(measureCtx, details.source, chartWidth);

    const titleLineHeight = 38;
    const conditionLineHeight = 25;
    const sourceLineHeight = 23;
    const headerHeight = margin + titleLines.length * titleLineHeight + 12 + conditionLines.length * conditionLineHeight + 26;
    const footerHeight = 26 + sourceLines.length * sourceLineHeight + margin;

    const canvas = document.createElement('canvas');
    canvas.width = exportWidth;
    canvas.height = headerHeight + chartHeight + footerHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let y = margin;
    ctx.fillStyle = '#222222';
    ctx.font = 'bold 30px sans-serif';
    titleLines.forEach(line => {
      ctx.fillText(line, margin, y);
      y += titleLineHeight;
    });

    y += 12;
    ctx.fillStyle = '#444444';
    ctx.font = '18px sans-serif';
    conditionLines.forEach(line => {
      ctx.fillText(line, margin, y);
      y += conditionLineHeight;
    });

    y += 26;
    drawChartWithoutEmbeddedText(ctx, margin, y, chartWidth, chartHeight);

    y += chartHeight + 26;
    ctx.fillStyle = '#666666';
    ctx.font = '16px sans-serif';
    sourceLines.forEach(line => {
      ctx.fillText(line, margin, y);
      y += sourceLineHeight;
    });

    return canvas;
  }

  function drawChartWithoutEmbeddedText(ctx, x, y, width, height) {
    const pluginOptions = chart.options?.plugins || {};
    const titleOptions = pluginOptions.title;
    const subtitleOptions = pluginOptions.subtitle;
    const previousTitleDisplay = titleOptions ? titleOptions.display : undefined;
    const previousSubtitleDisplay = subtitleOptions ? subtitleOptions.display : undefined;
    const previousSuppressEmbeddedChartText = suppressEmbeddedChartText;

    suppressEmbeddedChartText = true;
    if (titleOptions) titleOptions.display = false;
    if (subtitleOptions) subtitleOptions.display = false;
    chart.update('none');

    try {
      ctx.drawImage(chart.canvas, x, y, width, height);
    } finally {
      if (titleOptions) titleOptions.display = previousTitleDisplay;
      if (subtitleOptions) subtitleOptions.display = previousSubtitleDisplay;
      suppressEmbeddedChartText = previousSuppressEmbeddedChartText;
      chart.update('none');
    }
  }

  function wrapText(ctx, text, maxWidth) {
    const lines = [];
    let current = '';

    for (const character of String(text)) {
      const next = current + character;
      if (current && ctx.measureText(next).width > maxWidth) {
        lines.push(current);
        current = character;
      } else {
        current = next;
      }
    }

    if (current) lines.push(current);
    return lines;
  }

  function parsePositiveNumber(value) {
    if (value === '') return null;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
  }

  function formatNumber(value) {
    return Number.isFinite(value) ? value.toLocaleString('ja-JP') : '';
  }

  function formatSignedNumber(value) {
    if (!Number.isFinite(value)) return '';
    const prefix = value > 0 ? '+' : '';
    return `${prefix}${formatNumber(Math.round(value * 10) / 10)}`;
  }

  function formatBarRankValue(value, rankType) {
    if (!Number.isFinite(value)) return '';
    if (rankType === 'rateUp' || rankType === 'rateDown') {
      return `${formatSignedNumber(Math.round(value * 10) / 10)}%`;
    }
    if (rankType === 'diffUp' || rankType === 'diffDown') {
      return formatSignedNumber(value);
    }
    return formatNumber(value);
  }

  function formatLineUniversityLabel(university) {
    return university === LINE_TOTAL_VALUE ? '合計（国立大学）' : university;
  }

  function summarizeList(values, limit) {
    if (values.length <= limit) return values.join('、');
    return `${values.slice(0, limit).join('、')} ほか${values.length - limit}件`;
  }

  function toTransparentColor(hex, alpha) {
    const value = hex.replace('#', '');
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function getChartPlugins() {
    const plugins = [quadrantPlugin, footerPlugin];
    if (window.ChartDataLabels) plugins.unshift(window.ChartDataLabels);
    return plugins;
  }

  function destroyChart() {
    if (chart) {
      chart.destroy();
      chart = null;
    }
  }

  function sanitizeFileName(filename) {
    return String(filename).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));
  }
})();

/**
 * Camada de graficos do painel.
 *
 * Envolve o uPlot (vendorizado em vendor/uplot) para que as paginas nunca
 * falem com a biblioteca direto. Isso mantem em um so lugar: as cores vindas
 * dos tokens CSS, o redimensionamento, o tooltip e a regra de eixo duplo.
 */
import uPlot from "./vendor/uplot/uPlot.esm.js";

const FALLBACK_COLORS = {
  grid: "rgba(255,255,255,0.08)",
  axis: "rgba(255,255,255,0.55)",
  zero: "rgba(255,255,255,0.22)",
  series: "#36d399"
};

let colorCache = null;

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || fallback;
}

/**
 * Le a paleta dos tokens CSS. Assim trocar o tema muda os graficos junto, sem
 * precisar duplicar hex nenhum em JavaScript.
 */
export function readChartColors() {
  if (colorCache) return colorCache;
  colorCache = {
    grid: cssVar("--chart-grid", FALLBACK_COLORS.grid),
    axis: cssVar("--chart-axis", FALLBACK_COLORS.axis),
    zero: cssVar("--chart-zero", FALLBACK_COLORS.zero),
    accent: cssVar("--accent", FALLBACK_COLORS.series),
    danger: cssVar("--danger", "#ff6b6b"),
    warn: cssVar("--warn", "#f6c343"),
    band: cssVar("--chart-band", "rgba(54, 211, 153, 0.12)")
  };
  return colorCache;
}

/** Cor de uma serie nomeada: --series-<key>, com fallback explicito. */
export function seriesColor(key, fallback) {
  return cssVar(`--series-${key}`, fallback || readChartColors().accent);
}

/** Invalidar apos troca de tema. */
export function resetChartColors() {
  colorCache = null;
}

function baseAxis(colors, extra = {}) {
  return {
    stroke: colors.axis,
    grid: { stroke: colors.grid, width: 1 },
    ticks: { stroke: colors.grid, width: 1 },
    font: '11px system-ui, "Segoe UI", sans-serif',
    ...extra
  };
}

/**
 * Observa o container e repassa a largura ao grafico. O canvas antigo so era
 * medido no redraw, entao redimensionar a janela deixava o grafico deformado.
 */
function observeSize(chart, container, height) {
  if (typeof ResizeObserver !== "function") {
    return () => {};
  }
  let frame = 0;
  const observer = new ResizeObserver(() => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      const width = container.clientWidth;
      if (width > 0) {
        chart.setSize({ width, height: height || chart.height });
      }
    });
  });
  observer.observe(container);
  return () => {
    if (frame) cancelAnimationFrame(frame);
    observer.disconnect();
  };
}

/**
 * Tooltip: reaproveita o elemento e as classes que ja existem no CSS
 * (.performance-tooltip), so trocando quem decide o conteudo.
 */
function makeTooltipPlugin(tooltipEl, renderRow) {
  if (!tooltipEl) return null;
  return {
    hooks: {
      setCursor: (chart) => {
        const idx = chart.cursor.idx;
        if (idx == null || chart.cursor.left < 0) {
          tooltipEl.classList.add("hidden");
          return;
        }
        const html = renderRow(idx, chart);
        if (!html) {
          tooltipEl.classList.add("hidden");
          return;
        }
        tooltipEl.innerHTML = html;
        tooltipEl.classList.remove("hidden");
        const rect = chart.root.getBoundingClientRect();
        const tipRect = tooltipEl.getBoundingClientRect();
        const maxLeft = rect.width - tipRect.width - 8;
        const maxTop = rect.height - tipRect.height - 8;
        tooltipEl.style.left = `${Math.min(maxLeft, Math.max(8, chart.cursor.left + 12))}px`;
        tooltipEl.style.top = `${Math.min(maxTop, Math.max(8, chart.cursor.top + 12))}px`;
      }
    }
  };
}

/**
 * Grafico de categorias (dia/semana/mes): o eixo X e ordinal, os rotulos vem
 * prontos do agregador. uPlot recebe indices e traduz para rotulo no eixo.
 */
export function createCategoryChart(container, options = {}) {
  const colors = readChartColors();
  const height = options.height || 280;
  const tooltipEl = options.tooltipEl || null;
  let labels = [];
  let chart = null;
  let disposeSize = () => {};

  const destroy = () => {
    disposeSize();
    if (chart) {
      chart.destroy();
      chart = null;
    }
    container.innerHTML = "";
  };

  const update = (nextLabels, seriesDefs, columns) => {
    labels = nextLabels;
    destroy();
    if (!seriesDefs.length || !labels.length) {
      return;
    }
    const usesPct = seriesDefs.some((s) => s.scale === "pct");
    const usesVal = seriesDefs.some((s) => s.scale !== "pct");
    const uSeries = [
      {
        value: (_u, rawIdx) => labels[rawIdx] ?? ""
      },
      ...seriesDefs.map((def) => ({
        label: def.label,
        stroke: def.color,
        width: 2,
        dash: def.dash ? [6, 4] : undefined,
        scale: def.scale === "pct" ? "pct" : "val",
        points: { show: labels.length <= 60, size: 6 },
        spanGaps: false
      }))
    ];
    // O eixo X e ordinal: sem forcar os splits, o uPlot escolhe posicoes
    // fracionarias e o mesmo rotulo aparece repetido varias vezes.
    const labelStep = Math.max(1, Math.ceil(labels.length / 12));
    const axes = [
      baseAxis(colors, {
        splits: () => {
          const out = [];
          for (let i = 0; i < labels.length; i += labelStep) {
            out.push(i);
          }
          const last = labels.length - 1;
          if (out[out.length - 1] !== last) {
            out.push(last);
          }
          return out;
        },
        values: (_u, splits) =>
          splits.map((idx) => {
            const i = Math.round(idx);
            return i >= 0 && i < labels.length ? labels[i] : "";
          })
      })
    ];
    if (usesVal) {
      axes.push(
        baseAxis(colors, {
          scale: "val",
          size: 62,
          values: (_u, splits) => splits.map((v) => options.formatValue?.(v) ?? v)
        })
      );
    }
    if (usesPct) {
      axes.push(
        baseAxis(colors, {
          scale: "pct",
          side: 1,
          size: 56,
          grid: { show: false },
          values: (_u, splits) => splits.map((v) => `${Number(v).toFixed(2)}%`)
        })
      );
    }

    const plugins = [];
    const tooltip = makeTooltipPlugin(tooltipEl, (idx) =>
      options.renderTooltip?.(idx, labels[idx], seriesDefs)
    );
    if (tooltip) plugins.push(tooltip);

    chart = new uPlot(
      {
        width: container.clientWidth || 600,
        height,
        cursor: { drag: { x: true, y: false }, focus: { prox: 24 } },
        legend: { show: false },
        scales: { x: { time: false } },
        series: uSeries,
        axes,
        plugins
      },
      [labels.map((_, i) => i), ...seriesDefs.map((def) => columns[def.key])],
      container
    );
    disposeSize = observeSize(chart, container, height);
  };

  return { update, destroy, get instance() { return chart; } };
}

/**
 * Grafico temporal, usado pelas series de snapshots. Aceita uma banda
 * (faixa alvo/da posicao) desenhada atras das linhas.
 */
export function createTimeChart(container, options = {}) {
  const colors = readChartColors();
  const height = options.height || 260;
  const tooltipEl = options.tooltipEl || null;
  let chart = null;
  let disposeSize = () => {};

  const destroy = () => {
    disposeSize();
    if (chart) {
      chart.destroy();
      chart = null;
    }
    container.innerHTML = "";
  };

  /**
   * @param {number[]} xs epoch em segundos
   * @param {Array<{key,label,color,scale,fill,dash,width}>} seriesDefs
   * @param {Record<string, Array<number|null>>} columns
   */
  const update = (xs, seriesDefs, columns) => {
    destroy();
    if (!xs.length || !seriesDefs.length) {
      return;
    }
    const usesPct = seriesDefs.some((s) => s.scale === "pct");
    const bandPairs = [];
    const uSeries = [{}];
    seriesDefs.forEach((def, index) => {
      uSeries.push({
        label: def.label,
        stroke: def.color,
        width: def.width ?? 2,
        dash: def.dash ? [5, 4] : undefined,
        fill: def.fill || undefined,
        scale: def.scale === "pct" ? "pct" : "val",
        points: { show: false },
        spanGaps: false
      });
      if (def.bandWith) {
        const partner = seriesDefs.findIndex((s) => s.key === def.bandWith);
        if (partner >= 0) {
          bandPairs.push({ series: [index + 1, partner + 1], fill: def.bandFill || colors.band });
        }
      }
    });

    const axes = [
      baseAxis(colors),
      baseAxis(colors, {
        scale: "val",
        // Precos com muitas casas decimais precisam de mais espaco; sem isto o
        // rotulo fica cortado na borda esquerda.
        size: options.axisSize || 64,
        values: (_u, splits) => splits.map((v) => options.formatValue?.(v) ?? v)
      })
    ];
    if (usesPct) {
      axes.push(
        baseAxis(colors, {
          scale: "pct",
          side: 1,
          size: 52,
          grid: { show: false },
          values: (_u, splits) => splits.map((v) => `${Number(v).toFixed(1)}%`)
        })
      );
    }

    const plugins = [];
    const tooltip = makeTooltipPlugin(tooltipEl, (idx) =>
      options.renderTooltip?.(idx, xs[idx], seriesDefs)
    );
    if (tooltip) plugins.push(tooltip);

    chart = new uPlot(
      {
        width: container.clientWidth || 600,
        height,
        cursor: { drag: { x: true, y: false }, focus: { prox: 24 } },
        legend: { show: false },
        series: uSeries,
        axes,
        bands: bandPairs,
        plugins
      },
      [xs, ...seriesDefs.map((def) => columns[def.key])],
      container
    );
    disposeSize = observeSize(chart, container, height);
  };

  return { update, destroy, get instance() { return chart; } };
}

/** Converte a lista de snapshots em colunas, no formato que o uPlot consome. */
export function snapshotColumns(points, keys) {
  const xs = points.map((p) => Math.round(p.t / 1000));
  const columns = {};
  for (const key of keys) {
    columns[key] = points.map((p) => {
      const value = p[key];
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    });
  }
  return { xs, columns };
}

/**
 * Quebra a serie a cada troca de posicao (posMint). Sem isso, campos que zeram
 * ao abrir uma posicao nova (taxas, entrada) desenham uma queda que parece
 * prejuizo, quando na verdade e so o comeco de outro ciclo.
 */
export function splitOnPositionChange(points, columns, keys) {
  const result = {};
  for (const key of keys) {
    result[key] = columns[key].slice();
  }
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].posMint !== points[i - 1].posMint) {
      for (const key of keys) {
        result[key][i - 1] = null;
      }
    }
  }
  return result;
}

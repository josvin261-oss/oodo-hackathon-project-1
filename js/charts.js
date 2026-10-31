/* ===========================================================
   Brightloop charts — dependency-free inline SVG, flat colors,
   no gradients. Works fully offline (no CDN, no canvas libs).
=========================================================== */
(function (global) {
  "use strict";

  const PALETTE = ["#0070f2", "#8fd19e", "#eebb4d", "#b52b27", "#6a7680", "#4aa8d8", "#9a5bd1"];
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

  function fmtMoney(n) {
    return "$" + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  // ---------- Donut chart ----------
  function donut(data, opts) {
    opts = opts || {};
    const size = opts.size || 140, stroke = opts.stroke || 18;
    const r = (size - stroke) / 2, cx = size / 2, cy = size / 2;
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    let angle = -90;
    const circ = 2 * Math.PI * r;
    let segs = "";
    data.forEach((d, i) => {
      const frac = d.value / total;
      const dash = circ * frac;
      const color = d.color || PALETTE[i % PALETTE.length];
      segs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
        stroke-dasharray="${dash.toFixed(2)} ${(circ - dash).toFixed(2)}" stroke-dashoffset="${(-angle / 360 * circ).toFixed(2)}"
        transform="rotate(-90 ${cx} ${cy})"></circle>`;
      angle += frac * 360;
    });
    const svg = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e3e7ea" stroke-width="${stroke}"></circle>
      ${segs}
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="18" font-weight="700" fill="#1a2228">${total.toLocaleString()}</text>
      <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="9.5" fill="#6a7680">TOTAL</text>
    </svg>`;
    const legend = `<div class="legend-row">${data.map((d, i) => `<span><i class="dot" style="background:${d.color || PALETTE[i % PALETTE.length]}"></i>${esc(d.label)} · ${d.value.toLocaleString()}</span>`).join("")}</div>`;
    return `<div class="chart-box" style="display:flex;align-items:center;gap:14px;"><div>${svg}</div><div style="flex:1;min-width:0;">${legend}</div></div>`;
  }

  // ---------- Combo bar + line chart (like "Written items by creation date") ----------
  function comboBarLine(categories, barSeries, lineSeries, opts) {
    opts = opts || {};
    const w = opts.width || 640, h = opts.height || 220;
    const padL = 46, padR = 46, padT = 16, padB = 28;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const n = categories.length;
    const stepX = n > 1 ? plotW / (n - 1) : plotW;

    const barMax = Math.max(1, ...barSeries.data);
    const lineMax = Math.max(1, ...lineSeries.data);

    const barW = Math.min(26, stepX * 0.5);
    let bars = "";
    barSeries.data.forEach((v, i) => {
      const x = padL + i * stepX - barW / 2;
      const bh = (v / barMax) * plotH;
      const y = padT + plotH - bh;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" fill="${barSeries.color || PALETTE[0]}"></rect>`;
    });

    let linePts = lineSeries.data.map((v, i) => {
      const x = padL + i * stepX;
      const y = padT + plotH - (v / lineMax) * plotH;
      return [x, y];
    });
    const pathD = linePts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
    const dots = linePts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="${lineSeries.color || PALETTE[3]}"></circle>`).join("");

    const xLabels = categories.map((c, i) => {
      const x = padL + i * stepX;
      return `<text x="${x.toFixed(1)}" y="${h - 8}" font-size="9.5" fill="#6a7680" text-anchor="middle">${esc(c)}</text>`;
    }).join("");

    const gridY = [0, 0.25, 0.5, 0.75, 1].map(f => {
      const y = padT + plotH * (1 - f);
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="#eef1f3" stroke-width="1"></line>`;
    }).join("");

    return `<div class="chart-box"><svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="xMidYMid meet">
      ${gridY}
      ${bars}
      <path d="${pathD}" fill="none" stroke="${lineSeries.color || PALETTE[3]}" stroke-width="2"></path>
      ${dots}
      ${xLabels}
    </svg>
    <div class="legend-row">
      <span><i class="dot" style="background:${barSeries.color || PALETTE[0]}"></i>${esc(barSeries.label)}</span>
      <span><i class="dot" style="background:${lineSeries.color || PALETTE[3]}"></i>${esc(lineSeries.label)}</span>
    </div></div>`;
  }

  // ---------- Simple bar chart (horizontal, for status lists) ----------
  function hBarList(data, opts) {
    opts = opts || {};
    const max = Math.max(1, ...data.map(d => d.value));
    const rows = data.map((d, i) => {
      const pct = Math.max(2, (d.value / max) * 100);
      const color = d.color || PALETTE[i % PALETTE.length];
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;">
        <div style="width:92px;font-size:11.5px;color:#44515c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(d.label)}</div>
        <div style="flex:1;background:#eef1f3;border-radius:3px;height:14px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:${color};"></div></div>
        <div style="width:54px;text-align:right;font-size:11.5px;font-weight:700;color:#1a2228;">${d.value.toLocaleString()}</div>
      </div>`;
    }).join("");
    return `<div class="chart-box">${rows}</div>`;
  }

  // ---------- Vertical bar chart (e.g. revenue by month) ----------
  function barChart(categories, values, opts) {
    opts = opts || {};
    const w = opts.width || 640, h = opts.height || 200;
    const padL = 54, padR = 16, padT = 14, padB = 26;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const n = categories.length;
    const stepX = plotW / n;
    const max = Math.max(1, ...values);
    const color = opts.color || PALETTE[0];

    const gridY = [0, 0.25, 0.5, 0.75, 1].map(f => {
      const y = padT + plotH * (1 - f);
      const val = Math.round(max * f);
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="#eef1f3" stroke-width="1"></line>
      <text x="${padL - 6}" y="${(y + 3).toFixed(1)}" font-size="9" fill="#8a949c" text-anchor="end">${opts.fmt ? opts.fmt(val) : val}</text>`;
    }).join("");

    const bars = values.map((v, i) => {
      const bw = stepX * 0.55;
      const x = padL + i * stepX + (stepX - bw) / 2;
      const bh = (v / max) * plotH;
      const y = padT + plotH - bh;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${color}" rx="1"></rect>`;
    }).join("");

    const labels = categories.map((c, i) => {
      const x = padL + i * stepX + stepX / 2;
      return `<text x="${x.toFixed(1)}" y="${h - 8}" font-size="9.5" fill="#6a7680" text-anchor="middle">${esc(c)}</text>`;
    }).join("");

    return `<div class="chart-box"><svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="xMidYMid meet">
      ${gridY}${bars}${labels}
    </svg></div>`;
  }

  global.BL_CHARTS = { donut, comboBarLine, hBarList, barChart, PALETTE, fmtMoney };
})(window);

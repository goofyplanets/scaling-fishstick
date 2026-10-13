function channel(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(255, n)) : 0;
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map(channel).map(v => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground), b = relativeLuminance(background);
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

function summarizeFrameTimes(samples) {
  const values = (samples || []).filter(v => Number.isFinite(v) && v >= 0).map(Number);
  if (!values.length) return { avg: 0, p50: 0, p95: 0, max: 0, over32: 0, total: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    avg: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted[sorted.length - 1],
    over32: values.filter(value => value > 32).length,
    total: values.length
  };
}

module.exports = { relativeLuminance, contrastRatio, summarizeFrameTimes };

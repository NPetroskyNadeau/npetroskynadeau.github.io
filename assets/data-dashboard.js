/* =====================================================================
   Data Dashboard shell + category registry  (served as data.html)

   Design goal: adding a new data category = appending one object to the
   CATEGORIES array below. The shell handles tabs, KPI strips, chart
   rendering, recession shading, country toggles, range sliders/presets,
   technical-detail disclosure, deep-link hashes, and GA4 events.

   Data arrays are loaded (as globals) by the <script> tags in the HTML:
     - SP_DATA, SP_DATA_CA                         (unemployment benchmarks)
     - BE_DATES/PAYROLL_GROWTH/BE_LR/BE_SR (+ _CA)  (breakeven payrolls)
     - LFT_DATES, LFT_LF_ACTUAL/TREND/PROJ, LFT_LFPR_ACTUAL/TREND/PROJ
   ===================================================================== */
(function () {
"use strict";

/* ---------- Shared style constants (mirror styles.css / data.html) ---- */
var COL = {
    navy:   '#2c5aa0',
    dark:   '#1a2332',
    teal:   '#00837E',
    red:    '#B63B36',
    gray:   '#888888',
    gold:   '#c8850a',
    salmon: '#DA6B5C',   // counterfactual line (distinct from teal actual; not a standalone gender mapping)
    text:   '#333333'
};
var FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/* Recession bands (peak->trough). US = NBER; CA = common dating. */
var RECESSIONS = {
    US: [
        ['1969-12-01','1970-11-01'], ['1973-11-01','1975-03-01'],
        ['1980-01-01','1980-07-01'], ['1981-07-01','1982-11-01'],
        ['1990-07-01','1991-03-01'], ['2001-03-01','2001-11-01'],
        ['2007-12-01','2009-06-01'], ['2020-02-01','2020-04-01']
    ],
    CA: [
        ['1981-06-01','1982-10-01'], ['1990-04-01','1992-04-01'],
        ['2008-10-01','2009-05-01'], ['2020-02-01','2020-04-01']
    ]
};

/* ---------- Small helpers --------------------------------------------- */
function lastNonNull(arr) {
    for (var i = arr.length - 1; i >= 0; i--) {
        if (arr[i] !== null && arr[i] !== undefined && !isNaN(arr[i])) return arr[i];
    }
    return null;
}
function lastNonNullDate(dates, arr) {
    for (var i = arr.length - 1; i >= 0; i--) {
        if (arr[i] !== null && arr[i] !== undefined && !isNaN(arr[i])) return dates[i];
    }
    return null;
}
function col(dataRows, idx) { return dataRows.map(function (r) { return r[idx]; }); }
function fmtMonthYear(s) {
    var d = new Date(s);
    return d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }) + ' ' + d.getUTCFullYear();
}
function fmtShortMY(s) {
    var d = new Date(s);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}
function fmtQuarter(s) {
    var d = new Date(s);
    return d.getUTCFullYear() + ':Q' + (Math.floor(d.getUTCMonth() / 3) + 1);
}
function slug(s) { return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function ga(name, params) { if (typeof gtag === 'function') gtag('event', name, params); }
/* Unique DOM-id prefix per chart. Uses slug() (keeps digits + hyphens) so ids
   that differ only by digits/case/separators do NOT collapse together. */
function chartPrefix(cat, chartSpec) { return slug(cat.id) + '__' + chartSpec.id; }
/* True only if every global name in `requires` is defined. Data files declare
   their series with top-level `const`, which are global-lexical (not on window),
   so we probe with `typeof` via eval (never throws, even for undeclared names). */
function hasData(cat) {
    if (!cat.requires) return true;
    for (var i = 0; i < cat.requires.length; i++) {
        try { if (eval('typeof ' + cat.requires[i]) === 'undefined') return false; }
        catch (e) { return false; }
    }
    return true;
}
// True on phone-width viewports; used to shrink canvas-drawn chart elements
// (legend, axis ticks) that CSS media queries can't reach.
function isMobile() { return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 600px)').matches; }

function pct1(v) { return (v === null || v === undefined || isNaN(v)) ? '—' : v.toFixed(1) + '%'; }
function kfmt(v) { return (v === null || v === undefined || isNaN(v)) ? '—' : Math.round(v) + 'K'; }

/* ---------- Demographic composition: browser-side counterfactual --------
   Everything is recomputed in the browser from the 10 sex x age cells (globals
   CELL_SHARE_{sex}_{age} / CELL_LFPR_{sex}_{age}, aligned to CELL_DATES). The
   aggregate participation rate is the exact un-normalized share-weighted sum of
   the cell rates, LFPR_t = sum_j w_j(t)*L_j(t); freezing the weights at a base
   year t0 gives the composition-constant counterfactual cf_t = sum_j w_j(t0)*L_j(t).
   Three "breakdowns" choose which composition dimension is frozen: the AGE
   marginal (sexes summed), the SEX marginal (ages summed), or the full AGE x SEX
   cells. The "actual" series is identical across breakdowns; only what the
   counterfactual holds fixed differs. */

var SEXES = ['M', 'F'];
var AGE_KEYS = ['16_24', '25_34', '35_44', '45_54', '55_pl'];
var AGE_TEXT = { '16_24': '16–24', '25_34': '25–34', '35_44': '35–44', '45_54': '45–54', '55_pl': '55+' };
var SEX_TEXT = { 'M': 'Men', 'F': 'Women' };

// Group colors. Age: single blue ramp deepening with age (mirrors the notes'
// DEMADJ_AGE_COLORS). Sex: teal (men) / amber (women), the site gender convention.
// Age x sex: men in a blue ramp, women in a gold->salmon ramp (mirrors DEMADJ_COLORS).
// The lightest ramp members are darkened off pure-pale so they clear WCAG non-text
// contrast as 2px lines on white (the youngest cohorts are exactly what readers track).
var AGE_RAMP = { '16_24': '#8fb0d0', '25_34': '#5f86b4', '35_44': '#4B5D77', '45_54': '#2f3f59', '55_pl': '#16263d' };
var SEX_RAMP = { 'M': '#00837E', 'F': '#c8850a' };
var CELL_RAMP = {
    'M_16_24': '#8fb0d0', 'M_25_34': '#6d88ab', 'M_35_44': '#5a7596', 'M_45_54': '#3c5578', 'M_55_pl': '#2C3143',
    'F_16_24': '#e8c06a', 'F_25_34': '#f0b921', 'F_35_44': '#e79a4d', 'F_45_54': '#da6b5c', 'F_55_pl': '#a84334'
};

// Human wording for the frozen dimension, used in labels/KPIs/sources.
var BREAKDOWN_NOUN = { age: 'age', sex: 'sex', agesex: 'age and sex' };

// The ordered groups for a breakdown: [{key, label, color}].
function groupsFor(breakdown) {
    if (breakdown === 'sex') {
        return SEXES.map(function (s) { return { key: s, label: SEX_TEXT[s], color: SEX_RAMP[s] }; });
    }
    if (breakdown === 'agesex') {
        var out = [];
        SEXES.forEach(function (s) {
            AGE_KEYS.forEach(function (a) {
                var g = s + '_' + a;
                out.push({ key: g, label: SEX_TEXT[s] + ' ' + AGE_TEXT[a], color: CELL_RAMP[g] });
            });
        });
        return out;
    }
    // default: age
    return AGE_KEYS.map(function (a) { return { key: a, label: AGE_TEXT[a], color: AGE_RAMP[a] }; });
}

// Read the 10 raw cell arrays from the globals into share/lfpr dicts keyed by
// 'M_16_24' etc. Lazily cached (the globals never change).
var _cells = null;
function cellData() {
    if (_cells) return _cells;
    var share = {}, lfpr = {};
    SEXES.forEach(function (s) {
        AGE_KEYS.forEach(function (a) {
            var g = s + '_' + a;
            share[g] = eval('CELL_SHARE_' + g);
            lfpr[g] = eval('CELL_LFPR_' + g);
        });
    });
    _cells = { share: share, lfpr: lfpr, n: CELL_DATES.length };
    return _cells;
}

/* Recompute the composition-constant counterfactual for a BREAKDOWN and a base
   YEAR (uses the first month whose year matches, i.e. January when present).
   Returns, aligned to CELL_DATES: the group weights `w` (frozen dimension's
   marginal share) and rates `L`, the `actual`/`cf`/`effect` aggregate series, and
   the per-group `contrib` = (w_g(t) - w_g(t0))*L_g(t) (sums exactly to effect).
   Pure function of the globals + (breakdown, year), so results are memoized. */
var _demoCache = {};
function demoCompute(breakdown, year) {
    var ck = breakdown + '|' + year;
    if (_demoCache[ck]) return _demoCache[ck];
    var cells = cellData();
    var n = cells.n;
    var groups = groupsFor(breakdown);

    // Base index: first month whose year matches (CELL_DATES are 'YYYY-MM' strings).
    var t0 = 0;
    for (var k = 0; k < n; k++) { if (CELL_DATES[k].slice(0, 4) === String(year)) { t0 = k; break; } }

    // Which raw cells feed each group (sum over the collapsed dimension).
    function cellsOf(gkey) {
        if (breakdown === 'sex') return AGE_KEYS.map(function (a) { return gkey + '_' + a; });
        if (breakdown === 'agesex') return [gkey];
        return SEXES.map(function (s) { return s + '_' + gkey; }); // age
    }

    // Per-group weight w_g(t) = sum of member cell shares; rate L_g(t) = the
    // share-weighted mean of member cell rates (= that cell's own rate for agesex).
    var w = {}, L = {};
    groups.forEach(function (grp) {
        var mem = cellsOf(grp.key);
        var wg = new Array(n), Lg = new Array(n);
        for (var t = 0; t < n; t++) {
            var sw = 0, swl = 0;
            for (var m = 0; m < mem.length; m++) {
                var c = mem[m];
                sw += cells.share[c][t];
                swl += cells.share[c][t] * cells.lfpr[c][t];
            }
            wg[t] = sw;
            Lg[t] = sw !== 0 ? swl / sw : null;
        }
        w[grp.key] = wg; L[grp.key] = Lg;
    });

    // Base-period aggregate rate LFPR_{t0}; the growth denominator and the reference
    // rate for the relative-share framing. (Equals actual[t0] once computed below.)
    var lfBase = 0;
    for (var gb = 0; gb < groups.length; gb++) { var kb = groups[gb].key; lfBase += w[kb][t0] * L[kb][t0]; }

    // Composition-constant counterfactual (existing) PLUS the full change-since-base
    // decomposition (new). For each group and month:
    //   share    = (w(t) - w(t0)) * L(t)              composition term (== contrib)
    //   rate     = w(t0) * (L(t) - L(t0))             behavioral term (base-weighted)
    //   gtot     = w(t)*L(t) - w(t0)*L(t0)            total group contribution (share+rate)
    //   relshare = (w(t) - w(t0)) * (L(t) - lfBase)   composition re-centered on LFPR_{t0}
    //   relcontrib = relshare + rate                  group total under the relative framing
    // sum_j gtot == actual - actual(t0); sum_j share == effect; sum_j relshare == sum_j share
    // (the reference terms (w(t)-w(t0))*lfBase cancel when the group shares sum to the same
    // value at t and t0 — guarded below).
    var actual = new Array(n), cf = new Array(n), effect = new Array(n);
    var contrib = {}, rate = {}, gtot = {}, relshare = {}, relcontrib = {};
    groups.forEach(function (grp) {
        contrib[grp.key] = new Array(n); rate[grp.key] = new Array(n);
        gtot[grp.key] = new Array(n); relshare[grp.key] = new Array(n);
        relcontrib[grp.key] = new Array(n);
    });
    for (var t = 0; t < n; t++) {
        var a = 0, c = 0;
        for (var gi = 0; gi < groups.length; gi++) {
            var key = groups[gi].key;
            a += w[key][t] * L[key][t];
            c += w[key][t0] * L[key][t];
            var sh = (w[key][t] - w[key][t0]) * L[key][t];
            var rt = w[key][t0] * (L[key][t] - L[key][t0]);
            var rs = (w[key][t] - w[key][t0]) * (L[key][t] - lfBase);
            contrib[key][t] = sh;
            rate[key][t] = rt;
            gtot[key][t] = w[key][t] * L[key][t] - w[key][t0] * L[key][t0];
            relshare[key][t] = rs;
            relcontrib[key][t] = rs + rt;
        }
        actual[t] = a; cf[t] = c; effect[t] = a - c;
    }

    // Relative-variant invariant guard (mirrors _shiftshare_core in lfp_series.py):
    // the reference terms cancel in the aggregate only when the endpoint's group-share
    // sum equals the base's. The sums are ~1 but dip to ~0.995 in 1983-89, so warn if
    // the current endpoint deviates from the base — the "aggregate unchanged" reading
    // of the relative framing would no longer hold.
    // Threshold 1e-4 separates a genuine break (the 1983-89 dip to ~0.995, a ~5e-3
    // deviation → ~0.3 pp residual) from the ~2e-6 rounding noise in the shipped
    // 6-decimal cell shares, which is immaterial.
    var i = n - 1, sSumEnd = 0, sSumBase = 0;
    for (var gg = 0; gg < groups.length; gg++) { var kg = groups[gg].key; sSumEnd += w[kg][i]; sSumBase += w[kg][t0]; }
    if (Math.abs(sSumEnd - sSumBase) > 1e-4 && typeof console !== 'undefined') {
        console.warn('demoCompute(' + breakdown + ',' + year + '): share-sum base ' +
            sSumBase.toFixed(6) + ' vs endpoint ' + sSumEnd.toFixed(6) +
            '; relative-framing reference term does not fully cancel (~' +
            ((sSumEnd - sSumBase) * lfBase).toFixed(3) + ' pp aggregate residual).');
    }

    var out = { n: n, t0: t0, breakdown: breakdown, groups: groups,
                w: w, L: L, actual: actual, cf: cf, effect: effect, contrib: contrib,
                rate: rate, gtot: gtot, relshare: relshare, relcontrib: relcontrib, lfBase: lfBase };
    _demoCache[ck] = out;
    return out;
}

/* Per-group latest-month readout for the "What's driving it" panels. Both framings
   decompose the group's total contribution to the change since the base into a
   composition part + a behavioral part; `framing` sets how the composition part reads:
   'relative' (default) re-centers it on the base-period aggregate rate (`relShare`), so
   a below-average group that gains share is a drag and `bar` = relShare + rate; 'total'
   uses each group's own rate (`share`) and `bar` = share + rate = gtot. Rows keep the
   canonical demographic order from groupsFor (youngest to oldest age group; for age ×
   sex, men then women each youngest to oldest) — the ONE shared ordering both panels
   use, so a row reads across. Also carries dShare / dRate (the raw input changes since
   base). Memoized by (breakdown, year) via demoCompute's cache. */
function demadjRankedLatest(breakdown, year, framing) {
    var r = demoCompute(breakdown, year);
    var i = r.n - 1, t0 = r.t0;
    return r.groups.map(function (g) {
        var k = g.key;
        var share = r.contrib[k][i], rt = r.rate[k][i], rs = r.relshare[k][i];
        var bar = framing === 'total' ? r.gtot[k][i] : r.relcontrib[k][i];  // default: relative
        return {
            key: k, label: g.label, color: g.color,
            bar: bar, contrib: share, share: share, rate: rt, relShare: rs,
            gtot: r.gtot[k][i], relcontrib: r.relcontrib[k][i],
            dShare: (r.w[k][i] - r.w[k][t0]) * 100,
            dRate: r.L[k][i] - r.L[k][t0]
        };
    });
}

// Filter a built chart spec to the trailing `years` (null = keep all). Slices
// spec.dates and every dataset's data to the window so the chart plots only
// in-window points — the correct way to zoom a time-series bar chart. Returns a
// shallow-cloned spec; the original (full) spec is left intact for later widening.
// Normalize a range token to number (trailing years) | {since:YYYY} | null (full).
// Accepts a number, the string "since:1999", a numeric string, or null/'null'/''.
function parseRangeToken(tok) {
    if (tok == null || tok === 'null' || tok === '') return null;
    if (typeof tok === 'number') return tok;
    // Already-normalized fixed-start object (e.g. the seeded default): pass through.
    if (typeof tok === 'object') return (tok.since) ? { since: tok.since } : null;
    if (typeof tok === 'string' && tok.indexOf('since:') === 0) {
        var y = parseInt(tok.slice(6), 10);
        return isNaN(y) ? null : { since: y };
    }
    var n = parseInt(tok, 10);
    return isNaN(n) ? null : n;
}

// Canonical comparison key for a range value (preset or state): 'full' | 'yN' |
// 'since:YYYY'. Lets button state + updates compare number and {since} uniformly.
function rangeKey(range) {
    var r = parseRangeToken(range);
    if (!r) return 'full';
    return (typeof r === 'object' && r.since) ? 'since:' + r.since : 'y' + r;
}

function filterSpecToYears(spec, range, anchorDate) {
    var r = parseRangeToken(range);
    if (!r) return spec;
    var dates = spec.dates;
    var cutoff;
    if (typeof r === 'object' && r.since) {
        // Fixed calendar start: "since 1999" always means Jan 1999, regardless of
        // how far the series extends (does not drift as the data updates).
        cutoff = new Date(Date.UTC(r.since, 0, 1));
    } else {
        // Trailing window: anchor at anchorDate (e.g. the last actual month) when
        // provided, so any projection tail AFTER the anchor is always kept;
        // otherwise anchor at the last date in the series.
        var anchor = anchorDate ? new Date(anchorDate) : new Date(dates[dates.length - 1]);
        cutoff = new Date(Date.UTC(anchor.getUTCFullYear() - r, anchor.getUTCMonth(), 1));
    }
    var start = 0;
    for (var i = 0; i < dates.length; i++) {
        if (new Date(dates[i]).getTime() >= cutoff.getTime()) { start = i; break; }
    }
    var out = {};
    for (var k in spec) if (spec.hasOwnProperty(k)) out[k] = spec[k];
    out.dates = dates.slice(start);
    var fullLen = dates.length;
    out.datasets = spec.datasets.map(function (d) {
        var nd = {};
        for (var kk in d) if (d.hasOwnProperty(kk)) nd[kk] = d[kk];
        // Slice `data` AND every per-point array property (e.g. backgroundColor /
        // borderColor arrays that carry one entry per bar) by the same offset, so
        // colors stay aligned to their data points in a trimmed window. Scalar
        // props (a single color string, numbers, flags) are copied unchanged.
        for (var p in d) {
            if (d.hasOwnProperty(p) && Array.isArray(d[p]) && d[p].length === fullLen) {
                nd[p] = d[p].slice(start);
            }
        }
        return nd;
    });
    return out;
}

// Trailing (backward) moving average of `arr` over `window` points. Each output
// is the mean of the current point and the prior window-1 points; positions
// without a full window (or spanning a null) are left null so the line starts
// only where a complete average exists. Non-mutating.
function trailingMA(arr, window) {
    if (!window || window < 2) return arr.slice();
    var out = new Array(arr.length).fill(null);
    for (var i = window - 1; i < arr.length; i++) {
        var sum = 0, ok = true;
        for (var j = i - window + 1; j <= i; j++) {
            if (arr[j] === null || arr[j] === undefined || isNaN(arr[j])) { ok = false; break; }
            sum += arr[j];
        }
        if (ok) out[i] = sum / window;
    }
    return out;
}

/* ---------- Recession-shading plugin ---------------------------------- */
/* Reads chart.$recessions (array of [start,end] ISO strings) and paints
   translucent bands within the plot area using the time scale. */
var recessionPlugin = {
    id: 'recessionBands',
    beforeDatasetsDraw: function (chart) {
        var bands = chart.$recessions;
        if (!bands || !bands.length) return;
        var xScale = chart.scales.x, area = chart.chartArea, ctx = chart.ctx;
        if (!xScale || !area) return;
        ctx.save();
        ctx.fillStyle = 'rgba(90, 90, 90, 0.10)';
        for (var i = 0; i < bands.length; i++) {
            var x0 = xScale.getPixelForValue(new Date(bands[i][0]).getTime());
            var x1 = xScale.getPixelForValue(new Date(bands[i][1]).getTime());
            var left = Math.max(area.left, Math.min(x0, x1));
            var right = Math.min(area.right, Math.max(x0, x1));
            if (right <= area.left || left >= area.right) continue;
            ctx.fillRect(left, area.top, right - left, area.bottom - area.top);
        }
        ctx.restore();
    }
};

/* ---------- End-of-line direct-label plugin --------------------------- */
/* For dense multi-line charts (chart.$endLabels === true), draw each series'
   label at its last non-null point in the series color, instead of relying on a
   crowded top legend. Labels are nudged vertically to avoid overlap and drawn in
   the right-margin gutter (the chart reserves right padding via layout.padding).
   Desktop only — on phones there's no horizontal room, so the legend is kept. */
var endLabelPlugin = {
    id: 'endLabels',
    afterDatasetsDraw: function (chart) {
        if (!chart.$endLabels || isMobile()) return;
        var area = chart.chartArea, ctx = chart.ctx;
        var yScale = chart.scales.y;
        if (!area || !yScale) return;
        // Collect the last visible point of each line.
        var pts = [];
        chart.data.datasets.forEach(function (ds, di) {
            var meta = chart.getDatasetMeta(di);
            if (meta.hidden) return;
            var data = ds.data || [];
            for (var i = data.length - 1; i >= 0; i--) {
                var v = data[i];
                if (v === null || v === undefined || isNaN(v)) continue;
                var el = meta.data[i];
                if (!el) break;
                pts.push({ y: el.y, color: ds.borderColor, text: ds.label });
                break;
            }
        });
        if (!pts.length) return;
        // De-collide vertically: sort by y and push apart by a minimum gap.
        pts.sort(function (a, b) { return a.y - b.y; });
        var gap = 13;
        for (var i = 1; i < pts.length; i++) {
            if (pts[i].y - pts[i - 1].y < gap) pts[i].y = pts[i - 1].y + gap;
        }
        // Clamp within the plot vertical extent.
        var overflow = pts.length ? pts[pts.length - 1].y - area.bottom : 0;
        if (overflow > 0) pts.forEach(function (p) { p.y -= overflow; });
        ctx.save();
        ctx.font = '11px ' + FONT;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        var x = area.right + 6;
        pts.forEach(function (p) {
            ctx.fillStyle = p.color;
            ctx.fillText(p.text, x, p.y);
        });
        ctx.restore();
    }
};

/* ---------- Chart option factory (single source of truth) ------------- */
function baseOptions(opts) {
    // opts: { yLabel, yMin, yMax, valueFmt, titleFmt, endLabels }
    // With direct end-of-line labels (dense multi-line views), hide the top legend
    // on desktop and reserve a right gutter for the labels; on mobile the end-label
    // plugin is off, so keep the legend there.
    var useEndLabels = opts.endLabels && !isMobile();
    return {
        responsive: true,
        // On phones, DON'T tie chart height to width (a 2:1 aspect on a ~330px-wide
        // screen leaves a tiny plot). Instead let the canvas fill a fixed-height
        // container sized in CSS (.chart-canvas-wrap on mobile) so the chart is big.
        maintainAspectRatio: !isMobile(),
        aspectRatio: 2,
        layout: useEndLabels ? { padding: { right: 96 } } : {},
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: {
                display: !useEndLabels,
                position: 'top',
                // Tighten the legend on phones so 3-4 series don't crowd the plot.
                labels: {
                    usePointStyle: true,
                    boxWidth: isMobile() ? 12 : 20,
                    padding: isMobile() ? 8 : 10,
                    color: COL.text,
                    font: { family: FONT, size: isMobile() ? 11 : 12 },
                    // Make the legend marker honor each line's dash pattern, so the
                    // projection entries render DASHED (matching the chart) instead of
                    // solid. The default generateLabels ignores borderDash for point-
                    // style line markers; copy it onto the item's lineDash.
                    generateLabels: function (chart) {
                        var items = Chart.defaults.plugins.legend.labels.generateLabels(chart);
                        // On phones, drop the "(36-mo)" drift-overlay duplicates from the
                        // legend only (the primary + projected entries stay). They're a
                        // secondary comparison series and would otherwise push the legend to
                        // 3-4 rows and crush the plot. Desktop keeps everything.
                        if (isMobile()) {
                            items = items.filter(function (item) {
                                var ds = chart.data.datasets[item.datasetIndex];
                                return !(ds && ds.isDriftOverlay);
                            });
                        }
                        items.forEach(function (item) {
                            var ds = chart.data.datasets[item.datasetIndex];
                            if (ds && ds.borderDash && ds.borderDash.length) item.lineDash = ds.borderDash;
                        });
                        return items;
                    }
                }
            },
            tooltip: {
                callbacks: {
                    title: function (c) { return opts.titleFmt(c[0].label); },
                    label: function (c) {
                        if (c.parsed.y === null) return null;
                        return revisionLabel(c, opts.valueFmt);
                    }
                }
            }
        },
        scales: {
            x: {
                type: 'time',
                time: { unit: 'year', tooltipFormat: 'yyyy-MM-dd', displayFormats: { year: 'yyyy' } },
                title: { display: false },
                // offset:false anchors ticks/gridlines at their EXACT date coordinate.
                // Bar charts default to offset:true (half-category padding), which shifts
                // every gridline off the year boundary — the misalignment we're fixing.
                // With offset:false each Jan-1 gridline sits exactly on the year start,
                // and align:'start' puts the year label just to its right.
                offset: false,
                grid: { offset: false },
                // autoSkip thins year labels when they'd collide (narrow phone widths);
                // keep them horizontal so they stay readable rather than rotating.
                ticks: { color: COL.text, font: { size: isMobile() ? 11 : 13, family: FONT }, maxRotation: 0, minRotation: 0, align: 'start', autoSkip: true, autoSkipPadding: isMobile() ? 8 : 4 }
            },
            y: {
                min: opts.yMin, max: opts.yMax,
                // Trim the y-title padding on phones so the axis label hugs the ticks
                // instead of leaving a wide empty gutter on the left.
                title: { display: true, text: opts.yLabel, color: COL.text, font: { size: isMobile() ? 11 : 13, family: FONT }, padding: isMobile() ? 0 : 4 },
                ticks: { color: COL.text, font: { size: isMobile() ? 11 : 13, family: FONT } },
                // Soft caps: auto-scale to the visible data (optimal viewing), but never
                // let the axis extend past yCapMin/yCapMax. Extremes beyond the cap run
                // off-edge; when data stays within, the axis shrinks to fit. Applied to
                // the data limits so Chart.js still computes nice ticks from the result.
                afterDataLimits: (opts.yCapMin != null || opts.yCapMax != null) ? function (scale) {
                    if (opts.yCapMin != null && scale.min < opts.yCapMin) scale.min = opts.yCapMin;
                    if (opts.yCapMax != null && scale.max > opts.yCapMax) scale.max = opts.yCapMax;
                } : undefined
            }
        }
    };
}

/* ---------- Dual-thumb range slider (ported from styles.css version) ---
   histEnd (ISO date | null): the last actual/history observation, used by the
   'HIST' preset to clip the view at the history/projection join — data-driven,
   no hardcoded year. entry (optional): the chart's state record; when the user
   drags a handle we clear any active preset button via entry.clearPresets(). */
function setupRangeSlider(prefix, chart, dates, histEnd, entry) {
    var minI = document.getElementById(prefix + 'RangeMin');
    var maxI = document.getElementById(prefix + 'RangeMax');
    var startL = document.getElementById(prefix + 'RangeStart');
    var endL = document.getElementById(prefix + 'RangeEnd');
    var fill = document.getElementById(prefix + 'TrackFill');
    var n = dates.length;

    function idxDate(i) { return fmtShortMY(dates[i]); }
    function nearestIndex(target) {
        var bestI = 0, bestD = Infinity;
        for (var i = 0; i < n; i++) {
            var d = Math.abs(new Date(dates[i]).getTime() - target.getTime());
            if (d < bestD) { bestD = d; bestI = i; }
        }
        return bestI;
    }
    function update() {
        var lo = parseInt(minI.value, 10), hi = parseInt(maxI.value, 10);
        if (lo >= hi) { lo = Math.max(0, hi - 1); minI.value = lo; }
        var iLo = Math.round(lo / 100 * (n - 1));
        var iHi = Math.round(hi / 100 * (n - 1));
        startL.textContent = idxDate(iLo);
        endL.textContent = idxDate(iHi);
        // announce the actual dates (not the 0-100 percent) to screen readers
        minI.setAttribute('aria-valuetext', idxDate(iLo));
        maxI.setAttribute('aria-valuetext', idxDate(iHi));
        fill.style.left = lo + '%';
        fill.style.width = (hi - lo) + '%';
        chart.options.scales.x.min = dates[iLo];
        chart.options.scales.x.max = dates[iHi];
        chart.update('none');
    }
    // Dragging a handle is a manual range change: drop any active preset highlight.
    function onManual() { if (entry && entry.clearPresets) entry.clearPresets(); update(); }
    minI.oninput = onManual;
    maxI.oninput = onManual;
    minI.value = 0; maxI.value = 100;
    update();
    // expose a preset setter used by quick-range buttons
    return function applyPreset(years) {
        if (years === null) { minI.value = 0; maxI.value = 100; update(); return; }
        if (years === 'HIST') {
            // Clip the end handle at the last actual observation (history only).
            minI.value = 0;
            maxI.value = histEnd ? Math.round(nearestIndex(new Date(histEnd)) / (n - 1) * 100) : 100;
            update();
            return;
        }
        // numeric: N years back from the last date
        var last = new Date(dates[n - 1]);
        var target = new Date(Date.UTC(last.getUTCFullYear() - years, last.getUTCMonth(), 1));
        minI.value = Math.round(nearestIndex(target) / (n - 1) * 100);
        maxI.value = 100;
        update();
    };
}

/* =====================================================================
   CATEGORY REGISTRY

   HOW TO ADD A CATEGORY (checklist):
   1. Export the aggregate series to assets/data/<slug>_data.js as top-level
      `const` globals. Prefer the PARALLEL-ARRAY shape (a shared DATES array +
      one array per series, null-padded), matching labor_force_data.js. Add a
      header comment: generator script, source, last obs, any projection join,
      units. (SP_DATA uses an older rows-of-arrays shape read via col(); new
      categories should not copy that.)
   2. Add a <script src="assets/data/<slug>_data.js"> tag in data.html
      BEFORE data-dashboard.js.
   3. Append one object to CATEGORIES below with a UNIQUE `id`.
   4. List every global name your closures use in `requires: [...]`. If any is
      missing at load, the shell degrades that ONE category to a placeholder
      (the rest of the page keeps working) — so this list is the safety net.
   5. Write kpis(country) and each charts[].build(country).

   CATEGORY SCHEMA
     id        (string, required, unique)  DOM ids + deep-link hash derive from it
     tab       (string, required)          label in the sticky tab row
     requires  (string[], recommended)     global names the closures need
     heading, subtitle, prose[] , reference (strings; reference '' allowed)
     hasCountry(bool)   render the US/CA toggle; build()/kpis() get 'US'|'CA'
     chartToggle(bool)  with >1 chart, show one at a time behind a View switch
                        (keeps tall panels from double-scrolling); charts may set
                        viewLabel for a short switch label (falls back to title)
     kpis(country) -> [{value,label,note,color}]  color: navy|teal|red|gray|gold
     charts[]  each: { id (unique within category), title, viewLabel, rangeSlider(bool),
                       presets ([{label, years}] | null; years: number | null(=Max)
                                | 'HIST'(=clip at histEnd)),
                       build(country) -> { dates, recession([[s,e]]|null),
                           histEnd(ISO|undefined; last actual obs, for 'HIST'),
                           yLabel, yMin, yMax, valueFmt(v), titleFmt(isoDate),
                           datasets[] (Chart.js dataset objects) },
                       source(country) -> html string }
     download  ({href,label,note} | omit)
     technical ([{label, html}]  collapsible detail boxes)
     pending   (string | omit)   render a "Coming soon" box instead of charts

   Each build(country) returns a Chart.js-ready spec; the shell owns tabs, KPI
   strip, recession shading, sliders/presets, toggles, and disclosure.
   ===================================================================== */
// Range presets shared by the demographic-composition time-series views
// (counterfactual, group rates, group shares). Default is a FIXED start of Jan
// 1999 (not a rolling window, so it does not drift as the data updates); "Full
// history" shows 1976+. The endpoint-bar "What's driving it" view has no date
// axis, so it omits these. Defined before CATEGORIES so the specs can reference it.
var DEMO_RANGE_DEFAULT = { since: 1999 };
var DEMO_RANGE_PRESETS = [
    { label: 'Since 1999', years: { since: 1999 } },
    { label: 'Full history', years: null }
];
var CATEGORIES = [

/* --- 1. Unemployment benchmarks ------------------------------------- */
{
    id: 'unemployment-benchmarks',
    tab: 'Unemployment Benchmarks',
    requires: ['SP_DATA', 'SP_DATA_CA'],
    heading: 'Benchmark Rates of Unemployment',
    subtitle: 'How hot or cold is the labor market, relative to its benchmarks?',
    prose: [
        'Policymakers monitor the unemployment rate closely, but the headline number alone does not reveal whether the labor market is running hot or cold. That assessment requires a benchmark.',
        'The horizon of interest gives two complementary benchmarks. The <em>longer-run</em> benchmark reflects the unemployment rate expected after all cyclical shocks dissipate; it moves slowly with demographics and structural features. The <em>stable-price</em> benchmark answers a different question: at what unemployment rate would inflation neither accelerate nor decelerate, given current conditions? This rate can shift quickly in response to large shocks.',
        'These two benchmarks typically coincide, as they did at roughly 4 percent in late 2019, but can diverge sharply when large disturbances alter the short-run unemployment&ndash;inflation relationship. Use the toggle to switch between the United States and Canada; Canada&rsquo;s benchmarks sit well above U.S. levels.',
        'A third line answers a different question again. Rather than asking where unemployment settles, the <em>potential minimum</em> asks how low it could go, building the answer from the bottom up: what each of 120 demographic groups has reached when conditions are as good as they get, weighted by labor-force shares. It is shown for the United States only.'
    ],
    reference: 'References: Crump, Nekarda, and Petrosky-Nadeau, "<a href="https://www.federalreserve.gov/econres/feds/unemployment-rate-benchmarks.htm" target="_blank">Unemployment Rate Benchmarks</a>," Finance and Economics Discussion Series 2020-072, 2020; Bok, Crump, Nekarda, and Petrosky-Nadeau, "<a href="https://www.frbsf.org/economic-research/publications/working-papers/2023/25/" target="_blank">Estimating Natural Rates of Unemployment: A Primer</a>," Federal Reserve Bank of San Francisco Working Paper 2023-25, 2023.',
    hasCountry: true,
    kpis: function (country) {
        var d = country === 'CA' ? SP_DATA_CA : SP_DATA;
        var unrate = lastNonNull(col(d, 1)), usp = lastNonNull(col(d, 2)), ulr = lastNonNull(col(d, 3));
        var date = lastNonNullDate(d.map(function (r) { return r[0]; }), col(d, 1));
        var out = [
            { value: pct1(unrate), label: 'Unemployment rate', note: date ? fmtQuarter(date) : '', color: 'red' },
            { value: pct1(usp), label: 'Stable-price benchmark (U-SP)', note: 'preferred estimate', color: 'navy' },
            { value: pct1(ulr), label: 'Longer-run benchmark (U-LR)', note: country === 'CA' ? 'model' : 'CBO', color: 'gray' }
        ];
        // Potential minimum: US only. SP_DATA_CA has no 5th column (the Canadian
        // estimate exists but is not published here), so this is gated, not nulled.
        if (country !== 'CA') {
            out.push({ value: pct1(lastNonNull(col(d, 4))), label: 'Potential minimum (U-PM)', note: 'bottom-up benchmark', color: 'gold' });
        }
        return out;
    },
    charts: [{
        id: 'benchmark',
        title: 'Estimates of Benchmark Rates of Unemployment',
        rangeSlider: true,
        // Two-tier progressive disclosure (matches Breakeven): the coarse presets
        // (10Y/20Y/Max) are the everyday range control on top; the fine-grained
        // dual-handle slider is gated into the "Chart options" disclosure below so
        // there aren't two competing range UIs on the primary surface (UI research
        // findings #6/#7).
        sliderInAdvanced: true,
        presets: [{ label: '10Y', years: 10 }, { label: '20Y', years: 20 }, { label: 'Max', years: null }],
        build: function (country) {
            var d = country === 'CA' ? SP_DATA_CA : SP_DATA;
            var lrLabel = country === 'CA' ? 'U-LR (model)' : 'U-LR (CBO)';
            var datasets = [
                // pointStyle:'line' -> legend shows line-style markers (matching
                // Breakeven), not the ambiguous hollow circles; the dashed U-LR
                // then renders as a dashed line swatch via the legend's
                // borderDash->lineDash copy in baseOptions.
                // The actual rate is the subject; the benchmarks are the reference. Weight
                // carries that hierarchy (2.5 primary / 2 secondary / 1.5 dashed U-LR is
                // the same vocabulary the Breakeven chart uses), and order:-1 draws it
                // over the benchmarks so the crossings in 1997-2007 don't break it up.
                { label: 'Unemployment rate', data: col(d, 1), borderColor: COL.red, borderWidth: 2.5, pointRadius: 0, tension: 0.1, pointStyle: 'line', order: -1 },
                { label: 'U-SP (preferred)', data: col(d, 2), borderColor: COL.navy, borderWidth: 2, pointRadius: 0, tension: 0.1, pointStyle: 'line' },
                { label: lrLabel, data: col(d, 3), borderColor: COL.gray, borderWidth: 1.5, borderDash: [8, 4], pointRadius: 0, tension: 0.1, pointStyle: 'line' }
            ];
            // Potential minimum (US only). Gold, not teal: teal reads as navy on screen
            // next to U-SP, and CIEDE2000 says the real problem was teal against the gray
            // dashed U-LR — dE 4.6 under protanopia, i.e. the same color. Gold lifts the
            // chart's weakest pair to 17.5 (red/gold under deuteranopia) and makes
            // navy/gold the strongest pair here at 61.6. The cost is contrast against
            // white, 3.1:1 vs teal's 4.6:1 — still over the 3:1 floor for a graphical
            // object, and the reason the KPI swatch uses a darker gold for text.
            // Solid throughout with no cutoff marker (NPN's call) — the held tail is
            // disclosed in the "Potential minimum" technical box, not on the chart and
            // no longer in the source line.
            if (country !== 'CA') {
                datasets.push({ label: 'U-PM (potential minimum)', data: col(d, 4), borderColor: COL.gold, borderWidth: 2, pointRadius: 0, tension: 0.1, pointStyle: 'line' });
            }
            return {
                dates: d.map(function (r) { return r[0]; }),
                recession: RECESSIONS[country],
                yLabel: 'Percent', yMin: 2, yMax: 14,
                valueFmt: function (v) { return v.toFixed(2) + '%'; },
                titleFmt: fmtQuarter,
                datasets: datasets
            };
        },
        source: function (country) {
            return country === 'CA'
                ? 'Source: author&rsquo;s estimates following Bok, Crump, Nekarda, and Petrosky-Nadeau (2023), applied to Statistics Canada and Bank of Canada data through 2026:Q1. U-SP begins 2000:Q1; U-LR is the model estimate.'
                // Keep this to one clause per plotted series. The potential minimum's
                // method, its 2018:Q2 cutoff and the carry-forward all live in the
                // "Potential minimum" technical box instead (NPN's call).
                : 'Source: U-SP follows Bok, Crump, Nekarda, and Petrosky-Nadeau, "Estimating Natural Rates of Unemployment: A Primer" (2023), updated through 2026:Q1. The potential minimum is the author&rsquo;s calculation applying that paper&rsquo;s method; see Technical Details. CBO NROU from the Congressional Budget Office.';
        }
    }],
    download: { href: 'assets/data/unemployment_benchmarks_data.csv', label: 'Download data (CSV)', note: 'includes United States and Canada, with suggested citation in the file header; the potential-minimum column is United States only.' },
    technical: [
        { label: 'Model', html: '<p>The estimate comes from a Phillips curve relationship embedded in a state-space model. The observation equation links changes in inflation to the unemployment gap&mdash;the difference between the actual unemployment rate and the unobserved natural rate&mdash;which follows a random walk. Parameters are estimated by maximum likelihood over 1985:Q1&ndash;2019:Q4 (excluding the pandemic), and the Kalman filter tracks the natural rate through the latest quarter. One parameter, the volatility of the natural-rate random walk, is calibrated to avoid a well-known identification problem.</p><p><strong>Canada.</strong> The Canadian stable-price rate uses the same model estimated over 2000:Q1&ndash;2019:Q4 (the exchange-rate control&rsquo;s data begin in 1999). The Canadian long-run rate is a demographic decomposition weighting each group&rsquo;s unemployment rate by its labor-force share.' },
        { label: 'Potential minimum', html: '<p><strong>United States only.</strong> This series is the author&rsquo;s calculation, applying the method set out in the working paper referenced above to data through 2026:Q1. It is not an estimate reported in that paper, whose own figures end in 2021:Q4 and treat the closing quarters differently, as described below. The potential minimum takes a different approach to a benchmark, adapting to unemployment a method DeLong and Summers (1988) developed for potential output. The labor force is divided into 120 groups by sex, age, education, and race or ethnicity. Within each group, the estimate traces a floor forward through the sample. In any given quarter that floor declines at the slowest rate consistent with the lowest unemployment rate the group goes on to record over the following eight years. The benchmark is the sum of those group floors, weighted by labor-force shares. Dividing the labor force into groups rather than treating it as a whole lowers the resulting benchmark a touch, as each group&rsquo;s minimum is not always reached in the same quarter.</p><p><strong>End of sample.</strong> The eight-year look-ahead means that on data ending in 2026:Q1, the last quarter the method can estimate is 2018:Q2. Each group keeps its estimated floor from that quarter thereafter, so the benchmark moves only with the changing composition of the labor force. That amounts to a net 0.02 percentage point through 2026:Q1, though the path is not flat: it declines about a tenth of a percentage point in 2020, when the pandemic changed who was in the labor force. The line is drawn solid throughout, but its closing quarters carry the last estimate forward rather than adding new ones.</p><p><strong>Unemployment has run below it.</strong> The unemployment rate averaged 3.5% from mid-2022 through mid-2023, a few hundredths of a percentage point below this benchmark. That is not a contradiction. The benchmark is built from each group&rsquo;s lowest recorded rate, not from a bound on what any group can achieve next, and in these closing quarters each group&rsquo;s floor is fixed at its 2018:Q2 value. Groups that went on to better their own records can therefore pull the aggregate below it.</p>' },
        { label: 'Data', html: '<p>The model takes three inputs as quarterly averages of monthly BLS/FRED data: the civilian unemployment rate, core PCE inflation (year-over-year), and the broad trade-weighted dollar index (year-over-year). The preferred specification uses a counterfactual unemployment rate that removes excess temporary layoffs relative to their 2019:Q4 share, so the pandemic spike is not read as a jump in the natural rate. The estimation sample runs 1985:Q1&ndash;2019:Q4; the filter extends the estimate through 2026:Q1.</p><p><strong>Canada.</strong> Canadian estimates use Labour Force Survey unemployment, the Bank of Canada&rsquo;s CPI-trim core inflation, and the Canadian effective exchange rate, with the same temporary-layoff adjustment.</p><p><strong>Potential minimum.</strong> The 120-group panel of unemployment rates and labor-force shares is built from Current Population Survey (CPS) microdata. The group series are seasonally adjusted with X-13ARIMA-SEATS. October 2025 is missing from the survey and is imputed as the average of September and November. The panel begins in 1976; the chart starts in 1985 to match the other two series.</p>' }
    ]
},

/* --- 2. Breakeven payrolls ------------------------------------------ */
{
    id: 'breakeven-payrolls',
    tab: 'Breakeven Payrolls',
    requires: ['BE_DATES', 'BE_LR', 'BE_SR', 'PAYROLL_GROWTH', 'BE_DATES_CA', 'BE_LR_CA', 'BE_SR_CA', 'PAYROLL_GROWTH_CA'],
    heading: 'Breakeven Payroll Growth',
    subtitle: 'How many jobs a month keep unemployment from rising?',
    prose: [
        'How many jobs must the economy create each month to keep the unemployment rate from rising? The answer depends almost entirely on how fast the labor force is growing.',
        'This <em>breakeven</em> pace equals trend labor-force growth times the share of the labor force that is employed. When actual job creation exceeds breakeven, unemployment tends to fall; when it falls short, unemployment tends to rise. The <em>long-run</em> breakeven captures slow demographic forces; the <em>short-run</em> breakeven captures medium-frequency variation from immigration, participation, and population growth.',
        'For the United States, the dashed lines extend the estimate to 2028 using a demographic labor-force projection, and the <em>endpoint drift</em> control shows how sensitive the latest reading is to how the recent trend is carried forward. See Technical details for how the projection is built.',
        'The same framework applies to Canada. Because Canada&rsquo;s labor force is roughly one-seventh the U.S. size, its breakeven pace is smaller in absolute terms&mdash;compare actual hiring to the breakeven line <em>within</em> each country. For Canada, hiring is measured by establishment-survey employment (SEPH), the closest analogue to U.S. nonfarm payrolls.'
    ],
    reference: 'Reference: Petrosky-Nadeau and Stewart, "<a href="https://www.frbsf.org/research-and-insights/publications/economic-letter/2024/07/breakeven-employment-growth/" target="_blank">Breakeven Employment Growth</a>," FRBSF Economic Letter 2024-18, 2024.',
    hasCountry: true,
    kpis: function (country, drift) {
        drift = drift || 'full';
        var isCA = country === 'CA';
        var dates = isCA ? BE_DATES_CA : BE_DATES;
        var lr = isCA ? BE_LR_CA : BE_LR, sr = isCA ? BE_SR_CA : BE_SR;
        var pay = isCA ? PAYROLL_GROWTH_CA : PAYROLL_GROWTH;
        var payV = lastNonNull(pay);
        var payDate = lastNonNullDate(dates, pay);
        // US breakeven KPIs read the spliced series at the join month (last actual),
        // matching the chart. Canada uses the published series' latest value.
        var lrV, srV, beDate;
        var splAvail = !isCA && typeof BE_SPL_DATES !== 'undefined' && BE_SPL_DATES.length;
        if (splAvail) {
            var j = BE_SPL_DATES.indexOf(BE_SPL_NOW);
            lrV = (drift === 'loc' ? BE_SPL_LR_LOC : BE_SPL_LR_FULL)[j];
            srV = (drift === 'loc' ? BE_SPL_SR_LOC : BE_SPL_SR_FULL)[j];
            beDate = BE_SPL_NOW;
        } else {
            lrV = lastNonNull(lr); srV = lastNonNull(sr);
            beDate = lastNonNullDate(dates, sr);
        }
        var beNote = beDate ? fmtMonthYear(beDate) : 'jobs/month';
        return [
            { value: kfmt(lrV), label: 'Long-run breakeven', note: beNote, color: 'navy' },
            { value: kfmt(srV), label: 'Short-run breakeven', note: beNote, color: 'gold' },
            { value: kfmt(payV), label: isCA ? 'Latest SEPH employment' : 'Latest payroll growth', note: payDate ? fmtMonthYear(payDate) : '', color: 'gray' }
        ];
    },
    charts: [{
        id: 'breakeven',
        title: 'Estimates of Breakeven Payroll Growth',
        // Range presets FILTER the data to a trailing HISTORY window measured back
        // from the last actual month (not the projection end), and ALWAYS keep the
        // full projection tail. So '3Y' shows 3 years of history + projection to
        // 2028; 'All' (years:null) shows everything (2016 -> 2028, the default).
        // The shell honors `rangeAnchor: 'histEnd'` to cut relative to histEnd.
        rangeSlider: false,
        rangeAnchor: 'histEnd',
        // Default to 5Y: the full 'All' (2016+) view is dominated by the COVID
        // swing in the raw 12-month payroll average, which blows out the y-axis;
        // 5Y lands post-COVID and keeps the breakeven lines + projection readable.
        defaultYears: 5,
        rangePresets: [
            { label: '3Y', years: 3 },
            { label: '5Y', years: 5 },
            { label: '10Y', years: 10 },
            { label: 'All', years: null }
        ],
        // Smoothing toggle: trailing moving average of payroll growth. Default is
        // 12-mo; window=0 -> No smoothing (raw bars only). Shell reads state[cat].smoothing.
        smoothing: [
            { label: '12-mo avg', window: 12 },
            { label: '6-mo avg', window: 6 },
            { label: 'No smoothing', window: 0 }
        ],
        // Endpoint-drift OVERLAY toggle (US only). Full-sample is the always-on
        // baseline; 'loc' ADDS the 36-month-drift lines on top for comparison
        // (not a swap). Shell reads state[cat].drift ('full' = baseline only,
        // 'loc' = baseline + 36-month overlay).
        driftOptions: [
            { label: 'Full-sample', drift: 'full' },
            { label: '+ 36-month', drift: 'loc' }
        ],
        // Projection show/hide (US only). Shell reads state[cat].showProj (default true).
        projectionToggle: [
            { label: 'Show', showProj: true },
            { label: 'Hide', showProj: false }
        ],
        // Two-tier progressive disclosure (UI research, FRED model): keep the
        // everyday rail to Country + Range; gate Smoothing, Endpoint drift, and
        // Projection behind a "Chart options" disclosure below the chart. These
        // are legibility/methodology/secondary controls, not the primary view.
        advanced: ['smoothing', 'drift', 'projection'],
        build: function (country, ma, drift, showProj) {
            ma = (ma === undefined) ? 12 : ma;
            drift = drift || 'full';
            showProj = (showProj === undefined) ? true : showProj;
            var isCA = country === 'CA';
            var dates = isCA ? BE_DATES_CA : BE_DATES;
            var lr = isCA ? BE_LR_CA : BE_LR, sr = isCA ? BE_SR_CA : BE_SR;
            var pay = isCA ? PAYROLL_GROWTH_CA : PAYROLL_GROWTH;
            // US only: replace the published history LR/SR with ONE continuous
            // seam-reconciled spliced series (breakeven_projection_data.js), drawn
            // solid through the join month and dashed after — same construction on
            // both sides, so there is no discrete jump where the projection starts.
            // Full-sample is the baseline; the 36-month overlay is added when drift
            // === 'loc'. Payroll comes from BE_SPL_PAY on the same 2016-2028 axis.
            var splAvail = !isCA && typeof BE_SPL_DATES !== 'undefined' && BE_SPL_DATES.length;
            var lrHist = null, srHist = null, lrProj = null, srProj = null;
            var lrHistL = null, srHistL = null, lrProjL = null, srProjL = null;
            if (splAvail) {
                var nowIdx = BE_SPL_DATES.indexOf(BE_SPL_NOW);
                dates = BE_SPL_DATES;
                pay = (typeof BE_SPL_PAY !== 'undefined') ? BE_SPL_PAY : pay;
                var splitHist = function (a) { return a.map(function (v, i) { return i <= nowIdx ? v : null; }); };
                var splitProj = function (a) { return a.map(function (v, i) { return i >= nowIdx ? v : null; }); };
                // Baseline (full-sample drift)
                lrHist = splitHist(BE_SPL_LR_FULL); srHist = splitHist(BE_SPL_SR_FULL);
                lrProj = splitProj(BE_SPL_LR_FULL); srProj = splitProj(BE_SPL_SR_FULL);
                lr = lrHist; sr = srHist;
                // Overlay (36-month local drift), only when requested
                if (drift === 'loc') {
                    lrHistL = splitHist(BE_SPL_LR_LOC); srHistL = splitHist(BE_SPL_SR_LOC);
                    lrProjL = splitProj(BE_SPL_LR_LOC); srProjL = splitProj(BE_SPL_SR_LOC);
                }
            }
            // Payroll bars are drawn at their RAW magnitude (no ±500K clip): the
            // moving-average line is uncapped, so clipping only the bars would be
            // inconsistent. The COVID months therefore run to full scale.
            var barVals = pay.slice();
            // When a moving average is on, fade the raw bars so the MA line reads
            // as the foreground signal; otherwise use the normal bar opacity.
            var barFill = ma ? 0.10 : 0.25, barNeg = ma ? 0.15 : 0.40;
            var bg = barVals.map(function (v) { return v !== null && v < 0 ? 'rgba(183,59,54,' + barNeg + ')' : 'rgba(44,90,160,' + barFill + ')'; });
            var bd = barVals.map(function (v) { return v !== null && v < 0 ? 'rgba(183,59,54,' + (barNeg + 0.2) + ')' : 'rgba(44,90,160,' + (barFill + 0.15) + ')'; });
            // Prior-revision ghost bars: only for the CA path (its payroll is on
            // BE_DATES_CA). The US path now uses BE_SPL_PAY on the spliced axis, so
            // the old PAYROLL_GROWTH_PRIOR (2022+ BE_DATES) would misalign — skip it.
            var priorRaw = isCA ? (typeof PAYROLL_GROWTH_PRIOR_CA !== 'undefined' ? PAYROLL_GROWTH_PRIOR_CA : null) : null;
            var prior = priorRaw ? priorRaw.slice() : null;   // raw (unclipped), matches bars
            var hasRevisions = prior && prior.some(function (v) { return v !== null; });
            var datasets = [
                { label: isCA ? 'SEPH employment growth' : 'Nonfarm payroll growth', data: barVals, type: 'bar', backgroundColor: bg, borderColor: bd, borderWidth: 1, order: 2, isPayroll: true, pointStyle: 'rect' },
                { label: 'Long-run breakeven', data: lr, type: 'line', borderColor: COL.navy, borderWidth: 2.5, pointRadius: 0, tension: 0.1, order: 1, pointStyle: 'line' },
                { label: 'Short-run breakeven', data: sr, type: 'line', borderColor: COL.gold, borderWidth: 2.5, pointRadius: 0, tension: 0.1, spanGaps: false, order: 0, pointStyle: 'line' }
            ];
            if (lrProj && showProj) {
                // Dashed forward paths (projection). Same colors as history, dashed.
                datasets.push(
                    { label: 'Long-run breakeven (projected)', data: lrProj, type: 'line', borderColor: COL.navy, borderWidth: 2, borderDash: [6, 4], pointRadius: 0, tension: 0.1, spanGaps: false, order: 1, isProjection: true, pointStyle: 'line' },
                    { label: 'Short-run breakeven (projected)', data: srProj, type: 'line', borderColor: COL.gold, borderWidth: 2, borderDash: [6, 4], pointRadius: 0, tension: 0.1, spanGaps: false, order: 0, isProjection: true, pointStyle: 'line' }
                );
            }
            if (lrHistL) {
                // 36-month-drift OVERLAY (lighter/thinner) so both drifts compare at
                // once against the full-sample baseline. History solid, projection dashed.
                datasets.push(
                    { label: 'Long-run breakeven (36-mo)', data: lrHistL, type: 'line', borderColor: COL.navyLight || 'rgba(44,90,160,0.55)', borderWidth: 1.75, pointRadius: 0, tension: 0.1, spanGaps: false, order: 1, isDriftOverlay: true, pointStyle: 'line' },
                    { label: 'Short-run breakeven (36-mo)', data: srHistL, type: 'line', borderColor: 'rgba(230,168,23,0.65)', borderWidth: 1.75, pointRadius: 0, tension: 0.1, spanGaps: false, order: 0, isDriftOverlay: true, pointStyle: 'line' }
                );
                if (showProj) {
                    datasets.push(
                        { label: 'Long-run breakeven (36-mo, projected)', data: lrProjL, type: 'line', borderColor: COL.navyLight || 'rgba(44,90,160,0.55)', borderWidth: 1.5, borderDash: [3, 3], pointRadius: 0, tension: 0.1, spanGaps: false, order: 1, isDriftOverlay: true, pointStyle: 'line' },
                        { label: 'Short-run breakeven (36-mo, projected)', data: srProjL, type: 'line', borderColor: 'rgba(230,168,23,0.65)', borderWidth: 1.5, borderDash: [3, 3], pointRadius: 0, tension: 0.1, spanGaps: false, order: 0, isDriftOverlay: true, pointStyle: 'line' }
                    );
                }
            }
            if (ma) {
                // Trailing MA of raw payroll growth. For the US spliced axis, use the
                // PRECOMPUTED arrays (BE_SPL_PAY_MA*), which are built in Python with a
                // pre-2016 lead-in so the line is complete from the first shown month
                // (Jan 2016) — a browser MA over the 2016+ array alone would be null for
                // its first 11 months. Fall back to a browser MA (Canada / no precompute).
                var avg;
                if (splAvail && ma === 12 && typeof BE_SPL_PAY_MA12 !== 'undefined') avg = BE_SPL_PAY_MA12;
                else if (splAvail && ma === 6 && typeof BE_SPL_PAY_MA6 !== 'undefined') avg = BE_SPL_PAY_MA6;
                else avg = trailingMA(pay, ma);
                datasets.push({
                    label: ma + '-month average', data: avg, type: 'line',
                    borderColor: COL.teal, borderWidth: 2.5, pointRadius: 0, tension: 0.25,
                    spanGaps: false, order: 0, isMA: true, maWindow: ma, pointStyle: 'line'
                });
            }
            if (hasRevisions) {
                // Insert the ghost bar right after the payroll bars so it shares
                // their axis; grouped:false overlays rather than shrinking bars.
                datasets.splice(1, 0, {
                    label: 'Prior estimate', data: prior, type: 'bar',
                    backgroundColor: 'rgba(0,0,0,0)', borderColor: 'rgba(120,120,120,0.9)',
                    borderWidth: 1.25, borderDash: [3, 2], grouped: false, order: 3,
                    isPrior: true, revisedData: barVals
                });
            }
            return {
                dates: dates,
                recession: null,
                // Join month (last actual) — range presets anchor their trailing
                // window here so the projection tail is always kept.
                histEnd: splAvail ? BE_SPL_NOW : lastNonNullDate(dates, sr),
                // US only: SOFT-cap the y-axis at ±1000 for readability. The axis
                // auto-scales to the visible data (optimal viewing when it's small, e.g.
                // the 5Y window), but never extends past ±1000 — so the COVID payroll
                // bar (-20,469) and MA spikes run off-edge in the 'All' view rather than
                // crushing the breakeven lines. Bars/MA keep true values (tooltips too).
                // Canada (~±30K) has no cap and stays fully auto-scaled.
                yLabel: 'Thousands of jobs per month',
                yMin: undefined, yMax: undefined,
                yCapMin: isCA ? undefined : -1000, yCapMax: isCA ? undefined : 1000,
                valueFmt: function (v) { return v.toFixed(0) + 'K'; },
                titleFmt: fmtShortMY,
                datasets: datasets
            };
        },
        source: function (country) {
            return country === 'CA'
                ? 'Source: Statistics Canada (LFS 14-10-0287; SEPH 14-10-0223) and author&rsquo;s calculations, following Petrosky-Nadeau and Stewart (2024). Reference unemployment rate 6.0 percent. Payroll bars are SEPH employment.'
                : 'Source: BLS via FRED and author&rsquo;s calculations. Breakeven payroll growth based on Petrosky-Nadeau and Stewart (2024). Reference unemployment rate 4.4 percent (CBO longer-run natural rate). Payroll bars are total nonfarm payrolls; the 12-month average is shown by default (use the smoothing control to change it). The dashed forward path (through 2028) splices a Census-based demographic labor-force projection onto the actual series so the current month is estimated as an interior point rather than a one-sided endpoint; the endpoint-drift toggle shows its sensitivity to how the trend is extrapolated.';
        }
    }],
    download: { href: 'assets/data/breakeven_payrolls_data.csv', label: 'Download data (CSV)', note: 'includes United States and Canada, with suggested citation in the file header.' },
    technical: [
        { label: 'Methodology', html: '<p>The breakeven formula is <em>dN<sub>be</sub> = (1 &minus; &#363;) &times; dLF<sub>trend</sub></em>, where <em>&#363;</em> is a reference unemployment rate (4.4 percent for the U.S.; 6.0 percent for Canada) and <em>dLF<sub>trend</sub></em> is the monthly change in trend labor force. Trend labor force is extracted with a Christiano-Fitzgerald asymmetric band-pass filter. The long-run filter passes 2&ndash;480 month cycles; the short-run filter passes 2&ndash;72 months and is applied separately pre- and post-COVID because the pandemic broke the series.</p><p><strong>Projection (U.S., dashed).</strong> Because the filter is one-sided at the end of the sample, the most recent ~24 months are sensitive to how the trend is assumed to continue. The dashed forward path (through 2028) addresses this by splicing a Census-based demographic labor-force projection onto the actual series&mdash;level-matched at the join so there is no discontinuity&mdash;and filtering the combined series, which turns the current month into an interior point. The <em>endpoint-drift</em> toggle makes the remaining sensitivity explicit: <em>full-sample</em> drift extrapolates the long-run average slope, while <em>36-month</em> drift uses the trailing three-year slope. On the spliced series the two nearly coincide for the short-run measure (the projection removes most of the sensitivity) and differ by a few thousand for the long-run measure.</p>' },
        { label: 'Sources', html: '<p>U.S.: civilian labor force (CLF16OV) for the trend and total nonfarm payrolls (PAYEMS) for the bars, both from BLS via FRED; the forward projection uses U.S. Census Bureau population projections via the author&rsquo;s demographic labor-force model. Canada: labour force (LFS 14-10-0287) for the trend and SEPH employment (14-10-0223) for the bars, from Statistics Canada (no projection). Estimates update after each monthly release; the U.S. chart shows January 2016 onward, with the projection extending to December 2028 (Canada shows January 2022 onward).</p>' }
    ]
},

/* --- 3. Labor force trends ------------------------------------------ */
{
    id: 'labor-force-trends',
    tab: 'Labor Force Trends',
    requires: ['LFT_DATES', 'LFT_LF_ACTUAL', 'LFT_LF_TREND', 'LFT_LF_PROJ', 'LFT_LFPR_ACTUAL', 'LFT_LFPR_TREND', 'LFT_LFPR_PROJ'],
    heading: 'Labor Force Trends and Projections',
    subtitle: 'The underlying growth of the labor force, through 2035',
    prose: [
        'How fast is the labor force really growing once the swings of the business cycle are stripped away? The answer shapes how many jobs the economy needs each month and how much the workforce will expand over the coming decade.',
        'The trend below is built from a demographic decomposition: the population is split into narrow sex-by-age cells, each cell&rsquo;s participation rate is smoothed to remove cyclical and seasonal variation, and the cells are recombined using population shares. This separates changes in <em>how much</em> each group participates from the shifting age composition of the population.',
        'The same framework projects forward. Holding each group&rsquo;s trend participation rate fixed at its latest value, official Census population projections drive the changing demographic mix to 2035 (dashed line). The two charts show the participation rate, in percent, and the labor force level, in millions.'
    ],
    reference: 'Reference: Petrosky-Nadeau, "Labor Market Trends and Projections" (methodology note, 2026).',
    hasCountry: false,
    chartToggle: true, // two charts (level + rate); show one at a time
    kpis: function () {
        var lfprA = lastNonNull(LFT_LFPR_ACTUAL);
        var lfprDate = lastNonNullDate(LFT_DATES, LFT_LFPR_ACTUAL);
        var lfprProj = lastNonNull(LFT_LFPR_PROJ);
        var lvlProj = lastNonNull(LFT_LF_PROJ);
        var projDate = lastNonNullDate(LFT_DATES, LFT_LF_PROJ);
        return [
            { value: pct1(lfprA), label: 'Participation rate', note: lfprDate ? fmtShortMY(lfprDate) : '', color: 'gray' },
            { value: pct1(lfprProj), label: 'Projected participation', note: projDate ? fmtShortMY(projDate).slice(0, 4) : '', color: 'navy' },
            { value: (lvlProj === null || isNaN(lvlProj)) ? '—' : (lvlProj / 1000).toFixed(1) + 'M', label: 'Projected labor force', note: projDate ? fmtShortMY(projDate).slice(0, 4) : '', color: 'teal' }
        ];
    },
    charts: [
        {
            id: 'lfpr',
            title: 'Labor Force Participation Rate',
            viewLabel: 'Participation rate',
            // Discrete range presets that filter the data (no axis clamp). 'Recent'
            // is a 25-year window off the 2035 projection end (~2010-2035); 'Full'
            // (years:null) shows all of 1976-2035 and is the default.
            rangeSlider: false,
            rangePresets: [
                { label: 'Recent', years: 25 },
                { label: 'Full', years: null }
            ],
            build: function () {
                return {
                    dates: LFT_DATES, recession: null,
                    histEnd: lastNonNullDate(LFT_DATES, LFT_LFPR_ACTUAL),
                    yLabel: 'Percent', yMin: undefined, yMax: undefined,
                    valueFmt: function (v) { return v.toFixed(2) + '%'; },
                    titleFmt: fmtShortMY,
                    datasets: [
                        { label: 'Participation rate (actual)', data: LFT_LFPR_ACTUAL, borderColor: COL.gray, borderWidth: 1.5, pointRadius: 0, tension: 0.1, spanGaps: false, order: 3, pointStyle: 'line' },
                        { label: 'Demographic trend', data: LFT_LFPR_TREND, borderColor: COL.teal, borderWidth: 2.5, pointRadius: 0, tension: 0.1, spanGaps: false, order: 2, pointStyle: 'line' },
                        { label: 'Projection (Census)', data: LFT_LFPR_PROJ, borderColor: COL.navy, borderWidth: 2, borderDash: [6, 4], pointRadius: 0, tension: 0.1, spanGaps: false, order: 1, pointStyle: 'line' }
                    ]
                };
            },
            source: function () { return 'Source: author&rsquo;s demographic-decomposition trend from BLS Current Population Survey microdata; Census Bureau population projections. The seasonally adjusted aggregate rate and the smoothed trend join the projection (dashed) at the latest trend observation.'; }
        },
        {
            id: 'lflvl',
            title: 'Labor Force Level',
            viewLabel: 'Level',
            rangeSlider: false,
            rangePresets: [
                { label: 'Recent', years: 25 },
                { label: 'Full', years: null }
            ],
            build: function () {
                var mm = function (a) { return a.map(function (v) { return v === null ? null : v / 1000; }); };
                return {
                    dates: LFT_DATES, recession: null,
                    histEnd: lastNonNullDate(LFT_DATES, LFT_LF_ACTUAL),
                    yLabel: 'Millions of workers', yMin: undefined, yMax: undefined,
                    valueFmt: function (v) { return v.toFixed(1) + 'M'; },
                    titleFmt: fmtShortMY,
                    datasets: [
                        { label: 'Labor force (actual)', data: mm(LFT_LF_ACTUAL), borderColor: COL.gray, borderWidth: 1.5, pointRadius: 0, tension: 0.1, spanGaps: false, order: 3, pointStyle: 'line' },
                        { label: 'Demographic trend', data: mm(LFT_LF_TREND), borderColor: COL.teal, borderWidth: 2.5, pointRadius: 0, tension: 0.1, spanGaps: false, order: 2, pointStyle: 'line' },
                        { label: 'Projection (Census)', data: mm(LFT_LF_PROJ), borderColor: COL.navy, borderWidth: 2, borderDash: [6, 4], pointRadius: 0, tension: 0.1, spanGaps: false, order: 1, pointStyle: 'line' }
                    ]
                };
            },
            source: function () { return 'Source: BLS civilian labor force (CLF16OV) via FRED and author&rsquo;s demographic-decomposition trend; Census Bureau population projections. The trend joins the projection (dashed) at the latest trend observation.'; }
        }
    ],
    download: { href: 'assets/data/labor_force_trends_data.csv', label: 'Download data (CSV)', note: 'labor force level and participation rate, with actual, demographic trend, and Census-based projection series.' },
    technical: [
        { label: 'LF Methodology', html: '<p>The population is partitioned into cells by sex and age (16&ndash;24, 25&ndash;34, 35&ndash;44, 45&ndash;54, 55+). Each cell&rsquo;s monthly participation rate (from CPS microdata back to 1976) is seasonally adjusted with X-13ARIMA-SEATS, the March&ndash;November 2020 pandemic months are interpolated as a transitory disruption, a centered 3-month moving average removes residual noise, and a Christiano-Fitzgerald band-pass filter extracts the low-frequency trend. Aggregate trends are population-share-weighted averages of the filtered cells. The projection holds each cell&rsquo;s trend rate fixed and applies Census population projections to 2035.</p>' },
        { label: 'LF Sources', html: '<p>Trend construction uses BLS Current Population Survey microdata (January 1976 onward) with composite weights. The actual labor-force level is the official civilian labor force (FRED CLF16OV). Forward population projections are from the U.S. Census Bureau. Estimates update after each monthly release and after population-projection revisions.</p>' }
    ]
},

/* --- 4. Demographic composition and participation (composition-constant
   counterfactual). Interactive companion to Sections 4-5 of the methodology note.
   Aggregate participation is the exact un-normalized share-weighted sum of group
   rates, LFPR_t = sum_j w_j(t)*L_j(t). Freezing the composition at a user-chosen
   base year t0 gives cf_t = sum_j w_j(t0)*L_j(t); actual - cf is the composition
   effect. A "breakdown" toggle chooses which composition dimension is frozen — age,
   sex, or the full age x sex cells. Everything is recomputed in the browser from the
   10 sex x age cells (CELL_SHARE_*, CELL_LFPR_*), so any base year AND any breakdown
   works with no server. See demoCompute()/groupsFor() at the top of this file.
   -------------------------------------------------------------------- */
{
    id: 'aging-participation',
    tab: 'Demographic Composition',
    requires: ['CELL_DATES',
        'CELL_SHARE_M_16_24', 'CELL_SHARE_M_25_34', 'CELL_SHARE_M_35_44', 'CELL_SHARE_M_45_54', 'CELL_SHARE_M_55_pl',
        'CELL_SHARE_F_16_24', 'CELL_SHARE_F_25_34', 'CELL_SHARE_F_35_44', 'CELL_SHARE_F_45_54', 'CELL_SHARE_F_55_pl',
        'CELL_LFPR_M_16_24', 'CELL_LFPR_M_25_34', 'CELL_LFPR_M_35_44', 'CELL_LFPR_M_45_54', 'CELL_LFPR_M_55_pl',
        'CELL_LFPR_F_16_24', 'CELL_LFPR_F_25_34', 'CELL_LFPR_F_35_44', 'CELL_LFPR_F_45_54', 'CELL_LFPR_F_55_pl'],
    heading: 'Demographic Composition and Labor Force Participation',
    subtitle: 'How much of the shift in participation is a changing demographic mix?',
    prose: [
        'The overall participation rate is a weighted average of the participation rates of different demographic groups, some higher and some lower, with weights equal to each group&rsquo;s share of the population. As the population&rsquo;s composition shifts, those weights move toward groups that participate more or less, changing the overall rate even if no group changes its own behavior.',
        'This tool separates two forces behind the overall rate: the shifting demographic mix and groups&rsquo; own participation behavior. The main exercise holds the demographic mix fixed at a chosen <em>base year</em>, building a <strong>counterfactual</strong> that lets only the group participation rates evolve as observed. The gap between the actual rate and this counterfactual is the <strong>composition effect</strong>. Use the <em>Breakdown</em> control to hold the <em>age</em> mix fixed (sexes combined), the <em>sex</em> mix (ages combined), or the full <em>age &times; sex</em> mix. Change the base year to see how much the result depends on the reference point.',
        'The <em>What&rsquo;s driving it</em> view breaks the full change in participation since the base year down group by group, into the part from the shifting demographic mix and the part from groups&rsquo; own changing participation rates. The <em>Decomposition</em> control sets how the mix part is measured: <em>Relative to average</em> (the default) weighs each group&rsquo;s change in population share against the overall rate, so a growing share of a group that participates below average registers as a drag &mdash; a group whose own rate has risen can still lower the total this way; <em>Own rate</em> instead weighs the share change by the group&rsquo;s own rate. The remaining views show the underlying group participation rates and population shares separately.'
    ],
    reference: 'Reference: Petrosky-Nadeau, 2026, "Labor Market Trends and Projections" (methodology note).',
    hasCountry: false,
    anchorPresets: [1980, 1990, 2000, 2007, 2019],
    anchorDefault: 2000,
    breakdownPresets: [{ v: 'age', label: 'Age' }, { v: 'sex', label: 'Sex' }, { v: 'agesex', label: 'Age × Sex' }],
    breakdownDefault: 'age',
    // Framing of the "What's driving it" view: both decompose the full change since
    // the base into a composition (population-share) part + a behavioral (rate) part;
    // they differ only in how the composition part is measured — 'relative' re-centers
    // it on the base-period aggregate rate (so a below-average group that gains share
    // reads as a drag), 'total' uses each group's own rate. Only the 'drivers' view
    // reads state.framing; the other views hide this control.
    framingPresets: [{ v: 'relative', label: 'Relative to average' }, { v: 'total', label: 'Own rate' }],
    framingDefault: 'relative',
    chartToggle: true,
    kpis: function (country, drift, anchor) {
        var st = state['aging-participation'];
        var yr = anchor || st.anchor || 2000;
        var bd = st.breakdown || 'age';
        var r = demoCompute(bd, yr);
        var i = r.n - 1;
        function sgn(v) { return (v < 0 ? '' : '+') + v.toFixed(1) + ' pp'; }
        // KPIs follow the active chart view. The "What's driving it" (drivers) view is
        // the change decomposition, so its KPI trio reports the total change since the
        // base and its two channels; every other view (counterfactual / rates / shares)
        // is about the composition-constant level, so it shows the actual rate,
        // counterfactual, and composition effect.
        if (st.activeView === 'drivers') {
            var tot = 0, comp = 0, beh = 0;
            for (var gi = 0; gi < r.groups.length; gi++) {
                var k = r.groups[gi].key;
                tot += r.gtot[k][i]; comp += r.contrib[k][i]; beh += r.rate[k][i];
            }
            return [
                { value: sgn(tot), label: 'Total change since ' + yr, note: fmtShortMY(CELL_DATES[i]), color: 'teal' },
                { value: sgn(comp), label: 'Composition (' + BREAKDOWN_NOUN[bd] + ' mix)', color: 'salmon' },
                { value: sgn(beh), label: 'Behavioral (group rates)', color: 'gray' }
            ];
        }
        var eff = r.effect[i];
        // effect = actual - cf. eff < 0 => actual sits BELOW the counterfactual line,
        // i.e. actual is LOWER than it would be at the old composition.
        var dir = eff < 0 ? 'lower' : 'higher';
        var effLabel = bd === 'age' ? 'Aging effect' : 'Composition effect';
        return [
            { value: pct1(r.actual[i]), label: 'Participation rate', note: fmtShortMY(CELL_DATES[i]), color: 'teal' },
            { value: pct1(r.cf[i]), label: 'Holding ' + BREAKDOWN_NOUN[bd] + ' mix fixed at ' + yr, color: 'salmon' },
            { value: (eff < 0 ? '' : '+') + eff.toFixed(1) + ' pp', label: effLabel, note: 'actual is ' + Math.abs(eff).toFixed(1) + ' pp ' + dir, color: 'gray' }
        ];
    },
    charts: [
        {
            id: 'counterfactual',
            title: 'Actual vs. Counterfactual Participation',
            viewLabel: 'Actual vs. counterfactual',
            rangeSlider: false,
            defaultYears: DEMO_RANGE_DEFAULT,
            rangePresets: DEMO_RANGE_PRESETS,
            hideControls: ['framing'],  // framing applies only to the "drivers" view
            advanced: ['breakdown', 'anchor', 'range'],  // keep the top rail uncluttered on mobile
            build: function () {
                var st = state['aging-participation'];
                var yr = st.anchor || 2000, bd = st.breakdown || 'age';
                var r = demoCompute(bd, yr);
                return {
                    dates: CELL_DATES, recession: RECESSIONS.US,
                    histEnd: CELL_DATES[CELL_DATES.length - 1],
                    yLabel: 'Percent', yMin: undefined, yMax: undefined,
                    valueFmt: function (v) { return v.toFixed(2) + '%'; },
                    titleFmt: fmtShortMY,
                    datasets: [
                        { label: 'Participation rate (actual)', data: r.actual, borderColor: COL.teal, borderWidth: 2.5, pointRadius: 0, tension: 0.1, spanGaps: false, order: 2, pointStyle: 'line' },
                        // Solid salmon counterfactual, drawn on top; fill to the actual line
                        // (previous dataset) shades the gap = the composition effect, so the
                        // takeaway reads without eyeballing. Salmon is distinct from the teal
                        // actual and, unlike gold, is not a standalone gender mapping elsewhere.
                        { label: 'Holding ' + BREAKDOWN_NOUN[bd] + ' mix fixed at ' + yr, data: r.cf, borderColor: COL.salmon, borderWidth: 2.5, pointRadius: 0, tension: 0.1, spanGaps: false, order: 1, pointStyle: 'line', fill: '-1', backgroundColor: 'rgba(218,107,92,0.10)' }
                    ]
                };
            },
            source: function () {
                var st = state['aging-participation'];
                var yr = st.anchor || 2000, bd = st.breakdown || 'age';
                return 'Source: author&rsquo;s calculations from Bureau of Labor Statistics (BLS) Current Population Survey (CPS) microdata. The counterfactual holds the ' + BREAKDOWN_NOUN[bd] + ' composition fixed at its ' + yr + ' value and lets the group participation rates evolve as observed; the gap is the composition effect. The data are seasonally adjusted and smoothed with a three month moving average.';
            }
        },
        {
            id: 'drivers',
            title: 'What’s Driving the Change in Participation',
            viewLabel: 'What’s driving it',
            rangeSlider: false,
            advanced: ['breakdown', 'anchor'],  // Decomposition stays on top; demote the rest
            // Two aligned panels shown side by side: the OUTCOME (each group's
            // contribution to the total change since the base) next to the INPUTS (its
            // change in population share and in its own rate). Both share the canonical
            // demographic row order (youngest to oldest age group), so reading a row
            // across both panels shows WHY a group contributed what it did. Both bars are
            // stacked composition (navy) + behavioral (gold), summing to the group total;
            // the FRAMING toggle (state.framing) sets how the composition part is measured:
            // 'relative' re-centers it on the base-period aggregate rate (a below-average
            // group that gains share reads as a drag), 'total' uses each group's own rate.
            // demadjRankedLatest(bd, yr, framing) returns the rows in that shared order.
            panels: [
                {
                    id: 'contrib',
                    caption: 'Contribution to the change',
                    build: function () {
                        var st = state['aging-participation'];
                        var yr = st.anchor || 2000, bd = st.breakdown || 'age', fr = st.framing || 'relative';
                        var ranked = demadjRankedLatest(bd, yr, fr);
                        var labels = ranked.map(function (x) { return x.label; });
                        // Stacked composition (navy) + behavioral (gold), summing to the group
                        // total change since the base. Under 'relative' the composition part is
                        // the re-centered relShare; under 'total' it is each group's own-rate share.
                        var comp = ranked.map(function (x) { return fr === 'relative' ? x.relShare : x.share; });
                        var rate = ranked.map(function (x) { return x.rate; });
                        var compLabel = fr === 'relative' ? 'Composition (relative to ' + yr + ' average)' : 'Composition (population share)';
                        return {
                            chartType: 'bar', labels: labels, baseYear: yr, framing: fr,
                            datasets: [
                                { label: compLabel, data: comp, backgroundColor: COL.navy, borderWidth: 0, stack: 'g' },
                                { label: 'Behavioral (participation rate)', data: rate, backgroundColor: COL.gold, borderWidth: 0, stack: 'g' }
                            ]
                        };
                    },
                    optionsFor: function (spec) {
                        var axisText = 'Contribution to total change since ' + spec.baseYear + ' (pp)';
                        return {
                            responsive: true, maintainAspectRatio: !isMobile(), aspectRatio: 1.1,
                            indexAxis: 'y',
                            interaction: { mode: 'index', intersect: false, axis: 'y' },
                            plugins: {
                                legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'rect', boxWidth: isMobile() ? 12 : 18, padding: isMobile() ? 8 : 10, color: COL.text, font: { family: FONT, size: isMobile() ? 10 : 11 } } },
                                tooltip: { callbacks: {
                                    title: function (c) { return c[0].label; },
                                    label: function (c) {
                                        var v = c.parsed.x, sign = v >= 0 ? '+' : '';
                                        return c.dataset.label.replace(/ \(.*\)$/, '') + ': ' + sign + v.toFixed(2) + ' pp';
                                    },
                                    footer: function (items) {
                                        var tot = items.reduce(function (s, it) { return s + it.parsed.x; }, 0);
                                        return 'Total: ' + (tot >= 0 ? '+' : '') + tot.toFixed(2) + ' pp';
                                    }
                                } }
                            },
                            scales: {
                                y: { stacked: true, ticks: { color: COL.text, font: { size: isMobile() ? 11 : 13, family: FONT } }, grid: { display: false } },
                                x: { stacked: true, title: { display: true, text: axisText, color: COL.text, font: { size: isMobile() ? 11 : 12, family: FONT } }, ticks: { color: COL.text, font: { size: isMobile() ? 11 : 12, family: FONT } }, grid: { color: 'rgba(0,0,0,0.06)' } }
                            }
                        };
                    }
                },
                {
                    id: 'change',
                    caption: 'What changed',
                    build: function () {
                        var st = state['aging-participation'];
                        var yr = st.anchor || 2000, bd = st.breakdown || 'age', fr = st.framing || 'relative';
                        var ranked = demadjRankedLatest(bd, yr, fr);
                        return {
                            chartType: 'bar', labels: ranked.map(function (x) { return x.label; }),
                            baseYear: yr,
                            datasets: [
                                // navy = share change (the driver of the contribution),
                                // gray = own-rate change (a companion diagnostic).
                                { label: 'Population share (pp of 16+ population)', data: ranked.map(function (x) { return x.dShare; }), backgroundColor: COL.navy, borderWidth: 0, order: 2 },
                                { label: 'Own participation rate (pp)', data: ranked.map(function (x) { return x.dRate; }), backgroundColor: COL.gray, borderWidth: 0, order: 1 }
                            ]
                        };
                    },
                    optionsFor: function (spec) {
                        return {
                            responsive: true, maintainAspectRatio: !isMobile(), aspectRatio: 1.1,
                            indexAxis: 'y',
                            interaction: { mode: 'index', intersect: false, axis: 'y' },
                            plugins: {
                                legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'rect', boxWidth: isMobile() ? 12 : 18, padding: isMobile() ? 8 : 10, color: COL.text, font: { family: FONT, size: isMobile() ? 10 : 11 } } },
                                tooltip: { callbacks: {
                                    title: function (c) { return c[0].label + '  (change since ' + spec.baseYear + ')'; },
                                    label: function (c) {
                                        var sign = c.parsed.x >= 0 ? '+' : '';
                                        var unit = c.datasetIndex === 0 ? ' pp of population' : ' pp';
                                        return c.dataset.label.replace(/ \(.*\)$/, '') + ': ' + sign + c.parsed.x.toFixed(2) + unit;
                                    }
                                } }
                            },
                            scales: {
                                // y-axis labels hidden here: the left panel carries the group
                                // names and both panels share the same (youngest-to-oldest) row order.
                                y: { ticks: { display: false }, grid: { display: false } },
                                x: { title: { display: true, text: 'Change since ' + spec.baseYear + ' (pp)', color: COL.text, font: { size: isMobile() ? 11 : 12, family: FONT } }, ticks: { color: COL.text, font: { size: isMobile() ? 11 : 12, family: FONT } }, grid: { color: 'rgba(0,0,0,0.06)' } }
                            }
                        };
                    }
                }
            ],
            source: function () {
                var st = state['aging-participation'];
                var yr = st.anchor || 2000, bd = st.breakdown || 'age', fr = st.framing || 'relative';
                var noun = BREAKDOWN_NOUN[bd];
                var left;
                if (fr === 'total') {
                    left = 'each ' + noun + ' group&rsquo;s contribution to the <em>total</em> change in participation since ' + yr + ', split into a composition part (w<sub>j</sub>(t) &minus; w<sub>j</sub>(' + yr + '))&nbsp;&middot;&nbsp;L<sub>j</sub>(t) (navy) and a behavioral part w<sub>j</sub>(' + yr + ')&nbsp;&middot;&nbsp;(L<sub>j</sub>(t) &minus; L<sub>j</sub>(' + yr + ')) (gold); the two sum to the group total and the groups sum to the aggregate change';
                } else {
                    left = 'each ' + noun + ' group&rsquo;s contribution to the total change since ' + yr + ', with the composition part measured <em>relative to the ' + yr + ' aggregate rate</em>, (w<sub>j</sub>(t) &minus; w<sub>j</sub>(' + yr + '))&nbsp;&middot;&nbsp;(L<sub>j</sub>(t) &minus; LFPR(' + yr + ')) (navy), plus the behavioral part (gold). Re-centering leaves the aggregate change unchanged but re-attributes it, so a below-average group that gains share reads as a drag';
                }
                return 'Source: author&rsquo;s calculations from BLS Current Population Survey microdata. <strong>Left:</strong> ' + left + '. <strong>Right:</strong> the change since ' + yr + ' in that group&rsquo;s share of the 16+ population (navy) and in its own participation rate (gray). Both panels share the same order, from youngest to oldest ' + noun + ' group, so a row reads across.';
            }
        },
        {
            id: 'rates',
            title: 'Group Participation Rates',
            viewLabel: 'Group rates',
            rangeSlider: false,
            defaultYears: DEMO_RANGE_DEFAULT,
            rangePresets: DEMO_RANGE_PRESETS,
            hideControls: ['anchor', 'framing'],  // base-year-independent; framing is drivers-only
            advanced: ['breakdown', 'range'],  // keep the top rail uncluttered on mobile
            build: function () {
                var st = state['aging-participation'];
                var yr = st.anchor || 2000, bd = st.breakdown || 'age';
                var r = demoCompute(bd, yr);
                var ds = r.groups.map(function (grp) {
                    return { label: grp.label, data: r.L[grp.key], borderColor: grp.color, borderWidth: 2, pointRadius: 0, tension: 0.1, spanGaps: false, pointStyle: 'line' };
                });
                return {
                    dates: CELL_DATES, recession: RECESSIONS.US,
                    histEnd: CELL_DATES[CELL_DATES.length - 1],
                    yLabel: 'Percent', valueFmt: function (v) { return v.toFixed(1) + '%'; }, titleFmt: fmtShortMY,
                    endLabels: true,
                    datasets: ds
                };
            },
            source: function () {
                var bd = state['aging-participation'].breakdown || 'age';
                return 'Source: author&rsquo;s calculations from BLS Current Population Survey microdata. Labor force participation rate of each ' + BREAKDOWN_NOUN[bd] + ' group, seasonally adjusted. These group rates are the behavioral component held to their observed path in the counterfactual. The data are seasonally adjusted and smoothed with a three month moving average.';
            }
        },
        {
            id: 'shares',
            title: 'Group Population Shares',
            viewLabel: 'Group shares',
            rangeSlider: false,
            defaultYears: DEMO_RANGE_DEFAULT,
            rangePresets: DEMO_RANGE_PRESETS,
            hideControls: ['anchor', 'framing'],  // base-year-independent; framing is drivers-only
            advanced: ['breakdown', 'range'],  // keep the top rail uncluttered on mobile
            build: function () {
                var st = state['aging-participation'];
                var yr = st.anchor || 2000, bd = st.breakdown || 'age';
                var r = demoCompute(bd, yr);
                var ds = r.groups.map(function (grp) {
                    var pct = r.w[grp.key].map(function (v) { return v * 100; });
                    return { label: grp.label, data: pct, borderColor: grp.color, borderWidth: 2, pointRadius: 0, tension: 0.1, spanGaps: false, pointStyle: 'line' };
                });
                return {
                    dates: CELL_DATES, recession: RECESSIONS.US,
                    histEnd: CELL_DATES[CELL_DATES.length - 1],
                    yLabel: 'Percent of 16+ population', valueFmt: function (v) { return v.toFixed(1) + '%'; }, titleFmt: fmtShortMY,
                    endLabels: true,
                    datasets: ds
                };
            },
            source: function () {
                var bd = state['aging-participation'].breakdown || 'age';
                return 'Source: author&rsquo;s calculations from BLS Current Population Survey microdata. Each ' + BREAKDOWN_NOUN[bd] + ' group&rsquo;s share of the population aged 16+.';
            }
        }
    ],
    download: { href: 'assets/data/demographic_cells_data.csv', label: 'Download data (CSV)', note: 'sex &times; age cell population shares and participation rates, monthly since 1976.' },
    technical: [
        { label: 'Method', html: '<p>The aggregate participation rate is a population-share-weighted sum of the group-specific participation rates, <em>LFPR<sub>t</sub></em> = &sum;<sub>j</sub> <em>&omega;<sup>p</sup><sub>j</sub></em>(t) &middot; <em>lf<sub>j</sub></em>(t), where <em>&omega;<sup>p</sup><sub>j</sub></em> is group <em>j</em>&rsquo;s share of the 16+ population and <em>lf<sub>j</sub></em> its participation rate. The composition-constant counterfactual fixes the population shares at a chosen base date <em>t</em><sub>0</sub> while letting the group rates evolve as observed, <em>LFPR<sup>cf</sup><sub>t</sub></em> = &sum;<sub>j</sub> <em>&omega;<sup>p</sup><sub>j</sub></em>(<em>t</em><sub>0</sub>) &middot; <em>lf<sub>j</sub></em>(t); the <strong>composition effect</strong> is the difference. Because the effect is additive, it splits into per-group <strong>contributions</strong> (<em>&omega;<sup>p</sup><sub>j</sub></em>(t) &minus; <em>&omega;<sup>p</sup><sub>j</sub></em>(<em>t</em><sub>0</sub>)) &middot; <em>lf<sub>j</sub></em>(t). The <em>What&rsquo;s driving it</em> view instead decomposes the full change in participation since <em>t</em><sub>0</sub> into each group&rsquo;s composition part and a behavioral part <em>&omega;<sup>p</sup><sub>j</sub></em>(<em>t</em><sub>0</sub>) &middot; (<em>lf<sub>j</sub></em>(t) &minus; <em>lf<sub>j</sub></em>(<em>t</em><sub>0</sub>)); its <em>Decomposition</em> control measures the composition part against either the base-period aggregate rate (<em>relative to average</em>) or the group&rsquo;s own rate. The <em>Breakdown</em> control chooses the grouping <em>j</em>: the five age groups (sexes combined), the two sexes (ages combined), or ten age &times; sex cells.</p>' },
        { label: 'Sources', html: '<p>BLS Current Population Survey microdata (January 1976 onward), seasonally adjusted with X-13ARIMA-SEATS and smoothed with a centered 3-month moving average.</p>' }
    ]
},

/* --- 5. Labor market flows (CPS) — pending export ------------------- */
{
    id: 'labor-market-flows',
    tab: 'Labor Market Flows',
    heading: 'Labor Market Flows',
    subtitle: '',
    prose: [],
    reference: '',
    hasCountry: false,
    pending: true,
    kpis: null, charts: [], technical: []
}

]; /* end CATEGORIES */

/* =====================================================================
   RENDERING
   ===================================================================== */
var state = {}; // per-category: { country, charts: {id: {chart, spec, applyPreset}} }

// Tooltip label for the payroll/revision datasets. On a "prior estimate" bar
// it appends the revision from the prior vintage to the revised value; on a
// revised payroll bar it notes the prior figure. Falls back to a plain label.
function revisionLabel(c, valueFmt) {
    var ds = c.dataset, v = c.parsed.y;
    if (ds.isPrior) {
        var revised = ds.revisedData ? ds.revisedData[c.dataIndex] : null;
        var base = ds.label + ': ' + valueFmt(v);
        if (revised === null || revised === undefined) return base;
        var delta = revised - v;
        return [base, 'Revised to ' + valueFmt(revised) + ' (' + (delta >= 0 ? '+' : '') + valueFmt(delta) + ')'];
    }
    return ds.label + ': ' + valueFmt(v);
}

function kpiHtml(kpis) {
    if (!kpis || !kpis.length) return '';
    // Rendered as a quiet inline stat-line (figure readout), not boxed cards,
    // to keep the academic tone: no fill, no accent bar, muted values.
    var stats = kpis.map(function (k) {
        // Note is folded into the label in parentheses to keep each stat compact.
        var label = k.label + (k.note ? ' <span class="kpi-note">(' + k.note + ')</span>' : '');
        return '<span class="kpi-stat kpi-' + (k.color || 'navy') + '">' +
            '<span class="kpi-value">' + k.value + '</span>' +
            '<span class="kpi-label">' + label + '</span>' +
            '</span>';
    }).join('');
    return '<div class="kpi-strip">' + stats + '</div>';
}

/* Build every control group for a chart, keyed by name, so the everyday rail
   (controlsHtml, above the chart) and the gated "Chart options" disclosure
   (advancedControlsHtml, below the chart) draw from ONE source of truth. Which
   groups are gated is declared per-chart via chartSpec.advanced (a list of these
   keys); everything else stays on the everyday tier. Two-tier progressive
   disclosure per the UI research (FRED model): keep the primary rail to the few
   most-important controls, gate the rest. */
function buildControlGroups(cat, chartSpec) {
    var g = {};
    // Anchor-year toggle (category-wide): pick the base year at which the age
    // composition is frozen for the counterfactual. Active = the current
    // state.anchor. Rendered on every chart card in the category so both views
    // carry the control; updateAnchor syncs button state across the whole panel.
    if (cat.anchorPresets) {
        var curAnchor = state[cat.id].anchor;
        var abtns = cat.anchorPresets.map(function (yr) {
            var on = yr === curAnchor;
            return '<button class="dash-toggle dash-anchor' + (on ? ' active' : '') + '" ' +
                'data-anchor="' + yr + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + yr + '</button>';
        }).join('');
        g.anchor = '<div class="chart-control-group dash-anchor-group" role="group" aria-label="Base year">' +
            '<span class="chart-control-label">Base year</span>' + abtns + '</div>';
    }
    // Breakdown toggle (category-wide): which composition dimension the counterfactual
    // freezes — age marginal, sex marginal, or the full age x sex cells. Active = the
    // current state.breakdown. Like anchor, rendered on every chart card; updateBreakdown
    // syncs button state across the whole panel.
    if (cat.breakdownPresets) {
        var curBd = state[cat.id].breakdown;
        var bbtns = cat.breakdownPresets.map(function (o) {
            var on = o.v === curBd;
            return '<button class="dash-toggle dash-breakdown' + (on ? ' active' : '') + '" ' +
                'data-breakdown="' + o.v + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + o.label + '</button>';
        }).join('');
        g.breakdown = '<div class="chart-control-group dash-breakdown-group" role="group" aria-label="Breakdown">' +
            '<span class="chart-control-label">Breakdown</span>' + bbtns + '</div>';
    }
    // Framing toggle (category-wide): whether the "What's driving it" views show the
    // composition-constant effect (share channel only) or the full change since the
    // base (share + rate), and — for the latter — whether the composition part is
    // read relative to the base-period aggregate rate. Active = state.framing.
    if (cat.framingPresets) {
        var curFr = state[cat.id].framing;
        var fbtns = cat.framingPresets.map(function (o) {
            var on = o.v === curFr;
            return '<button class="dash-toggle dash-framing' + (on ? ' active' : '') + '" ' +
                'data-framing="' + o.v + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + o.label + '</button>';
        }).join('');
        g.framing = '<div class="chart-control-group dash-framing-group" role="group" aria-label="Decomposition">' +
            '<span class="chart-control-label">Decomposition</span>' + fbtns + '</div>';
    }
    // Country toggle
    if (cat.hasCountry) {
        g.country = '<div class="chart-control-group" role="group" aria-label="Country">' +
            '<span class="chart-control-label">Country</span>' +
            '<button class="dash-toggle" data-country="US" aria-pressed="true">United States</button>' +
            '<button class="dash-toggle" data-country="CA" aria-pressed="false">Canada</button>' +
            '</div>';
    }
    // Smoothing toggle (Monthly / N-mo avg). First option is the default/on state.
    if (chartSpec.smoothing) {
        var sbtns = chartSpec.smoothing.map(function (s, i) {
            return '<button class="dash-toggle dash-smooth' + (i === 0 ? ' active' : '') + '" ' +
                'data-window="' + s.window + '" aria-pressed="' + (i === 0 ? 'true' : 'false') + '">' + s.label + '</button>';
        }).join('');
        g.smoothing = '<div class="chart-control-group" role="group" aria-label="Smoothing">' +
            '<span class="chart-control-label">Smoothing</span>' + sbtns + '</div>';
    }
    // Endpoint-drift toggle (first option is default/on). Hidden for Canada via
    // JS since the spliced series is US-only; shown otherwise.
    if (chartSpec.driftOptions) {
        var initCA = state[cat.id].country === 'CA';
        var dbtns = chartSpec.driftOptions.map(function (o, i) {
            return '<button class="dash-toggle dash-drift' + (i === 0 ? ' active' : '') + '" ' +
                'data-drift="' + o.drift + '" aria-pressed="' + (i === 0 ? 'true' : 'false') + '">' + o.label + '</button>';
        }).join('');
        g.drift = '<div class="chart-control-group dash-drift-group" role="group" aria-label="Endpoint drift"' +
            (initCA ? ' style="display:none"' : '') + '>' +
            '<span class="chart-control-label">Endpoint drift</span>' + dbtns + '</div>';
    }
    // Projection show/hide toggle (US only; hidden for Canada). First option
    // (Show) is the default/on state.
    if (chartSpec.projectionToggle) {
        var initCAp = state[cat.id].country === 'CA';
        var pbtns = chartSpec.projectionToggle.map(function (o, i) {
            return '<button class="dash-toggle dash-proj' + (i === 0 ? ' active' : '') + '" ' +
                'data-proj="' + o.showProj + '" aria-pressed="' + (i === 0 ? 'true' : 'false') + '">' + o.label + '</button>';
        }).join('');
        g.projection = '<div class="chart-control-group dash-proj-group" role="group" aria-label="Projection"' +
            (initCAp ? ' style="display:none"' : '') + '>' +
            '<span class="chart-control-label">Projection</span>' + pbtns + '</div>';
    }
    // Range presets (button variant that only sets a preset window, no filter).
    if (chartSpec.presets) {
        var btns = chartSpec.presets.map(function (p) {
            return '<button class="dash-toggle dash-preset" data-years="' + p.years + '">' + p.label + '</button>';
        }).join('');
        g.range = '<div class="chart-control-group" role="group" aria-label="Time range">' +
            '<span class="chart-control-label">Range</span>' + btns + '</div>';
    }
    // Range presets that FILTER the data (discrete windows; replaces the slider).
    // Default active = the option whose years is null ('All'), else the first.
    if (chartSpec.rangePresets) {
        var cur = rangeKey(state[cat.id].rangeYears[chartSpec.id]);
        var rbtns = chartSpec.rangePresets.map(function (p) {
            var on = rangeKey(p.years) === cur;
            var tok = (p.years === null || p.years === undefined) ? 'null'
                : (typeof p.years === 'object' && p.years.since ? 'since:' + p.years.since : p.years);
            return '<button class="dash-toggle dash-range-preset' + (on ? ' active' : '') + '" ' +
                'data-years="' + tok + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + p.label + '</button>';
        }).join('');
        g.range = '<div class="chart-control-group" role="group" aria-label="Time range">' +
            '<span class="chart-control-label">Range</span>' + rbtns + '</div>';
    }
    // Per-chart control suppression: some views don't respond to a category-wide
    // control (e.g. the group-rate / group-share views are base-year-independent),
    // so drop those groups on that chart rather than showing an inert toggle.
    (chartSpec.hideControls || []).forEach(function (k) { delete g[k]; });
    return g;
}

// Canonical left-to-right order of control groups on either tier.
var CONTROL_ORDER = ['breakdown', 'framing', 'anchor', 'country', 'smoothing', 'drift', 'projection', 'range'];

// Everyday control rail (above the chart): every group NOT gated by chartSpec.advanced.
function controlsHtml(cat, chartSpec) {
    var g = buildControlGroups(cat, chartSpec);
    var adv = chartSpec.advanced || [];
    var parts = CONTROL_ORDER.filter(function (k) { return g[k] && adv.indexOf(k) === -1; })
        .map(function (k) { return g[k]; });
    if (!parts.length) return '';
    return '<div class="chart-controls">' + parts.join('') + '</div>';
}

/* Gated "Chart options" disclosure (below the chart): the button-groups listed
   in chartSpec.advanced, plus (optionally) the fine-grained range slider when
   chartSpec.sliderInAdvanced is set. Collapsed by default. Advanced/power-user
   controls belong at the bottom (UI research finding #6) behind a single click
   (progressive disclosure, FRED "Edit Graph" model). `sliderHtml` is the
   pre-rendered slider markup (passed in so its ids match what buildChart wires
   up). Returns '' when there's nothing to gate. */
function advancedControlsHtml(cat, chartSpec, prefix, sliderHtml) {
    var adv = chartSpec.advanced || [];
    var g = buildControlGroups(cat, chartSpec);
    var parts = CONTROL_ORDER.filter(function (k) { return g[k] && adv.indexOf(k) !== -1; })
        .map(function (k) { return g[k]; });
    var slider = (chartSpec.sliderInAdvanced && sliderHtml)
        ? '<div class="dash-advanced-slider"><span class="chart-control-label">Custom range</span>' + sliderHtml + '</div>'
        : '';
    if (!parts.length && !slider) return '';
    var bodyId = 'advctl_' + prefix;
    // Button-groups sit in a .chart-controls rail; the slider (full-width) follows
    // it as a separate block. Wrap both in the disclosure body.
    var body = (parts.length ? '<div class="chart-controls dash-advanced-rail">' + parts.join('') + '</div>' : '') + slider;
    return '<div class="dash-advanced">' +
        '<button class="dash-advanced-toggle" aria-expanded="false" data-target="' + bodyId + '">' +
        '<span class="dash-advanced-gear" aria-hidden="true">⚙</span>' +
        '<span class="dash-advanced-label">Chart options</span>' +
        '<span class="dash-advanced-caret" aria-hidden="true">▾</span></button>' +
        '<div class="dash-advanced-body" id="' + bodyId + '" hidden>' + body + '</div>' +
        '</div>';
}

function rangeSliderHtml(prefix, startLabel, endLabel) {
    return '<div class="dash-range-wrapper">' +
        '<div class="dash-range-container">' +
        '<span class="dash-range-label" id="' + prefix + 'RangeStart">' + startLabel + '</span>' +
        '<div class="dash-range-track">' +
        '<div class="dash-range-fill" id="' + prefix + 'TrackFill"></div>' +
        '<input type="range" min="0" max="100" value="0" class="dash-range-input" id="' + prefix + 'RangeMin" aria-label="Range start">' +
        '<input type="range" min="0" max="100" value="100" class="dash-range-input" id="' + prefix + 'RangeMax" aria-label="Range end">' +
        '</div>' +
        '<span class="dash-range-label" id="' + prefix + 'RangeEnd">' + endLabel + '</span>' +
        '</div></div>';
}

function chartCardHtml(cat, chartSpec, hidden) {
    var prefix = chartPrefix(cat, chartSpec);
    // Two-panel view (chartSpec.panels): render side-by-side canvases (stacking on
    // mobile via CSS) instead of a single canvas. Controls + source + share row are
    // shared for the card. No range slider on panel views.
    if (chartSpec.panels) {
        var panelsHtml = chartSpec.panels.map(function (p) {
            var cap = p.caption ? '<p class="dash-panel-caption">' + p.caption + '</p>' : '';
            return '<div class="dash-panel">' + cap +
                '<div class="chart-canvas-wrap"><canvas id="canvas_' + prefix + '__' + p.id + '" role="img" ' +
                'aria-label="' + (chartSpec.title + ' — ' + (p.caption || p.id)).replace(/"/g, '&quot;') + '"></canvas></div>' +
                '</div>';
        }).join('');
        var recNoteP = '';
        var shareP = '<div class="dash-share-row">' +
            '<button class="dash-share dash-share-png" data-cat="' + cat.id + '" data-chart="' + chartSpec.id + '" ' +
            'title="Download this chart as a PNG image">Download PNG</button>' +
            '</div>';
        return '<div class="dashboard-chart-card" data-chart="' + chartSpec.id + '"' + (hidden ? ' hidden' : '') + '>' +
            '<div class="dashboard-chart-head"><h3>' + chartSpec.title + '</h3></div>' +
            controlsHtml(cat, chartSpec) +
            '<div class="dash-panel-row">' + panelsHtml + '</div>' +
            advancedControlsHtml(cat, chartSpec, prefix, '') +   // panel views have no range slider
            recNoteP +
            '<p class="dashboard-source" id="source_' + prefix + '"></p>' +
            shareP +
            '</div>';
    }
    var spec0 = chartSpec.build('US');
    var dates = spec0.dates || [];
    var sliderMarkup = (chartSpec.rangeSlider && dates.length)
        ? rangeSliderHtml(prefix, fmtShortMY(dates[0]), fmtShortMY(dates[dates.length - 1])) : '';
    // The slider renders inline below the chart UNLESS it's gated into the "Chart
    // options" disclosure (sliderInAdvanced) — then advancedControlsHtml carries it.
    var slider = (chartSpec.rangeSlider && !chartSpec.sliderInAdvanced) ? sliderMarkup : '';
    var advSlider = (chartSpec.rangeSlider && chartSpec.sliderInAdvanced) ? sliderMarkup : '';
    // Screen-reader summary of the chart (canvas is otherwise opaque to AT).
    var srLabels = spec0.datasets.map(function (d) { return d.label; }).join(', ');
    var aria = chartSpec.title + '. Line and bar chart showing: ' + srLabels + '. Full data available via the download link below.';
    var recNote = spec0.recession && spec0.recession.length
        ? '<p class="dashboard-source dashboard-rec-note">Shaded vertical bands mark ' + (cat.hasCountry ? 'recessions (NBER for the United States; standard dating for Canada)' : 'recessions (NBER)') + '.</p>'
        : '';
    // Quiet share row: copy a deep link to this exact view, or export a PNG.
    var share = '<div class="dash-share-row">' +
        '<button class="dash-share dash-share-link" data-cat="' + cat.id + '" data-chart="' + chartSpec.id + '" ' +
        'title="Copy a link that reopens this chart with the same country, range, and view">' +
        '<span class="dash-share-text">Copy link to this view</span></button>' +
        '<button class="dash-share dash-share-png" data-cat="' + cat.id + '" data-chart="' + chartSpec.id + '" ' +
        'title="Download this chart as a PNG image">Download PNG</button>' +
        '</div>';
    return '<div class="dashboard-chart-card" data-chart="' + chartSpec.id + '"' + (hidden ? ' hidden' : '') + '>' +
        '<div class="dashboard-chart-head"><h3>' + chartSpec.title + '</h3></div>' +
        controlsHtml(cat, chartSpec) +
        '<div class="chart-canvas-wrap"><canvas id="canvas_' + prefix + '" role="img" aria-label="' + aria.replace(/"/g, '&quot;') + '"></canvas></div>' +
        slider +
        advancedControlsHtml(cat, chartSpec, prefix, advSlider) +
        recNote +
        '<p class="dashboard-source" id="source_' + prefix + '"></p>' +
        share +
        '</div>';
}

/* Segmented "which chart" switch for categories that carry >1 chart and set
   chartToggle:true — shows one chart at a time to keep the panel from scrolling
   twice as long. Uses each chart's viewLabel (falls back to title). */
function chartSwitchHtml(cat) {
    if (!cat.chartToggle || cat.charts.length < 2) return '';
    var segs = cat.charts.map(function (c, i) {
        return '<button class="dash-toggle dash-chart-view' + (i === 0 ? ' active' : '') + '" ' +
            'data-chart-view="' + c.id + '" aria-pressed="' + (i === 0 ? 'true' : 'false') + '">' +
            (c.viewLabel || c.title) + '</button>';
    }).join('');
    // The breakdown / base year now live in the "Chart options" disclosure under each
    // chart; signpost that so they are discoverable, and note they apply across views.
    var hint = (cat.breakdownPresets || cat.anchorPresets)
        ? '<p class="chart-view-hint">Change the demographic breakdown and base year under <strong>Chart options</strong>, below each chart; they apply across every view.</p>'
        : '';
    return '<div class="chart-view-switch" role="group" aria-label="Chart view">' +
        '<span class="chart-control-label">View</span>' + segs + '</div>' + hint;
}

/* "About this measure" box — the explanatory prose + reference, rendered
   BELOW the chart (dashboard-first ordering) and open by default. */
function aboutHtml(cat) {
    // No prose (e.g. a bare "coming soon" category) -> omit the whole box.
    if (!cat.prose || !cat.prose.length) return '';
    var prose = cat.prose.map(function (p) { return '<p>' + p + '</p>'; }).join('');
    var ref = cat.reference ? '<p class="dashboard-reference">' + cat.reference + '</p>' : '';
    return '<div class="dashboard-about">' +
        '<div class="dashboard-about-head">' +
        '<span class="dashboard-about-label">About this measure</span>' +
        '<button class="dashboard-about-toggle" aria-expanded="true" data-target="about_' + cat.id + '">Hide</button>' +
        '</div>' +
        '<div class="dashboard-prose dashboard-about-body" id="about_' + cat.id + '">' + prose + ref + '</div>' +
        '</div>';
}

function technicalHtml(cat) {
    if (!cat.technical || !cat.technical.length) return '';
    var btns = cat.technical.map(function (t) {
        return '<button class="abstract-toggle dash-detail-toggle" aria-expanded="false" data-target="detail_' + slug(cat.id) + '_' + slug(t.label) + '">' + t.label + '</button>';
    }).join('');
    var boxes = cat.technical.map(function (t) {
        return '<div class="dashboard-detail-box" id="detail_' + slug(cat.id) + '_' + slug(t.label) + '" hidden>' + t.html + '</div>';
    }).join('');
    return '<div class="dashboard-technical-row"><span class="dashboard-technical-label">Technical Details</span>' + btns + '</div>' + boxes;
}

function panelHtml(cat) {
    var body;
    // Explicit "coming soon", OR a category whose data file failed to load:
    // degrade to a placeholder so one missing/404 data file can't blank the page.
    if (cat.pending || !hasData(cat)) {
        // A data-load failure still shows an explanatory line; an intentional
        // "coming soon" category (cat.pending === true) shows only that.
        var msg = (!hasData(cat) && !cat.pending)
            ? 'The data for this category could not be loaded. Please try again later.'
            : (typeof cat.pending === 'string' ? cat.pending : '');
        body = '<div class="dashboard-pending"><strong>Coming soon</strong>' +
            (msg ? '. ' + msg : '') + '</div>' + aboutHtml(cat);
    } else {
        var kpis = cat.kpis ? kpiHtml(cat.kpis('US')) : '';
        // Multi-chart categories can show one chart at a time (chartToggle); the
        // rest are hidden until selected. Single-chart categories render as before.
        var multi = cat.chartToggle && cat.charts.length > 1;
        var charts = cat.charts.map(function (c, i) { return chartCardHtml(cat, c, multi && i > 0); }).join('');
        var dl = cat.download
            ? '<p class="dashboard-download"><a href="' + cat.download.href + '" download>' + cat.download.label + '</a>' +
              (cat.download.note ? ' &middot; ' + cat.download.note : '') + '</p>'
            : '';
        // Dashboard-first ordering: numbers + chart(s) lead; prose sits below in
        // the "About this measure" box (open by default).
        body = '<div id="kpis_' + cat.id + '">' + kpis + '</div>' +
            chartSwitchHtml(cat) + charts + dl + aboutHtml(cat) + technicalHtml(cat);
    }
    return '<section class="dashboard-panel" id="panel-' + cat.id + '" role="tabpanel" ' +
        'aria-labelledby="tab-' + cat.id + '" tabindex="0" hidden>' +
        '<h2 class="dashboard-panel-heading">' + cat.heading + '</h2>' +
        (cat.subtitle ? '<p class="dashboard-panel-subtitle">' + cat.subtitle + '</p>' : '') +
        body +
        '</section>';
}

/* Produce the spec to render for a chart, applying the current smoothing and
   (for rangePresets charts) the current trailing-year window. Single source of
   truth so buildChart / country / smoothing / range all render consistently. */
function buildSpec(cat, chartSpec) {
    var st = state[cat.id];
    var spec = chartSpec.build(st.country, st.smoothing, st.drift, st.showProj);
    if (chartSpec.rangePresets) {
        var anchor = (chartSpec.rangeAnchor === 'histEnd') ? spec.histEnd : null;
        spec = filterSpecToYears(spec, st.rangeYears[chartSpec.id] || null, anchor);
    }
    return spec;
}

/* Build a Chart for one categorical panel/canvas from a (spec, optionsFor). */
function buildPanelChart(canvasId, spec, optionsFor) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    var chartType = spec.chartType || (spec.datasets.some(function (d) { return d.type === 'bar'; }) ? 'bar' : 'line');
    return new Chart(canvas, {
        type: chartType,
        data: { labels: spec.labels || spec.dates, datasets: spec.datasets },
        options: optionsFor ? optionsFor(spec) : baseOptions(spec),
        plugins: [recessionPlugin, endLabelPlugin]
    });
}

/* Build a Chart instance for a chartSpec, wire slider/presets/source. */
function buildChart(cat, chartSpec) {
    var prefix = chartPrefix(cat, chartSpec);
    var country = state[cat.id].country;

    // Two-panel view: build one Chart per panel; the entry carries `charts` (the
    // list of panel Chart instances) instead of a single `chart`.
    if (chartSpec.panels) {
        var panelCharts = chartSpec.panels.map(function (p) {
            return buildPanelChart('canvas_' + prefix + '__' + p.id, p.build(), p.optionsFor);
        });
        document.getElementById('source_' + prefix).innerHTML = chartSpec.source(country);
        state[cat.id].charts[chartSpec.id] = { charts: panelCharts, spec: chartSpec, prefix: prefix, applyPreset: null };
        return;
    }

    var spec = buildSpec(cat, chartSpec);
    var canvas = document.getElementById('canvas_' + prefix);
    // A chart may be categorical (spec.labels + custom axes via chartSpec.optionsFor)
    // rather than the default time-series (spec.dates + baseOptions).
    var chartType = spec.chartType || (spec.datasets.some(function (d) { return d.type === 'bar'; }) ? 'bar' : 'line');
    var chart = new Chart(canvas, {
        type: chartType,
        data: { labels: spec.labels || spec.dates, datasets: spec.datasets },
        options: chartSpec.optionsFor ? chartSpec.optionsFor(spec) : baseOptions(spec),
        plugins: [recessionPlugin, endLabelPlugin]
    });
    chart.$recessions = spec.recession;
    chart.$endLabels = spec.endLabels;
    document.getElementById('source_' + prefix).innerHTML = chartSpec.source(country);

    var entry = { chart: chart, spec: chartSpec, applyPreset: null, prefix: prefix, histEnd: spec.histEnd };
    state[cat.id].charts[chartSpec.id] = entry;

    if (chartSpec.rangeSlider) {
        var card = canvas.closest('.dashboard-chart-card');
        entry.clearPresets = function () {
            card.querySelectorAll('.dash-preset').forEach(function (b) {
                b.classList.remove('active'); b.setAttribute('aria-pressed', 'false');
            });
        };
        entry.applyPreset = setupRangeSlider(prefix, chart, spec.dates, spec.histEnd, entry);
        // Preset buttons: resolve the LIVE setter from `entry` at click time so a
        // country toggle (which rebuilds the slider) can't leave us calling a stale one.
        card.querySelectorAll('.dash-preset').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var y = btn.dataset.years;
                if (y === 'null') entry.applyPreset(null);
                else if (y === 'HIST') entry.applyPreset('HIST');
                else entry.applyPreset(parseInt(y, 10));
                card.querySelectorAll('.dash-preset').forEach(function (b) {
                    b.classList.toggle('active', b === btn);
                    b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
                });
            });
        });
    }
}

function updateCountry(cat, country) {
    var st = state[cat.id];
    if (st.country === country) return;
    st.country = country;
    // update KPIs
    if (cat.kpis) {
        document.getElementById('kpis_' + cat.id).innerHTML = kpiHtml(cat.kpis(country, st.drift));
    }
    // update each chart
    cat.charts.forEach(function (chartSpec) {
        var entry = st.charts[chartSpec.id];
        var spec = buildSpec(cat, chartSpec);
        entry.chart.data.labels = spec.dates;
        // replace datasets wholesale (labels/colors/data may all differ)
        entry.chart.data.datasets = spec.datasets;
        entry.chart.$recessions = spec.recession;
        // re-point y bounds + soft-cap callback (US caps at ±1000; CA has none, so
        // the callback must be cleared or CA would stay clamped to the stale US cap).
        entry.chart.options.scales.y.min = spec.yMin;
        entry.chart.options.scales.y.max = spec.yMax;
        entry.chart.options.scales.y.afterDataLimits = (spec.yCapMin != null || spec.yCapMax != null)
            ? function (scale) {
                if (spec.yCapMin != null && scale.min < spec.yCapMin) scale.min = spec.yCapMin;
                if (spec.yCapMax != null && scale.max > spec.yCapMax) scale.max = spec.yCapMax;
            }
            : undefined;
        entry.chart.options.plugins.tooltip.callbacks.title = function (c) { return spec.titleFmt(c[0].label); };
        entry.chart.options.plugins.tooltip.callbacks.label = function (c) {
            if (c.parsed.y === null) return null;
            return revisionLabel(c, spec.valueFmt);
        };
        entry.chart.update();
        document.getElementById('source_' + entry.prefix).innerHTML = chartSpec.source(country);
        // re-point slider to new date array (lengths may differ); refresh the live setter
        if (chartSpec.rangeSlider) {
            entry.histEnd = spec.histEnd;
            entry.applyPreset = setupRangeSlider(entry.prefix, entry.chart, spec.dates, spec.histEnd, entry);
            if (entry.clearPresets) entry.clearPresets();
        }
    });
    // toggle button state
    document.querySelectorAll('#panel-' + cat.id + ' .dash-toggle[data-country]').forEach(function (btn) {
        var on = btn.dataset.country === country;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    // Endpoint-drift + projection toggles are US-only; hide them for Canada.
    document.querySelectorAll('#panel-' + cat.id + ' .dash-drift-group, #panel-' + cat.id + ' .dash-proj-group').forEach(function (g) {
        g.style.display = country === 'CA' ? 'none' : '';
    });
    ga('toggle_country', { country: country, page: 'data', category: cat.id });
}

/* Smoothing toggle: rebuild the affected chart's datasets in place (fading the
   bars + adding/removing the moving-average line) WITHOUT touching the x-range,
   so the current zoom is preserved. Only charts that declare `smoothing` react. */
function updateSmoothing(cat, window) {
    var st = state[cat.id];
    if (st.smoothing === window) return;
    st.smoothing = window;
    cat.charts.forEach(function (chartSpec) {
        if (!chartSpec.smoothing) return;
        var entry = st.charts[chartSpec.id];
        if (!entry) return;
        // buildSpec applies smoothing AND the current range window, so the two
        // controls compose. Swap labels + datasets and repaint.
        var spec = buildSpec(cat, chartSpec);
        entry.chart.data.labels = spec.dates;
        entry.chart.data.datasets = spec.datasets;
        entry.chart.update();
    });
    // button state within this panel
    document.querySelectorAll('#panel-' + cat.id + ' .dash-smooth').forEach(function (btn) {
        var on = parseInt(btn.dataset.window, 10) === window;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    ga('toggle_smoothing', { window: window, page: 'data', category: cat.id });
}

/* Endpoint-drift toggle: rebuild the affected chart's datasets in place, swapping
   the spliced series between full-sample and 36-month local drift. Preserves the
   current x-range. Only charts that declare `driftOptions` react. */
function updateDrift(cat, drift) {
    var st = state[cat.id];
    if (st.drift === drift) return;
    st.drift = drift;
    cat.charts.forEach(function (chartSpec) {
        if (!chartSpec.driftOptions) return;
        var entry = st.charts[chartSpec.id];
        if (!entry) return;
        var spec = buildSpec(cat, chartSpec);
        entry.chart.data.labels = spec.dates;
        entry.chart.data.datasets = spec.datasets;
        entry.chart.update();
    });
    // KPIs stay on the full-sample baseline (the 36-month is an overlay, not the
    // headline), so no KPI refresh here.
    document.querySelectorAll('#panel-' + cat.id + ' .dash-drift').forEach(function (btn) {
        var on = btn.dataset.drift === drift;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    ga('toggle_drift', { drift: drift, page: 'data', category: cat.id });
}

/* Projection show/hide toggle: rebuild datasets to include or omit the dashed
   forward paths. Preserves the current x-range. */
function updateProjection(cat, showProj) {
    var st = state[cat.id];
    if (st.showProj === showProj) return;
    st.showProj = showProj;
    cat.charts.forEach(function (chartSpec) {
        if (!chartSpec.projectionToggle) return;
        var entry = st.charts[chartSpec.id];
        if (!entry) return;
        var spec = buildSpec(cat, chartSpec);
        entry.chart.data.labels = spec.dates;
        entry.chart.data.datasets = spec.datasets;
        entry.chart.update();
    });
    document.querySelectorAll('#panel-' + cat.id + ' .dash-proj').forEach(function (btn) {
        var on = (btn.dataset.proj === 'true') === showProj;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    ga('toggle_projection', { show: showProj, page: 'data', category: cat.id });
}

/* Rebuild one chart entry in place from the current state (used by the category-wide
   anchor and breakdown toggles). Handles both single-canvas entries and two-panel
   entries (entry.charts = [Chart, ...] built from chartSpec.panels). Refreshes the
   shared source line too. */
function rebuildChartEntry(cat, chartSpec, entry) {
    if (!entry) return;
    var st = state[cat.id];
    if (chartSpec.panels) {
        chartSpec.panels.forEach(function (p, i) {
            var chart = entry.charts[i];
            if (!chart) return;
            var spec = p.build();
            chart.data.labels = spec.labels || spec.dates;
            chart.data.datasets = spec.datasets;
            if (p.optionsFor) chart.options = p.optionsFor(spec);
            chart.update();
        });
    } else {
        var spec = buildSpec(cat, chartSpec);
        entry.chart.data.labels = spec.labels || spec.dates;
        entry.chart.data.datasets = spec.datasets;
        if (spec.recession !== undefined) entry.chart.$recessions = spec.recession;
        // Categorical charts carry their own options builder; re-apply so axis
        // titles/tooltips that reference the year/breakdown update too.
        if (chartSpec.optionsFor) entry.chart.options = chartSpec.optionsFor(spec);
        entry.chart.update();
    }
    document.getElementById('source_' + entry.prefix).innerHTML = chartSpec.source(st.country);
}

/* Anchor-year toggle: change the base year at which the composition is held fixed,
   then rebuild every chart in the category (the counterfactual line and the drivers
   panels depend on it) and refresh the KPI strip. Category-wide, so it syncs the
   button state across all chart cards in the panel. */
function updateAnchor(cat, year) {
    var st = state[cat.id];
    if (st.anchor === year) return;
    st.anchor = year;
    cat.charts.forEach(function (chartSpec) {
        rebuildChartEntry(cat, chartSpec, st.charts[chartSpec.id]);
    });
    if (cat.kpis) {
        document.getElementById('kpis_' + cat.id).innerHTML = kpiHtml(cat.kpis(st.country, null, year));
    }
    document.querySelectorAll('#panel-' + cat.id + ' .dash-anchor').forEach(function (btn) {
        var on = parseInt(btn.dataset.anchor, 10) === year;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    ga('select_anchor_year', { year: year, page: 'data', category: cat.id });
}

/* Breakdown toggle: change which composition dimension the counterfactual freezes
   (age / sex / age x sex), then rebuild every chart in the category and refresh the
   KPI strip. Category-wide, mirrors updateAnchor (some views change their number of
   series across breakdowns, so datasets are fully replaced). */
function updateBreakdown(cat, value) {
    var st = state[cat.id];
    if (st.breakdown === value) return;
    st.breakdown = value;
    cat.charts.forEach(function (chartSpec) {
        rebuildChartEntry(cat, chartSpec, st.charts[chartSpec.id]);
    });
    if (cat.kpis) {
        document.getElementById('kpis_' + cat.id).innerHTML = kpiHtml(cat.kpis(st.country, null, st.anchor));
    }
    document.querySelectorAll('#panel-' + cat.id + ' .dash-breakdown').forEach(function (btn) {
        var on = btn.dataset.breakdown === value;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    ga('select_breakdown', { breakdown: value, page: 'data', category: cat.id });
}

/* Framing toggle: switch the "What's driving it" views between the composition
   effect and the full change-since-base decomposition (and its relative variant),
   then rebuild every chart in the category and refresh the KPI strip. Category-wide,
   mirrors updateBreakdown. */
function updateFraming(cat, value) {
    var st = state[cat.id];
    if (st.framing === value) return;
    st.framing = value;
    cat.charts.forEach(function (chartSpec) {
        rebuildChartEntry(cat, chartSpec, st.charts[chartSpec.id]);
    });
    if (cat.kpis) {
        document.getElementById('kpis_' + cat.id).innerHTML = kpiHtml(cat.kpis(st.country, null, st.anchor));
    }
    document.querySelectorAll('#panel-' + cat.id + ' .dash-framing').forEach(function (btn) {
        var on = btn.dataset.framing === value;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    ga('select_framing', { framing: value, page: 'data', category: cat.id });
}

/* Range preset: filter the chart's data to a window. `range` is a trailing-year
   number, a {since:YYYY} fixed-start object, or null (full history). Rebuilds via
   buildSpec (which slices the built data), so the time axis always fits the
   visible points — no axis clamp, no mis-drawn lines. */
function updateRange(cat, chartSpec, range) {
    var st = state[cat.id];
    var key = rangeKey(range);
    if (rangeKey(st.rangeYears[chartSpec.id]) === key) return;
    st.rangeYears[chartSpec.id] = parseRangeToken(range);
    var entry = st.charts[chartSpec.id];
    if (entry) {
        var spec = buildSpec(cat, chartSpec);
        entry.chart.data.labels = spec.dates;
        entry.chart.data.datasets = spec.datasets;
        entry.chart.update();
    }
    // button state within this chart card
    var card = document.querySelector('#panel-' + cat.id + ' .dashboard-chart-card[data-chart="' + chartSpec.id + '"]');
    if (card) {
        card.querySelectorAll('.dash-range-preset').forEach(function (btn) {
            var on = rangeKey(btn.dataset.years) === key;
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }
    ga('select_range', { years: key === 'full' ? 'all' : key, page: 'data', category: cat.id, chart: chartSpec.id });
}

/* ---------- Chart-view switch (shared by click handler + deep link) ---- */
// All Chart instances backing an entry (one for a single-canvas chart, N for a
// two-panel view). Empty array if the entry hasn't been built.
function entryCharts(e) {
    if (!e) return [];
    if (e.charts) return e.charts.filter(Boolean);
    return e.chart ? [e.chart] : [];
}

function switchChartView(cat, viewId) {
    var panel = document.getElementById('panel-' + cat.id);
    if (!panel) return;
    panel.querySelectorAll('.dashboard-chart-card[data-chart]').forEach(function (card) {
        var show = card.dataset.chart === viewId;
        card.hidden = !show;
        if (show) {
            entryCharts(state[cat.id].charts[viewId]).forEach(function (c) { c.resize(); });
        }
    });
    panel.querySelectorAll('.dash-chart-view').forEach(function (b) {
        var on = b.dataset.chartView === viewId;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    state[cat.id].activeView = viewId;
    // KPIs follow the active view for categories whose KPI strip depends on it
    // (Demographic Composition: level readout on the counterfactual/rates/shares
    // views, change decomposition on the drivers view).
    if (cat.kpis) {
        var kEl = document.getElementById('kpis_' + cat.id);
        if (kEl) kEl.innerHTML = kpiHtml(cat.kpis(state[cat.id].country, null, state[cat.id].anchor));
    }
}

/* ---------- Share: deep-link state encode/decode ----------------------
   Live navigation keeps the hash category-only (#id) to avoid history churn
   while dragging; the "Copy link" button builds the full parametric link on
   demand: #id?c=US&v=lfpr&r=25-100  (country, active chart view, range %). */
function chartRange(catId, chartId) {
    var prefix = slug(catId) + '__' + chartId;
    var lo = document.getElementById(prefix + 'RangeMin');
    var hi = document.getElementById(prefix + 'RangeMax');
    if (!lo || !hi) return null;
    return { lo: parseInt(lo.value, 10), hi: parseInt(hi.value, 10) };
}
function setChartRange(catId, chartId, lo, hi) {
    var prefix = slug(catId) + '__' + chartId;
    var minI = document.getElementById(prefix + 'RangeMin');
    var maxI = document.getElementById(prefix + 'RangeMax');
    if (!minI || !maxI) return;
    minI.value = Math.max(0, Math.min(100, lo));
    maxI.value = Math.max(0, Math.min(100, hi));
    // fire the slider's own handler (clears any active preset + redraws)
    maxI.dispatchEvent(new Event('input', { bubbles: true }));
}
function buildShareHash(cat, chartId) {
    var params = [];
    if (cat.hasCountry) params.push('c=' + state[cat.id].country);
    if (cat.chartToggle && chartId) params.push('v=' + chartId);
    if (state[cat.id].smoothing) params.push('s=' + state[cat.id].smoothing);
    // rangePresets charts encode the trailing-year window as y=N; slider charts
    // still encode r=lo-hi.
    var chartSpec = chartId ? cat.charts.find(function (c) { return c.id === chartId; }) : null;
    if (chartSpec && chartSpec.rangePresets) {
        // Always encode the range token (including 'null' = full history) so a
        // shared link round-trips whichever preset is active — the default may be a
        // fixed start (e.g. since:1999) rather than full, so an absent param is
        // ambiguous. rangeKey gives 'full' | 'yN' | 'since:YYYY'; map to the token.
        var rk = rangeKey(state[cat.id].rangeYears[chartId]);
        params.push('y=' + (rk === 'full' ? 'null' : rk.indexOf('since:') === 0 ? rk : rk.slice(1)));
    } else {
        var r = chartId ? chartRange(cat.id, chartId) : null;
        if (r && !(r.lo === 0 && r.hi === 100)) params.push('r=' + r.lo + '-' + r.hi);
    }
    return '#' + cat.id + (params.length ? '?' + params.join('&') : '');
}
function parseHash(raw) {
    var s = (raw || '').replace(/^#/, '');
    var q = s.indexOf('?');
    var id = q >= 0 ? s.slice(0, q) : s;
    var params = {};
    if (q >= 0) {
        s.slice(q + 1).split('&').forEach(function (kv) {
            var p = kv.split('=');
            if (p[0]) params[p[0]] = decodeURIComponent(p[1] || '');
        });
    }
    return { id: id, params: params };
}
function applyViewState(cat, params) {
    // order matters: country rebuilds the slider, then view, then range
    if (params.c && cat.hasCountry && (params.c === 'US' || params.c === 'CA')) {
        updateCountry(cat, params.c);
    }
    var viewId = null;
    if (params.v && cat.chartToggle && state[cat.id].charts[params.v]) {
        switchChartView(cat, params.v);
        viewId = params.v;
    }
    if (params.s) {
        var w = parseInt(params.s, 10);
        if (!isNaN(w)) updateSmoothing(cat, w);
    }
    var targetChart = viewId || (cat.charts[0] && cat.charts[0].id);
    var targetSpec = cat.charts.find(function (c) { return c.id === targetChart; });
    if (params.y != null && targetSpec && targetSpec.rangePresets) {
        // params.y === 'null' is a valid value (full history), distinct from the
        // fixed-start default, so apply it too. parseRangeToken('null') -> null.
        updateRange(cat, targetSpec, parseRangeToken(params.y));
    }
    if (params.r) {
        var m = params.r.split('-');
        var lo = parseInt(m[0], 10), hi = parseInt(m[1], 10);
        if (!isNaN(lo) && !isNaN(hi) && targetChart) setChartRange(cat.id, targetChart, lo, hi);
    }
}
function copyShareLink(btn) {
    var catId = btn.dataset.cat, chartId = btn.dataset.chart;
    var cat = CATEGORIES.find(function (c) { return c.id === catId; });
    if (!cat) return;
    var url = location.origin + location.pathname + buildShareHash(cat, chartId);
    var done = function () {
        var label = btn.querySelector('.dash-share-text') || btn;
        var prev = label.textContent;
        label.textContent = 'Link copied';
        btn.classList.add('copied');
        setTimeout(function () { label.textContent = prev; btn.classList.remove('copied'); }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () { window.prompt('Copy this link:', url); });
    } else {
        window.prompt('Copy this link:', url);
    }
    ga('copy_chart_link', { category: catId, chart: chartId, page: 'data' });
}
function downloadChartPng(catId, chartId) {
    var entry = state[catId] && state[catId].charts[chartId];
    var srcs = entryCharts(entry).map(function (c) { return c.canvas; });
    if (!srcs.length) return;
    // Chart.js canvases are transparent; composite onto white so the PNG isn't
    // see-through. Two-panel views are laid out side by side with a small gutter.
    var gap = srcs.length > 1 ? 24 : 0;
    var w = srcs.reduce(function (s, c) { return s + c.width; }, 0) + gap * (srcs.length - 1);
    var h = srcs.reduce(function (m, c) { return Math.max(m, c.height); }, 0);
    var out = document.createElement('canvas');
    out.width = w; out.height = h;
    var ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    var x = 0;
    srcs.forEach(function (c) { ctx.drawImage(c, x, 0); x += c.width + gap; });
    var a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = catId + '-' + chartId + '.png';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

/* ---------- Tabs & activation ----------------------------------------- */
var activeId = null;
var built = {}; // categories whose charts have been instantiated (lazy)

function activate(catId, fromHash) {
    var cat = CATEGORIES.find(function (c) { return c.id === catId; });
    if (!cat) return;
    activeId = catId;
    CATEGORIES.forEach(function (c) {
        var panel = document.getElementById('panel-' + c.id);
        var tab = document.getElementById('tab-' + c.id);
        var on = c.id === catId;
        panel.hidden = !on;
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.tabIndex = on ? 0 : -1;
    });
    // lazily build charts on first activation (Chart.js needs a visible canvas).
    // Skip categories that are pending OR whose data failed to load (rendered as
    // a placeholder by panelHtml) — buildChart would find no canvas otherwise.
    var renderable = !cat.pending && hasData(cat);
    if (!built[catId] && renderable) {
        cat.charts.forEach(function (chartSpec) { buildChart(cat, chartSpec); });
        built[catId] = true;
    } else if (built[catId]) {
        // ensure correct sizing after being unhidden
        cat.charts.forEach(function (chartSpec) {
            entryCharts(state[catId].charts[chartSpec.id]).forEach(function (c) { c.resize(); });
        });
    }
    // keep the active tab in view on the horizontally-scrolling mobile tab row
    var activeTab = document.getElementById('tab-' + catId);
    if (activeTab && activeTab.scrollIntoView) {
        try { activeTab.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) { activeTab.scrollIntoView(); }
    }
    if (!fromHash) history.replaceState(null, '', '#' + catId);
    ga('select_category', { category: catId, page: 'data' });
}

function initTabs() {
    var row = document.getElementById('dashboardTabsRow');
    row.innerHTML = CATEGORIES.map(function (c) {
        var soon = (c.pending || !hasData(c));
        return '<button class="dashboard-tab' + (soon ? ' dashboard-tab-soon' : '') + '" role="tab" id="tab-' + c.id + '" ' +
            'aria-controls="panel-' + c.id + '" aria-selected="false" tabindex="-1">' + c.tab +
            (soon ? '<span class="tab-soon-badge">soon</span>' : '') + '</button>';
    }).join('');
    var tabs = Array.prototype.slice.call(row.querySelectorAll('.dashboard-tab'));
    tabs.forEach(function (tab, i) {
        tab.addEventListener('click', function () { activate(CATEGORIES[i].id); });
        tab.addEventListener('keydown', function (e) {
            var idx = null;
            if (e.key === 'ArrowRight') idx = (i + 1) % tabs.length;
            else if (e.key === 'ArrowLeft') idx = (i - 1 + tabs.length) % tabs.length;
            else if (e.key === 'Home') idx = 0;
            else if (e.key === 'End') idx = tabs.length - 1;
            if (idx !== null) { e.preventDefault(); tabs[idx].focus(); activate(CATEGORIES[idx].id); }
        });
    });
}

/* ---------- Delegated handlers: country toggle + technical details ----- */
function initDelegates() {
    document.getElementById('dashboardPanels').addEventListener('click', function (e) {
        // Breakdown toggle (which composition dimension the counterfactual freezes)
        var bd = e.target.closest('.dash-breakdown');
        if (bd) {
            var bdpanel = bd.closest('.dashboard-panel');
            var bdcat = CATEGORIES.find(function (c) { return 'panel-' + c.id === bdpanel.id; });
            updateBreakdown(bdcat, bd.dataset.breakdown);
            return;
        }
        // Framing toggle (composition effect vs. total change vs. relative)
        var fr = e.target.closest('.dash-framing');
        if (fr) {
            var frpanel = fr.closest('.dashboard-panel');
            var frcat = CATEGORIES.find(function (c) { return 'panel-' + c.id === frpanel.id; });
            updateFraming(frcat, fr.dataset.framing);
            return;
        }
        // Anchor-year toggle (base year for the composition-constant counterfactual)
        var an = e.target.closest('.dash-anchor');
        if (an) {
            var anpanel = an.closest('.dashboard-panel');
            var ancat = CATEGORIES.find(function (c) { return 'panel-' + c.id === anpanel.id; });
            updateAnchor(ancat, parseInt(an.dataset.anchor, 10));
            return;
        }
        var ct = e.target.closest('.dash-toggle[data-country]');
        if (ct) {
            var panel = ct.closest('.dashboard-panel');
            var cat = CATEGORIES.find(function (c) { return 'panel-' + c.id === panel.id; });
            updateCountry(cat, ct.dataset.country);
            return;
        }
        // Smoothing toggle (Monthly / N-mo moving average)
        var sm = e.target.closest('.dash-smooth');
        if (sm) {
            var spanel = sm.closest('.dashboard-panel');
            var scat = CATEGORIES.find(function (c) { return 'panel-' + c.id === spanel.id; });
            updateSmoothing(scat, parseInt(sm.dataset.window, 10));
            return;
        }
        // Endpoint-drift overlay toggle (Full-sample / + 36-month)
        var df = e.target.closest('.dash-drift');
        if (df) {
            var dpanel = df.closest('.dashboard-panel');
            var dcat = CATEGORIES.find(function (c) { return 'panel-' + c.id === dpanel.id; });
            updateDrift(dcat, df.dataset.drift);
            return;
        }
        // Projection show/hide toggle
        var pj = e.target.closest('.dash-proj');
        if (pj) {
            var pjpanel = pj.closest('.dashboard-panel');
            var pjcat = CATEGORIES.find(function (c) { return 'panel-' + c.id === pjpanel.id; });
            updateProjection(pjcat, pj.dataset.proj === 'true');
            return;
        }
        // Range presets that filter the data (1Y / 2Y / 3Y / All)
        var rp = e.target.closest('.dash-range-preset');
        if (rp) {
            var rpanel = rp.closest('.dashboard-panel');
            var rcat = CATEGORIES.find(function (c) { return 'panel-' + c.id === rpanel.id; });
            var rcard = rp.closest('.dashboard-chart-card');
            var rcs = rcat.charts.find(function (c) { return c.id === rcard.dataset.chart; });
            // data-years is a token: 'null', a trailing-year number, or 'since:YYYY'.
            if (rcs) updateRange(rcat, rcs, parseRangeToken(rp.dataset.years));
            return;
        }
        var dt = e.target.closest('.dash-detail-toggle');
        if (dt) {
            var box = document.getElementById(dt.dataset.target);
            var open = box.hidden;
            box.hidden = !open;
            dt.classList.toggle('active', open);
            dt.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (open) ga('view_technical_detail', { detail_title: dt.textContent, page: 'data' });
            return;
        }
        // "Chart options" advanced-controls disclosure (collapsed by default)
        var ac = e.target.closest('.dash-advanced-toggle');
        if (ac) {
            var acbox = document.getElementById(ac.dataset.target);
            var acopen = acbox.hidden;
            acbox.hidden = !acopen;
            ac.classList.toggle('active', acopen);
            ac.setAttribute('aria-expanded', acopen ? 'true' : 'false');
            // caret rotation is handled in CSS via [aria-expanded]
            return;
        }
        // "About this measure" show/hide (open by default)
        var at = e.target.closest('.dashboard-about-toggle');
        if (at) {
            var abox = document.getElementById(at.dataset.target);
            var hide = !abox.hidden;
            abox.hidden = hide;
            at.setAttribute('aria-expanded', hide ? 'false' : 'true');
            at.textContent = hide ? 'Show' : 'Hide';
            return;
        }
        // Chart-view switch (multi-chart categories): show one chart, resize it
        var cv = e.target.closest('.dash-chart-view');
        if (cv) {
            var panel2 = cv.closest('.dashboard-panel');
            var cat2 = CATEGORIES.find(function (c) { return 'panel-' + c.id === panel2.id; });
            switchChartView(cat2, cv.dataset.chartView);
            ga('select_chart_view', { category: cat2.id, chart: cv.dataset.chartView, page: 'data' });
            return;
        }
        // "Copy link to this view" — deep link that restores country + range + view
        var cl = e.target.closest('.dash-share-link');
        if (cl) {
            copyShareLink(cl);
            return;
        }
        // "Download PNG" — export the chart image on a white background
        var pn = e.target.closest('.dash-share-png');
        if (pn) {
            downloadChartPng(pn.dataset.cat, pn.dataset.chart);
            ga('download_chart_png', { category: pn.dataset.cat, chart: pn.dataset.chart, page: 'data' });
            return;
        }
        // CSV download tracking
        var a = e.target.closest('.dashboard-download a');
        if (a) ga('file_download', { file_name: a.getAttribute('href').split('/').pop(), file_type: 'csv', page: 'data' });
    });
}

/* ---------- Sticky offset: pin tabs right under the sticky header ------ */
function positionTabs() {
    var header = document.querySelector('header');
    var tabs = document.getElementById('dashboardTabs');
    if (header && tabs) tabs.style.top = header.offsetHeight + 'px';
}

/* ---------- Boot ------------------------------------------------------- */
function init() {
    // init per-category state
    CATEGORIES.forEach(function (c) { state[c.id] = { country: 'US', charts: {}, smoothing: (c.id === 'breakeven-payrolls' ? 12 : 0), drift: 'full', showProj: true, rangeYears: {}, anchor: (c.anchorDefault || null), breakdown: (c.breakdownDefault || null), framing: (c.framingDefault || null) }; });
    // Seed each chart's default range window from its spec's defaultYears (if any),
    // so the initial active preset + filtered view match (e.g. breakeven -> 5Y).
    CATEGORIES.forEach(function (c) {
        c.charts.forEach(function (cs) {
            if (cs.defaultYears) state[c.id].rangeYears[cs.id] = cs.defaultYears;
        });
    });

    document.getElementById('dashboardPanels').innerHTML =
        CATEGORIES.map(panelHtml).join('');
    initTabs();
    initDelegates();
    positionTabs();
    window.addEventListener('resize', positionTabs);

    // deep-link: #category-id  or  #category-id?c=US&v=lfpr&r=25-100
    var parsed = parseHash(location.hash);
    var start = CATEGORIES.find(function (c) { return c.id === parsed.id; });
    var startId = start ? start.id : CATEGORIES[0].id;
    activate(startId, true);
    // restore country / view / range once the panel's charts exist
    if (start && Object.keys(parsed.params).length && built[startId]) {
        applyViewState(start, parsed.params);
    }

    window.addEventListener('resize', function () {
        if (!activeId || !built[activeId]) return;
        var cat = CATEGORIES.find(function (c) { return c.id === activeId; });
        cat.charts.forEach(function (cs) {
            // entryCharts() returns every Chart for the entry — the single canvas
            // or both panels of a two-panel view (which has no e.chart).
            entryCharts(state[activeId].charts[cs.id]).forEach(function (ch) { ch.resize(); });
        });
    });

    // page engagement + scroll depth (parity with existing data.html)
    var t0 = Date.now();
    window.addEventListener('beforeunload', function () {
        ga('page_engagement', { time_seconds: Math.round((Date.now() - t0) / 1000), page: 'data' });
    });
    var depths = [25, 50, 75, 100], tracked = [];
    window.addEventListener('scroll', function () {
        var p = Math.round((window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100);
        depths.forEach(function (d) { if (p >= d && tracked.indexOf(d) < 0) { tracked.push(d); ga('scroll_depth', { percent: d, page: 'data' }); } });
    });

    // mobile dropdown (reused from other pages)
    var dd = document.querySelector('.dropdown');
    if (dd) {
        dd.querySelector('a').addEventListener('click', function (e) {
            if (window.innerWidth <= 768) { e.preventDefault(); dd.classList.toggle('open'); }
        });
    }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();

/* =====================================================================
   Interactive charts on Insights pages (2026-10-30), after LAMP's
   assets/js/brief-charts.js.

   Draws each .ins-chart[data-figure] with Plotly from window.INSIGHTS_FIGURES
   (the page's figures.js, written by the build script from the same data as the
   download). Each .ins-chart holds the PNG as its fallback: it stays if Plotly
   does not load.

   Hover (tap on phones) shows every series' value for that month. On wide
   screens, drag across the chart to zoom; double-click resets. On phones zoom is
   off, so a swipe scrolls the page. Click a legend entry to show or hide a line.
   ===================================================================== */
(function () {
"use strict";

var figs = window.INSIGHTS_FIGURES || {};
if (!window.Plotly) { return; }

function isNarrow() { return window.matchMedia('(max-width: 640px)').matches; }

function draw(el) {
    var f = figs[el.getAttribute('data-figure')];
    if (!f) { return; }
    var narrow = isNarrow();
    var layout = JSON.parse(JSON.stringify(f.layout));
    layout.autosize = true;
    layout.height = narrow ? 340 : 440;
    if (narrow) {
        layout.font.size = 12;
        layout.xaxis.fixedrange = true;
        layout.yaxis.fixedrange = true;
        layout.dragmode = false;
        layout.legend.font = { size: 11 };
    } else {
        layout.dragmode = 'zoom';
    }
    el.innerHTML = '';
    el.classList.add('is-interactive');
    Plotly.newPlot(el, f.data, layout, {
        responsive: true, displayModeBar: false, scrollZoom: false, doubleClick: 'reset'
    });
}

var charts = document.querySelectorAll('.ins-chart[data-figure]');
for (var i = 0; i < charts.length; i++) { draw(charts[i]); }
})();

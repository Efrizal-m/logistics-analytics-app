/* Chart geometry mirroring the app's Recharts setup (ChartRenderer.tsx / ForecastPanel.tsx).
   Recharts' defaults reproduced: YAxis width 60, XAxis height 30, monotone-ish curve,
   strokeWidth 2, dot r 2.5, bar radius [3,3,0,0] / [0,3,3,0], maxBarSize 46 / 18,
   horizontal gridlines only for vertical charts, vertical gridlines for horizontal bars.
   Colours are passed in as CSS custom-property references so a theme flip is pure CSS. */
(function () {
  function curvePath(pts, t) {
    if (!pts.length) return "";
    if (pts.length === 1) return "M" + pts[0][0] + "," + pts[0][1];
    var d = "M" + pts[0][0] + "," + pts[0][1];
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      var c1x = p1[0] + ((p2[0] - p0[0]) / 6) * t, c1y = p1[1] + ((p2[1] - p0[1]) / 6) * t;
      var c2x = p2[0] - ((p3[0] - p1[0]) / 6) * t, c2y = p2[1] - ((p3[1] - p1[1]) / 6) * t;
      d += " C" + c1x + "," + c1y + " " + c2x + "," + c2y + " " + p2[0] + "," + p2[1];
    }
    return d;
  }

  function segments(values, xs, yTo) {
    var out = [], cur = [];
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (v === null || v === undefined) {
        if (cur.length) out.push(cur);
        cur = [];
      } else cur.push([xs[i], yTo(v)]);
    }
    if (cur.length) out.push(cur);
    return out;
  }

  function roundRect(x, y, w, h, r) {
    // r = [tl, tr, br, bl]
    var tl = r[0], tr = r[1], br = r[2], bl = r[3];
    return "M" + (x + tl) + "," + y +
      "H" + (x + w - tr) + (tr ? "a" + tr + "," + tr + " 0 0 1 " + tr + "," + tr : "") +
      "V" + (y + h - br) + (br ? "a" + br + "," + br + " 0 0 1 " + -br + "," + br : "") +
      "H" + (x + bl) + (bl ? "a" + bl + "," + bl + " 0 0 1 " + -bl + "," + -bl : "") +
      "V" + (y + tl) + (tl ? "a" + tl + "," + tl + " 0 0 1 " + tl + "," + -tl : "") + "Z";
  }

  var API = {};

  /* Vertical-axis chart shell: gridlines + tick labels + x labels. */
  function shell(R, o, plot) {
    var kids = [];
    var gridColor = o.gridColor, axisColor = o.axisColor, fs = o.fontSize || 11;
    var ff = o.fontFamily || "inherit";
    o.yTicks.forEach(function (t, i) {
      var y = plot.yTo(t);
      kids.push(R.createElement("line", {
        key: "g" + i, x1: plot.left, x2: plot.left + plot.w, y1: y, y2: y,
        stroke: gridColor, strokeWidth: 1, shapeRendering: "crispEdges"
      }));
      kids.push(R.createElement("text", {
        key: "yt" + i, x: plot.left - 8, y: y + 4, textAnchor: "end",
        fill: axisColor, fontSize: fs, fontFamily: ff,
        style: { fontVariantNumeric: "tabular-nums" }
      }, o.fmtY ? o.fmtY(t) : String(t)));
    });
    return kids;
  }

  API.line = function (R, o) {
    var w = o.w, h = o.h;
    var left = o.left != null ? o.left : 48, right = o.right != null ? o.right : 8;
    var top = o.top != null ? o.top : 4, bottom = o.bottom != null ? o.bottom : 30;
    var pw = w - left - right, ph = h - top - bottom;
    var yMax = o.yMax, yMin = o.yMin || 0;
    var yTo = function (v) { return top + (1 - (v - yMin) / (yMax - yMin)) * ph; };
    var plot = { left: left, top: top, w: pw, h: ph, yTo: yTo };
    var n = o.x.length;
    var xs = o.x.map(function (_, i) { return n === 1 ? left + pw / 2 : left + (i * pw) / (n - 1); });
    var kids = shell(R, o, plot);
    var fs = o.fontSize || 11, ff = o.fontFamily || "inherit";

    (o.xTickEvery ? o.x.filter(function (_, i) { return i % o.xTickEvery === 0; }) : o.x)
      .forEach(function (label, j) {
        var i = o.xTickEvery ? j * o.xTickEvery : j;
        kids.push(R.createElement("text", {
          key: "xt" + i, x: xs[i], y: h - bottom + 16, textAnchor: "middle",
          fill: o.axisColor, fontSize: fs, fontFamily: ff
        }, label));
      });

    o.series.forEach(function (s, si) {
      segments(s.values, xs, yTo).forEach(function (seg, gi) {
        kids.push(R.createElement("path", {
          key: "p" + si + "_" + gi, d: curvePath(seg, o.curve != null ? o.curve : 0.85),
          fill: "none", stroke: s.color, strokeWidth: o.strokeWidth || 2,
          strokeDasharray: s.dash || undefined, strokeLinecap: "round"
        }));
      });
      if (o.dots !== false) {
        s.values.forEach(function (v, i) {
          if (v === null || v === undefined) return;
          kids.push(R.createElement("circle", {
            key: "d" + si + "_" + i, cx: xs[i], cy: yTo(v), r: o.dotR != null ? o.dotR : 2.5,
            fill: s.color
          }));
        });
      }
      if (s.endLabel) {
        var li = s.values.length - 1;
        while (li >= 0 && (s.values[li] === null || s.values[li] === undefined)) li--;
        if (li >= 0) {
          kids.push(R.createElement("text", {
            key: "el" + si, x: xs[li] + 7, y: yTo(s.values[li]) + 4, textAnchor: "start",
            fill: s.color, fontSize: o.endLabelSize || 11, fontFamily: ff,
            dy: s.endLabelDy || 0, style: { fontWeight: 500 }
          }, s.endLabel));
        }
      }
    });
    return R.createElement("svg", {
      width: w, height: h, viewBox: "0 0 " + w + " " + h,
      style: { display: "block", maxWidth: "100%", overflow: "visible" },
      role: "img", "aria-label": o.label || ""
    }, kids);
  };

  API.vbar = function (R, o) {
    var w = o.w, h = o.h;
    var left = o.left != null ? o.left : 48, right = o.right != null ? o.right : 12;
    var top = o.top != null ? o.top : 4, bottom = o.bottom != null ? o.bottom : 30;
    var pw = w - left - right, ph = h - top - bottom;
    var yMax = o.yMax;
    var yTo = function (v) { return top + (1 - v / yMax) * ph; };
    var plot = { left: left, top: top, w: pw, h: ph, yTo: yTo };
    var kids = shell(R, o, plot);
    var n = o.x.length, band = pw / n;
    var bw = Math.min(o.maxBarSize || 46, band * 0.62);
    var fs = o.fontSize || 11, ff = o.fontFamily || "inherit";
    o.x.forEach(function (label, i) {
      var cx = left + band * (i + 0.5);
      var v = o.values[i];
      var y = yTo(v), bh = Math.max(0, top + ph - y);
      var r = o.radius != null ? o.radius : 3;
      kids.push(R.createElement("path", {
        key: "b" + i, d: roundRect(cx - bw / 2, y, bw, bh, [r, r, 0, 0]),
        fill: Array.isArray(o.colors) ? o.colors[i % o.colors.length] : o.colors
      }));
      if (o.xAngle) {
        kids.push(R.createElement("text", {
          key: "l" + i, x: cx, y: h - bottom + 13, textAnchor: "end",
          fill: o.axisColor, fontSize: fs, fontFamily: ff,
          transform: "rotate(" + o.xAngle + " " + cx + " " + (h - bottom + 13) + ")"
        }, label));
      } else {
        kids.push(R.createElement("text", {
          key: "l" + i, x: cx, y: h - bottom + 16, textAnchor: "middle",
          fill: o.axisColor, fontSize: fs, fontFamily: ff
        }, label));
      }
      if (o.valueLabels) {
        kids.push(R.createElement("text", {
          key: "v" + i, x: cx, y: y - 6, textAnchor: "middle",
          fill: o.valueColor || o.axisColor, fontSize: o.valueSize || 11, fontFamily: ff,
          style: { fontVariantNumeric: "tabular-nums", fontWeight: 500 }
        }, o.valueLabels[i]));
      }
    });
    return R.createElement("svg", {
      width: w, height: h, viewBox: "0 0 " + w + " " + h,
      style: { display: "block", maxWidth: "100%", overflow: "visible" },
      role: "img", "aria-label": o.label || ""
    }, kids);
  };

  API.hbar = function (R, o) {
    var w = o.w, h = o.h;
    var left = o.left != null ? o.left : 150, right = o.right != null ? o.right : 12;
    var top = o.top != null ? o.top : 4, bottom = o.bottom != null ? o.bottom : 30;
    var pw = w - left - right, ph = h - top - bottom;
    var xMax = o.xMax;
    var xTo = function (v) { return left + (v / xMax) * pw; };
    var kids = [];
    var fs = o.fontSize || 11, ff = o.fontFamily || "inherit";
    (o.xTicks || []).forEach(function (t, i) {
      var x = xTo(t);
      kids.push(R.createElement("line", {
        key: "g" + i, x1: x, x2: x, y1: top, y2: top + ph,
        stroke: o.gridColor, strokeWidth: 1, shapeRendering: "crispEdges"
      }));
      kids.push(R.createElement("text", {
        key: "xt" + i, x: x, y: h - bottom + 16, textAnchor: "middle",
        fill: o.axisColor, fontSize: fs, fontFamily: ff,
        style: { fontVariantNumeric: "tabular-nums" }
      }, o.fmtX ? o.fmtX(t) : String(t)));
    });
    var n = o.labels.length, band = ph / n;
    var bh = Math.min(o.maxBarSize || 18, band * 0.66);
    o.labels.forEach(function (label, i) {
      var cy = top + band * (i + 0.5);
      var v = o.values[i];
      var r = o.radius != null ? o.radius : 3;
      kids.push(R.createElement("path", {
        key: "b" + i, d: roundRect(left, cy - bh / 2, Math.max(0, xTo(v) - left), bh, [0, r, r, 0]),
        fill: Array.isArray(o.colors) ? o.colors[i % o.colors.length] : o.colors
      }));
      kids.push(R.createElement("text", {
        key: "l" + i, x: left - 10, y: cy + 4, textAnchor: "end",
        fill: o.labelColor || o.axisColor, fontSize: o.labelSize || fs, fontFamily: ff
      }, label));
      if (o.valueLabels) {
        kids.push(R.createElement("text", {
          key: "v" + i, x: xTo(v) + 7, y: cy + 4, textAnchor: "start",
          fill: o.valueColor || o.axisColor, fontSize: o.valueSize || 11, fontFamily: ff,
          style: { fontVariantNumeric: "tabular-nums", fontWeight: 500 }
        }, o.valueLabels[i]));
      }
    });
    return R.createElement("svg", {
      width: w, height: h, viewBox: "0 0 " + w + " " + h,
      style: { display: "block", maxWidth: "100%", overflow: "visible" },
      role: "img", "aria-label": o.label || ""
    }, kids);
  };

  /* Axis-less micro line for KPI cards. */
  API.spark = function (R, o) {
    var w = o.w, h = o.h, pad = o.pad != null ? o.pad : 2;
    var vs = o.values, lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
    var span = hi - lo || 1;
    var yTo = function (v) { return pad + (1 - (v - lo) / span) * (h - pad * 2); };
    var xs = vs.map(function (_, i) { return (i * w) / (vs.length - 1); });
    var pts = vs.map(function (v, i) { return [xs[i], yTo(v)]; });
    var kids = [R.createElement("path", {
      key: "p", d: curvePath(pts, 0.8), fill: "none", stroke: o.color,
      strokeWidth: o.strokeWidth || 1.5, strokeLinecap: "round"
    })];
    if (o.baseline != null) {
      kids.unshift(R.createElement("line", {
        key: "bl", x1: 0, x2: w, y1: yTo(o.baseline), y2: yTo(o.baseline),
        stroke: o.baselineColor, strokeWidth: 1, strokeDasharray: "2 3"
      }));
    }
    if (o.endDot !== false) {
      kids.push(R.createElement("circle", {
        key: "e", cx: xs[xs.length - 1], cy: yTo(vs[vs.length - 1]),
        r: o.dotR || 2, fill: o.color
      }));
    }
    return R.createElement("svg", {
      width: w, height: h, viewBox: "0 0 " + w + " " + h,
      style: { display: "block", overflow: "visible" }, "aria-hidden": "true"
    }, kids);
  };

  window.ChartSvg = API;
})();

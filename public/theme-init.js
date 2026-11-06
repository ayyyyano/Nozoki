/*! Nozoki theme prepaint; Material Color Utilities 0.3.0, Copyright Google LLC, Apache-2.0; /licenses/material-color-utilities.txt */
;(() => {
  function E(t) {
    return t < 0 ? -1 : t === 0 ? 0 : 1
  }
  function Z(t, e, r) {
    return (1 - r) * t + r * e
  }
  function vt(t, e, r) {
    return r < t ? t : r > e ? e : r
  }
  function rt(t, e, r) {
    return r < t ? t : r > e ? e : r
  }
  function dt(t) {
    return ((t = t % 360), t < 0 && (t = t + 360), t)
  }
  function N(t) {
    return ((t = t % 360), t < 0 && (t = t + 360), t)
  }
  function Dt(t, e) {
    return 180 - Math.abs(Math.abs(t - e) - 180)
  }
  function st(t, e) {
    let r = t[0] * e[0][0] + t[1] * e[0][1] + t[2] * e[0][2],
      n = t[0] * e[1][0] + t[1] * e[1][1] + t[2] * e[1][2],
      o = t[0] * e[2][0] + t[1] * e[2][1] + t[2] * e[2][2]
    return [r, n, o]
  }
  var Wt = [
      [0.41233895, 0.35762064, 0.18051042],
      [0.2126, 0.7152, 0.0722],
      [0.01932141, 0.11916382, 0.95034478],
    ],
    Jt = [
      [3.2413774792388685, -1.5376652402851851, -0.49885366846268053],
      [-0.9691452513005321, 1.8758853451067872, 0.04156585616912061],
      [0.05562093689691305, -0.20395524564742123, 1.0571799111220335],
    ],
    Xt = [95.047, 100, 108.883]
  function gt(t, e, r) {
    return ((255 << 24) | ((t & 255) << 16) | ((e & 255) << 8) | (r & 255)) >>> 0
  }
  function Tt(t) {
    let e = tt(t[0]),
      r = tt(t[1]),
      n = tt(t[2])
    return gt(e, r, n)
  }
  function yt(t) {
    return (t >> 16) & 255
  }
  function bt(t) {
    return (t >> 8) & 255
  }
  function Ct(t) {
    return t & 255
  }
  function Et(t, e, r) {
    let n = Jt,
      o = n[0][0] * t + n[0][1] * e + n[0][2] * r,
      i = n[1][0] * t + n[1][1] * e + n[1][2] * r,
      s = n[2][0] * t + n[2][1] * e + n[2][2] * r,
      c = tt(o),
      l = tt(i),
      h = tt(s)
    return gt(c, l, h)
  }
  function Zt(t) {
    let e = Q(yt(t)),
      r = Q(bt(t)),
      n = Q(Ct(t))
    return st([e, r, n], Wt)
  }
  function Ht(t) {
    let e = _(t),
      r = tt(e)
    return gt(r, r, r)
  }
  function At(t) {
    let e = Zt(t)[1]
    return 116 * Vt(e / 100) - 16
  }
  function _(t) {
    return 100 * Qt((t + 16) / 116)
  }
  function it(t) {
    return Vt(t / 100) * 116 - 16
  }
  function Q(t) {
    let e = t / 255
    return e <= 0.040449936 ? (e / 12.92) * 100 : Math.pow((e + 0.055) / 1.055, 2.4) * 100
  }
  function tt(t) {
    let e = t / 100,
      r = 0
    return (
      e <= 0.0031308 ? (r = e * 12.92) : (r = 1.055 * Math.pow(e, 1 / 2.4) - 0.055),
      vt(0, 255, Math.round(r * 255))
    )
  }
  function Lt() {
    return Xt
  }
  function Vt(t) {
    let e = 0.008856451679035631,
      r = 24389 / 27
    return t > e ? Math.pow(t, 1 / 3) : (r * t + 16) / 116
  }
  function Qt(t) {
    let e = 0.008856451679035631,
      r = 24389 / 27,
      n = t * t * t
    return n > e ? n : (116 * t - 16) / r
  }
  var U = class t {
    static make(e = Lt(), r = ((200 / Math.PI) * _(50)) / 100, n = 50, o = 2, i = !1) {
      let s = e,
        c = s[0] * 0.401288 + s[1] * 0.650173 + s[2] * -0.051461,
        l = s[0] * -0.250268 + s[1] * 1.204414 + s[2] * 0.045854,
        h = s[0] * -0.002079 + s[1] * 0.048952 + s[2] * 0.953127,
        u = 0.8 + o / 10,
        d = u >= 0.9 ? Z(0.59, 0.69, (u - 0.9) * 10) : Z(0.525, 0.59, (u - 0.8) * 10),
        y = i ? 1 : u * (1 - (1 / 3.6) * Math.exp((-r - 42) / 92))
      y = y > 1 ? 1 : y < 0 ? 0 : y
      let f = u,
        b = [y * (100 / c) + 1 - y, y * (100 / l) + 1 - y, y * (100 / h) + 1 - y],
        g = 1 / (5 * r + 1),
        C = g * g * g * g,
        T = 1 - C,
        M = C * r + 0.1 * T * T * Math.cbrt(5 * r),
        A = _(n) / e[1],
        H = 1.48 + Math.sqrt(A),
        x = 0.725 / Math.pow(A, 0.2),
        S = x,
        k = [
          Math.pow((M * b[0] * c) / 100, 0.42),
          Math.pow((M * b[1] * l) / 100, 0.42),
          Math.pow((M * b[2] * h) / 100, 0.42),
        ],
        F = [
          (400 * k[0]) / (k[0] + 27.13),
          (400 * k[1]) / (k[1] + 27.13),
          (400 * k[2]) / (k[2] + 27.13),
        ],
        R = (2 * F[0] + F[1] + 0.05 * F[2]) * x
      return new t(A, R, x, S, d, f, b, M, Math.pow(M, 0.25), H)
    }
    constructor(e, r, n, o, i, s, c, l, h, u) {
      ;((this.n = e),
        (this.aw = r),
        (this.nbb = n),
        (this.ncb = o),
        (this.c = i),
        (this.nc = s),
        (this.rgbD = c),
        (this.fl = l),
        (this.fLRoot = h),
        (this.z = u))
    }
  }
  U.DEFAULT = U.make()
  var $ = class t {
    constructor(e, r, n, o, i, s, c, l, h) {
      ;((this.hue = e),
        (this.chroma = r),
        (this.j = n),
        (this.q = o),
        (this.m = i),
        (this.s = s),
        (this.jstar = c),
        (this.astar = l),
        (this.bstar = h))
    }
    distance(e) {
      let r = this.jstar - e.jstar,
        n = this.astar - e.astar,
        o = this.bstar - e.bstar,
        i = Math.sqrt(r * r + n * n + o * o)
      return 1.41 * Math.pow(i, 0.63)
    }
    static fromInt(e) {
      return t.fromIntInViewingConditions(e, U.DEFAULT)
    }
    static fromIntInViewingConditions(e, r) {
      let n = (e & 16711680) >> 16,
        o = (e & 65280) >> 8,
        i = e & 255,
        s = Q(n),
        c = Q(o),
        l = Q(i),
        h = 0.41233895 * s + 0.35762064 * c + 0.18051042 * l,
        u = 0.2126 * s + 0.7152 * c + 0.0722 * l,
        d = 0.01932141 * s + 0.11916382 * c + 0.95034478 * l,
        y = 0.401288 * h + 0.650173 * u - 0.051461 * d,
        f = -0.250268 * h + 1.204414 * u + 0.045854 * d,
        b = -0.002079 * h + 0.048952 * u + 0.953127 * d,
        g = r.rgbD[0] * y,
        C = r.rgbD[1] * f,
        T = r.rgbD[2] * b,
        M = Math.pow((r.fl * Math.abs(g)) / 100, 0.42),
        A = Math.pow((r.fl * Math.abs(C)) / 100, 0.42),
        H = Math.pow((r.fl * Math.abs(T)) / 100, 0.42),
        x = (E(g) * 400 * M) / (M + 27.13),
        S = (E(C) * 400 * A) / (A + 27.13),
        k = (E(T) * 400 * H) / (H + 27.13),
        F = (11 * x + -12 * S + k) / 11,
        R = (x + S - 2 * k) / 9,
        w = (20 * x + 20 * S + 21 * k) / 20,
        K = (40 * x + 20 * S + k) / 20,
        q = (Math.atan2(R, F) * 180) / Math.PI,
        z = q < 0 ? q + 360 : q >= 360 ? q - 360 : q,
        ht = (z * Math.PI) / 180,
        mt = K * r.nbb,
        X = 100 * Math.pow(mt / r.aw, r.c * r.z),
        ft = (4 / r.c) * Math.sqrt(X / 100) * (r.aw + 4) * r.fLRoot,
        Pt = z < 20.14 ? z + 360 : z,
        kt = 0.25 * (Math.cos((Pt * Math.PI) / 180 + 2) + 3.8),
        It = ((5e4 / 13) * kt * r.nc * r.ncb * Math.sqrt(F * F + R * R)) / (w + 0.305),
        pt = Math.pow(It, 0.9) * Math.pow(1.64 - Math.pow(0.29, r.n), 0.73),
        Bt = pt * Math.sqrt(X / 100),
        Ot = Bt * r.fLRoot,
        qt = 50 * Math.sqrt((pt * r.c) / (r.aw + 4)),
        $t = ((1 + 100 * 0.007) * X) / (1 + 0.007 * X),
        Rt = (1 / 0.0228) * Math.log(1 + 0.0228 * Ot),
        Kt = Rt * Math.cos(ht),
        Yt = Rt * Math.sin(ht)
      return new t(z, Bt, X, ft, Ot, qt, $t, Kt, Yt)
    }
    static fromJch(e, r, n) {
      return t.fromJchInViewingConditions(e, r, n, U.DEFAULT)
    }
    static fromJchInViewingConditions(e, r, n, o) {
      let i = (4 / o.c) * Math.sqrt(e / 100) * (o.aw + 4) * o.fLRoot,
        s = r * o.fLRoot,
        c = r / Math.sqrt(e / 100),
        l = 50 * Math.sqrt((c * o.c) / (o.aw + 4)),
        h = (n * Math.PI) / 180,
        u = ((1 + 100 * 0.007) * e) / (1 + 0.007 * e),
        d = (1 / 0.0228) * Math.log(1 + 0.0228 * s),
        y = d * Math.cos(h),
        f = d * Math.sin(h)
      return new t(n, r, e, i, s, l, u, y, f)
    }
    static fromUcs(e, r, n) {
      return t.fromUcsInViewingConditions(e, r, n, U.DEFAULT)
    }
    static fromUcsInViewingConditions(e, r, n, o) {
      let i = r,
        s = n,
        c = Math.sqrt(i * i + s * s),
        h = (Math.exp(c * 0.0228) - 1) / 0.0228 / o.fLRoot,
        u = Math.atan2(s, i) * (180 / Math.PI)
      u < 0 && (u += 360)
      let d = e / (1 - (e - 100) * 0.007)
      return t.fromJchInViewingConditions(d, h, u, o)
    }
    toInt() {
      return this.viewed(U.DEFAULT)
    }
    viewed(e) {
      let r = this.chroma === 0 || this.j === 0 ? 0 : this.chroma / Math.sqrt(this.j / 100),
        n = Math.pow(r / Math.pow(1.64 - Math.pow(0.29, e.n), 0.73), 1 / 0.9),
        o = (this.hue * Math.PI) / 180,
        i = 0.25 * (Math.cos(o + 2) + 3.8),
        s = e.aw * Math.pow(this.j / 100, 1 / e.c / e.z),
        c = i * (5e4 / 13) * e.nc * e.ncb,
        l = s / e.nbb,
        h = Math.sin(o),
        u = Math.cos(o),
        d = (23 * (l + 0.305) * n) / (23 * c + 11 * n * u + 108 * n * h),
        y = d * u,
        f = d * h,
        b = (460 * l + 451 * y + 288 * f) / 1403,
        g = (460 * l - 891 * y - 261 * f) / 1403,
        C = (460 * l - 220 * y - 6300 * f) / 1403,
        T = Math.max(0, (27.13 * Math.abs(b)) / (400 - Math.abs(b))),
        M = E(b) * (100 / e.fl) * Math.pow(T, 1 / 0.42),
        A = Math.max(0, (27.13 * Math.abs(g)) / (400 - Math.abs(g))),
        H = E(g) * (100 / e.fl) * Math.pow(A, 1 / 0.42),
        x = Math.max(0, (27.13 * Math.abs(C)) / (400 - Math.abs(C))),
        S = E(C) * (100 / e.fl) * Math.pow(x, 1 / 0.42),
        k = M / e.rgbD[0],
        F = H / e.rgbD[1],
        R = S / e.rgbD[2],
        w = 1.86206786 * k - 1.01125463 * F + 0.14918677 * R,
        K = 0.38752654 * k + 0.62144744 * F - 0.00897398 * R,
        J = -0.0158415 * k - 0.03412294 * F + 1.04996444 * R
      return Et(w, K, J)
    }
    static fromXyzInViewingConditions(e, r, n, o) {
      let i = 0.401288 * e + 0.650173 * r - 0.051461 * n,
        s = -0.250268 * e + 1.204414 * r + 0.045854 * n,
        c = -0.002079 * e + 0.048952 * r + 0.953127 * n,
        l = o.rgbD[0] * i,
        h = o.rgbD[1] * s,
        u = o.rgbD[2] * c,
        d = Math.pow((o.fl * Math.abs(l)) / 100, 0.42),
        y = Math.pow((o.fl * Math.abs(h)) / 100, 0.42),
        f = Math.pow((o.fl * Math.abs(u)) / 100, 0.42),
        b = (E(l) * 400 * d) / (d + 27.13),
        g = (E(h) * 400 * y) / (y + 27.13),
        C = (E(u) * 400 * f) / (f + 27.13),
        T = (11 * b + -12 * g + C) / 11,
        M = (b + g - 2 * C) / 9,
        A = (20 * b + 20 * g + 21 * C) / 20,
        H = (40 * b + 20 * g + C) / 20,
        S = (Math.atan2(M, T) * 180) / Math.PI,
        k = S < 0 ? S + 360 : S >= 360 ? S - 360 : S,
        F = (k * Math.PI) / 180,
        R = H * o.nbb,
        w = 100 * Math.pow(R / o.aw, o.c * o.z),
        K = (4 / o.c) * Math.sqrt(w / 100) * (o.aw + 4) * o.fLRoot,
        J = k < 20.14 ? k + 360 : k,
        q = (1 / 4) * (Math.cos((J * Math.PI) / 180 + 2) + 3.8),
        ht = ((5e4 / 13) * q * o.nc * o.ncb * Math.sqrt(T * T + M * M)) / (A + 0.305),
        mt = Math.pow(ht, 0.9) * Math.pow(1.64 - Math.pow(0.29, o.n), 0.73),
        X = mt * Math.sqrt(w / 100),
        ft = X * o.fLRoot,
        Pt = 50 * Math.sqrt((mt * o.c) / (o.aw + 4)),
        kt = ((1 + 100 * 0.007) * w) / (1 + 0.007 * w),
        Mt = Math.log(1 + 0.0228 * ft) / 0.0228,
        It = Mt * Math.cos(F),
        pt = Mt * Math.sin(F)
      return new t(k, X, w, K, ft, Pt, kt, It, pt)
    }
    xyzInViewingConditions(e) {
      let r = this.chroma === 0 || this.j === 0 ? 0 : this.chroma / Math.sqrt(this.j / 100),
        n = Math.pow(r / Math.pow(1.64 - Math.pow(0.29, e.n), 0.73), 1 / 0.9),
        o = (this.hue * Math.PI) / 180,
        i = 0.25 * (Math.cos(o + 2) + 3.8),
        s = e.aw * Math.pow(this.j / 100, 1 / e.c / e.z),
        c = i * (5e4 / 13) * e.nc * e.ncb,
        l = s / e.nbb,
        h = Math.sin(o),
        u = Math.cos(o),
        d = (23 * (l + 0.305) * n) / (23 * c + 11 * n * u + 108 * n * h),
        y = d * u,
        f = d * h,
        b = (460 * l + 451 * y + 288 * f) / 1403,
        g = (460 * l - 891 * y - 261 * f) / 1403,
        C = (460 * l - 220 * y - 6300 * f) / 1403,
        T = Math.max(0, (27.13 * Math.abs(b)) / (400 - Math.abs(b))),
        M = E(b) * (100 / e.fl) * Math.pow(T, 1 / 0.42),
        A = Math.max(0, (27.13 * Math.abs(g)) / (400 - Math.abs(g))),
        H = E(g) * (100 / e.fl) * Math.pow(A, 1 / 0.42),
        x = Math.max(0, (27.13 * Math.abs(C)) / (400 - Math.abs(C))),
        S = E(C) * (100 / e.fl) * Math.pow(x, 1 / 0.42),
        k = M / e.rgbD[0],
        F = H / e.rgbD[1],
        R = S / e.rgbD[2],
        w = 1.86206786 * k - 1.01125463 * F + 0.14918677 * R,
        K = 0.38752654 * k + 0.62144744 * F - 0.00897398 * R,
        J = -0.0158415 * k - 0.03412294 * F + 1.04996444 * R
      return [w, K, J]
    }
  }
  var j = class t {
    static sanitizeRadians(e) {
      return (e + Math.PI * 8) % (Math.PI * 2)
    }
    static trueDelinearized(e) {
      let r = e / 100,
        n = 0
      return (
        r <= 0.0031308 ? (n = r * 12.92) : (n = 1.055 * Math.pow(r, 1 / 2.4) - 0.055),
        n * 255
      )
    }
    static chromaticAdaptation(e) {
      let r = Math.pow(Math.abs(e), 0.42)
      return (E(e) * 400 * r) / (r + 27.13)
    }
    static hueOf(e) {
      let r = st(e, t.SCALED_DISCOUNT_FROM_LINRGB),
        n = t.chromaticAdaptation(r[0]),
        o = t.chromaticAdaptation(r[1]),
        i = t.chromaticAdaptation(r[2]),
        s = (11 * n + -12 * o + i) / 11,
        c = (n + o - 2 * i) / 9
      return Math.atan2(c, s)
    }
    static areInCyclicOrder(e, r, n) {
      let o = t.sanitizeRadians(r - e),
        i = t.sanitizeRadians(n - e)
      return o < i
    }
    static intercept(e, r, n) {
      return (r - e) / (n - e)
    }
    static lerpPoint(e, r, n) {
      return [e[0] + (n[0] - e[0]) * r, e[1] + (n[1] - e[1]) * r, e[2] + (n[2] - e[2]) * r]
    }
    static setCoordinate(e, r, n, o) {
      let i = t.intercept(e[o], r, n[o])
      return t.lerpPoint(e, i, n)
    }
    static isBounded(e) {
      return 0 <= e && e <= 100
    }
    static nthVertex(e, r) {
      let n = t.Y_FROM_LINRGB[0],
        o = t.Y_FROM_LINRGB[1],
        i = t.Y_FROM_LINRGB[2],
        s = r % 4 <= 1 ? 0 : 100,
        c = r % 2 === 0 ? 0 : 100
      if (r < 4) {
        let l = s,
          h = c,
          u = (e - l * o - h * i) / n
        return t.isBounded(u) ? [u, l, h] : [-1, -1, -1]
      } else if (r < 8) {
        let l = s,
          h = c,
          u = (e - h * n - l * i) / o
        return t.isBounded(u) ? [h, u, l] : [-1, -1, -1]
      } else {
        let l = s,
          h = c,
          u = (e - l * n - h * o) / i
        return t.isBounded(u) ? [l, h, u] : [-1, -1, -1]
      }
    }
    static bisectToSegment(e, r) {
      let n = [-1, -1, -1],
        o = n,
        i = 0,
        s = 0,
        c = !1,
        l = !0
      for (let h = 0; h < 12; h++) {
        let u = t.nthVertex(e, h)
        if (u[0] < 0) continue
        let d = t.hueOf(u)
        if (!c) {
          ;((n = u), (o = u), (i = d), (s = d), (c = !0))
          continue
        }
        ;(l || t.areInCyclicOrder(i, d, s)) &&
          ((l = !1), t.areInCyclicOrder(i, r, d) ? ((o = u), (s = d)) : ((n = u), (i = d)))
      }
      return [n, o]
    }
    static midpoint(e, r) {
      return [(e[0] + r[0]) / 2, (e[1] + r[1]) / 2, (e[2] + r[2]) / 2]
    }
    static criticalPlaneBelow(e) {
      return Math.floor(e - 0.5)
    }
    static criticalPlaneAbove(e) {
      return Math.ceil(e - 0.5)
    }
    static bisectToLimit(e, r) {
      let n = t.bisectToSegment(e, r),
        o = n[0],
        i = t.hueOf(o),
        s = n[1]
      for (let c = 0; c < 3; c++)
        if (o[c] !== s[c]) {
          let l = -1,
            h = 255
          o[c] < s[c]
            ? ((l = t.criticalPlaneBelow(t.trueDelinearized(o[c]))),
              (h = t.criticalPlaneAbove(t.trueDelinearized(s[c]))))
            : ((l = t.criticalPlaneAbove(t.trueDelinearized(o[c]))),
              (h = t.criticalPlaneBelow(t.trueDelinearized(s[c]))))
          for (let u = 0; u < 8 && !(Math.abs(h - l) <= 1); u++) {
            let d = Math.floor((l + h) / 2),
              y = t.CRITICAL_PLANES[d],
              f = t.setCoordinate(o, y, s, c),
              b = t.hueOf(f)
            t.areInCyclicOrder(i, r, b) ? ((s = f), (h = d)) : ((o = f), (i = b), (l = d))
          }
        }
      return t.midpoint(o, s)
    }
    static inverseChromaticAdaptation(e) {
      let r = Math.abs(e),
        n = Math.max(0, (27.13 * r) / (400 - r))
      return E(e) * Math.pow(n, 1 / 0.42)
    }
    static findResultByJ(e, r, n) {
      let o = Math.sqrt(n) * 11,
        i = U.DEFAULT,
        s = 1 / Math.pow(1.64 - Math.pow(0.29, i.n), 0.73),
        l = 0.25 * (Math.cos(e + 2) + 3.8) * (5e4 / 13) * i.nc * i.ncb,
        h = Math.sin(e),
        u = Math.cos(e)
      for (let d = 0; d < 5; d++) {
        let y = o / 100,
          f = r === 0 || o === 0 ? 0 : r / Math.sqrt(y),
          b = Math.pow(f * s, 1 / 0.9),
          C = (i.aw * Math.pow(y, 1 / i.c / i.z)) / i.nbb,
          T = (23 * (C + 0.305) * b) / (23 * l + 11 * b * u + 108 * b * h),
          M = T * u,
          A = T * h,
          H = (460 * C + 451 * M + 288 * A) / 1403,
          x = (460 * C - 891 * M - 261 * A) / 1403,
          S = (460 * C - 220 * M - 6300 * A) / 1403,
          k = t.inverseChromaticAdaptation(H),
          F = t.inverseChromaticAdaptation(x),
          R = t.inverseChromaticAdaptation(S),
          w = st([k, F, R], t.LINRGB_FROM_SCALED_DISCOUNT)
        if (w[0] < 0 || w[1] < 0 || w[2] < 0) return 0
        let K = t.Y_FROM_LINRGB[0],
          J = t.Y_FROM_LINRGB[1],
          q = t.Y_FROM_LINRGB[2],
          z = K * w[0] + J * w[1] + q * w[2]
        if (z <= 0) return 0
        if (d === 4 || Math.abs(z - n) < 0.002)
          return w[0] > 100.01 || w[1] > 100.01 || w[2] > 100.01 ? 0 : Tt(w)
        o = o - ((z - n) * o) / (2 * z)
      }
      return 0
    }
    static solveToInt(e, r, n) {
      if (r < 1e-4 || n < 1e-4 || n > 99.9999) return Ht(n)
      e = N(e)
      let o = (e / 180) * Math.PI,
        i = _(n),
        s = t.findResultByJ(o, r, i)
      if (s !== 0) return s
      let c = t.bisectToLimit(i, o)
      return Tt(c)
    }
    static solveToCam(e, r, n) {
      return $.fromInt(t.solveToInt(e, r, n))
    }
  }
  j.SCALED_DISCOUNT_FROM_LINRGB = [
    [0.001200833568784504, 0.002389694492170889, 0.0002795742885861124],
    [0.0005891086651375999, 0.0029785502573438758, 0.0003270666104008398],
    [0.00010146692491640572, 0.0005364214359186694, 0.0032979401770712076],
  ]
  j.LINRGB_FROM_SCALED_DISCOUNT = [
    [1373.2198709594231, -1100.4251190754821, -7.278681089101213],
    [-271.815969077903, 559.6580465940733, -32.46047482791194],
    [1.9622899599665666, -57.173814538844006, 308.7233197812385],
  ]
  j.Y_FROM_LINRGB = [0.2126, 0.7152, 0.0722]
  j.CRITICAL_PLANES = [
    0.015176349177441876, 0.045529047532325624, 0.07588174588720938, 0.10623444424209313,
    0.13658714259697685, 0.16693984095186062, 0.19729253930674434, 0.2276452376616281,
    0.2579979360165119, 0.28835063437139563, 0.3188300904430532, 0.350925934958123,
    0.3848314933096426, 0.42057480301049466, 0.458183274052838, 0.4976837250274023,
    0.5391024159806381, 0.5824650784040898, 0.6277969426914107, 0.6751227633498623,
    0.7244668422128921, 0.775853049866786, 0.829304845476233, 0.8848452951698498, 0.942497089126609,
    1.0022825574869039, 1.0642236851973577, 1.1283421258858297, 1.1946592148522128,
    1.2631959812511864, 1.3339731595349034, 1.407011200216447, 1.4823302800086415,
    1.5599503113873272, 1.6398909516233677, 1.7221716113234105, 1.8068114625156377,
    1.8938294463134073, 1.9832442801866852, 2.075074464868551, 2.1693382909216234,
    2.2660538449872063, 2.36523901573795, 2.4669114995532007, 2.5710888059345764,
    2.6777882626779785, 2.7870270208169257, 2.898822059350997, 3.0131901897720907,
    3.1301480604002863, 3.2497121605402226, 3.3718988244681087, 3.4967242352587946,
    3.624204428461639, 3.754355295633311, 3.887192587735158, 4.022731918402185, 4.160988767090289,
    4.301978482107941, 4.445716283538092, 4.592217266055746, 4.741496401646282, 4.893568542229298,
    5.048448422192488, 5.20615066083972, 5.3666897647573375, 5.5300801301023865, 5.696336044816294,
    5.865471690767354, 6.037501145825082, 6.212438385869475, 6.390297286737924, 6.571091626112461,
    6.7548350853498045, 6.941541251256611, 7.131223617812143, 7.323895587840543, 7.5195704746346665,
    7.7182615035334345, 7.919981813454504, 8.124744458384042, 8.332562408825165, 8.543448553206703,
    8.757415699253682, 8.974476575321063, 9.194643831691977, 9.417930041841839, 9.644347703669503,
    9.873909240696694, 10.106627003236781, 10.342513269534024, 10.58158024687427, 10.8238400726681,
    11.069304815507364, 11.317986476196008, 11.569896988756009, 11.825048221409341,
    12.083451977536606, 12.345119996613247, 12.610063955123938, 12.878295467455942,
    13.149826086772048, 13.42466730586372, 13.702830557985108, 13.984327217668513,
    14.269168601521828, 14.55736596900856, 14.848930523210871, 15.143873411576273,
    15.44220572664832, 15.743938506781891, 16.04908273684337, 16.35764934889634, 16.66964922287304,
    16.985093187232053, 17.30399201960269, 17.62635644741625, 17.95219714852476, 18.281524751807332,
    18.614349837764564, 18.95068293910138, 19.290534541298456, 19.633915083172692,
    19.98083495742689, 20.331304511189067, 20.685334046541502, 21.042933821039977,
    21.404114048223256, 21.76888489811322, 22.137256497705877, 22.50923893145328,
    22.884842241736916, 23.264076429332462, 23.6469514538663, 24.033477234264016, 24.42366364919083,
    24.817520537484558, 25.21505769858089, 25.61628489293138, 26.021211842414342,
    26.429848230738664, 26.842203703840827, 27.258287870275353, 27.678110301598522,
    28.10168053274597, 28.529008062403893, 28.96010235337422, 29.39497283293396, 29.83362889318845,
    30.276079891419332, 30.722335150426627, 31.172403958865512, 31.62629557157785,
    32.08401920991837, 32.54558406207592, 33.010999283389665, 33.4802739966603, 33.953417292456834,
    34.430438229418264, 34.911345834551085, 35.39614910352207, 35.88485700094671, 36.37747846067349,
    36.87402238606382, 37.37449765026789, 37.87891309649659, 38.38727753828926, 38.89959975977785,
    39.41588851594697, 39.93615253289054, 40.460400508064545, 40.98864111053629, 41.520882981230194,
    42.05713473317016, 42.597404951718396, 43.141702194811224, 43.6900349931913, 44.24241185063697,
    44.798841244188324, 45.35933162437017, 45.92389141541209, 46.49252901546552, 47.065252796817916,
    47.64207110610409, 48.22299226451468, 48.808024568002054, 49.3971762874833, 49.9904556690408,
    50.587870934119984, 51.189430279724725, 51.79514187861014, 52.40501387947288, 53.0190544071392,
    53.637271562750364, 54.259673423945976, 54.88626804504493, 55.517063457223934,
    56.15206766869424, 56.79128866487574, 57.43473440856916, 58.08241284012621, 58.734331877617365,
    59.39049941699807, 60.05092333227251, 60.715611475655585, 61.38457167773311, 62.057811747619894,
    62.7353394731159, 63.417162620860914, 64.10328893648692, 64.79372614476921, 65.48848194977529,
    66.18756403501224, 66.89098006357258, 67.59873767827808, 68.31084450182222, 69.02730813691093,
    69.74813616640164, 70.47333615344107, 71.20291564160104, 71.93688215501312, 72.67524319850172,
    73.41800625771542, 74.16517879925733, 74.9167682708136, 75.67278210128072, 76.43322770089146,
    77.1981124613393, 77.96744375590167, 78.74122893956174, 79.51947534912904, 80.30219030335869,
    81.08938110306934, 81.88105503125999, 82.67721935322541, 83.4778813166706, 84.28304815182372,
    85.09272707154808, 85.90692527145302, 86.72564993000343, 87.54890820862819, 88.3767072518277,
    89.2090541872801, 90.04595612594655, 90.88742016217518, 91.73345337380438, 92.58406282226491,
    93.43925555268066, 94.29903859396902, 95.16341895893969, 96.03240364439274, 96.9059996312159,
    97.78421388448044, 98.6670533535366, 99.55452497210776,
  ]
  var I = class t {
    static from(e, r, n) {
      return new t(j.solveToInt(e, r, n))
    }
    static fromInt(e) {
      return new t(e)
    }
    toInt() {
      return this.argb
    }
    get hue() {
      return this.internalHue
    }
    set hue(e) {
      this.setInternalState(j.solveToInt(e, this.internalChroma, this.internalTone))
    }
    get chroma() {
      return this.internalChroma
    }
    set chroma(e) {
      this.setInternalState(j.solveToInt(this.internalHue, e, this.internalTone))
    }
    get tone() {
      return this.internalTone
    }
    set tone(e) {
      this.setInternalState(j.solveToInt(this.internalHue, this.internalChroma, e))
    }
    constructor(e) {
      this.argb = e
      let r = $.fromInt(e)
      ;((this.internalHue = r.hue),
        (this.internalChroma = r.chroma),
        (this.internalTone = At(e)),
        (this.argb = e))
    }
    setInternalState(e) {
      let r = $.fromInt(e)
      ;((this.internalHue = r.hue),
        (this.internalChroma = r.chroma),
        (this.internalTone = At(e)),
        (this.argb = e))
    }
    inViewingConditions(e) {
      let n = $.fromInt(this.toInt()).xyzInViewingConditions(e),
        o = $.fromXyzInViewingConditions(n[0], n[1], n[2], U.make())
      return t.from(o.hue, o.chroma, it(n[1]))
    }
  }
  var V = class t {
    static ratioOfTones(e, r) {
      return ((e = rt(0, 100, e)), (r = rt(0, 100, r)), t.ratioOfYs(_(e), _(r)))
    }
    static ratioOfYs(e, r) {
      let n = e > r ? e : r,
        o = n === r ? e : r
      return (n + 5) / (o + 5)
    }
    static lighter(e, r) {
      if (e < 0 || e > 100) return -1
      let n = _(e),
        o = r * (n + 5) - 5,
        i = t.ratioOfYs(o, n),
        s = Math.abs(i - r)
      if (i < r && s > 0.04) return -1
      let c = it(o) + 0.4
      return c < 0 || c > 100 ? -1 : c
    }
    static darker(e, r) {
      if (e < 0 || e > 100) return -1
      let n = _(e),
        o = (n + 5) / r - 5,
        i = t.ratioOfYs(n, o),
        s = Math.abs(i - r)
      if (i < r && s > 0.04) return -1
      let c = it(o) - 0.4
      return c < 0 || c > 100 ? -1 : c
    }
    static lighterUnsafe(e, r) {
      let n = t.lighter(e, r)
      return n < 0 ? 100 : n
    }
    static darkerUnsafe(e, r) {
      let n = t.darker(e, r)
      return n < 0 ? 0 : n
    }
  }
  var nt = class t {
    static isDisliked(e) {
      let r = Math.round(e.hue) >= 90 && Math.round(e.hue) <= 111,
        n = Math.round(e.chroma) > 16,
        o = Math.round(e.tone) < 65
      return r && n && o
    }
    static fixIfDisliked(e) {
      return t.isDisliked(e) ? I.from(e.hue, e.chroma, 70) : e
    }
  }
  var m = class t {
    static fromPalette(e) {
      return new t(
        e.name ?? '',
        e.palette,
        e.tone,
        e.isBackground ?? !1,
        e.background,
        e.secondBackground,
        e.contrastCurve,
        e.toneDeltaPair,
      )
    }
    constructor(e, r, n, o, i, s, c, l) {
      if (
        ((this.name = e),
        (this.palette = r),
        (this.tone = n),
        (this.isBackground = o),
        (this.background = i),
        (this.secondBackground = s),
        (this.contrastCurve = c),
        (this.toneDeltaPair = l),
        (this.hctCache = new Map()),
        !i && s)
      )
        throw new Error(`Color ${e} has secondBackgrounddefined, but background is not defined.`)
      if (!i && c)
        throw new Error(`Color ${e} has contrastCurvedefined, but background is not defined.`)
      if (i && !c)
        throw new Error(`Color ${e} has backgrounddefined, but contrastCurve is not defined.`)
    }
    getArgb(e) {
      return this.getHct(e).toInt()
    }
    getHct(e) {
      let r = this.hctCache.get(e)
      if (r != null) return r
      let n = this.getTone(e),
        o = this.palette(e).getHct(n)
      return (this.hctCache.size > 4 && this.hctCache.clear(), this.hctCache.set(e, o), o)
    }
    getTone(e) {
      let r = e.contrastLevel < 0
      if (this.toneDeltaPair) {
        let n = this.toneDeltaPair(e),
          o = n.roleA,
          i = n.roleB,
          s = n.delta,
          c = n.polarity,
          l = n.stayTogether,
          u = this.background(e).getTone(e),
          d = c === 'nearer' || (c === 'lighter' && !e.isDark) || (c === 'darker' && e.isDark),
          y = d ? o : i,
          f = d ? i : o,
          b = this.name === y.name,
          g = e.isDark ? 1 : -1,
          C = y.contrastCurve.get(e.contrastLevel),
          T = f.contrastCurve.get(e.contrastLevel),
          M = y.tone(e),
          A = V.ratioOfTones(u, M) >= C ? M : t.foregroundTone(u, C),
          H = f.tone(e),
          x = V.ratioOfTones(u, H) >= T ? H : t.foregroundTone(u, T)
        return (
          r && ((A = t.foregroundTone(u, C)), (x = t.foregroundTone(u, T))),
          (x - A) * g >= s ||
            ((x = rt(0, 100, A + s * g)), (x - A) * g >= s || (A = rt(0, 100, x - s * g))),
          50 <= A && A < 60
            ? g > 0
              ? ((A = 60), (x = Math.max(x, A + s * g)))
              : ((A = 49), (x = Math.min(x, A + s * g)))
            : 50 <= x &&
              x < 60 &&
              (l
                ? g > 0
                  ? ((A = 60), (x = Math.max(x, A + s * g)))
                  : ((A = 49), (x = Math.min(x, A + s * g)))
                : g > 0
                  ? (x = 60)
                  : (x = 49)),
          b ? A : x
        )
      } else {
        let n = this.tone(e)
        if (this.background == null) return n
        let o = this.background(e).getTone(e),
          i = this.contrastCurve.get(e.contrastLevel)
        if (
          (V.ratioOfTones(o, n) >= i || (n = t.foregroundTone(o, i)),
          r && (n = t.foregroundTone(o, i)),
          this.isBackground &&
            50 <= n &&
            n < 60 &&
            (V.ratioOfTones(49, o) >= i ? (n = 49) : (n = 60)),
          this.secondBackground)
        ) {
          let [s, c] = [this.background, this.secondBackground],
            [l, h] = [s(e).getTone(e), c(e).getTone(e)],
            [u, d] = [Math.max(l, h), Math.min(l, h)]
          if (V.ratioOfTones(u, n) >= i && V.ratioOfTones(d, n) >= i) return n
          let y = V.lighter(u, i),
            f = V.darker(d, i),
            b = []
          return (
            y !== -1 && b.push(y),
            f !== -1 && b.push(f),
            t.tonePrefersLightForeground(l) || t.tonePrefersLightForeground(h)
              ? y < 0
                ? 100
                : y
              : b.length === 1
                ? b[0]
                : f < 0
                  ? 0
                  : f
          )
        }
        return n
      }
    }
    static foregroundTone(e, r) {
      let n = V.lighterUnsafe(e, r),
        o = V.darkerUnsafe(e, r),
        i = V.ratioOfTones(n, e),
        s = V.ratioOfTones(o, e)
      if (t.tonePrefersLightForeground(e)) {
        let l = Math.abs(i - s) < 0.1 && i < r && s < r
        return i >= r || i >= s || l ? n : o
      } else return s >= r || s >= i ? o : n
    }
    static tonePrefersLightForeground(e) {
      return Math.round(e) < 60
    }
    static toneAllowsLightForeground(e) {
      return Math.round(e) <= 49
    }
    static enableLightForeground(e) {
      return t.tonePrefersLightForeground(e) && !t.toneAllowsLightForeground(e) ? 49 : e
    }
  }
  var P = class t {
      static fromInt(e) {
        let r = I.fromInt(e)
        return t.fromHct(r)
      }
      static fromHct(e) {
        return new t(e.hue, e.chroma, e)
      }
      static fromHueAndChroma(e, r) {
        let n = new wt(e, r).create()
        return new t(e, r, n)
      }
      constructor(e, r, n) {
        ;((this.hue = e), (this.chroma = r), (this.keyColor = n), (this.cache = new Map()))
      }
      tone(e) {
        let r = this.cache.get(e)
        return (
          r === void 0 && ((r = I.from(this.hue, this.chroma, e).toInt()), this.cache.set(e, r)),
          r
        )
      }
      getHct(e) {
        return I.fromInt(this.tone(e))
      }
    },
    wt = class {
      constructor(e, r) {
        ;((this.hue = e),
          (this.requestedChroma = r),
          (this.chromaCache = new Map()),
          (this.maxChromaValue = 200))
      }
      create() {
        let o = 0,
          i = 100
        for (; o < i;) {
          let s = Math.floor((o + i) / 2),
            c = this.maxChroma(s) < this.maxChroma(s + 1)
          if (this.maxChroma(s) >= this.requestedChroma - 0.01)
            if (Math.abs(o - 50) < Math.abs(i - 50)) i = s
            else {
              if (o === s) return I.from(this.hue, this.requestedChroma, o)
              o = s
            }
          else c ? (o = s + 1) : (i = s)
        }
        return I.from(this.hue, this.requestedChroma, o)
      }
      maxChroma(e) {
        if (this.chromaCache.has(e)) return this.chromaCache.get(e)
        let r = I.from(this.hue, this.maxChromaValue, e).chroma
        return (this.chromaCache.set(e, r), r)
      }
    }
  var p = class {
    constructor(e, r, n, o) {
      ;((this.low = e), (this.normal = r), (this.medium = n), (this.high = o))
    }
    get(e) {
      return e <= -1
        ? this.low
        : e < 0
          ? Z(this.low, this.normal, (e - -1) / 1)
          : e < 0.5
            ? Z(this.normal, this.medium, (e - 0) / 0.5)
            : e < 1
              ? Z(this.medium, this.high, (e - 0.5) / 0.5)
              : this.high
    }
  }
  var v = class {
    constructor(e, r, n, o, i) {
      ;((this.roleA = e),
        (this.roleB = r),
        (this.delta = n),
        (this.polarity = o),
        (this.stayTogether = i))
    }
  }
  var B
  ;(function (t) {
    ;((t[(t.MONOCHROME = 0)] = 'MONOCHROME'),
      (t[(t.NEUTRAL = 1)] = 'NEUTRAL'),
      (t[(t.TONAL_SPOT = 2)] = 'TONAL_SPOT'),
      (t[(t.VIBRANT = 3)] = 'VIBRANT'),
      (t[(t.EXPRESSIVE = 4)] = 'EXPRESSIVE'),
      (t[(t.FIDELITY = 5)] = 'FIDELITY'),
      (t[(t.CONTENT = 6)] = 'CONTENT'),
      (t[(t.RAINBOW = 7)] = 'RAINBOW'),
      (t[(t.FRUIT_SALAD = 8)] = 'FRUIT_SALAD'))
  })(B || (B = {}))
  function ot(t) {
    return t.variant === B.FIDELITY || t.variant === B.CONTENT
  }
  function D(t) {
    return t.variant === B.MONOCHROME
  }
  function te(t, e, r, n) {
    let o = r,
      i = I.from(t, e, r)
    if (i.chroma < e) {
      let s = i.chroma
      for (; i.chroma < e;) {
        o += n ? -1 : 1
        let c = I.from(t, e, o)
        if (s > c.chroma || Math.abs(c.chroma - e) < 0.4) break
        let l = Math.abs(c.chroma - e),
          h = Math.abs(i.chroma - e)
        ;(l < h && (i = c), (s = Math.max(s, c.chroma)))
      }
    }
    return o
  }
  var a = class t {
    static highestSurface(e) {
      return e.isDark ? t.surfaceBright : t.surfaceDim
    }
  }
  a.contentAccentToneDelta = 15
  a.primaryPaletteKeyColor = m.fromPalette({
    name: 'primary_palette_key_color',
    palette: (t) => t.primaryPalette,
    tone: (t) => t.primaryPalette.keyColor.tone,
  })
  a.secondaryPaletteKeyColor = m.fromPalette({
    name: 'secondary_palette_key_color',
    palette: (t) => t.secondaryPalette,
    tone: (t) => t.secondaryPalette.keyColor.tone,
  })
  a.tertiaryPaletteKeyColor = m.fromPalette({
    name: 'tertiary_palette_key_color',
    palette: (t) => t.tertiaryPalette,
    tone: (t) => t.tertiaryPalette.keyColor.tone,
  })
  a.neutralPaletteKeyColor = m.fromPalette({
    name: 'neutral_palette_key_color',
    palette: (t) => t.neutralPalette,
    tone: (t) => t.neutralPalette.keyColor.tone,
  })
  a.neutralVariantPaletteKeyColor = m.fromPalette({
    name: 'neutral_variant_palette_key_color',
    palette: (t) => t.neutralVariantPalette,
    tone: (t) => t.neutralVariantPalette.keyColor.tone,
  })
  a.background = m.fromPalette({
    name: 'background',
    palette: (t) => t.neutralPalette,
    tone: (t) => (t.isDark ? 6 : 98),
    isBackground: !0,
  })
  a.onBackground = m.fromPalette({
    name: 'on_background',
    palette: (t) => t.neutralPalette,
    tone: (t) => (t.isDark ? 90 : 10),
    background: (t) => a.background,
    contrastCurve: new p(3, 3, 4.5, 7),
  })
  a.surface = m.fromPalette({
    name: 'surface',
    palette: (t) => t.neutralPalette,
    tone: (t) => (t.isDark ? 6 : 98),
    isBackground: !0,
  })
  a.surfaceDim = m.fromPalette({
    name: 'surface_dim',
    palette: (t) => t.neutralPalette,
    tone: (t) => (t.isDark ? 6 : new p(87, 87, 80, 75).get(t.contrastLevel)),
    isBackground: !0,
  })
  a.surfaceBright = m.fromPalette({
    name: 'surface_bright',
    palette: (t) => t.neutralPalette,
    tone: (t) => (t.isDark ? new p(24, 24, 29, 34).get(t.contrastLevel) : 98),
    isBackground: !0,
  })
  a.surfaceContainerLowest = m.fromPalette({
    name: 'surface_container_lowest',
    palette: (t) => t.neutralPalette,
    tone: (t) => (t.isDark ? new p(4, 4, 2, 0).get(t.contrastLevel) : 100),
    isBackground: !0,
  })
  a.surfaceContainerLow = m.fromPalette({
    name: 'surface_container_low',
    palette: (t) => t.neutralPalette,
    tone: (t) =>
      t.isDark
        ? new p(10, 10, 11, 12).get(t.contrastLevel)
        : new p(96, 96, 96, 95).get(t.contrastLevel),
    isBackground: !0,
  })
  a.surfaceContainer = m.fromPalette({
    name: 'surface_container',
    palette: (t) => t.neutralPalette,
    tone: (t) =>
      t.isDark
        ? new p(12, 12, 16, 20).get(t.contrastLevel)
        : new p(94, 94, 92, 90).get(t.contrastLevel),
    isBackground: !0,
  })
  a.surfaceContainerHigh = m.fromPalette({
    name: 'surface_container_high',
    palette: (t) => t.neutralPalette,
    tone: (t) =>
      t.isDark
        ? new p(17, 17, 21, 25).get(t.contrastLevel)
        : new p(92, 92, 88, 85).get(t.contrastLevel),
    isBackground: !0,
  })
  a.surfaceContainerHighest = m.fromPalette({
    name: 'surface_container_highest',
    palette: (t) => t.neutralPalette,
    tone: (t) =>
      t.isDark
        ? new p(22, 22, 26, 30).get(t.contrastLevel)
        : new p(90, 90, 84, 80).get(t.contrastLevel),
    isBackground: !0,
  })
  a.onSurface = m.fromPalette({
    name: 'on_surface',
    palette: (t) => t.neutralPalette,
    tone: (t) => (t.isDark ? 90 : 10),
    background: (t) => a.highestSurface(t),
    contrastCurve: new p(4.5, 7, 11, 21),
  })
  a.surfaceVariant = m.fromPalette({
    name: 'surface_variant',
    palette: (t) => t.neutralVariantPalette,
    tone: (t) => (t.isDark ? 30 : 90),
    isBackground: !0,
  })
  a.onSurfaceVariant = m.fromPalette({
    name: 'on_surface_variant',
    palette: (t) => t.neutralVariantPalette,
    tone: (t) => (t.isDark ? 80 : 30),
    background: (t) => a.highestSurface(t),
    contrastCurve: new p(3, 4.5, 7, 11),
  })
  a.inverseSurface = m.fromPalette({
    name: 'inverse_surface',
    palette: (t) => t.neutralPalette,
    tone: (t) => (t.isDark ? 90 : 20),
  })
  a.inverseOnSurface = m.fromPalette({
    name: 'inverse_on_surface',
    palette: (t) => t.neutralPalette,
    tone: (t) => (t.isDark ? 20 : 95),
    background: (t) => a.inverseSurface,
    contrastCurve: new p(4.5, 7, 11, 21),
  })
  a.outline = m.fromPalette({
    name: 'outline',
    palette: (t) => t.neutralVariantPalette,
    tone: (t) => (t.isDark ? 60 : 50),
    background: (t) => a.highestSurface(t),
    contrastCurve: new p(1.5, 3, 4.5, 7),
  })
  a.outlineVariant = m.fromPalette({
    name: 'outline_variant',
    palette: (t) => t.neutralVariantPalette,
    tone: (t) => (t.isDark ? 30 : 80),
    background: (t) => a.highestSurface(t),
    contrastCurve: new p(1, 1, 3, 4.5),
  })
  a.shadow = m.fromPalette({ name: 'shadow', palette: (t) => t.neutralPalette, tone: (t) => 0 })
  a.scrim = m.fromPalette({ name: 'scrim', palette: (t) => t.neutralPalette, tone: (t) => 0 })
  a.surfaceTint = m.fromPalette({
    name: 'surface_tint',
    palette: (t) => t.primaryPalette,
    tone: (t) => (t.isDark ? 80 : 40),
    isBackground: !0,
  })
  a.primary = m.fromPalette({
    name: 'primary',
    palette: (t) => t.primaryPalette,
    tone: (t) => (D(t) ? (t.isDark ? 100 : 0) : t.isDark ? 80 : 40),
    isBackground: !0,
    background: (t) => a.highestSurface(t),
    contrastCurve: new p(3, 4.5, 7, 7),
    toneDeltaPair: (t) => new v(a.primaryContainer, a.primary, 10, 'nearer', !1),
  })
  a.onPrimary = m.fromPalette({
    name: 'on_primary',
    palette: (t) => t.primaryPalette,
    tone: (t) => (D(t) ? (t.isDark ? 10 : 90) : t.isDark ? 20 : 100),
    background: (t) => a.primary,
    contrastCurve: new p(4.5, 7, 11, 21),
  })
  a.primaryContainer = m.fromPalette({
    name: 'primary_container',
    palette: (t) => t.primaryPalette,
    tone: (t) => (ot(t) ? t.sourceColorHct.tone : D(t) ? (t.isDark ? 85 : 25) : t.isDark ? 30 : 90),
    isBackground: !0,
    background: (t) => a.highestSurface(t),
    contrastCurve: new p(1, 1, 3, 4.5),
    toneDeltaPair: (t) => new v(a.primaryContainer, a.primary, 10, 'nearer', !1),
  })
  a.onPrimaryContainer = m.fromPalette({
    name: 'on_primary_container',
    palette: (t) => t.primaryPalette,
    tone: (t) =>
      ot(t)
        ? m.foregroundTone(a.primaryContainer.tone(t), 4.5)
        : D(t)
          ? t.isDark
            ? 0
            : 100
          : t.isDark
            ? 90
            : 30,
    background: (t) => a.primaryContainer,
    contrastCurve: new p(3, 4.5, 7, 11),
  })
  a.inversePrimary = m.fromPalette({
    name: 'inverse_primary',
    palette: (t) => t.primaryPalette,
    tone: (t) => (t.isDark ? 40 : 80),
    background: (t) => a.inverseSurface,
    contrastCurve: new p(3, 4.5, 7, 7),
  })
  a.secondary = m.fromPalette({
    name: 'secondary',
    palette: (t) => t.secondaryPalette,
    tone: (t) => (t.isDark ? 80 : 40),
    isBackground: !0,
    background: (t) => a.highestSurface(t),
    contrastCurve: new p(3, 4.5, 7, 7),
    toneDeltaPair: (t) => new v(a.secondaryContainer, a.secondary, 10, 'nearer', !1),
  })
  a.onSecondary = m.fromPalette({
    name: 'on_secondary',
    palette: (t) => t.secondaryPalette,
    tone: (t) => (D(t) ? (t.isDark ? 10 : 100) : t.isDark ? 20 : 100),
    background: (t) => a.secondary,
    contrastCurve: new p(4.5, 7, 11, 21),
  })
  a.secondaryContainer = m.fromPalette({
    name: 'secondary_container',
    palette: (t) => t.secondaryPalette,
    tone: (t) => {
      let e = t.isDark ? 30 : 90
      return D(t)
        ? t.isDark
          ? 30
          : 85
        : ot(t)
          ? te(t.secondaryPalette.hue, t.secondaryPalette.chroma, e, !t.isDark)
          : e
    },
    isBackground: !0,
    background: (t) => a.highestSurface(t),
    contrastCurve: new p(1, 1, 3, 4.5),
    toneDeltaPair: (t) => new v(a.secondaryContainer, a.secondary, 10, 'nearer', !1),
  })
  a.onSecondaryContainer = m.fromPalette({
    name: 'on_secondary_container',
    palette: (t) => t.secondaryPalette,
    tone: (t) =>
      D(t)
        ? t.isDark
          ? 90
          : 10
        : ot(t)
          ? m.foregroundTone(a.secondaryContainer.tone(t), 4.5)
          : t.isDark
            ? 90
            : 30,
    background: (t) => a.secondaryContainer,
    contrastCurve: new p(3, 4.5, 7, 11),
  })
  a.tertiary = m.fromPalette({
    name: 'tertiary',
    palette: (t) => t.tertiaryPalette,
    tone: (t) => (D(t) ? (t.isDark ? 90 : 25) : t.isDark ? 80 : 40),
    isBackground: !0,
    background: (t) => a.highestSurface(t),
    contrastCurve: new p(3, 4.5, 7, 7),
    toneDeltaPair: (t) => new v(a.tertiaryContainer, a.tertiary, 10, 'nearer', !1),
  })
  a.onTertiary = m.fromPalette({
    name: 'on_tertiary',
    palette: (t) => t.tertiaryPalette,
    tone: (t) => (D(t) ? (t.isDark ? 10 : 90) : t.isDark ? 20 : 100),
    background: (t) => a.tertiary,
    contrastCurve: new p(4.5, 7, 11, 21),
  })
  a.tertiaryContainer = m.fromPalette({
    name: 'tertiary_container',
    palette: (t) => t.tertiaryPalette,
    tone: (t) => {
      if (D(t)) return t.isDark ? 60 : 49
      if (!ot(t)) return t.isDark ? 30 : 90
      let e = t.tertiaryPalette.getHct(t.sourceColorHct.tone)
      return nt.fixIfDisliked(e).tone
    },
    isBackground: !0,
    background: (t) => a.highestSurface(t),
    contrastCurve: new p(1, 1, 3, 4.5),
    toneDeltaPair: (t) => new v(a.tertiaryContainer, a.tertiary, 10, 'nearer', !1),
  })
  a.onTertiaryContainer = m.fromPalette({
    name: 'on_tertiary_container',
    palette: (t) => t.tertiaryPalette,
    tone: (t) =>
      D(t)
        ? t.isDark
          ? 0
          : 100
        : ot(t)
          ? m.foregroundTone(a.tertiaryContainer.tone(t), 4.5)
          : t.isDark
            ? 90
            : 30,
    background: (t) => a.tertiaryContainer,
    contrastCurve: new p(3, 4.5, 7, 11),
  })
  a.error = m.fromPalette({
    name: 'error',
    palette: (t) => t.errorPalette,
    tone: (t) => (t.isDark ? 80 : 40),
    isBackground: !0,
    background: (t) => a.highestSurface(t),
    contrastCurve: new p(3, 4.5, 7, 7),
    toneDeltaPair: (t) => new v(a.errorContainer, a.error, 10, 'nearer', !1),
  })
  a.onError = m.fromPalette({
    name: 'on_error',
    palette: (t) => t.errorPalette,
    tone: (t) => (t.isDark ? 20 : 100),
    background: (t) => a.error,
    contrastCurve: new p(4.5, 7, 11, 21),
  })
  a.errorContainer = m.fromPalette({
    name: 'error_container',
    palette: (t) => t.errorPalette,
    tone: (t) => (t.isDark ? 30 : 90),
    isBackground: !0,
    background: (t) => a.highestSurface(t),
    contrastCurve: new p(1, 1, 3, 4.5),
    toneDeltaPair: (t) => new v(a.errorContainer, a.error, 10, 'nearer', !1),
  })
  a.onErrorContainer = m.fromPalette({
    name: 'on_error_container',
    palette: (t) => t.errorPalette,
    tone: (t) => (D(t) ? (t.isDark ? 90 : 10) : t.isDark ? 90 : 30),
    background: (t) => a.errorContainer,
    contrastCurve: new p(3, 4.5, 7, 11),
  })
  a.primaryFixed = m.fromPalette({
    name: 'primary_fixed',
    palette: (t) => t.primaryPalette,
    tone: (t) => (D(t) ? 40 : 90),
    isBackground: !0,
    background: (t) => a.highestSurface(t),
    contrastCurve: new p(1, 1, 3, 4.5),
    toneDeltaPair: (t) => new v(a.primaryFixed, a.primaryFixedDim, 10, 'lighter', !0),
  })
  a.primaryFixedDim = m.fromPalette({
    name: 'primary_fixed_dim',
    palette: (t) => t.primaryPalette,
    tone: (t) => (D(t) ? 30 : 80),
    isBackground: !0,
    background: (t) => a.highestSurface(t),
    contrastCurve: new p(1, 1, 3, 4.5),
    toneDeltaPair: (t) => new v(a.primaryFixed, a.primaryFixedDim, 10, 'lighter', !0),
  })
  a.onPrimaryFixed = m.fromPalette({
    name: 'on_primary_fixed',
    palette: (t) => t.primaryPalette,
    tone: (t) => (D(t) ? 100 : 10),
    background: (t) => a.primaryFixedDim,
    secondBackground: (t) => a.primaryFixed,
    contrastCurve: new p(4.5, 7, 11, 21),
  })
  a.onPrimaryFixedVariant = m.fromPalette({
    name: 'on_primary_fixed_variant',
    palette: (t) => t.primaryPalette,
    tone: (t) => (D(t) ? 90 : 30),
    background: (t) => a.primaryFixedDim,
    secondBackground: (t) => a.primaryFixed,
    contrastCurve: new p(3, 4.5, 7, 11),
  })
  a.secondaryFixed = m.fromPalette({
    name: 'secondary_fixed',
    palette: (t) => t.secondaryPalette,
    tone: (t) => (D(t) ? 80 : 90),
    isBackground: !0,
    background: (t) => a.highestSurface(t),
    contrastCurve: new p(1, 1, 3, 4.5),
    toneDeltaPair: (t) => new v(a.secondaryFixed, a.secondaryFixedDim, 10, 'lighter', !0),
  })
  a.secondaryFixedDim = m.fromPalette({
    name: 'secondary_fixed_dim',
    palette: (t) => t.secondaryPalette,
    tone: (t) => (D(t) ? 70 : 80),
    isBackground: !0,
    background: (t) => a.highestSurface(t),
    contrastCurve: new p(1, 1, 3, 4.5),
    toneDeltaPair: (t) => new v(a.secondaryFixed, a.secondaryFixedDim, 10, 'lighter', !0),
  })
  a.onSecondaryFixed = m.fromPalette({
    name: 'on_secondary_fixed',
    palette: (t) => t.secondaryPalette,
    tone: (t) => 10,
    background: (t) => a.secondaryFixedDim,
    secondBackground: (t) => a.secondaryFixed,
    contrastCurve: new p(4.5, 7, 11, 21),
  })
  a.onSecondaryFixedVariant = m.fromPalette({
    name: 'on_secondary_fixed_variant',
    palette: (t) => t.secondaryPalette,
    tone: (t) => (D(t) ? 25 : 30),
    background: (t) => a.secondaryFixedDim,
    secondBackground: (t) => a.secondaryFixed,
    contrastCurve: new p(3, 4.5, 7, 11),
  })
  a.tertiaryFixed = m.fromPalette({
    name: 'tertiary_fixed',
    palette: (t) => t.tertiaryPalette,
    tone: (t) => (D(t) ? 40 : 90),
    isBackground: !0,
    background: (t) => a.highestSurface(t),
    contrastCurve: new p(1, 1, 3, 4.5),
    toneDeltaPair: (t) => new v(a.tertiaryFixed, a.tertiaryFixedDim, 10, 'lighter', !0),
  })
  a.tertiaryFixedDim = m.fromPalette({
    name: 'tertiary_fixed_dim',
    palette: (t) => t.tertiaryPalette,
    tone: (t) => (D(t) ? 30 : 80),
    isBackground: !0,
    background: (t) => a.highestSurface(t),
    contrastCurve: new p(1, 1, 3, 4.5),
    toneDeltaPair: (t) => new v(a.tertiaryFixed, a.tertiaryFixedDim, 10, 'lighter', !0),
  })
  a.onTertiaryFixed = m.fromPalette({
    name: 'on_tertiary_fixed',
    palette: (t) => t.tertiaryPalette,
    tone: (t) => (D(t) ? 100 : 10),
    background: (t) => a.tertiaryFixedDim,
    secondBackground: (t) => a.tertiaryFixed,
    contrastCurve: new p(4.5, 7, 11, 21),
  })
  a.onTertiaryFixedVariant = m.fromPalette({
    name: 'on_tertiary_fixed_variant',
    palette: (t) => t.tertiaryPalette,
    tone: (t) => (D(t) ? 90 : 30),
    background: (t) => a.tertiaryFixedDim,
    secondBackground: (t) => a.tertiaryFixed,
    contrastCurve: new p(3, 4.5, 7, 11),
  })
  var O = class {
    constructor(e) {
      ;((this.sourceColorArgb = e.sourceColorArgb),
        (this.variant = e.variant),
        (this.contrastLevel = e.contrastLevel),
        (this.isDark = e.isDark),
        (this.sourceColorHct = I.fromInt(e.sourceColorArgb)),
        (this.primaryPalette = e.primaryPalette),
        (this.secondaryPalette = e.secondaryPalette),
        (this.tertiaryPalette = e.tertiaryPalette),
        (this.neutralPalette = e.neutralPalette),
        (this.neutralVariantPalette = e.neutralVariantPalette),
        (this.errorPalette = P.fromHueAndChroma(25, 84)))
    }
    static getRotatedHue(e, r, n) {
      let o = e.hue
      if (r.length !== n.length)
        throw new Error(`mismatch between hue length ${r.length} & rotations ${n.length}`)
      if (n.length === 1) return N(e.hue + n[0])
      let i = r.length
      for (let s = 0; s <= i - 2; s++) {
        let c = r[s],
          l = r[s + 1]
        if (c < o && o < l) return N(o + n[s])
      }
      return o
    }
    getArgb(e) {
      return e.getArgb(this)
    }
    getHct(e) {
      return e.getHct(this)
    }
    get primaryPaletteKeyColor() {
      return this.getArgb(a.primaryPaletteKeyColor)
    }
    get secondaryPaletteKeyColor() {
      return this.getArgb(a.secondaryPaletteKeyColor)
    }
    get tertiaryPaletteKeyColor() {
      return this.getArgb(a.tertiaryPaletteKeyColor)
    }
    get neutralPaletteKeyColor() {
      return this.getArgb(a.neutralPaletteKeyColor)
    }
    get neutralVariantPaletteKeyColor() {
      return this.getArgb(a.neutralVariantPaletteKeyColor)
    }
    get background() {
      return this.getArgb(a.background)
    }
    get onBackground() {
      return this.getArgb(a.onBackground)
    }
    get surface() {
      return this.getArgb(a.surface)
    }
    get surfaceDim() {
      return this.getArgb(a.surfaceDim)
    }
    get surfaceBright() {
      return this.getArgb(a.surfaceBright)
    }
    get surfaceContainerLowest() {
      return this.getArgb(a.surfaceContainerLowest)
    }
    get surfaceContainerLow() {
      return this.getArgb(a.surfaceContainerLow)
    }
    get surfaceContainer() {
      return this.getArgb(a.surfaceContainer)
    }
    get surfaceContainerHigh() {
      return this.getArgb(a.surfaceContainerHigh)
    }
    get surfaceContainerHighest() {
      return this.getArgb(a.surfaceContainerHighest)
    }
    get onSurface() {
      return this.getArgb(a.onSurface)
    }
    get surfaceVariant() {
      return this.getArgb(a.surfaceVariant)
    }
    get onSurfaceVariant() {
      return this.getArgb(a.onSurfaceVariant)
    }
    get inverseSurface() {
      return this.getArgb(a.inverseSurface)
    }
    get inverseOnSurface() {
      return this.getArgb(a.inverseOnSurface)
    }
    get outline() {
      return this.getArgb(a.outline)
    }
    get outlineVariant() {
      return this.getArgb(a.outlineVariant)
    }
    get shadow() {
      return this.getArgb(a.shadow)
    }
    get scrim() {
      return this.getArgb(a.scrim)
    }
    get surfaceTint() {
      return this.getArgb(a.surfaceTint)
    }
    get primary() {
      return this.getArgb(a.primary)
    }
    get onPrimary() {
      return this.getArgb(a.onPrimary)
    }
    get primaryContainer() {
      return this.getArgb(a.primaryContainer)
    }
    get onPrimaryContainer() {
      return this.getArgb(a.onPrimaryContainer)
    }
    get inversePrimary() {
      return this.getArgb(a.inversePrimary)
    }
    get secondary() {
      return this.getArgb(a.secondary)
    }
    get onSecondary() {
      return this.getArgb(a.onSecondary)
    }
    get secondaryContainer() {
      return this.getArgb(a.secondaryContainer)
    }
    get onSecondaryContainer() {
      return this.getArgb(a.onSecondaryContainer)
    }
    get tertiary() {
      return this.getArgb(a.tertiary)
    }
    get onTertiary() {
      return this.getArgb(a.onTertiary)
    }
    get tertiaryContainer() {
      return this.getArgb(a.tertiaryContainer)
    }
    get onTertiaryContainer() {
      return this.getArgb(a.onTertiaryContainer)
    }
    get error() {
      return this.getArgb(a.error)
    }
    get onError() {
      return this.getArgb(a.onError)
    }
    get errorContainer() {
      return this.getArgb(a.errorContainer)
    }
    get onErrorContainer() {
      return this.getArgb(a.onErrorContainer)
    }
    get primaryFixed() {
      return this.getArgb(a.primaryFixed)
    }
    get primaryFixedDim() {
      return this.getArgb(a.primaryFixedDim)
    }
    get onPrimaryFixed() {
      return this.getArgb(a.onPrimaryFixed)
    }
    get onPrimaryFixedVariant() {
      return this.getArgb(a.onPrimaryFixedVariant)
    }
    get secondaryFixed() {
      return this.getArgb(a.secondaryFixed)
    }
    get secondaryFixedDim() {
      return this.getArgb(a.secondaryFixedDim)
    }
    get onSecondaryFixed() {
      return this.getArgb(a.onSecondaryFixed)
    }
    get onSecondaryFixedVariant() {
      return this.getArgb(a.onSecondaryFixedVariant)
    }
    get tertiaryFixed() {
      return this.getArgb(a.tertiaryFixed)
    }
    get tertiaryFixedDim() {
      return this.getArgb(a.tertiaryFixedDim)
    }
    get onTertiaryFixed() {
      return this.getArgb(a.onTertiaryFixed)
    }
    get onTertiaryFixedVariant() {
      return this.getArgb(a.onTertiaryFixedVariant)
    }
  }
  var ct = class t extends O {
    constructor(e, r, n) {
      super({
        sourceColorArgb: e.toInt(),
        variant: B.EXPRESSIVE,
        contrastLevel: n,
        isDark: r,
        primaryPalette: P.fromHueAndChroma(N(e.hue + 240), 40),
        secondaryPalette: P.fromHueAndChroma(O.getRotatedHue(e, t.hues, t.secondaryRotations), 24),
        tertiaryPalette: P.fromHueAndChroma(O.getRotatedHue(e, t.hues, t.tertiaryRotations), 32),
        neutralPalette: P.fromHueAndChroma(e.hue + 15, 8),
        neutralVariantPalette: P.fromHueAndChroma(e.hue + 15, 12),
      })
    }
  }
  ct.hues = [0, 21, 51, 121, 151, 191, 271, 321, 360]
  ct.secondaryRotations = [45, 95, 45, 20, 45, 90, 45, 45, 45]
  ct.tertiaryRotations = [120, 120, 20, 45, 20, 15, 20, 120, 120]
  var xt = class extends O {
    constructor(e, r, n) {
      super({
        sourceColorArgb: e.toInt(),
        variant: B.TONAL_SPOT,
        contrastLevel: n,
        isDark: r,
        primaryPalette: P.fromHueAndChroma(e.hue, 36),
        secondaryPalette: P.fromHueAndChroma(e.hue, 16),
        tertiaryPalette: P.fromHueAndChroma(N(e.hue + 60), 24),
        neutralPalette: P.fromHueAndChroma(e.hue, 6),
        neutralVariantPalette: P.fromHueAndChroma(e.hue, 8),
      })
    }
  }
  var lt = class t extends O {
    constructor(e, r, n) {
      super({
        sourceColorArgb: e.toInt(),
        variant: B.VIBRANT,
        contrastLevel: n,
        isDark: r,
        primaryPalette: P.fromHueAndChroma(e.hue, 200),
        secondaryPalette: P.fromHueAndChroma(O.getRotatedHue(e, t.hues, t.secondaryRotations), 24),
        tertiaryPalette: P.fromHueAndChroma(O.getRotatedHue(e, t.hues, t.tertiaryRotations), 32),
        neutralPalette: P.fromHueAndChroma(e.hue, 10),
        neutralVariantPalette: P.fromHueAndChroma(e.hue, 12),
      })
    }
  }
  lt.hues = [0, 41, 61, 101, 131, 181, 251, 301, 360]
  lt.secondaryRotations = [18, 15, 10, 12, 15, 18, 15, 12, 12]
  lt.tertiaryRotations = [35, 30, 20, 25, 30, 35, 30, 25, 25]
  var ne = { desired: 4, fallbackColorARGB: 4282549748, filter: !0 }
  function oe(t, e) {
    return t.score > e.score ? -1 : t.score < e.score ? 1 : 0
  }
  var Y = class t {
    constructor() {}
    static score(e, r) {
      let { desired: n, fallbackColorARGB: o, filter: i } = { ...ne, ...r },
        s = [],
        c = new Array(360).fill(0),
        l = 0
      for (let [f, b] of e.entries()) {
        let g = I.fromInt(f)
        s.push(g)
        let C = Math.floor(g.hue)
        ;((c[C] += b), (l += b))
      }
      let h = new Array(360).fill(0)
      for (let f = 0; f < 360; f++) {
        let b = c[f] / l
        for (let g = f - 14; g < f + 16; g++) {
          let C = dt(g)
          h[C] += b
        }
      }
      let u = new Array()
      for (let f of s) {
        let b = dt(Math.round(f.hue)),
          g = h[b]
        if (i && (f.chroma < t.CUTOFF_CHROMA || g <= t.CUTOFF_EXCITED_PROPORTION)) continue
        let C = g * 100 * t.WEIGHT_PROPORTION,
          T = f.chroma < t.TARGET_CHROMA ? t.WEIGHT_CHROMA_BELOW : t.WEIGHT_CHROMA_ABOVE,
          M = (f.chroma - t.TARGET_CHROMA) * T,
          A = C + M
        u.push({ hct: f, score: A })
      }
      u.sort(oe)
      let d = []
      for (let f = 90; f >= 15; f--) {
        d.length = 0
        for (let { hct: b } of u)
          if ((d.find((C) => Dt(b.hue, C.hue) < f) || d.push(b), d.length >= n)) break
        if (d.length >= n) break
      }
      let y = []
      d.length === 0 && y.push(o)
      for (let f of d) y.push(f.toInt())
      return y
    }
  }
  Y.TARGET_CHROMA = 48
  Y.WEIGHT_PROPORTION = 0.7
  Y.WEIGHT_CHROMA_ABOVE = 0.3
  Y.WEIGHT_CHROMA_BELOW = 0.1
  Y.CUTOFF_CHROMA = 5
  Y.CUTOFF_EXCITED_PROPORTION = 0.01
  function Ft(t) {
    let e = yt(t),
      r = bt(t),
      n = Ct(t),
      o = [e.toString(16), r.toString(16), n.toString(16)]
    for (let [i, s] of o.entries()) s.length === 1 && (o[i] = '0' + s)
    return '#' + o.join('')
  }
  function Ut(t) {
    t = t.replace('#', '')
    let e = t.length === 3,
      r = t.length === 6,
      n = t.length === 8
    if (!e && !r && !n) throw new Error('unexpected hex ' + t)
    let o = 0,
      i = 0,
      s = 0
    return (
      e
        ? ((o = W(t.slice(0, 1).repeat(2))),
          (i = W(t.slice(1, 2).repeat(2))),
          (s = W(t.slice(2, 3).repeat(2))))
        : r
          ? ((o = W(t.slice(0, 2))), (i = W(t.slice(2, 4))), (s = W(t.slice(4, 6))))
          : n && ((o = W(t.slice(2, 4))), (i = W(t.slice(4, 6))), (s = W(t.slice(6, 8)))),
      ((255 << 24) | ((o & 255) << 16) | ((i & 255) << 8) | (s & 255)) >>> 0
    )
  }
  function W(t) {
    return parseInt(t, 16)
  }
  function et(t) {
    if (typeof t != 'string' || t.length > 64) return null
    let e = t.trim()
    if (/^#[0-9a-f]{6}$/i.test(e)) return e.toUpperCase()
    let r = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(e)
    if (!r) return null
    let n = r.slice(1).map(Number)
    return n.some((o) => o > 255)
      ? null
      : '#' +
          n
            .map((o) => o.toString(16).padStart(2, '0'))
            .join('')
            .toUpperCase()
  }
  var ae = {
    primary: 'primary',
    'on-primary': 'onPrimary',
    'primary-container': 'primaryContainer',
    'on-primary-container': 'onPrimaryContainer',
    secondary: 'secondary',
    'on-secondary': 'onSecondary',
    'secondary-container': 'secondaryContainer',
    'on-secondary-container': 'onSecondaryContainer',
    tertiary: 'tertiary',
    'on-tertiary': 'onTertiary',
    'tertiary-container': 'tertiaryContainer',
    'on-tertiary-container': 'onTertiaryContainer',
    surface: 'surface',
    'on-surface': 'onSurface',
    'surface-variant': 'surfaceVariant',
    'on-surface-variant': 'onSurfaceVariant',
    'surface-container-lowest': 'surfaceContainerLowest',
    'surface-container-low': 'surfaceContainerLow',
    'surface-container': 'surfaceContainer',
    'surface-container-high': 'surfaceContainerHigh',
    'surface-container-highest': 'surfaceContainerHighest',
    outline: 'outline',
    'outline-variant': 'outlineVariant',
    error: 'error',
    'on-error': 'onError',
    'error-container': 'errorContainer',
    'on-error-container': 'onErrorContainer',
    'inverse-surface': 'inverseSurface',
    'inverse-on-surface': 'inverseOnSurface',
    'inverse-primary': 'inversePrimary',
  }
  function se(t) {
    let [e, r, n] = [1, 3, 5].map((u) => parseInt(t.slice(u, u + 2), 16) / 255),
      o = Math.max(e, r, n),
      i = Math.min(e, r, n),
      s = o - i,
      c = (o + i) / 2,
      l = 0
    s &&
      (l =
        (o === e ? (r - n) / s + (r < n ? 6 : 0) : o === r ? (n - e) / s + 2 : (e - r) / s + 4) *
        60)
    let h = s === 0 ? 0 : s / (1 - Math.abs(2 * c - 1))
    return `${l.toFixed(3)}, ${(h * 100).toFixed(3)}%, ${(c * 100).toFixed(3)}%`
  }
  var at = new Map()
  function zt(t, e) {
    let r = et(t) ?? '#6750A4',
      n = r + e
    if (at.has(n)) return at.get(n)
    let o = new xt(I.fromInt(Ut(r)), e, 0),
      i = {},
      s = (c, l) => {
        ;((i[`--color-${c}`] = l), (i[`--hsl-${c}`] = se(l)))
      }
    for (let [c, l] of Object.entries(ae)) s(c, Ft(o[l]))
    for (let [c, l] of Object.entries({
      body: 'surface',
      text: 'on-surface',
      info: 'secondary',
      'on-info': 'on-secondary',
      'info-container': 'secondary-container',
      'on-info-container': 'on-secondary-container',
      danger: 'error',
      'on-danger': 'on-error',
      'danger-container': 'error-container',
      'on-danger-container': 'on-error-container',
    }))
      s(c, i[`--color-${l}`])
    return (
      s('success', e ? '#8DDA91' : '#146C2E'),
      s('on-success', e ? '#003910' : '#FFFFFF'),
      s('success-container', e ? '#00531B' : '#A8F5AC'),
      s('on-success-container', e ? '#A8F5AC' : '#002108'),
      s('warning', e ? '#F6BF48' : '#795900'),
      s('on-warning', e ? '#402D00' : '#FFFFFF'),
      s('warning-container', e ? '#5C4300' : '#FFDF9E'),
      s('on-warning-container', e ? '#FFDF9E' : '#261A00'),
      at.size >= 32 && at.delete(at.keys().next().value),
      at.set(n, i),
      i
    )
  }
  var ie = /^\/api\/background\/([a-f0-9]{64})$/
  function _t(t) {
    return ie.test(t)
  }
  var ut = {
    mode: 'system',
    sourceColor: '#6750A4',
    reduceMotion: !1,
    background: {
      source: 'builtin',
      url: '',
      layout: 'page',
      fit: 'cover',
      x: 50,
      y: 35,
      overlay: 20,
      cardOpacity: 50,
      cardBlur: 8,
    },
  }
  function St(t) {
    let e = structuredClone(ut)
    if (!t || typeof t != 'object') return e
    let r = t
    ;((e.sourceColor = et(r.sourceColor) ?? e.sourceColor),
      (r.mode === 'system' || r.mode === 'light' || r.mode === 'dark') && (e.mode = r.mode),
      typeof r.reduceMotion == 'boolean' && (e.reduceMotion = r.reduceMotion))
    let n = r.background
    if (n && typeof n == 'object') {
      ;(['off', 'builtin', 'custom', 'uploaded'].includes(n.source) &&
        (e.background.source = n.source),
        typeof n.url == 'string' &&
          n.url.length <= 2048 &&
          (ce(n.url) || _t(n.url)) &&
          (e.background.url = n.url),
        (n.layout === 'banner' || n.layout === 'page') && (e.background.layout = n.layout),
        (n.fit === 'cover' || n.fit === 'contain') && (e.background.fit = n.fit))
      for (let o of ['x', 'y', 'overlay', 'cardOpacity', 'cardBlur'])
        typeof n[o] == 'number' &&
          Number.isFinite(n[o]) &&
          (e.background[o] = Math.min(o === 'cardBlur' ? 20 : 100, Math.max(0, n[o])))
    }
    return e
  }
  function ce(t) {
    if (!t) return !1
    try {
      let e = new URL(t)
      return e.protocol === 'https:' && !e.username && !e.password
    } catch {
      return !1
    }
  }
  function Gt(t) {
    if (!t || typeof t != 'object') return {}
    let e = t
    if (e.version === 2 && e.overrides && typeof e.overrides == 'object') {
      let o = e.overrides,
        i = St(o),
        s = {}
      for (let c of ['mode', 'sourceColor', 'reduceMotion'])
        Object.hasOwn(o, c) && Object.assign(s, { [c]: i[c] })
      if (o.background) {
        s.background = {}
        for (let c of Object.keys(ut.background))
          Object.hasOwn(o.background, c) && Object.assign(s.background, { [c]: i.background[c] })
      }
      return s
    }
    let r = St(t),
      n = {}
    for (let o of ['mode', 'sourceColor', 'reduceMotion'])
      r[o] !== ut[o] && Object.assign(n, { [o]: r[o] })
    for (let o of Object.keys(r.background))
      r.background[o] !== ut.background[o] &&
        ((n.background ??= {}), Object.assign(n.background, { [o]: r.background[o] }))
    return n
  }
  function jt() {
    let t = window,
      e = matchMedia('(prefers-reduced-motion: reduce)')
    if (
      t.__NOZOKI_DX_CURTAIN__ ||
      t.__NOZOKI_DX_BOOT__ ||
      t.__NOZOKI_DX_APP_MOUNTED__ ||
      document.hidden ||
      e.matches ||
      document.documentElement.dataset.nozokiReduced === 'true'
    )
      return
    let r = document.createElement('div')
    ;((r.className = 'dx-transition'),
      (r.dataset.phase = 'boot'),
      r.setAttribute('aria-hidden', 'true'))
    let n = document.createElement('div')
    ;((n.className = 'dx-veil'), r.append(n), document.documentElement.append(r))
    let o = !1,
      i = () => {
        ;(clearTimeout(h),
          window.removeEventListener('pagehide', s),
          document.removeEventListener('visibilitychange', c),
          e.removeEventListener('change', l))
      },
      s = () => {
        ;(i(), o || r.remove())
      },
      c = () => {
        document.hidden && s()
      },
      l = () => {
        e.matches && s()
      },
      h = setTimeout(s, 12e3)
    ;(window.addEventListener('pagehide', s),
      document.addEventListener('visibilitychange', c),
      e.addEventListener('change', l),
      (t.__NOZOKI_DX_CURTAIN__ = {
        element: r,
        claim() {
          return (i(), o || !r.isConnected ? null : ((o = !0), r))
        },
        cancel: s,
      }))
  }
  try {
    let t = null
    try {
      t = Gt(
        JSON.parse(
          localStorage.getItem('nozoki-appearance-v2') ||
            localStorage.getItem('nozoki-appearance-v1') ||
            'null',
        ),
      )
    } catch {}
    let e = t && ['light', 'dark'].includes(t.mode) ? t.mode : 'system',
      r = document.documentElement
    ;((r.dataset.nozokiMode = e), (r.dataset.nozokiReduced = String(t?.reduceMotion === !0)))
    let n = et(t?.sourceColor) ?? et(r.dataset.sharedSource) ?? '#6750A4'
    r.dataset.nozokiSource = n
    let o = matchMedia('(prefers-color-scheme: dark)'),
      i = () => {
        let s = r.dataset.nozokiMode
        for (let [c, l] of Object.entries(
          zt(r.dataset.nozokiSource ?? n, s === 'dark' || (s === 'system' && o.matches)),
        ))
          r.style.setProperty(c, l)
      }
    ;(i(), o.addEventListener('change', i))
  } catch {}
  jt()
})()
/*! Bundled license information:

@material/material-color-utilities/utils/math_utils.js:
@material/material-color-utilities/utils/color_utils.js:
@material/material-color-utilities/hct/viewing_conditions.js:
@material/material-color-utilities/hct/cam16.js:
@material/material-color-utilities/hct/hct_solver.js:
@material/material-color-utilities/hct/hct.js:
@material/material-color-utilities/blend/blend.js:
@material/material-color-utilities/palettes/tonal_palette.js:
@material/material-color-utilities/palettes/core_palette.js:
@material/material-color-utilities/quantize/lab_point_provider.js:
@material/material-color-utilities/quantize/quantizer_wsmeans.js:
@material/material-color-utilities/quantize/quantizer_map.js:
@material/material-color-utilities/quantize/quantizer_wu.js:
@material/material-color-utilities/quantize/quantizer_celebi.js:
@material/material-color-utilities/scheme/scheme.js:
@material/material-color-utilities/scheme/scheme_android.js:
@material/material-color-utilities/score/score.js:
@material/material-color-utilities/utils/string_utils.js:
@material/material-color-utilities/utils/image_utils.js:
@material/material-color-utilities/utils/theme_utils.js:
@material/material-color-utilities/index.js:
  (**
   * @license
   * Copyright 2021 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *      http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *)

@material/material-color-utilities/contrast/contrast.js:
@material/material-color-utilities/dynamiccolor/dynamic_color.js:
@material/material-color-utilities/dynamiccolor/variant.js:
@material/material-color-utilities/dynamiccolor/material_dynamic_colors.js:
@material/material-color-utilities/dynamiccolor/dynamic_scheme.js:
@material/material-color-utilities/scheme/scheme_expressive.js:
@material/material-color-utilities/scheme/scheme_fruit_salad.js:
@material/material-color-utilities/scheme/scheme_monochrome.js:
@material/material-color-utilities/scheme/scheme_neutral.js:
@material/material-color-utilities/scheme/scheme_rainbow.js:
@material/material-color-utilities/scheme/scheme_tonal_spot.js:
@material/material-color-utilities/scheme/scheme_vibrant.js:
  (**
   * @license
   * Copyright 2022 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *      http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *)

@material/material-color-utilities/dislike/dislike_analyzer.js:
@material/material-color-utilities/dynamiccolor/contrast_curve.js:
@material/material-color-utilities/dynamiccolor/tone_delta_pair.js:
@material/material-color-utilities/temperature/temperature_cache.js:
@material/material-color-utilities/scheme/scheme_content.js:
@material/material-color-utilities/scheme/scheme_fidelity.js:
  (**
   * @license
   * Copyright 2023 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *      http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *)
*/

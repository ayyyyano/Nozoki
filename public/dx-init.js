/*! Nozoki early transition lifecycle. Original artwork: /vendor/maimai-transition/NOTICE.txt */
;(() => {
  function S(i) {
    let c = null,
      f = 0,
      n = () => new DOMException('Transition cancelled', 'AbortError')
    function O(o) {
      if (c) return c.result
      if (i.reduced() || i.hidden()) return Promise.resolve('skipped')
      let v = new AbortController(),
        w = ++f,
        { signal: p } = v,
        T = (t) => {
          c?.id === w && i.phase(t)
        },
        l = Promise.resolve().then(async () => {
          let t, b
          try {
            if (p.aborted) throw n()
            T('boot')
            let r = !1,
              s = new Promise((g, m) => {
                ;((b = () => m(n())), p.addEventListener('abort', b, { once: !0 }))
                let h = () => {
                  ;((r = !0), t !== void 0 && i.clearTimer(t), (t = void 0), g())
                }
                ;((t = i.setTimer(h, i.readinessBudgetMs ?? 900)),
                  Promise.resolve()
                    .then(o)
                    .then(h, (D) => {
                      ;(i.report?.(D), h())
                    }))
              }).then(
                () => !0,
                () => !1,
              )
            if (
              (await i.frame(p),
              p.aborted ||
                (T('entering'), await i.animate('entering', p), p.aborted) ||
                (r || T('holding'), !(await s) || p.aborted) ||
                (T('leaving'), await i.animate('leaving', p), p.aborted))
            )
              throw n()
            return 'complete'
          } catch (r) {
            return p.aborted ? 'cancelled' : (i.report?.(r), 'failed')
          } finally {
            ;(t !== void 0 && i.clearTimer(t),
              b && p.removeEventListener('abort', b),
              v.abort(),
              c?.id === w && (i.phase('idle'), (c = null)))
          }
        })
      return ((c = { abort: v, result: l, id: w }), l)
    }
    function _() {
      let o = c
      o && ((c = null), o.abort.abort(), i.phase('idle'))
    }
    return {
      start: O,
      cancel: _,
      get running() {
        return c !== null
      },
    }
  }
  function I(i, c = () => {}) {
    let f = [],
      n = 0,
      O = 0,
      _ = (t) => {
        ;((O = t), c(t))
      },
      o = [],
      v,
      w = !1
    function p() {
      for (let t of f) t.cancel()
      ;(cancelAnimationFrame(n),
        (n = 0),
        _(0),
        (f = []),
        (o = []),
        (v = void 0),
        i()?.replaceChildren(),
        (w = !1))
    }
    async function T(t) {
      let b = i()
      if (!b || t.aborted) throw new DOMException('Cancelled', 'AbortError')
      let r = document.createElement('iframe')
      ;((r.title = '\u52A0\u8F7D\u8FC7\u6E21'),
        (r.tabIndex = -1),
        r.setAttribute('aria-hidden', 'true'),
        (r.style.cssText = 'width:100%;height:100%;border:0;display:block;pointer-events:none;'))
      let x = new Promise((s, g) => {
        let m = () => {
            ;(window.removeEventListener('message', D), t.removeEventListener('abort', h))
          },
          h = () => {
            ;(m(), g(new DOMException('Cancelled', 'AbortError')))
          },
          D = (L) => {
            L.source !== r.contentWindow ||
              L.origin !== location.origin ||
              (L.data?.type === 'nozoki-maimai-ready' && (m(), s()),
              L.data?.type === 'nozoki-maimai-error' &&
                (m(), g(new Error('Transition artwork failed'))))
          }
        ;(window.addEventListener('message', D), t.addEventListener('abort', h, { once: !0 }))
      })
      if (((r.src = '/vendor/maimai-transition/player.html'), b.append(r), await x, t.aborted))
        throw new DOMException('Cancelled', 'AbortError')
      if (
        ((v = r.contentDocument.querySelector('.stage')),
        (f = v.getAnimations({ subtree: !0 }).filter((s) => 'animationName' in s)),
        !f.length)
      )
        throw new Error('Reference animations unavailable')
      for (let s of f) {
        let g = s.effect.target,
          m = s.effect.getTiming()
        o.push({
          target: g,
          name: s.animationName,
          delay: m.delay ?? 0,
          duration: Number(m.duration),
        })
      }
      for (let s of f) (s.pause(), (s.currentTime = 0))
      w = !0
    }
    function l(t) {
      if (!w) return
      let b = t === 'leaving',
        r = o.filter((a) => (a.name.includes('-out') || a.name.startsWith('expand-')) === b),
        x = r,
        s = Math.min(...x.map((a) => a.delay)),
        g = Math.max(...x.map((a) => a.delay + Number(a.duration))),
        m = b ? 320 : 240,
        h = r.findLast((a, E) => Math.abs(x[E].delay + x[E].duration - g) < 0.01),
        D = f.find((a) => a.animationName === h.name && a.effect.target === h.target),
        L = r.map((a) => ({
          layer: a,
          animation: f.find((E) => E.animationName === a.name && E.effect.target === a.target),
        }))
      cancelAnimationFrame(n)
      let e,
        u = 0,
        d = (a) => {
          ;(_(0), (u += e === void 0 ? 0 : Math.min(40, a - e)), (e = a))
          let E = Math.min(1, u / m),
            A = s + (g - s) * E
          for (let { layer: M, animation: y } of L)
            y.currentTime = Math.min(A, M.delay + M.duration)
          E < 1 ? (_(1), (n = requestAnimationFrame(d))) : ((n = 0), D.finish())
        }
      return (
        _(1),
        (n = requestAnimationFrame(d)),
        { element: h.target, name: h.name, animation: D }
      )
    }
    return {
      prepare: T,
      draw: l,
      dispose: p,
      get pendingFrames() {
        return O
      },
    }
  }
  var P = window
  if (
    !P.__NOZOKI_DX_BOOT__ &&
    !P.__NOZOKI_DX_APP_MOUNTED__ &&
    (!P.__NOZOKI_DX_CURTAIN__ || P.__NOZOKI_DX_CURTAIN__.element.isConnected)
  ) {
    let i = 'idle',
      c = new Set(),
      f = new Set(),
      n = 0,
      O = 0,
      _ = 0,
      o,
      v,
      w,
      p = new Promise((e) => {
        w = e
      }),
      T = () => ({ phase: i, timers: c.size, frames: O + _, listeners: n }),
      l = () => {
        for (let e of f) e(T())
      },
      t = I(
        () => v ?? null,
        (e) => {
          ;((O = e), l())
        },
      ),
      b = (e, u) => {
        let d = setTimeout(() => {
          ;(c.delete(d), l(), e())
        }, u)
        return (c.add(d), l(), d)
      },
      r = (e) => {
        ;(clearTimeout(e), c.delete(e), l())
      },
      x = !1
    try {
      x = JSON.parse(localStorage.getItem('nozoki-appearance-v1') ?? 'null')?.reduceMotion === !0
    } catch {}
    let s = matchMedia('(prefers-reduced-motion: reduce)'),
      g = S({
        report: (e) => console.warn('DX early initialization fallback', e),
        reduced: () => x || s.matches,
        hidden: () => document.hidden,
        readinessBudgetMs: 1e4,
        setTimer: b,
        clearTimer: r,
        phase(e) {
          if (((i = e), e === 'boot')) {
            if (
              ((o = P.__NOZOKI_DX_CURTAIN__?.claim() ?? document.createElement('div')),
              !o.isConnected)
            ) {
              ;((o.className = 'dx-transition'), o.setAttribute('aria-hidden', 'true'))
              let u = document.createElement('div')
              ;((u.className = 'dx-veil'), o.append(u), document.documentElement.append(o))
            }
            ;((v = document.createElement('div')), (v.className = 'dx-geometry'), o.append(v))
          }
          ;(o && (o.dataset.phase = e), l())
        },
        async frame(e) {
          let u = new AbortController(),
            d = () => u.abort()
          ;(e.addEventListener('abort', d, { once: !0 }), n++, l())
          let a = b(d, 1800)
          try {
            await t.prepare(u.signal)
          } finally {
            ;(r(a), u.abort(), e.removeEventListener('abort', d), n--, l())
          }
          await new Promise((E, A) => {
            let M = 0,
              y = !1,
              C = () => {
                ;(cancelAnimationFrame(M), r(k), e.removeEventListener('abort', R), _--, n--, l())
              },
              N = () => {
                y || ((y = !0), C(), E())
              },
              R = () => {
                y || ((y = !0), C(), A(e.reason))
              },
              k = b(N, 100)
            ;(_++,
              n++,
              l(),
              e.addEventListener('abort', R, { once: !0 }),
              (M = requestAnimationFrame(N)),
              e.aborted && R())
          })
        },
        async animate(e, u) {
          let d = t.draw(e)
          d &&
            (await new Promise((a, E) => {
              let A = !1,
                M = () => {
                  ;(d.element.removeEventListener('animationend', N),
                    d.element.removeEventListener('animationcancel', N),
                    d.animation.removeEventListener('finish', y),
                    u.removeEventListener('abort', C),
                    r(R),
                    (n -= 4),
                    l())
                },
                y = () => {
                  A || ((A = !0), M(), a())
                },
                C = () => {
                  A || ((A = !0), M(), E(u.reason))
                },
                N = (k) => {
                  k.target === d.element && k.animationName === d.name && y()
                },
                R = b(y, 2400)
              ;((n += 4),
                l(),
                d.element.addEventListener('animationend', N),
                d.element.addEventListener('animationcancel', N),
                d.animation.addEventListener('finish', y),
                u.addEventListener('abort', C, { once: !0 }),
                u.aborted && C())
            }))
        },
      }),
      m = () => g.cancel(),
      h = () => {
        document.hidden && m()
      },
      D = () => {
        s.matches && m()
      }
    ;(document.addEventListener('visibilitychange', h),
      window.addEventListener('pagehide', m),
      s.addEventListener('change', D),
      (n += 3))
    let L = g
      .start(() => p)
      .finally(() => {
        ;(w(),
          t.dispose(),
          o?.remove(),
          P.__NOZOKI_DX_CURTAIN__?.cancel(),
          (o = void 0),
          (v = void 0),
          document.removeEventListener('visibilitychange', h),
          window.removeEventListener('pagehide', m),
          s.removeEventListener('change', D),
          (n -= 3))
        for (let e of c) clearTimeout(e)
        ;(c.clear(), l(), f.clear())
      })
    P.__NOZOKI_DX_BOOT__ = {
      done: L,
      snapshot: T,
      ready() {
        w()
      },
      cancel: m,
      subscribe(e) {
        return (f.add(e), e(T()), () => f.delete(e))
      },
    }
  }
})()

/*! Nozoki early transition lifecycle. Original artwork: /vendor/maimai-transition/NOTICE.txt */
;(() => {
  function I(r) {
    let c = null,
      p = 0,
      a = () => new DOMException('Transition cancelled', 'AbortError')
    function k(s) {
      if (c) return c.result
      if (r.reduced() || r.hidden()) return Promise.resolve('skipped')
      let b = new AbortController(),
        E = ++p,
        { signal: l } = b,
        y = (n) => {
          c?.id === E && r.phase(n)
        },
        d = Promise.resolve().then(async () => {
          let n, f
          try {
            if (l.aborted) throw a()
            y('boot')
            let o = !1,
              g = new Promise((x, v) => {
                ;((f = () => v(a())), l.addEventListener('abort', f, { once: !0 }))
                let h = () => {
                  ;((o = !0), n !== void 0 && r.clearTimer(n), (n = void 0), x())
                }
                ;((n = r.setTimer(h, r.readinessBudgetMs ?? 900)),
                  Promise.resolve()
                    .then(s)
                    .then(h, (_) => {
                      ;(r.report?.(_), h())
                    }))
              }).then(
                () => !0,
                () => !1,
              )
            if (
              (await r.frame(l),
              l.aborted ||
                (y('entering'), await r.animate('entering', l), l.aborted) ||
                (o || y('holding'), !(await g) || l.aborted) ||
                (y('leaving'), await r.animate('leaving', l), l.aborted))
            )
              throw a()
            return 'complete'
          } catch (o) {
            if (l.aborted) return 'cancelled'
            if ((r.report?.(o), r.fallback && !r.reduced() && !r.hidden())) {
              y('fallback')
              try {
                await r.fallback(l)
              } catch (w) {
                l.aborted || r.report?.(w)
              }
            }
            return l.aborted ? 'cancelled' : 'failed'
          } finally {
            ;(n !== void 0 && r.clearTimer(n),
              f && l.removeEventListener('abort', f),
              b.abort(),
              c?.id === E && (r.phase('idle'), (c = null)))
          }
        })
      return ((c = { abort: b, result: d, id: E }), d)
    }
    function T() {
      let s = c
      s && ((c = null), s.abort.abort(), r.phase('idle'))
    }
    return {
      start: k,
      cancel: T,
      get running() {
        return c !== null
      },
    }
  }
  var C = '/vendor/maimai-transition/',
    F = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="${C}upstream.css">
<link rel="stylesheet" href="${C}player.css">
<div class="stage"><div class="frame"></div></div>`
  function B(r, c = () => {}) {
    let p = [],
      a = 0,
      k = 0,
      T = (n) => {
        ;((k = n), c(n))
      },
      s = [],
      b,
      E = !1
    function l() {
      for (let n of p) n.cancel()
      ;(cancelAnimationFrame(a),
        (a = 0),
        T(0),
        (p = []),
        (s = []),
        (b = void 0),
        r()?.replaceChildren(),
        (E = !1))
    }
    async function y(n) {
      let f = r()
      if (!f || n.aborted) throw new DOMException('Cancelled', 'AbortError')
      let o = document.createElement('iframe')
      ;((o.title = '\u52A0\u8F7D\u8FC7\u6E21'),
        (o.tabIndex = -1),
        o.setAttribute('aria-hidden', 'true'),
        o.setAttribute('sandbox', 'allow-same-origin'),
        (o.style.cssText = 'width:100%;height:100%;border:0;display:block;pointer-events:none;'))
      let w = new Promise((m, e) => {
        let i = () => {
            ;(o.removeEventListener('load', u), n.removeEventListener('abort', t))
          },
          t = () => {
            ;(i(), e(n.reason))
          },
          u = () => {
            ;(i(), m())
          }
        ;(o.addEventListener('load', u, { once: !0 }), n.addEventListener('abort', t, { once: !0 }))
      })
      ;((o.srcdoc = F), f.append(o))
      let g = fetch(`${C}transition.svg`, { signal: n }).then((m) => {
          if (!m.ok) throw new Error(`Transition artwork HTTP ${m.status}`)
          return m.text()
        }),
        [, x] = await Promise.all([w, g])
      ;(n.throwIfAborted(), (b = o.contentDocument?.querySelector('.stage') ?? void 0))
      let v = b?.querySelector('.frame')
      if (!b || !v) throw new Error('Transition frame unavailable')
      v.innerHTML = x
      let h = v.querySelector('svg')
      if (!h) throw new Error('Transition artwork unavailable')
      let _ = h.querySelector('#\u6EF4\u62C9\u718A')
      if (
        (_ && h.append(_),
        (p = b.getAnimations({ subtree: !0 }).filter((m) => 'animationName' in m)),
        !p.length)
      )
        throw new Error('Reference animations unavailable')
      for (let m of p) {
        let e = m.effect.target,
          i = m.effect.getTiming()
        s.push({
          target: e,
          name: m.animationName,
          delay: i.delay ?? 0,
          duration: Number(i.duration),
        })
      }
      for (let m of p) (m.pause(), (m.currentTime = 0))
      E = !0
    }
    function d(n) {
      if (!E) return
      let f = n === 'leaving',
        o = s.filter((t) => (t.name.includes('-out') || t.name.startsWith('expand-')) === f),
        w = o,
        g = Math.min(...w.map((t) => t.delay)),
        x = Math.max(...w.map((t) => t.delay + Number(t.duration))),
        v = f ? 320 : 240,
        h = o.findLast((t, u) => Math.abs(w[u].delay + w[u].duration - x) < 0.01),
        _ = p.find((t) => t.animationName === h.name && t.effect.target === h.target),
        m = o.map((t) => ({
          layer: t,
          animation: p.find((u) => u.animationName === t.name && u.effect.target === t.target),
        }))
      cancelAnimationFrame(a)
      let e = performance.now(),
        i = (t) => {
          T(0)
          let u = Math.max(0, Math.min(1, (t - e) / v)),
            O = g + (x - g) * u
          for (let { layer: L, animation: A } of m)
            A.currentTime = Math.min(O, L.delay + L.duration)
          u < 1 ? (T(1), (a = requestAnimationFrame(i))) : ((a = 0), _.finish())
        }
      return (
        T(1),
        (a = requestAnimationFrame(i)),
        { element: h.target, name: h.name, animation: _ }
      )
    }
    return {
      prepare: y,
      draw: d,
      dispose: l,
      get pendingFrames() {
        return k
      },
    }
  }
  var M = window
  if (
    !M.__NOZOKI_DX_BOOT__ &&
    !M.__NOZOKI_DX_APP_MOUNTED__ &&
    (!M.__NOZOKI_DX_CURTAIN__ || M.__NOZOKI_DX_CURTAIN__.element.isConnected)
  ) {
    let r = 'idle',
      c = new Set(),
      p = new Set(),
      a = 0,
      k = 0,
      T = 0,
      s,
      b,
      E,
      l = new Promise((e) => {
        E = e
      }),
      y = () => ({ phase: r, timers: c.size, frames: k + T, listeners: a }),
      d = () => {
        for (let e of p) e(y())
      },
      n = B(
        () => b ?? null,
        (e) => {
          ;((k = e), d())
        },
      ),
      f = (e, i) => {
        let t = setTimeout(() => {
          ;(c.delete(t), d(), e())
        }, i)
        return (c.add(t), d(), t)
      },
      o = (e) => {
        ;(clearTimeout(e), c.delete(e), d())
      },
      w = !1
    try {
      let e = JSON.parse(
        localStorage.getItem('nozoki-appearance-v2') ??
          localStorage.getItem('nozoki-appearance-v1') ??
          'null',
      )
      w = (e?.version === 2 ? e.overrides : e)?.reduceMotion === !0
    } catch {}
    let g = matchMedia('(prefers-reduced-motion: reduce)'),
      x = I({
        report: (e) => console.warn('DX early initialization fallback', e),
        reduced: () => w || g.matches || document.documentElement.dataset.nozokiReduced === 'true',
        hidden: () => document.hidden,
        readinessBudgetMs: 1e4,
        setTimer: f,
        clearTimer: o,
        phase(e) {
          if (((r = e), e === 'boot')) {
            if (
              ((s = M.__NOZOKI_DX_CURTAIN__?.claim() ?? document.createElement('div')),
              !s.isConnected)
            ) {
              ;((s.className = 'dx-transition'), s.setAttribute('aria-hidden', 'true'))
              let i = document.createElement('div')
              ;((i.className = 'dx-veil'), s.append(i), document.documentElement.append(s))
            }
            ;((b = document.createElement('div')), (b.className = 'dx-geometry'), s.append(b))
          }
          ;(s && (s.dataset.phase = e), d())
        },
        async frame(e) {
          let i = new AbortController(),
            t = () => i.abort()
          ;(e.addEventListener('abort', t, { once: !0 }), a++, d())
          let u = f(
            () => i.abort(new DOMException('Transition artwork timed out', 'TimeoutError')),
            1800,
          )
          try {
            await n.prepare(i.signal)
          } finally {
            ;(o(u), i.abort(), e.removeEventListener('abort', t), a--, d())
          }
          await new Promise((O, L) => {
            let A = 0,
              D = !1,
              N = () => {
                ;(cancelAnimationFrame(A), o(R), e.removeEventListener('abort', S), T--, a--, d())
              },
              P = () => {
                D || ((D = !0), N(), O())
              },
              S = () => {
                D || ((D = !0), N(), L(e.reason))
              },
              R = f(P, 100)
            ;(T++,
              a++,
              d(),
              e.addEventListener('abort', S, { once: !0 }),
              (A = requestAnimationFrame(P)),
              e.aborted && S())
          })
        },
        async animate(e, i) {
          let t = n.draw(e)
          t &&
            (await new Promise((u, O) => {
              let L = !1,
                A = () => {
                  ;(t.element.removeEventListener('animationend', P),
                    t.element.removeEventListener('animationcancel', P),
                    t.animation.removeEventListener('finish', D),
                    i.removeEventListener('abort', N),
                    o(S),
                    (a -= 4),
                    d())
                },
                D = () => {
                  L || ((L = !0), A(), u())
                },
                N = () => {
                  L || ((L = !0), A(), O(i.reason))
                },
                P = (R) => {
                  R.target === t.element && R.animationName === t.name && D()
                },
                S = f(D, 2400)
              ;((a += 4),
                d(),
                t.element.addEventListener('animationend', P),
                t.element.addEventListener('animationcancel', P),
                t.animation.addEventListener('finish', D),
                i.addEventListener('abort', N, { once: !0 }),
                i.aborted && N())
            }))
        },
        fallback(e) {
          return (
            n.dispose(),
            !s || e.aborted
              ? Promise.resolve()
              : new Promise((i) => {
                  let t = () => {
                      ;(o(u), e.removeEventListener('abort', t), a--, d(), i())
                    },
                    u = f(t, 150)
                  ;(a++, d(), e.addEventListener('abort', t, { once: !0 }), e.aborted && t())
                })
          )
        },
      }),
      v = () => x.cancel(),
      h = () => {
        document.hidden && v()
      },
      _ = () => {
        g.matches && v()
      }
    ;(document.addEventListener('visibilitychange', h),
      window.addEventListener('pagehide', v),
      g.addEventListener('change', _),
      (a += 3))
    let m = x
      .start(() => l)
      .finally(() => {
        ;(E(),
          n.dispose(),
          s?.remove(),
          M.__NOZOKI_DX_CURTAIN__?.cancel(),
          (s = void 0),
          (b = void 0),
          document.removeEventListener('visibilitychange', h),
          window.removeEventListener('pagehide', v),
          g.removeEventListener('change', _),
          (a -= 3))
        for (let e of c) clearTimeout(e)
        ;(c.clear(), d(), p.clear())
      })
    M.__NOZOKI_DX_BOOT__ = {
      done: m,
      snapshot: y,
      ready() {
        E()
      },
      cancel: v,
      subscribe(e) {
        return (p.add(e), e(y()), () => p.delete(e))
      },
    }
  }
})()

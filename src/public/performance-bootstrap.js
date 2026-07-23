/* Détection légère exécutée avant le rendu des pages.
   WebGL n'expose pas toujours le modèle exact : les capacités et les FPS
   servent alors de solution de repli. */
(function () {
  'use strict';

  const root = document.documentElement;
  const STORAGE_KEY = 'p4_performance_profile_v1';

  function gpuName() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl', {
        alpha: false,
        antialias: false,
        depth: false,
        powerPreference: 'low-power'
      });
      if (!gl) return '';
      const extension = gl.getExtension('WEBGL_debug_renderer_info');
      return String(extension
        ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER) || '');
    } catch (_) {
      return '';
    }
  }

  function isLowEndGpu(renderer) {
    const name = renderer.toLowerCase();
    if (!name) return false;
    if (/swiftshader|llvmpipe|software rasterizer|microsoft basic render/.test(name)) return true;
    if (/intel/.test(name) && !/\barc\b/.test(name)) return true;
    if (/mali|adreno|powervr/.test(name)) return true;
    if (/radeon (hd|r[357]\b)|\bvega\b|\brx 4[056]0\b/.test(name)) return true;

    const gtx = name.match(/\bgtx\s*(\d{3,4})/);
    if (gtx) return Number(gtx[1]) < 1050;
    const gt = name.match(/\bgt\s*(\d{3,4})/);
    if (gt) return Number(gt[1]) < 1050;
    const mx = name.match(/\bmx\s*(\d{3})/);
    if (mx) return Number(mx[1]) < 550;
    return false;
  }

  function activate(reason) {
    root.classList.add('p4-performance-lite');
    root.dataset.performanceReason = reason;
  }

  let renderer = '';
  let cached = '';
  try { cached = sessionStorage.getItem(STORAGE_KEY) || ''; } catch (_) {}

  if (cached === 'lite') {
    activate('cached-gpu');
  } else {
    renderer = gpuName();
    const memory = Number(navigator.deviceMemory || 0);
    const cores = Number(navigator.hardwareConcurrency || 0);
    if (isLowEndGpu(renderer) || (memory && memory <= 4) || (cores && cores <= 4)) {
      activate(renderer ? 'gpu' : 'hardware');
      try { sessionStorage.setItem(STORAGE_KEY, 'lite'); } catch (_) {}
    } else if (renderer) {
      try { sessionStorage.setItem(STORAGE_KEY, 'full'); } catch (_) {}
    }
  }

  if (root.classList.contains('p4-performance-lite')) return;

  let previous = 0;
  let elapsed = 0;
  let frames = 0;
  let slowFrames = 0;
  const start = performance.now();

  function sample(now) {
    if (document.hidden) {
      previous = now;
    } else if (previous) {
      const delta = Math.min(now - previous, 100);
      elapsed += delta;
      frames += 1;
      if (delta > 23) slowFrames += 1;
    }
    previous = now;

    if (elapsed >= 2800 && frames >= 100) {
      const fps = frames * 1000 / elapsed;
      if (fps < 48 || slowFrames / frames > 0.30) {
        activate('measured-fps');
        return;
      }
    }
    if (now - start < 8000) requestAnimationFrame(sample);
  }

  requestAnimationFrame(sample);
})();

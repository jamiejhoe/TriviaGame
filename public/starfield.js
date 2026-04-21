// 3D animated starfield background
// Creates a "flying through space" effect with purple/white stars

(function() {
  const canvas = document.createElement('canvas');
  canvas.id = 'starfield-bg';
  canvas.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: -1;
    pointer-events: none;
  `;
  
  // Insert as the first element of body so it sits behind everything
  document.addEventListener('DOMContentLoaded', () => {
    document.body.insertBefore(canvas, document.body.firstChild);
    init();
  });

  const ctx = canvas.getContext('2d');
  let stars = [];
  let w, h, cx, cy;
  let mouseX = -9999, mouseY = -9999; // Target mouse position
  let smoothMouseX = -9999, smoothMouseY = -9999; // Interpolated mouse position
  let warpBoost = 0; // Extra speed multiplier during warp
  const STAR_COUNT = 400;
  const SPEED = 0.6;
  const MAX_DEPTH = 1000;
  const CURSOR_RADIUS = 140; // Avoidance radius in CSS pixels
  const CURSOR_FORCE = 0.25; // How strongly stars are pushed away
  const MOUSE_LERP = 0.12; // Smoothing factor for mouse tracking (lower = smoother)
  const STAR_RETURN = 0.08; // How quickly stars ease back to original position
  const WARP_PEAK = 25; // Max speed multiplier during warp
  const WARP_DECAY = 0.92; // How fast warp fades (per frame)

  // Expose a global trigger so UI code can trigger warp transitions
  window.triggerStarfieldWarp = function(intensity = 1) {
    warpBoost = Math.max(warpBoost, WARP_PEAK * intensity);
  };

  function resize() {
    w = canvas.width = window.innerWidth * window.devicePixelRatio;
    h = canvas.height = window.innerHeight * window.devicePixelRatio;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    cx = w / 2;
    cy = h / 2;
  }

  function createStar() {
    return {
      x: (Math.random() - 0.5) * w * 2,
      y: (Math.random() - 0.5) * h * 2,
      z: Math.random() * MAX_DEPTH,
      // Per-star offset for cursor-push momentum (smoothed return)
      offsetX: 0,
      offsetY: 0,
      // Occasionally make a purple star for theme accent
      purple: Math.random() < 0.25,
    };
  }

  function init() {
    resize();
    stars = Array.from({ length: STAR_COUNT }, createStar);
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', (e) => {
      mouseX = e.clientX * window.devicePixelRatio;
      mouseY = e.clientY * window.devicePixelRatio;
    });
    window.addEventListener('mouseleave', () => {
      mouseX = -9999;
      mouseY = -9999;
    });
    // Auto-trigger warp on any primary button click
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-primary');
      if (btn && !btn.disabled) {
        window.triggerStarfieldWarp(1);
      }
    });
    animate();
  }

  function animate() {
    // Fade trail effect for subtle streaking (lighter during warp for longer trails)
    const fadeAlpha = warpBoost > 1 ? 0.12 : 0.25;
    ctx.fillStyle = `rgba(10, 10, 15, ${fadeAlpha})`;
    ctx.fillRect(0, 0, w, h);

    const currentSpeed = SPEED * (1 + warpBoost);
    // Decay warp boost exponentially
    if (warpBoost > 0.01) {
      warpBoost *= WARP_DECAY;
    } else {
      warpBoost = 0;
    }

    // Smoothly interpolate the mouse position toward the target
    if (mouseX > -9000) {
      smoothMouseX += (mouseX - smoothMouseX) * MOUSE_LERP;
      smoothMouseY += (mouseY - smoothMouseY) * MOUSE_LERP;
    } else {
      smoothMouseX = mouseX;
      smoothMouseY = mouseY;
    }

    const cursorR = CURSOR_RADIUS * window.devicePixelRatio;
    const rSq = cursorR * cursorR;

    for (const star of stars) {
      star.z -= currentSpeed * 4;

      if (star.z <= 0) {
        // Reset star to far back
        star.x = (Math.random() - 0.5) * w * 2;
        star.y = (Math.random() - 0.5) * h * 2;
        star.z = MAX_DEPTH;
        star.purple = Math.random() < 0.25;
      }

      // 3D → 2D projection (base position before cursor interaction)
      const k = 200 / star.z;
      const baseX = star.x * k + cx;
      const baseY = star.y * k + cy;

      // Compute target push from smoothed cursor using a soft quadratic falloff
      let targetOffsetX = 0;
      let targetOffsetY = 0;
      const dx = baseX - smoothMouseX;
      const dy = baseY - smoothMouseY;
      const distSq = dx * dx + dy * dy;
      if (distSq < rSq && distSq > 0) {
        const dist = Math.sqrt(distSq);
        // Quadratic falloff: strongest at center, smooth fade at edges
        const t = 1 - dist / cursorR;
        const pushMagnitude = t * t * cursorR * CURSOR_FORCE;
        targetOffsetX = (dx / dist) * pushMagnitude;
        targetOffsetY = (dy / dist) * pushMagnitude;
      }

      // Ease star's offset toward the target (creates smooth push + bounce-back)
      star.offsetX += (targetOffsetX - star.offsetX) * STAR_RETURN;
      star.offsetY += (targetOffsetY - star.offsetY) * STAR_RETURN;

      const px = baseX + star.offsetX;
      const py = baseY + star.offsetY;

      if (px < -50 || px > w + 50 || py < -50 || py > h + 50) continue;

      // Size and brightness based on depth
      const size = (1 - star.z / MAX_DEPTH) * 3 * window.devicePixelRatio;
      const alpha = 1 - star.z / MAX_DEPTH;

      // Draw a trail streak for fast-moving nearby stars (longer during warp)
      const prevK = 200 / (star.z + currentSpeed * 8);
      // Apply same smoothed offset to trail origin so streaks curve naturally
      const prevPx = star.x * prevK + cx + star.offsetX;
      const prevPy = star.y * prevK + cy + star.offsetY;

      if (star.purple) {
        // Purple neon glow
        ctx.strokeStyle = `rgba(168, 85, 247, ${alpha})`;
        ctx.shadowColor = '#a855f7';
        ctx.shadowBlur = 8 * window.devicePixelRatio;
      } else {
        // White stars (with occasional purple tint)
        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.shadowColor = 'rgba(200, 180, 255, 0.6)';
        ctx.shadowBlur = 4 * window.devicePixelRatio;
      }

      ctx.lineWidth = size;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(prevPx, prevPy);
      ctx.lineTo(px, py);
      ctx.stroke();
    }

    // Reset shadow for next frame
    ctx.shadowBlur = 0;

    requestAnimationFrame(animate);
  }
})();

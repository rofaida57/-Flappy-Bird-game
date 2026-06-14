/* ============================================================
   SKY GLIDER — script.js
   A self-contained Flappy Bird-style game.
   Structure:
     - AudioFX        : generates short sound effects via WebAudio
     - Background     : parallax sky / clouds / ground
     - Bird           : physics, animation, drawing
     - Pipe           : moving obstacles with randomized gaps
     - Particle       : small burst effects for flap/crash
     - Game           : main controller — state, loop, input, UI
   No global mutable game state lives outside the Game instance.
   ============================================================ */

(() => {
  'use strict';

  // ----------------------------------------------------------
  // AUDIO — tiny synthesized sound effects (no external files)
  // ----------------------------------------------------------
  class AudioFX {
    constructor() {
      this.ctx = null; // created lazily after first user gesture (browser autoplay rules)
    }

    _ensureContext() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }

    _tone(freq, duration, type = 'sine', startGain = 0.18) {
      const ctx = this._ensureContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.value = startGain;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(startGain, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.start(now);
      osc.stop(now + duration);
    }

    jump() {
      // quick upward chirp
      this._tone(620, 0.12, 'square', 0.12);
      this._tone(880, 0.08, 'square', 0.06);
    }

    score() {
      // bright two-note ding
      this._tone(990, 0.1, 'sine', 0.15);
      setTimeout(() => this._tone(1320, 0.12, 'sine', 0.12), 70);
    }

    hit() {
      // low thud + descending noise
      this._tone(140, 0.35, 'sawtooth', 0.2);
      this._tone(90, 0.4, 'square', 0.15);
    }
  }

  // ----------------------------------------------------------
  // BACKGROUND — parallax sky, sun, clouds, distant hills, ground
  // ----------------------------------------------------------
  class Background {
    constructor(width, height) {
      this.resize(width, height);
      // Cloud layer: each cloud has its own x, y, size, speed factor
      this.clouds = [];
      for (let i = 0; i < 6; i++) {
        this.clouds.push({
          x: Math.random() * width,
          y: 20 + Math.random() * (height * 0.35),
          scale: 0.6 + Math.random() * 1.1,
          speed: 0.15 + Math.random() * 0.2
        });
      }
      // Hill layer (mid parallax)
      this.hillOffset = 0;
    }

    resize(width, height) {
      this.width = width;
      this.height = height;
      this.groundHeight = Math.max(70, height * 0.14);
    }

    update(speedFactor) {
      // Clouds drift slowly, slower than pipes for parallax depth
      for (const c of this.clouds) {
        c.x -= c.speed * speedFactor;
        if (c.x < -120 * c.scale) {
          c.x = this.width + 120 * c.scale;
          c.y = 20 + Math.random() * (this.height * 0.35);
        }
      }
      this.hillOffset -= 0.5 * speedFactor;
      if (this.hillOffset <= -this.width) this.hillOffset = 0;
    }

    drawSky(ctx) {
      const grad = ctx.createLinearGradient(0, 0, 0, this.height);
      grad.addColorStop(0, '#2b2150');
      grad.addColorStop(0.45, '#6c4a8e');
      grad.addColorStop(0.8, '#d6713f');
      grad.addColorStop(1, '#f3a44a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.width, this.height);

      // Sun glow
      const sunX = this.width * 0.78;
      const sunY = this.height * 0.32;
      const glow = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, this.width * 0.35);
      glow.addColorStop(0, 'rgba(255, 224, 158, 0.9)');
      glow.addColorStop(1, 'rgba(255, 224, 158, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, this.width, this.height);

      ctx.fillStyle = 'rgba(255, 233, 186, 0.95)';
      ctx.beginPath();
      ctx.arc(sunX, sunY, this.width * 0.045, 0, Math.PI * 2);
      ctx.fill();
    }

    drawClouds(ctx) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      for (const c of this.clouds) {
        this._drawCloud(ctx, c.x, c.y, c.scale);
      }
    }

    _drawCloud(ctx, x, y, scale) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.arc(20, -8, 22, 0, Math.PI * 2);
      ctx.arc(42, 0, 18, 0, Math.PI * 2);
      ctx.arc(20, 10, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawHills(ctx) {
      // Soft silhouette hills for mid-depth parallax
      ctx.fillStyle = 'rgba(90, 56, 92, 0.55)';
      const baseY = this.height - this.groundHeight;
      for (let pass = 0; pass < 2; pass++) {
        const offset = this.hillOffset * (pass === 0 ? 1 : 0.6) + pass * this.width * 0.5;
        ctx.beginPath();
        ctx.moveTo(offset - this.width, baseY);
        ctx.quadraticCurveTo(offset - this.width * 0.5, baseY - this.height * 0.18, offset, baseY);
        ctx.quadraticCurveTo(offset + this.width * 0.5, baseY - this.height * 0.22, offset + this.width, baseY);
        ctx.quadraticCurveTo(offset + this.width * 1.5, baseY - this.height * 0.16, offset + this.width * 2, baseY);
        ctx.lineTo(offset + this.width * 2, baseY + this.groundHeight);
        ctx.lineTo(offset - this.width, baseY + this.groundHeight);
        ctx.closePath();
        ctx.fill();
      }
    }

    drawGround(ctx, groundScrollX) {
      const y = this.height - this.groundHeight;
      const grad = ctx.createLinearGradient(0, y, 0, this.height);
      grad.addColorStop(0, '#caa468');
      grad.addColorStop(1, '#8a6a3e');
      ctx.fillStyle = grad;
      ctx.fillRect(0, y, this.width, this.groundHeight);

      // Top edge highlight strip
      ctx.fillStyle = '#5fae5a';
      ctx.fillRect(0, y, this.width, 8);

      // Scrolling texture stripes on the dirt
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      const stripeW = 40;
      let x = -((groundScrollX) % stripeW);
      for (; x < this.width; x += stripeW) {
        ctx.fillRect(x, y + 14, stripeW * 0.5, this.groundHeight - 14);
      }
    }
  }

  // ----------------------------------------------------------
  // BIRD — physics, flapping animation, drawing
  // ----------------------------------------------------------
  class Bird {
    constructor(x, y, radius) {
      this.x = x;
      this.y = y;
      this.radius = radius;
      this.velocity = 0;
      this.rotation = 0;
      this.flapPhase = 0; // drives wing animation
    }

    reset(x, y) {
      this.x = x;
      this.y = y;
      this.velocity = 0;
      this.rotation = 0;
      this.flapPhase = 0;
    }

    flap(jumpVelocity) {
      this.velocity = jumpVelocity;
    }

    update(gravity, dt) {
      this.velocity += gravity * dt;
      this.y += this.velocity * dt;

      // Rotation follows velocity for a natural dive/climb look
      const targetRotation = Math.max(-0.5, Math.min(1.2, this.velocity * 0.08));
      this.rotation += (targetRotation - this.rotation) * 0.15;

      // Wing flap animation cycles continuously
      this.flapPhase += dt * 0.02;
    }

    draw(ctx) {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rotation);

      // Body
      ctx.fillStyle = '#ffce54';
      ctx.beginPath();
      ctx.ellipse(0, 0, this.radius, this.radius * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();

      // Belly shading
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.beginPath();
      ctx.ellipse(this.radius * 0.15, this.radius * 0.25, this.radius * 0.7, this.radius * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();

      // Wing (flapping)
      const wingLift = Math.sin(this.flapPhase) * 0.6;
      ctx.fillStyle = '#f4a531';
      ctx.save();
      ctx.translate(-this.radius * 0.1, this.radius * 0.05);
      ctx.rotate(-0.3 - wingLift);
      ctx.beginPath();
      ctx.ellipse(0, 0, this.radius * 0.6, this.radius * 0.38, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Eye
      ctx.fillStyle = '#2b2150';
      ctx.beginPath();
      ctx.arc(this.radius * 0.35, -this.radius * 0.3, this.radius * 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.arc(this.radius * 0.4, -this.radius * 0.35, this.radius * 0.05, 0, Math.PI * 2);
      ctx.fill();

      // Beak
      ctx.fillStyle = '#ff6f59';
      ctx.beginPath();
      ctx.moveTo(this.radius * 0.75, -this.radius * 0.05);
      ctx.lineTo(this.radius * 1.25, this.radius * 0.05);
      ctx.lineTo(this.radius * 0.75, this.radius * 0.3);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }

    // Circular collision bounds (slightly inset for fairness)
    getBounds() {
      return { x: this.x, y: this.y, radius: this.radius * 0.78 };
    }
  }

  // ----------------------------------------------------------
  // PIPE — paired top/bottom obstacles with randomized gap
  // ----------------------------------------------------------
  class Pipe {
    constructor(x, gapY, gapHeight, width, canvasHeight, groundHeight) {
      this.x = x;
      this.gapY = gapY;           // vertical center of the gap
      this.gapHeight = gapHeight; // size of the opening
      this.width = width;
      this.canvasHeight = canvasHeight;
      this.groundHeight = groundHeight;
      this.passed = false; // for scoring
    }

    update(speed, dt) {
      this.x -= speed * dt;
    }

    get topHeight() {
      return this.gapY - this.gapHeight / 2;
    }

    get bottomY() {
      return this.gapY + this.gapHeight / 2;
    }

    get bottomHeight() {
      return (this.canvasHeight - this.groundHeight) - this.bottomY;
    }

    isOffscreen() {
      return this.x + this.width < 0;
    }

    draw(ctx) {
      const capH = 26;
      const bodyColor = '#3fae6b';
      const darkColor = '#2c7e4d';
      const lightColor = '#56c984';

      // Top pipe
      this._drawPipeSegment(ctx, this.x, 0, this.width, this.topHeight, capH, bodyColor, darkColor, lightColor, true);

      // Bottom pipe
      this._drawPipeSegment(ctx, this.x, this.bottomY, this.width, this.bottomHeight, capH, bodyColor, darkColor, lightColor, false);
    }

    _drawPipeSegment(ctx, x, y, w, h, capH, body, dark, light, isTop) {
      if (h <= 0) return;
      // Body
      ctx.fillStyle = body;
      ctx.fillRect(x, y, w, h);

      // Shading edges
      ctx.fillStyle = dark;
      ctx.fillRect(x, y, w * 0.18, h);
      ctx.fillStyle = light;
      ctx.fillRect(x + w - w * 0.12, y, w * 0.12, h);

      // Cap (lip), positioned at the gap-facing edge
      const capY = isTop ? (y + h - capH) : y;
      const capX = x - 4;
      const capW = w + 8;
      ctx.fillStyle = body;
      ctx.fillRect(capX, capY, capW, capH);
      ctx.fillStyle = dark;
      ctx.fillRect(capX, capY, capW * 0.18, capH);
      ctx.fillStyle = light;
      ctx.fillRect(capX + capW - capW * 0.12, capY, capW * 0.12, capH);
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 1;
      ctx.strokeRect(capX, capY, capW, capH);
    }

    // Returns bounding rectangles for collision
    getRects() {
      return [
        { x: this.x, y: 0, w: this.width, h: this.topHeight },
        { x: this.x, y: this.bottomY, w: this.width, h: this.bottomHeight }
      ];
    }
  }

  // ----------------------------------------------------------
  // PARTICLE — tiny bursts for flap / crash feedback
  // ----------------------------------------------------------
  class Particle {
    constructor(x, y, color, opts = {}) {
      this.x = x;
      this.y = y;
      this.color = color;
      const angle = opts.angle ?? Math.random() * Math.PI * 2;
      const speed = opts.speed ?? (1 + Math.random() * 2);
      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed;
      this.life = opts.life ?? 30;
      this.maxLife = this.life;
      this.size = opts.size ?? (2 + Math.random() * 3);
      this.gravity = opts.gravity ?? 0.05;
    }

    update() {
      this.x += this.vx;
      this.y += this.vy;
      this.vy += this.gravity;
      this.life--;
    }

    get alive() {
      return this.life > 0;
    }

    draw(ctx) {
      const alpha = Math.max(0, this.life / this.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // ----------------------------------------------------------
  // GAME — main controller: state machine, loop, input, UI wiring
  // ----------------------------------------------------------
  class Game {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.audio = new AudioFX();

      // State machine: 'start' | 'playing' | 'paused' | 'gameover'
      this.state = 'start';

      // Tunable physics constants (scaled relative to canvas size at resize)
      this.baseGravity = 1500;     // px/s^2
      this.baseJumpVelocity = -450; // px/s
      this.basePipeSpeed = 160;     // px/s
      this.pipeGapBase = 0.28;      // fraction of canvas height
      this.pipeInterval = 1.5;      // seconds between pipes

      this.score = 0;
      this.highScore = Number(localStorage.getItem('skyglider_highscore') || 0);

      this.pipes = [];
      this.particles = [];
      this.timeSincePipe = 0;
      this.elapsedPlayTime = 0;

      this.lastTimestamp = 0;
      this.groundScrollX = 0;

      this._bindUI();
      this._bindInput();
      this.resize();
      window.addEventListener('resize', () => this.resize());

      // Initial draw of the start screen background
      this.background = new Background(this.canvas.width, this.canvas.height);
      this._initEntities();
      this._renderStartFrame();

      requestAnimationFrame((t) => this._loop(t));
    }

    // -------------------- SETUP --------------------
    _bindUI() {
      this.el = {
        score: document.getElementById('score'),
        bestValue: document.getElementById('bestValue'),
        startScreen: document.getElementById('startScreen'),
        pauseScreen: document.getElementById('pauseScreen'),
        gameOverScreen: document.getElementById('gameOverScreen'),
        finalScore: document.getElementById('finalScore'),
        finalBest: document.getElementById('finalBest'),
        newBestBadge: document.getElementById('newBestBadge'),
        startBtn: document.getElementById('startBtn'),
        restartBtn: document.getElementById('restartBtn'),
        resumeBtn: document.getElementById('resumeBtn'),
        restartFromPauseBtn: document.getElementById('restartFromPauseBtn'),
        pauseBtn: document.getElementById('pauseBtn'),
      };

      this.el.bestValue.textContent = this.highScore;

      this.el.startBtn.addEventListener('click', () => this.start());
      this.el.restartBtn.addEventListener('click', () => this.start());
      this.el.restartFromPauseBtn.addEventListener('click', () => this.start());
      this.el.resumeBtn.addEventListener('click', () => this.togglePause());
      this.el.pauseBtn.addEventListener('click', () => this.togglePause());
    }

    _bindInput() {
      // Spacebar
      window.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
          e.preventDefault();
          this._handlePrimaryInput();
        }
        if (e.code === 'KeyP' || e.code === 'Escape') {
          if (this.state === 'playing' || this.state === 'paused') this.togglePause();
        }
      });

      // Mouse / touch on the canvas area
      const target = document.getElementById('game-container');
      const onPress = (e) => {
        // Ignore taps on buttons/panels (they have their own handlers)
        if (e.target.closest('.panel') || e.target.closest('#pauseBtn')) return;
        e.preventDefault();
        this._handlePrimaryInput();
      };
      target.addEventListener('mousedown', onPress);
      target.addEventListener('touchstart', onPress, { passive: false });
    }

    _handlePrimaryInput() {
      if (this.state === 'start') {
        this.start();
      } else if (this.state === 'playing') {
        this._flapBird();
      } else if (this.state === 'gameover') {
        this.start();
      }
      // 'paused' ignores primary input (must resume explicitly)
    }

    // -------------------- RESPONSIVE SIZING --------------------
    resize() {
      const container = document.getElementById('game-container');
      const maxW = container.clientWidth;
      const maxH = container.clientHeight;

      // Target a portrait-ish play area; cap dimensions to viewport
      let width = Math.min(maxW, 480);
      let height = maxH;

      // Maintain a reasonable aspect ratio on very wide screens
      if (width / height > 0.75) {
        width = Math.min(width, height * 0.75);
      }

      const dpr = window.devicePixelRatio || 1;
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
      this.canvas.width = Math.floor(width * dpr);
      this.canvas.height = Math.floor(height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      this.viewWidth = width;
      this.viewHeight = height;

      if (this.background) this.background.resize(width, height);

      // Recompute scale-dependent entity sizes
      this.groundHeight = Math.max(70, height * 0.14);
      this.birdRadius = Math.max(16, Math.min(26, width * 0.06));
      this.pipeWidth = Math.max(56, width * 0.16);

      if (this.bird) {
        // Keep bird at a relative position if resizing mid-game
        this.bird.radius = this.birdRadius;
        if (this.state === 'start') {
          this.bird.x = width * 0.28;
          this.bird.y = height * 0.42;
        }
      }

      if (!this.bird && this.background) {
        this._initEntities();
      }
    }

    _initEntities() {
      this.bird = new Bird(this.viewWidth * 0.28, this.viewHeight * 0.42, this.birdRadius);
    }

    // -------------------- GAME STATE TRANSITIONS --------------------
    start() {
      this.state = 'playing';
      this.score = 0;
      this.pipes = [];
      this.particles = [];
      this.timeSincePipe = 0;
      this.elapsedPlayTime = 0;
      this.bird.reset(this.viewWidth * 0.28, this.viewHeight * 0.42);

      this.el.score.textContent = '0';
      this.el.startScreen.classList.add('hidden');
      this.el.gameOverScreen.classList.add('hidden');
      this.el.pauseScreen.classList.add('hidden');
      this.el.pauseBtn.classList.remove('hidden');
      this.el.newBestBadge.classList.add('hidden');

      this._flapBird(); // initial flap so the bird rises immediately
    }

    togglePause() {
      if (this.state === 'playing') {
        this.state = 'paused';
        this.el.pauseScreen.classList.remove('hidden');
      } else if (this.state === 'paused') {
        this.state = 'playing';
        this.el.pauseScreen.classList.add('hidden');
        // Reset timestamp to avoid a large dt jump after pause
        this.lastTimestamp = performance.now();
      }
    }

    gameOver() {
      this.state = 'gameover';
      this.audio.hit();
      this._spawnCrashParticles();

      if (this.score > this.highScore) {
        this.highScore = this.score;
        localStorage.setItem('skyglider_highscore', String(this.highScore));
        this.el.newBestBadge.classList.remove('hidden');
      } else {
        this.el.newBestBadge.classList.add('hidden');
      }

      this.el.bestValue.textContent = this.highScore;
      this.el.finalScore.textContent = this.score;
      this.el.finalBest.textContent = this.highScore;
      this.el.gameOverScreen.classList.remove('hidden');
      this.el.pauseBtn.classList.add('hidden');
    }

    // -------------------- ACTIONS --------------------
    _flapBird() {
      // Scale jump velocity relative to canvas height for consistent feel
      const scale = this.viewHeight / 640;
      this.bird.flap(this.baseJumpVelocity * scale);
      this.audio.jump();
      this._spawnFlapParticles();
    }

    _spawnFlapParticles() {
      for (let i = 0; i < 6; i++) {
        this.particles.push(new Particle(
          this.bird.x - this.bird.radius * 0.6,
          this.bird.y + this.bird.radius * 0.4,
          'rgba(255, 255, 255, 0.8)',
          { angle: Math.PI - 0.4 + Math.random() * 0.8, speed: 1 + Math.random() * 1.5, life: 20, size: 2 + Math.random() * 2, gravity: 0.02 }
        ));
      }
    }

    _spawnCrashParticles() {
      for (let i = 0; i < 24; i++) {
        this.particles.push(new Particle(
          this.bird.x,
          this.bird.y,
          Math.random() > 0.5 ? '#ffce54' : '#ff6f59',
          { speed: 1 + Math.random() * 4, life: 40 + Math.random() * 20, size: 2 + Math.random() * 4, gravity: 0.15 }
        ));
      }
    }

    // -------------------- DIFFICULTY PROGRESSION --------------------
    _currentSpeed() {
      const scale = this.viewWidth / 480;
      // Speed ramps up gradually with elapsed play time, capped for playability
      const ramp = Math.min(this.elapsedPlayTime / 45, 1); // reaches full ramp at 45s
      return this.basePipeSpeed * scale * (1 + ramp * 0.9);
    }

    _currentPipeInterval() {
      const ramp = Math.min(this.elapsedPlayTime / 45, 1);
      return this.pipeInterval * (1 - ramp * 0.3); // pipes get slightly closer together
    }

    // -------------------- PIPE SPAWNING --------------------
    _spawnPipe() {
      const playableHeight = this.viewHeight - this.groundHeight;
      const gapHeight = Math.max(110, playableHeight * this.pipeGapBase) * (1 - Math.min(this.elapsedPlayTime / 90, 0.18));
      const margin = playableHeight * 0.15;
      const gapY = margin + Math.random() * (playableHeight - margin * 2 - gapHeight) + gapHeight / 2;

      this.pipes.push(new Pipe(this.viewWidth + 10, gapY, gapHeight, this.pipeWidth, this.viewHeight, this.groundHeight));
    }

    // -------------------- COLLISION DETECTION --------------------
    _checkCollisions() {
      const b = this.bird.getBounds();

      // Ground collision
      if (b.y + b.radius >= this.viewHeight - this.groundHeight) {
        return true;
      }
      // Ceiling collision (soft clamp, no death — just prevent flying offscreen)
      if (b.y - b.radius < 0) {
        this.bird.y = b.radius;
        this.bird.velocity = 0;
      }

      // Pipe collisions: circle vs rectangle
      for (const pipe of this.pipes) {
        for (const rect of pipe.getRects()) {
          if (rect.h <= 0) continue;
          if (this._circleRectCollision(b, rect)) return true;
        }
      }
      return false;
    }

    _circleRectCollision(circle, rect) {
      const closestX = Math.max(rect.x, Math.min(circle.x, rect.x + rect.w));
      const closestY = Math.max(rect.y, Math.min(circle.y, rect.y + rect.h));
      const dx = circle.x - closestX;
      const dy = circle.y - closestY;
      return (dx * dx + dy * dy) < (circle.radius * circle.radius);
    }

    // -------------------- MAIN LOOP --------------------
    _loop(timestamp) {
      if (!this.lastTimestamp) this.lastTimestamp = timestamp;
      let dt = (timestamp - this.lastTimestamp) / 1000; // seconds
      dt = Math.min(dt, 1 / 30); // clamp to avoid huge jumps on tab switch
      this.lastTimestamp = timestamp;

      if (this.state === 'playing') {
        this._update(dt);
      }

      this._render();

      requestAnimationFrame((t) => this._loop(t));
    }

    _update(dt) {
      this.elapsedPlayTime += dt;
      const speed = this._currentSpeed();
      const speedFactor = speed / (this.basePipeSpeed * (this.viewWidth / 480));

      // Physics scaling relative to canvas height (consistent feel across sizes)
      const scale = this.viewHeight / 640;
      this.bird.update(this.baseGravity * scale, dt);

      this.background.update(speedFactor);
      this.groundScrollX += speed * dt;

      // Pipe spawning
      this.timeSincePipe += dt;
      if (this.timeSincePipe >= this._currentPipeInterval()) {
        this.timeSincePipe = 0;
        this._spawnPipe();
      }

      // Update pipes, scoring, cleanup
      for (const pipe of this.pipes) {
        pipe.update(speed, dt);
        if (!pipe.passed && pipe.x + pipe.width < this.bird.x) {
          pipe.passed = true;
          this.score++;
          this.el.score.textContent = this.score;
          this.audio.score();
        }
      }
      this.pipes = this.pipes.filter(p => !p.isOffscreen());

      // Particles
      for (const p of this.particles) p.update();
      this.particles = this.particles.filter(p => p.alive);

      // Collisions
      if (this._checkCollisions()) {
        this.gameOver();
      }
    }

    // -------------------- RENDERING --------------------
    _render() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.viewWidth, this.viewHeight);

      this.background.drawSky(ctx);
      this.background.drawClouds(ctx);
      this.background.drawHills(ctx);

      // Pipes (behind ground edge but above hills)
      for (const pipe of this.pipes) pipe.draw(ctx);

      this.background.drawGround(ctx, this.groundScrollX);

      // Particles
      for (const p of this.particles) p.draw(ctx);

      // Bird
      this.bird.draw(ctx);
    }

    _renderStartFrame() {
      // Render a single static frame for the start screen background
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.viewWidth, this.viewHeight);
      this.background.drawSky(ctx);
      this.background.drawClouds(ctx);
      this.background.drawHills(ctx);
      this.background.drawGround(ctx, 0);
      this.bird.draw(ctx);
    }
  }

  // ----------------------------------------------------------
  // BOOTSTRAP
  // ----------------------------------------------------------
  window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('gameCanvas');
    new Game(canvas);
  });

})();

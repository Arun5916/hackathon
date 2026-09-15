
const { useEffect, useRef, useState } = React;


// --- retroPixelField.ts ---

type RetroPixelOptions = {
  pixelSize: number;
  noise: number;
  levels: number;
  speed: number;
};

const RETRO_PIXEL_DEFAULTS: RetroPixelOptions = {
  pixelSize: 4,
  noise: 1,
  levels: 7,
  speed: 1,
};

const VERTEX_SHADER = "attribute vec2 aPos;\nvoid main(){ gl_Position = vec4(aPos, 0.0, 1.0); }";

/* everything is quantised before it reaches a colour: the scene is authored as a
   single luminance field, dithered with an ordered 8x8 Bayer threshold, snapped
   to `uLevels` steps, and only then mapped through the eight-stop dusk ramp — so
   the bands are real palette steps rather than a gradient with noise on top */
const FRAGMENT_SHADER = `precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uNoise;
uniform float uLevels;

float hash(vec2 p){ p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 34.23); return fract(p.x * p.y); }

float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p){
  float sum = 0.0, amp = 0.5;
  for (int i = 0; i < 5; i++){ sum += amp * vnoise(p); p = p * 2.03 + 11.7; amp *= 0.5; }
  return sum;
}

/* the classic recursive Bayer construction: each level halves the cell and adds a
   quarter of the coarser threshold, which is cheaper than indexing a matrix and
   avoids the dynamic array access GLSL ES 1.0 will not guarantee */
float bayer2(vec2 a){ a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float bayer4(vec2 a){ return bayer2(a * 0.5) * 0.25 + bayer2(a); }
float bayer8(vec2 a){ return bayer4(a * 0.5) * 0.25 + bayer2(a); }

vec3 stop(float index){
  if (index < 0.5) return vec3(0.043, 0.035, 0.109);
  if (index < 1.5) return vec3(0.106, 0.063, 0.220);
  if (index < 2.5) return vec3(0.212, 0.090, 0.325);
  if (index < 3.5) return vec3(0.396, 0.129, 0.376);
  if (index < 4.5) return vec3(0.612, 0.180, 0.376);
  if (index < 5.5) return vec3(0.827, 0.298, 0.325);
  if (index < 6.5) return vec3(0.945, 0.502, 0.286);
  return vec3(0.988, 0.784, 0.494);
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float t = uTime;

  /* two counter-drifting noise sheets read as slow weather rather than as a
     single scrolling texture */
  vec2 cloud = vec2(uv.x * 3.4, uv.y * 2.1);
  float weather = fbm(cloud + vec2(t * 0.055, t * -0.021));
  weather = mix(weather, fbm(cloud * 1.9 + vec2(-t * 0.032, t * 0.044)), 0.42);

  /* the composition is three bands: a deep sky that warms downward, a hot
     horizon at y=0.30, and a dark ground the readout chrome can sit on. The
     falloffs are deliberately wide — a steep ramp stacks the palette steps into
     thin horizontal bars the ordered dither is too small to break up */
  float sky = smoothstep(0.98, 0.20, uv.y) * 0.36;
  float heat = smoothstep(0.60, 0.16, uv.y) * 0.32;
  float ground = smoothstep(0.26, 0.08, uv.y);
  float sun = smoothstep(0.38, 0.0, length((uv - vec2(0.5, 0.29)) * vec2(0.70, 1.5))) * 0.20;
  /* the three terms sum to just under 1.0 at the horizon: pushing past it clips
     the whole band to the last palette stop and the dither texture disappears */
  float field = 0.11 + sky + heat + sun - ground * 0.80 + (weather - 0.5) * 0.82 * uNoise;

  /* static lives before quantisation so it moves the pixel across a palette step
     instead of tinting it */
  float grain = hash(floor(gl_FragCoord.xy) + floor(t * 12.0)) - 0.5;
  field += grain * 0.055 * uNoise;
  field *= 1.0 - 0.34 * smoothstep(0.45, 1.05, length((uv - vec2(0.5, 0.46)) * vec2(1.06, 1.0)));

  float levels = max(uLevels, 2.0);
  float dither = bayer8(gl_FragCoord.xy) - 0.5;
  float quantised = clamp(field + dither / levels, 0.0, 0.9999);
  /* no scanline here: one drawing-buffer row is pixelSize screen rows tall,
     so darkening alternate rows draws chunky bars rather than a raster. The CRT
     line structure is a screen-resolution CSS overlay instead. */
  gl_FragColor = vec4(stop(floor(quantised * levels) * (7.0 / (levels - 1.0))), 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("Retro pixel field shader failed to compile.", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

const INERT = { resize: () => {}, render: () => {}, dispose: () => {} };

function createRetroPixelField(canvas: HTMLCanvasElement, getOptions: () => RetroPixelOptions) {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: false });
  if (!gl) return INERT;

  const program = gl.createProgram();
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!program || !vertex || !fragment) return INERT;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("Retro pixel field program failed to link.", gl.getProgramInfoLog(program));
    return INERT;
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "aPos");

  const uRes = gl.getUniformLocation(program, "uRes");
  const uTime = gl.getUniformLocation(program, "uTime");
  const uNoise = gl.getUniformLocation(program, "uNoise");
  const uLevels = gl.getUniformLocation(program, "uLevels");

  let width = 1;
  let height = 1;
  const startedAt = performance.now();
  let clock = 0;
  let lastAt = startedAt;

  const resize = (cssWidth: number, cssHeight: number) => {
    const options = getOptions();
    /* the drawing buffer is the low-resolution artwork; CSS blows it up with
       nearest-neighbour sampling, so every pixel stays square and hard-edged */
    width = Math.max(2, Math.round(cssWidth / Math.max(1, options.pixelSize)));
    height = Math.max(2, Math.round(cssHeight / Math.max(1, options.pixelSize)));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
  };

  const render = (now = performance.now()) => {
    const options = getOptions();
    clock += Math.min(96, now - lastAt) * 0.001 * options.speed;
    lastAt = now;
    /* the attribute state is re-established every draw: this canvas can outlive
       one field instance, and a stale binding silently draws nothing */
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(uRes, width, height);
    gl.uniform1f(uTime, clock);
    gl.uniform1f(uNoise, options.noise);
    gl.uniform1f(uLevels, options.levels);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const dispose = () => {
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
  };

  return { resize, render, dispose };
}


// --- glassParticleField.ts ---



type GlassParticleOptions = {
  count: number;
  thickness: number;
  dispersion: number;
  specular: number;
  rim: number;
  drift: number;
};

const GLASS_PARTICLE_DEFAULTS: GlassParticleOptions = {
  count: 22,
  thickness: 0.115,
  dispersion: 0.05,
  specular: 0.85,
  rim: 0.5,
  drift: 1,
};

const MAX_COUNT = 34;

const QUAD_VERTEX = "void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }";

/* the backdrop is drawn twice each frame: once into the refraction target the
   glass samples, once straight to the canvas — one cheap fullscreen pass is far
   less work than a second material that blits the target back */
const BACKDROP_FRAGMENT = `precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uPointer;

vec3 bloom(vec2 uv, vec2 centre, float radius, vec3 tint){
  float aspect = uRes.x / max(uRes.y, 1.0);
  float d = length((uv - centre) * vec2(aspect, 1.0));
  float falloff = smoothstep(radius, 0.0, d);
  return tint * falloff * falloff;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float t = uTime * 0.17;
  /* the base tone matters more than the blooms: refraction samples the whole
     frame, so a backdrop with black regions makes beads read as dark holes */
  vec3 col = vec3(0.085, 0.095, 0.125);
  col += mix(vec3(0.0), vec3(0.05, 0.06, 0.10), uv.y);
  col += bloom(uv, vec2(0.23 + 0.055 * sin(t * 0.9), 0.76 + 0.045 * cos(t * 0.7)), 0.86, vec3(0.24, 0.42, 0.96)) * 0.92;
  col += bloom(uv, vec2(0.82 + 0.05 * cos(t * 0.8), 0.34 + 0.055 * sin(t * 1.1)), 0.80, vec3(0.66, 0.30, 0.88)) * 0.80;
  col += bloom(uv, vec2(0.50 + 0.07 * sin(t * 0.6 + 1.7), 0.10 + 0.04 * cos(t * 0.9)), 0.74, vec3(0.14, 0.68, 0.70)) * 0.60;
  col += bloom(uv, vec2(0.10 + 0.04 * cos(t * 1.2), 0.16 + 0.05 * sin(t * 0.8)), 0.58, vec3(0.98, 0.60, 0.40)) * 0.34;
  col += bloom(uv, vec2(0.5 + uPointer.x * 0.20, 0.56 + uPointer.y * 0.16), 0.46, vec3(0.74, 0.78, 0.96)) * 0.30;
  float vignette = smoothstep(1.34, 0.30, length((uv - 0.5) * vec2(1.05, 1.0)));
  col *= mix(0.62, 1.0, vignette);
  gl_FragColor = vec4(col, 1.0);
}`;

const GLASS_VERTEX = `varying vec3 vNormalView;
varying vec3 vViewPos;
varying vec4 vScreen;

void main(){
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vNormalView = normalize(normalMatrix * normal);
  vViewPos = mvPosition.xyz;
  vScreen = projectionMatrix * mvPosition;
  gl_Position = vScreen;
}`;

/* screen-space refraction: the surface normal bends the view ray, the offset is
   applied to this fragment's own screen coordinate, and the three channels use
   three slightly different indices so the bead edges split into colour the way
   real glass does */
const GLASS_FRAGMENT = `precision highp float;
uniform sampler2D uBackdrop;
uniform float uThickness;
uniform float uDispersion;
uniform float uSpecular;
uniform float uRim;
uniform vec3 uTint;
uniform vec3 uLight;
varying vec3 vNormalView;
varying vec3 vViewPos;
varying vec4 vScreen;

void main(){
  vec2 screenUV = (vScreen.xy / vScreen.w) * 0.5 + 0.5;
  vec3 N = normalize(vNormalView);
  vec3 V = normalize(-vViewPos);
  vec3 I = -V;
  float fresnel = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.4);

  vec2 offsetR = refract(I, N, 1.0 / (1.44 - uDispersion)).xy * uThickness;
  vec2 offsetG = refract(I, N, 1.0 / 1.44).xy * uThickness;
  vec2 offsetB = refract(I, N, 1.0 / (1.44 + uDispersion)).xy * uThickness;

  vec3 col;
  col.r = texture2D(uBackdrop, clamp(screenUV + offsetR, 0.002, 0.998)).r;
  col.g = texture2D(uBackdrop, clamp(screenUV + offsetG, 0.002, 0.998)).g;
  col.b = texture2D(uBackdrop, clamp(screenUV + offsetB, 0.002, 0.998)).b;
  col *= uTint;

  vec3 L = normalize(uLight);
  vec3 H = normalize(L + V);
  float ndoth = max(dot(N, H), 0.0);
  col += pow(ndoth, 150.0) * uSpecular;
  col += pow(ndoth, 16.0) * uSpecular * 0.11;
  /* a second, dimmer key from below keeps the underside of every bead alive */
  vec3 H2 = normalize(normalize(vec3(0.55, -0.7, 0.45)) + V);
  col += pow(max(dot(N, H2), 0.0), 44.0) * uSpecular * 0.22;
  col += fresnel * uRim * vec3(0.86, 0.90, 1.0);

  /* aerial perspective: the small far beads dissolve into the plate they float
     over instead of reading as hard specks */
  float haze = smoothstep(7.4, 11.4, -vViewPos.z);
  col = mix(col, texture2D(uBackdrop, screenUV).rgb, haze * 0.7);
  gl_FragColor = vec4(col, 1.0);
}`;

type Bead = {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  origin: THREE.Vector3;
  bob: number;
  phase: number;
  spin: THREE.Vector3;
  radius: number;
};

/* one deterministic sequence so the arrangement is identical on every load and a
   recorded preview matches what a visitor sees */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function createGlassParticleField(canvas: HTMLCanvasElement, getOptions: () => GlassParticleOptions) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x0a0b0f, 1);

  const backdropScene = new THREE.Scene();
  const backdropCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const backdropUniforms = {
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uPointer: { value: new THREE.Vector2() },
  };
  const backdropMaterial = new THREE.ShaderMaterial({
    uniforms: backdropUniforms,
    vertexShader: QUAD_VERTEX,
    fragmentShader: BACKDROP_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });
  const backdropGeometry = new THREE.PlaneGeometry(2, 2);
  backdropScene.add(new THREE.Mesh(backdropGeometry, backdropMaterial));

  const target = new THREE.WebGLRenderTarget(2, 2, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
  });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0, 7.4);
  const group = new THREE.Group();
  scene.add(group);

  const geometries = [
    new THREE.SphereGeometry(1, 44, 30),
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.TorusGeometry(0.78, 0.30, 22, 56),
  ];
  const tints = [
    new THREE.Color(1.04, 1.0, 1.02),
    new THREE.Color(0.97, 1.0, 1.06),
    new THREE.Color(1.05, 0.99, 0.97),
  ];

  const random = seeded(20260826);
  const beads: Bead[] = [];
  for (let index = 0; index < MAX_COUNT; index += 1) {
    /* the first third are the large hero beads, the remainder are the fine dust
       that reads as depth behind them */
    const hero = index < 8;
    const radius = hero ? 0.40 + random() * 0.34 : 0.09 + random() * 0.18;
    /* spheres carry the look; the gem and the ring appear once each among the
       hero beads so the field has silhouette variety without reading as props */
    const geometry = geometries[hero ? (index === 3 ? 1 : index === 6 ? 2 : 0) : 0];
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uBackdrop: { value: target.texture },
        uThickness: { value: 0.1 },
        uDispersion: { value: 0.05 },
        uSpecular: { value: 0.85 },
        uRim: { value: 0.5 },
        uTint: { value: tints[index % tints.length] },
        uLight: { value: new THREE.Vector3(-0.45, 0.86, 0.62) },
      },
      vertexShader: GLASS_VERTEX,
      fragmentShader: GLASS_FRAGMENT,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(radius);
    /* hero beads are rejection-sampled against the ones already placed: two
       large spheres that intersect read as one lumpy blob rather than as glass */
    const origin = new THREE.Vector3();
    for (let attempt = 0; attempt < 48; attempt += 1) {
      origin.set(
        (random() - 0.5) * 8.4,
        (random() - 0.5) * 5.0 - 0.25,
        hero ? -1.4 + random() * 2.6 : -3.6 + random() * 2.4,
      );
      if (!hero) break;
      const clear = beads.every((placed) => {
        const dx = placed.origin.x - origin.x;
        const dy = placed.origin.y - origin.y;
        return Math.hypot(dx, dy) > (placed.radius + radius) * 1.25 + 0.3;
      });
      if (clear) break;
    }
    mesh.position.copy(origin);
    mesh.rotation.set(random() * 6.28, random() * 6.28, random() * 6.28);
    group.add(mesh);
    beads.push({
      mesh,
      material,
      origin,
      radius,
      bob: 0.14 + random() * 0.34,
      phase: random() * 6.28,
      spin: new THREE.Vector3((random() - 0.5) * 0.28, (random() - 0.5) * 0.34, (random() - 0.5) * 0.2),
    });
  }

  const pointer = new THREE.Vector2();
  const pointerTarget = new THREE.Vector2();
  let width = 1;
  let height = 1;
  let clock = 0;
  let lastAt = performance.now();

  const resize = (cssWidth: number, cssHeight: number) => {
    const nextWidth = Math.max(1, Math.round(cssWidth));
    const nextHeight = Math.max(1, Math.round(cssHeight));
    if (nextWidth === width && nextHeight === height) return;
    width = nextWidth;
    height = nextHeight;
    const ratio = Math.min(window.devicePixelRatio, 2);
    renderer.setSize(width, height, false);
    target.setSize(Math.round(width * ratio), Math.round(height * ratio));
    backdropUniforms.uRes.value.set(width * ratio, height * ratio);
    camera.aspect = width / height;
    /* a wide catalog frame should widen the field of view rather than crop it, so
       the bead spread stays the same composition at every aspect */
    camera.fov = camera.aspect > 1 ? 42 : 42 / Math.max(0.62, camera.aspect);
    camera.updateProjectionMatrix();
    for (const bead of beads) bead.material.uniforms.uBackdrop.value = target.texture;
  };

  const setPointer = (x: number, y: number) => pointerTarget.set(x, y);

  const render = (now = performance.now()) => {
    const options = getOptions();
    clock += Math.min(96, now - lastAt) * 0.001;
    lastAt = now;
    pointer.lerp(pointerTarget, 0.045);

    const visible = Math.max(4, Math.min(MAX_COUNT, Math.round(options.count)));
    for (let index = 0; index < beads.length; index += 1) {
      const bead = beads[index];
      bead.mesh.visible = index < visible;
      if (!bead.mesh.visible) continue;
      const uniforms = bead.material.uniforms;
      uniforms.uThickness.value = options.thickness * (0.55 + bead.radius * 0.9);
      uniforms.uDispersion.value = options.dispersion;
      uniforms.uSpecular.value = options.specular;
      uniforms.uRim.value = options.rim;
      const t = clock * options.drift;
      bead.mesh.position.set(
        bead.origin.x + Math.sin(t * 0.21 + bead.phase) * bead.bob * 0.9,
        bead.origin.y + Math.cos(t * 0.27 + bead.phase * 1.3) * bead.bob,
        bead.origin.z + Math.sin(t * 0.17 + bead.phase * 0.7) * bead.bob * 0.5,
      );
      bead.mesh.rotation.x += bead.spin.x * 0.0075 * options.drift;
      bead.mesh.rotation.y += bead.spin.y * 0.0075 * options.drift;
      bead.mesh.rotation.z += bead.spin.z * 0.0075 * options.drift;
    }

    group.rotation.y = pointer.x * 0.14;
    group.rotation.x = -pointer.y * 0.1;
    group.position.x = pointer.x * 0.28;
    group.position.y = pointer.y * 0.2;

    backdropUniforms.uTime.value = clock;
    backdropUniforms.uPointer.value.set(pointer.x, pointer.y);

    renderer.setRenderTarget(target);
    renderer.render(backdropScene, backdropCamera);
    renderer.setRenderTarget(null);
    renderer.render(backdropScene, backdropCamera);
    renderer.autoClear = false;
    renderer.render(scene, camera);
    renderer.autoClear = true;
  };

  const dispose = () => {
    for (const bead of beads) bead.material.dispose();
    for (const geometry of geometries) geometry.dispose();
    backdropGeometry.dispose();
    backdropMaterial.dispose();
    target.dispose();
    renderer.dispose();
  };

  return { resize, render, setPointer, dispose };
}


// --- topDockController.ts ---

type TopDockAxis = "x" | "y";

type TopDockOptions = {
  proximity: number;
  spring: number;
  damping: number;
  widthGrowth: number;
  heightGrowth: number;
  drop: number;
  /* "y" measures the proximity field down a vertical rail: items grow taller and
     lean out sideways instead of widening and dropping */
  axis?: TopDockAxis;
  /* the items own the whole track, so their widths are renormalised against it:
     opening one cell takes room from its neighbours and the strip stays exactly
     as wide as its container */
  distribute?: boolean;
  /* the opposite deal: the track is pinned to the width it has at rest and the
     magnified row is allowed to overflow it. A bar that hugs its own content
     needs this — without it the growing row widens the bar, which both slides
     the brand and the actions around and resizes the box this controller
     re-measures from, cancelling the spring on the next frame. */
  lockTrack?: boolean;
};

type DockItemState = {
  element: HTMLElement;
  baseWidth: number;
  baseHeight: number;
  value: number;
  velocity: number;
  target: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function createTopDockController(
  root: HTMLElement,
  getOptions: () => TopDockOptions,
) {
  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const precisionQuery = window.matchMedia("(hover:hover) and (pointer:fine)");
  const items: DockItemState[] = Array.from(root.querySelectorAll<HTMLElement>("[data-dock-item]")).map((element) => ({
    element,
    baseWidth: 0,
    baseHeight: 0,
    value: 0,
    velocity: 0,
    target: 0,
  }));

  let enabled = false;
  let pointerActive = false;
  let dirty = false;
  let frame = 0;

  const canAnimate = () => !reducedQuery.matches && root.clientWidth > 0 && window.innerWidth > 600 && precisionQuery.matches;

  const measure = () => {
    enabled = canAnimate();
    /* released first, so the rest width is measured against the track's own
       content rather than against the width the last measurement pinned */
    if (getOptions().lockTrack) root.style.width = "";
    for (const state of items) {
      state.element.style.width = "";
      state.element.style.height = "";
      state.element.style.transform = "";
      state.element.dataset.dockNear = "false";
    }
    for (const state of items) {
      const rect = state.element.getBoundingClientRect();
      state.baseWidth = rect.width;
      state.baseHeight = rect.height;
      state.value = 0;
      state.velocity = 0;
      state.target = 0;
    }
    pointerActive = false;
    dirty = false;
    /* a distributed strip has to fill its track even when the spring never runs
       — reduced motion, a coarse pointer, or a narrow viewport */
    if (getOptions().distribute) applyLayout();
    if (getOptions().lockTrack) root.style.width = `${root.getBoundingClientRect().width.toFixed(2)}px`;
    root.dataset.dockState = enabled ? "idle" : "static";
    root.dataset.dockMax = "0.00";
  };

  const setTargets = (clientX: number, clientY: number) => {
    if (!enabled) return;
    const options = getOptions();
    const vertical = options.axis === "y";
    const pointer = vertical ? clientY : clientX;
    const rects = items.map((state) => state.element.getBoundingClientRect());
    for (let index = 0; index < items.length; index += 1) {
      const rect = rects[index];
      const center = vertical ? rect.top + rect.height * 0.5 : rect.left + rect.width * 0.5;
      const proximity = clamp(1 - Math.abs(pointer - center) / Math.max(1, options.proximity), 0, 1);
      const influence = proximity * proximity * (3 - 2 * proximity);
      items[index].target = influence;
      items[index].element.dataset.dockNear = influence > 0.08 ? "true" : "false";
    }
    pointerActive = true;
    dirty = true;
    root.dataset.dockState = "active";
  };

  const focusItem = (item: HTMLElement) => {
    if (!enabled) return;
    const index = items.findIndex((state) => state.element === item);
    if (index < 0) return;
    items.forEach((state, itemIndex) => {
      state.target = itemIndex === index ? 1 : Math.abs(itemIndex - index) === 1 ? 0.24 : 0;
      state.element.dataset.dockNear = state.target > 0.08 ? "true" : "false";
    });
    pointerActive = false;
    dirty = true;
    root.dataset.dockState = "focus";
  };

  const reset = () => {
    pointerActive = false;
    dirty = true;
    items.forEach((state) => {
      state.target = 0;
      state.element.dataset.dockNear = "false";
    });
  };

  /* the only place item geometry is written, so the three fits stay one
     behaviour with three ways of spending the same spring value */
  const applyLayout = () => {
    const options = getOptions();
    if (options.distribute && options.axis !== "y") {
      const weights = items.map((state) => state.baseWidth + options.widthGrowth * clamp(state.value, 0, 1.08));
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      const natural = items.reduce((sum, state) => sum + state.baseWidth, 0);
      /* squeezed below its own natural width the strip would clip every label,
         so it stops filling the track rather than crushing the cells */
      const track = root.clientWidth >= natural ? root.clientWidth : 0;
      items.forEach((state, index) => {
        state.element.style.width = track ? `${(track * weights[index] / total).toFixed(2)}px` : "";
        state.element.style.height = "";
        state.element.style.transform = "";
      });
      return;
    }
    for (const state of items) {
      const value = clamp(state.value, 0, 1.08);
      if (options.axis === "y") {
        state.element.style.width = "";
        state.element.style.height = `${(state.baseHeight + options.heightGrowth * value).toFixed(2)}px`;
        state.element.style.transform = `translateX(${(value * options.drop).toFixed(2)}px)`;
        continue;
      }
      const isLogo = state.element.classList.contains("animated-top-dock__logo");
      const extraWidth = isLogo ? options.widthGrowth * (14 / 17) : Math.min(options.widthGrowth, state.baseWidth * 0.24);
      const extraHeight = isLogo ? options.heightGrowth * (14 / 16) : options.heightGrowth;
      state.element.style.width = `${(state.baseWidth + extraWidth * value).toFixed(2)}px`;
      state.element.style.height = `${(state.baseHeight + extraHeight * value).toFixed(2)}px`;
      state.element.style.transform = `translateY(${(value * options.drop).toFixed(2)}px)`;
    }
  };

  const draw = () => {
    if (enabled && dirty) {
      const options = getOptions();
      let moving = false;
      let maxValue = 0;
      for (const state of items) {
        state.velocity += (state.target - state.value) * options.spring;
        state.velocity *= options.damping;
        state.value += state.velocity;
        if (Math.abs(state.target - state.value) < 0.001 && Math.abs(state.velocity) < 0.001) {
          state.value = state.target;
          state.velocity = 0;
        } else {
          moving = true;
        }
        maxValue = Math.max(maxValue, clamp(state.value, 0, 1.08));
      }
      applyLayout();
      root.dataset.dockMax = maxValue.toFixed(2);
      if (!moving) {
        dirty = false;
        if (items.every((state) => state.target === 0)) root.dataset.dockState = "idle";
      }
    }
    frame = requestAnimationFrame(draw);
  };

  const onPointerMove = (event: PointerEvent) => setTargets(event.clientX, event.clientY);
  const onWindowPointerMove = (event: PointerEvent) => {
    if (!pointerActive) return;
    const rootRect = root.getBoundingClientRect();
    const itemRects = items.map((state) => state.element.getBoundingClientRect());
    const bottom = Math.max(rootRect.bottom, ...itemRects.map((rect) => rect.bottom));
    const outside = event.clientX < rootRect.left || event.clientX > rootRect.right || event.clientY < rootRect.top || event.clientY > bottom;
    if (outside) reset();
  };
  const onFocusIn = (event: FocusEvent) => {
    const item = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-dock-item]");
    if (item) focusItem(item);
  };
  const onFocusOut = () => requestAnimationFrame(() => {
    if (!root.contains(document.activeElement)) reset();
  });
  const onKeyDown = (event: KeyboardEvent) => {
    const item = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-dock-item]");
    if (item && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      item.click();
    }
  };
  const onClick = () => reset();

  /* the spring writes an explicit pixel width onto every item, so the base
     measurement has to happen after the label font is available — measured
     against a fallback face, a variant with auto-width items locks in a box its
     own text then overflows */
  let released = false;
  const remeasure = () => { if (!released) measure(); };
  document.fonts?.ready.then(remeasure);

  /* re-measuring on the parent works for a dock inside a fixed bar, but a rail
     whose height follows its own items would resize its parent as it grows and
     cancel the spring on the next frame. A shell can opt out of that feedback
     loop by marking a box the dock cannot resize. */
  const resizeObserver = new ResizeObserver(measure);
  resizeObserver.observe(root.closest<HTMLElement>("[data-dock-frame]") ?? root.parentElement ?? root);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerleave", reset);
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("click", onClick);
  window.addEventListener("pointermove", onWindowPointerMove, { passive: true });
  reducedQuery.addEventListener("change", measure);
  precisionQuery.addEventListener("change", measure);
  measure();
  frame = requestAnimationFrame(draw);

  return () => {
    released = true;
    root.style.width = "";
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    root.removeEventListener("pointermove", onPointerMove);
    root.removeEventListener("pointerleave", reset);
    root.removeEventListener("focusin", onFocusIn);
    root.removeEventListener("focusout", onFocusOut);
    root.removeEventListener("keydown", onKeyDown);
    root.removeEventListener("click", onClick);
    window.removeEventListener("pointermove", onWindowPointerMove);
    reducedQuery.removeEventListener("change", measure);
    precisionQuery.removeEventListener("change", measure);
  };
}


// --- AnimatedTopDock.tsx ---




const ANIMATED_TOP_DOCK_VARIANTS = ["sable", "modern", "retro", "glass"] as const;
type AnimatedTopDockVariant = (typeof ANIMATED_TOP_DOCK_VARIANTS)[number];

type AnimatedTopDockProps = {
  variant?: AnimatedTopDockVariant;
  proximity?: number;
  spring?: number;
  damping?: number;
  widthGrowth?: number;
  heightGrowth?: number;
  drop?: number;
  /* retro field */
  pixelSize?: number;
  speed?: number;
  noise?: number;
  levels?: number;
  scanlines?: number;
  /* glass field */
  particles?: number;
  thickness?: number;
  dispersion?: number;
  specular?: number;
  rim?: number;
  drift?: number;
  className?: string;
};

const ANIMATED_TOP_DOCK_DEFAULTS = {
  variant: "sable" as AnimatedTopDockVariant,
  proximity: 122,
  spring: 0.19,
  damping: 0.7,
  widthGrowth: 17,
  heightGrowth: 16,
  drop: 3.5,
  pixelSize: 4,
  speed: 1,
  noise: 1,
  levels: 7,
  scanlines: 0.32,
  particles: 22,
  thickness: 0.115,
  dispersion: 0.05,
  specular: 0.85,
  rim: 0.5,
  drift: 1,
} as const;

type DockItem = { id: string; label: string; icon: ReactNode };

const ITEMS: readonly DockItem[] = [
  { id: "system", label: "SYSTEM", icon: <><rect x="2.25" y="2.25" width="4.5" height="4.5" rx=".8" /><rect x="9.25" y="2.25" width="4.5" height="4.5" rx=".8" /><rect x="2.25" y="9.25" width="4.5" height="4.5" rx=".8" /><rect x="9.25" y="9.25" width="4.5" height="4.5" rx=".8" /></> },
  { id: "method", label: "METHOD", icon: <><circle cx="3" cy="8" r="1.5" /><circle cx="12.5" cy="3.5" r="1.5" /><circle cx="12.5" cy="12.5" r="1.5" /><path d="M4.5 7.3 11 4.2M4.5 8.7l6.5 3.1" /></> },
  { id: "work", label: "WORK", icon: <><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M2 6h12M5 4.5h.01M7 4.5h.01" /></> },
  { id: "access", label: "ACCESS", icon: <><circle cx="5.2" cy="6.2" r="2.7" /><path d="m7.2 8.2 5.9 5.1M10.2 10.8l1.5-1.5M12 12.4l1.4-1.4" /></> },
  { id: "notes", label: "NOTES", icon: <><path d="M4 2.25h5.4L12 4.85v8.9H4z" /><path d="M9.25 2.25V5h2.7M6 8h4M6 10.5h4" /></> },
];

const MODERN_ITEMS: readonly DockItem[] = [
  { id: "exercises", label: "Exercises", icon: <><path d="M3.4 2.4h5.4l3.8 3.8v7.4H3.4z" /><path d="M8.8 2.4v3.8h3.8M5.9 9h4.2M5.9 11.2h3" /></> },
  { id: "about", label: "About", icon: <><circle cx="8" cy="8" r="5.9" /><path d="M8 6.5v4.5M8 4.5v.5" /></> },
  { id: "manuals", label: "Field Manuals", icon: <><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M2 6h12M5 4.5h.01M7 4.5h.01" /></> },
];

/* every retro glyph is drawn on a 7x7 lattice of whole units so the icons stay
   on the same pixel grid as the dithered field behind them */
const RETRO_ITEMS: readonly DockItem[] = [
  { id: "system", label: "SYSTEM", icon: <><rect x="1" y="1" width="2" height="2" /><rect x="4" y="1" width="2" height="2" /><rect x="1" y="4" width="2" height="2" /><rect x="4" y="4" width="2" height="2" /></> },
  { id: "files", label: "FILES", icon: <><rect x="1" y="0" width="4" height="1" /><rect x="1" y="1" width="1" height="5" /><rect x="5" y="1" width="1" height="5" /><rect x="1" y="6" width="5" height="1" /><rect x="2" y="2" width="3" height="1" /><rect x="2" y="4" width="3" height="1" /></> },
  { id: "net", label: "NET", icon: <><rect x="3" y="0" width="1" height="7" /><rect x="0" y="3" width="7" height="1" /><rect x="1" y="1" width="1" height="1" /><rect x="5" y="1" width="1" height="1" /><rect x="1" y="5" width="1" height="1" /><rect x="5" y="5" width="1" height="1" /></> },
  { id: "disk", label: "DISK", icon: <><rect x="0" y="1" width="7" height="5" /><rect x="2" y="0" width="3" height="2" /><rect x="1" y="4" width="5" height="1" /></> },
  { id: "help", label: "HELP", icon: <><rect x="2" y="0" width="3" height="1" /><rect x="4" y="1" width="2" height="2" /><rect x="3" y="3" width="2" height="1" /><rect x="3" y="4" width="1" height="1" /><rect x="3" y="6" width="1" height="1" /></> },
];

const GLASS_ITEMS: readonly DockItem[] = [
  { id: "overview", label: "Overview", icon: <><circle cx="8" cy="8" r="5.8" /><path d="M2.4 8c2.4-3.5 9-3.5 11.3 0" /></> },
  { id: "studio", label: "Studio", icon: <><rect x="2.2" y="2.2" width="11.6" height="11.6" rx="3.6" /><circle cx="8" cy="8" r="2.5" /></> },
  { id: "library", label: "Library", icon: <><rect x="2.1" y="2.6" width="3" height="10.8" rx="1" /><rect x="6.4" y="2.6" width="3" height="10.8" rx="1" /><path d="m10.9 3.7 2.9 1-2.4 8.6-2.2-.8" /></> },
  { id: "motion", label: "Motion", icon: <><path d="M1.8 10.6c2.6 0 3-5.2 6.2-5.2s3.6 5.2 6.2 5.2" /><circle cx="8" cy="5.4" r=".9" /></> },
  { id: "labs", label: "Labs", icon: <><path d="M6.4 2.2v4L3 12.1a1.3 1.3 0 0 0 1.1 2h7.8a1.3 1.3 0 0 0 1.1-2L9.6 6.2v-4" /><path d="M5.6 2.2h4.8M4.9 9.6h6.2" /></> },
];

const VARIANT_ITEMS: Record<AnimatedTopDockVariant, readonly DockItem[]> = {
  sable: ITEMS,
  modern: MODERN_ITEMS,
  retro: RETRO_ITEMS,
  glass: GLASS_ITEMS,
};

const BRAND_MARK = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect width="24" height="24" rx="4.5" fill="#E8E8E3" />
    <path d="M6 6h8.6L18 9.35v8.15H9.15L6 14.35V6Z" fill="#111" />
    <path d="M9 9h5.15L15 9.85V15H9.85L9 14.15V9Z" fill="#E8E8E3" />
    <path d="M12 9v6M9 12h6" stroke="#111" strokeWidth=".7" />
  </svg>
);

function useDockController(getOptions: () => TopDockOptions) {
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    return createTopDockController(root, getOptions);
    /* the getter is a stable ref reader, so the controller is built once */
  }, []);
  return rootRef;
}

type ShaderField = {
  resize: (width: number, height: number) => void;
  render: (now: number) => void;
  setPointer?: (x: number, y: number) => void;
  dispose: () => void;
};

/* both shader variants share the same host lifecycle: measure from the shell,
   pause off-screen and on a hidden tab, and hand the renderer a css-pixel box.
   The module is resolved in its own effect so the effect that owns the GL
   context can create and tear it down synchronously — an async create survives
   its own cleanup and leaves two renderers fighting over one canvas. */
function useShaderField(active: boolean, load: () => Promise<(canvas: HTMLCanvasElement) => ShaderField>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [factory, setFactory] = useState<{ create: (canvas: HTMLCanvasElement) => ShaderField } | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    load().then((create) => { if (!cancelled) setFactory({ create }); });
    return () => { cancelled = true; };
  }, [active]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!active || !factory || !host || !canvas) return undefined;
    const field = factory.create(canvas);
    let frame = 0;
    let visible = true;
    let bounds = host.getBoundingClientRect();
    const resize = () => {
      bounds = host.getBoundingClientRect();
      field.resize(bounds.width, bounds.height);
    };
    const tick = (now: number) => {
      field.resize(bounds.width, bounds.height);
      field.render(now);
      frame = visible && !document.hidden ? requestAnimationFrame(tick) : 0;
    };
    const onPointerMove = (event: PointerEvent) => {
      field.setPointer?.(
        ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1,
        -((((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 2) - 1),
      );
    };
    const resizeObserver = new ResizeObserver(resize);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible && !frame) frame = requestAnimationFrame(tick);
      if (!visible && frame) { cancelAnimationFrame(frame); frame = 0; }
    });
    resizeObserver.observe(host);
    intersection.observe(host);
    host.addEventListener("pointermove", onPointerMove, { passive: true });
    resize();
    frame = requestAnimationFrame(tick);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersection.disconnect();
      host.removeEventListener("pointermove", onPointerMove);
      field.dispose();
    };
  }, [active, factory]);

  return { hostRef, canvasRef };
}

function AnimatedTopDock({ className = "", ...props }: AnimatedTopDockProps) {
  const optionsRef = useRef({ ...ANIMATED_TOP_DOCK_DEFAULTS, ...props });
  optionsRef.current = { ...ANIMATED_TOP_DOCK_DEFAULTS, ...props };
  const variant = optionsRef.current.variant;
  const items = VARIANT_ITEMS[variant] ?? ITEMS;
  const [active, setActive] = useState(items[0].id);
  /* one spring, three fits: the command bar pins its track so a bar sized to its
     own content never moves, the terminal renormalises its cells across the
     strip, and the glass rail runs the proximity field down the y axis */
  const rootRef = useDockController(() => ({
    ...optionsRef.current,
    axis: variant === "glass" ? "y" as const : "x" as const,
    distribute: variant === "retro",
    lockTrack: variant === "modern",
  }));

  const retro = useShaderField(variant === "retro", async () => {
    const { createRetroPixelField } = await import("./retroPixelField");
    return (canvas: HTMLCanvasElement) => createRetroPixelField(canvas, () => ({
      pixelSize: optionsRef.current.pixelSize,
      noise: optionsRef.current.noise,
      levels: optionsRef.current.levels,
      speed: optionsRef.current.speed,
    }));
  });
  const glass = useShaderField(variant === "glass", async () => {
    const { createGlassParticleField } = await import("./glassParticleField");
    return (canvas: HTMLCanvasElement) => createGlassParticleField(canvas, () => ({
      count: optionsRef.current.particles,
      thickness: optionsRef.current.thickness,
      dispersion: optionsRef.current.dispersion,
      specular: optionsRef.current.specular,
      rim: optionsRef.current.rim,
      drift: optionsRef.current.drift,
    }));
  });

  const dockItems = (itemClass: string, iconClass: string, viewBox: string) => items.map((item) => (
    <button
      key={item.id}
      className={itemClass}
      data-dock-item
      type="button"
      aria-pressed={active === item.id}
      onClick={() => setActive(item.id)}
    >
      <span className={iconClass} aria-hidden="true"><svg viewBox={viewBox}>{item.icon}</svg></span>
      <span>{item.label}</span>
    </button>
  ));

  if (variant === "modern") {
    return (
      <div className={`animated-top-dock-component atd-modern${className ? ` ${className}` : ""}`}>
        <div className="atd-modern__aurora" aria-hidden="true" />
        <header className="atd-modern__bar">
          <a className="atd-modern__brand" href="#top-dock" onClick={(event) => event.preventDefault()}>
            <span className="atd-modern__mark" aria-hidden="true">{BRAND_MARK}</span>
            <span className="atd-modern__word">KneeRehab Pro</span>
          </a>
          <nav ref={rootRef} className="atd-modern__dock" aria-label="Primary" data-dock-state="idle" data-dock-max="0.00">
            {dockItems("atd-modern__item", "atd-modern__icon", "0 0 16 16")}
          </nav>
          <div className="atd-modern__actions">
            
            <button className="atd-modern__cta" type="button">
              <span>Start Rehab</span>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8h9.1M8.6 4.3 12.4 8l-3.8 3.7" /></svg>
            </button>
          </div>
        </header>
        <div className="atd-modern__stage" aria-hidden="true">
          <p className="atd-modern__eyebrow">AI EXERCISE GUIDE</p>
          <p className="atd-modern__headline">Real-time pose tracking</p>
        </div>
        <p className="animated-top-dock-component__caption">SCROLL DOWN TO BEGIN</p>
      </div>
    );
  }

  if (variant === "retro") {
    return (
      <div
        ref={retro.hostRef}
        className={`animated-top-dock-component atd-retro${className ? ` ${className}` : ""}`}
        style={{ "--atd-retro-scan": optionsRef.current.scanlines } as React.CSSProperties}
      >
        <canvas ref={retro.canvasRef} className="atd-retro__field" aria-hidden="true" />
        <div className="atd-retro__vignette" aria-hidden="true" />
        <header className="atd-retro__bar">
          <div className="atd-retro__brand">
            <span className="atd-retro__badge" aria-hidden="true">
              <svg viewBox="0 0 7 7"><rect x="0" y="2" width="7" height="3" /><rect x="2" y="0" width="3" height="7" /></svg>
            </span>
            SABLE//OS
          </div>
          <nav ref={rootRef} className="atd-retro__dock" aria-label="Primary" data-dock-state="idle" data-dock-max="0.00">
            {dockItems("atd-retro__item", "atd-retro__icon", "0 0 7 7")}
          </nav>
          <button className="atd-retro__cta" type="button">
            <span aria-hidden="true">▶</span>
            RUN
          </button>
        </header>
        <p className="atd-retro__readout">
          <span>MEM 640K</span>
          <span>DITHER 8×8</span>
          <span>PAL 8</span>
        </p>
        <p className="animated-top-dock-component__caption">FITTED STRIP · ORDERED DITHER</p>
      </div>
    );
  }

  if (variant === "glass") {
    return (
      <div ref={glass.hostRef} className={`animated-top-dock-component atd-glass${className ? ` ${className}` : ""}`} data-dock-frame>
        <canvas ref={glass.canvasRef} className="atd-glass__field" aria-hidden="true" />
        <header className="atd-glass__rail">
          <a className="atd-glass__brand" href="#top-dock" onClick={(event) => event.preventDefault()}>
            <span className="atd-glass__mark" aria-hidden="true">{BRAND_MARK}</span>
            <span className="atd-glass__word">Aperture</span>
          </a>
          <span className="atd-glass__hairline" aria-hidden="true" />
          <nav ref={rootRef} className="atd-glass__dock" aria-label="Primary" data-dock-state="idle" data-dock-max="0.00">
            {dockItems("atd-glass__item", "atd-glass__icon", "0 0 16 16")}
          </nav>
          <span className="atd-glass__hairline" aria-hidden="true" />
          <button className="atd-glass__cta" type="button">
            Get the app
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.4 8h9.2M8.8 4.2 12.6 8l-3.8 3.8" /></svg>
          </button>
        </header>
        <p className="animated-top-dock-component__caption">VERTICAL RAIL · SCREEN-SPACE DISPERSION</p>
      </div>
    );
  }

  return (
    <div className={`animated-top-dock-component${className ? ` ${className}` : ""}`}>
      <nav ref={rootRef} className="animated-top-dock__nav" aria-label="Animated top dock" data-dock-state="idle" data-dock-max="0.00">
        <button className="animated-top-dock__item animated-top-dock__logo" data-dock-item type="button" aria-label="Home" onClick={() => setActive("system")}>
          {BRAND_MARK}
        </button>
        {items.map((item) => (
          <button key={item.id} className="animated-top-dock__item animated-top-dock__link" data-dock-item type="button" aria-pressed={active === item.id} onClick={() => setActive(item.id)}>
            <span className="animated-top-dock__icon" aria-hidden="true"><svg viewBox="0 0 16 16">{item.icon}</svg></span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <p className="animated-top-dock-component__caption">MOVE ACROSS THE DOCK · FOCUS WITH TAB</p>
    </div>
  );
}

// Mounting Logic
const rootNode = document.getElementById('top-dock-root');
if (rootNode) {
    const root = ReactDOM.createRoot(rootNode);
    root.render(
        <div className="shader-frame">
            <AnimatedTopDock
                variant="modern"
                proximity={122}
                spring={0.19}
                damping={0.70}
                widthGrowth={17}
                heightGrowth={16}
                drop={3.5}
            />
        </div>
    );
}

// Intercept click on links to scroll or navigate
document.addEventListener('click', (e) => {
    const item = e.target.closest('[data-dock-item]');
    if (item) {
        const text = item.innerText.toLowerCase();
        if (text.includes('about')) {
            const library = document.getElementById('library-section');
            if (library) library.scrollIntoView({behavior: 'smooth'});
        } else if (text.includes('manuals')) {
            window.location.href = 'showcase.html';
        } else if (text.includes('exercises')) {
            window.scrollTo({top: 0, behavior: 'smooth'});
        }
    }
});

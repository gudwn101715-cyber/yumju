import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { HALLS, NODES, ITEMS } from "../shared/catalog.js";

const C = {
  grass: 0xaabd9b,
  grassLight: 0xbac9a7,
  earth: 0x829a77,
  stone: 0xe3dfc9,
  stoneDark: 0xb7b8a1,
  roof: 0x344c42,
  roofEdge: 0x263e36,
  wood: 0x895d42,
  pillar: 0x8e5140,
  cream: 0xeee7d4,
  gold: 0xd4aa54,
  water: 0x86b6a7,
};

/** Procedural, asset-free temple scene. Network state remains authoritative. */
export function createWorld(
  container,
  {
    onMoveTarget,
    onInteract,
    onSelectHall,
    onReady,
    fullAvatarLimit = window.matchMedia("(max-width:700px)").matches ? 12 : 20,
    labelLimit = window.matchMedia("(max-width:700px)").matches ? 8 : 12,
  } = {},
) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdbe2d2);
  scene.fog = new THREE.Fog(0xdbe2d2, 115, 265);
  const camera = new THREE.OrthographicCamera(-70, 70, 45, -45, 0.1, 400);
  let zoom = 1;
  const viewTarget = new THREE.Vector3(0, 0, -3);
  const cameraOffset = new THREE.Vector3(79, 82, 105);
  camera.position.copy(viewTarget).add(cameraOffset);
  camera.lookAt(viewTarget);
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.domElement.className = "temple-canvas";
  renderer.domElement.setAttribute(
    "aria-label",
    "염주 온라인 사찰. 땅을 클릭하거나 방향키로 이동하고 법당과 재료를 선택하세요.",
  );
  renderer.domElement.tabIndex = 0;
  container.appendChild(renderer.domElement);
  if (getComputedStyle(container).position === "static")
    container.style.position = "relative";
  container.style.overflow = "hidden";

  const overlay = document.createElement("div");
  overlay.className = "temple-world-overlay";
  container.appendChild(overlay);
  const style = document.createElement("style");
  style.textContent = `
    .temple-canvas{display:block;width:100%;height:100%;outline:none;touch-action:none;cursor:crosshair}
    .temple-world-overlay{position:absolute;inset:0;pointer-events:none;overflow:hidden}
    .temple-world-overlay .scene-label{position:absolute;left:0;top:0;white-space:nowrap;transform:translate(-50%,-100%);pointer-events:auto;border:1px solid #fff9;background:#fffdf1e8;color:#314a3a;border-radius:9px;box-shadow:0 3px 15px #26392d14;padding:7px 11px;display:flex;align-items:center;gap:7px;font-family:inherit;font-size:11px;line-height:1.25;font-weight:600;cursor:pointer;backdrop-filter:blur(5px);transition:opacity .2s}
    .temple-world-overlay .scene-label.selected{background:#315c46;color:#fff;border-color:#698875;box-shadow:0 4px 18px #213b3930}
    .temple-world-overlay .scene-label .hall-mark{color:#ae8d45;font-size:12px}
    .temple-world-overlay .scene-label .label-detail{font-size:9px;opacity:.62;font-weight:400;margin-left:2px}
    .temple-world-overlay .avatar-label{position:absolute;left:0;top:0;transform:translate(-50%,-100%);color:#324c3c;font-family:inherit;font-size:10px;line-height:1.2;font-weight:600;white-space:nowrap;text-shadow:0 1px 5px #fff,0 1px 3px #fff;background:#f9fbf1a6;padding:3px 7px;border-radius:9px;pointer-events:auto;cursor:pointer}
    .temple-world-overlay .avatar-label.self{z-index:2;background:#2f5b43;color:#fff;text-shadow:none;font-size:10px;border:1px solid #fff5;box-shadow:0 2px 5px #0001}
    .temple-world-overlay .node-hint{position:absolute;left:0;top:0;transform:translate(-50%,-100%);background:#fdfbf0ed;color:#496148;border:1px solid #ffffffb0;font-family:inherit;font-size:10px;line-height:1.2;font-weight:500;padding:5px 8px;border-radius:5px;pointer-events:auto;cursor:pointer;box-shadow:0 2px 8px #25392c13}
    .temple-world-overlay .node-hint::before{content:'✧';color:#ad8a44;margin-right:4px}
    .temple-world-overlay .node-hint.cooldown{opacity:.4;pointer-events:none}
    @media(max-width:700px){.temple-world-overlay .node-hint{font-size:9px;padding:4px}.temple-world-overlay .scene-label{padding:5px 7px;font-size:10px}.temple-world-overlay .label-detail{display:none}}
  `;
  container.appendChild(style);

  const ambient = new THREE.HemisphereLight(0xfff7df, 0x73876c, 2.6);
  scene.add(ambient);
  const sunlight = new THREE.DirectionalLight(0xffedc4, 3.3);
  sunlight.position.set(-50, 90, 45);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunlight.shadow.camera, {
    left: -95,
    right: 95,
    top: 95,
    bottom: -95,
    near: 1,
    far: 230,
  });
  sunlight.shadow.bias = -0.00035;
  sunlight.shadow.normalBias = 0.12;
  sunlight.shadow.radius = 3;
  scene.add(sunlight);

  const materialCache = new Map();
  function mat(color, extra = {}) {
    const key = `${color}-${JSON.stringify(extra)}`;
    if (!materialCache.has(key))
      materialCache.set(
        key,
        new THREE.MeshStandardMaterial({ color, roughness: 0.88, ...extra }),
      );
    return materialCache.get(key);
  }
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 10);
  const sphereGeometry = new THREE.IcosahedronGeometry(1, 1);
  const coneGeometry = new THREE.ConeGeometry(1, 1, 7);
  const tmp = new THREE.Object3D();
  const batches = new Map();
  function instance(
    geometry,
    material,
    x,
    y,
    z,
    sx,
    sy = sx,
    sz = sx,
    ry = 0,
    rx = 0,
  ) {
    const key = `${geometry.uuid}:${material.uuid}`;
    if (!batches.has(key))
      batches.set(key, { geometry, material, transforms: [] });
    tmp.position.set(x, y, z);
    tmp.scale.set(sx, sy, sz);
    tmp.rotation.set(rx, ry, 0);
    tmp.updateMatrix();
    batches.get(key).transforms.push(tmp.matrix.clone());
  }
  function box(x, y, z, w, h, d, color, parent = scene) {
    const m = new THREE.Mesh(boxGeometry, mat(color));
    m.position.set(x, y, z);
    m.scale.set(w, h, d);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function mesh(geometry, material, x, y, z, parent = scene) {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function line(points, color, parent = scene) {
    const geo = new THREE.BufferGeometry().setFromPoints(
      points.map((p) => new THREE.Vector3(...p)),
    );
    const obj = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }),
    );
    parent.add(obj);
    return obj;
  }
  // Slightly uneven outer terrain, pale courtyard and worn stone paths.
  box(0, -1, 0, 185, 2, 180, C.grass);
  const grassPatch = mat(C.grassLight);
  for (const p of [
    [-37, 30, 25, 22],
    [38, -37, 25, 30],
    [-40, -40, 29, 26],
  ]) {
    instance(cylinderGeometry, grassPatch, p[0], -0.02, p[1], p[2], 0.1, p[3]);
  }
  box(0, 0.04, 6, 48, 0.25, 49, C.stone);
  box(0, 0.09, 38, 9, 0.3, 26, C.stone);
  box(-24, 0.08, -4, 26, 0.25, 7, C.stone);
  box(26, 0.08, -21, 30, 0.25, 7, C.stone);
  const seam = mat(0xc9c9b1);
  for (let x = -22; x <= 22; x += 4)
    for (let z = -15; z <= 29; z += 4) {
      instance(boxGeometry, seam, x, 0.185, z, 3.92, 0.025, 0.035);
      instance(boxGeometry, seam, x - 2, 0.185, z + 2, 0.035, 0.025, 3.95);
    }
  for (let z = 31; z < 51; z += 3.5)
    instance(boxGeometry, seam, 0, 0.249, z, 8.7, 0.02, 0.04);
  // Wall and lantern-lit gate frame the grounds.
  box(-34, 1.4, 55, 48, 3, 1.3, 0xcac5a8);
  box(34, 1.4, 55, 48, 3, 1.3, 0xcac5a8);
  box(-59, 1.4, -2, 1.3, 3, 114, 0xcac5a8);
  box(59, 1.4, -2, 1.3, 3, 114, 0xcac5a8);
  box(0, 1.4, -59, 119, 3, 1.3, 0xcac5a8);
  for (const [x, z, w, d] of [
    [-34, 55, 49, 2],
    [34, 55, 49, 2],
    [-59, -2, 2, 115],
    [59, -2, 2, 115],
    [0, -59, 120, 2],
  ])
    box(x, 3, z, w, 0.65, d, C.roof);

  function curvedRoof(width, depth, height, parent, y = 0) {
    const nx = 24,
      nz = 16,
      vertices = [],
      indices = [];
    function roofY(x, z) {
      const a = Math.abs(x) / (width / 2),
        b = Math.abs(z) / (depth / 2);
      return (
        Math.min((1 - b) * height, (1 - a) * height * 2.6) +
        0.65 * Math.pow(b, 6) +
        0.55 * Math.pow(a, 6)
      );
    }
    for (let j = 0; j <= nz; j++)
      for (let i = 0; i <= nx; i++) {
        const x = (i / nx - 0.5) * width,
          z = (j / nz - 0.5) * depth;
        vertices.push(x, roofY(x, z), z);
      }
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        indices.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const roof = mesh(
      geo,
      mat(C.roof, { side: THREE.DoubleSide }),
      0,
      y,
      0,
      parent,
    );
    const ribs = [];
    for (let x = -width / 2 + 0.3; x < width / 2; x += 0.65)
      for (let j = 0; j < 16; j++) {
        const z1 = -depth / 2 + (depth * j) / 16,
          z2 = -depth / 2 + (depth * (j + 1)) / 16;
        ribs.push(
          x,
          roofY(x, z1) + y + 0.04,
          z1,
          x,
          roofY(x, z2) + y + 0.04,
          z2,
        );
      }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.Float32BufferAttribute(ribs, 3));
    parent.add(
      new THREE.LineSegments(
        rg,
        new THREE.LineBasicMaterial({
          color: 0x647266,
          transparent: true,
          opacity: 0.47,
        }),
      ),
    );
    const edges = [
      [
        [-width / 2, 0, -depth / 2],
        [width / 2, 0, -depth / 2],
      ],
      [
        [-width / 2, 0, depth / 2],
        [width / 2, 0, depth / 2],
      ],
    ];
    for (const [start, end] of edges) {
      const points = [];
      for (let i = 0; i <= 24; i++) {
        const x = start[0] + ((end[0] - start[0]) * i) / 24;
        points.push([x, roofY(x, start[2]) + y + 0.04, start[2]]);
      }
      line(points, 0x283e35, parent);
    }
    box(0, y + height + 0.12, 0, width * 0.53, 0.34, 0.55, C.roofEdge, parent);
    return roof;
  }

  const hallObjects = new Map(),
    clickable = [];
  function temple(x, z, width, depth, scale = 1, main = false) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    scene.add(group);
    box(0, 0.65, 0, width + 3, 1.3, depth + 2.6, C.stoneDark, group);
    box(0, 1.4, 0, width + 1.8, 0.4, depth + 1.5, C.stone, group);
    for (let s = 0; s < 4; s++)
      box(
        0,
        0.15 + s * 0.33,
        depth / 2 + 3 - s * 0.6,
        width * 0.48,
        0.3,
        1.8,
        C.stone,
        group,
      );
    const h = main ? 7.1 : 5.4;
    // Open front facade gives a glimpse of the golden Buddha.
    box(
      0,
      1.8 + h * 0.48,
      -depth / 2 + 0.5,
      width,
      h * 0.96,
      0.55,
      C.cream,
      group,
    );
    for (const xx of [-1, 1])
      box(
        xx * (width / 2 - 0.4),
        1.8 + h * 0.48,
        0,
        0.55,
        h * 0.96,
        depth,
        C.cream,
        group,
      );
    box(0, 1.8, 0, width, 0.3, depth, C.wood, group);
    for (let xx = -width / 2 + 0.8; xx <= width / 2; xx += width / 4) {
      for (const zz of [-depth / 2 + 0.6, depth / 2 - 0.6]) {
        const col = mesh(
          new THREE.CylinderGeometry(0.36, 0.42, h, 9),
          mat(C.pillar),
          xx,
          1.8 + h / 2,
          zz,
          group,
        );
        mesh(
          new THREE.CylinderGeometry(0.62, 0.7, 0.3, 8),
          mat(C.stoneDark),
          xx,
          1.9,
          zz,
          group,
        );
        box(xx, 1.8 + h - 0.2, zz, 1.6, 0.55, 1.4, 0x54705a, group);
      }
    }
    for (const zz of [-depth / 2 + 0.5, depth / 2 - 0.5]) {
      box(0, 1.8 + h - 0.15, zz, width + 0.8, 0.5, 0.7, C.pillar, group);
      box(0, 1.8 + h - 0.7, zz, width, 0.35, 0.65, 0x546f59, group);
      for (let xx = -width / 2 + 1; xx < width / 2; xx += 1.8)
        box(xx, 1.8 + h - 0.68, zz + 0.36, 0.65, 0.3, 0.08, 0xd0b06d, group);
    }
    // A warm recessed altar, paper lattice side panels, and discreet hanging sign.
    box(0, 2.25, -depth / 2 + 2, width * 0.44, 0.9, 2.1, C.wood, group);
    const goldMat = mat(0xd4a64b, { metalness: 0.45, roughness: 0.5 });
    const buddha = new THREE.Group();
    buddha.position.set(0, 2.8, -depth / 2 + 2);
    group.add(buddha);
    mesh(
      new THREE.SphereGeometry(1.35 * scale, 12, 8),
      goldMat,
      0,
      1.7 * scale,
      0,
      buddha,
    ).scale.set(1, 1.15, 0.8);
    mesh(
      new THREE.SphereGeometry(0.7 * scale, 12, 10),
      goldMat,
      0,
      3.3 * scale,
      0,
      buddha,
    );
    mesh(
      new THREE.SphereGeometry(0.2 * scale, 8, 6),
      goldMat,
      0,
      4 * scale,
      0,
      buddha,
    );
    mesh(
      new THREE.SphereGeometry(1.65 * scale, 12, 6),
      goldMat,
      0,
      0.6 * scale,
      0.2,
      buddha,
    ).scale.set(1, 0.47, 0.66);
    const halo = mesh(
      new THREE.TorusGeometry(2 * scale, 0.1, 5, 32),
      mat(0xdbbc70),
      0,
      2.6 * scale,
      -0.8,
      buddha,
    );
    for (const xx of [-width * 0.36, width * 0.36]) {
      box(xx, 4, -depth / 2 + 1, 2.1, 3.4, 0.1, 0xb99b68, group);
      for (let k = -0.75; k <= 0.8; k += 0.5)
        box(xx + k, 4, -depth / 2 + 1.1, 0.04, 3.3, 0.06, 0x816343, group);
      for (let yy = 2.6; yy < 5.6; yy += 0.55)
        box(xx, yy, -depth / 2 + 1.1, 2, 0.04, 0.06, 0x816343, group);
    }
    box(
      0,
      1.8 + h - 0.7,
      depth / 2 + 0.1,
      width * 0.25,
      1.2,
      0.3,
      0x293f34,
      group,
    );
    curvedRoof(width + 5, depth + 5, main ? 4.9 : 3.7, group, 1.8 + h);
    if (main) {
      box(
        0,
        1.8 + h + 3.4,
        -0.2,
        width * 0.66,
        1.6,
        depth * 0.56,
        C.pillar,
        group,
      );
      curvedRoof(width * 0.8, depth * 0.9, 2.65, group, 1.8 + h + 4.8);
    }
    // Prayer cushions make the open porch feel inhabited, without fake players.
    for (let xx = -width * 0.24; xx <= width * 0.25; xx += width * 0.23)
      box(xx, 1.98, depth / 2 - 1.5, 1.5, 0.18, 1.2, 0x9eac84, group);
    return group;
  }
  const mainHall = temple(0, -20, 22, 13, 1.12, true);
  const bambooHall = temple(-35, -5, 14, 10, 0.8, false);
  const lotusHall = temple(35, -30, 16, 11, 0.85, false);
  const knownHalls = Array.isArray(HALLS) ? HALLS : Object.values(HALLS);
  const labelRecords = [];
  knownHalls.forEach((hall, index) => {
    const defaults = [
      { x: 0, z: -20, y: 17 },
      { x: -35, z: -5, y: 11.5 },
      { x: 35, z: -30, y: 12 },
    ];
    const d = defaults[index] || defaults[0];
    const x = hall.x ?? d.x,
      z = hall.z ?? d.z;
    const button = document.createElement("button");
    button.className = "scene-label";
    const name = document.createElement("span");
    name.textContent = hall.name || ["대웅전", "죽림전", "연화전"][index];
    const mark = document.createElement("span");
    mark.className = "hall-mark";
    mark.textContent = "◈";
    const detail = document.createElement("span");
    detail.className = "label-detail";
    detail.textContent = "함께 수행하기";
    button.append(mark, name, detail);
    button.title = "법당을 선택하고 가까이 다가가 절하세요";
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      onSelectHall?.(hall.id);
      onInteract?.({ kind: "hall", id: hall.id });
    });
    overlay.appendChild(button);
    labelRecords.push({
      el: button,
      position: new THREE.Vector3(x, d.y, z),
      kind: "hall",
      id: hall.id,
      detail,
    });
    hallObjects.set(hall.id, {
      group: [mainHall, bambooHall, lotusHall][index],
      label: button,
      x,
      z,
    });
    const hitbox = new THREE.Mesh(
      new THREE.BoxGeometry(
        index === 0 ? 27 : 20,
        index === 0 ? 16 : 12,
        index === 0 ? 19 : 16,
      ),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hitbox.position.set(x, index === 0 ? 8 : 6, z);
    hitbox.userData = { kind: "hall", id: hall.id };
    scene.add(hitbox);
    clickable.push(hitbox);
  });
  // Entrance pavilion and bell tower.
  const gate = new THREE.Group();
  gate.position.set(0, 0, 48);
  scene.add(gate);
  for (const x of [-5, 5]) {
    box(x, 3.8, 0, 0.85, 7.6, 0.85, C.pillar, gate);
    mesh(
      new THREE.CylinderGeometry(0.85, 0.85, 0.5, 8),
      mat(C.stoneDark),
      x,
      0.25,
      0,
      gate,
    );
  }
  box(0, 6.8, 0, 12, 0.8, 0.95, C.wood, gate);
  curvedRoof(16, 7, 3.6, gate, 7.1);
  box(0, 6, 1, 3.8, 1.1, 0.25, 0x283d31, gate);
  const bell = new THREE.Group();
  bell.position.set(-31, 0, 29);
  scene.add(bell);
  box(0, 0.65, 0, 9, 1.3, 9, C.stoneDark, bell);
  for (const x of [-3.1, 3.1])
    for (const z of [-3.1, 3.1]) box(x, 4, z, 0.55, 6, 0.55, C.pillar, bell);
  curvedRoof(12, 11, 3, bell, 7.1);
  mesh(
    new THREE.CylinderGeometry(1.4, 1.9, 3, 16),
    mat(0x8d9a76, { metalness: 0.55, roughness: 0.55 }),
    0,
    4.8,
    0,
    bell,
  );
  mesh(
    new THREE.TorusGeometry(1.87, 0.1, 5, 18),
    mat(0xb1a875),
    0,
    3.4,
    0,
    bell,
  ).rotation.x = Math.PI / 2;
  // Stone lanterns, lantern strings and a small bronze incense brazier.
  function lantern(x, z, tall = 1) {
    instance(boxGeometry, mat(C.stoneDark), x, 0.2, z, 1.7, 0.4, 1.7);
    instance(
      cylinderGeometry,
      mat(C.stone),
      x,
      1.3 * tall,
      z,
      0.33,
      2.2 * tall,
      0.33,
    );
    instance(boxGeometry, mat(C.stoneDark), x, 2.6 * tall, z, 1.15, 0.35, 1.15);
    instance(
      boxGeometry,
      mat(0xffd686, { emissive: 0xd5a458, emissiveIntensity: 0.4 }),
      x,
      3.15 * tall,
      z,
      0.6,
      0.8,
      0.6,
    );
    instance(
      coneGeometry,
      mat(C.roof),
      x,
      3.9 * tall,
      z,
      1.12,
      0.8,
      1.12,
      Math.PI / 4,
    );
  }
  for (const z of [13, 29, 41]) for (const x of [-7, 7]) lantern(x, z, 0.85);
  for (const [x, z] of [
    [-19, -9],
    [19, -9],
    [-45, 4],
    [25, -18],
    [45, -18],
    [-20, 22],
  ])
    lantern(x, z);
  mesh(
    new THREE.CylinderGeometry(2, 1.6, 1.4, 12),
    mat(0x829378, { metalness: 0.5, roughness: 0.5 }),
    0,
    1,
    -4,
  );
  for (const x of [-1.4, 1.4])
    instance(cylinderGeometry, mat(0x687d63), x, 0.5, -4, 0.14, 1, 0.14);
  for (let i = 0; i < 7; i++)
    instance(
      cylinderGeometry,
      mat(0x9d7550),
      Math.sin(i * 3) * 0.7,
      2.25,
      -4 + Math.cos(i * 2) * 0.7,
      0.035,
      1.5,
      0.035,
      0,
      (i - 3) * 0.035,
    );
  const smokeGroup = new THREE.Group();
  scene.add(smokeGroup);
  const smokeMat = mat(0xf2eee0, {
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
  const smoke = [];
  for (let i = 0; i < 7; i++) {
    const s = mesh(
      new THREE.SphereGeometry(1, 6, 5),
      smokeMat,
      0,
      4 + i * 0.8,
      -4,
      smokeGroup,
    );
    s.castShadow = false;
    s.scale.set(0.4 + i * 0.1, 0.7, 0.4 + i * 0.1);
    smoke.push(s);
  }
  for (const z of [8, 19]) {
    const points = [];
    for (let i = 0; i <= 30; i++) {
      const x = -21 + (42 * i) / 30;
      points.push([x, 8.2 - 1.7 * Math.sin((Math.PI * i) / 30), z]);
    }
    line(points, 0x6d7c5e);
    for (let i = 0; i < 9; i++) {
      const x = -19 + i * 4.75,
        y = 8.2 - 1.7 * Math.sin((Math.PI * (x + 21)) / 42) - 0.6;
      const colors = [0xe7c78e, 0xc9c9a4, 0xd4ac8b];
      const l = mesh(
        new THREE.SphereGeometry(0.55, 8, 6),
        mat(colors[i % 3], {
          emissive: colors[i % 3],
          emissiveIntensity: 0.08,
        }),
        x,
        y,
        z,
      );
      l.scale.y = 1.25;
      instance(cylinderGeometry, mat(C.wood), x, y + 0.7, z, 0.15, 0.15, 0.15);
      instance(cylinderGeometry, mat(C.wood), x, y - 0.7, z, 0.15, 0.15, 0.15);
    }
  }
  // Still lotus water, pebble shores and a modest arched stone bridge.
  const pond = mesh(
    new THREE.CylinderGeometry(1, 1, 0.13, 64),
    mat(C.water, {
      roughness: 0.22,
      metalness: 0.08,
      transparent: true,
      opacity: 0.91,
    }),
    35,
    0.08,
    21,
  );
  pond.scale.set(17, 1, 10);
  pond.receiveShadow = true;
  const shoreMat = mat(0xc1c1a7);
  for (let i = 0; i < 58; i++) {
    const a = (i / 58) * Math.PI * 2;
    const size = 0.6 + seed(i + 44) * 0.7;
    instance(
      sphereGeometry,
      shoreMat,
      35 + Math.cos(a) * 17,
      0.15,
      21 + Math.sin(a) * 10,
      size,
      0.45,
      size * 0.8,
      a,
    );
  }
  const lilyMat = mat(0x799b78),
    flowerMat = mat(0xe1d0c1);
  for (let i = 0; i < 18; i++) {
    const a = seed(i * 2 + 9) * Math.PI * 2,
      r = Math.sqrt(seed(i * 3 + 22));
    const x = 35 + Math.cos(a) * 14 * r,
      z = 21 + Math.sin(a) * 8 * r;
    instance(
      cylinderGeometry,
      lilyMat,
      x,
      0.19,
      z,
      0.55 + seed(i) * 0.45,
      0.04,
      0.45 + seed(i) * 0.5,
    );
    if (i % 3 === 0)
      instance(sphereGeometry, flowerMat, x, 0.41, z, 0.33, 0.3, 0.33);
  }
  for (let i = 0; i < 9; i++) {
    const x = 18 + i * 1.3,
      y = 0.65 + Math.sin((i / 8) * Math.PI) * 1.5;
    instance(boxGeometry, mat(C.stone), x, y, 21, 1.35, 0.55, 3.2);
  }
  for (const zz of [19.4, 22.6]) {
    for (let i = 0; i < 5; i++) {
      const x = 18 + i * 2.6,
        y = 1.4 + Math.sin((i / 4) * Math.PI) * 1.5;
      instance(cylinderGeometry, mat(C.stoneDark), x, y, zz, 0.12, 1.4, 0.12);
    }
    line(
      Array.from({ length: 17 }, (_, i) => [
        18 + i * 0.65,
        2.2 + Math.sin((i / 16) * Math.PI) * 1.5,
        zz,
      ]),
      0xa5ae95,
    );
  }
  // Seeded vegetation is identical for every client, while remote players are real.
  const trunkMat = mat(0x79674c),
    leafMats = [mat(0x6b8961), mat(0x769565), mat(0x87a36f), mat(0x5d7b59)];
  function pine(x, z, s = 1, index = 0) {
    instance(
      cylinderGeometry,
      trunkMat,
      x,
      3.4 * s,
      z,
      0.47 * s,
      6.8 * s,
      0.47 * s,
    );
    for (let j = 0; j < 3; j++)
      instance(
        coneGeometry,
        leafMats[(index + j) % 4],
        x,
        (6.5 + j * 2.9) * s,
        z,
        (4.1 - j * 0.8) * s,
        7 * s,
        (4.1 - j * 0.8) * s,
        index * 0.7,
      );
  }
  for (let i = 0; i < 85; i++) {
    const angle = (i / 85) * Math.PI * 2,
      r = 67 + seed(i + 1) * 18;
    const x = Math.cos(angle) * r,
      z = Math.sin(angle) * r * 0.9;
    if (z > 51 && Math.abs(x) < 13) continue;
    pine(x, z, 0.65 + seed(i + 86) * 0.65, i);
  }
  for (const [i, p] of [
    [-47, -34],
    [-49, 15],
    [-51, 32],
    [-20, -43],
    [18, -46],
    [49, -7],
    [49, 41],
    [-17, 39],
  ].entries())
    pine(p[0], p[1], 0.6 + seed(i + 89) * 0.35, i);
  // Delicate bamboo grove, low shrubs and mossy stones.
  const bambooMat = mat(0x799561),
    bambooDark = mat(0x4f7654),
    bambooLeaf = mat(0x6d925b);
  for (let i = 0; i < 34; i++) {
    const x = -44 + seed(i + 100) * 19,
      z = 9 + seed(i + 300) * 24,
      h = 7 + seed(i + 700) * 8;
    instance(
      cylinderGeometry,
      bambooMat,
      x,
      h / 2,
      z,
      0.13,
      h,
      0.13,
      0,
      (seed(i + 3) - 0.5) * 0.06,
    );
    for (let y = 1; y < h; y += 1.3)
      instance(cylinderGeometry, bambooDark, x, y, z, 0.16, 0.08, 0.16);
    for (let j = 0; j < 4; j++) {
      const a = j * 2.4 + i;
      instance(
        sphereGeometry,
        bambooLeaf,
        x + Math.cos(a) * 1.2,
        h - j * 0.7,
        z + Math.sin(a) * 1.2,
        1.4,
        0.17,
        0.4,
        a,
        0.2,
      );
    }
  }
  const rockMat = mat(0x9ca98b),
    shrubMat = mat(0x92aa78);
  for (let i = 0; i < 55; i++) {
    const side = i % 2 ? 1 : -1,
      x = side * (27 + seed(i + 21) * 27),
      z = -50 + seed(i + 30) * 97;
    if (Math.hypot(x - 35, (z - 21) * 1.7) < 20) continue;
    instance(
      sphereGeometry,
      i % 3 === 0 ? rockMat : shrubMat,
      x,
      0.5,
      z,
      1.2 + seed(i) * 1.5,
      0.8 + seed(i + 2) * 1.3,
      1.3 + seed(i + 4) * 1.3,
      i,
    );
  }
  // Distant soft hills hide the finite edge of the world.
  for (let i = 0; i < 9; i++) {
    const hill = mesh(
      new THREE.SphereGeometry(1, 16, 9),
      mat(i % 2 ? 0x9dae93 : 0xb3c2a5),
      -110 + i * 30,
      -8,
      -91 - seed(i) * 30,
    );
    hill.scale.set(25 + seed(i + 2) * 18, 19 + seed(i + 3) * 15, 26);
    hill.castShadow = false;
  }
  // A few winding stepping stones encourage exploration off the plaza.
  for (let i = 0; i < 13; i++)
    instance(
      cylinderGeometry,
      mat(C.stone),
      -9 - i * 2.8,
      0.18,
      31 + Math.sin(i * 0.5) * 3,
      1.05,
      0.16,
      0.8,
      i * 0.4,
    );

  // Flush static instances once: the grove and courtyard cost only a handful of draws.
  for (const batch of batches.values()) {
    const instanced = new THREE.InstancedMesh(
      batch.geometry,
      batch.material,
      batch.transforms.length,
    );
    batch.transforms.forEach((m, i) => instanced.setMatrixAt(i, m));
    instanced.castShadow = true;
    instanced.receiveShadow = true;
    instanced.computeBoundingSphere();
    scene.add(instanced);
  }

  // Buildings are static: merge by material after baking transforms, keeping the
  // hundreds of architectural details from becoming hundreds of draw calls.
  scene.updateMatrixWorld(true);
  const staticGroups = new Map();
  scene.traverse((object) => {
    if (
      !object.isMesh ||
      object.isInstancedMesh ||
      Array.isArray(object.material) ||
      object.material.visible === false ||
      object.material.transparent
    )
      return;
    let ancestor = object.parent;
    while (ancestor) {
      if (ancestor === smokeGroup) return;
      ancestor = ancestor.parent;
    }
    const key = `${object.material.uuid}:${object.castShadow}:${object.receiveShadow}`;
    if (!staticGroups.has(key))
      staticGroups.set(key, {
        material: object.material,
        castShadow: object.castShadow,
        receiveShadow: object.receiveShadow,
        objects: [],
        geometries: [],
      });
    const data = staticGroups.get(key);
    const geometry = object.geometry.index
      ? object.geometry.toNonIndexed()
      : object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    if (!geometry.attributes.uv)
      geometry.setAttribute(
        "uv",
        new THREE.BufferAttribute(
          new Float32Array(geometry.attributes.position.count * 2),
          2,
        ),
      );
    data.geometries.push(geometry);
    data.objects.push(object);
  });
  for (const data of staticGroups.values()) {
    const geometry = mergeGeometries(data.geometries, false);
    if (geometry) {
      const combined = new THREE.Mesh(geometry, data.material);
      combined.castShadow = data.castShadow;
      combined.receiveShadow = data.receiveShadow;
      scene.add(combined);
      for (const object of data.objects) object.removeFromParent();
    }
    data.geometries.forEach((g) => g.dispose());
  }

  // Channel identity changes the living landscape without downloading assets.
  const channelPalettes = [
    {
      sky: 0xdbe2d2,
      ground: 0xaabd9b,
      lightGround: 0xbac9a7,
      leaves: [0x6b8961, 0x769565, 0x87a36f, 0x5d7b59],
      water: 0x86b6a7,
    },
    {
      sky: 0xd5e0d5,
      ground: 0x9eb191,
      lightGround: 0xb0c29d,
      leaves: [0x537558, 0x64845f, 0x7b976c, 0x4c6a52],
      water: 0x7fa69a,
    },
    {
      sky: 0xe7dfd8,
      ground: 0xafbd9e,
      lightGround: 0xc3cba9,
      leaves: [0x789072, 0x8ca17b, 0x99ad84, 0x738469],
      water: 0xa1b8b4,
    },
    {
      sky: 0xe5e9e5,
      ground: 0xb7c5af,
      lightGround: 0xcad3bc,
      leaves: [0x83998a, 0x98ad96, 0xa8b99d, 0x778f7b],
      water: 0xa3bcb7,
    },
    {
      sky: 0xe6dccb,
      ground: 0xb4b28d,
      lightGround: 0xc7c29a,
      leaves: [0xb07a4f, 0xc18b59, 0xc5a36c, 0x8f8054],
      water: 0x96ad96,
    },
    {
      sky: 0x929fac,
      ground: 0x879b8c,
      lightGround: 0x9bab98,
      leaves: [0x536f65, 0x657d73, 0x7e9381, 0x4a625d],
      water: 0x8eafbb,
      moon: true,
    },
    {
      sky: 0xd9e0cd,
      ground: 0xa8b58e,
      lightGround: 0xb9c59d,
      leaves: [0x617b54, 0x798c5d, 0x8a9b69, 0x5b7454],
      water: 0x8caa91,
    },
    {
      sky: 0xdce5e6,
      ground: 0xdce3d7,
      lightGround: 0xe8ebdf,
      leaves: [0xb8c8bc, 0xc8d3c3, 0xd1d9c9, 0x95afa2],
      water: 0xa8c3c5,
    },
    {
      sky: 0xdbdfd6,
      ground: 0xabb2a0,
      lightGround: 0xbac0ac,
      leaves: [0x78866b, 0x8a9575, 0x9ba683, 0x6c7c65],
      water: 0x8fa9a0,
    },
    {
      sky: 0xe4e1cd,
      ground: 0xb6bc95,
      lightGround: 0xc8caa3,
      leaves: [0x87935e, 0x99a16c, 0xa9ad79, 0x77875b],
      water: 0x9db39e,
    },
  ];
  let activeChannel = null;
  function applyChannelTheme(channelId) {
    if (activeChannel === channelId) return;
    activeChannel = channelId;
    const palette =
      channelPalettes[(Number(channelId) || 1) - 1] || channelPalettes[0];
    scene.background.setHex(palette.sky);
    scene.fog.color.setHex(palette.sky);
    mat(C.grass).color.setHex(palette.ground);
    grassPatch.color.setHex(palette.lightGround);
    leafMats.forEach((material, i) => material.color.setHex(palette.leaves[i]));
    bambooMat.color.setHex(palette.leaves[2]);
    bambooLeaf.color.setHex(palette.leaves[1]);
    shrubMat.color.setHex(palette.leaves[2]);
    pond.material.color.setHex(palette.water);
    sunlight.color.setHex(palette.moon ? 0xc3d3ed : 0xffedc4);
    sunlight.intensity = palette.moon ? 2.1 : 3.3;
    ambient.color.setHex(palette.moon ? 0xd0dceb : 0xfff7df);
    ambient.intensity = palette.moon ? 2.3 : 2.6;
  }

  const nodeRecords = new Map();
  const nodeDefinitions = Array.isArray(NODES) ? NODES : Object.values(NODES);
  for (const def of nodeDefinitions) {
    const group = new THREE.Group();
    group.position.set(def.x, 0, def.z);
    scene.add(group);
    const base = mesh(
      new THREE.CylinderGeometry(1.2, 1.4, 0.32, 8),
      mat(0xa1ad8c),
      0,
      0.16,
      0,
      group,
    );
    const wood = def.kind === "cord" || def.type === "cord";
    if (wood) {
      const spool = mesh(
        new THREE.TorusGeometry(0.64, 0.17, 6, 16),
        mat(0xc4a475),
        0,
        0.8,
        0,
        group,
      );
      spool.rotation.x = Math.PI * 0.35;
      mesh(
        new THREE.TorusGeometry(0.45, 0.13, 6, 16),
        mat(0xe1cda0),
        0.2,
        1,
        0,
        group,
      ).rotation.x = Math.PI * 0.4;
    } else {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        mesh(
          new THREE.SphereGeometry(0.28, 8, 6),
          mat(i % 2 ? 0xb98b56 : 0x8a6848),
          Math.cos(a) * 0.55,
          0.65 + Math.sin(i) * 0.1,
          Math.sin(a) * 0.55,
          group,
        );
      }
    }
    const glow = mesh(
      new THREE.TorusGeometry(1.55, 0.035, 4, 32),
      mat(0xede2a7, {
        emissive: 0xd5bc66,
        emissiveIntensity: 0.55,
        transparent: true,
        opacity: 0.7,
      }),
      0,
      0.25,
      0,
      group,
    );
    glow.rotation.x = Math.PI / 2;
    glow.castShadow = false;
    const spark = mesh(
      new THREE.OctahedronGeometry(0.21),
      mat(0xf2df99, { emissive: 0xe8c65b, emissiveIntensity: 1 }),
      0,
      2.7,
      0,
      group,
    );
    spark.castShadow = false;
    const hit = new THREE.Mesh(
      new THREE.CylinderGeometry(2, 2, 5, 8),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hit.position.set(def.x, 2, def.z);
    hit.userData = { kind: "node", id: def.id };
    scene.add(hit);
    clickable.push(hit);
    const label = document.createElement("button");
    label.className = "node-hint";
    label.textContent =
      def.name || def.label || (wood ? "염주띠 채집" : "염주알 채집");
    label.title = "가까이 다가가 채집하기";
    label.addEventListener("click", (e) => {
      e.stopPropagation();
      onInteract?.({ kind: "node", id: def.id });
    });
    overlay.appendChild(label);
    const rec = {
      id: def.id,
      def,
      group,
      spark,
      glow,
      label,
      readyAt: 0,
      position: new THREE.Vector3(def.x, 3.7, def.z),
    };
    nodeRecords.set(def.id, rec);
    labelRecords.push({
      el: label,
      position: rec.position,
      kind: "node",
      id: def.id,
    });
  }

  const avatars = new Map();
  let selfId = null,
    selfProfile = null;
  // Every connected player remains visible. Only the closest players need the
  // individually animated, detailed model; the rest share three mesh batches.
  const crowdCapacity = 108;
  const crowdRobe = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.46, 0.72, 1.8, 6),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 }),
    crowdCapacity,
  );
  const crowdHead = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.4, 7, 5),
    mat(0xe3bd93),
    crowdCapacity,
  );
  const crowdHair = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.42, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.45),
    mat(0x48453b),
    crowdCapacity,
  );
  const crowdShadow = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.87, 8),
    new THREE.MeshBasicMaterial({
      color: 0x54674c,
      transparent: true,
      opacity: 0.17,
      depthWrite: false,
    }),
    crowdCapacity,
  );
  const crowdBatches = [crowdRobe, crowdHead, crowdHair, crowdShadow];
  for (const batch of crowdBatches) {
    batch.count = 0;
    batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    batch.frustumCulled = false;
    scene.add(batch);
  }
  const crowdLocal = new THREE.Object3D(),
    crowdMatrix = new THREE.Matrix4(),
    crowdColor = new THREE.Color();
  let lastLodAt = -1000,
    lastLodPopulation = -1,
    fullCount = 0,
    nameplateCount = 0;
  function rankAvatars(now) {
    if (now - lastLodAt < 500 && lastLodPopulation === avatars.size) return;
    lastLodAt = now;
    lastLodPopulation = avatars.size;
    const own = avatars.get(selfId),
      origin = own?.group.position || new THREE.Vector3(0, 0, 25);
    const ordered = [...avatars.values()].sort((a, b) => {
      if (a.isSelf) return -1;
      if (b.isSelf) return 1;
      // A small retained-detail preference avoids rapid LOD swaps on ties.
      const da =
        a.group.position.distanceToSquared(origin) - (a.detailed ? 9 : 0);
      const db =
        b.group.position.distanceToSquared(origin) - (b.detailed ? 9 : 0);
      return da - db || String(a.data.id).localeCompare(String(b.data.id));
    });
    const detailBudget = Math.max(1, Math.floor(fullAvatarLimit)),
      nameBudget = Math.max(1, Math.floor(labelLimit));
    ordered.forEach((avatar, index) => {
      avatar.detailed = index < detailBudget;
      avatar.showName = index < nameBudget;
      avatar.group.visible = avatar.detailed;
    });
    fullCount = Math.min(detailBudget, ordered.length);
    nameplateCount = Math.min(nameBudget, ordered.length);
  }
  function updateCrowd() {
    let index = 0;
    for (const avatar of avatars.values()) {
      if (avatar.detailed || index >= crowdCapacity) continue;
      const bend = avatar.upper.rotation.x;
      avatar.group.updateMatrix();
      function put(batch, x, y, z, rotationX = 0) {
        crowdLocal.position.set(x, y, z);
        crowdLocal.rotation.set(rotationX, 0, 0);
        crowdLocal.scale.setScalar(1);
        crowdLocal.updateMatrix();
        crowdMatrix.multiplyMatrices(avatar.group.matrix, crowdLocal.matrix);
        batch.setMatrixAt(index, crowdMatrix);
      }
      put(crowdRobe, 0, 1.25, 0, bend * 0.45);
      const hy = 1.25 + Math.cos(bend) * 1.25,
        hz = Math.sin(bend) * 1.25;
      put(crowdHead, 0, hy, hz, bend);
      put(
        crowdHair,
        0,
        hy + 0.08 * Math.cos(bend),
        hz + 0.08 * Math.sin(bend),
        bend,
      );
      put(crowdShadow, 0, 0.21, 0, -Math.PI / 2);
      crowdRobe.setColorAt(index, crowdColor.setHex(avatar.shade));
      index++;
    }
    for (const batch of crowdBatches) {
      batch.count = index;
      batch.instanceMatrix.needsUpdate = true;
    }
    if (crowdRobe.instanceColor) crowdRobe.instanceColor.needsUpdate = true;
  }
  const input = { x: 0, z: 0 };
  let target = null,
    lastMoveSent = 0,
    selectedHall = null,
    disposed = false;
  const clickRing = mesh(
    new THREE.RingGeometry(0.7, 0.82, 32),
    new THREE.MeshBasicMaterial({
      color: 0xf2e3b5,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
    }),
    0,
    0.3,
    0,
  );
  clickRing.rotation.x = -Math.PI / 2;
  clickRing.castShadow = false;
  let clickRingAge = 5;
  function createAvatar(player, isSelf) {
    lastLodPopulation = -1;
    const group = new THREE.Group();
    group.position.set(player.x || 0, 0, player.z ?? 25);
    scene.add(group);
    const shade = isSelf
      ? 0x637b63
      : [0x8a8e76, 0xb18d70, 0x7f8d92, 0x997a72][hash(player.id || "") % 4];
    const robeMat = mat(shade),
      skinMat = mat(0xe3bd93),
      hairMat = mat(0x48453b);
    const shadow = mesh(
      new THREE.CircleGeometry(0.9, 16),
      new THREE.MeshBasicMaterial({
        color: 0x54674c,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      }),
      0,
      0.2,
      0,
      group,
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.castShadow = false;
    const lower = mesh(
      new THREE.CylinderGeometry(0.48, 0.77, 1.25, 9),
      robeMat,
      0,
      0.85,
      0,
      group,
    );
    const upper = new THREE.Group();
    upper.position.y = 1.25;
    group.add(upper);
    mesh(
      new THREE.CylinderGeometry(0.52, 0.48, 0.9, 8),
      robeMat,
      0,
      0.35,
      0,
      upper,
    );
    const head = mesh(
      new THREE.SphereGeometry(0.42, 12, 9),
      skinMat,
      0,
      1.25,
      0,
      upper,
    );
    const cap = mesh(
      new THREE.SphereGeometry(0.43, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.45),
      hairMat,
      0,
      1.33,
      0,
      upper,
    );
    mesh(new THREE.SphereGeometry(0.15, 7, 5), hairMat, 0, 1.75, -0.07, upper);
    const arms = [];
    for (const xx of [-0.62, 0.62]) {
      const arm = mesh(
        new THREE.CapsuleGeometry(0.2, 0.53, 3, 6),
        robeMat,
        xx,
        0.2,
        0,
        upper,
      );
      arm.rotation.z = xx * 0.4;
      arms.push(arm);
    }
    const sash = mesh(
      new THREE.TorusGeometry(0.48, 0.065, 5, 12),
      mat(isSelf ? 0xcfc6a0 : 0xb7ac8e),
      0,
      0.08,
      0,
      upper,
    );
    sash.rotation.x = Math.PI / 2;
    const necklace = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.065, 6, 5),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65 }),
      12,
    );
    const necklaceMatrix = new THREE.Object3D();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      necklaceMatrix.position.set(
        Math.cos(a) * 0.27,
        0.56 + Math.sin(a) * 0.31,
        0.49,
      );
      necklaceMatrix.updateMatrix();
      necklace.setMatrixAt(i, necklaceMatrix.matrix);
      necklace.setColorAt(i, new THREE.Color(0xbb915a));
    }
    necklace.castShadow = true;
    upper.add(necklace);
    for (const xx of [-0.27, 0.27]) {
      const foot = mesh(
        new THREE.SphereGeometry(0.25, 8, 5),
        mat(0x61594a),
        xx,
        0.21,
        0.13,
        group,
      );
      foot.scale.set(0.7, 0.55, 1.3);
    }
    const label = document.createElement("div");
    label.className = `avatar-label${isSelf ? " self" : ""}`;
    label.textContent = player.name || "수행자";
    label.title = "염주 구경하기";
    label.tabIndex = 0;
    label.setAttribute("role", "button");
    label.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        label.click();
      }
    });
    overlay.appendChild(label);
    const indicator = mesh(
      new THREE.RingGeometry(0.95, 1.05, 40),
      new THREE.MeshBasicMaterial({
        color: isSelf ? 0xf5e6ac : 0xf9f7e8,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: isSelf ? 0.9 : 0.25,
      }),
      0,
      0.22,
      0,
      group,
    );
    indicator.rotation.x = -Math.PI / 2;
    indicator.castShadow = false;
    group.scale.setScalar(1.14);
    const a = {
      group,
      upper,
      arms,
      necklace,
      label,
      indicator,
      target: new THREE.Vector3(player.x || 0, 0, player.z ?? 25),
      data: player,
      isSelf,
      shade,
      wasMoving: false,
      detailed: true,
      showName: true,
    };
    avatars.set(player.id, a);
    return a;
  }
  function updateAvatarData(player, isSelf = false) {
    const a = avatars.get(player.id) || createAvatar(player, isSelf);
    a.data = { ...a.data, ...player };
    a.target.set(player.x ?? a.target.x, 0, player.z ?? a.target.z);
    if (a.label.textContent !== player.name && player.name)
      a.label.textContent = player.name;
    const beads = player.necklace || player.equipped?.beads;
    if (beads) {
      const signature = beads.join(",");
      if (a.necklaceSignature !== signature) {
        a.necklaceSignature = signature;
        for (let i = 0; i < 12; i++) {
          const item = ITEMS[beads[i % Math.max(1, beads.length)]];
          a.necklace.setColorAt(i, new THREE.Color(item?.color || "#b59e75"));
        }
        a.necklace.instanceColor.needsUpdate = true;
      }
    }
    if (isSelf && !a.isSelf) {
      a.isSelf = true;
      a.label.classList.add("self");
    }
    return a;
  }

  const projected = new THREE.Vector3();
  function positionLabel(el, pos, width, height) {
    projected.copy(pos).project(camera);
    const visible =
      projected.z > -1 &&
      projected.z < 1 &&
      Math.abs(projected.x) < 1.2 &&
      Math.abs(projected.y) < 1.2;
    el.style.display = visible ? "" : "none";
    if (visible) {
      el.style.left = `${(projected.x * 0.5 + 0.5) * width}px`;
      el.style.top = `${(-projected.y * 0.5 + 0.5) * height}px`;
    }
  }
  let width = container.clientWidth || 900,
    height = container.clientHeight || 650;
  function resize() {
    width = container.clientWidth || 900;
    height = container.clientHeight || 650;
    renderer.setSize(width, height, false);
    const aspect = width / height;
    const viewHeight = (aspect < 1 ? 120 : 102) / zoom;
    camera.left = (-viewHeight * aspect) / 2;
    camera.right = (viewHeight * aspect) / 2;
    camera.top = viewHeight / 2;
    camera.bottom = -viewHeight / 2;
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();
  const raycaster = new THREE.Raycaster(),
    mouse = new THREE.Vector2(),
    plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    hitPoint = new THREE.Vector3();
  let pointerStart = null;
  function pointerDown(e) {
    pointerStart = { x: e.clientX, y: e.clientY };
  }
  function pointerUp(e) {
    if (
      !pointerStart ||
      Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) > 7
    )
      return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(clickable, false);
    if (hits.length) {
      const data = hits[0].object.userData;
      if (data.kind === "hall") onSelectHall?.(data.id);
      onInteract?.(data);
      return;
    }
    if (raycaster.ray.intersectPlane(plane, hitPoint)) {
      target = {
        x: THREE.MathUtils.clamp(hitPoint.x, -67, 67),
        z: THREE.MathUtils.clamp(hitPoint.z, -67, 67),
      };
      onMoveTarget?.({ ...target });
      lastMoveSent = performance.now();
      clickRing.position.set(target.x, 0.3, target.z);
      clickRingAge = 0;
    }
  }
  function wheel(e) {
    e.preventDefault();
    zoom = THREE.MathUtils.clamp(zoom - e.deltaY * 0.0006, 0.8, 1.55);
    resize();
  }
  renderer.domElement.addEventListener("pointerdown", pointerDown);
  renderer.domElement.addEventListener("pointerup", pointerUp);
  renderer.domElement.addEventListener("wheel", wheel, { passive: false });

  const clock = new THREE.Clock();
  let frame = 0,
    elapsed = 0;
  function animate() {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;
    const own = avatars.get(selfId),
      now = performance.now();
    if (own) {
      const speed = selfProfile?.stats?.moveSpeed || 6;
      if (Math.hypot(input.x, input.z) > 0.01) {
        // Screen-space keyboard directions, matching the isometric camera.
        const n = Math.hypot(input.x, input.z),
          dx = input.x / n,
          dz = input.z / n;
        const worldX = dx * 0.8 + dz * 0.6,
          worldZ = -dx * 0.6 + dz * 0.8;
        target = {
          x: THREE.MathUtils.clamp(own.group.position.x + worldX * 8, -67, 67),
          z: THREE.MathUtils.clamp(own.group.position.z + worldZ * 8, -67, 67),
        };
        if (now - lastMoveSent > 100) {
          onMoveTarget?.({ ...target });
          lastMoveSent = now;
        }
      }
      // Render interpolation follows server simulation; keyboard input is sent as a target.
      // Keep tiny local prediction bounded, then reconcile on every authoritative packet.
      if (target && !own.data.bowing) {
        const dx = target.x - own.group.position.x,
          dz = target.z - own.group.position.z,
          d = Math.hypot(dx, dz);
        if (d > 0.15) {
          const step = Math.min(d, speed * dt);
          own.group.position.x += (dx / d) * step;
          own.group.position.z += (dz / d) * step;
          own.group.rotation.y = Math.atan2(dx, dz);
          own.wasMoving = true;
        } else {
          target = null;
          own.wasMoving = false;
        }
        if (own.group.position.distanceTo(own.target) > 5)
          own.group.position.lerp(own.target, dt * 3);
      } else {
        const dx = own.target.x - own.group.position.x,
          dz = own.target.z - own.group.position.z;
        own.wasMoving = !own.data.bowing && Math.hypot(dx, dz) > 0.12;
        if (own.wasMoving) own.group.rotation.y = Math.atan2(dx, dz);
        own.group.position.lerp(own.target, Math.min(1, dt * 10));
      }
    }
    rankAvatars(now);
    for (const a of avatars.values()) {
      if (!a.isSelf) {
        const dx = a.target.x - a.group.position.x,
          dz = a.target.z - a.group.position.z;
        a.wasMoving = Math.hypot(dx, dz) > 0.12;
        if (a.wasMoving) a.group.rotation.y = Math.atan2(dx, dz);
        a.group.position.lerp(a.target, Math.min(1, dt * 12));
      }
      const isBowing =
        a.data.bowing && (!a.data.bowEndsAt || a.data.bowEndsAt > Date.now());
      a.upper.rotation.x = THREE.MathUtils.lerp(
        a.upper.rotation.x,
        isBowing ? 1.16 : 0,
        Math.min(1, dt * 8),
      );
      a.group.position.y =
        a.wasMoving && !isBowing ? Math.sin(elapsed * 12) * 0.045 : 0;
      a.arms.forEach((arm, i) => {
        arm.rotation.x = isBowing
          ? -0.9
          : a.wasMoving
            ? Math.sin(elapsed * 12 + (i ? Math.PI : 0)) * 0.24
            : 0;
      });
      a.indicator.material.opacity = a.isSelf
        ? 0.65 + Math.sin(elapsed * 2) * 0.2
        : 0.25;
      positionLabel(
        a.label,
        new THREE.Vector3(a.group.position.x, 4.25, a.group.position.z),
        width,
        height,
      );
      if (!a.showName) a.label.style.display = "none";
    }
    updateCrowd();
    clickRingAge += dt;
    clickRing.material.opacity = Math.max(0, 0.9 - clickRingAge * 0.5);
    clickRing.scale.setScalar(1 + Math.min(clickRingAge, 1.5) * 0.6);
    for (const rec of labelRecords) {
      positionLabel(rec.el, rec.position, width, height);
      if (
        rec.kind === "node" &&
        own &&
        Math.hypot(
          own.group.position.x - rec.position.x,
          own.group.position.z - rec.position.z,
        ) > 36
      )
        rec.el.style.display = "none";
    }
    for (const rec of nodeRecords.values()) {
      const ready = rec.readyAt <= Date.now();
      rec.group.visible = ready;
      rec.label.classList.toggle("cooldown", !ready);
      rec.spark.position.y = 2.45 + Math.sin(elapsed * 2 + rec.def.x) * 0.25;
      rec.spark.rotation.y = elapsed * 0.8;
      rec.glow.material.opacity =
        0.45 + Math.sin(elapsed * 2 + rec.def.z) * 0.22;
    }
    smoke.forEach((s, i) => {
      const life = (elapsed * 0.24 + i * 0.13) % 1;
      s.position.set(
        Math.sin(elapsed * 0.5 + i) * life * 0.7,
        2.8 + life * 6,
        -4 + Math.cos(i) * life * 0.4,
      );
      s.scale.setScalar(0.3 + life * 0.9);
    });
    renderer.render(scene, camera);
  }
  animate();
  onReady?.();
  return {
    setWorld(world) {
      if (!world) return;
      if (world.channelId != null) applyChannelTheme(world.channelId);
      const present = new Set();
      for (const p of world.players || []) {
        present.add(p.id);
        updateAvatarData(p, p.id === selfId);
      }
      for (const [id, a] of avatars)
        if (id !== selfId && !present.has(id)) {
          scene.remove(a.group);
          a.label.remove();
          avatars.delete(id);
        }
      for (const n of world.nodes || []) {
        const rec = nodeRecords.get(n.id);
        if (rec) rec.readyAt = n.readyAt || 0;
      }
      for (const ritual of world.rituals || []) {
        const rec = labelRecords.find(
          (r) => r.kind === "hall" && r.id === ritual.hallId,
        );
        if (rec)
          rec.detail.textContent = `${ritual.progress} / ${ritual.target}배`;
      }
    },
    setSelf(profile) {
      if (!profile?.id) return;
      const changed =
        selfId !== profile.id || selfProfile?.channelId !== profile.channelId;
      selfId = profile.id;
      selfProfile = profile;
      const a = updateAvatarData(profile, true);
      if (changed) {
        a.group.position.set(profile.x || 0, 0, profile.z ?? 25);
        target = null;
        for (const [id, other] of avatars)
          if (id !== selfId) {
            scene.remove(other.group);
            other.label.remove();
            avatars.delete(id);
          }
      }
    },
    setSelectedHall(id) {
      selectedHall = id;
      for (const [hallId, h] of hallObjects)
        h.label.classList.toggle("selected", id === hallId);
    },
    setMoveInput(value) {
      const wasHeld = Math.hypot(input.x, input.z) > 0.01;
      input.x = Number(value?.x) || 0;
      input.z = Number(value?.z) || 0;
      if (wasHeld && Math.hypot(input.x, input.z) < 0.01) {
        const a = avatars.get(selfId);
        if (a) {
          target = null;
          onMoveTarget?.({ x: a.group.position.x, z: a.group.position.z });
        }
      }
    },
    getPlayerPosition() {
      const a = avatars.get(selfId);
      return a
        ? { x: a.group.position.x, z: a.group.position.z }
        : { x: 0, z: 25 };
    },
    resize,
    getPerformanceStats() {
      return {
        players: avatars.size,
        fullAvatars: fullCount,
        simplifiedAvatars: crowdRobe.count,
        visibleNameplates: nameplateCount,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
      };
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      renderer.domElement.removeEventListener("wheel", wheel);
      scene.traverse((obj) => {
        obj.geometry?.dispose();
        if (obj.material) {
          for (const m of Array.isArray(obj.material)
            ? obj.material
            : [obj.material])
            m.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      overlay.remove();
      style.remove();
    },
  };
}
function seed(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}
function hash(text) {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

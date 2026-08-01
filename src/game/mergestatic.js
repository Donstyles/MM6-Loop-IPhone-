import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Static geometry merging.
//
// A generated region arrives as hundreds of separate meshes - every house, wall,
// door frame and terrain chunk its own object. That is convenient to build and
// ruinous to draw: on a phone's wider viewport it came to almost a thousand
// draw calls, where MM6 itself would have issued a few dozen.
//
// Meshes that share a material and never move can be baked into one buffer, so
// the cost becomes one call per material rather than one per object. Anything
// with a name, userData or a per-object transform the game relies on (doors,
// animated water, the flora fields, which cull themselves) is left alone.
// ---------------------------------------------------------------------------

const KEEP = /door|water|lava|flora|tree|billboard|animated|torch|flame|sky/i;

/** Should this mesh keep its own identity? */
function isDynamic(o) {
  if (!o.isMesh) return true;
  if (o.userData && (o.userData.door || o.userData.dynamic || o.userData.animated)) return true;
  if (o.name && KEEP.test(o.name)) return true;
  const m = o.material;
  if (m && m.name && KEEP.test(m.name)) return true;
  // A frustum-culled-off mesh is usually a self-managing batch (the flora
  // fields do this); leave those to their owner.
  if (o.frustumCulled === false) return true;
  return false;
}

/**
 * Merge every static mesh in `root` that shares a material.
 * @returns {{before:number, after:number, merged:number}}
 */
export function mergeStatic(root) {
  if (!root) return { before: 0, after: 0, merged: 0 };
  root.updateMatrixWorld(true);

  /** @type {Map<string, {material: THREE.Material, geos: THREE.BufferGeometry[], meshes: THREE.Mesh[]}>} */
  const groups = new Map();
  let before = 0;

  root.traverse((o) => {
    if (!o.isMesh) return;
    before++;
    if (isDynamic(o)) return;
    if (Array.isArray(o.material)) return;      // multi-material needs groups
    if (!o.geometry || !o.geometry.attributes.position) return;

    const key = o.material.uuid;
    let g = groups.get(key);
    if (!g) { g = { material: o.material, geos: [], meshes: [] }; groups.set(key, g); }
    g.geos.push(o.geometry);
    g.meshes.push(o);
  });

  let merged = 0;
  for (const { material, geos, meshes } of groups.values()) {
    if (meshes.length < 2) continue;

    // Bake each mesh's world transform into a copy of its geometry, and keep
    // only the attributes they all share so the merge cannot fail on a mismatch.
    const common = commonAttributes(geos);
    const baked = [];
    for (let i = 0; i < meshes.length; i++) {
      const g = geos[i].clone();
      trimTo(g, common);
      g.applyMatrix4(meshes[i].matrixWorld);
      baked.push(g);
    }

    let combined = null;
    try {
      combined = mergeGeometries(baked, false);
    } catch (e) {
      for (const g of baked) g.dispose();
      continue;
    }
    if (!combined) { for (const g of baked) g.dispose(); continue; }

    const mesh = new THREE.Mesh(combined, material);
    mesh.name = 'merged';
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    root.add(mesh);

    for (const m of meshes) {
      if (m.parent) m.parent.remove(m);
      m.geometry.dispose();
    }
    for (const g of baked) g.dispose();
    merged += meshes.length;
  }

  let after = 0;
  root.traverse((o) => { if (o.isMesh) after++; });
  return { before, after, merged };
}

/** The attribute names present on every geometry in the set. */
function commonAttributes(geos) {
  const names = Object.keys(geos[0].attributes);
  return names.filter((n) => geos.every((g) => g.attributes[n]
    && g.attributes[n].itemSize === geos[0].attributes[n].itemSize));
}

function trimTo(geo, names) {
  for (const n of Object.keys(geo.attributes)) {
    if (!names.includes(n)) geo.deleteAttribute(n);
  }
  if (!geo.index) return;
  // mergeGeometries needs every input to agree on being indexed or not.
}

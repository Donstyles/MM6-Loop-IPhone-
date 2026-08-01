import * as THREE from 'three';
import { heightAt, slopeAt, TILE } from '../world/terrain.js';

// ---------------------------------------------------------------------------
// Map adapters.
//
// The world generator produces regions, towns and dungeons in whatever shape
// suits it; the session only ever talks to the small GameMap interface. These
// adapters bridge the two and own the collision acceleration structure.
// ---------------------------------------------------------------------------

/**
 * Uniform-grid broadphase over axis-aligned boxes. Outdoor maps are 65k units
 * across with a few thousand colliders, so a 2048-unit grid keeps per-query
 * work to a handful of boxes.
 */
export class ColliderGrid {
  constructor(cell = 2048) {
    this.cell = cell;
    this.map = new Map();
    this.boxes = [];
  }

  key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }

  /** @param {{minX,minY,minZ,maxX,maxY,maxZ}} b */
  add(b) {
    const i = this.boxes.length;
    this.boxes.push(b);
    const c = this.cell;
    const x0 = Math.floor(b.minX / c), x1 = Math.floor(b.maxX / c);
    const z0 = Math.floor(b.minZ / c), z1 = Math.floor(b.maxZ / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        let list = this.map.get(k);
        if (!list) { list = []; this.map.set(k, list); }
        list.push(i);
      }
    }
    return i;
  }

  addBox(minX, minY, minZ, maxX, maxY, maxZ, data = null) {
    return this.add({ minX, minY, minZ, maxX, maxY, maxZ, data });
  }

  /** Add from a THREE.Box3 or an object3D's world bounds. */
  addObject(obj, pad = 0) {
    const box = new THREE.Box3().setFromObject(obj);
    if (!isFinite(box.min.x)) return -1;
    return this.addBox(
      box.min.x - pad, box.min.y, box.min.z - pad,
      box.max.x + pad, box.max.y, box.max.z + pad, obj,
    );
  }

  /** Does a vertical cylinder (x,z,r) spanning [y, y+h] hit anything solid? */
  blocked(x, y, z, r, h) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const list = this.map.get(this.key(cx, cz));
        if (!list) continue;
        for (const i of list) {
          const b = this.boxes[i];
          if (b.disabled) continue;
          if (y + h <= b.minY || y >= b.maxY) continue;
          // Closest point on the box to the cylinder axis.
          const px = Math.max(b.minX, Math.min(x, b.maxX));
          const pz = Math.max(b.minZ, Math.min(z, b.maxZ));
          const dx = x - px, dz = z - pz;
          if (dx * dx + dz * dz < r * r) return true;
        }
      }
    }
    return false;
  }

  /** Highest box top under (x,z) below `y`, for standing on roofs and stairs. */
  supportAt(x, z, y, r = 0) {
    const c = this.cell;
    const cx = Math.floor(x / c), cz = Math.floor(z / c);
    const list = this.map.get(this.key(cx, cz));
    let best = -Infinity;
    if (!list) return best;
    for (const i of list) {
      const b = this.boxes[i];
      if (b.disabled || !b.walkable) continue;
      if (x < b.minX - r || x > b.maxX + r || z < b.minZ - r || z > b.maxZ + r) continue;
      if (b.maxY <= y + 140 && b.maxY > best) best = b.maxY;
    }
    return best;
  }

  clear() { this.map.clear(); this.boxes.length = 0; }
}

/** Wrap a generated outdoor region as a GameMap. */
export function outdoorMap(region) {
  const grid = new ColliderGrid(2048);
  for (const c of region.colliders || []) {
    if (c.isBox3) grid.addBox(c.min.x, c.min.y, c.min.z, c.max.x, c.max.y, c.max.z);
    else if (c.minX !== undefined) grid.add(c);
    else if (c.isObject3D) grid.addObject(c);
  }

  const waterY = region.waterLevel ?? null;
  const fogColor = new THREE.Color(region.fogColor ?? 0x8fa5bd);

  return {
    id: region.id,
    name: region.name,
    indoor: false,
    group: region.group || region.terrain?.group,
    region,
    hm: region.hm,
    start: region.start || { x: 0, y: 0, z: 0, yaw: 0 },
    fog: { color: fogColor, near: region.fogNear ?? 1600, far: region.fogFar ?? 9000 },
    colliders: grid,

    groundAt(x, z, y) {
      const terrainY = heightAt(region.hm, x, z);
      const support = grid.supportAt(x, z, y ?? terrainY);
      return Math.max(terrainY, support === -Infinity ? -1e9 : support);
    },
    ceilingAt() { return Infinity; },
    blocked(x, y, z, r, h) {
      // Steep ground counts as a wall so the party cannot climb cliffs.
      if (slopeAt(region.hm, x, z) > 0.82) return true;
      return grid.blocked(x, y, z, r, h);
    },
    waterLevelAt(x, z) {
      if (waterY === null) return null;
      return heightAt(region.hm, x, z) < waterY ? waterY : null;
    },
    // The region's light term folds in time of day, but the post pass already
    // applies that globally - taking it raw multiplied sprites down twice and
    // left them black after dusk. Keep only the local variation.
    lightAt(x, y, z) {
      if (!region.lightAt) return { r: 1, g: 1, b: 1 };
      const l = region.lightAt(x, y, z);
      const k = Math.max(0.62, Math.min(1.25, (l.r + l.g + l.b) / 3));
      return { r: k, g: k, b: k };
    },
    surfaceAt: region.surfaceAt || (() => 'grass'),
    drawMinimap: region.drawMinimap || null,
    setTimeOfDay: region.setTimeOfDay ? (h) => region.setTimeOfDay(h) : null,
    setFogColor(c) { if (region.setFogColor) region.setFogColor(c); },
    // The region culls its own billboard fields against the camera and drives
    // the sky; without this every cluster in the map draws every frame.
    update(camera, dt, timeOfDay, weather) {
      if (region.update) region.update(dt || 0.016, camera, timeOfDay, weather);
    },
    populate(entities) { if (region.populate) region.populate(entities); },
    dispose() { if (region.dispose) region.dispose(); },
  };
}

/** Wrap a generated dungeon as a GameMap. */
export function dungeonMap(dungeon) {
  const grid = new ColliderGrid(1024);
  for (const c of dungeon.colliders || []) {
    if (c.minX !== undefined) grid.add(c);
    else if (c.isBox3) grid.addBox(c.min.x, c.min.y, c.min.z, c.max.x, c.max.y, c.max.z);
  }

  const fogColor = new THREE.Color(dungeon.fogColor ?? 0x05070a);

  return {
    id: dungeon.id,
    name: dungeon.name,
    indoor: true,
    group: dungeon.group,
    dungeon,
    start: dungeon.start
      ? { ...dungeon.start, yaw: dungeon.start.yaw ?? dungeon.startYaw ?? 0 }
      : { x: 0, y: 0, z: 0, yaw: dungeon.startYaw || 0 },
    fog: { color: fogColor, near: dungeon.fogNear ?? 300, far: dungeon.fogFar ?? 3400 },
    colliders: grid,

    groundAt(x, z, y) {
      return dungeon.floorAt ? dungeon.floorAt(x, z, y) : grid.supportAt(x, z, y ?? 0);
    },
    ceilingAt(x, z, y) {
      return dungeon.ceilAt ? dungeon.ceilAt(x, z, y) : Infinity;
    },
    blocked(x, y, z, r, h) { return grid.blocked(x, y, z, r, h); },
    waterLevelAt(x, z) { return dungeon.waterAt ? dungeon.waterAt(x, z) : null; },
    lightAt: dungeon.lightAt || (() => ({ r: 0.35, g: 0.34, b: 0.4 })),
    surfaceAt: dungeon.surfaceAt || (() => 'stone'),
    drawMinimap: dungeon.drawMinimap || null,
    setTimeOfDay: null,
    setFogColor() {},
    update(camera, dt) { if (dungeon.update) dungeon.update(dt || 0.016, camera); },
    populate(entities) { if (dungeon.populate) dungeon.populate(entities); },
    dispose() { if (dungeon.dispose) dungeon.dispose(); },
  };
}

/** A trivially safe map used while something real is loading or has failed. */
export function emptyMap() {
  const group = new THREE.Group();
  return {
    id: 'void', name: 'Nowhere', indoor: false, group,
    start: { x: 0, y: 0, z: 0, yaw: 0 },
    fog: { color: new THREE.Color(0x8fa5bd), near: 2000, far: 8000 },
    groundAt: () => 0,
    ceilingAt: () => Infinity,
    blocked: () => false,
    waterLevelAt: () => null,
    lightAt: () => ({ r: 1, g: 1, b: 1 }),
    surfaceAt: () => 'grass',
    drawMinimap: null,
    setFogColor() {},
    populate() {},
    dispose() {},
  };
}

export { TILE };

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Party movement.
//
// MM6 moves the party as a single capsule with a fixed eye height, sliding
// along walls, stepping up small ledges, and falling under gravity. Turning is
// yaw-only; pitch is clamped and does not affect movement direction.
// ---------------------------------------------------------------------------

// Vanilla values, in world units and seconds. A tile is 512 units, so walking
// crosses about three quarters of a tile per second and the party can outrun
// every monster in the game - which is true of the original.
export const PLAYER = {
  eyeHeight: 160,
  radius: 37,
  height: 192,
  walkSpeed: 384,
  runSpeed: 768,
  strafeSpeed: 288,     // three quarters of walk
  swimSpeed: 288,
  gravity: 1280,
  jumpVel: 480,         // apex is 90 units, about half a step up
  stepUp: 96,
  maxPitch: 0.3927,     // the engine clamps pitch to +/-22.5 degrees
  turnSpeed: 2.6,
  flySpeed: 1536,
};

export class PlayerController {
  constructor() {
    this.pos = new THREE.Vector3(0, 400, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.inWater = false;
    this.flying = false;
    this.waterWalk = false;
    this.bobPhase = 0;
    this.bob = 0;
    this.lastStep = 0;
    this.speedScale = 1;
    this._tmp = new THREE.Vector3();
  }

  /**
   * @param {number} dt seconds
   * @param {object} axes {forward, strafe, turn}
   * @param {object} map collision provider: heightAt(x,z), collide(pos, radius, height), isWater(x,z,y)
   * @param {object} o  { run, jump, indoor }
   */
  update(dt, axes, map, o = {}) {
    const run = !!o.run;
    this.yaw -= axes.turn * PLAYER.turnSpeed * dt;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // Yaw 0 looks down -Z.
    const fx = -sin, fz = -cos;
    const rx = cos, rz = -sin;

    let speed = (run ? PLAYER.runSpeed : PLAYER.walkSpeed) * this.speedScale;
    if (this.inWater && !this.waterWalk) speed = PLAYER.swimSpeed;
    if (this.flying) speed = PLAYER.flySpeed;
    // Strafing is deliberately slower than walking forward, as in the original.
    const strafeK = PLAYER.strafeSpeed / PLAYER.walkSpeed;

    let wishX = fx * axes.forward + rx * axes.strafe * strafeK;
    let wishZ = fz * axes.forward + rz * axes.strafe * strafeK;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 1) { wishX /= wishLen; wishZ /= wishLen; }
    const moving = wishLen > 0.02;

    // Horizontal motion is snappy and mostly non-inertial, as in MM6.
    const accel = this.onGround || this.flying ? 18 : 4;
    this.vel.x += (wishX * speed - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wishZ * speed - this.vel.z) * Math.min(1, accel * dt);

    if (this.flying) {
      let vy = 0;
      if (o.ascend) vy += PLAYER.flySpeed;
      if (o.descend) vy -= PLAYER.flySpeed;
      this.vel.y += (vy - this.vel.y) * Math.min(1, 10 * dt);
    } else {
      if (o.jump && this.onGround) { this.vel.y = PLAYER.jumpVel; this.onGround = false; }
      this.vel.y -= PLAYER.gravity * dt * (this.inWater && !this.waterWalk ? 0.25 : 1);
      if (this.inWater && !this.waterWalk) this.vel.y = Math.max(this.vel.y, -260);
    }

    // Integrate with swept resolution against the map's colliders.
    const step = Math.min(dt, 1 / 30);
    this._move(step, map, o);
    if (dt > step) this._move(dt - step, map, o);

    // View bob while walking on the ground - subtle, MM6 has a gentle sway.
    if (moving && this.onGround && !this.flying) {
      this.bobPhase += dt * (run ? 11 : 7.5);
      this.bob = Math.sin(this.bobPhase) * (run ? 4.2 : 2.6);
    } else {
      this.bob *= Math.max(0, 1 - dt * 8);
    }

    this.pitch = Math.max(-PLAYER.maxPitch, Math.min(PLAYER.maxPitch, this.pitch));
    return moving;
  }

  _move(dt, map, o) {
    const p = this.pos;
    const nx = p.x + this.vel.x * dt;
    const nz = p.z + this.vel.z * dt;
    let ny = p.y + this.vel.y * dt;

    // Horizontal: try the full move, then each axis alone (the classic slide
    // along axis-aligned walls). When that still leaves the party essentially
    // parked - a wall at an angle, a corner pocket - project the velocity
    // along the wall by probing rotated headings instead of stopping dead:
    // walking into a slanted facade now skims along it (wowjudge #4).
    if (map.blocked && map.blocked(nx, p.y, nz, PLAYER.radius, PLAYER.height)) {
      const ox = p.x, oz = p.z;
      const okX = !map.blocked(nx, p.y, p.z, PLAYER.radius, PLAYER.height);
      const okZ = !map.blocked(p.x, p.y, nz, PLAYER.radius, PLAYER.height);
      if (okX) p.x = nx;
      if (okZ) p.z = nz;
      const sp = Math.hypot(this.vel.x, this.vel.z);
      const wanted = sp * dt;
      const got = Math.hypot(p.x - ox, p.z - oz);
      if (sp > 1 && got < wanted * 0.3) {
        // Barely moved: hunt for the wall tangent. Nearest deflection first;
        // the tangential share of the speed (cos of the deflection) is kept,
        // so a grazing angle glides and a head-on push only creeps.
        const a0 = Math.atan2(this.vel.x, this.vel.z);
        for (const off of [0.55, -0.55, 0.9, -0.9, 1.25, -1.25]) {
          const a = a0 + off;
          const k = Math.max(0.2, Math.cos(off));
          const sx = ox + Math.sin(a) * sp * k * dt;
          const sz = oz + Math.cos(a) * sp * k * dt;
          if (map.blocked(sx, p.y, sz, PLAYER.radius, PLAYER.height)) continue;
          p.x = sx; p.z = sz;
          this.vel.x = Math.sin(a) * sp * k;
          this.vel.z = Math.cos(a) * sp * k;
          break;
        }
        if (p.x === ox && p.z === oz) { this.vel.x *= 0.2; this.vel.z *= 0.2; }
      } else {
        if (!okX) this.vel.x *= 0.2;
        if (!okZ) this.vel.z *= 0.2;
      }
    } else {
      p.x = nx; p.z = nz;
    }

    const ground = map.groundAt ? map.groundAt(p.x, p.z, p.y) : 0;
    const ceil = map.ceilingAt ? map.ceilingAt(p.x, p.z, p.y) : Infinity;

    if (ny <= ground) {
      // Step up onto ledges without launching the camera.
      ny = ground;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = true;
    } else {
      this.onGround = ny - ground < 2;
    }
    if (ny + PLAYER.height > ceil) {
      ny = ceil - PLAYER.height;
      if (this.vel.y > 0) this.vel.y = 0;
    }
    p.y = ny;

    if (map.waterLevelAt) {
      const wl = map.waterLevelAt(p.x, p.z);
      this.inWater = wl !== null && p.y < wl - 20;
      if (this.waterWalk && wl !== null && p.y < wl) {
        p.y = wl; this.vel.y = Math.max(0, this.vel.y); this.onGround = true; this.inWater = false;
      }
    } else {
      this.inWater = false;
    }
  }

  /** Apply the player's transform to a camera. */
  applyTo(camera) {
    camera.position.set(this.pos.x, this.pos.y + PLAYER.eyeHeight + this.bob, this.pos.z);
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  /** Unit forward vector on the XZ plane. */
  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** Full look direction including pitch, for aiming spells and arrows. */
  lookDir(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }
}

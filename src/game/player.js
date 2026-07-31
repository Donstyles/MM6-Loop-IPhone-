import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Party movement.
//
// MM6 moves the party as a single capsule with a fixed eye height, sliding
// along walls, stepping up small ledges, and falling under gravity. Turning is
// yaw-only; pitch is clamped and does not affect movement direction.
// ---------------------------------------------------------------------------

export const PLAYER = {
  eyeHeight: 160,
  radius: 90,
  height: 190,
  walkSpeed: 520,
  runSpeed: 1040,
  swimSpeed: 300,
  gravity: 5200,
  jumpVel: 1050,
  stepUp: 130,
  maxPitch: 1.05,
  turnSpeed: 2.6,
  flySpeed: 900,
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

    let wishX = fx * axes.forward + rx * axes.strafe;
    let wishZ = fz * axes.forward + rz * axes.strafe;
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

    // Horizontal: try full move, then each axis alone, so we slide along walls.
    if (map.blocked && map.blocked(nx, p.y, nz, PLAYER.radius, PLAYER.height)) {
      const okX = !map.blocked(nx, p.y, p.z, PLAYER.radius, PLAYER.height);
      const okZ = !map.blocked(p.x, p.y, nz, PLAYER.radius, PLAYER.height);
      if (okX) { p.x = nx; } else { this.vel.x *= 0.2; }
      if (okZ) { p.z = nz; } else { this.vel.z *= 0.2; }
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

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Billboard sprite batching.
//
// Every monster, NPC, tree, prop and item in MM6 is an upright 2D sprite that
// always faces the camera about the Y axis (it never tilts when you look up or
// down - that Y-locked behaviour is part of the game's look). We draw them with
// one instanced mesh per sprite atlas, so a forest of 400 trees is a single
// draw call.
// ---------------------------------------------------------------------------

const VERT = /* glsl */ `
precision highp float;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;

in vec3 position;          // unit quad corner, x,y in [-0.5,0.5] / [0,1]
in vec3 iPos;              // world position of the sprite's base
in vec2 iSize;             // width, height in world units
in vec4 iUV;               // u0, v0, u1, v1
in vec4 iTint;             // rgb tint, a = opacity
in float iFlags;           // 1 = billboard about Y only, 2 = full billboard

out vec2 vUv;
out vec4 vTint;
out float vFogDepth;

void main() {
  // Camera right/up in world space, from the inverse view basis.
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp    = vec3(0.0, 1.0, 0.0);
  if (iFlags > 1.5) camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

  vec3 world = iPos
    + camRight * (position.x * iSize.x)
    + camUp * (position.y * iSize.y);

  vec4 mv = viewMatrix * vec4(world, 1.0);
  vFogDepth = -mv.z;
  // iUV is (u0, v0, u1, v1) with v0 at the *bottom* edge of the atlas cell, and
  // the atlas texture is uploaded flipY (three.js default for a canvas), so
  // v=1 is the canvas's top row. The quad's own position.y is 0 at the foot and
  // 1 at the head, which means it interpolates straight: foot -> v0, head -> v1.
  // Inverting it here drew every monster, NPC and spell sprite upside down.
  vUv = mix(iUV.xy, iUV.zw, vec2(position.x + 0.5, position.y));
  vTint = iTint;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;
layout(location = 0) out vec4 pc_fragColor;

uniform sampler2D map;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform float alphaTest;

in vec2 vUv;
in vec4 vTint;
in float vFogDepth;

// The atlas is sRGB-tagged (decoded to linear on fetch) and the render target
// is an SRGB8 attachment, so the *hardware* re-encodes on write. No manual
// encode here: adding one (as this shader once did) runs every sprite through
// the sRGB curve twice, and the whole bestiary washes out into pale toys -
// measured directly: atlas texel 47 landed on screen at 118.
void main() {
  vec4 c = texture(map, vUv);
  if (c.a < alphaTest) discard;
  // Partial opacity on an opaque, alpha-tested batch: an ordered-dither
  // screen door, the era's own transparency. This is what lets an effect
  // sprite dissolve as it closes on the camera without any blending state.
  if (vTint.a < 0.996) {
    const float B[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0,
                                  3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
    vec2 q = floor(gl_FragCoord.xy);
    int bi = int(mod(q.x, 4.0)) + int(mod(q.y, 4.0)) * 4;
    if (vTint.a < (B[bi] + 0.5) / 16.0) discard;
  }
  // Sprites take the same 32-step greyscale multiply the world does; the
  // banding that produces is authentic, not an artefact.
  vec3 t = floor(clamp(vTint.rgb, 0.0, 1.0) * 31.0 + 0.5) * (8.0 / 248.0);
  c.rgb *= t;
  float f = smoothstep(fogNear, fogFar, vFogDepth);
  c.rgb = mix(c.rgb, fogColor, f);
  pc_fragColor = vec4(c.rgb, 1.0);
}
`;

const QUAD_POS = new Float32Array([
  -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0,
]);
const QUAD_IDX = new Uint16Array([0, 1, 2, 0, 2, 3]);

export class SpriteBatch {
  /**
   * @param {THREE.Texture} texture sprite atlas
   * @param {number} capacity max simultaneous sprites
   */
  constructor(texture, capacity = 256) {
    this.capacity = capacity;
    this.count = 0;

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(QUAD_POS, 3));
    geo.setIndex(new THREE.BufferAttribute(QUAD_IDX, 1));

    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    this.aUV = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.aTint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.aFlags = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    for (const a of [this.aPos, this.aSize, this.aUV, this.aTint, this.aFlags]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iSize', this.aSize);
    geo.setAttribute('iUV', this.aUV);
    geo.setAttribute('iTint', this.aTint);
    geo.setAttribute('iFlags', this.aFlags);
    geo.instanceCount = 0;
    // Sprites are placed all over the map; culling is done by the caller when
    // it decides what to submit, so keep the batch itself always visible.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);

    const mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        map: { value: texture },
        fogColor: { value: new THREE.Color(0x8fa5bd) },
        fogNear: { value: 2000 },
        fogFar: { value: 6000 },
        alphaTest: { value: 0.5 },
      },
      transparent: false,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide,
    });

    this.geometry = geo;
    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  begin() { this.count = 0; }

  /**
   * Submit one sprite. `x,y,z` is the point where the sprite meets the ground.
   */
  add(x, y, z, w, h, u0, v0, u1, v1, tr = 1, tg = 1, tb = 1, ta = 1, flags = 1) {
    const i = this.count;
    if (i >= this.capacity) return false;
    this.aPos.array[i * 3] = x;
    this.aPos.array[i * 3 + 1] = y;
    this.aPos.array[i * 3 + 2] = z;
    this.aSize.array[i * 2] = w;
    this.aSize.array[i * 2 + 1] = h;
    this.aUV.array[i * 4] = u0;
    this.aUV.array[i * 4 + 1] = v0;
    this.aUV.array[i * 4 + 2] = u1;
    this.aUV.array[i * 4 + 3] = v1;
    this.aTint.array[i * 4] = tr;
    this.aTint.array[i * 4 + 1] = tg;
    this.aTint.array[i * 4 + 2] = tb;
    this.aTint.array[i * 4 + 3] = ta;
    this.aFlags.array[i] = flags;
    this.count++;
    return true;
  }

  end() {
    this.geometry.instanceCount = this.count;
    if (this.count > 0) {
      this.aPos.addUpdateRange(0, this.count * 3); this.aPos.needsUpdate = true;
      this.aSize.addUpdateRange(0, this.count * 2); this.aSize.needsUpdate = true;
      this.aUV.addUpdateRange(0, this.count * 4); this.aUV.needsUpdate = true;
      this.aTint.addUpdateRange(0, this.count * 4); this.aTint.needsUpdate = true;
      this.aFlags.addUpdateRange(0, this.count); this.aFlags.needsUpdate = true;
    }
    this.mesh.visible = this.count > 0;
  }

  setFog(color, near, far) {
    this.material.uniforms.fogColor.value.copy(color);
    this.material.uniforms.fogNear.value = near;
    this.material.uniforms.fogFar.value = far;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Owns one SpriteBatch per atlas and rebuilds them each frame from whatever the
 * world submits. Keeps draw calls proportional to distinct sprite sheets on
 * screen rather than to sprite count.
 */
export class SpriteRenderer {
  constructor(scene) {
    this.scene = scene;
    this.batches = new Map();   // texture.uuid -> SpriteBatch
    this.fog = { color: new THREE.Color(0x8fa5bd), near: 2000, far: 6000 };
  }

  batchFor(texture, capacity = 512) {
    let b = this.batches.get(texture.uuid);
    if (!b) {
      b = new SpriteBatch(texture, capacity);
      b.setFog(this.fog.color, this.fog.near, this.fog.far);
      this.scene.add(b.mesh);
      this.batches.set(texture.uuid, b);
    }
    return b;
  }

  begin() { for (const b of this.batches.values()) b.begin(); }
  end() { for (const b of this.batches.values()) b.end(); }

  setFog(color, near, far) {
    this.fog.color.copy(color); this.fog.near = near; this.fog.far = far;
    for (const b of this.batches.values()) b.setFog(color, near, far);
  }

  get drawCalls() {
    let n = 0;
    for (const b of this.batches.values()) if (b.count > 0) n++;
    return n;
  }

  dispose() {
    for (const b of this.batches.values()) { this.scene.remove(b.mesh); b.dispose(); }
    this.batches.clear();
  }
}

/**
 * Pick the sprite angle index for a creature, given where it faces and where the
 * camera is. Index 0 is the front view; the sequence walks around the model.
 */
export function angleIndex(entityYaw, camX, camZ, entX, entZ, angles = 8) {
  // Entity yaw follows the player's convention where 0 looks down -Z, so the
  // half turn belongs here: without it a monster charging the party selects
  // its own back view.
  const toCam = Math.atan2(camX - entX, camZ - entZ);
  let rel = toCam - entityYaw + Math.PI;
  rel = ((rel % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.round((rel / (Math.PI * 2)) * angles) % angles;
}

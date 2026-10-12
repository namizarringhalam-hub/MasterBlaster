import * as THREE from 'three/webgpu';
import { Fn, If, Loop, atan, float, fract, mix, screenCoordinate, screenUV, sin, texture3D, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js';

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));

// A small authored SDR look. Black and white remain fixed: cool deep shadows,
// a modest S curve, and saturated neon without lifting the arena's exposure.
export function createNeonGrade(size = 16) {
  const data = new Uint8Array(size ** 3 * 4);
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const rgb = [r, g, b].map(v => v / (size - 1));
    const luma = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    const index = (r + g * size + b * size * size) * 4;
    for (let channel = 0; channel < 3; channel++) {
      let v = luma + (rgb[channel] - luma) * 1.055;
      v += (v - .5) * v * (1 - v) * .14;
      v += [ -.007, .001, .008 ][channel] * (1 - luma) * Math.sin(Math.PI * luma);
      data[index + channel] = Math.round(clamp01(v) * 255);
    }
    data[index + 3] = 255;
  }
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.name = 'Master Blaster midnight neon grade';
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export class CinematicPresentation {
  constructor() {
    this.motion = uniform(0);
    this.damage = uniform(0);
    this.impact = uniform(0);
    this.clock = uniform(0);
    this.active = uniform(0);
    this.grade = createNeonGrade();
  }

  update({ speed = 0, motion = Math.max(0, (speed - 13) / 45), damage = 0, impact = 0, time = 0, active = true } = {}, reducedMotion = false) {
    this.active.value = active ? 1 : 0;
    this.motion.value = active && !reducedMotion ? clamp01(motion) : 0;
    this.damage.value = active ? clamp01(damage) : 0;
    this.impact.value = active && !reducedMotion ? clamp01(impact) : 0;
    this.clock.value = Number.isFinite(time) && !reducedMotion ? time : 0;
  }

  node(input) {
    const sampled = Fn(() => {
      const coord = screenUV, center = coord.sub(.5);
      const edge = center.length().smoothstep(.2, .72);
      const result = input.sample(coord).toVar();
      // Only the periphery smears. Aiming and the centre silhouette stay sharp.
      If(this.motion.greaterThan(.001), () => {
        const sum = result.rgb.toVar();
        Loop(4, ({ i }) => {
          const sampleUV = coord.sub(center.mul(float(i).add(1).mul(.0045)).mul(this.motion).mul(edge)).clamp(0, 1);
          sum.addAssign(input.sample(sampleUV).rgb);
        });
        result.rgb.assign(sum.mul(.2));
      });
      If(this.impact.greaterThan(.001), () => {
        const shift = center.mul(this.impact).mul(edge).mul(.003);
        result.r.assign(input.sample(coord.add(shift).clamp(0, 1)).r);
        result.b.assign(input.sample(coord.sub(shift).clamp(0, 1)).b);
      });
      return result;
    })();
    const graded = lut3D(sampled, texture3D(this.grade), 16, float(.7));
    return Fn(() => {
      const center = screenUV.sub(.5), radius = center.length();
      const edge = radius.smoothstep(.26, .71);
      const angle = atan(center.y, center.x);
      const spokes = sin(angle.mul(71).add(sin(angle.mul(23)).mul(2.4))).max(0).pow(32);
      const running = sin(radius.mul(75).sub(this.clock.mul(22)).add(angle.mul(17))).mul(.5).add(.5).pow(6);
      const streak = spokes.mul(running).mul(edge.pow(2)).mul(this.motion).mul(.055);
      const grain = fract(sin(screenCoordinate.xy.dot(vec2(12.9898, 78.233)).add(this.clock.mul(13.7))).mul(43758.5453)).sub(.5).mul(.003);
      const scanline = sin(screenCoordinate.y.mul(Math.PI)).mul(.0015).add(.9985);
      const shade = float(1).sub(edge.mul(.09)).mul(scanline);
      const color = graded.rgb.mul(shade).add(vec3(.33, .79, 1).mul(streak)).add(grain);
      const damageEdge = this.damage.mul(edge).mul(.14);
      return vec4(mix(color, vec3(.6, .025, .045), damageEdge).clamp(0, 1), graded.a);
    })();
  }

  dispose() { this.grade.dispose(); }
}

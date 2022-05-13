import * as THREE from 'three';
import metaversefile from 'metaversefile';
const {useApp, useFrame, useCamera, useMaterials, usePhysics, useProcGen, useCleanup} = metaversefile;

const baseUrl = import.meta.url.replace(/(\/)[^\/\\]*$/, '$1');

// const localVector = new THREE.Vector3();
// const localVector2 = new THREE.Vector3();

// console.log('load globes mesh 0');

const localVector = new THREE.Vector3();
const localQuaternion = new THREE.Quaternion();

const upVector = new THREE.Vector3(0, 1, 0);
const tiltQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI * 0.05);

const rotationHeightRate = 0.05;
const rotationTimeRate = 4000;
const numFrames = 8;
const globeSize = 0.3;
const globeSeparationX = 1;
const globeSeparationY = 0.3;
const heightSegments = 32;
const numTypes = 3;

const vertexShader = `\
precision highp float;
precision highp int;

uniform float uTime;
uniform vec4 cameraBillboardQuaternion;
attribute vec3 p;
// attribute vec2 t;
varying vec2 vUv;
// varying float vTimeDiff;

in int textureIndex;
flat out int vTextureIndex;

/* float getBezierT(float x, float a, float b, float c, float d) {
  return float(sqrt(3.) *
    sqrt(-4. * b * d + 4. * b * x + 3. * c * c + 2. * c * d - 8. * c * x - d * d + 4. * d * x)
      + 6. * b - 9. * c + 3. * d)
      / (6. * (b - 2. * c + d));
}
float easing(float x) {
  return getBezierT(x, 0., 1., 0., 1.);
}
float easing2(float x) {
  return easing(easing(x));
} */

vec4 quat_from_axis_angle(vec3 axis, float angle) {
  vec4 qr;
  float half_angle = (angle * 0.5) * PI;
  qr.x = axis.x * sin(half_angle);
  qr.y = axis.y * sin(half_angle);
  qr.z = axis.z * sin(half_angle);
  qr.w = cos(half_angle);
  return qr;
}
vec3 rotateVecQuat(vec3 position, vec4 q) {
  vec3 v = position.xyz;
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

void main() {
  vec3 pos = position;
  pos = rotateVecQuat(pos, cameraBillboardQuaternion);
  pos = (modelMatrix * vec4(pos, 1.)).xyz;
  pos += p;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.);
  vUv = uv;

  // float startTime = t.x;
  // float endTime = t.y;
  // float timeDiff = (uTime - startTime) / (endTime - startTime);
  // vTimeDiff = timeDiff;
  // vPosition = position;

  vTextureIndex = textureIndex;
}
`;
const fragmentShader = `\
precision highp float;
precision highp int;

#define PI 3.1415926535897932384626433832795

uniform sampler2D uTex;

uniform float uTime;
varying vec2 vUv;
// varying float vTimeDiff;
flat in int vTextureIndex;

void main() {
  vec4 c = vec4(0.);

  vec2 uv = vUv;
  float ti = float(vTextureIndex);
  uv.x = (uv.x + ti) / ${numFrames.toFixed(8)};
  uv.x += 1./(8.*31.);
  c = texture2D(uTex, uv);

  // c.rgb *= 1.5;

  gl_FragColor = c;
  if (gl_FragColor.a < 0.99) {
    discard;
  }

  // gl_FragColor = vec4(1., 0., 0., 1.);
}
`;

const _makePlaneGeometry = () => {
  const planeGeometryNonInstanced = new THREE.PlaneBufferGeometry(globeSize, globeSize);
  const planeGeometry = new THREE.InstancedBufferGeometry();
  for (const k in planeGeometryNonInstanced.attributes) {
    planeGeometry.setAttribute(k, planeGeometryNonInstanced.attributes[k]);
  }
  planeGeometry.index = planeGeometryNonInstanced.index;
  return planeGeometry;
};
const planeGeometry = _makePlaneGeometry();

const defaultMaxParticles = 256;

const _makeGeometry = maxParticles => {
  const geometry = planeGeometry.clone();
  geometry.setAttribute('p', new THREE.InstancedBufferAttribute(new Float32Array(maxParticles * 3), 3));
  // geometry.setAttribute('q', new THREE.InstancedBufferAttribute(new Float32Array(maxParticles * 4), 4));
  // geometry.setAttribute('t', new THREE.InstancedBufferAttribute(new Float32Array(maxParticles), 1));
  geometry.setAttribute('textureIndex', new THREE.InstancedBufferAttribute(new Int32Array(maxParticles), 1));
  return geometry;
};
const _makeMaterial = () => {
  const uniforms = {
    uTime: {
      value: 0,
      needsUpdate: true,
    },
    uTex: {
      value: null,
      needsUpdate: false,
    },
    cameraBillboardQuaternion: {
      value: new THREE.Quaternion(),
      needsUpdate: true,
    },
  };
  const {WebaverseShaderMaterial} = useMaterials();
  const material = new WebaverseShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    transparent: true,
    // alphaTest: 0.9,
  });
  return material;
};

class Particle extends THREE.Object3D {
  constructor(dx, dy, typeIndex) {
    super();

    this.dx = dx;
    this.dy = dy;
    this.typeIndex = typeIndex;
  }
}

class GlobesMesh extends THREE.InstancedMesh {
  constructor(maxParticles = defaultMaxParticles) {
    // console.log('load globes mesh 1');

    const geometry = _makeGeometry(maxParticles);
    const material = _makeMaterial();
    super(geometry, material, maxParticles);

    const procgen = useProcGen();
    const {alea} = procgen;
    const rng = alea('lol');
    this.particles = (() => {
      const particles = [];
      for (let dy = 0; dy < heightSegments; dy++) {
        const typeIndex = Math.floor(rng() * numTypes);
        for (let dx = -1; dx <= 1; dx += 2) {
          const particle = new Particle(dx, dy, typeIndex);
          particles.push(particle);
        }
      }
      return particles;
    })();

    (async () => {
      const globesImage = await _loadImage(`${baseUrl}/globes.png`);
      const texture = new THREE.Texture(globesImage);
      texture.minFilter = THREE.NearestFilter;
      texture.magFilter = THREE.NearestFilter;
      texture.encoding = THREE.sRGBEncoding;
      texture.needsUpdate = true;
      this.material.uniforms.uTex.value = texture;
      this.material.uniforms.uTex.needsUpdate = true;
    })();
  }
  /* updateParticles() {

  } */
  updateGeometry() {
    let index = 0;
    // console.log('update geometry', this.particles, this);
    const now = performance.now();
    
    for (const particle of this.particles) {
      // if (particle !== null) {
        localQuaternion.setFromAxisAngle(
          upVector,
          (
            (particle.dy * rotationHeightRate) +
            (now % rotationTimeRate) / rotationTimeRate
          ) * 2 * Math.PI
        ).premultiply(tiltQuaternion);
        localVector.set(particle.dx * globeSeparationX, particle.dy * globeSeparationY, 0)
          .applyQuaternion(localQuaternion)
          .toArray(this.geometry.attributes.p.array, index * 3);

        this.geometry.attributes.textureIndex.array[index] = particle.typeIndex;

        index++;
      // }
    }

    this.geometry.attributes.p.updateRange.count = index * 3;
    this.geometry.attributes.p.needsUpdate = true;

    // this.geometry.attributes.t.updateRange.count = index * 2;
    // this.geometry.attributes.t.needsUpdate = true;

    this.geometry.attributes.textureIndex.updateRange.count = index;
    this.geometry.attributes.textureIndex.needsUpdate = true;

    this.count = index;
  }
  updateMaterial() {
    const camera = useCamera();
    this.material.uniforms.cameraBillboardQuaternion.value.copy(camera.quaternion);
  }
  update() {
    // this.updateParticles();
    this.updateGeometry();
    this.updateMaterial();
  }
}

const _loadImage = async u => {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.crossOrigin = 'Anonymous';
    img.onload = resolve;
    img.onerror = reject;
    img.src = u;
  });
  return img;
};

export default e => {
  const app = useApp();
  const physics = usePhysics();

  app.name = 'globes';

  const globesMesh = new GlobesMesh();
  app.add(globesMesh);
  globesMesh.updateMatrixWorld();

  useFrame(() => {
    globesMesh.update();
  });

  let physicsIds = [];
  
  useCleanup(() => {
    for (const physicsId of physicsIds) {
      physics.removeGeometry(physicsId);
    }
  });

  return app;
};

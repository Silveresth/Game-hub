/**
 * Post-traitement léger. Bas : rien (le renderer dessine tout seul, Neutral inchangé).
 * Moyen : vignette. Haut : bloom sur les hautes lumières (or, œuvres rares) + vignette,
 * et SMAA sur ordinateur. OutputPass applique le tone mapping du renderer (Neutral).
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uStrength: { value: 0.38 },
    uSize: { value: 0.78 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `uniform sampler2D tDiffuse; uniform float uStrength, uSize; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5));
      c.rgb *= mix(1.0, smoothstep(uSize, uSize - 0.45, d), uStrength);
      gl_FragColor = c;
    }`,
};

let composer: EffectComposer | null = null;
let bloom: UnrealBloomPass | null = null;
let smaa: SMAAPass | null = null;

export function setPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  mode: 'off' | 'vignette' | 'full',
  wantSmaa: boolean,
): void {
  if (mode === 'off') {
    composer?.dispose();
    composer = null;
    bloom = null;
    smaa = null;
    return;
  }
  const w = renderer.domElement.width || innerWidth;
  const h = renderer.domElement.height || innerHeight;
  if (!composer) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.26, 0.32, 0.82);
    composer.addPass(bloom);
    composer.addPass(new ShaderPass(VignetteShader));
    smaa = new SMAAPass(w, h);
    composer.addPass(smaa);
    composer.addPass(new OutputPass());
  }
  bloom!.enabled = mode === 'full';
  smaa!.enabled = mode === 'full' && wantSmaa;
  resizePost(renderer);
}

export function resizePost(renderer: THREE.WebGLRenderer): void {
  if (!composer) return;
  const dpr = renderer.getPixelRatio();
  composer.setPixelRatio(dpr);
  composer.setSize(innerWidth, innerHeight);
}

/** Vrai si le compositeur a dessiné la scène. */
export function renderPost(): boolean {
  if (!composer) return false;
  composer.render();
  return true;
}

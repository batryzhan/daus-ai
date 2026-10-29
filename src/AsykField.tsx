import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import asykModelUrl from '../assets/3d-files/Asyk.glb?url';

export type AsykStone = {
  id: string;
  color: string;
  colorName: string;
  position: string;
  positionName: string;
  x: number;
  y: number;
  size: number;
};

let sourceModel: Promise<THREE.Group> | undefined;
function loadModel() {
  sourceModel ??= new Promise((resolve, reject) => {
    new GLTFLoader().load(asykModelUrl, (gltf) => resolve(gltf.scene), undefined, reject);
  });
  return sourceModel;
}

type Props = {
  stones: AsykStone[];
  animateId?: string;
  className?: string;
  onStatusChange?: (status: 'loading' | 'ready' | 'error') => void;
};

export function AsykField({ stones, animateId, className = '', onStatusChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stonesRef = useRef(stones);
  const animateIdRef = useRef(animateId);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [devError, setDevError] = useState('');
  stonesRef.current = stones;
  animateIdRef.current = animateId;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch (error) {
      setStatus('error');
      setDevError(error instanceof Error ? error.message : 'WebGL қолжетімсіз');
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
    camera.up.set(0, 0, -1);
    camera.position.set(0, 18, 0);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xfff5e6, 0x81715e, 2.1));
    const sun = new THREE.DirectionalLight(0xffffff, 3.1);
    sun.position.set(-3, 12, 4);
    scene.add(sun);

    const models = new Map<string, { root: THREE.Group; shadow: THREE.Mesh; baseY: number; baseYaw: number }>();
    const modelLayer = new THREE.Group();
    scene.add(modelLayer);
    let frame = 0;
    let startAnimation = 0;
    let activeAnimationId: string | undefined;
    let disposed = false;
    let initialized = false;
    const worldWidth = 10;

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      const worldHeight = worldWidth * height / width;
      camera.left = -worldWidth / 2;
      camera.right = worldWidth / 2;
      camera.top = worldHeight / 2;
      camera.bottom = -worldHeight / 2;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
      renderer.setSize(width, height, false);

      if (initialized) {
        for (const stone of stonesRef.current) {
          const instance = models.get(stone.id);
          if (!instance) continue;
          instance.shadow.position.x = instance.root.position.x + .04;
          instance.shadow.position.z = instance.root.position.z + .07;
        }
      }
      renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const render = (time: number) => {
      frame = 0;
      let moving = false;
      const elapsed = time - startAnimation;
      for (const [id, model] of models) {
        if (id === activeAnimationId && elapsed < 620) {
          const progress = Math.max(0, elapsed) / 620;
          model.root.position.y = model.baseY + Math.sin(progress * Math.PI) * 0.22;
          model.root.rotation.y = model.baseYaw + Math.sin(progress * Math.PI * 2) * 0.24;
          moving = true;
        } else {
          model.root.position.y = model.baseY;
          model.root.rotation.y = model.baseYaw;
        }
      }
      renderer.render(scene, camera);
      if (moving) frame = requestAnimationFrame(render);
      else activeAnimationId = undefined;
    };
    const onAnimate = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (!id || !models.has(id)) return;
      activeAnimationId = id;
      startAnimation = performance.now();
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(render);
    };
    canvas.addEventListener('asyk-animate', onAnimate);

    const raycaster = new THREE.Raycaster();
    let held: THREE.Group | undefined;
    let dragId = '';
    let startPoint = new THREE.Vector2();
    let lastPoint = new THREE.Vector2();
    let velocity = new THREE.Vector2();
    let lastMove = 0;
    let simulationFrame = 0;
    const pointerWorld = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return new THREE.Vector2((e.clientX - rect.left) / rect.width * 10 - 5,
        ((e.clientY - rect.top) / rect.height - .5) * 10 * rect.height / rect.width);
    };
    const updateShadows = () => {
      for (const m of models.values()) {
        m.shadow.position.x = m.root.position.x + .04;
        m.shadow.position.z = m.root.position.z + .07;
      }
    };
    const down = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1, -(e.clientY-rect.top)/rect.height*2+1), camera);
      const hits = raycaster.intersectObjects(modelLayer.children, true);
      if (!hits.length) return;
      let object: THREE.Object3D = hits[0].object;
      while (object.parent && object.parent !== modelLayer) object = object.parent;
      held = object as THREE.Group;
      dragId = [...models].find(([,m]) => m.root === held)?.[0] || '';
      if (simulationFrame) cancelAnimationFrame(simulationFrame);
      startPoint = pointerWorld(e); lastPoint = startPoint.clone(); velocity.set(0,0); lastMove = performance.now();
      canvas.setPointerCapture(e.pointerId); held.position.y = .18;
      e.preventDefault(); renderer.render(scene,camera);
    };
    const move = (e: PointerEvent) => {
      if (!held) return;
      const current = pointerWorld(e); const now = performance.now();
      const dt = Math.max(.016, (now-lastMove)/1000);
      velocity.copy(current).sub(lastPoint).multiplyScalar(1/dt);
      held.position.x = THREE.MathUtils.clamp(held.position.x + current.x-lastPoint.x, -4.4, 4.4);
      const limit = Math.max(.5, 5*container.clientHeight/container.clientWidth-.5);
      held.position.z = THREE.MathUtils.clamp(held.position.z + current.y-lastPoint.y, -limit, limit);
      held.rotation.y = THREE.MathUtils.clamp(velocity.x*.025,-.18,.18);
      lastPoint = current; lastMove = now; updateShadows(); renderer.render(scene,camera); e.preventDefault();
    };
    const release = (e: PointerEvent) => {
      if (!held) return;
      const object = held; held = undefined;
      const moved = lastPoint.distanceTo(startPoint) > .12;
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const velocities = new Map<THREE.Group, THREE.Vector2>();
      const v = velocity.clone();
      if (!moved || performance.now()-lastMove > 160 || reduced) v.set(0,0);
      if (v.length()>4) v.setLength(4);
      velocities.set(object,v);
      let last = performance.now(); let elapsed = 0; let collisionId = '';
      const tick = (now: number) => {
        if (disposed) return;
        const dt = Math.min(.035,(now-last)/1000); last=now; elapsed+=dt;
        object.position.y = .02 + .16*Math.exp(-elapsed*8)*Math.abs(Math.cos(elapsed*16));
        const heightLimit = Math.max(.5,5*container.clientHeight/container.clientWidth-.5);
        for (const [piece, vel] of velocities) {
          piece.position.x += vel.x*dt; piece.position.z += vel.y*dt;
          piece.position.x = THREE.MathUtils.clamp(piece.position.x,-4.4,4.4);
          piece.position.z = THREE.MathUtils.clamp(piece.position.z,-heightLimit,heightLimit);
          vel.multiplyScalar(Math.exp(-3.8*dt));
          for (const [id, other] of models) {
            if (other.root===piece) continue;
            const delta = new THREE.Vector2(other.root.position.x-piece.position.x,other.root.position.z-piece.position.z);
            const minDist = (piece.scale.x+other.root.scale.x)*.48;
            const distance = delta.length();
            if (distance>0 && distance<minDist) {
              const normal=delta.normalize(); const impulse=Math.max(0,vel.dot(normal))*.55;
              other.root.position.x += normal.x*(minDist-distance);
              other.root.position.z += normal.y*(minDist-distance);
              const otherVel=velocities.get(other.root) || new THREE.Vector2();
              otherVel.addScaledVector(normal,impulse); velocities.set(other.root,otherVel);
              vel.addScaledVector(normal,-impulse); collisionId ||= id;
            }
          }
        }
        updateShadows(); renderer.render(scene,camera);
        if (elapsed<1.2 && [...velocities.values()].some(v=>v.length()>.04)) simulationFrame=requestAnimationFrame(tick);
        else { object.position.y=.02; object.rotation.y=0; updateShadows(); renderer.render(scene,camera); canvas.dispatchEvent(new CustomEvent('asyk-landed',{bubbles:true,detail:collisionId || dragId})); }
      };
      simulationFrame=requestAnimationFrame(tick);
    };
    canvas.style.pointerEvents='auto'; canvas.style.touchAction='none';
    canvas.addEventListener('pointerdown',down); canvas.addEventListener('pointermove',move);
    canvas.addEventListener('pointerup',release); canvas.addEventListener('pointercancel',release);
    loadModel().then((gltfScene) => {
      if (disposed) return;
      for (const stone of stonesRef.current) {
        const root = new THREE.Group();
        const model = gltfScene.clone(true);
        model.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
        model.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2));
        model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(model);
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        const maxDimension = Math.max(size.x, size.y, size.z) || 1;
        const fitScale = 1 / maxDimension;
        model.position.sub(center).multiplyScalar(fitScale);
        model.scale.multiplyScalar(fitScale);
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.castShadow = false;
          object.receiveShadow = false;
          const tint = (material: THREE.Material) => {
            const copy = material.clone();
            if ('color' in copy && copy.color instanceof THREE.Color) copy.color.set(stone.color);
            if ('roughness' in copy) copy.roughness = 0.88;
            if ('metalness' in copy) copy.metalness = 0;
            return copy;
          };
          object.material = Array.isArray(object.material) ? object.material.map(tint) : tint(object.material);
        });

        const pixelWidth = container.clientWidth || 400;
        const modelWorldSize = (stone.size / pixelWidth) * worldWidth * 0.9;
        root.scale.setScalar(modelWorldSize);
        root.add(model);
        root.position.set((stone.x / 100 - 0.5) * worldWidth, 0.02, (stone.y / 100 - 0.5) * (worldWidth * container.clientHeight / pixelWidth));
        const shadow = new THREE.Mesh(
          new THREE.CircleGeometry(modelWorldSize * 0.42, 28),
          new THREE.MeshBasicMaterial({ color: 0x493722, transparent: true, opacity: 0.12, depthWrite: false }),
        );
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.set(root.position.x + 0.04, 0.005, root.position.z + 0.07);
        scene.add(shadow);
        modelLayer.add(root);
        models.set(stone.id, { root, shadow, baseY: 0.02, baseYaw: 0 });
      }
      initialized = true;
      setStatus('ready');
      resize();
      if (animateIdRef.current) {
        activeAnimationId = animateIdRef.current;
        startAnimation = performance.now();
        frame = requestAnimationFrame(render);
      }
    }).catch((error: unknown) => {
      if (disposed) return;
      setStatus('error');
      const message = error instanceof Error ? error.message : 'Asyk.glb файлын жүктеу мүмкін болмады';
      setDevError(message);
      if (import.meta.env.DEV) console.error('Asyk.glb load failed:', error);
    });

    return () => {
      disposed = true;
      canvas.removeEventListener("pointerdown",down);canvas.removeEventListener("pointermove",move);canvas.removeEventListener("pointerup",release);canvas.removeEventListener("pointercancel",release);
      canvas.removeEventListener('asyk-animate', onAnimate);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      if (simulationFrame) cancelAnimationFrame(simulationFrame);
      renderer.dispose();
      for (const model of models.values()) {
        model.root.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
            else object.material.dispose();
          }
        });
        model.shadow.geometry.dispose();
        (model.shadow.material as THREE.Material).dispose();
      }
    };
  }, []);

  useEffect(() => { onStatusChange?.(status); }, [status]);

  useEffect(() => {
    if (status !== 'ready' || !animateId) return;
    // The owning canvas effect supplies animation on load. Selection updates are signalled below.
    const canvas = canvasRef.current;
    canvas?.dispatchEvent(new CustomEvent('asyk-animate', { detail: animateId }));
  }, [animateId, status]);

  return (
    <div ref={containerRef} className={`asyk-field ${className}`} data-model-status={status} aria-hidden="true">
      <canvas ref={canvasRef} className="asyk-canvas" />
      {status === 'error' && import.meta.env.DEV && devError && <span className="model-dev-error">Asyk.glb: {devError}</span>}
    </div>
  );
}

export function AsykModel({ color, size, className = '', fallback }: { color: string; size: number; className?: string; fallback: ReactNode }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const stone: AsykStone = { id: `icon-${color}`, color, colorName: '', position: '', positionName: '', x: 50, y: 50, size };
  return (
    <span className={`asyk-model-icon ${className}`} data-model-status={status}>
      <AsykField stones={[stone]} onStatusChange={setStatus} />
      <span className="asyk-model-fallback" aria-hidden="true">{fallback}</span>
    </span>
  );
}




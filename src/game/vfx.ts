import * as THREE from 'three';

/**
 * Textes pop-up 3D "STOLEN!", "TAKEN!", "+$10,000" avec physique de recul et rebond (Bounce)
 * et particules de confettis / pièces d'or / étincelles néon.
 */
interface PopupItem {
  mesh: THREE.Sprite;
  texture: THREE.CanvasTexture;
  velocity: THREE.Vector3;
  startScale: THREE.Vector3;
  age: number;
  lifetime: number;
}

interface ParticleItem {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  gravity: number;
  rotSpeed: THREE.Vector3;
  age: number;
  lifetime: number;
}

export class VfxEngine {
  readonly group = new THREE.Group();
  private popups: PopupItem[] = [];
  private particles: ParticleItem[] = [];

  private confettiGeo = new THREE.PlaneGeometry(0.2, 0.2);
  private sparkGeo = new THREE.SphereGeometry(0.08, 6, 6);
  private coinGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.05, 8);

  private neonColors = [
    0x00ffcc, // Cyan néon
    0xff007f, // Magenta néon
    0x76ff03, // Vert Lime
    0xffd600, // Or étincelant
    0xd500f9, // Violet néon
  ];

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  /**
   * Fait pop un texte 3D cartoon ultra punchy avec physique d'éjection et rebond élastique
   */
  spawnText(
    text: string,
    pos: THREE.Vector3,
    color = '#ffd600',
    options: { size?: number; height?: number; lifetime?: number } = {},
  ): void {
    const lifetime = options.lifetime ?? 1.4;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 160;
    const ctx = canvas.getContext('2d')!;

    // Typographie cartoon avec gros contours sombres Roblox Studio (Strokes 6-8px)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 68px "Fredoka One", "Luckiest Guy", "Impact", "Segoe UI", sans-serif';

    // Ombre portée sombre décalée (Drop shadow 3D cartoon)
    ctx.lineJoin = 'round';
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#05070f';
    ctx.strokeText(text, 256, 84);

    ctx.lineWidth = 10;
    ctx.strokeStyle = '#111422';
    ctx.strokeText(text, 256, 80);

    // Remplissage avec dégradé vif néo-pop
    ctx.fillStyle = color;
    ctx.fillText(text, 256, 80);

    // Reflet blanc au centre pour effet cartoon brillant
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '900 66px "Fredoka One", "Luckiest Guy", "Impact", "Segoe UI", sans-serif';
    ctx.fillText(text, 256, 78);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      transparent: true,
    });
    const sprite = new THREE.Sprite(mat);
    const aspect = canvas.width / canvas.height;
    const h = options.height ?? 1.1;
    const targetScale = new THREE.Vector3(h * aspect, h, 1);

    // Démarrage minuscule pour l'effet de pop / explosion
    sprite.scale.set(0.01, 0.01, 1);
    sprite.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.6, (Math.random() - 0.5) * 0.4));
    this.group.add(sprite);

    // Impulsion vers le haut + légère déviation aléatoire (physique d'impact)
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 1.5,
      3.2 + Math.random() * 1.2,
      (Math.random() - 0.5) * 1.5,
    );

    this.popups.push({
      mesh: sprite,
      texture,
      velocity,
      startScale: targetScale,
      age: 0,
      lifetime,
    });
  }

  /**
   * Éclatement de confettis festifs / pièces d'or lors d'un vol ou d'un achat
   */
  burstConfetti(pos: THREE.Vector3, count = 28): void {
    for (let i = 0; i < count; i++) {
      const col = this.neonColors[Math.floor(Math.random() * this.neonColors.length)];
      const mat = new THREE.MeshBasicMaterial({
        color: col,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.confettiGeo, mat);
      mesh.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.8, (Math.random() - 0.5) * 0.5));

      const angle = Math.random() * Math.PI * 2;
      const speed = 2.5 + Math.random() * 4.5;
      const velocity = new THREE.Vector3(
        Math.cos(angle) * speed,
        4.0 + Math.random() * 4.0,
        Math.sin(angle) * speed,
      );

      this.group.add(mesh);
      this.particles.push({
        mesh,
        velocity,
        gravity: 12,
        rotSpeed: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
        age: 0,
        lifetime: 1.2 + Math.random() * 0.8,
      });
    }
  }

  /**
   * Éclatement de pièces d'or volumétriques (Cylindres or brillants)
   */
  burstCoins(pos: THREE.Vector3, count = 12): void {
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xffd600,
      metalness: 0.8,
      roughness: 0.2,
      emissive: 0xffaa00,
      emissiveIntensity: 0.3,
    });
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.coinGeo, goldMat);
      mesh.position.copy(pos).add(new THREE.Vector3(0, 0.5, 0));
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);

      const angle = Math.random() * Math.PI * 2;
      const speed = 1.8 + Math.random() * 3.2;
      const velocity = new THREE.Vector3(
        Math.cos(angle) * speed,
        3.5 + Math.random() * 3.0,
        Math.sin(angle) * speed,
      );

      this.group.add(mesh);
      this.particles.push({
        mesh,
        velocity,
        gravity: 14,
        rotSpeed: new THREE.Vector3(6, 4, 8),
        age: 0,
        lifetime: 1.0 + Math.random() * 0.5,
      });
    }
  }

  /**
   * Étincelles / fumée de fuite lors d'un vol ou sprint
   */
  spawnStealSparks(pos: THREE.Vector3): void {
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: Math.random() < 0.5 ? 0xff0055 : 0xffcc00,
      });
      const mesh = new THREE.Mesh(this.sparkGeo, mat);
      mesh.position.copy(pos).add(new THREE.Vector3(0, 0.3, 0));
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        1.5 + Math.random() * 3,
        (Math.random() - 0.5) * 5,
      );
      this.group.add(mesh);
      this.particles.push({
        mesh,
        velocity,
        gravity: 8,
        rotSpeed: new THREE.Vector3(0, 0, 0),
        age: 0,
        lifetime: 0.5 + Math.random() * 0.4,
      });
    }
  }

  update(dt: number): void {
    // 1. Mise à jour des popups de texte (avec physique de rebond / bounce)
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.age += dt;
      const progress = p.age / p.lifetime;

      if (progress >= 1) {
        p.mesh.removeFromParent();
        p.texture.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.popups.splice(i, 1);
        continue;
      }

      // Rebond élastique au démarrage (overshoot) : f(t) = sin(t * pi / 2) + overshoot
      let scaleFactor = 1;
      if (progress < 0.25) {
        const t = progress / 0.25;
        // Bounce overshoot : monte à 1.3 puis redescend à 1.0
        scaleFactor = THREE.MathUtils.lerp(0.1, 1.25, Math.sin(t * Math.PI * 0.5));
      } else if (progress < 0.4) {
        const t = (progress - 0.25) / 0.15;
        scaleFactor = THREE.MathUtils.lerp(1.25, 1.0, t);
      } else if (progress > 0.75) {
        // Disparition en fondu et réduction
        scaleFactor = THREE.MathUtils.lerp(1.0, 0.4, (progress - 0.75) / 0.25);
        (p.mesh.material as THREE.SpriteMaterial).opacity = 1 - (progress - 0.75) / 0.25;
      }

      p.mesh.scale.set(
        p.startScale.x * scaleFactor,
        p.startScale.y * scaleFactor,
        1,
      );

      // Ralentissement de la vitesse verticale
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.velocity.y *= Math.exp(-3 * dt);
      p.velocity.x *= Math.exp(-2 * dt);
      p.velocity.z *= Math.exp(-2 * dt);
    }

    // 2. Mise à jour des particules (confettis, pièces, sparks)
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const part = this.particles[i];
      part.age += dt;
      const progress = part.age / part.lifetime;

      if (progress >= 1) {
        part.mesh.removeFromParent();
        this.particles.splice(i, 1);
        continue;
      }

      // Gravité
      part.velocity.y -= part.gravity * dt;
      part.mesh.position.addScaledVector(part.velocity, dt);

      // Rebond au sol si y <= 0.05
      if (part.mesh.position.y <= 0.05) {
        part.mesh.position.y = 0.05;
        part.velocity.y = -part.velocity.y * 0.45;
        part.velocity.x *= 0.7;
        part.velocity.z *= 0.7;
      }

      part.mesh.rotation.x += part.rotSpeed.x * dt;
      part.mesh.rotation.y += part.rotSpeed.y * dt;
      part.mesh.rotation.z += part.rotSpeed.z * dt;

      // Rétrécissement vers la fin
      if (progress > 0.7) {
        const s = 1 - (progress - 0.7) / 0.3;
        part.mesh.scale.setScalar(Math.max(0.01, s));
      }
    }
  }

  dispose(): void {
    for (const p of this.popups) {
      p.mesh.removeFromParent();
      p.texture.dispose();
      (p.mesh.material as THREE.Material).dispose();
    }
    for (const part of this.particles) {
      part.mesh.removeFromParent();
    }
    this.popups = [];
    this.particles = [];
    this.group.removeFromParent();
  }
}

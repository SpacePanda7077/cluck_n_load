import { World } from "@dimforge/rapier2d-deterministic-compat";
import { NO_INPUT, PlayerInputState } from "./PlayerInput.js";
import { PhysicController } from "./Physics.js";

export interface ServerPlayerConfig {
  /** Rapier world the player lives in. YOU step it (world.step()) once per tick, after stepping the players */
  world: World;
  /** Spawn position of the feet in world px */
  x: number;
  y: number;

  /** Radius of the collider at the feet in px */
  bodyRadius?: number;
  /** Top speed in px per second. Default 200 */
  walkSpeed?: number;
  /** Speed up rate in px/s². Default 1200 */
  acceleration?: number;
  /** Slow down rate in px/s². Default 1600 */
  deceleration?: number;

  /** Speed of the dive in px per second. Default 340 */
  rollSpeed?: number;
  /** Total length of dive + roll in seconds. Default 0.8 */
  rollDuration?: number;
  /** Share of the roll spent in the air before the head touches the ground, 0..1. Default 0.4 */
  rollDiveFraction?: number;
  /** Wait after a roll before the next one, in seconds. Default 0.35 */
  rollCooldown?: number;

  /** Fire on its own while the aim button is held, at fireRate. Turn off to call applyRecoil() yourself. Default true */
  autoFire?: boolean;
  /** Shots per second while the aim button is held. Default 6 */
  fireRate?: number;
  /** How hard each shot pushes the player back, in px per second. Default 70 */
  recoilSpeed?: number;
  /** How fast recoil / knockback fades out, per second. Default 9 */
  knockDamping?: number;
  /** Cap on the total recoil / knockback speed in px per second. Default 900 */
  maxKnockSpeed?: number;
  /** How many px above the feet the gun sits, used as the origin of the aim direction.
   *  Same as (textureHeight - 105) on the client. Default 0 */
  gunHeight?: number;

  /** Called on every shot. (dirX, dirY) is the normalized aim direction. Spawn your bullet here */
  onFire?: (player: ServerPlayer, dirX: number, dirY: number) => void;
}

/** Everything a client needs to draw this player. Send it in your snapshots */
export interface ServerPlayerState {
  /** Feet position */
  x: number;
  y: number;
  /** Velocity in px per second, including recoil / knockback */
  vx: number;
  vy: number;
  /** 1 = facing right, -1 = facing left */
  facing: 1 | -1;
  rolling: boolean;
  /** 0..1 through the dive + roll, 0 when not rolling. The client draws the dive / roll from this */
  rollProgress: number;
  /** Where the player is aiming, in world px */
  aimX: number;
  aimY: number;
  /** Goes up by one on every shot. The client plays the gun kick and neck snap when it changes */
  shots: number;
}

/**
 * The gameplay half of RopePlayer with no Phaser in it, so it runs on a Node server:
 * movement, collisions, dive roll, knockback and firing with recoil.
 * Rope, eye, gun sprite, shadow, hop, neck wobble and gun kick are drawing only and stay on the client.
 */
export class ServerPlayer {
  readonly physics: PhysicController;

  /** Ground position = the feet. Mirrors the physics body */
  readonly feet = { x: 0, y: 0 };
  /** Where the player last aimed, in world px */
  readonly target = { x: 0, y: 0 };

  /** 1 = facing right, -1 = facing left */
  facing: 1 | -1 = 1;
  /** Number of shots fired so far */
  shots = 0;

  autoFire: boolean;
  fireRate: number;
  recoilSpeed: number;
  gunHeight: number;
  onFire?: (player: ServerPlayer, dirX: number, dirY: number) => void;

  private fireCooldown = 0;

  constructor(config: ServerPlayerConfig) {
    this.autoFire = config.autoFire ?? true;
    this.fireRate = config.fireRate ?? 6;
    this.recoilSpeed = config.recoilSpeed ?? 70;
    this.gunHeight = config.gunHeight ?? 0;
    this.onFire = config.onFire;

    this.feet.x = config.x;
    this.feet.y = config.y;
    this.target.x = config.x + 100;
    this.target.y = config.y;

    this.physics = new PhysicController(config.world, config.x, config.y, {
      radius: config.bodyRadius,
      maxSpeed: config.walkSpeed,
      acceleration: config.acceleration,
      deceleration: config.deceleration,
      rollSpeed: config.rollSpeed,
      rollDuration: config.rollDuration,
      rollDiveFraction: config.rollDiveFraction,
      rollCooldown: config.rollCooldown,
      knockDamping: config.knockDamping,
      maxKnockSpeed: config.maxKnockSpeed,
    });
  }

  /** True while the dive roll is playing (handy for i-frames) */
  get isRolling(): boolean {
    return this.physics.isRolling;
  }

  /**
   * Advance one tick. Call it once per server tick with this player's latest input and a fixed dt
   * (1 / tickRate), then step the Rapier world.
   * input.roll must be true for ONE tick per key press: clear it after you pass it in.
   */
  step(input: Readonly<PlayerInputState> = NO_INPUT, dt: number): void {
    if (dt <= 0) return;

    // Start a roll: move direction if there is one, otherwise the way we face
    if (input.roll && this.physics.canRoll) {
      const dx = input.moveX;
      const dy = input.moveY;
      if (dx === 0 && dy === 0) {
        this.physics.startRoll(this.facing, 0);
      } else {
        this.physics.startRoll(dx, dy);
        if (dx !== 0) this.facing = dx < 0 ? -1 : 1;
      }
    }

    // Accel / decel / roll / knockback + collisions
    this.physics.move(input.moveX, input.moveY, dt);
    this.feet.x = this.physics.position.x;
    this.feet.y = this.physics.position.y;

    const rolling = this.physics.isRolling;

    // No aiming or shooting mid-roll
    const shooting = input.aiming && !rolling;

    if (shooting) {
      this.target.x = input.aimX;
      this.target.y = input.aimY;
      const aimDx = input.aimX - this.feet.x;
      if (Math.abs(aimDx) > 8) this.facing = aimDx < 0 ? -1 : 1; // small deadzone stops flicker
    } else if (!rolling && input.moveX !== 0) {
      // Not shooting: face the way you walk sideways (up/down keeps the last facing)
      this.facing = input.moveX < 0 ? -1 : 1;
    }

    // Automatic fire while the aim button is held
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (shooting && this.autoFire && this.fireCooldown <= 0) {
      const dir = this.applyRecoil();
      if (dir) {
        this.fireCooldown = 1 / this.fireRate;
        this.onFire?.(this, dir.x, dir.y);
      }
    }
  }

  /**
   * Counts a shot and pushes the player back away from the aim.
   * Returns the normalized aim direction, or null while rolling.
   * step() calls this for you when autoFire is on. Bullets are your job.
   */
  applyRecoil(
    speed: number = this.recoilSpeed,
  ): { x: number; y: number } | null {
    if (this.physics.isRolling) return null;

    let dx = this.target.x - this.feet.x;
    let dy = this.target.y - (this.feet.y - this.gunHeight);
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      dx /= len;
      dy /= len;
    } else {
      dx = this.facing;
      dy = 0;
    }

    // Recoil goes the opposite way
    this.physics.applyKnockback(-dx, -dy, speed);
    this.shots++;
    return { x: dx, y: dy };
  }

  /** Push the player in a direction (any length). For hits, explosions, etc. Speed is in px per second */
  knockback(dirX: number, dirY: number, speed: number): this {
    this.physics.applyKnockback(dirX, dirY, speed);
    return this;
  }

  /** Push the player away from a point in world coordinates (where an enemy or explosion is) */
  knockbackFrom(x: number, y: number, speed: number): this {
    return this.knockback(this.feet.x - x, this.feet.y - y, speed);
  }

  /** Teleport the player so its feet are at (x, y) */
  setFeet(x: number, y: number): this {
    this.physics.setPosition(x, y);
    this.feet.x = x;
    this.feet.y = y;
    return this;
  }

  /** Snapshot for the network */
  getState(): ServerPlayerState {
    const p = this.physics;
    return {
      x: this.feet.x,
      y: this.feet.y,
      vx: p.velocity.x + p.knock.x,
      vy: p.velocity.y + p.knock.y,
      facing: this.facing,
      rolling: p.isRolling,
      rollProgress: p.rollProgress,
      aimX: this.target.x,
      aimY: this.target.y,
      shots: this.shots,
    };
  }

  destroy(): void {
    this.physics.destroy();
  }
}

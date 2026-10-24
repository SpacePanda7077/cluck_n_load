import {
    KinematicCharacterController,
    Collider,
    ColliderDesc,
    RigidBody,
    RigidBodyDesc,
    World,
} from "@dimforge/rapier2d-deterministic-compat";

export interface PhysicControllerOptions {
    /** Radius of the ball collider at the feet, in px. Default 20 */
    radius?: number;
    /** Top speed in px per second. Default 160 */
    maxSpeed?: number;
    /** How fast it speeds up, px/s². Default 1200 */
    acceleration?: number;
    /** How fast it slows down when there is no input, px/s². Default 1600 */
    deceleration?: number;
    /** Gap the character controller keeps from obstacles, in px. Default 0.5 */
    skin?: number;
    /** Speed of the dive (the leap through the air), px/s. Default 340 */
    rollSpeed?: number;
    /** Total length of dive + roll in seconds. Default 0.8 */
    rollDuration?: number;
    /** Share of the roll spent in the air before the head touches the ground, 0..1. Default 0.4 */
    rollDiveFraction?: number;
    /** How fast recoil / knockback fades out, per second. Default 9 */
    knockDamping?: number;
    /** Cap on the total recoil / knockback speed in px per second. Default 900 */
    maxKnockSpeed?: number;
    /** Wait after a roll before the next one, seconds. Default 0.35 */
    rollCooldown?: number;
}

/**
 * Kinematic character controller. You tell it which way you want to go,
 * it accelerates / decelerates smoothly, slides along colliders and owns the position.
 * It can also dash in a fixed direction (a dive roll) that overrides normal movement.
 * The world must be stepped every frame (world.step()) so the collider follows the body.
 */
export class PhysicController {
    world: World;
    body!: RigidBody;
    collider!: Collider;
    controller: KinematicCharacterController;

    readonly radius: number;
    maxSpeed: number;
    acceleration: number;
    deceleration: number;

    rollSpeed: number;
    rollDuration: number;
    rollDiveFraction: number;
    rollCooldown: number;

    /** Current position (the body's centre) in world px. Updated immediately by move() */
    readonly position = { x: 0, y: 0 };
    /** Current velocity in px per second */
    readonly velocity = { x: 0, y: 0 };
    /** Push from recoil / knockback in px per second. Fades out on its own, see applyKnockback() */
    readonly knock = { x: 0, y: 0 };

    /** How fast the push fades out, per second. Higher = stops sooner. Default 9 */
    knockDamping: number;
    /** Cap on the total push in px per second, so stacked pushes can't fling the player. Default 900 */
    maxKnockSpeed: number;

    private rolling = false;
    private rollElapsed = 0;
    private cooldownLeft = 0;
    private readonly rollDir = { x: 0, y: 0 };

    constructor(
        world: World,
        x: number,
        y: number,
        options: PhysicControllerOptions = {},
    ) {
        this.world = world;
        this.radius = options.radius ?? 30;
        this.maxSpeed = options.maxSpeed ?? 200;
        this.acceleration = options.acceleration ?? 1200;
        this.deceleration = options.deceleration ?? 1600;
        this.rollSpeed = options.rollSpeed ?? 440;
        this.rollDuration = options.rollDuration ?? 0.7;
        this.rollDiveFraction = options.rollDiveFraction ?? 0.6;
        this.knockDamping = options.knockDamping ?? 9;
        this.maxKnockSpeed = options.maxKnockSpeed ?? 900;
        this.rollCooldown = options.rollCooldown ?? 0.05;

        this.controller = world.createCharacterController(options.skin ?? 0.5);
        // Top-down: there is no "ground" or slopes, every surface is a wall to slide along
        this.controller.setSlideEnabled(true);
        this.controller.setMaxSlopeClimbAngle(0);
        this.controller.setMinSlopeSlideAngle(0);

        this.createBody(x, y);
    }

    createBody(x: number, y: number): void {
        if (this.body) this.world.removeRigidBody(this.body);

        this.body = this.world.createRigidBody(
            RigidBodyDesc.kinematicPositionBased().setTranslation(x, y),
        );
        this.collider = this.world.createCollider(
            ColliderDesc.ball(this.radius).setTranslation(0, -30),
            this.body,
        );
        this.position.x = x;
        this.position.y = y;
        this.velocity.x = 0;
        this.velocity.y = 0;
    }

    /** Current speed in px per second */
    get speed(): number {
        return Math.hypot(this.velocity.x, this.velocity.y);
    }

    /** True while a roll is in progress */
    get isRolling(): boolean {
        return this.rolling;
    }

    /** 0..1 through the roll, 0 when not rolling */
    get rollProgress(): number {
        return this.rolling ? this.rollElapsed / this.rollDuration : 0;
    }

    /** True when a roll can be started right now */
    get canRoll(): boolean {
        return !this.rolling && this.cooldownLeft <= 0;
    }

    /** Start a roll toward (dirX, dirY). Ignored while rolling or on cooldown */
    startRoll(dirX: number, dirY: number): void {
        if (!this.canRoll) return;
        const len = Math.hypot(dirX, dirY) || 1;
        this.rollDir.x = dirX / len;
        this.rollDir.y = dirY / len;
        this.rolling = true;
        this.rollElapsed = 0;
    }

    /**
     * Move toward the wanted direction. dirX / dirY are -1..1 (anything longer than 1 is normalized).
     * (0, 0) = no input, so it slows to a stop. While rolling, the input is ignored.
     */
    move(dirX: number, dirY: number, dt: number): void {
        if (dt <= 0) return;

        if (this.cooldownLeft > 0) this.cooldownLeft -= dt;
        if (this.rolling) {
            this.rollElapsed += dt;
            if (this.rollElapsed >= this.rollDuration) {
                this.rolling = false;
                this.cooldownLeft = this.rollCooldown;
            }
        }

        if (this.rolling) {
            // In the air the dive carries full speed. Once the head hits the ground the
            // roll scrubs the speed off, from 60% down to 10% by the end.
            const t = this.rollElapsed / this.rollDuration;
            const d = this.rollDiveFraction;
            const s =
                t < d
                    ? this.rollSpeed
                    : this.rollSpeed * (0.6 - 0.5 * ((t - d) / (1 - d)));
            this.velocity.x = this.rollDir.x * s;
            this.velocity.y = this.rollDir.y * s;
        } else {
            let len = Math.hypot(dirX, dirY);
            if (len > 1) {
                dirX /= len;
                dirY /= len;
                len = 1;
            }

            // Smooth accel / decel: approach the wanted velocity at a limited rate
            const targetX = dirX * this.maxSpeed;
            const targetY = dirY * this.maxSpeed;
            const rate = len > 0 ? this.acceleration : this.deceleration;
            const maxStep = rate * dt;

            const dx = targetX - this.velocity.x;
            const dy = targetY - this.velocity.y;
            const dist = Math.hypot(dx, dy);

            if (dist <= maxStep) {
                this.velocity.x = targetX;
                this.velocity.y = targetY;
            } else {
                this.velocity.x += (dx / dist) * maxStep;
                this.velocity.y += (dy / dist) * maxStep;
            }
        }

        // Recoil / knockback rides on top of the controlled velocity
        const totalX = this.velocity.x + this.knock.x;
        const totalY = this.velocity.y + this.knock.y;

        // Ask the character controller how far we can really go
        this.controller.computeColliderMovement(this.collider, {
            x: totalX * dt,
            y: totalY * dt,
        });
        const m = this.controller.computedMovement();

        this.position.x += m.x;
        this.position.y += m.y;
        this.body.setNextKinematicTranslation(this.position);

        // Use the real movement as the velocity, so running into a wall stops you instead of
        // storing up speed against it
        if (this.knock.x === 0 && this.knock.y === 0) {
            this.velocity.x = m.x / dt;
            this.velocity.y = m.y / dt;
        } else {
            // Both parts shrink by however much of the move a wall blocked
            const fx = Math.abs(totalX) > 1e-6 ? m.x / dt / totalX : 0;
            const fy = Math.abs(totalY) > 1e-6 ? m.y / dt / totalY : 0;
            this.velocity.x *= fx;
            this.velocity.y *= fy;
            this.knock.x *= fx;
            this.knock.y *= fy;

            // The push fades out over time
            const decay = Math.exp(-this.knockDamping * dt);
            this.knock.x *= decay;
            this.knock.y *= decay;
            if (Math.hypot(this.knock.x, this.knock.y) < 5) {
                this.knock.x = 0;
                this.knock.y = 0;
            }
        }
    }

    /**
     * Push the player away: recoil, being hit, an explosion... (dirX, dirY) is the direction the
     * player gets pushed (any length, it is normalized), speed is the push in px per second.
     * Pushes add up, fade out by knockDamping and slide along walls like normal movement.
     */
    applyKnockback(dirX: number, dirY: number, speed: number): void {
        const len = Math.hypot(dirX, dirY);
        if (len === 0 || speed === 0) return;
        this.knock.x += (dirX / len) * speed;
        this.knock.y += (dirY / len) * speed;

        // Keep stacked pushes (like fast firing) from flinging the player off
        const total = Math.hypot(this.knock.x, this.knock.y);
        if (total > this.maxKnockSpeed) {
            const s = this.maxKnockSpeed / total;
            this.knock.x *= s;
            this.knock.y *= s;
        }
    }

    /** Teleport and stop (cancels any roll) */
    setPosition(x: number, y: number): void {
        this.position.x = x;
        this.position.y = y;
        this.velocity.x = 0;
        this.velocity.y = 0;
        this.knock.x = 0;
        this.knock.y = 0;
        this.rolling = false;
        this.body.setTranslation({ x, y }, true);
    }

    destroy(): void {
        this.world.removeCharacterController(this.controller);
        this.world.removeRigidBody(this.body); // removes its collider too
    }
}


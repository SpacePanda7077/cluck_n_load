import { World } from "@dimforge/rapier2d-deterministic-compat";
import {
    GameObjects,
    Math as PMath,
    Scene,
    Scenes,
    Textures,
    Types,
} from "phaser";
import {
    NO_INPUT,
    PlayerInputSource,
    PlayerInputState,
} from "./InputController";
import { PhysicController } from "./Physics";
import { useRoomManager } from "../../store/room-manager";
import { Room } from "@colyseus/sdk";

export interface RopePlayerConfig {
    texture: string;
    frame?: string | number;
    /** World position of the container (top-center of the image) at spawn */
    x: number;
    y: number;

    isLocal?: boolean;
    /** Where the flexible section starts, as a fraction of the texture height (0 = top) */
    start?: number;
    /** Where the flexible section ends, as a fraction of the texture height */
    end?: number;
    /** Eye height as a fraction of the texture height. A target level with the eye = straight rope. Defaults to start / 2 */
    eye?: number;
    /** Points across the whole texture height (more = smoother bend) */
    segments?: number;
    /** Initial target in world coordinates. Defaults to level with the eye */
    target?: { x: number; y: number };
    /** 1 = the rope turns fully toward the target, 0.5 = half way, etc. */
    bendStrength?: number;
    /** Max total bend in degrees */
    maxAngle?: number;
    /** Flip to 1 / -1 if the rope bends the wrong way (target above the eye tilts the rope toward -x when 1) */
    bendDirection?: 1 | -1;
    /** Texture key of the eye sprite. Defaults to "face" */
    eyeTexture?: string;
    /** Optional display size of the eye sprite in px */
    eyeSize?: { width: number; height: number };
    /** Eye offset from the rope centerline in px, in the head's own frame (+x = right of the rope) */
    eyeOffsetX?: number;
    /** How quickly the bend follows the target. Higher = snappier, 0 = instant */
    smoothing?: number;
    /** Start with the idle neck sway on */
    idle?: boolean;
    /** Idle sway size in degrees either side of the target bend. Default 12 */
    idleAmplitude?: number;
    /** Idle sway cycles per second. Default 0.5 (one full left-right-left every 2s) */
    idleSpeed?: number;
    /** When false the neck stays straight and the eye looks straight ahead. Default true */
    lookAtTarget?: boolean;
    debug?: boolean;

    /** Rapier world the player's character controller lives in. The scene must step it every frame */
    world: World;
    /** Where the player gets its input from. Can also be set later with player.input = ... */
    input?: PlayerInputSource;
    /** Radius of the collider at the feet in px. Default 20 */
    bodyRadius?: number;
    /** Top speed in px per second. Default 160 */
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
    /** How high the dive leaps, as a fraction of the character's half height. Default 0.5 */
    diveLift?: number;
    /** How far the neck curls during the roll, in degrees. Default 110 */
    neckCurl?: number;
    /** Fire on its own while the aim button is held, at fireRate. Turn off to call applyRecoil() yourself. Default true */
    autoFire?: boolean;
    /** Shots per second while the aim button is held. Default 6 */
    fireRate?: number;
    /** Called on every shot (spawn your bullet here) */
    onFire?: (player: RopePlayer) => void;
    /** How hard each shot snaps the neck back, in radians per second. 0 = neck ignores recoil. Default 9 */
    neckRecoil?: number;
    /** Neck spring stiffness. Higher = bounces back faster. Default 180 */
    neckStiffness?: number;
    /** Neck spring damping. Lower = wobbles longer, goofier. Default 7 */
    neckDamping?: number;
    /** How hard each shot pushes the player back, in px per second. Default 70 */
    recoilSpeed?: number;
    /** How far the gun slides back on each shot, in px. Default 18 */
    gunKickDistance?: number;
    /** How fast the gun returns after a shot, per second. Higher = snappier. Default 16 */
    gunKickRecovery?: number;
    /** How fast recoil / knockback fades out, per second. Default 9 */
    knockDamping?: number;
    /** Cap on the total recoil / knockback speed in px per second. Default 900 */
    maxKnockSpeed?: number;
    /** Wait after a roll before the next one, in seconds. Default 0.35 */
    rollCooldown?: number;
    /** Shadow opacity on the ground. Default 0.3 */
    shadowAlpha?: number;
    /** Nudge the shadow up/down if the image has bottom padding. Default 0 */
    shadowOffsetY?: number;
}

export class RopePlayer {
    /** Holds the rope, eye sprite and debug overlay. Its position / scale are driven by the movement logic */
    readonly container: GameObjects.Container;
    readonly rope: GameObjects.Rope;
    /** Sprite that sits on the bent rope at the eye and looks at the target */
    readonly eyeRect: GameObjects.Sprite;
    /** Ground shadow under the feet */
    readonly shadow: GameObjects.Ellipse;
    /** Moves the player: smooth accel / decel + collisions + roll. Tweak maxSpeed / rollSpeed etc. on it */
    readonly physics: PhysicController;

    /** Target in WORLD coordinates. Set it directly or tween it (targets: player.target) */
    readonly target = new PMath.Vector2();

    /** Ground position = bottom-center of the character (where the feet are). Mirrors the physics body */
    readonly feet = new PMath.Vector2();

    /** Source of movement / aim input. null = the player stands still */
    input: PlayerInputSource | null;

    /** Flexible section, as fractions of the texture height */
    start: number;
    end: number;
    /** Eye height as a fraction of the texture height (level target = straight rope) */
    eye: number;

    bendStrength: number;
    maxAngle: number;
    bendDirection: 1 | -1;
    eyeOffsetX: number;
    smoothing: number;

    /** Toggle the idle neck sway. It blends in and out smoothly (driven by the movement logic every frame) */
    idle: boolean;
    idleAmplitude: number;
    idleSpeed: number;

    /** True = neck bends and eye looks toward the target. False = neck straight, eye looks ahead */
    lookAtTarget: boolean;

    shadowAlpha: number;
    shadowOffsetY: number;

    /** How high the dive leaps, as a fraction of the character's half height */
    diveLift: number;
    /** How far the neck curls during the roll, in degrees */
    neckCurl: number;
    /** Fire on its own while the aim button is held, at fireRate */
    autoFire: boolean;
    /** Shots per second while the aim button is held */
    fireRate: number;
    /** Called on every shot (spawn your bullet here) */
    onFire?: (player: RopePlayer) => void;
    /** How hard each shot snaps the neck back, in radians per second */
    neckRecoil: number;
    /** Neck spring stiffness. Higher = bounces back faster */
    neckStiffness: number;
    /** Neck spring damping. Lower = wobbles longer */
    neckDamping: number;
    /** How hard each shot pushes the player back, in px per second */
    recoilSpeed: number;
    /** How far the gun slides back on each shot, in px */
    gunKickDistance: number;
    /** How fast the gun returns after a shot, per second */
    gunKickRecovery: number;

    debug: boolean;

    private scene: Scene;
    private textureHeight: number;
    private currentAngle = 0; // radians, 0 = straight up, positive = toward +x
    private eyeAngle = 0; // radians, local rotation of the eye sprite
    private swayPhase = 0; // radians, accumulated so speed changes never cause a jump
    private swayWeight = 0; // 0 = no sway, 1 = full sway
    private debugGfx?: GameObjects.Graphics;
    private readonly worldMatrix = new GameObjects.Components.TransformMatrix();
    private readonly localTarget = new PMath.Vector2();

    // Movement presentation state
    private facing: 1 | -1 = 1; // 1 = right, -1 = left
    private walkTime = 0;
    private walkWeight = 0; // 0 = standing, 1 = walking (eased so the bounce settles smoothly)
    private rollSpin: 1 | -1 = 1; // direction the roll spins
    private rollBend = 0; // radians, extra neck curl while rolling
    private gunKick = 0; // px the gun is currently pushed back, fades to 0
    private fireCooldown = 0; // seconds until the next automatic shot
    private neckRecoilAngle = 0; // radians, extra neck bend from the recoil spring (+ = toward the aim)
    private neckRecoilVel = 0; // radians per second
    private readonly gunBase = { x: 0, y: 105 }; // where the gun rests inside the container
    private readonly gunWorld = new PMath.Vector2();
    gun: GameObjects.Rectangle;
    isLocal: boolean;

    constructor(scene: Scene, config: RopePlayerConfig) {
        this.scene = scene;

        this.start = config.start ?? 0.25;
        this.end = config.end ?? 0.5;
        this.eye = config.eye ?? this.start / 2;
        this.bendStrength = config.bendStrength ?? 1;
        this.maxAngle = config.maxAngle ?? 60;
        this.bendDirection = config.bendDirection ?? 1;
        this.eyeOffsetX = config.eyeOffsetX ?? 0;
        this.smoothing = config.smoothing ?? 12;
        this.idle = config.idle ?? false;
        this.idleAmplitude = config.idleAmplitude ?? 12;
        this.idleSpeed = config.idleSpeed ?? 0.5;
        this.lookAtTarget = config.lookAtTarget ?? true;
        this.debug = config.debug ?? false;
        this.input = config.input ?? null;
        this.shadowAlpha = config.shadowAlpha ?? 0.3;
        this.shadowOffsetY = config.shadowOffsetY ?? 0;
        this.diveLift = config.diveLift ?? 0.5;
        this.neckCurl = config.neckCurl ?? 110;
        this.autoFire = config.autoFire ?? true;
        this.fireRate = config.fireRate ?? 6;
        this.onFire = config.onFire;
        this.neckRecoil = config.neckRecoil ?? 12;
        this.neckStiffness = config.neckStiffness ?? 180;
        this.neckDamping = config.neckDamping ?? 7;
        this.recoilSpeed = config.recoilSpeed ?? 70;
        this.gunKickDistance = config.gunKickDistance ?? 18;
        this.gunKickRecovery = config.gunKickRecovery ?? 16;

        this.isLocal = config.isLocal ?? false;

        const eyeTexture = config.eyeTexture ?? "face";
        for (const key of [config.texture, eyeTexture]) {
            if (!scene.textures.exists(key)) {
                throw new Error(
                    `RopePlayer: texture "${key}" isn't loaded. ` +
                        `Check the key matches your this.load.image(...) call and that loading has finished before create().`,
                );
            }
        }
        const frame = scene.textures.getFrame(config.texture, config.frame);
        this.textureHeight = frame.realHeight;

        // Feet = bottom-center of the image
        this.feet.set(config.x, config.y + this.textureHeight);

        // Physics body sits at the feet
        this.physics = new PhysicController(
            config.world,
            this.feet.x,
            this.feet.y,
            {
                radius: config.bodyRadius,
                maxSpeed: config.walkSpeed,
                acceleration: config.acceleration,
                deceleration: config.deceleration,
                rollSpeed: config.rollSpeed,
                rollDuration: config.rollDuration,
                rollDiveFraction: config.rollDiveFraction,
                knockDamping: config.knockDamping,
                maxKnockSpeed: config.maxKnockSpeed,
                rollCooldown: config.rollCooldown,
            },
        );

        // Default target: level with the eye, so the rope starts straight
        this.target.set(
            config.target?.x ?? config.x + 100,
            config.target?.y ?? config.y + this.eye * this.textureHeight,
        );

        // Shadow on the ground under the feet (lives outside the container so it stays on the ground)
        this.shadow = scene.add
            .ellipse(
                this.feet.x,
                this.feet.y + this.shadowOffsetY,
                frame.realWidth * 0.7,
                frame.realWidth * 0.25,
                0x000000,
            )
            .setAlpha(this.shadowAlpha);

        // Typings want Vector2Like[]; real positions are set in updatePoints()
        const segments = config.segments ?? 100;
        const initialPoints: Types.Math.Vector2Like[] = [];
        for (let i = 0; i < segments; i++) {
            initialPoints.push({ x: 0, y: 0 });
        }

        // Everything lives in the container at local (0, 0)
        this.container = scene.add.container(config.x, config.y);

        // horizontal = false -> vertical texture

        this.rope = scene.add.rope(
            0,
            0,
            config.texture,
            config.frame,
            initialPoints,
            false,
        );

        this.eyeRect = scene.add.sprite(0, 0, eyeTexture);
        this.gun = scene.add
            .rectangle(this.gunBase.x, this.gunBase.y, 80, 20, 0xff0000)
            .setOrigin(0.25, 0.5);
        if (config.eyeSize) {
            this.eyeRect.setDisplaySize(
                config.eyeSize.width,
                config.eyeSize.height,
            );
        }

        // Order = draw order inside the container: rope, then eye, then debug on top
        this.container.add([this.rope, this.eyeRect, this.gun]);

        if (this.debug) {
            this.debugGfx = scene.add.graphics();
            this.container.add(this.debugGfx);
        }

        this.updateMovement(0, NO_INPUT);
        this.updatePoints(true);

        scene.events.once(Scenes.Events.SHUTDOWN, this.destroy, this);
    }

    /** Teleport the player so its feet are at (x, y) */
    setFeet(x: number, y: number): this {
        this.physics.setPosition(x, y);
        this.feet.set(x, y);
        return this;
    }

    setTarget(x: number, y: number): this {
        this.target.set(x, y);
        return this;
    }

    /** Current bend in degrees (0 = straight, positive = toward +x) */
    get bendAngle(): number {
        return PMath.RadToDeg(this.currentAngle);
    }

    /** -1 = facing left, 1 = facing right */
    get facingDirection(): 1 | -1 {
        return this.facing;
    }

    /** True while the dive roll is playing (handy for i-frames) */
    get isRolling(): boolean {
        return this.physics.isRolling;
    }

    update(_time: number, delta: number, input: PlayerInputState): void {
        this.updateMovement(delta / 1000, input);
        this.updatePoints(false, delta);
    }

    update_gun_angle(shooting: boolean) {
        const angle = PMath.Angle.Between(
            this.gun.x,
            this.gun.y,
            this.localTarget.x,
            this.localTarget.y,
        );
        const base = shooting ? angle : 0.3;

        // Kick back: the gun slides backwards along its aim and the muzzle climbs a little
        const k = this.gunKick;
        this.gun.setRotation(base - k * 0.012);
        this.gun.setPosition(
            this.gunBase.x - Math.cos(base) * k,
            this.gunBase.y - Math.sin(base) * k,
        );
    }

    /**
     * Call this when the player fires. Pushes the player back away from the aim, kicks the gun back
     * and returns true. Does nothing and returns false while rolling.
     * Bullets are your job, this only does the recoil and the animation.
     */
    applyRecoil(
        speed: number = this.recoilSpeed,
        kick: number = this.gunKickDistance,
    ): boolean {
        if (this.physics.isRolling) return false;

        // Aim direction on the ground = from the gun to the target in world space
        this.container.getWorldTransformMatrix(this.worldMatrix);
        this.worldMatrix.transformPoint(
            this.gunBase.x,
            this.gunBase.y,
            this.gunWorld,
        );
        const dx = this.target.x - this.gunWorld.x;
        const dy = this.target.y - this.gunWorld.y;

        // Recoil goes the opposite way
        this.physics.applyKnockback(-dx, -dy, speed);
        this.gunKick = kick;

        // The head snaps back away from the aim, then wobbles on its spring
        this.neckRecoilVel -= this.neckRecoil;
        return true;
    }

    /**
     * Push the player in a direction (any length). For hits, explosions, etc. Speed is in px per second.
     * The head lags behind the push and wobbles back.
     */
    knockback(dirX: number, dirY: number, speed: number): this {
        this.physics.applyKnockback(dirX, dirY, speed);

        const len = Math.hypot(dirX, dirY);
        if (len > 0) {
            // Screen direction -> neck bend (the neck bends toward the way the player faces)
            const kick = Math.min(speed * 0.02, 12);
            this.neckRecoilVel -= (dirX / len) * this.facing * kick;
        }
        return this;
    }

    /** Push the player away from a point in world coordinates (where an enemy or explosion is) */
    knockbackFrom(x: number, y: number, speed: number): this {
        return this.knockback(this.feet.x - x, this.feet.y - y, speed);
    }

    private updateMovement(dt: number, input: PlayerInputState): void {
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
            this.rollSpin = this.facing;
        }

        // The physics controller does the actual moving (accel / decel / roll + collisions).
        // We only say which way we want to go, then follow where it put us.
        this.physics.move(input.moveX, input.moveY, dt);
        this.feet.set(this.physics.position.x, this.physics.position.y);

        const rolling = this.physics.isRolling;

        // Walking = actually moving, so pushing against a wall doesn't hop on the spot
        const walking = this.physics.speed > 10 && !rolling;
        if (walking) this.walkTime += dt;

        // No aiming or shooting mid-roll
        const shooting = input.aiming && !rolling;

        if (shooting) {
            // The aim decides where the neck bends and which way the character faces
            this.setTarget(input.aimX, input.aimY);
            const aimDx = input.aimX - this.feet.x;
            if (Math.abs(aimDx) > 8) this.facing = aimDx < 0 ? -1 : 1; // small deadzone stops flicker
        } else if (!rolling && input.moveX !== 0) {
            // Not shooting: face the way you walk sideways (up/down keeps the last facing)
            this.facing = input.moveX < 0 ? -1 : 1;
        }
        // Automatic fire while the aim button is held: every shot recoils and kicks the gun
        this.fireCooldown = Math.max(0, this.fireCooldown - dt);
        if (shooting && this.autoFire && this.fireCooldown <= 0) {
            if (this.applyRecoil()) {
                this.fireCooldown = 1 / this.fireRate;
                this.onFire?.(this);
            }
        }

        // Neck recoil spring: underdamped, so the neck overshoots and wobbles back to rest
        const springDt = Math.min(dt, 1 / 30);
        this.neckRecoilVel +=
            (-this.neckStiffness * this.neckRecoilAngle -
                this.neckDamping * this.neckRecoilVel) *
            springDt;
        this.neckRecoilAngle = PMath.Clamp(
            this.neckRecoilAngle + this.neckRecoilVel * springDt,
            -1.4,
            1.4,
        );

        // The gun kick fades back to rest
        this.gunKick *= Math.exp(-this.gunKickRecovery * dt);
        if (this.gunKick < 0.05) this.gunKick = 0;
        this.update_gun_angle(shooting);
        this.gun.setVisible(!rolling);

        this.lookAtTarget = shooting;
        this.idle = !shooting && !rolling; // neck sways when standing and when walking

        // Ease in and out of the walk so the bounce settles instead of snapping
        this.walkWeight +=
            ((walking ? 1 : 0) - this.walkWeight) * (1 - Math.exp(-10 * dt));

        // Goofier neck sway while walking: bigger and faster, eased by walkWeight so it never pops
        this.idleAmplitude = PMath.Linear(12, 30, this.walkWeight);
        this.idleSpeed = PMath.Linear(0.5, 3, this.walkWeight);

        // Bounce: 3 hops per second, 0..1 (off during the roll)
        const hop = rolling
            ? 0
            : Math.abs(Math.sin(this.walkTime * Math.PI * 3)) * this.walkWeight;

        // Slight stretch at the top of the hop. The size never changes during the roll.
        // Scale is about the top-center of the image, so y is set from the feet to keep them planted.
        const scaleY = 1 + hop * 0.1;
        const half = (this.textureHeight * scaleY) / 2;

        // Dive + roll presentation. The body is treated as a stiff rod that rotates about its middle:
        //   dive (in the air): leaps up and tips head first until the head touches the ground
        //   roll (on the ground): rolls on over the head and back up onto the feet
        // angle = 0 is standing, PI/2 is horizontal with the head leading.
        const p = this.physics.rollProgress;
        const diveEnd = this.physics.rollDiveFraction;
        let tilt = 0; // how far the body has rotated, 0..2PI
        let lift = 0; // extra height above the ground from the leap, px
        const landHeight = half * 0.12; // middle of the body when it lies on the ground
        let centerHeight = half; // height of the body's middle above the ground
        this.rollBend = 0;
        if (rolling) {
            if (p < diveEnd) {
                const u = p / diveEnd; // 0..1 through the dive
                tilt = (Math.PI / 2) * PMath.Easing.Quadratic.In(u);
                lift = Math.sin(u * Math.PI) * half * this.diveLift;
                // A rod that touches the ground sits half its height up when upright and almost
                // on the ground when horizontal, plus the leap on top.
                centerHeight =
                    landHeight +
                    (half - landHeight) * Math.abs(Math.cos(tilt)) +
                    lift;
            } else {
                const v = (p - diveEnd) / (1 - diveEnd); // 0..1 through the roll
                tilt =
                    Math.PI / 2 +
                    ((Math.PI * 3) / 2) * PMath.Easing.Sine.Out(v);
                // Stays low on the ground the whole roll (no bounce), then eases up onto the feet
                centerHeight =
                    landHeight + (half - landHeight) * PMath.Easing.Sine.In(v);
                // The neck does the rolling: it curls over toward the roll and unwinds again
                this.rollBend =
                    Math.sin(v * Math.PI) * PMath.DegToRad(this.neckCurl);
            }
        }
        const angle = this.rollSpin * tilt;

        const c = this.container;
        c.setScale(this.facing, scaleY);
        c.setRotation(angle);

        // Rotate about the middle of the body instead of the top-center origin.
        // Standing (angle 0, no hop) this reduces to feet.y - textureHeight * scaleY, so normal
        // movement looks the same as before.
        const pivotX = this.feet.x;
        const pivotY = this.feet.y - centerHeight - hop * 10;
        c.x = pivotX + Math.sin(angle) * half;
        c.y = pivotY - Math.cos(angle) * half;

        // Shadow stays on the ground; it shrinks and fades while the character is in the air
        const air = Math.min(lift / half, 1);
        this.shadow.setPosition(this.feet.x, this.feet.y + this.shadowOffsetY);
        this.shadow.setScale(1 - hop * 0.2 - air * 0.3);
        this.shadow.setAlpha(this.shadowAlpha * (1 - hop * 0.3 - air * 0.4));

        // Top-down depth sorting: lower on screen draws in front, shadow just behind
        c.setDepth(this.feet.y);
        this.shadow.setDepth(this.feet.y - 1);
    }

    private updatePoints(instant = false, delta = 16): void {
        const points = this.rope.points;
        const n = points.length;
        if (n < 2) return;

        const dt = delta / 1000;
        const H = this.textureHeight;

        const yStart = PMath.Clamp(Math.min(this.start, this.end), 0, 1) * H;
        const yEnd = PMath.Clamp(Math.max(this.start, this.end), 0, 1) * H;
        const zoneLen = Math.max(yEnd - yStart, 0.001);

        // Target in the container's local space. This handles move / scale / rotation / flip,
        // so the world-space target keeps working while you bounce the container around.
        this.container.getWorldTransformMatrix(this.worldMatrix);
        this.worldMatrix.applyInverse(
            this.target.x,
            this.target.y,
            this.localTarget,
        );
        const lt = this.localTarget;

        // Elevation of the target as seen from the eye (rest pose):
        // 0 = level, +90deg = straight above, -90deg = straight below
        const elevation = Math.atan2(this.eye * H - lt.y, Math.abs(lt.x));

        // Level target -> bend = 0 -> rope stays vertically straight
        const maxRad = PMath.DegToRad(this.maxAngle);
        const bend = this.lookAtTarget
            ? PMath.Clamp(
                  -elevation * this.bendStrength * this.bendDirection,
                  -maxRad,
                  maxRad,
              )
            : 0;

        // Idle sway: left/right swing added on top of the target bend, blended in and out
        this.swayPhase += Math.PI * 2 * this.idleSpeed * dt;
        const blend = instant ? 1 : 1 - Math.exp(-4 * dt);
        this.swayWeight += ((this.idle ? 1 : 0) - this.swayWeight) * blend;
        const sway =
            Math.sin(this.swayPhase) *
            PMath.DegToRad(this.idleAmplitude) *
            this.swayWeight;

        const wanted = PMath.Clamp(bend + sway, -maxRad, maxRad);

        const k =
            instant || this.smoothing <= 0
                ? 1
                : 1 - Math.exp(-this.smoothing * dt);
        this.currentAngle += (wanted - this.currentAngle) * k;

        // The roll curl and the recoil wobble go on top of the normal bend and aren't limited by maxAngle
        const phi = this.currentAngle + this.rollBend + this.neckRecoilAngle;
        const curvature = phi / zoneLen; // turn per unit length along the flexible section

        // Position of the tip of the flexible section (where the head begins)
        const tipX = Math.abs(phi) < 1e-4 ? 0 : (1 - Math.cos(phi)) / curvature;
        const tipY =
            yEnd - (Math.abs(phi) < 1e-4 ? zoneLen : Math.sin(phi) / curvature);

        // Position and heading of the rope's centerline at texture height y.
        // Heading = angle from straight up, positive toward +x. Returns the heading.
        const place = (y: number, out: { x: number; y: number }): number => {
            if (y >= yEnd) {
                // Body below the flexible section: stays put
                out.x = 0;
                out.y = y;
                return 0;
            }

            const s = yEnd - y; // distance above the anchor along the rope

            if (s <= zoneLen) {
                // Flexible section: circular arc with total turn phi
                if (Math.abs(phi) < 1e-4) {
                    out.x = 0;
                    out.y = y;
                } else {
                    const a = curvature * s;
                    out.x = (1 - Math.cos(a)) / curvature;
                    out.y = yEnd - Math.sin(a) / curvature;
                }
                return curvature * s;
            }

            // Head above the flexible section: straight, rotated by phi
            const extra = s - zoneLen;
            out.x = tipX + Math.sin(phi) * extra;
            out.y = tipY - Math.cos(phi) * extra;
            return phi;
        };

        for (let i = 0; i < n; i++) {
            place((i / (n - 1)) * H, points[i]);
        }

        // Eye: sits on the bent rope (container-local), then rotates to look at the target
        const eyePos = { x: 0, y: 0 };
        const heading = place(this.eye * H, eyePos);
        const eyeX = eyePos.x + Math.cos(heading) * this.eyeOffsetX;
        const eyeY = eyePos.y + Math.sin(heading) * this.eyeOffsetX;
        this.eyeRect.setPosition(eyeX, eyeY);

        // Look at the target, or straight ahead (local +x) when not tracking
        const wantedEye = this.lookAtTarget
            ? Math.atan2(lt.y - eyeY, lt.x - eyeX)
            : 0;
        this.eyeAngle += PMath.Angle.Wrap(wantedEye - this.eyeAngle) * k;
        this.eyeRect.setRotation(this.eyeAngle);

        this.rope.setDirty();
        this.drawDebug(yStart, yEnd);
    }

    private drawDebug(yStart: number, yEnd: number): void {
        const g = this.debugGfx;
        if (!g) return;
        g.clear();

        // Everything here is in container-local coordinates

        // Rope points
        g.lineStyle(1, 0x00ff00, 0.8);
        g.beginPath();
        this.rope.points.forEach((p, i) =>
            i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y),
        );
        g.strokePath();
        g.fillStyle(0x00ff00, 1);
        this.rope.points.forEach((p) => g.fillCircle(p.x, p.y, 2));

        // Flexible section limits (start = blue, end/anchor = orange) on the straight rope
        g.fillStyle(0x3399ff, 1).fillCircle(0, yStart, 5);
        g.fillStyle(0xffaa00, 1).fillCircle(0, yEnd, 5);

        // Eye (rest pose) and the level line through it
        const eyeRestY = this.eye * this.textureHeight;
        g.fillStyle(0xcc66ff, 1).fillCircle(0, eyeRestY, 5);
        g.lineStyle(1, 0xcc66ff, 0.5);
        g.lineBetween(-150, eyeRestY, 150, eyeRestY);

        // Target
        g.fillStyle(0xff3333, 1).fillCircle(
            this.localTarget.x,
            this.localTarget.y,
            6,
        );
    }

    destroy(): void {
        this.scene.events.off(Scenes.Events.UPDATE, this.update, this);
        this.physics.destroy();
        // Destroys the rope, eye sprite and debug overlay with it
        this.container.destroy();
        this.shadow.destroy();
    }
}


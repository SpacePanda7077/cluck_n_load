import { World } from "@dimforge/rapier2d-deterministic-compat";
import { Scene, Scenes } from "phaser";
import { EventBus } from "../EventBus";
import { RopePlayer } from "../../game-components/Player/Player";
import {
    InputController,
    NO_INPUT,
} from "../../game-components/Player/InputController";
import { RapierDebugDrawer } from "../../game-components/utils/Rapier-Debug";
import { useRoomManager } from "../../store/room-manager";
import { Room, Predict } from "@colyseus/sdk";
import { MoveInput } from "../../game-components/shared/MoveInput";

export class Game extends Scene {
    private predict!: Predict;
    player: RopePlayer;
    inputController: InputController;
    world: World;
    debug: RapierDebugDrawer;
    room: Room;
    cir: Phaser.GameObjects.Arc;

    constructor() {
        super("Game");
    }

    preload() {
        this.load.setPath("assets");
        this.load.image("chicken", "characters/default1/chicken1.png");
        this.load.image("face", "characters/default1/chicken_face.png");
    }

    create() {
        // RAPIER.init() must have finished before this scene starts (e.g. in your boot / preloader)
        this.room = useRoomManager.getState().room as Room;
        this.world = new World({ x: 0, y: 0 }); // top-down, no gravity
        this.events.once(Scenes.Events.SHUTDOWN, () => this.world.free());
        const input = this.room.input({ type: MoveInput });
        console.log(
            "tickRate:",
            input.tickRate,
            "stepSeconds:",
            input.stepSeconds,
        );
        this.predict = Predict.get(this.room, { mode: "lerp", delay: 100 });
        this.world.timestep = input.stepSeconds!;
        this.inputController = new InputController(this, this.room);
        this.debug = new RapierDebugDrawer(this, this.world);
        this.cir = this.add.circle(0, 0, 30, 0xfff000);

        // (x, y) is the top-center of the image at spawn
        this.player = new RopePlayer(this, {
            texture: "chicken",
            x: 400,
            y: 200,
            start: 0.55,
            end: 0.75,
            eye: 0.5, // level with this = straight
            bendDirection: 1, // use -1 if it bends the wrong way
            maxAngle: 60,
            idle: true,
            lookAtTarget: false, // only tracks the mouse while shooting
            world: this.world,
            input: this.inputController,
            isLocal: true,
            debug: false,
        });

        // Keeps the rope visible when the container is mirrored (scaleX = -1)
        // this.player.rope.hideCCW = false;
        const self = this.room.state.Players.get(this.room.sessionId);
        console.log("self:", self);
        if (!self) {
            throw new Error("local player not in state yet");
        }
        const me = this.predict.reconciler(self, {
            input, // the handle from room.input({ type: MoveInput })
            step: (ctx, s, cmd) => {
                // same pure applyInput the server runs
                // applyInput(s, cmd, ctx.dt);
            },
            //  smoothMs: 25,
            // optional: smoothMs, fields, etc.
        });
        EventBus.emit("current-scene-ready", this);
    }

    update(time: number, delta: number): void {
        // The player already queued its move for this frame (its UPDATE listener runs before this method).
        // Stepping here lets the collider catch up so the next frame sees the new position.
        const steps = this.predict.tick();
        if (steps !== 1) console.log("steps this frame:", steps);
        for (let i = 0; i < steps; i++) {
            const input = this.inputController.read() ?? NO_INPUT;
            this.inputController.setRoomData(input);
            this.player.update(time, 1000 / 30, input);
            this.world.step();
        }

        for (const [, p] of this.room.state.Players) {
            this.cir.setPosition(
                this.predict.value(p, "x"),
                this.predict.value(p, "y"),
            ); // ONE read idiom, local + remote
        }

        this.debug.update();

        // TODO: spawn bullets here when this.inputController.read().aiming is true
    }
}

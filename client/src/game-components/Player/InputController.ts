import { Room } from "@colyseus/sdk";
import { Input, Scene } from "phaser";
import { MoveInput } from "../shared/MoveInput";

/** What the player wants to do this frame, independent of where it came from (keyboard, gamepad, AI, replay...) */
export interface PlayerInputState {
    /** -1 (left) .. 1 (right) */
    moveX: number;
    /** -1 (up) .. 1 (down) */
    moveY: number;
    /** True while the aim / shoot button is held */
    aiming: boolean;
    /** Aim position in WORLD coordinates */
    aimX: number;
    aimY: number;
    /** True only on the frame the roll button was pressed */
    roll: boolean;
}

export interface PlayerInputSource {
    read(): PlayerInputState;
    getSeq(): number;
}

export const NO_INPUT: Readonly<PlayerInputState> = {
    moveX: 0,
    moveY: 0,
    aiming: false,
    aimX: 0,
    aimY: 0,
    roll: false,
};

export interface InputBindings {
    up: number;
    down: number;
    left: number;
    right: number;
    roll: number;
}

type MoveKeys = Record<keyof InputBindings, Input.Keyboard.Key>;

/** Keyboard (WASD + Space to roll by default) + mouse input. Owns the keys and the pointer, knows nothing about the player */
export class InputController implements PlayerInputSource {
    private readonly keys: MoveKeys;
    private readonly pointer: Input.Pointer;
    // Reused every frame so reading input doesn't allocate
    private readonly state: PlayerInputState = { ...NO_INPUT };
    seq = 0;
    room: Room<any, any>;
    inputHandle: import("@colyseus/sdk").InputHandle<
        {
            moveX: number;
            moveY: number;
            aiming: boolean;
            aimX: number;
            aimY: number;
            roll: boolean;
        } & {} & import("@colyseus/schema").Schema<any> &
            import("@colyseus/schema").Schema<unknown>
    >;

    constructor(scene: Scene, room: Room, bindings?: Partial<InputBindings>) {
        const codes = Input.Keyboard.KeyCodes;
        this.room = room;
        this.keys = scene.input.keyboard!.addKeys({
            up: bindings?.up ?? codes.W,
            down: bindings?.down ?? codes.S,
            left: bindings?.left ?? codes.A,
            right: bindings?.right ?? codes.D,
            roll: bindings?.roll ?? codes.SPACE,
        }) as MoveKeys;
        this.pointer = scene.input.activePointer;
        this.inputHandle = room.input({ type: MoveInput });
    }

    read(): PlayerInputState {
        const s = this.state;
        s.moveX =
            (this.keys.right.isDown ? 1 : 0) - (this.keys.left.isDown ? 1 : 0);
        s.moveY =
            (this.keys.down.isDown ? 1 : 0) - (this.keys.up.isDown ? 1 : 0);
        s.aiming = this.pointer.isDown;
        s.aimX = this.pointer.worldX;
        s.aimY = this.pointer.worldY;
        s.roll = Input.Keyboard.JustDown(this.keys.roll);

        return s;
    }
    getSeq(): number {
        return this.seq;
    }
    setRoomData(state: PlayerInputState) {
        const input = this.inputHandle;
        input.data.moveX = state.moveX;
        input.data.moveY = state.moveY;
        input.data.aimX = state.aimX;
        input.data.aimY = state.aimY;
        input.data.aiming = state.aiming;
        input.data.roll = state.roll;
        input.send();
    }

    /** expose for reconciler */
    getInputHandle() {
        return this.inputHandle;
    }
}


import { Room, Client, CloseCode, StepContext } from "colyseus";
import { GameRoomState, Player } from "./schema/GameRoomState.js";
import { ServerPlayer } from "../components/Player/Player.js";
import RAPIER from "../rapier.js";
import {
  ClientPlayerInputState,
  PlayerInputState,
} from "../components/Player/PlayerInput.js";

import { MoveInput } from "../components/shared/MoveInput.js";

const { World } = RAPIER;
export class GameRoom extends Room<{ state: GameRoomState }> {
  maxClients = 4;
  state = new GameRoomState();
  players: Map<string, ServerPlayer> = new Map();

  client_inputs = this.defineInput(MoveInput, { bufferMaxSize: 128 });

  messages = {
    inputs: (client: Client, message: ClientPlayerInputState) => {
      /**
       * Handle "yourMessageType" message.
       */
      const id = client.sessionId;
    },
  };
  world: RAPIER.World;

  onCreate(options: any) {
    /**
     * Called when a new room is created.
     */

    this.world = new World({ x: 0, y: 0 });
    this.setFixedTimestep((ctx) => this.step(ctx), 30);
  }

  step(ctx: StepContext) {
    for (const [sid, p] of this.state.Players) {
      const cmd = this.client_inputs.get(sid).next(); // oldest pending input, or undefined
      const player = this.players.get(sid);
      if (!player) continue;
      console.log(cmd);
      if (cmd) {
        player.step(cmd, ctx.dt);
        const state = player.getState();
        p.x = state.x;
        p.y = state.y;
      }
    }
    this.world.step();
  }

  onJoin(client: Client, options: any) {
    /**
     * Called when a client joins the room.
     */
    const id = client.sessionId;

    const player = new ServerPlayer({ world: this.world, x: 400, y: 300 });
    this.players.set(id, player);

    const schemaPlayer = new Player();
    schemaPlayer.x = 400;
    schemaPlayer.y = 300;
    this.state.Players.set(id, schemaPlayer);

    console.log(id, "joined!");
  }

  onLeave(client: Client, code: CloseCode) {
    /**
     * Called when a client leaves the room.
     */
    console.log(client.sessionId, "left!", code);
  }

  onDispose() {
    /**
     * Called when the room is disposed.
     */
    console.log("room", this.roomId, "disposing...");
  }
}

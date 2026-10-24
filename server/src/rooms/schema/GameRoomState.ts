import { schema, t, type SchemaType } from "@colyseus/schema";

export const Player = schema(
  {
    x: t.number().default(0),
    y: t.number().default(0),
  },
  "Player",
);
export type Player = SchemaType<typeof Player>;
export const GameRoomState = schema(
  {
    Players: t.map(Player),
  },
  "GameRoomState",
);
export type GameRoomState = SchemaType<typeof GameRoomState>;

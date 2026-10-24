// shared/MoveInput.ts
import { schema, t, type SchemaType } from "@colyseus/schema";

export const MoveInput = schema({
    moveX: t.number(),
    moveY: t.number(),
    aiming: t.boolean(),
    aimX: t.number(),
    aimY: t.number(),
    roll: t.boolean(),
});
export type MoveInput = SchemaType<typeof MoveInput>;


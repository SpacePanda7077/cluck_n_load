/** What the player wants to do this frame, independent of where it came from (keyboard, gamepad, network, AI, replay...) */
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
}

export const NO_INPUT: Readonly<PlayerInputState> = {
  moveX: 0,
  moveY: 0,
  aiming: false,
  aimX: 0,
  aimY: 0,
  roll: false,
};

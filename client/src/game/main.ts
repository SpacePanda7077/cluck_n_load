import { Boot } from "./scenes/Boot";
import { Game as MainGame } from "./scenes/Game";
import { AUTO, Game, Scale, Types } from "phaser";

// Find out more information about the Game Config at:
// https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig
const config: Types.Core.GameConfig = {
    type: AUTO,
    scale: {
        mode: Scale.ENVELOP,
        autoCenter: Scale.CENTER_BOTH,
        width: 1920,
        height: 1080,
    },

    parent: "game-container",
    backgroundColor: "#028af8",
    scene: [Boot, MainGame],
};

const StartGame = (parent: string) => {
    return new Game({ ...config, parent });
};

export default StartGame;

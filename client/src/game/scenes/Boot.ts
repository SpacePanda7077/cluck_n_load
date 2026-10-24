import { Scene } from "phaser";
import { EventBus } from "../EventBus";
import { init } from "@dimforge/rapier2d-deterministic-compat";

export class Boot extends Scene {
    constructor() {
        super("Boot");
    }

    preload() {
        this.load.setPath("assets");
    }

    create() {
        EventBus.emit("current-scene-ready", this);
        this.initializeRapier();
    }
    async initializeRapier() {
        await init().then(() => {
            this.scene.start("Game");
        });
    }
}

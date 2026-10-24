import { useEffect, useRef } from "react";
import { IRefPhaserGame, PhaserGame } from "./PhaserGame";
import { Client } from "@colyseus/sdk";
import { useRoom } from "@colyseus/react";
import { useRoomManager } from "./store/room-manager";
const client = new Client("http://localhost:2567");
function App() {
    const setRoom = useRoomManager((s) => s.setRoom);
    //  References to the PhaserGame component (game and scene are exposed)
    const phaserRef = useRef<IRefPhaserGame | null>(null);

    const { room, isConnecting, error } = useRoom(() =>
        client.joinOrCreate("game_room"),
    );

    useEffect(() => {
        if (room) {
            setRoom(room);
        }
    }, [room]);
    if (isConnecting) return <p>Connecting...</p>;
    return (
        <div id="app">
            <PhaserGame ref={phaserRef} />
            <div></div>
        </div>
    );
}

export default App;

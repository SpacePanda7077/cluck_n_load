import { Room } from "@colyseus/sdk";
import { create } from "zustand";

type rooms = {
    seatReserveCode: string | null;
    room: Room | null;
    setRoom: (room: Room | null) => void;
    setSeatReserveCode: (seatReserveCode: string | null) => void;
};

export const useRoomManager = create<rooms>((set) => ({
    seatReserveCode: null,
    room: null,
    setRoom: (room) => set({ room }),
    setSeatReserveCode: (seatReserveCode) => set({ seatReserveCode }),
}));


const ws = new WebSocket(`wss://${location.host}${location.search}`);
export default ws;

export let sendWsEvent = (_: WsEvent) => {};
ws.onopen = () => {
	sendWsEvent = (ev: WsEvent) => ws.send(JSON.stringify(ev));
};

export type Message = { type: string; id: string; name: string; msg: string };

export type WsEvent = { roomId: string } & (
	| {
			type: "server:join";
			id: string;
			name: string;
			ownerName: string;
	  }
	| {
			type: "server:leave";
			id: string;
			name: string;
	  }
	| {
			type: "room:full";
			id: string;
	  }
	| {
			type: "room:join";
			id: string;
			name: string;
	  }
	| ({
			type: "chat:msg";
	  } & Message)
	| {
			type: "action:rename";
			name: string;
	  }
	| {
			type: "action:toggle-cam";
			isOn: boolean;
	  }
	| {
			type: "action:toggle-mic";
			isOn: boolean;
	  }
	| {
			type: "action:call-hangup";
			name: string;
	  }
	| {
			type: "action:call-offer";
			offer: RTCSessionDescriptionInit;
	  }
	| {
			type: "action:call-cancel";
	  }
	| {
			type: "action:call-restart";
	  }
	| {
			type: "action:call-answer";
			answer: RTCSessionDescriptionInit;
	  }
	| {
			type: "action:call-ice-offer";
			candidate: RTCIceCandidateInit;
	  }
	| {
			type: "action:call-ice-answer";
			candidate: RTCIceCandidateInit;
	  }
);

import { useCallback, forwardRef, useEffect, useRef, useState } from "react";
import ws, { type Message, type WsEvent, sendWsEvent } from "./ws";
import Chat from "./Chat";
import IconButton from "./IconButton";

const ICE_SERVERS: RTCConfiguration = {
	iceServers: [
		{
			urls: [
				"stun:stun.l.google.com:19302",
				"stun:stun1.l.google.com:19302",
				"stun:stun2.l.google.com:19302",
			],
		},
	],
};

const CALL_ICONS = {
	"in-call": "",
	incoming: "",
	calling: "",
	none: "",
} as const;

const ANIMATION = {
	incoming: "animate-vibrate",
	calling: "animate-spin",
} as const;

export default function VideoCall() {
	const pc = useRef<RTCPeerConnection>(null);
	const localVideo = useRef<HTMLVideoElement>(null);
	const localStream = useRef<MediaStream>(null);
	const remoteVideo = useRef<HTMLVideoElement>(null);
	const remoteStream = useRef(new MediaStream());
	const autoAnswer = useRef(false);

	const [prefersDark, setPrefersDark] = useState(
		matchMedia("(prefers-color-scheme: dark)").matches,
	);
	const [id, setId] = useState("");
	const [roomId, setRoomId] = useState("");
	const [name, setName] = useState("");
	const [guest, setGuest] = useState("Them");
	const [chat, setChat] = useState<Message[]>([]);
	const [chatVisible, setChatVisible] = useState(true);
	const [unreadMsgs, setUnreadMsgs] = useState(0);
	const [camOn, setCamOn] = useState(false);
	const [micOn, setMicOn] = useState(false);
	const [remoteCamOn, setRemoteCamOn] = useState(false);
	const [remoteMicOn, setRemoteMicOn] = useState(false);
	const [callState, setCallState] = useState<keyof typeof CALL_ICONS>("none");

	const initRemoteVideo = useCallback(() => {
		if (!remoteVideo.current) return;
		remoteVideo.current.srcObject = remoteStream.current;

		for (const track of remoteStream.current.getVideoTracks()) {
			track.enabled = remoteCamOn;
		}

		for (const track of remoteStream.current.getAudioTracks()) {
			track.enabled = remoteMicOn;
		}
	}, [remoteCamOn, remoteMicOn]);

	const onAnswer = useCallback(
		async (message: MessageEvent<string>) => {
			if (!pc.current || !remoteVideo.current) return;
			const ev: WsEvent = JSON.parse(message.data);

			switch (ev.type) {
				case "server:join": {
					setId(ev.id);
					setRoomId(ev.roomId);
					setName(ev.name);
					if (ev.ownerName) setGuest(ev.ownerName);
					const url = new URL(location.href);
					url.searchParams.set("room", ev.roomId);
					history.pushState(null, "", url);
					break;
				}
				case "server:leave": {
					sendServerMessage(`${ev.name} left`);
					if (callState === "in-call") closeConnection();
					break;
				}
				case "room:full": {
					sendServerMessage("Room was full");
					break;
				}
				case "room:join": {
					sendServerMessage(`${ev.name} joined`);
					break;
				}
				case "chat:msg": {
					setChat((c) => [...c, ev]);
					if (!chatVisible) setUnreadMsgs((n) => n + 1);
					break;
				}
				case "action:rename": {
					setGuest(ev.name);
					break;
				}
				case "action:toggle-cam": {
					setRemoteCamOn(ev.isOn);
					break;
				}
				case "action:toggle-mic": {
					setRemoteMicOn(ev.isOn);
					break;
				}
				case "action:call-hangup": {
					closeConnection();
					break;
				}
				case "action:call-offer": {
					const offerDescription = ev.offer;
					await pc.current.setRemoteDescription(
						new RTCSessionDescription(offerDescription),
					);
					if (autoAnswer.current) {
						autoAnswer.current = false;
						answerCall();
					} else {
						setCallState("incoming");
					}
					break;
				}
				case "action:call-cancel": {
					closeConnection();
					break;
				}
				case "action:call-restart": {
					closeConnection();
					initCall();
					break;
				}
				case "action:call-ice-offer": {
					await pc.current.addIceCandidate(new RTCIceCandidate(ev.candidate));
					break;
				}
				case "action:call-answer": {
					const answerDescription = new RTCSessionDescription(ev.answer);
					await pc.current.setRemoteDescription(answerDescription);
					setCallState("in-call");
					initRemoteVideo();
					break;
				}
				case "action:call-ice-answer": {
					const candidate = new RTCIceCandidate(ev.candidate);
					await pc.current.addIceCandidate(candidate);
				}
			}
		},
		[chatVisible, callState, initRemoteVideo],
	);

	const onMessage = useCallback((msg: Message) => {
		setChat((c) => [...c, msg]);

		return () => {
			pc.current?.close();
		};
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies:
	useEffect(() => {
		if (prefersDark) {
			document.documentElement.classList.toggle("dark");
		}

		pc.current = new RTCPeerConnection(ICE_SERVERS);
	}, []);

	useEffect(() => initRemoteVideo(), [initRemoteVideo]);

	useEffect(() => {
		if (!pc.current) return;

		pc.current.ontrack = addRemoteTracks;
		ws.onmessage = onAnswer;
	}, [onAnswer]);

	useEffect(() => {
		if (!name || !roomId) return;
		sendWsEvent({ type: "action:rename", roomId, name });
	}, [name, roomId]);

	function sendServerMessage(msg: string) {
		setChat((c) => [
			...c,
			{
				type: "server:msg",
				id: "SERVER",
				name: "",
				msg,
			},
		]);
	}

	function toggleChat() {
		if (!chatVisible) {
			setUnreadMsgs(0);
		}

		setChatVisible(!chatVisible);
	}

	async function requestMedia() {
		if (localStream.current) return localStream.current;

		const devices = await navigator.mediaDevices.enumerateDevices();
		localStream.current = await navigator.mediaDevices.getUserMedia({
			audio: devices.some((d) => d.kind === "audioinput"),
			video: devices.some((d) => d.kind === "videoinput"),
		});
		addPCTracks();

		// Restart the call to send the remote stream when
		// the camera was enabled during or after the call offer
		switch (callState) {
			// biome-ignore lint/suspicious/noFallthroughSwitchClause: falls through
			case "in-call":
				autoAnswer.current = true;
			case "incoming":
				sendWsEvent({ roomId, type: "action:call-restart" });
				break;
			case "calling":
				cancelCall();
				initCall();
				break;
		}

		return localStream.current;
	}

	async function toggleCam() {
		if (!pc.current || !localVideo.current) return;

		if (camOn) {
			localVideo.current.srcObject = null;
			sendWsEvent({ roomId, type: "action:toggle-cam", isOn: false });
			return setCamOn(false);
		}

		localStream.current = await requestMedia();
		localVideo.current.srcObject = localStream.current;
		sendWsEvent({ roomId, type: "action:toggle-cam", isOn: true });
		setCamOn(true);
	}

	async function toggleMic() {
		localStream.current = await requestMedia();
		for (const track of localStream.current.getAudioTracks()) {
			track.enabled = !micOn;
		}

		sendWsEvent({ roomId, type: "action:toggle-mic", isOn: !micOn });
		setMicOn(!micOn);
	}

	async function copyRoomURL() {
		const url = new URL(location.href);
		url.searchParams.set("room", roomId);
		await navigator.clipboard.writeText(url.toString());
	}

	function toggleTheme() {
		document.documentElement.classList.toggle("dark");
		setPrefersDark(!prefersDark);
	}

	async function handleCall() {
		switch (callState) {
			case "in-call":
				return hangup();
			case "incoming":
				return answerCall();
			case "calling":
				return cancelCall();
			case "none":
				return initCall();
		}
	}

	async function initCall() {
		if (!pc.current) return;

		pc.current.onicecandidate = (event) => {
			if (event.candidate) {
				sendWsEvent({
					roomId,
					type: "action:call-ice-offer",
					candidate: event.candidate.toJSON(),
				});
			}
		};

		const offerDescription = await pc.current.createOffer({
			offerToReceiveAudio: true,
			offerToReceiveVideo: true,
		});
		await pc.current.setLocalDescription(offerDescription);

		const offer = {
			sdp: offerDescription.sdp,
			type: offerDescription.type,
		};

		setCallState("calling");
		sendWsEvent({ roomId, type: "action:call-offer", offer });
	}

	function cancelCall() {
		closeConnection();
		sendWsEvent({ roomId, type: "action:call-cancel" });
	}

	async function answerCall() {
		if (!pc.current || !remoteVideo.current) return;

		pc.current.onicecandidate = (event) => {
			if (event.candidate) {
				sendWsEvent({
					roomId,
					type: "action:call-ice-answer",
					candidate: event.candidate.toJSON(),
				});
			}
		};

		const answerDescription = await pc.current.createAnswer();
		await pc.current.setLocalDescription(answerDescription);
		setCallState("in-call");

		const answer = {
			type: answerDescription.type,
			sdp: answerDescription.sdp,
		};

		sendWsEvent({ roomId, type: "action:call-answer", answer });
		initRemoteVideo();
	}

	function closeConnection() {
		if (!pc.current) return;

		if (remoteVideo.current) {
			remoteVideo.current.srcObject = null;
		}

		pc.current.close();
		setCallState("none");

		pc.current = new RTCPeerConnection(ICE_SERVERS);
		pc.current.ontrack = addRemoteTracks;
		ws.onmessage = onAnswer;
		addPCTracks();
	}

	function hangup() {
		closeConnection();
		sendWsEvent({ roomId, type: "action:call-hangup", name: "Unknown" });
	}

	function addPCTracks() {
		if (!pc.current || !localStream.current) return;

		for (const track of localStream.current.getTracks()) {
			if (track.kind === "audio") {
				track.enabled = micOn;
			}
			pc.current.addTrack(track, localStream.current);
		}
	}

	function addRemoteTracks(event: RTCTrackEvent) {
		if (!remoteStream.current) return;

		for (const track of event.streams[0].getTracks()) {
			remoteStream.current.addTrack(track);
		}
	}

	return (
		<div
			className={`w-dvw h-dvh grid grid-rows-[auto_1fr_auto] ${chatVisible ? "grid-cols-[1fr_300px]" : "grid-cols-[1fr_0px]"} transition-all max-md:grid-cols-1 bg-gradient-to-r from-white via-zinc-200 to-white dark:from-black dark:via-zinc-900 dark:to-black text-zinc-900 dark:text-white overflow-hidden font-sans`}
		>
			<header className="grid grid-cols-[1fr_auto_auto_auto_auto] max-xs:grid-cols-[auto_auto_auto_1fr_auto] transition-all gap-2 md:col-span-2 justify-between items-center z-1 py-2 px-2 bg-zinc-200 dark:bg-zinc-800 relative">
				<h1 className="text-2xl text-blue-600 dark:text-lime-400 tracking-tight font-black inline">
					<strong className="max-sm:hidden">QuickMeet</strong>
					<strong className="sm:hidden">QM</strong>
				</h1>
				<button
					type="button"
					className="cursor-pointer flex items-center gap-2 px-3 py-2 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white font-semibold rounded-sm shadow-sm transform transition-transform hover:bg-zinc-200 dark:hover:bg-zinc-600 hover:shadow-md focus:outline-none"
					onClick={copyRoomURL}
				>
					<i></i> <span className="max-md:hidden">Share meeting</span>
				</button>
				<IconButton
					icon={prefersDark ? "" : ""}
					className="rounded-sm text-base px-2 w-full h-full min-w-[36px]"
					onClick={toggleTheme}
				/>
				<input
					type="text"
					className={`bg-white text-zinc-900 dark:bg-zinc-700 dark:text-white border-none rounded transition-all ${chatVisible ? "p-2 min-w-14 max-w-49" : "p-0 max-w-0"}`}
					placeholder="Your Name"
					onBlur={(e) =>
						e.currentTarget.value &&
						e.currentTarget.value !== name &&
						setName(e.currentTarget.value)
					}
				/>
				<IconButton
					icon=""
					className="max-md:flex rounded-sm text-base px-2 w-full h-full min-w-[36px] relative"
					onClick={toggleChat}
				>
					<strong
						className={`absolute top-0 left-0 text-red-500 text-shadow ${unreadMsgs > 0 ? "visible" : "invisible"}`}
					>
						{unreadMsgs}
					</strong>
				</IconButton>
				<span className="absolute bottom-0 left-0 w-full h-0.75 bg-gradient-to-r from-blue-600 to-fuchsia-700 dark:from-lime-400 dark:to-pink-400" />
			</header>

			<main className="grid grid-cols-1 min-xl:grid-cols-2 gap-4 py-4 px-8">
				<VideoCam
					ref={localVideo}
					color="var(--color-blue-600)"
					colorDark="var(--color-lime-500)"
					label="You"
					muted
				/>
				<VideoCam
					ref={remoteVideo}
					color="var(--color-fuchsia-700)"
					colorDark="var(--color-pink-400)"
					label={guest}
				/>
			</main>

			<Chat
				chat={chat}
				id={id}
				name={name}
				roomId={roomId}
				visible={chatVisible}
				onMessage={onMessage}
				onClearChat={() => setChat([])}
			/>

			<footer className="flex gap-12 mx-auto mb-8">
				<IconButton
					icon={CALL_ICONS[callState]}
					onClick={handleCall}
					color="bg-rose-800 text-white hover:bg-rose-700 dark:bg-rose-500 dark:hover:bg-rose-400"
					animation={ANIMATION[callState]}
				/>
				<IconButton icon={micOn ? "" : ""} onClick={toggleMic} />
				<IconButton icon={camOn ? "" : ""} onClick={toggleCam} />
			</footer>
		</div>
	);
}

type VideoCamProps = {
	color: string;
	colorDark: string;
	label: string;
	muted?: boolean;
};

const VideoCam = forwardRef<HTMLVideoElement, VideoCamProps>(
	({ color, colorDark, label, muted }, ref) => {
		return (
			<div
				style={
					{
						"--vcam-color": color,
						"--vcam-color-dark": colorDark,
					} as React.CSSProperties
				}
				className="relative h-full bg-zinc-200 dark:bg-zinc-900 rounded-md shadow-2xl overflow-hidden border-3 border-(--vcam-color) dark:border-(--vcam-color-dark)"
			>
				<video
					ref={ref}
					autoPlay
					playsInline
					muted={muted}
					className="absolute w-full h-full top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 object-contain transition-all duration-300"
				/>
				<div className="absolute bottom-2 left-2 bg-white dark:bg-black text-(--vcam-color) dark:text-(--vcam-color-dark) px-3 py-1 rounded-md text-xs font-semibold">
					{label}
				</div>
			</div>
		);
	},
);

import { useCallback } from "react";
import { type Message, sendWsEvent } from "./ws";
import IconButton from "./IconButton";

type ChatProps = {
	chat: Message[];
	id: string;
	name: string;
	roomId: string;
	visible: boolean;
	onClearChat: () => void;
	onMessage: (msg: Message) => void;
};

export default function Chat({
	chat,
	id,
	name,
	roomId,
	visible,
	onClearChat,
	onMessage,
}: ChatProps) {
	const handleSendMessage = useCallback(
		(e: React.FormEvent<HTMLFormElement>) => {
			e.preventDefault();
			type FormElements<U extends string> = HTMLFormControlsCollection &
				Record<U, HTMLInputElement>;
			const elements = e.currentTarget.elements as FormElements<"message">;
			const msg = elements.message.value.trim();

			if (msg) {
				onMessage({ type: "chat:msg", id, name, msg });
				sendWsEvent({ roomId, type: "chat:msg", id, name, msg });
				elements.message.value = "";
			}
		},
		[id, roomId, name, onMessage],
	);

	return (
		<div
			className={`grid grid-rows-[1fr_auto] gap-2 bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-white px-2 py-2 row-span-2 z-0 relative w-full max-w-80 max-md:z-1 max-md:absolute max-md:right-0 max-md:top-[calc(56px-0.75*var(--spacing))] max-md:h-[calc(100dvh-56px+0.75*var(--spacing))] max-md:transition-transform ${visible ? "max-md:translate-x-0" : "max-md:translate-x-full"} font-sans`}
		>
			<div className="absolute top-0 left-0 w-0.75 max-w-0.75 h-full bg-gradient-to-b from-[#902fc9] to-blue-600 dark:from-[#eb909c] dark:to-lime-400" />
			<div className="flex-1 overflow-auto">
				{chat.map((message) => (
					<div
						key={message.id}
						className={
							message.type === "server:msg"
								? "px-2 py-1 bg-indigo-950/10 dark:bg-teal-200/10"
								: undefined
						}
					>
						{message.type === "chat:msg" ? (
							<>
								<strong
									className={
										id === message.id
											? "text-blue-600 dark:text-lime-500"
											: "text-fuchsia-700 dark:text-pink-300"
									}
								>
									{message.name}:
								</strong>{" "}
								{message.msg}
							</>
						) : (
							<em className="text-violet-600 dark:text-yellow-300 ">
								{message.msg}
							</em>
						)}
					</div>
				))}
			</div>
			<form
				onSubmit={handleSendMessage}
				className="grid grid-cols-[1fr_auto] gap-2 items-center"
			>
				<input
					name="message"
					type="text"
					className="p-2 bg-white text-zinc-900 dark:bg-zinc-700 dark:text-white border-none rounded min-w-0"
					placeholder="Type a message..."
				/>
				<IconButton
					type="submit"
					icon=""
					color="bg-blue-600 hover:bg-blue-800 text-white dark:bg-lime-500 dark:hover:bg-lime-200 dark:text-black"
					className="rounded-sm text-base px-2 w-full h-full"
				/>
			</form>

			<IconButton
				onClick={onClearChat}
				icon=""
				color="bg-rose-800 hover:bg-rose-700 text-white dark:bg-rose-500 dark:hover:bg-rose-400"
				className="rounded-sm text-base px-2 py-1 mt-2 w-full"
			>
				Clear chat
			</IconButton>
		</div>
	);
}

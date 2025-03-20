type IconButtonProps = React.PropsWithChildren<{
	onClick?: React.MouseEventHandler;
	icon: string;
	className?: string;
	type?: HTMLButtonElement["type"];
	color?: string;
	animation?: string;
}>;

export default function IconButton({
	onClick,
	className = "",
	children,
	icon,
	color,
	type = "button",
	animation,
}: IconButtonProps) {
	return (
		<button
			type={type}
			onClick={onClick}
			className={`cursor-pointer w-12 h-12 text-xl flex gap-2 items-center justify-center rounded-full ${color ?? "bg-white hover:bg-zinc-200 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-900 dark:text-white"} transition-all duration-300 shadow-lg active:scale-90 ${className}`}
		>
			<i className={animation}>{icon}</i> {children}
		</button>
	);
}

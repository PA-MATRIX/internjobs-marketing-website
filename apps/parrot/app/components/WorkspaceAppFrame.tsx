interface WorkspaceAppFrameProps {
	src: string;
	title: string;
}

export function WorkspaceAppFrame({ src, title }: WorkspaceAppFrameProps) {
	return (
		<div className="h-full min-h-[560px] bg-white">
			<iframe
				src={src}
				title={title}
				className="h-full w-full border-0"
				allow="camera; microphone; fullscreen; clipboard-read; clipboard-write; display-capture"
				referrerPolicy="strict-origin-when-cross-origin"
			/>
		</div>
	);
}

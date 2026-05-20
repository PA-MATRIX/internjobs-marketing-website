// v1.3.1 BACKFILL: TipTap-based rich text editor for ComposePane.
//
// Lifted from apps/agentic-inbox/app/components/RichTextEditor.tsx but
// rewritten to drop the @cloudflare/kumo dependency — Parrot uses plain
// Tailwind + lucide-react throughout (see InboxPane.tsx, WorkspaceShell.tsx)
// and isn't going to take on Kumo just for a compose form.
//
// Functional surface preserved:
//   - StarterKit + Underline + Link + Image extensions
//   - Bold/Italic/Underline/Strike/Bullets/Numbered/Blockquote/Link buttons
//   - Two-way binding via { value, onChange }
//   - Focus at start on mount (so cursor lands above quoted text)

import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TiptapImage from "@tiptap/extension-image";
import LinkExtension from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
	Bold,
	Italic,
	Link2,
	Link2Off,
	List,
	ListOrdered,
	Quote,
	Redo,
	Strikethrough,
	Underline as UnderlineIcon,
	Undo,
} from "lucide-react";
import { useCallback, useEffect } from "react";

interface RichTextEditorProps {
	value: string;
	onChange: (value: string) => void;
}

interface ToolbarButtonProps {
	active?: boolean;
	disabled?: boolean;
	onClick: () => void;
	"aria-label": string;
	children: React.ReactNode;
}

function ToolbarButton({
	active,
	disabled,
	onClick,
	"aria-label": ariaLabel,
	children,
}: ToolbarButtonProps) {
	return (
		<button
			type="button"
			aria-label={ariaLabel}
			disabled={disabled}
			onClick={onClick}
			className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
				active
					? "bg-slate-200 text-slate-900"
					: "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
			} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
		>
			{children}
		</button>
	);
}

export default function RichTextEditor({
	value,
	onChange,
}: RichTextEditorProps) {
	const editor = useEditor({
		extensions: [
			StarterKit,
			Underline,
			TextAlign.configure({ types: ["heading", "paragraph"] }),
			LinkExtension.configure({ openOnClick: false }),
			TiptapImage,
			TextStyle,
			Color,
			Highlight.configure({ multicolor: true }),
		],
		content: value,
		editorProps: {
			attributes: {
				class:
					"prose prose-sm max-w-none focus:outline-none min-h-[180px] p-3 text-sm",
			},
		},
		onUpdate: ({ editor }) => {
			onChange(editor.getHTML());
		},
	});

	useEffect(() => {
		if (editor && !editor.isDestroyed && value !== editor.getHTML()) {
			editor.commands.setContent(value);
			const rafId = requestAnimationFrame(() => {
				if (!editor.isDestroyed) {
					editor.commands.focus("start");
				}
			});
			return () => cancelAnimationFrame(rafId);
		}
	}, [value, editor]);

	const setLink = useCallback(() => {
		if (!editor) return;
		const previousUrl = editor.getAttributes("link").href as string | undefined;
		const url = window.prompt("URL", previousUrl ?? "");
		if (url === null) return;
		if (url === "") {
			editor.chain().focus().extendMarkRange("link").unsetLink().run();
			return;
		}
		editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
	}, [editor]);

	if (!editor) return null;

	return (
		<div className="rounded-md border border-slate-200 overflow-hidden flex flex-col">
			{/* Toolbar */}
			<div className="flex flex-wrap items-center gap-0.5 bg-slate-50 px-2 py-1.5 border-b border-slate-200 shrink-0">
				<ToolbarButton
					active={editor.isActive("bold")}
					onClick={() => editor.chain().focus().toggleBold().run()}
					aria-label="Bold"
				>
					<Bold size={14} />
				</ToolbarButton>
				<ToolbarButton
					active={editor.isActive("italic")}
					onClick={() => editor.chain().focus().toggleItalic().run()}
					aria-label="Italic"
				>
					<Italic size={14} />
				</ToolbarButton>
				<ToolbarButton
					active={editor.isActive("underline")}
					onClick={() => editor.chain().focus().toggleUnderline().run()}
					aria-label="Underline"
				>
					<UnderlineIcon size={14} />
				</ToolbarButton>
				<ToolbarButton
					active={editor.isActive("strike")}
					onClick={() => editor.chain().focus().toggleStrike().run()}
					aria-label="Strikethrough"
				>
					<Strikethrough size={14} />
				</ToolbarButton>

				<div className="mx-1 h-5 w-px bg-slate-200" />

				<ToolbarButton
					active={editor.isActive("bulletList")}
					onClick={() => editor.chain().focus().toggleBulletList().run()}
					aria-label="Bullet list"
				>
					<List size={14} />
				</ToolbarButton>
				<ToolbarButton
					active={editor.isActive("orderedList")}
					onClick={() => editor.chain().focus().toggleOrderedList().run()}
					aria-label="Numbered list"
				>
					<ListOrdered size={14} />
				</ToolbarButton>

				<div className="mx-1 h-5 w-px bg-slate-200" />

				<ToolbarButton
					active={editor.isActive("blockquote")}
					onClick={() => editor.chain().focus().toggleBlockquote().run()}
					aria-label="Blockquote"
				>
					<Quote size={14} />
				</ToolbarButton>
				<ToolbarButton
					active={editor.isActive("link")}
					onClick={setLink}
					aria-label="Link"
				>
					<Link2 size={14} />
				</ToolbarButton>
				{editor.isActive("link") && (
					<ToolbarButton
						onClick={() => editor.chain().focus().unsetLink().run()}
						aria-label="Remove link"
					>
						<Link2Off size={14} />
					</ToolbarButton>
				)}

				<div className="mx-1 h-5 w-px bg-slate-200" />

				<ToolbarButton
					disabled={!editor.can().undo()}
					onClick={() => editor.chain().focus().undo().run()}
					aria-label="Undo"
				>
					<Undo size={14} />
				</ToolbarButton>
				<ToolbarButton
					disabled={!editor.can().redo()}
					onClick={() => editor.chain().focus().redo().run()}
					aria-label="Redo"
				>
					<Redo size={14} />
				</ToolbarButton>
			</div>

			{/* Editor content */}
			<div className="bg-white">
				<EditorContent editor={editor} />
			</div>
		</div>
	);
}

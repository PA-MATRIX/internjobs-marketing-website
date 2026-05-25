// v1.3.1 BACKFILL: simple attachment list for the InboxPane reader.
//
// Lifted from apps/agentic-inbox/app/components/EmailAttachmentList.tsx
// but rewritten in Tailwind (no @cloudflare/kumo). The attachment URL
// shape mirrors agentic-inbox — /api/inbox/messages/:emailId/attachments/:id
// — and v1.4 Phase 23-03 ATTACH-DOWN-01..03 finally ships the matching
// GET endpoint on the Workspace Worker (apps/parrot/workers/routes/attachments.ts).
// The chip below is now a fully functional <a href download> anchor.

import { FileText, Image as ImageIcon, Paperclip } from "lucide-react";
import type { Attachment } from "~/lib/api";

interface EmailAttachmentListProps {
	emailId: string;
	attachments?: Attachment[];
	className?: string;
	showHeading?: boolean;
}

function formatBytes(bytes: number | undefined): string {
	if (!bytes || bytes < 0) return "";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function EmailAttachmentList({
	emailId,
	attachments,
	className,
	showHeading = false,
}: EmailAttachmentListProps) {
	const files = (attachments ?? []).filter(
		(att) => att.disposition !== "inline",
	);
	if (files.length === 0) return null;

	return (
		<div className={className}>
			{showHeading && (
				<div className="flex items-center gap-2 mb-2">
					<Paperclip size={13} className="text-slate-500" />
					<span className="text-xs font-medium text-slate-700">
						{files.length} attachment{files.length !== 1 ? "s" : ""}
					</span>
				</div>
			)}
			<div className="flex flex-wrap gap-2">
				{files.map((att) => {
					const isImage = att.mimetype?.startsWith("image/");
					const url = `/api/inbox/messages/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(att.id)}`;
					return (
						<a
							key={att.id}
							href={url}
							download={att.filename}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 no-underline transition-colors hover:bg-slate-50"
						>
							{isImage ? (
								<ImageIcon size={13} className="text-slate-500" />
							) : (
								<FileText size={13} className="text-slate-500" />
							)}
							<span className="font-medium truncate max-w-[180px]">
								{att.filename}
							</span>
							<span className="text-slate-500">
								{formatBytes(att.size)}
							</span>
						</a>
					);
				})}
			</div>
		</div>
	);
}

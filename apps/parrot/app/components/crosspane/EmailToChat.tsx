// v1.2 Phase 13 Wave 2: EmailToChat — moves an email thread into a
// Mattermost channel seeded with the email body.
//
// On success: stashes the channel URL for future native deep-link support
// and navigates to /chat.
//
// Skills referenced:
//   cloudflare/skills: agents-sdk

import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "~/lib/api";

interface Props {
	emailId: string;
}

export function EmailToChat({ emailId }: Props) {
	const navigate = useNavigate();

	const action = useMutation({
		mutationFn: () => api.crosspaneEmailToChat(emailId),
		onSuccess: (data) => {
			if (data.ok && data.channel_url) {
				sessionStorage.setItem(
					"parrot_crosspane_channel_url",
					data.channel_url,
				);
				navigate("/chat");
			}
		},
	});

	const errorMessage =
		action.isError || (action.data && !action.data.ok)
			? action.data && !action.data.ok
				? (action.data.reason ?? "Move to Chat failed")
				: "Move to Chat failed"
			: null;

	return (
		<div className="inline-flex flex-col gap-1">
			<button
				type="button"
				onClick={() => action.mutate()}
				disabled={action.isPending || !emailId}
				title="Move this email thread into a Mattermost channel"
				className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
			>
				{action.isPending ? "Moving…" : "Move to Chat"}
			</button>
			{errorMessage && (
				<span className="text-xs text-red-600">{errorMessage}</span>
			)}
		</div>
	);
}

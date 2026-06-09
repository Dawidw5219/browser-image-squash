import { useEffect, useRef, useState } from "react";

interface Props {
	logs: string[];
}

export function Logs({ logs }: Props) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLPreElement>(null);

	useEffect(() => {
		if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
	}, [logs]);

	if (logs.length === 0) return null;

	return (
		<div className={`logs ${open ? "open" : ""}`}>
			<button className="logs-toggle" onClick={() => setOpen((o) => !o)}>
				{open ? "Hide" : "Show"} logs ({logs.length})
			</button>
			{open && (
				<pre ref={ref} className="logs-body">
					{logs.join("\n")}
				</pre>
			)}
		</div>
	);
}

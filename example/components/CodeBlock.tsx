declare const hljs:
	| {
			highlight(code: string, opts: { language: string }): { value: string };
	  }
	| undefined;

export function CodeBlock({ code, language = "typescript" }: { code: string; language?: string }) {
	const lib = typeof hljs !== "undefined" ? hljs : undefined;
	const html = lib ? lib.highlight(code, { language }).value : null;
	if (html) {
		return <pre className="code hljs" dangerouslySetInnerHTML={{ __html: html }} />;
	}
	return <pre className="code">{code}</pre>;
}

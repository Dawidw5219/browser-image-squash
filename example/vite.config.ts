import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
	plugins: [react()],
	server: {
		allowedHosts: [".trycloudflare.com"],
	},
	optimizeDeps: {
		exclude: [
			"@jsquash/jpeg",
			"@jsquash/png",
			"@jsquash/oxipng",
			"@jsquash/avif",
			"@jsquash/resize",
		],
	},
});

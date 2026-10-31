// Build flavours. The `demo` mode is a single self-contained HTML file with the sample reports:
// it routes through the URL hash so it opens straight from disk, and it never needs the API.
export const demoBuild = import.meta.env.MODE === 'demo';
export const previewEnabled = import.meta.env.DEV || demoBuild;

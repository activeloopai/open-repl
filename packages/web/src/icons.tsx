/** Minimal lucide-style stroke icons, 16px, inherit currentColor. */
type P = { size?: number };
const svg = (size: number, children: React.ReactNode) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const IconFiles = ({ size = 16 }: P) =>
  svg(size, <><path d="M4 4h6l2 2h8v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" /></>);

export const IconPreview = ({ size = 16 }: P) =>
  svg(size, <><circle cx="12" cy="12" r="3" /><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /></>);

export const IconTerminal = ({ size = 16 }: P) =>
  svg(size, <><path d="m5 8 4 4-4 4" /><path d="M13 16h6" /></>);

export const IconModels = ({ size = 16 }: P) =>
  svg(size, <><rect x="5" y="5" width="14" height="14" rx="2" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></>);

export const IconUsage = ({ size = 16 }: P) =>
  svg(size, <><path d="M3 3v18h18" /><path d="m7 14 4-4 3 3 5-6" /></>);

export const IconSecrets = ({ size = 16 }: P) =>
  svg(size, <><circle cx="8" cy="15" r="4" /><path d="m10.8 12.2 8.2-8.2M17 5l2 2M15 7l2 2" /></>);

export const IconPlus = ({ size = 16 }: P) => svg(size, <><path d="M12 5v14M5 12h14" /></>);

export const IconFolder = ({ size = 16 }: P) =>
  svg(size, <><path d="M4 5h5l2 2h9v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" /></>);

export const IconSend = ({ size = 16 }: P) =>
  svg(size, <><path d="M12 19V5M5 12l7-7 7 7" /></>);

export const IconChevronLeft = ({ size = 16 }: P) => svg(size, <><path d="m15 18-6-6 6-6" /></>);
export const IconChevronRight = ({ size = 16 }: P) => svg(size, <><path d="m9 18 6-6-6-6" /></>);

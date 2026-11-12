import type { ReactNode } from "react";

type IconProps = {
  className?: string;
};

function withDefaultClasses(defaultClassName: string, className?: string) {
  return className ? `${defaultClassName} ${className}` : defaultClassName;
}

export function AtlasIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={withDefaultClasses("h-6 w-6", className)}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M10 22C7.17157 22 5.75736 22 4.87868 21.1213C4 20.2426 4 18.8284 4 16V8C4 5.17157 4 3.75736 4.87868 2.87868C5.75736 2 7.17157 2 10 2H14C16.8284 2 18.2426 2 19.1213 2.87868C20 3.75736 20 5.17157 20 8M14 22C16.8284 22 18.2426 22 19.1213 21.1213C20 20.2426 20 18.8284 20 16V12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M19.8978 16H7.89778C6.96781 16 6.50282 16 6.12132 16.1022C5.08604 16.3796 4.2774 17.1883 4 18.2235"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M7 16V9M7 2.5V5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M13 16V19.5309C13 19.8065 13 19.9443 12.9051 20C12.8103 20.0557 12.6806 19.9941 12.4211 19.8708L11.1789 19.2808C11.0911 19.2391 11.0472 19.2182 11 19.2182C10.9528 19.2182 10.9089 19.2391 10.8211 19.2808L9.57889 19.8708C9.31943 19.9941 9.18971 20.0557 9.09485 20C9 19.9443 9 19.8065 9 19.5309V16.45"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function HomeIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={withDefaultClasses("h-8 w-8", className)}
      viewBox="0 0 119 138"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g
        transform="translate(0,138) scale(0.1,-0.1)"
        fill="currentColor"
        stroke="none"
      >
        <path d="M85 1138 c15 -95 57 -160 191 -298 l128 -131 -69 -69 -68 -69 -45 35
c-47 36 -70 42 -90 22 -19 -19 -15 -33 34 -92 l47 -56 -50 -58 c-28 -31 -59
-59 -69 -61 -50 -9 -58 -53 -19 -99 33 -39 80 -59 100 -42 8 7 15 20 15 30 0
10 28 42 63 73 l63 55 53 -44 c54 -45 78 -53 99 -32 19 19 15 31 -24 83 l-37
47 69 69 69 69 75 -69 75 -68 -39 -47 c-29 -36 -37 -52 -32 -71 9 -37 43 -31
106 18 l55 44 63 -55 c41 -37 62 -63 62 -78 0 -50 78 -34 120 26 29 40 23 72
-15 85 -27 9 -58 38 -107 101 l-20 25 29 35 c55 69 66 93 53 109 -19 23 -45
18 -93 -19 l-45 -34 -67 68 c-65 66 -67 68 -51 91 8 13 52 58 97 99 132 122
180 197 204 319 l7 34 -41 -7 c-108 -17 -148 -42 -293 -184 l-139 -136 -127
126 c-138 135 -169 158 -251 182 -87 26 -94 24 -86 -26z m155 -41 c19 -11 92
-76 162 -145 122 -121 126 -126 106 -140 -19 -14 -29 -6 -187 153 -161 162
-177 188 -81 132z m395 -277 c-294 -294 -310 -308 -328 -293 -17 16 -5 29 250
285 193 193 282 275 317 293 28 14 55 25 60 25 6 0 -128 -139 -299 -310z
m-182 -62 c-16 -18 -23 -13 -146 109 -117 116 -177 196 -177 235 0 7 76 -63
170 -157 161 -161 169 -170 153 -187z m494 290 c-20 -41 -90 -116 -297 -323
-256 -256 -271 -269 -287 -252 -17 16 -2 32 292 327 170 170 311 307 313 305
3 -2 -7 -28 -21 -57z m-204 -436 c53 -53 65 -70 55 -80 -20 -20 -31 -14 -101
56 -53 53 -65 70 -55 80 20 20 31 14 101 -56z m-58 -52 c66 -66 68 -71 52 -87
-16 -17 -21 -14 -89 54 -61 62 -70 74 -59 87 8 9 16 16 20 16 4 0 38 -31 76
-70z m-448 -8 c108 -93 232 -232 207 -232 -28 0 -255 217 -285 273 -18 32 9
18 78 -41z m702 41 c-86 -111 -270 -285 -286 -270 -16 17 255 287 289 287 6 0
5 -7 -3 -17z m-675 -215 c-8 -12 -44 21 -44 40 0 12 6 10 25 -8 13 -12 22 -27
19 -32z m601 12 c-10 -11 -22 -17 -27 -14 -5 3 1 17 14 31 26 28 39 12 13 -17z
m-645 -20 c10 -10 15 -22 10 -25 -9 -6 -40 21 -40 36 0 14 8 11 30 -11z m690
12 c0 -14 -36 -43 -43 -35 -4 3 0 15 10 25 17 19 33 24 33 10z m-719 -65 c-12
-12 -41 8 -41 29 0 12 5 11 26 -2 17 -11 22 -20 15 -27z m759 24 c0 -15 -29
-33 -41 -25 -9 5 -7 11 6 21 22 15 35 17 35 4z m-790 -83 c0 -4 -6 -8 -14 -8
-19 0 -68 59 -60 72 6 10 74 -49 74 -64z m854 49 c-23 -40 -74 -74 -74 -50 0
13 63 72 72 67 4 -3 5 -11 2 -17z" />
      </g>
    </svg>
  );
}

export function KitchenIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={withDefaultClasses("h-6 w-6", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M4 11H20M5 11V16.5C5 18.433 6.567 20 8.5 20H15.5C17.433 20 19 18.433 19 16.5V11M2.5 13H5M19 13H21.5" />
      <path d="M9 3.5C8.2 4.6 9.8 5.9 9 7M12 3C11.2 4.1 12.8 5.4 12 6.5M15 3.5C14.2 4.6 15.8 5.9 15 7" />
    </svg>
  );
}

// "alarm-clock" from Lucide (lucide.dev), ISC licence
export function CalendarIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={withDefaultClasses("h-6 w-6", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4M8 14h2M14 14h2M8 17.5h2" />
    </svg>
  );
}

export function AlarmsIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={withDefaultClasses("h-6 w-6", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2 2M5 3 2 6M22 6l-3-3M6.38 18.7 4 21M17.64 18.67 20 21" />
    </svg>
  );
}

// The screen icons below are from Lucide (lucide.dev), ISC licence: list-checks, network,
// circle-user-round, calendar-days, chart-bar, book-open, settings
function LucideIcon({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className={withDefaultClasses("h-6 w-6", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  );
}

export function MinimiseIcon({ className }: IconProps) {
  return (
    <LucideIcon className={className}>
      <path d="M5 12h14" />
    </LucideIcon>
  );
}

export function MaximiseIcon({ className }: IconProps) {
  return (
    <LucideIcon className={className}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </LucideIcon>
  );
}

export function RestoreIcon({ className }: IconProps) {
  return (
    <LucideIcon className={className}>
      <rect x="4" y="8" width="12" height="12" rx="2" />
      <path d="M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2" />
    </LucideIcon>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <LucideIcon className={className}>
      <path d="M18 6 6 18M6 6l12 12" />
    </LucideIcon>
  );
}

export function TodoIcon({ className }: IconProps) {
  return (
    <LucideIcon className={className}>
      <path d="m3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8" />
    </LucideIcon>
  );
}

export function GraphIcon({ className }: IconProps) {
  return (
    <LucideIcon className={className}>
      <rect x="16" y="16" width="6" height="6" rx="1" />
      <rect x="2" y="16" width="6" height="6" rx="1" />
      <rect x="9" y="2" width="6" height="6" rx="1" />
      <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M12 12V8" />
    </LucideIcon>
  );
}

export function CharacterIcon({ className }: IconProps) {
  return (
    <LucideIcon className={className}>
      <path d="M18 20a6 6 0 0 0-12 0" />
      <circle cx="12" cy="10" r="4" />
      <circle cx="12" cy="12" r="10" />
    </LucideIcon>
  );
}

export function MealPlanIcon({ className }: IconProps) {
  return (
    <LucideIcon className={className}>
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M8 2v4M16 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
    </LucideIcon>
  );
}

export function StocksIcon({ className }: IconProps) {
  return (
    <LucideIcon className={className}>
      <path d="M3 3v16a2 2 0 0 0 2 2h16M7 16h8M7 11h12M7 6h3" />
    </LucideIcon>
  );
}

export function RecipesIcon({ className }: IconProps) {
  return (
    <LucideIcon className={className}>
      <path d="M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
    </LucideIcon>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <LucideIcon className={className}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </LucideIcon>
  );
}

export function SunIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
    </svg>
  );
}

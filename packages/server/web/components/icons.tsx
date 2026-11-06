import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ d, strokeWidth = 1.6, ...props }: IconProps & { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d={d} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const OverviewIcon = (p: IconProps) => <Icon {...p} d="M4.75 19.25h14.5M6.5 15.5v3.25m3.75-6.5v6.5m3.75-9.75v9.75m3.75-13v13" />;
export const GroupsIcon = (p: IconProps) => (
  <Icon {...p} d="M4 7.25A2.25 2.25 0 0 1 6.25 5h3.1l1.9 2h6.5A2.25 2.25 0 0 1 20 9.25v7.5A2.25 2.25 0 0 1 17.75 19H6.25A2.25 2.25 0 0 1 4 16.75v-9.5Z" />
);
export const ActivityIcon = (p: IconProps) => <Icon {...p} d="M3.75 12h3.5l2.25-6 5 12 2.25-6h3.5" />;
export const KeyIcon = (p: IconProps) => (
  <Icon {...p} d="M14.5 9.5a3 3 0 1 0-2.6 2.97L8 16.25V19h2.75v-1.75h1.75V15.5l1.03-1.03A3 3 0 0 0 14.5 9.5Zm0 0h.01M15.5 4.5a5 5 0 0 1 4 4" />
);
export const UsersIcon = (p: IconProps) => (
  <Icon {...p} d="M16 19.5v-1.25A3.25 3.25 0 0 0 12.75 15h-5.5A3.25 3.25 0 0 0 4 18.25v1.25M10 11.5A3.5 3.5 0 1 0 10 4a3.5 3.5 0 0 0 0 7.5ZM16.5 4.25a3.25 3.25 0 0 1 0 6.25M18 14.75a3.25 3.25 0 0 1 2 3v1.75" />
);
export const SignOutIcon = (p: IconProps) => (
  <Icon {...p} d="M10 5H6.75A1.75 1.75 0 0 0 5 6.75v10.5A1.75 1.75 0 0 0 6.75 19H10m5-4 3-3m0 0-3-3m3 3H9" />
);
export const PlusIcon = (p: IconProps) => <Icon {...p} d="M12 5v14M5 12h14" strokeWidth={1.8} />;
export const MenuIcon = (p: IconProps) => <Icon {...p} d="M5 7.5h14M5 12h14M5 16.5h14" strokeWidth={1.7} />;
export const CloseIcon = (p: IconProps) => <Icon {...p} d="m7 7 10 10M17 7 7 17" strokeWidth={1.7} />;
export const EyeIcon = (p: IconProps) => (
  <Icon {...p} d="M2.75 12S6 5.75 12 5.75 21.25 12 21.25 12 18 18.25 12 18.25 2.75 12 2.75 12Zm9.25 2.75a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5Z" />
);
export const EyeOffIcon = (p: IconProps) => (
  <Icon {...p} d="M4 4l16 16M9.9 5.95A9.7 9.7 0 0 1 12 5.75c6 0 9.25 6.25 9.25 6.25a16 16 0 0 1-2.6 3.35M6.4 7.4C3.95 9.15 2.75 12 2.75 12S6 18.25 12 18.25c1.6 0 3-.45 4.2-1.1M10.05 10.05a2.75 2.75 0 0 0 3.9 3.9" />
);
export const CopyIcon = (p: IconProps) => (
  <Icon {...p} d="M8.75 8.75V6.25A1.5 1.5 0 0 1 10.25 4.75h7.5a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5h-2.5M6.25 8.75h7.5a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5h-7.5a1.5 1.5 0 0 1-1.5-1.5v-7.5a1.5 1.5 0 0 1 1.5-1.5Z" />
);
export const CheckIcon = (p: IconProps) => <Icon {...p} d="m5 12.5 4.5 4.5L19 7.5" strokeWidth={1.8} />;
export const PencilIcon = (p: IconProps) => <Icon {...p} d="m15.5 4.5 4 4M4.5 19.5l1-4.25L16 4.75l3.25 3.25L8.75 18.5l-4.25 1Z" />;
export const TrashIcon = (p: IconProps) => (
  <Icon {...p} d="M5 7h14M10 11v5.5M14 11v5.5M6.5 7l.75 11.25A1.75 1.75 0 0 0 9 19.75h6a1.75 1.75 0 0 0 1.75-1.5L17.5 7M9.5 7V5.25A1 1 0 0 1 10.5 4.25h3a1 1 0 0 1 1 1V7" />
);
export const UploadIcon = (p: IconProps) => (
  <Icon {...p} d="M12 15.5v-11m0 0-4 4m4-4 4 4M5 13.5v4.25A2.25 2.25 0 0 0 7.25 20h9.5A2.25 2.25 0 0 0 19 17.75V13.5" />
);
export const CodeIcon = (p: IconProps) => <Icon {...p} d="m8.5 8-4 4 4 4m7-8 4 4-4 4m-2.5-10-3 12" />;
export const ChevronRightIcon = (p: IconProps) => <Icon {...p} d="m9.5 6 6 6-6 6" />;
export const SearchIcon = (p: IconProps) => <Icon {...p} d="m20 20-4.35-4.35M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" />;
export const RobotIcon = (p: IconProps) => (
  <Icon {...p} d="M12 4.5V7m-5.25 0h10.5A1.75 1.75 0 0 1 19 8.75v7.5A1.75 1.75 0 0 1 17.25 18H6.75A1.75 1.75 0 0 1 5 16.25v-7.5A1.75 1.75 0 0 1 6.75 7ZM9.5 11.5v1m5-1v1M9.5 15h5M2.75 11v3m18.5-3v3" />
);
export const DownloadIcon = (p: IconProps) => (
  <Icon {...p} d="M12 4.5v11m0 0 4-4m-4 4-4-4M5 13.5v4.25A2.25 2.25 0 0 0 7.25 20h9.5A2.25 2.25 0 0 0 19 17.75V13.5" />
);

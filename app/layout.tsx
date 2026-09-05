import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'ApprovalOS', description: 'Compliance copilot demo' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }

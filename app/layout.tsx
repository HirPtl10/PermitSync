import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Permit Sync', description: 'Permit Sync compliance copilot demo' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }

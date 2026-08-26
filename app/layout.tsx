import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PalletFlow Almacén · Control operativo',
  description: 'Gestión de recepciones, palés, bultos, ubicaciones y expediciones.',
  manifest: '/manifest.webmanifest',
  openGraph: {
    title: 'PalletFlow Almacén',
    description: 'Control operativo de almacén',
    images: [{ url: '/og.png', width: 1731, height: 909, alt: 'PalletFlow Almacén' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PalletFlow Almacén',
    description: 'Control operativo de almacén',
    images: ['/og.png'],
  },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#131a20' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}

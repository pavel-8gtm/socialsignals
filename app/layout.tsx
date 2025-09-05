import type { Metadata } from "next";
import { Jost, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Navigation from "@/components/navigation";

const jost = Jost({
  variable: "--font-jost",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SocialSignals - LinkedIn Engagement Analytics",
  description: "Analyze LinkedIn post engagement data with powerful scraping and analytics tools",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${jost.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        {/* Disable development tools in production */}
        {process.env.NODE_ENV === 'production' && (
          <script
            dangerouslySetInnerHTML={{
              __html: `
                // Disable React DevTools and other debugging tools in production
                if (typeof window !== 'undefined') {
                  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { isDisabled: true };
                  // Prevent WebSocket connections to development servers
                  const originalWebSocket = window.WebSocket;
                  window.WebSocket = function(url, protocols) {
                    if (url.includes('localhost') || url.includes('127.0.0.1')) {
                      console.warn('Blocked development WebSocket connection:', url);
                      return { close: () => {}, send: () => {} };
                    }
                    return new originalWebSocket(url, protocols);
                  };
                }
              `,
            }}
          />
        )}
        <Navigation />
        <main className="min-h-screen bg-gray-50">
          {children}
        </main>
      </body>
    </html>
  );
}

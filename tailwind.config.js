/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand palette — Onewheel orange × VESC neon green blend.
        //   `brand-*`  : primary identity (CTAs, active tabs, focus rings)
        //   `signal-*` : telemetry / status (ready, pending, error, info)
        brand: {
          50: '#fff4ed',
          100: '#ffe6d4',
          200: '#ffc9a8',
          300: '#ffa471',
          400: '#ff8244',
          500: '#ff6b1a',  // Onewheel orange — primary
          600: '#e85a0c',
          700: '#bf4309',
          800: '#923208',
          900: '#6e2607',
        },
        accent: {
          // Neon pink — secondary punch for gradient sweeps & badges.
          500: '#ff2dd1',
          600: '#e620b6',
        },
        signal: {
          // Telemetry semantic states — flat, glowy, monochrome per channel.
          ready: '#00ff88',     // VESC neon green
          'ready-dim': '#00b25f',
          pending: '#ffb020',
          error: '#ff3860',
          info: '#00d4ff',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        'glow-brand': '0 0 0 1px rgba(255, 107, 26, 0.4), 0 0 20px rgba(255, 107, 26, 0.25)',
        'glow-ready': '0 0 0 1px rgba(0, 255, 136, 0.35), 0 0 16px rgba(0, 255, 136, 0.2)',
      },
    },
  },
  plugins: [],
};

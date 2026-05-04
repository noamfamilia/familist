import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/lib/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      keyframes: {
        'invite-link-flourish': {
          '0%': {
            transform: 'scale(1)',
            boxShadow: '0 0 0 0 rgb(42 161 152 / 0)',
          },
          '35%': {
            transform: 'scale(1.02)',
            boxShadow:
              '0 0 0 2px rgb(42 161 152 / 0.55), 0 12px 36px -6px rgb(42 161 152 / 0.35)',
          },
          '100%': {
            transform: 'scale(1)',
            boxShadow: '0 0 0 0 rgb(42 161 152 / 0)',
          },
        },
      },
      animation: {
        'invite-link-flourish': 'invite-link-flourish 1s ease-in-out forwards',
      },
      colors: {
        primary: {
          DEFAULT: '#1e3a5f',
          dark: '#152a45',
          light: 'rgba(30, 58, 95, 0.1)',
        },
        coral: {
          DEFAULT: '#e07050',
          dark: '#c85a3a',
          light: 'rgba(224, 112, 80, 0.1)',
        },
        teal: {
          DEFAULT: '#2aa198',
          dark: '#1e7a73',
          light: 'rgba(42, 161, 152, 0.1)',
        },
        cyan: {
          DEFAULT: '#7ec8e3',
          light: 'rgba(126, 200, 227, 0.2)',
        },
        orange: {
          DEFAULT: '#f5a623',
          dark: '#e0950a',
        },
      },
    },
  },
  plugins: [],
}
export default config

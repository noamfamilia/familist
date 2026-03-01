import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
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

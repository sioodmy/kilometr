tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#5CDBBE',
          hover: '#4ec7ab',
          active: '#43b59a',
          subtle: 'rgba(92, 219, 190, 0.12)',
          border: 'rgba(92, 219, 190, 0.25)',
        },
        surface: {
          950: '#0d100f',
          900: '#131715',
          850: '#181d1b',
          800: '#202624',
          700: '#2c3431',
        },
      },
      fontFamily: {
        sans: ['Geist', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['Geist Mono', 'monospace'],
      },
    },
  },
};

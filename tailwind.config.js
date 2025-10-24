// tailwind.config.js
module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './website/**/*.{js,jsx,ts,tsx,html}'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Segoe UI"', 'Roboto', 'Arial', 'sans-serif']
      },
      colors: {
        discord: {
          bg:   '#36393F',
          surface: '#2F3136',
          header:  '#202225',
          hover:   '#393C43',
          text:    '#DCDDDE',
          highlight: '#00B0F4',
          secondary: '#72767D'
        }
      }
    }
  },
  plugins: []
}